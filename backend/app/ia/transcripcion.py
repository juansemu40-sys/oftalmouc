"""Paso 2: transcripción con Whisper.

Tres implementaciones del mismo protocolo (`Transcriptor.transcribir`):
  - local: faster-whisper (CTranslate2, int8 en CPU). El audio NUNCA sale del servidor.
  - groq:  whisper-large-v3-turbo vía API (más rápido; el audio sale a un tercero).
  - mock:  devuelve un texto fijo (tests).
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Optional, Protocol

from ..config import Config
from ..errores import AudioInvalido, ConfiguracionIncompleta, LimiteDeTasa, ProveedorNoDisponible, TimeoutIA
from .prompts import VOCABULARIO_WHISPER


@dataclass
class ResultadoTranscripcion:
    texto: str
    duracion_audio_s: Optional[float]
    modelo: str
    latencia_ms: float


def parece_audio(cabecera: bytes) -> bool:
    """¿Los primeros bytes son de un formato de audio conocido? Rechaza ejecutables, PDF, HTML, etc. renombrados
    como .mp3: la extensión y el tipo MIME los decide quien sube el archivo; el contenido no."""
    c = cabecera
    return (
        c.startswith(b"\x1a\x45\xdf\xa3")                    # webm / matroska (grabación del navegador)
        or c.startswith(b"OggS")                              # ogg / opus (notas de voz de WhatsApp)
        or (c.startswith(b"RIFF") and c[8:12] == b"WAVE")     # wav
        or c.startswith(b"ID3")                               # mp3 con etiquetas
        or (len(c) > 1 and c[0] == 0xFF and (c[1] & 0xE0) == 0xE0)  # mp3 / aac sin etiquetas (sincronía de trama)
        or c[4:8] == b"ftyp"                                  # m4a / mp4 (notas de voz del iPhone)
        or c.startswith(b"fLaC")                              # flac
        or c.startswith(b"#!AMR")                             # amr (grabadoras Android antiguas)
    )


def medir_duracion(ruta: str) -> Optional[float]:
    """Duración del audio en segundos SIN decodificarlo (lee la cabecera o recorre los paquetes).
    None si no se puede medir: entonces decide Whisper, que también falla con audio corrupto."""
    try:
        import wave

        with wave.open(ruta, "rb") as w:
            return w.getnframes() / float(w.getframerate())
    except Exception:  # noqa: BLE001 - no es WAV
        pass
    try:
        import av  # PyAV viene con faster-whisper
    except ImportError:
        return None
    try:
        with av.open(ruta) as contenedor:
            if contenedor.duration:
                return contenedor.duration / 1_000_000
            pista = next((s for s in contenedor.streams if s.type == "audio"), None)
            if pista is None:
                return None
            fin = 0.0
            for paquete in contenedor.demux(pista):
                if paquete.pts is not None and paquete.time_base is not None:
                    fin = max(fin, float((paquete.pts + (paquete.duration or 0)) * paquete.time_base))
            return fin or None
    except Exception:  # noqa: BLE001
        return None


class Transcriptor(Protocol):
    descripcion: str

    def transcribir(self, ruta_audio: str) -> ResultadoTranscripcion: ...


class TranscriptorLocal:
    """faster-whisper. El modelo se carga una sola vez (perezosamente) y se comparte entre peticiones."""

    _modelo = None
    _candado = threading.Lock()

    def __init__(self, nombre_modelo: str, compute_type: str):
        self.nombre_modelo, self.compute_type = nombre_modelo, compute_type
        self.descripcion = f"faster-whisper {nombre_modelo} ({compute_type}, CPU, local)"

    def _cargar(self):
        with self._candado:
            if TranscriptorLocal._modelo is None:
                from faster_whisper import WhisperModel

                TranscriptorLocal._modelo = WhisperModel(self.nombre_modelo, device="cpu",
                                                         compute_type=self.compute_type)
        return TranscriptorLocal._modelo

    def precalentar(self) -> None:
        """Carga el modelo en segundo plano al arrancar: la primera transcripción no espera."""
        threading.Thread(target=self._cargar, daemon=True, name="carga-whisper").start()

    def transcribir(self, ruta_audio: str) -> ResultadoTranscripcion:
        inicio = time.perf_counter()
        modelo = self._cargar()
        try:
            segmentos, info = modelo.transcribe(
                ruta_audio, language="es", initial_prompt=VOCABULARIO_WHISPER,
                vad_filter=True,       # recorta silencios: menos tiempo y menos "alucinaciones" de Whisper
                beam_size=5, temperature=0.0, condition_on_previous_text=False,
            )
            texto = " ".join(s.text.strip() for s in segmentos).strip()
        except Exception as e:  # PyAV/ffmpeg lanzan errores variados ante audio corrupto
            raise AudioInvalido(detalle={"error": type(e).__name__}) from e
        if not texto:
            raise AudioInvalido("No se detectó voz en el audio. Verifique el micrófono o use el modo texto.")
        return ResultadoTranscripcion(texto, round(info.duration, 1), f"faster-whisper/{self.nombre_modelo}",
                                      (time.perf_counter() - inicio) * 1000)


class TranscriptorGroq:
    def __init__(self, api_key: str, modelo: str, http_client=None):
        self.api_key, self.modelo = api_key, modelo
        self.http_client = http_client  # solo para pruebas (httpx.MockTransport)
        self.descripcion = f"Groq {modelo} (API)"

    def transcribir(self, ruta_audio: str) -> ResultadoTranscripcion:
        if not self.api_key:  # se valida al usarlo para que la app arranque igual y muestre el error claro
            raise ConfiguracionIncompleta("TRANSCRIPCION_PROVIDER=groq requiere GROQ_API_KEY en .env.")
        import openai

        self._openai = openai
        self._cliente = openai.OpenAI(api_key=self.api_key, base_url="https://api.groq.com/openai/v1",
                                      max_retries=1, http_client=self.http_client)
        inicio = time.perf_counter()
        try:
            with open(ruta_audio, "rb") as f:
                r = self._cliente.with_options(timeout=60).audio.transcriptions.create(
                    model=self.modelo, file=f, language="es", prompt=VOCABULARIO_WHISPER,
                    temperature=0.0, response_format="verbose_json")
        except self._openai.APITimeoutError as e:
            raise TimeoutIA("La transcripción tardó demasiado. Reintente o use el modo texto.") from e
        except self._openai.RateLimitError as e:
            raise LimiteDeTasa("El servicio de voz a texto recibió demasiados audios seguidos. "
                               "Espere un minuto y reintente; su consulta está guardada.") from e
        except self._openai.AuthenticationError as e:
            raise ConfiguracionIncompleta("Groq rechazó la llave (GROQ_API_KEY) al transcribir. Revise .env.") from e
        except self._openai.BadRequestError as e:
            raise AudioInvalido(detalle={"error": str(e)[:200]}) from e
        except self._openai.APIConnectionError as e:
            # La causa (DNS, certificado del antivirus, red) queda en la traza para diagnosticar.
            causa = e.__cause__ or e.__context__
            raise ProveedorNoDisponible("No hay conexión con el servicio de voz a texto (internet o antivirus). "
                                        "Use el modo texto o reintente.",
                                        detalle={"causa": f"{type(causa).__name__}: {causa}"[:300] if causa else str(e)[:300]}) from e
        except self._openai.APIError as e:
            raise ProveedorNoDisponible("El servicio de transcripción no está disponible. "
                                        "Use el modo texto o reintente.") from e
        texto = (r.text or "").strip()
        if not texto:
            raise AudioInvalido("No se detectó voz en el audio.")
        return ResultadoTranscripcion(texto, getattr(r, "duration", None), f"groq/{self.modelo}",
                                      (time.perf_counter() - inicio) * 1000)


class TranscriptorSimulado:
    descripcion = "simulado (tests)"
    TEXTO = ("Paciente consulta por visión borrosa de lejos. Agudeza visual sin corrección ojo derecho 20/40, "
             "ojo izquierdo 20/30. Presión intraocular de 15 en ojo derecho y 16 en ojo izquierdo.")

    def transcribir(self, ruta_audio: str) -> ResultadoTranscripcion:
        return ResultadoTranscripcion(self.TEXTO, 12.0, "simulado", 5.0)


def construir_transcriptor(config: Config) -> Transcriptor:
    if config.transcripcion_provider == "groq":
        return TranscriptorGroq(config.groq_api_key, config.whisper_groq_model)
    if config.transcripcion_provider == "mock":
        return TranscriptorSimulado()
    return TranscriptorLocal(config.whisper_model, config.whisper_compute_type)
