"""Pruebas de seguridad: cada una reproduce un ataque común y comprueba que la app lo bloquea.

Cubre (OWASP Top 10): control de acceso (A01), fallas de autenticación y fuerza bruta (A07), inyección SQL (A03),
XSS almacenado (A03), CSRF, asignación masiva, subida de archivos maliciosos, entradas gigantes (denegación de
servicio), fuga de información en errores y cabeceras (A05), y el enlace público del paciente.
"""
from __future__ import annotations

import io
import wave

import pytest

from tests.conftest import CLAVE_PRUEBA

DICTADO = ("Paciente de 63 años con visión borrosa. Agudeza visual ojo derecho 20/40, ojo izquierdo 20/30. "
           "Presión intraocular ojo derecho 18 mmHg, ojo izquierdo 24 mmHg. Control en un mes.")
ID_FALSO = "00000000-0000-0000-0000-000000000000"
WEBM = b"\x1a\x45\xdf\xa3" + b"0" * 2000


def error(r, status, codigo):
    assert r.status_code == status, r.text
    cuerpo = r.json()["error"]
    assert cuerpo["codigo"] == codigo and cuerpo["mensaje"]
    assert "Traceback" not in r.text and 'File "' not in r.text


def crear_consulta(c, **extra):
    r = c.post("/api/consultas", json={"paciente_ref": "PAC-001", "medico": "Dra. Prueba", **extra})
    assert r.status_code == 201, r.text
    return r.json()


def wav(segundos: float) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1), w.setsampwidth(1), w.setframerate(8000)
        w.writeframes(b"\x80" * int(8000 * segundos))
    return buf.getvalue()


def iniciar(c, clave=CLAVE_PRUEBA, usuario="medico", ip=None):
    cabeceras = {"X-Forwarded-For": ip} if ip else {}
    return c.post("/api/sesion", json={"usuario": usuario, "clave": clave}, headers=cabeceras)


# ============================================================== A01 · control de acceso
def rutas_del_medico(app):
    """Todas las rutas que publica la API (según su OpenAPI), menos las públicas."""
    from app.seguridad import es_ruta_publica

    for camino, operaciones in app.openapi()["paths"].items():
        if not camino.startswith("/api/") or es_ruta_publica(camino.replace("{token}", "x" * 22)):
            continue
        for metodo in sorted(m.upper() for m in operaciones if m.upper() not in ("HEAD", "OPTIONS")):
            yield metodo, camino.replace("{consulta_id}", ID_FALSO)


def test_sin_sesion_ninguna_ruta_del_medico_responde(anonimo):
    """Recorre TODAS las rutas de la API (incluidas las que se agreguen en el futuro)."""
    probadas = 0
    for metodo, camino in rutas_del_medico(anonimo.app):
        error(anonimo.request(metodo, camino, json={}), 401, "sesion_requerida")
        probadas += 1
    assert probadas >= 15


def test_sin_sesion_no_se_ven_las_consultas_de_otros(cliente, anonimo):
    consulta = crear_consulta(cliente)
    for camino in ("/api/consultas", f"/api/consultas/{consulta['id']}", f"/api/consultas/{consulta['id']}/trazas"):
        r = anonimo.get(camino)
        error(r, 401, "sesion_requerida")
        assert "PAC-001" not in r.text


def test_salud_sin_sesion_no_revela_la_configuracion(anonimo, cliente):
    publico = anonimo.get("/api/salud").json()
    assert set(publico) == {"estado", "base_datos"}
    assert "llm" in cliente.get("/api/salud").json()


def test_el_paciente_con_su_enlace_no_puede_ver_la_historia(cliente, anonimo):
    from tests.integration.test_flujo_api import consulta_aprobada

    cid = consulta_aprobada(cliente)
    token = cliente.post(f"/api/consultas/{cid}/enlace-paciente").json()["token"]
    assert anonimo.get(f"/api/paciente/{token}").status_code == 200
    for camino in (f"/api/consultas/{cid}", f"/api/consultas/{cid}/trazas", f"/api/consultas/{cid}/enlace-paciente"):
        error(anonimo.get(camino), 401, "sesion_requerida")
    error(anonimo.delete(f"/api/consultas/{cid}/enlace-paciente"), 401, "sesion_requerida")


def test_identificadores_inventados_o_con_trucos_dan_404(cliente):
    for raro in (ID_FALSO, "1", "..%2f..%2fetc%2fpasswd", "' OR '1'='1", "<script>"):
        r = cliente.get(f"/api/consultas/{raro}")
        assert r.status_code == 404, (raro, r.status_code, r.text)
        assert "Traceback" not in r.text


