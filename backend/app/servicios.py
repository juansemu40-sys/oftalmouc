"""Orquestación de los 8 pasos. Aquí se une lo determinista (estados, validaciones, BD)
con lo probabilístico (Whisper y LLM). Las rutas HTTP solo traducen JSON <-> llamadas a este módulo.

Frontera de la IA (lo que se le explica al profesor):
  IA      -> paso 2 (Whisper transcribe), paso 3 (LLM extrae a JSON), paso 7 (LLM redacta explicación)
  CÓDIGO  -> estados, extractor AV/PIO, verificador de citas/números/lateralidad, guardas de seguridad,
             validación de esquema, bloqueo de guardado sin revisión, persistencia, trazas
  HUMANO  -> paso 5 (revisión obligatoria) y paso 8 (aprobación final)
"""
from __future__ import annotations

import hashlib
import logging
import secrets
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from . import estados
from .clinica.guardas import AVISO_PACIENTE, violaciones_explicacion
from .config import Config
from .db import Consulta, EnlacePaciente, Traza, ahora
from .errores import EnlaceNoDisponible, ErrorAplicacion, ErrorValidacion, NoEncontrado, TransicionInvalida
from .esquemas import AprobacionFinal, CrearConsulta, HistoriaClinica, RevisionMedica
from .ia.agente import LimitesAgente, ejecutar_agente
from .ia.explicacion import generar_explicacion, texto_de_historia
from .ia.proveedores import InyectorFallas, ProveedorConFallas, ProveedorLLM, construir_proveedor
from .ia.transcripcion import Transcriptor, construir_transcriptor
from .ia.voz import ResultadoVoz, SinVoz, Sintetizador, construir_sintetizador, normalizar_para_voz
from .trazas import EventoTraza, registrar_en_log

logger = logging.getLogger("oftalmologia.servicios")


@dataclass
class Servicios:
    """Dependencias externas inyectables (los tests las reemplazan por simuladas)."""

    config: Config
    llm: ProveedorLLM
    transcriptor: Transcriptor
    inyector: InyectorFallas
    voz: Sintetizador = field(default_factory=SinVoz)
    # Audios ya generados (consulta + texto aprobado): escuchar de nuevo o descargar no repite el trabajo.
    cache_voz: OrderedDict = field(default_factory=OrderedDict)

    @property
    def limites(self) -> LimitesAgente:
        c = self.config
        return LimitesAgente(max_iteraciones=c.agente_max_iteraciones, timeout_s=c.agente_timeout_s,
                             max_tokens_totales=c.agente_max_tokens_totales,
                             max_tokens_respuesta=c.llm_max_tokens_respuesta, timeout_llamada_s=c.llm_timeout_s)


def construir_servicios(config: Config) -> Servicios:
    inyector = InyectorFallas(config.permitir_simular_fallas)
    return Servicios(config=config, llm=ProveedorConFallas(construir_proveedor(config), inyector),
                     transcriptor=construir_transcriptor(config), inyector=inyector,
                     voz=construir_sintetizador(config))


def _campos_corregidos(antes: Any, despues: Any, ruta: str = "") -> list[str]:
    """Rutas de los valores que el médico cambió respecto al borrador (métrica de corrección humana)."""
    if isinstance(antes, dict) or isinstance(despues, dict):
        antes, despues = antes or {}, despues or {}
        cambios: list[str] = []
        for k in sorted(set(antes) | set(despues)):
            if k == "evidencia":
                continue
            cambios += _campos_corregidos(antes.get(k), despues.get(k), f"{ruta}.{k}" if ruta else k)
        return cambios
    return [ruta] if antes != despues else []


