"""Endpoints HTTP. Solo traducen JSON <-> ServicioConsultas; no contienen lógica de negocio.

Los endpoints son síncronos (def, no async def): FastAPI los ejecuta en un pool de hilos,
lo cual es correcto para Whisper (CPU) y para el SDK de OpenAI en modo síncrono.
"""
from __future__ import annotations

import os
import re
import tempfile
from datetime import datetime
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import text
from sqlalchemy.orm import Session

from ..ejemplos import EJEMPLOS
from ..db import EnlacePaciente
from ..errores import AudioInvalido, EnlaceNoDisponible, ErrorValidacion, SesionRequerida
from ..esquemas import AprobacionFinal, CrearConsulta, RevisionMedica, TranscripcionManual
from ..ia.prompts import PROMPT_VERSION
from ..ia.transcripcion import medir_duracion, parece_audio
from ..seguridad import (COOKIE_SESION, DURACION_MAXIMA_S, es_https, ip_cliente, requiere_medico, seguridad_de,
                         verificar_csrf)
from ..servicios import ServicioConsultas, Servicios, resumen_trazas

# Dos routers: `router` exige la sesión del médico en TODAS sus rutas (no se puede olvidar en una nueva);
# `publico` tiene solo lo que debe abrirse sin sesión: el estado mínimo, el inicio de sesión y la página del paciente.
router = APIRouter(prefix="/api", dependencies=[Depends(requiere_medico)])
publico = APIRouter(prefix="/api")

EXTENSIONES_AUDIO = {".webm", ".ogg", ".oga", ".wav", ".mp3", ".m4a", ".mp4", ".flac", ".aac"}


# ---------------------------------------------------------------- dependencias
def obtener_servicios(request: Request) -> Servicios:
    return request.app.state.servicios


def obtener_sesion(request: Request):
    sesion: Session = request.app.state.fabrica_sesiones()
    try:
        yield sesion
    finally:
        sesion.close()


def servicio(sesion: Session = Depends(obtener_sesion),
             servicios: Servicios = Depends(obtener_servicios)) -> ServicioConsultas:
    return ServicioConsultas(sesion, servicios)