# ============================================================== A07 · autenticación
def test_contrasena_incorrecta_no_dice_que_fallo(anonimo):
    malo_usuario = iniciar(anonimo, usuario="admin")
    mala_clave = iniciar(anonimo, clave="otra-clave-cualquiera")
    error(malo_usuario, 401, "credenciales_invalidas")
    error(mala_clave, 401, "credenciales_invalidas")
    assert malo_usuario.json()["error"]["mensaje"] == mala_clave.json()["error"]["mensaje"]
    assert "set-cookie" not in mala_clave.headers


def test_usuario_sin_distinguir_mayusculas_pero_clave_exacta(anonimo):
    assert iniciar(anonimo, usuario="  MEDICO ").status_code == 200
    error(iniciar(anonimo, clave=CLAVE_PRUEBA.upper()), 401, "credenciales_invalidas")


def test_sin_contrasena_configurada_nadie_entra(crear_cliente):
    for clave in ("", "corta"):
        c = crear_cliente(sesion=False, medico_clave=clave)
        error(iniciar(c, clave=clave or "cualquiera"), 503, "acceso_no_configurado")
        error(c.get("/api/consultas"), 401, "sesion_requerida")
        assert c.get("/api/sesion").json()["error"]["detalle"]["configurada"] is False


def test_fuerza_bruta_bloquea_tras_5_intentos_por_ip(anonimo):
    for _ in range(5):
        error(iniciar(anonimo, clave="adivinando", ip="10.0.0.66"), 401, "credenciales_invalidas")
    # Bloqueada: ni siquiera con la clave correcta.
    r = iniciar(anonimo, ip="10.0.0.66")
    error(r, 429, "demasiados_intentos")
    assert "minuto" in r.json()["error"]["mensaje"]
    # Otra IP (el médico en su PC) sigue pudiendo entrar.
    assert iniciar(anonimo, ip="10.0.0.5").status_code == 200


def test_fuerza_bruta_el_bloqueo_vence_a_los_15_minutos(anonimo):
    seguridad = anonimo.app.state.seguridad
    reloj = [1000.0]
    seguridad.reloj = lambda: reloj[0]
    for _ in range(5):
        iniciar(anonimo, clave="adivinando", ip="10.0.0.66")
    error(iniciar(anonimo, ip="10.0.0.66"), 429, "demasiados_intentos")
    reloj[0] += 15 * 60 + 1
    assert iniciar(anonimo, ip="10.0.0.66").status_code == 200


def test_fuerza_bruta_cambiando_de_ip_tambien_se_bloquea(anonimo):
    for i in range(20):
        iniciar(anonimo, clave="adivinando", ip=f"10.1.0.{i}")
    error(iniciar(anonimo, ip="10.9.9.9"), 429, "demasiados_intentos")


def test_x_forwarded_for_falsificado_no_evita_el_bloqueo(anonimo):
    """El atacante pone IPs falsas al principio de X-Forwarded-For; cuenta la que agrega nginx (la última)."""
    for i in range(5):
        iniciar(anonimo, clave="adivinando", ip=f"1.2.3.{i}, 10.0.0.66")
    error(iniciar(anonimo, ip="9.9.9.9, 10.0.0.66"), 429, "demasiados_intentos")


def test_cookie_de_sesion_protegida(anonimo):
    r = iniciar(anonimo)
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie and "path=/api" in cookie
    assert "secure" not in cookie  # http://localhost: el navegador la descartaría
    token = anonimo.cookies.get("oftalmouc_sesion")
    assert token and len(token) >= 40 and token not in r.text  # nunca en el cuerpo (JavaScript no la ve)
    https = anonimo.post("/api/sesion", json={"usuario": "medico", "clave": CLAVE_PRUEBA},
                         headers={"X-Forwarded-Proto": "https"})
    assert "secure" in https.headers["set-cookie"].lower()


def test_cookie_inventada_o_robada_tras_cerrar_sesion_no_sirve(cliente, anonimo):
    anonimo.cookies.set("oftalmouc_sesion", "inventada-" + "x" * 40, path="/api")
    error(anonimo.get("/api/consultas"), 401, "sesion_requerida")

    robada = cliente.cookies.get("oftalmouc_sesion")
    assert cliente.get("/api/consultas").status_code == 200
    assert cliente.delete("/api/sesion").json() == {"cerrada": True}
    cliente.cookies.set("oftalmouc_sesion", robada, path="/api")
    error(cliente.get("/api/consultas"), 401, "sesion_requerida")


