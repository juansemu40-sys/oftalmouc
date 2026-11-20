"""Transcripción: vocabulario para Whisper, validación del archivo y errores de Groq en palabras claras."""
import io
import wave

import httpx
import pytest

from app.errores import AudioInvalido, ConfiguracionIncompleta, LimiteDeTasa, ProveedorNoDisponible
from app.ia.prompts import VOCABULARIO_WHISPER
from app.ia.transcripcion import TranscriptorGroq, medir_duracion, parece_audio


def test_vocabulario_cabe_en_el_limite_de_groq():
    # Groq acepta máximo 224 tokens. Medido con el tokenizador de Whisper: 189 tokens con 533 caracteres.
    # Este tope de caracteres avisa si alguien lo amplía sin volver a medir.
    assert len(VOCABULARIO_WHISPER) <= 560
    for termino in ("20/40", "mmHg", "ojo derecho (od)", "ojo izquierdo (oi)", "pterigión", "campimetría"):
        assert termino.lower() in VOCABULARIO_WHISPER.lower()


@pytest.mark.parametrize("cabecera,esperado", [
    (b"\x1a\x45\xdf\xa3" + b"\x00" * 12, True),     # webm del navegador
    (b"OggS" + b"\x00" * 12, True),                 # nota de voz de WhatsApp
    (b"RIFF\x00\x00\x00\x00WAVEfmt ", True),
    (b"ID3\x04" + b"\x00" * 12, True),
    (b"\xff\xfb\x90\x00" + b"\x00" * 12, True),     # mp3 sin etiquetas
    (b"\x00\x00\x00\x20ftypM4A " + b"\x00" * 4, True),  # iPhone
    (b"MZ\x90\x00" + b"\x00" * 12, False),           # ejecutable
    (b"%PDF-1.7" + b"\x00" * 8, False),
    (b"<html><body>", False),
    (b"RIFF\x00\x00\x00\x00AVI LIST", False),        # RIFF que no es audio
])
def test_reconoce_audio_por_su_contenido(cabecera, esperado):
    assert parece_audio(cabecera) is esperado


def test_mide_la_duracion_de_un_wav(tmp_path):
    ruta = tmp_path / "a.wav"
    with wave.open(str(ruta), "wb") as w:
        w.setnchannels(1), w.setsampwidth(1), w.setframerate(8000)
        w.writeframes(b"\x80" * 8000 * 3)
    assert medir_duracion(str(ruta)) == pytest.approx(3.0)


def _groq(responder):
    return TranscriptorGroq("gsk_prueba", "whisper-large-v3", http_client=httpx.Client(transport=httpx.MockTransport(responder)))


@pytest.fixture
def audio(tmp_path):
    ruta = tmp_path / "d.webm"
    ruta.write_bytes(b"\x1a\x45\xdf\xa3" + b"0" * 100)
    return str(ruta)


def test_groq_envia_modelo_idioma_y_vocabulario(audio):
    vistos = {}

    def responder(peticion: httpx.Request):
        vistos["url"] = str(peticion.url)
        vistos["cuerpo"] = peticion.read().decode("latin-1")
        return httpx.Response(200, json={"text": " Ojo derecho 20/40. ", "duration": 4.2})

    r = _groq(responder).transcribir(audio)
    assert r.texto == "Ojo derecho 20/40." and r.duracion_audio_s == 4.2 and r.modelo == "groq/whisper-large-v3"
    assert vistos["url"].endswith("/audio/transcriptions")
    assert "whisper-large-v3" in vistos["cuerpo"] and 'name="language"' in vistos["cuerpo"]
    assert "pterigi" in vistos["cuerpo"]  # el vocabulario viaja como prompt


@pytest.mark.parametrize("respuesta,error", [
    (httpx.Response(429, json={"error": {"message": "rate limit"}}), LimiteDeTasa),
    (httpx.Response(401, json={"error": {"message": "invalid api key"}}), ConfiguracionIncompleta),
    (httpx.Response(400, json={"error": {"message": "invalid file"}}), AudioInvalido),
    (httpx.Response(503, json={"error": {"message": "down"}}), ProveedorNoDisponible),
])
def test_groq_errores_en_palabras_claras(audio, respuesta, error):
    with pytest.raises(error):
        _groq(lambda _: respuesta).transcribir(audio)


def test_groq_sin_conexion_guarda_la_causa(audio):
    def responder(_):
        raise httpx.ConnectError("[SSL: CERTIFICATE_VERIFY_FAILED] self-signed certificate")

    with pytest.raises(ProveedorNoDisponible) as e:
        _groq(responder).transcribir(audio)
    assert "antivirus" in e.value.mensaje and "CERTIFICATE_VERIFY_FAILED" in e.value.detalle["causa"]


def test_groq_respuesta_vacia_es_audio_sin_voz(audio):
    with pytest.raises(AudioInvalido):
        _groq(lambda _: httpx.Response(200, json={"text": "  "})).transcribir(audio)