class ServicioConsultas:
    def __init__(self, db: Session, servicios: Servicios):
        self.db, self.s = db, servicios

    # ------------------------------------------------------------------ utilidades
    def _traza(self, consulta_id: str):
        def registrar(evento: EventoTraza) -> None:
            registrar_en_log(evento)
            self.db.add(Traza(consulta_id=consulta_id, paso=evento.paso, tipo=evento.tipo, nombre=evento.nombre,
                              ok=evento.ok, detalle=evento.detalle, latencia_ms=evento.latencia_ms,
                              tokens_entrada=evento.tokens_entrada, tokens_salida=evento.tokens_salida,
                              costo_usd=evento.costo_usd))
            self.db.commit()  # commit inmediato: el panel de trazas lo ve en vivo mientras el agente trabaja
        return registrar

    def obtener(self, consulta_id: str) -> Consulta:
        consulta = self.db.get(Consulta, consulta_id)
        if consulta is None:
            raise NoEncontrado()
        return consulta

    def listar(self, limite: int = 30) -> list[Consulta]:
        return list(self.db.scalars(select(Consulta).order_by(Consulta.creado_en.desc()).limit(limite)))

    def trazas(self, consulta_id: str) -> list[Traza]:
        self.obtener(consulta_id)
        return list(self.db.scalars(select(Traza).where(Traza.consulta_id == consulta_id).order_by(Traza.id)))

    # ------------------------------------------------------------------ paso 1
    def crear(self, datos: CrearConsulta) -> Consulta:
        consulta = Consulta(paciente_ref=datos.paciente_ref.strip(), medico=datos.medico.strip(),
                            registro_medico=datos.registro_medico, ips=datos.ips, estado=estados.CREADA)
        self.db.add(consulta)
        self.db.commit()
        self._traza(consulta.id)(EventoTraza(1, "estado", "consulta_creada", detalle={"estado": estados.CREADA}))
        return consulta

    # ------------------------------------------------------------------ paso 2
    def transcribir_audio(self, consulta_id: str, ruta_audio: str, bytes_audio: int) -> Consulta:
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "transcribir")
        registrar = self._traza(consulta_id)
        try:
            r = self.s.transcriptor.transcribir(ruta_audio)
        except ErrorAplicacion as e:
            registrar(EventoTraza(2, "error", "whisper", ok=False, detalle={"codigo": e.codigo, **e.detalle}))
            raise
        registrar(EventoTraza(2, "whisper", "transcripcion", latencia_ms=r.latencia_ms,
                              detalle={"modelo": r.modelo, "duracion_audio_s": r.duracion_audio_s,
                                       "bytes": bytes_audio, "caracteres": len(r.texto),
                                       "audio_conservado": False}))
        consulta.transcripcion, consulta.fuente_transcripcion = r.texto, "audio"
        consulta.duracion_audio_s, consulta.estado = r.duracion_audio_s, nuevo
        self.db.commit()
        return consulta

    def fijar_transcripcion(self, consulta_id: str, texto: str) -> Consulta:
        """Modo texto o corrección manual de lo que transcribió Whisper (antes de extraer)."""
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "transcribir")
        vino_de_audio = consulta.fuente_transcripcion in ("audio", "audio_editada")
        consulta.transcripcion = texto.strip()
        consulta.fuente_transcripcion = "audio_editada" if vino_de_audio else "texto"
        consulta.estado = nuevo
        self.db.commit()
        self._traza(consulta_id)(EventoTraza(2, "estado", "transcripcion_manual",
                                             detalle={"fuente": consulta.fuente_transcripcion,
                                                      "caracteres": len(consulta.transcripcion)}))
        return consulta

    # ------------------------------------------------------------------ pasos 3-4
    def extraer(self, consulta_id: str) -> Consulta:
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "extraer")
        r = ejecutar_agente(consulta.transcripcion or "", self.s.llm, self.s.limites, self._traza(consulta_id))
        consulta.borrador = r.historia.model_dump()
        consulta.alertas = [a.model_dump() for a in r.alertas]
        consulta.resumen_extraccion = {
            "estado": r.estado, "motivo_parada": r.motivo_parada, "iteraciones": r.iteraciones,
            "tokens_entrada": r.tokens_entrada, "tokens_salida": r.tokens_salida,
            "costo_usd": round(r.costo_usd, 6), "latencia_ms": round(r.latencia_ms),
            "herramientas": r.herramientas_usadas, "proveedor": self.s.llm.nombre, "modelo": self.s.llm.modelo,
        }
        consulta.estado = nuevo
        self.db.commit()
        self._traza(consulta_id)(EventoTraza(4, "estado", "borrador_listo", detalle={
            "alertas": len(r.alertas), "bloqueantes": sum(a.bloqueante for a in r.alertas), "estado": r.estado}))
        return consulta

    # ------------------------------------------------------------------ pasos 5-6
    def guardar_revision(self, consulta_id: str, revision: RevisionMedica) -> Consulta:
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "guardar")
        registrar = self._traza(consulta_id)
        if not revision.confirmo_revision:
            registrar(EventoTraza(5, "validacion", "revision_sin_confirmar", ok=False))
            raise ErrorValidacion("Debe confirmar que revisó la historia antes de guardarla.")
        pendientes = [a["id"] for a in (consulta.alertas or [])
                      if a["bloqueante"] and a["id"] not in set(revision.alertas_resueltas)]
        if pendientes:
            registrar(EventoTraza(5, "validacion", "alertas_pendientes", ok=False, detalle={"pendientes": pendientes}))
            raise ErrorValidacion(f"Quedan {len(pendientes)} alertas bloqueantes sin revisar.",
                                  detalle={"pendientes": pendientes})
        final = revision.historia.model_dump()
        corregidos = _campos_corregidos(consulta.borrador, final)
        consulta.historia_final, consulta.campos_corregidos = final, corregidos
        consulta.revisado_por, consulta.revisado_en = revision.medico.strip(), ahora()
        consulta.estado = nuevo
        self.db.commit()
        registrar(EventoTraza(5, "validacion", "revision_medica", detalle={
            "alertas_resueltas": len(revision.alertas_resueltas), "campos_corregidos": corregidos}))
        registrar(EventoTraza(6, "estado", "historia_guardada", detalle={"revisado_por": consulta.revisado_por}))
        return consulta

    # ------------------------------------------------------------------ paso 7
    def explicar(self, consulta_id: str) -> Consulta:
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "explicar")
        historia = HistoriaClinica.model_validate(consulta.historia_final)
        r = generar_explicacion(historia, self.s.llm, self.s.config.llm_timeout_s, self._traza(consulta_id))
        consulta.explicacion_borrador, consulta.explicacion_metodo = r.texto, r.metodo
        consulta.estado = nuevo
        self.db.commit()
        return consulta

    # ------------------------------------------------------------------ paso 8
    def aprobar(self, consulta_id: str, aprobacion: AprobacionFinal) -> Consulta:
        consulta = self.obtener(consulta_id)
        nuevo = estados.siguiente_estado(consulta.estado, "aprobar")
        registrar = self._traza(consulta_id)
        if not aprobacion.confirmo_aprobacion:
            registrar(EventoTraza(8, "validacion", "aprobacion_sin_confirmar", ok=False))
            raise ErrorValidacion("Debe confirmar la aprobación de la explicación.")
        texto = aprobacion.explicacion_final.strip()
        # El médico es la autoridad: si su texto editado activa la guarda, se registra pero no se bloquea.
        advertencias = violaciones_explicacion(texto, texto_de_historia(
            HistoriaClinica.model_validate(consulta.historia_final)))
        if AVISO_PACIENTE not in texto:
            texto = f"{texto}\n\n{AVISO_PACIENTE}"
        consulta.explicacion_final, consulta.aprobado_por = texto, aprobacion.medico.strip()
        consulta.aprobado_en, consulta.estado = ahora(), nuevo
        self.db.commit()
        registrar(EventoTraza(8, "estado", "aprobacion_final", detalle={
            "editada_por_medico": aprobacion.explicacion_final.strip() != (consulta.explicacion_borrador or "").strip(),
            "advertencias_guarda": advertencias}))
        return consulta

    # ------------------------------------------------------------------ después del paso 8: voz
    def audio_explicacion(self, consulta_id: str) -> tuple[Consulta, ResultadoVoz, bool]:
        """La explicación APROBADA, en voz alta. Nunca se lee un borrador que el médico no aprobó."""
        consulta = self.obtener(consulta_id)
        if consulta.estado != estados.APROBADA or not consulta.explicacion_final:
            raise TransicionInvalida("El audio solo se genera cuando el médico ya aprobó la explicación (paso 8).")
        texto = normalizar_para_voz(consulta.explicacion_final)
        clave = (consulta_id, hashlib.sha256(f"{self.s.voz.descripcion}|{texto}".encode()).hexdigest())
        cache = self.s.cache_voz
        if clave in cache:
            cache.move_to_end(clave)
            return consulta, cache[clave], True
        registrar = self._traza(consulta_id)
        try:
            r = self.s.voz.sintetizar(texto)
        except ErrorAplicacion as e:
            registrar(EventoTraza(8, "error", "audio_explicacion", ok=False, detalle={"codigo": e.codigo, **e.detalle}))
            raise
        registrar(EventoTraza(8, "voz", "audio_explicacion", latencia_ms=r.latencia_ms, detalle={
            "motor": r.motor, "duracion_audio_s": r.duracion_s, "caracteres": len(texto), "formato": r.formato,
            "bytes": len(r.audio), "texto_sale_del_equipo": not r.local}))
        cache[clave] = r
        while len(cache) > 20:
            cache.popitem(last=False)
        return consulta, r, False

    # ------------------------------------------------------------------ después del paso 8: código QR
    def _enlaces_activos(self, consulta_id: str) -> list[EnlacePaciente]:
        filas = self.db.scalars(select(EnlacePaciente).where(
            EnlacePaciente.consulta_id == consulta_id, EnlacePaciente.anulado_en.is_(None),
        ).order_by(EnlacePaciente.creado_en.desc()))
        return [e for e in filas if not _vencido(e)]

    def enlace_paciente(self, consulta_id: str) -> Optional[EnlacePaciente]:
        """El enlace vigente de la consulta (o None)."""
        self.obtener(consulta_id)
        activos = self._enlaces_activos(consulta_id)
        return activos[0] if activos else None

    def crear_enlace_paciente(self, consulta_id: str) -> EnlacePaciente:
        """Crea el enlace del QR. Solo con la explicación aprobada; si ya hay uno vigente, se reutiliza."""
        consulta = self.obtener(consulta_id)
        if consulta.estado != estados.APROBADA or not consulta.explicacion_final:
            raise TransicionInvalida("El código QR solo se crea cuando el médico ya aprobó la explicación (paso 8).")
        activos = self._enlaces_activos(consulta_id)
        if activos:
            return activos[0]
        dias = max(1, self.s.config.enlace_paciente_dias)
        enlace = EnlacePaciente(token=secrets.token_urlsafe(16), consulta_id=consulta_id,
                                expira_en=ahora() + timedelta(days=dias), aperturas=0)
        self.db.add(enlace)
        self.db.commit()
        self._traza(consulta_id)(EventoTraza(8, "paciente", "enlace_creado", detalle={
            "dias": dias, "expira_en": _aware(enlace.expira_en).isoformat()}))
        return enlace

    def anular_enlace_paciente(self, consulta_id: str) -> int:
        """El médico cierra el enlace (p. ej. si se entregó al paciente equivocado). Deja de abrir al instante."""
        self.obtener(consulta_id)
        activos = self._enlaces_activos(consulta_id)
        for enlace in activos:
            enlace.anulado_en = ahora()
        self.db.commit()
        if activos:
            self._traza(consulta_id)(EventoTraza(8, "paciente", "enlace_anulado", detalle={"enlaces": len(activos)}))
        return len(activos)

    def _validar_token(self, token: str) -> tuple[EnlacePaciente, Consulta]:
        enlace = self.db.get(EnlacePaciente, token) if token else None
        if enlace is None or enlace.anulado_en is not None or _vencido(enlace):
            raise EnlaceNoDisponible()
        consulta = self.db.get(Consulta, enlace.consulta_id)
        if consulta is None or consulta.estado != estados.APROBADA or not consulta.explicacion_final:
            raise EnlaceNoDisponible()
        return enlace, consulta

    def abrir_enlace_paciente(self, token: str) -> tuple[EnlacePaciente, Consulta]:
        """El paciente escaneó el QR. Se cuenta la apertura para que el médico sepa que la recibió."""
        enlace, consulta = self._validar_token(token)
        enlace.aperturas = (enlace.aperturas or 0) + 1
        enlace.ultima_apertura = ahora()
        self.db.commit()
        self._traza(consulta.id)(EventoTraza(8, "paciente", "paciente_abrio", detalle={"aperturas": enlace.aperturas}))
        return enlace, consulta

    def audio_por_enlace(self, token: str) -> tuple[Consulta, ResultadoVoz, bool]:
        """El audio de la explicación, pedido desde el celular del paciente (mismo audio y caché del médico)."""
        _, consulta = self._validar_token(token)
        return self.audio_explicacion(consulta.id)


def _aware(momento: datetime) -> datetime:
    """SQLite (tests) devuelve fechas sin zona; Postgres con zona. Se comparan siempre en UTC."""
    return momento if momento.tzinfo else momento.replace(tzinfo=timezone.utc)


def _vencido(enlace: EnlacePaciente) -> bool:
    return _aware(enlace.expira_en) <= ahora()


def resumen_trazas(trazas: list[Traza], trm_cop: float = 0.0) -> dict[str, Optional[float]]:
    llm = [t for t in trazas if t.tipo == "llm"]
    return {
        "llamadas_llm": len(llm),
        "tokens_entrada": sum(t.tokens_entrada or 0 for t in llm),
        "tokens_salida": sum(t.tokens_salida or 0 for t in llm),
        "costo_usd": round(sum(t.costo_usd or 0 for t in llm), 6),
        "costo_cop": round(sum(t.costo_usd or 0 for t in llm) * trm_cop, 2),
        "latencia_llm_ms": round(sum(t.latencia_ms or 0 for t in llm)),
        "errores": sum(not t.ok for t in trazas),
    }