def test_la_sesion_se_cierra_sola_por_inactividad(cliente):
    seguridad = cliente.app.state.seguridad
    reloj = [5000.0]
    seguridad.reloj = lambda: reloj[0]
    iniciar(cliente)
    reloj[0] += 60 * 60
    assert cliente.get("/api/consultas").status_code == 200    # 1 h sin usarla: sigue activa
    reloj[0] += 2 * 60 * 60 + 1
    error(cliente.get("/api/consultas"), 401, "sesion_requerida")


def test_la_sesion_dura_maximo_12_horas_aunque_se_use(cliente):
    seguridad = cliente.app.state.seguridad
    reloj = [5000.0]
    seguridad.reloj = lambda: reloj[0]
    iniciar(cliente)
    for _ in range(12):
        reloj[0] += 60 * 60
        cliente.get("/api/sesion")
    reloj[0] += 1
    error(cliente.get("/api/consultas"), 401, "sesion_requerida")


# ============================================================== CSRF
@pytest.mark.parametrize("cabeceras", [
    {"Origin": "http://pagina-maliciosa.com"},
    {"Origin": "null"},
    {"Sec-Fetch-Site": "cross-site"},
    {"Sec-Fetch-Site": "same-site"},
])
def test_csrf_otra_pagina_no_puede_usar_la_sesion(cliente, cabeceras):
    error(cliente.post("/api/consultas", json={"paciente_ref": "X", "medico": "Y"}, headers=cabeceras),
          403, "solicitud_no_permitida")
    error(cliente.delete("/api/sesion", headers=cabeceras), 403, "solicitud_no_permitida")
    assert cliente.get("/api/consultas").json() == []  # no se creó nada


def test_csrf_la_propia_app_si_puede(cliente):
    r = cliente.post("/api/consultas", json={"paciente_ref": "X", "medico": "Y"},
                     headers={"Origin": "http://testserver", "Sec-Fetch-Site": "same-origin"})
    assert r.status_code == 201


def test_csrf_no_se_puede_forzar_el_inicio_de_sesion(anonimo):
    error(anonimo.post("/api/sesion", json={"usuario": "medico", "clave": CLAVE_PRUEBA},
                       headers={"Origin": "http://pagina-maliciosa.com"}), 403, "solicitud_no_permitida")


# ============================================================== A03 · inyección
def test_inyeccion_sql_se_guarda_como_texto(cliente):
    ataque = "'; DROP TABLE consultas; --"
    c = crear_consulta(cliente, ips=ataque)
    assert c["ips"] == ataque
    crear_consulta(cliente, medico="x' OR '1'='1")
    assert len(cliente.get("/api/consultas").json()) == 2  # la tabla sigue ahí, sin filas de más


def test_xss_se_devuelve_como_dato_no_como_html(cliente):
    ataque = '<img src=x onerror="alert(document.cookie)">'
    r = cliente.post("/api/consultas", json={"paciente_ref": "PAC-1", "medico": ataque})
    assert r.headers["content-type"].startswith("application/json")
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.json()["medico"] == ataque  # React lo muestra como texto (ver logica/seguridad.test.ts)


def test_asignacion_masiva_no_salta_pasos(cliente):
    """Enviar campos internos (estado, historia aprobada) al crear no los cambia: el flujo de 8 pasos manda."""
    r = cliente.post("/api/consultas", json={"paciente_ref": "PAC-1", "medico": "Dra.", "estado": "APROBADA",
                                             "explicacion_final": "inventada", "id": "propio"})
    assert r.status_code == 201
    assert r.json()["estado"] == "CREADA" and r.json()["explicacion_final"] is None and r.json()["id"] != "propio"


# ============================================================== archivos subidos
@pytest.mark.parametrize("nombre,contenido,tipo", [
    ("virus.mp3", b"MZ\x90\x00" + b"\x00" * 500, "audio/mpeg"),                       # ejecutable renombrado
    ("pagina.webm", b"<html><script>alert(1)</script></html>", "audio/webm"),         # HTML disfrazado
    ("doc.wav", b"%PDF-1.7\n" + b"0" * 500, "audio/wav"),                             # PDF disfrazado
    ("script.ogg", b"#!/bin/sh\nrm -rf /\n", "audio/ogg"),                            # script disfrazado
])
def test_archivo_disfrazado_de_audio_se_rechaza(cliente, nombre, contenido, tipo):
    cid = crear_consulta(cliente)["id"]
    error(cliente.post(f"/api/consultas/{cid}/audio", files={"audio": (nombre, contenido, tipo)}),
          400, "audio_invalido")


