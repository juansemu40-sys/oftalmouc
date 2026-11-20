"""Explicación en voz alta: la explicación que el médico ya aprobó, convertida en audio.

Para quién: pacientes con baja visión (justo los que llegan a oftalmología), adultos mayores y
personas que no leen. Un papel impreso no les sirve; un audio que pueden volver a escuchar en el
celular, sí.

Implementaciones del mismo protocolo (`Sintetizador.sintetizar`):
  - piper:      voz neuronal Piper que corre en este equipo (CPU). El texto NUNCA sale a internet,
                igual que el audio del dictado con Whisper local.
  - elevenlabs: voz en la nube de ElevenLabs, la más humana. El texto aprobado sale a ElevenLabs
                (como la historia sale a Groq para redactar la explicación). Devuelve MP3.
  - mock:       un WAV corto de silencio (tests, sin dependencias).
  - ninguno:    sin voz en el servidor; el navegador usa su propia voz como respaldo.

Frontera de seguridad: solo se lee la explicación APROBADA por el médico (paso 8); nunca un borrador.
"""
from __future__ import annotations

import importlib.util
import io
import os
import re
import threading
import time
import wave
from dataclasses import dataclass
from typing import Protocol

from ..config import Config
from ..errores import VozNoDisponible, VozProveedorError


@dataclass
class ResultadoVoz:
    audio: bytes
    duracion_s: float
    motor: str
    latencia_ms: float
    formato: str = "wav"   # wav | mp3
    local: bool = True     # False = el texto salió a un servicio externo


class Sintetizador(Protocol):
    descripcion: str
    local: bool

    @property
    def disponible(self) -> bool: ...

    def sintetizar(self, texto: str) -> ResultadoVoz: ...


# ---------------------------------------------------------------- texto pensado para el oído
_SIGLAS = [
    (r"\bmmHg\b", "milímetros de mercurio"),
    (r"\bmm\s?Hg\b", "milímetros de mercurio"),
    (r"\bPIO\b", "presión intraocular"),
    (r"\bOD\b", "ojo derecho"),
    (r"\bOI\b", "ojo izquierdo"),
    (r"\bAO\b", "ambos ojos"),
    (r"\bAV\b", "agudeza visual"),
    (r"\bEPS\b", "E P S"),
    (r"\bIPS\b", "I P S"),
    (r"\bIA\b", "inteligencia artificial"),
    (r"\bDr\.\s", "doctor "),
    (r"\bDra\.\s", "doctora "),
]


def normalizar_para_voz(texto: str) -> str:
    """Ajusta el texto para que una voz sintética lo lea como lo diría una persona.

    No cambia el contenido: solo cómo se pronuncia (siglas, fracciones de Snellen, viñetas).
    """
    t = texto.replace("\r\n", "\n")
    # Agudeza visual de Snellen: "20/40" se dice "20 sobre 40", no "20 barra 40".
    t = re.sub(r"\b(\d{1,3})\s*/\s*(\d{1,3})\b", r"\1 sobre \2", t)
    # "él/ella" se dice "él o ella".
    t = re.sub(r"\b([^\W\d_]+)/([^\W\d_]+)\b", r"\1 o \2", t)
    for patron, lectura in _SIGLAS:
        t = re.sub(patron, lectura, t)
    # Decimales clínicos ("excavación 0.6") se leen con coma en español.
    t = re.sub(r"\b(\d+)\.(\d+)\b", r"\1 coma \2", t)
    # Paréntesis: "Agudeza visual (qué tan bien ve de lejos): ..." se dice con pausas, no con cambio de tono.
    t = re.sub(r"\s*\(([^()]*)\)", r", \1,", t)
    t = re.sub(r",\s*([:.;!?])", r"\1", t)
    t = re.sub(r",\s*,", ",", t)
    # Viñetas y símbolos que la voz leería en voz alta.
    t = re.sub(r"^[\s]*[-•*·]\s+", "", t, flags=re.MULTILINE)
    t = t.replace("·", ",").replace("→", "").replace("…", ".")
    # Cada párrafo termina en punto: así la voz hace la pausa.
    parrafos = [p.strip() for p in re.split(r"\n\s*\n", t) if p.strip()]
    parrafos = [p if p[-1] in ".!?:" else p + "." for p in parrafos]
    return "\n\n".join(re.sub(r"[ \t]+", " ", p) for p in parrafos)


def duracion_wav(datos: bytes) -> float:
    with wave.open(io.BytesIO(datos), "rb") as wf:
        return wf.getnframes() / float(wf.getframerate() or 1)


