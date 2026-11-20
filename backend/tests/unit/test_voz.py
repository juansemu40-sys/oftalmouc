"""Explicación en voz alta: el texto se adapta para el oído y el audio es un WAV válido."""
import pytest

from app.errores import VozNoDisponible, VozProveedorError
from app.ia.voz import (SintetizadorElevenLabs, SintetizadorPiper, SintetizadorSimulado, SinVoz, duracion_wav,
                        normalizar_para_voz)


def test_snellen_y_siglas_se_leen_como_las_diria_una_persona():
    t = normalizar_para_voz("Su AV en OD es 20/40 y en OI 20/80. La PIO del OI fue 23 mmHg.")
    assert "20 sobre 40" in t and "20 sobre 80" in t
    assert "agudeza visual" in t and "ojo derecho" in t and "ojo izquierdo" in t
    assert "presión intraocular" in t and "milímetros de mercurio" in t
    assert "/" not in t and "mmHg" not in t
    assert "él o ella" in normalizar_para_voz("revisada por él/ella")


def test_decimales_viñetas_y_pausas_entre_parrafos():
    t = normalizar_para_voz("Excavación de 0.6 en el nervio\n\n- Campimetría\n- Control en un mes")
    assert "0 coma 6" in t
    assert "-" not in t
    assert t.split("\n\n")[0].endswith(".")


def test_parentesis_se_leen_como_pausas_y_no_como_cambio_de_tono():
    t = normalizar_para_voz("Agudeza visual (qué tan bien ve de lejos): ojo derecho 20/40.")
    assert t == "Agudeza visual, qué tan bien ve de lejos: ojo derecho 20 sobre 40."


def test_no_cambia_el_contenido_ni_las_cifras_legales():
    original = "Sus datos se tratan conforme a la Ley 1581 de 2012."
    assert normalizar_para_voz(original) == original


def test_voz_simulada_entrega_un_wav_valido():
    r = SintetizadorSimulado().sintetizar("Hola")
    assert r.audio[:4] == b"RIFF" and duracion_wav(r.audio) == pytest.approx(0.5) and r.local


def test_sin_voz_en_el_servidor_responde_con_error_claro():
    assert SinVoz().disponible is False
    with pytest.raises(VozNoDisponible):
        SinVoz().sintetizar("Hola")


def test_piper_sin_modelo_instalado_no_rompe_la_app(tmp_path):
    voz = SintetizadorPiper(str(tmp_path / "no-existe.onnx"), 1.1)
    assert voz.disponible is False
    voz.precalentar()  # no debe lanzar
    with pytest.raises(VozNoDisponible):
        voz.sintetizar("Hola")


# ---------------------------------------------------------------- ElevenLabs (sin red: transporte simulado)
def _eleven(respuesta):
    import httpx

    pedidas = []

    def manejador(peticion):
        pedidas.append(peticion)
        return respuesta(peticion) if callable(respuesta) else respuesta

    cliente = httpx.Client(transport=httpx.MockTransport(manejador))
    return SintetizadorElevenLabs("llave-de-prueba", "voz123", "eleven_multilingual_v2", cliente=cliente), pedidas


def test_elevenlabs_devuelve_mp3_y_avisa_que_el_texto_sale_del_equipo():
    import json

    import httpx

    voz, pedidas = _eleven(httpx.Response(200, content=b"ID3" + b"\x00" * 16000))
    r = voz.sintetizar("Hola, doña Rosa.")
    assert r.formato == "mp3" and r.local is False and r.audio.startswith(b"ID3")
    assert r.duracion_s == pytest.approx(1.0, abs=0.1)
    peticion = pedidas[0]
    assert peticion.url.path == "/v1/text-to-speech/voz123"
    assert peticion.headers["xi-api-key"] == "llave-de-prueba"
    cuerpo = json.loads(peticion.content)
    assert cuerpo["text"] == "Hola, doña Rosa." and cuerpo["model_id"] == "eleven_multilingual_v2"
    assert "language_code" not in cuerpo  # multilingual_v2 no lo acepta


def test_elevenlabs_llave_invalida_da_mensaje_claro():
    import httpx

    voz, _ = _eleven(httpx.Response(401, json={"detail": {"status": "invalid_api_key"}}))
    with pytest.raises(VozProveedorError) as e:
        voz.sintetizar("Hola")
    assert "llave" in e.value.mensaje


def test_elevenlabs_sin_creditos_da_mensaje_claro():
    import httpx

    voz, _ = _eleven(httpx.Response(401, json={"detail": {"status": "quota_exceeded"}}))
    with pytest.raises(VozProveedorError) as e:
        voz.sintetizar("Hola")
    assert "créditos" in e.value.mensaje


def test_elevenlabs_sin_conexion_sugiere_revisar_el_antivirus():
    import httpx

    def falla(peticion):
        raise httpx.ConnectError("certificate verify failed", request=peticion)

    voz, _ = _eleven(falla)
    with pytest.raises(VozProveedorError) as e:
        voz.sintetizar("Hola")
    assert "api.elevenlabs.io" in e.value.mensaje and "certificate" in e.value.detalle["causa"]


def test_elevenlabs_sin_llave_no_esta_disponible():
    voz = SintetizadorElevenLabs("", "voz123", "eleven_multilingual_v2")
    assert voz.disponible is False
    with pytest.raises(VozNoDisponible):
        voz.sintetizar("Hola")


def test_elevenlabs_voz_de_pago_explica_que_hacer():
    import httpx

    voz, _ = _eleven(httpx.Response(402, json={"detail": {"status": "payment_required"}}))
    with pytest.raises(VozProveedorError) as e:
        voz.sintetizar("Hola")
    assert "plan de pago" in e.value.mensaje and "ELEVENLABS_VOZ_ID" in e.value.mensaje