# ---------------------------------------------------------------- modelos de salida
class ConsultaSalida(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    paciente_ref: str
    medico: str
    registro_medico: Optional[str] = None
    ips: Optional[str] = None
    estado: str
    transcripcion: Optional[str] = None
    fuente_transcripcion: Optional[str] = None
    duracion_audio_s: Optional[float] = None
    borrador: Optional[dict] = None
    alertas: Optional[list] = None
    resumen_extraccion: Optional[dict] = None
    historia_final: Optional[dict] = None
    campos_corregidos: Optional[list] = None
    revisado_por: Optional[str] = None
    revisado_en: Optional[datetime] = None
    explicacion_borrador: Optional[str] = None
    explicacion_metodo: Optional[str] = None
    explicacion_final: Optional[str] = None
    aprobado_por: Optional[str] = None
    aprobado_en: Optional[datetime] = None
    creado_en: datetime
    actualizado_en: datetime


class ConsultaResumen(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    paciente_ref: str
    medico: str
    estado: str
    creado_en: datetime


class TrazaSalida(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: int
    paso: int
    tipo: str
    nombre: str
    ok: bool
    detalle: Optional[dict] = None
    latencia_ms: Optional[float] = None
    tokens_entrada: Optional[int] = None
    tokens_salida: Optional[int] = None
    costo_usd: Optional[float] = None
    creado_en: datetime


class SimularFalla(BaseModel):
    tipo: Optional[Literal["timeout", "caida", "json_roto", "limite_tasa"]] = None


class Credenciales(BaseModel):
    model_config = ConfigDict(extra="forbid")
    usuario: str = Field(..., min_length=1, max_length=80)
    clave: str = Field(..., min_length=1, max_length=200)


# ---------------------------------------------------------------- acceso del médico
@publico.get("/sesion")
def ver_sesion(request: Request) -> dict:
    """¿Hay sesión? 401 si no. Dice además si la contraseña está configurada, para orientar al médico."""
    seguridad = seguridad_de(request)
    sesion = seguridad.validar(request.cookies.get(COOKIE_SESION))
    if sesion is None:
        raise SesionRequerida(detalle={"configurada": seguridad.configurada})
    return {"usuario": sesion.usuario}


@publico.post("/sesion")
def iniciar_sesion(datos: Credenciales, request: Request, response: Response) -> dict:
    verificar_csrf(request)
    seguridad = seguridad_de(request)
    token = seguridad.iniciar(datos.usuario, datos.clave, ip_cliente(request))
    response.set_cookie(COOKIE_SESION, token, max_age=DURACION_MAXIMA_S, path="/api", httponly=True,
                        samesite="strict", secure=es_https(request))
    return {"usuario": seguridad.config.medico_usuario}


@publico.delete("/sesion")
def cerrar_sesion(request: Request, response: Response) -> dict:
    verificar_csrf(request)
    seguridad_de(request).cerrar(request.cookies.get(COOKIE_SESION))
    response.delete_cookie(COOKIE_SESION, path="/api", httponly=True, samesite="strict", secure=es_https(request))
    return {"cerrada": True}


# ---------------------------------------------------------------- sistema
@publico.get("/salud")
def salud(request: Request, servicios: Servicios = Depends(obtener_servicios)) -> dict[str, Any]:
    """Sin sesión solo dice si la app está viva (lo usa el healthcheck de Docker). Con sesión, la configuración."""
    c = servicios.config
    try:
        with request.app.state.fabrica_sesiones() as s:
            s.execute(text("SELECT 1"))
        bd = "ok"
    except Exception:  # noqa: BLE001
        bd = "sin conexión"
    basico = {"estado": "ok" if bd == "ok" else "degradado", "base_datos": bd}
    if seguridad_de(request).validar(request.cookies.get(COOKIE_SESION)) is None:
        return basico
    return {
        **basico,
        "llm": {"proveedor": c.llm_provider, "modelo": servicios.llm.modelo,
                "llave_configurada": c.llm_provider == "mock" or bool(c.api_key_llm)},
        "transcripcion": servicios.transcriptor.descripcion,
        "voz": {"disponible": servicios.voz.disponible, "motor": servicios.voz.descripcion,
                "local": servicios.voz.local},
        "prompt_version": PROMPT_VERSION,
        "limites_agente": {"max_iteraciones": c.agente_max_iteraciones, "timeout_s": c.agente_timeout_s,
                           "max_tokens_totales": c.agente_max_tokens_totales,
                           "confirmacion_humana": "obligatoria (pasos 5 y 8)"},
        "simular_fallas": c.permitir_simular_fallas,
        "colombia": {"trm_cop": c.trm_cop, "zona_horaria": c.zona_horaria, "moneda": "COP"},
        "url_publica": c.url_publica.rstrip("/") or None,
    }


@router.get("/ejemplos")
def ejemplos() -> list[dict]:
    return EJEMPLOS


@router.post("/demo/falla")
def simular_falla(datos: SimularFalla, servicios: Servicios = Depends(obtener_servicios)) -> dict:
    if not servicios.inyector.habilitado:
        raise ErrorValidacion("La simulación de fallos está deshabilitada (PERMITIR_SIMULAR_FALLAS=false).")
    servicios.inyector.armar(datos.tipo)
    return {"proxima_falla": datos.tipo}


# ---------------------------------------------------------------- consultas
@router.get("/consultas", response_model=list[ConsultaResumen])
def listar(svc: ServicioConsultas = Depends(servicio)):
    return svc.listar()


@router.post("/consultas", response_model=ConsultaSalida, status_code=201)
def crear(datos: CrearConsulta, svc: ServicioConsultas = Depends(servicio)):
    """Paso 1: abre la consulta (el dictado se graba en el navegador)."""
    return svc.crear(datos)


@router.get("/consultas/{consulta_id}", response_model=ConsultaSalida)
def obtener(consulta_id: str, svc: ServicioConsultas = Depends(servicio)):
    return svc.obtener(consulta_id)


@router.post("/consultas/{consulta_id}/audio", response_model=ConsultaSalida)
def subir_audio(consulta_id: str, audio: UploadFile = File(...), svc: ServicioConsultas = Depends(servicio),
                servicios: Servicios = Depends(obtener_servicios)):
    """Paso 2: transcribe con Whisper. El audio se borra apenas termina (no se conserva)."""
    extension = os.path.splitext(audio.filename or "")[1].lower()
    tipo = (audio.content_type or "").split(";")[0]
    if extension not in EXTENSIONES_AUDIO and not tipo.startswith(("audio/", "video/webm")):
        raise AudioInvalido("Formato no soportado. Use webm, wav, mp3, m4a u ogg.")
    # El nombre del archivo lo decide quien lo sube: al disco solo llega una extensión de la lista.
    if extension not in EXTENSIONES_AUDIO:
        extension = ".webm"
    svc.obtener(consulta_id)  # 404 antes de recibir el archivo si la consulta no existe
    limite = servicios.config.max_audio_mb * 1024 * 1024
    ruta, total = None, 0
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=extension) as tmp:
            ruta = tmp.name
            while bloque := audio.file.read(1024 * 1024):
                if total == 0 and not parece_audio(bloque[:16]):
                    raise AudioInvalido("El archivo no es un audio válido. Use webm, wav, mp3, m4a u ogg.")
                total += len(bloque)
                if total > limite:
                    raise AudioInvalido(f"El audio supera {servicios.config.max_audio_mb} MB.")
                tmp.write(bloque)
        if total == 0:
            raise AudioInvalido("El archivo de audio está vacío.")
        duracion = medir_duracion(ruta)
        maximo = servicios.config.max_audio_minutos
        if duracion is not None and duracion > maximo * 60:
            raise AudioInvalido(f"El audio dura más de {maximo} minuto{'s' if maximo != 1 else ''}. "
                                "Grabe el dictado en partes más cortas.")
        return svc.transcribir_audio(consulta_id, ruta, total)
    finally:
        if ruta and os.path.exists(ruta):
            os.remove(ruta)


@router.put("/consultas/{consulta_id}/transcripcion", response_model=ConsultaSalida)
def fijar_transcripcion(consulta_id: str, datos: TranscripcionManual, svc: ServicioConsultas = Depends(servicio)):
    """Paso 2 (alternativo): dictado escrito o corrección de lo que transcribió Whisper."""
    return svc.fijar_transcripcion(consulta_id, datos.texto)


@router.post("/consultas/{consulta_id}/extraccion", response_model=ConsultaSalida)
def extraer(consulta_id: str, svc: ServicioConsultas = Depends(servicio)):
    """Pasos 3 y 4: agente LLM + verificación determinista -> borrador con alertas."""
    return svc.extraer(consulta_id)


@router.post("/consultas/{consulta_id}/revision", response_model=ConsultaSalida)
def revisar(consulta_id: str, datos: RevisionMedica, svc: ServicioConsultas = Depends(servicio)):
    """Pasos 5 y 6: revisión médica obligatoria y guardado."""
    return svc.guardar_revision(consulta_id, datos)


@router.post("/consultas/{consulta_id}/explicacion", response_model=ConsultaSalida)
def explicar(consulta_id: str, svc: ServicioConsultas = Depends(servicio)):
    """Paso 7: explicación para el paciente (solo con la historia ya guardada)."""
    return svc.explicar(consulta_id)


@router.post("/consultas/{consulta_id}/aprobacion", response_model=ConsultaSalida)
def aprobar(consulta_id: str, datos: AprobacionFinal, svc: ServicioConsultas = Depends(servicio)):
    """Paso 8: aprobación final del médico."""
    return svc.aprobar(consulta_id, datos)


@router.get("/consultas/{consulta_id}/audio-explicacion")
def audio_explicacion(consulta_id: str, descargar: bool = False, svc: ServicioConsultas = Depends(servicio)):
    """Después del paso 8: la explicación aprobada, leída en voz alta (WAV con Piper local, MP3 con ElevenLabs)."""
    consulta, r, desde_cache = svc.audio_explicacion(consulta_id)
    ref = re.sub(r"[^A-Za-z0-9_-]+", "-", consulta.paciente_ref).strip("-") or "paciente"
    disposicion = "attachment" if descargar else "inline"
    tipo = "audio/mpeg" if r.formato == "mp3" else "audio/wav"
    return Response(content=r.audio, media_type=tipo, headers={
        "Content-Disposition": f'{disposicion}; filename="OftalmoUC-explicacion-{ref}.{r.formato}"',
        "X-Formato-Audio": r.formato,
        "Cache-Control": "no-store",
        "X-Duracion-Audio": str(r.duracion_s),
        "X-Motor-Voz": r.motor.encode("ascii", "ignore").decode(),
        "X-Desde-Cache": "1" if desde_cache else "0",
    })


@router.get("/consultas/{consulta_id}/trazas")
def trazas(consulta_id: str, svc: ServicioConsultas = Depends(servicio),
           servicios: Servicios = Depends(obtener_servicios)) -> dict:
    filas = svc.trazas(consulta_id)
    return {"resumen": resumen_trazas(filas, servicios.config.trm_cop), "trazas": [TrazaSalida.model_validate(t).model_dump() for t in filas]}


# ---------------------------------------------------------------- código QR para el paciente
TOKEN_VALIDO = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def _enlace(e: EnlacePaciente, servicios: Servicios) -> dict[str, Any]:
    ruta = f"/p/{e.token}"
    base = servicios.config.url_publica.rstrip("/")
    return {"token": e.token, "ruta": ruta, "url": f"{base}{ruta}" if base else None,
            "creado_en": e.creado_en, "expira_en": e.expira_en,
            "aperturas": e.aperturas or 0, "ultima_apertura": e.ultima_apertura}


def _token(token: str) -> str:
    if not TOKEN_VALIDO.match(token):
        raise EnlaceNoDisponible()
    return token


@router.get("/consultas/{consulta_id}/enlace-paciente")
def ver_enlace_paciente(consulta_id: str, svc: ServicioConsultas = Depends(servicio),
                        servicios: Servicios = Depends(obtener_servicios)) -> Optional[dict]:
    """El enlace vigente del QR (o null si no se ha creado, venció o se anuló)."""
    e = svc.enlace_paciente(consulta_id)
    return _enlace(e, servicios) if e else None


@router.post("/consultas/{consulta_id}/enlace-paciente", status_code=201)
def crear_enlace_paciente(consulta_id: str, svc: ServicioConsultas = Depends(servicio),
                          servicios: Servicios = Depends(obtener_servicios)) -> dict:
    """Crea el enlace privado del QR (solo con la explicación aprobada)."""
    return _enlace(svc.crear_enlace_paciente(consulta_id), servicios)


@router.delete("/consultas/{consulta_id}/enlace-paciente")
def anular_enlace_paciente(consulta_id: str, svc: ServicioConsultas = Depends(servicio)) -> dict:
    """El médico anula el enlace: el QR impreso deja de abrir."""
    return {"anulados": svc.anular_enlace_paciente(consulta_id)}


@publico.get("/paciente/{token}")
def pagina_paciente(token: str, response: Response, svc: ServicioConsultas = Depends(servicio),
                    servicios: Servicios = Depends(obtener_servicios)) -> dict:
    """Lo que ve el paciente al escanear el QR: SOLO la explicación aprobada. Sin historia clínica,
    sin referencia del paciente, sin transcripción."""
    enlace, consulta = svc.abrir_enlace_paciente(_token(token))
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return {
        "explicacion": consulta.explicacion_final,
        "medico": consulta.aprobado_por or consulta.revisado_por or consulta.medico,
        "registro_medico": consulta.registro_medico,
        "ips": consulta.ips,
        "aprobado_en": consulta.aprobado_en,
        "expira_en": enlace.expira_en,
        "voz": {"disponible": servicios.voz.disponible},
    }


@publico.get("/paciente/{token}/audio")
def audio_paciente(token: str, svc: ServicioConsultas = Depends(servicio)):
    """El audio de la explicación para el celular del paciente."""
    _, r, desde_cache = svc.audio_por_enlace(_token(token))
    return Response(content=r.audio, media_type="audio/mpeg" if r.formato == "mp3" else "audio/wav", headers={
        "Content-Disposition": f'inline; filename="OftalmoUC-explicacion.{r.formato}"',
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "X-Formato-Audio": r.formato,
        "X-Duracion-Audio": str(r.duracion_s),
        "X-Desde-Cache": "1" if desde_cache else "0",
    })