# ---------------------------------------------------------------- Piper (local)
class SintetizadorPiper:
    """Voz neuronal Piper en CPU. Se carga una sola vez (perezosamente) y se comparte entre peticiones."""

    _voz = None
    _candado = threading.Lock()
    local = True

    def __init__(self, ruta_modelo: str, ritmo: float, variacion: float = 0.5, variacion_ritmo: float = 0.6):
        self.ruta_modelo, self.ritmo = ruta_modelo, ritmo
        # Menos variación = entonación y ritmo más parejos (más "estable"); los valores de fábrica de Piper
        # (0.667 y 0.8) suenan más expresivos pero a veces irregulares en textos médicos largos.
        self.variacion, self.variacion_ritmo = variacion, variacion_ritmo
        nombre = os.path.splitext(os.path.basename(ruta_modelo))[0]
        self.descripcion = f"Piper {nombre} (CPU, local)"

    @property
    def disponible(self) -> bool:
        return importlib.util.find_spec("piper") is not None and os.path.exists(self.ruta_modelo)

    def _cargar(self):
        if not self.disponible:
            raise VozNoDisponible(detalle={"motor": "piper", "modelo": self.ruta_modelo})
        with self._candado:
            if SintetizadorPiper._voz is None:
                from piper import PiperVoice

                SintetizadorPiper._voz = PiperVoice.load(self.ruta_modelo)
        return SintetizadorPiper._voz

    def precalentar(self) -> None:
        """Carga la voz en segundo plano al arrancar, si está instalada."""
        if self.disponible:
            threading.Thread(target=self._cargar_sin_error, daemon=True, name="carga-voz").start()

    def _cargar_sin_error(self) -> None:
        try:
            self._cargar()
        except Exception:  # noqa: BLE001 - si falla aquí, fallará con mensaje claro al pedir el audio
            pass

    def _escribir(self, voz, texto: str, wf: wave.Wave_write) -> None:
        # piper-tts 1.3+: synthesize_wav + SynthesisConfig. piper-tts 1.2: synthesize(..., length_scale=...).
        if hasattr(voz, "synthesize_wav"):
            try:
                from piper import SynthesisConfig
            except ImportError:
                voz.synthesize_wav(texto, wf)
                return
            try:
                config = SynthesisConfig(length_scale=self.ritmo, noise_scale=self.variacion,
                                         noise_w_scale=self.variacion_ritmo, normalize_audio=True)
            except TypeError:  # versión con menos opciones: al menos el ritmo
                config = SynthesisConfig(length_scale=self.ritmo)
            voz.synthesize_wav(texto, wf, syn_config=config)
        else:
            voz.synthesize(texto, wf, length_scale=self.ritmo, noise_scale=self.variacion,
                           noise_w=self.variacion_ritmo, sentence_silence=0.3)

    def sintetizar(self, texto: str) -> ResultadoVoz:
        inicio = time.perf_counter()
        voz = self._cargar()
        try:
            buffer = io.BytesIO()
            with wave.open(buffer, "wb") as wf:
                self._escribir(voz, texto, wf)
            datos = buffer.getvalue()
        except VozNoDisponible:
            raise
        except Exception as e:  # noqa: BLE001 - cualquier fallo del motor se reporta como voz no disponible
            raise VozNoDisponible("No se pudo generar el audio con la voz local. Use la voz del navegador.",
                                  detalle={"motor": "piper", "error": type(e).__name__}) from e
        return ResultadoVoz(audio=datos, duracion_s=round(duracion_wav(datos), 1), motor=self.descripcion,
                            latencia_ms=(time.perf_counter() - inicio) * 1000)