def test_nombre_de_archivo_con_rutas_no_escapa_de_la_carpeta_temporal(cliente):
    cid = crear_consulta(cliente)["id"]
    r = cliente.post(f"/api/consultas/{cid}/audio",
                     files={"audio": ("../../../../tmp/malo.sh", WEBM, "audio/webm")})
    assert r.status_code == 200, r.text
    import os
    assert not os.path.exists("/tmp/malo.sh")


def test_audio_demasiado_grande_se_rechaza(crear_cliente):
    c = crear_cliente(max_audio_mb=1)
    cid = crear_consulta(c)["id"]
    r = c.post(f"/api/consultas/{cid}/audio", files={"audio": ("largo.webm", WEBM + b"0" * (1024 * 1024), "audio/webm")})
    error(r, 400, "audio_invalido")
    assert "1 MB" in r.json()["error"]["mensaje"]


def test_audio_demasiado_largo_se_rechaza_sin_transcribir(crear_cliente):
    c = crear_cliente(max_audio_minutos=1)
    cid = crear_consulta(c)["id"]
    assert c.post(f"/api/consultas/{cid}/audio", files={"audio": ("ok.wav", wav(30), "audio/wav")}).status_code == 200
    r = c.post(f"/api/consultas/{cid}/audio", files={"audio": ("largo.wav", wav(61), "audio/wav")})
    error(r, 400, "audio_invalido")
    assert "más de 1 minuto." in r.json()["error"]["mensaje"]


def test_audio_sin_sesion_se_rechaza(anonimo, cliente):
    cid = crear_consulta(cliente)["id"]
    error(anonimo.post(f"/api/consultas/{cid}/audio", files={"audio": ("a.webm", WEBM, "audio/webm")}),
          401, "sesion_requerida")


# ============================================================== entradas gigantes
def test_textos_gigantes_se_rechazan(cliente):
    cid = crear_consulta(cliente)["id"]
    error(cliente.put(f"/api/consultas/{cid}/transcripcion", json={"texto": "a" * 20001}), 422, "validacion")
    error(cliente.post("/api/consultas", json={"paciente_ref": "P" * 65, "medico": "M"}), 422, "validacion")


def test_historia_gigante_en_la_revision_se_rechaza(cliente):
    cid = crear_consulta(cliente)["id"]
    cliente.put(f"/api/consultas/{cid}/transcripcion", json={"texto": DICTADO})
    borrador = cliente.post(f"/api/consultas/{cid}/extraccion").json()["borrador"]
    borrador["plan"]["valor"] = "x" * 5001
    r = cliente.post(f"/api/consultas/{cid}/revision", json={"historia": borrador, "alertas_resueltas": [],
                                                              "medico": "Dra.", "confirmo_revision": True})
    error(r, 422, "validacion")
    borrador["plan"]["valor"] = "ok"
    r = cliente.post(f"/api/consultas/{cid}/revision", json={"historia": borrador, "alertas_resueltas": ["a"] * 201,
                                                              "medico": "Dra.", "confirmo_revision": True})
    error(r, 422, "validacion")


def test_json_malformado_da_error_amigable(cliente):
    r = cliente.post("/api/consultas", content=b"{esto no es json", headers={"Content-Type": "application/json"})
    error(r, 422, "validacion")


# ============================================================== A05 · fugas de información
def test_cabeceras_de_seguridad_en_la_api(cliente, anonimo):
    for r in (cliente.get("/api/consultas"), anonimo.get("/api/salud"), anonimo.get("/api/consultas")):
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert r.headers["cache-control"] == "no-store"


def test_los_logs_no_guardan_el_dictado(cliente, caplog):
    import logging

    caplog.set_level(logging.INFO)
    cid = crear_consulta(cliente)["id"]
    secreto = "glaucoma-secreto-del-paciente-XYZ"
    cliente.put(f"/api/consultas/{cid}/transcripcion", json={"texto": DICTADO + " " + secreto})
    cliente.post(f"/api/consultas/{cid}/extraccion")
    assert secreto not in caplog.text and "20/40" not in caplog.text


def test_metodos_raros_no_estan_permitidos(cliente):
    for metodo in ("TRACE", "PATCH"):
        assert cliente.request(metodo, "/api/consultas").status_code in (401, 403, 405)