# ---------------------------------------------------------------- simulado y ninguno
class SintetizadorSimulado:
    """Medio segundo de silencio en WAV válido: permite probar el flujo completo sin motor de voz."""

    descripcion = "voz simulada (tests)"
    disponible = True
    local = True

    def sintetizar(self, texto: str) -> ResultadoVoz:
        buffer = io.BytesIO()
        with wave.open(buffer, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(16000)
            wf.writeframes(b"\x00\x00" * 8000)
        datos = buffer.getvalue()
        return ResultadoVoz(audio=datos, duracion_s=duracion_wav(datos), motor=self.descripcion, latencia_ms=1.0)


class SinVoz:
    descripcion = "sin voz en el servidor (se usa la del navegador)"
    disponible = False
    local = True

    def sintetizar(self, texto: str) -> ResultadoVoz:
        raise VozNoDisponible(detalle={"motor": "ninguno"})


# ---------------------------------------------------------------- ElevenLabs (nube)
_KBPS_MP3 = 128  # output_format=mp3_44100_128


def _mensaje_elevenlabs(status: int, cuerpo: str) -> str:
    texto = cuerpo.lower()
    if "quota" in texto or "credit" in texto:
        return "Se agotaron los créditos de ElevenLabs de este mes. Se usará la voz del navegador."
    if status == 402:
        return ("Esa voz de ElevenLabs necesita un plan de pago para usarse desde la app (las voces de la "
                "Biblioteca no funcionan por API en el plan gratis). Use una voz predeterminada o una diseñada "
                "por usted, y ponga su Voice ID en ELEVENLABS_VOZ_ID.")
    if status in (401, 403):
        return "ElevenLabs rechazó la llave (ELEVENLABS_API_KEY). Revísela en el archivo .env."
    if status == 404:
        return "ElevenLabs no encontró esa voz (ELEVENLABS_VOZ_ID). Copie el Voice ID desde elevenlabs.io."
    if status == 429:
        return "ElevenLabs está recibiendo demasiadas solicitudes. Espere unos segundos y reintente."
    if status == 422:
        return "ElevenLabs no aceptó la solicitud (revise ELEVENLABS_MODELO y ELEVENLABS_VOZ_ID)."
    return f"ElevenLabs respondió con un error ({status}). Se usará la voz del navegador."


class SintetizadorElevenLabs:
    """Voz en la nube de ElevenLabs. La más humana, pero el texto aprobado sale a ElevenLabs."""

    URL = "https://api.elevenlabs.io/v1/text-to-speech/{voz}"
    local = False

    def __init__(self, api_key: str, voz_id: str, modelo: str, timeout_s: float = 60.0, cliente=None):
        self.api_key, self.voz_id, self.modelo, self.timeout_s = api_key.strip(), voz_id.strip(), modelo, timeout_s
        self._cliente = cliente  # los tests inyectan un cliente httpx con transporte simulado
        self.descripcion = f"ElevenLabs {modelo} (nube)"

    @property
    def disponible(self) -> bool:
        return bool(self.api_key and self.voz_id)

    def sintetizar(self, texto: str) -> ResultadoVoz:
        if not self.disponible:
            raise VozNoDisponible("Falta ELEVENLABS_API_KEY (o ELEVENLABS_VOZ_ID) en el archivo .env.",
                                  detalle={"motor": "elevenlabs"})
        import httpx  # viene con el SDK de OpenAI; se importa aquí para no cargarlo si no se usa

        cuerpo: dict = {"text": texto, "model_id": self.modelo,
                        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75, "style": 0.0,
                                           "use_speaker_boost": True}}
        if not self.modelo.startswith("eleven_multilingual"):
            cuerpo["language_code"] = "es"  # los modelos multilingual_v2 no aceptan language_code
        inicio = time.perf_counter()
        propio = self._cliente is None
        cliente = self._cliente or httpx.Client(timeout=self.timeout_s)
        try:
            r = cliente.post(self.URL.format(voz=self.voz_id), params={"output_format": f"mp3_44100_{_KBPS_MP3}"},
                             headers={"xi-api-key": self.api_key, "Accept": "audio/mpeg"}, json=cuerpo)
        except httpx.TimeoutException as e:
            raise VozProveedorError("ElevenLabs tardó demasiado en responder. Se usará la voz del navegador.",
                                    detalle={"motor": "elevenlabs", "timeout_s": self.timeout_s}) from e
        except httpx.HTTPError as e:
            causa = e.__cause__ or e.__context__ or e
            raise VozProveedorError(
                "No se pudo conectar con ElevenLabs. Revise internet o el antivirus (en Kaspersky, excluya "
                "api.elevenlabs.io). Se usará la voz del navegador.",
                detalle={"motor": "elevenlabs", "error": type(e).__name__,
                         "causa": f"{type(causa).__name__}: {causa}"[:300]}) from e
        finally:
            if propio:
                cliente.close()
        if r.status_code != 200:
            cuerpo_error = r.text[:500]
            raise VozProveedorError(_mensaje_elevenlabs(r.status_code, cuerpo_error),
                                    detalle={"motor": "elevenlabs", "http": r.status_code, "respuesta": cuerpo_error[:300]})
        audio = r.content
        return ResultadoVoz(audio=audio, duracion_s=round(len(audio) * 8 / (_KBPS_MP3 * 1000), 1),
                            motor=self.descripcion, latencia_ms=(time.perf_counter() - inicio) * 1000,
                            formato="mp3", local=False)


def construir_sintetizador(config: Config) -> Sintetizador:
    if config.voz_provider == "elevenlabs":
        return SintetizadorElevenLabs(config.elevenlabs_api_key, config.elevenlabs_voz_id, config.elevenlabs_modelo,
                                      config.elevenlabs_timeout_s)
    if config.voz_provider == "piper":
        return SintetizadorPiper(config.voz_modelo, config.voz_ritmo, config.voz_variacion, config.voz_variacion_ritmo)
    if config.voz_provider == "mock":
        return SintetizadorSimulado()
    return SinVoz()
