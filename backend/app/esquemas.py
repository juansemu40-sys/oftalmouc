"""Contrato de datos de la historia clínica (Pydantic v2).

Diseño anti-alucinación:
- Cada dato lleva su `evidencia`: la cita LITERAL de la transcripción que lo respalda.
- Si algo no fue dictado, el valor es null. Nunca se rellena "por defecto".
- Los campos están separados por ojo (OD = derecho, OI = izquierdo): la lateralidad
  es parte de la estructura, no del texto libre.
"""
from __future__ import annotations

import re
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator

PATRON_SNELLEN = re.compile(r"^\d{1,2}/\d{1,3}$")
AV_CUALITATIVAS = {"cuenta dedos", "movimiento de manos", "percepcion de luz", "no percibe luz"}
_VACIOS = {"", "null", "none", "n/a", "na", "no dictado", "no aplica", "-"}


def _vacio_a_none(v):
    """Los LLM a veces devuelven "" o "no dictado" en vez de null: se normaliza a null."""
    if isinstance(v, str) and v.strip().lower() in _VACIOS:
        return None
    return v.strip() if isinstance(v, str) else v


class Campo(BaseModel):
    """Dato de texto libre respaldado por una cita literal."""

    model_config = ConfigDict(extra="forbid")
    valor: Optional[str] = Field(None, description="Dato tal como lo dictó el médico, o null si no fue dictado.")
    evidencia: Optional[str] = Field(
        None, description="Fragmento copiado LITERALMENTE de la transcripción que respalda el valor."
    )

    @field_validator("valor", "evidencia", mode="before")
    @classmethod
    def limpiar(cls, v):
        return _vacio_a_none(v)


class CampoAV(Campo):
    """Agudeza visual: Snellen (20/40) o cualitativa (cuenta dedos, movimiento de manos...)."""

    @field_validator("valor")
    @classmethod
    def validar_formato(cls, v: Optional[str]) -> Optional[str]:
        v = _vacio_a_none(v)
        if v is None:
            return v
        v = v.strip().lower().replace(" ", "") if "/" in v else v.strip().lower()
        sin_tildes = v.translate(str.maketrans("áéíóú", "aeiou"))
        if PATRON_SNELLEN.match(v):
            return v
        if any(sin_tildes.startswith(c) for c in AV_CUALITATIVAS):
            return v
        raise ValueError(
            "La agudeza visual debe estar en formato Snellen (ej. 20/40) o ser cualitativa "
            "(cuenta dedos, movimiento de manos, percepción de luz, no percibe luz)."
        )


class CampoPIO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    valor_mmhg: Optional[float] = Field(None, ge=0, le=80, description="Presión intraocular en mmHg, o null.")
    evidencia: Optional[str] = Field(None, description="Cita literal de la transcripción.")

    @field_validator("valor_mmhg", mode="before")
    @classmethod
    def numero_desde_texto(cls, v):
        """Acepta "15 mmHg" o "15,5" y lo convierte en número."""
        v = _vacio_a_none(v)
        if isinstance(v, str):
            m = re.search(r"\d+(?:[.,]\d+)?", v)
            if not m:
                raise ValueError("La PIO debe ser un número en mmHg (ej. 15).")
            return float(m.group(0).replace(",", "."))
        return v

    @field_validator("evidencia", mode="before")
    @classmethod
    def limpiar_evidencia(cls, v):
        return _vacio_a_none(v)


class AgudezaOjo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    sin_correccion: CampoAV = Field(default_factory=CampoAV)
    con_correccion: CampoAV = Field(default_factory=CampoAV)


class AgudezaVisual(BaseModel):
    model_config = ConfigDict(extra="forbid")
    od: AgudezaOjo = Field(default_factory=AgudezaOjo, description="Ojo DERECHO")
    oi: AgudezaOjo = Field(default_factory=AgudezaOjo, description="Ojo IZQUIERDO")


class PIO(BaseModel):
    model_config = ConfigDict(extra="forbid")
    od: CampoPIO = Field(default_factory=CampoPIO, description="Ojo DERECHO")
    oi: CampoPIO = Field(default_factory=CampoPIO, description="Ojo IZQUIERDO")


class PorOjo(BaseModel):
    model_config = ConfigDict(extra="forbid")
    od: Campo = Field(default_factory=Campo, description="Ojo DERECHO")
    oi: Campo = Field(default_factory=Campo, description="Ojo IZQUIERDO")


class HistoriaClinica(BaseModel):
    model_config = ConfigDict(extra="forbid")
    motivo_consulta: Campo = Field(default_factory=Campo)
    antecedentes: Campo = Field(default_factory=Campo)
    agudeza_visual: AgudezaVisual = Field(default_factory=AgudezaVisual)
    pio: PIO = Field(default_factory=PIO)
    biomicroscopia: PorOjo = Field(default_factory=PorOjo)
    fondo_de_ojo: PorOjo = Field(default_factory=PorOjo)
    impresion_diagnostica: Campo = Field(
        default_factory=Campo,
        description="SOLO lo que el médico dictó como impresión diagnóstica, literal. La IA no diagnostica.",
    )
    plan: Campo = Field(default_factory=Campo, description="Tratamiento, recomendaciones y control dictados.")


TipoAlerta = Literal[
    "conflicto",            # LLM y extractor determinista no coinciden
    "ambigua",              # el extractor no puede asignar ojo con certeza
    "lateralidad",          # la cita no respalda el ojo asignado
    "sin_evidencia",        # el valor no tiene cita literal verificable
    "posible_alucinacion",  # aparece un número/diagnóstico que no está en el dictado
    "solo_llm",             # dato crítico que solo encontró el LLM
    "fuera_de_rango",       # valor fisiológicamente improbable
    "completado_determinista",  # el LLM omitió un dato que el extractor sí encontró
    "extraccion_parcial",   # el agente no terminó (límite alcanzado)
]


class Alerta(BaseModel):
    id: str
    campo: str
    tipo: TipoAlerta
    bloqueante: bool
    mensaje: str
    valor_llm: Optional[str] = None
    valor_determinista: Optional[str] = None
    evidencia: Optional[str] = None


# --- Peticiones / respuestas de la API --------------------------------------
class CrearConsulta(BaseModel):
    paciente_ref: str = Field(..., min_length=1, max_length=64,
                              description="Número de historia clínica interno (seudonimizado), nunca la cédula ni el nombre.")
    medico: str = Field(..., min_length=1, max_length=120)
    registro_medico: Optional[str] = Field(None, max_length=40, description="Registro médico / RETHUS (opcional).")
    ips: Optional[str] = Field(None, max_length=120, description="IPS o consultorio donde se atiende (opcional).")

    @field_validator("registro_medico", "ips", mode="before")
    @classmethod
    def limpiar_opcionales(cls, v):
        return _vacio_a_none(v)


class TranscripcionManual(BaseModel):
    texto: str = Field(..., min_length=10, max_length=20000)


MAX_CARACTERES_CAMPO = 5000
MAX_CARACTERES_HISTORIA = 60000


def _textos(valor):
    if isinstance(valor, str):
        yield valor
    elif isinstance(valor, dict):
        for v in valor.values():
            yield from _textos(v)
    elif isinstance(valor, (list, tuple)):
        for v in valor:
            yield from _textos(v)


class RevisionMedica(BaseModel):
    historia: HistoriaClinica
    alertas_resueltas: list[str] = Field(default_factory=list, max_length=200)
    medico: str = Field(..., min_length=1, max_length=120)
    confirmo_revision: bool

    # Los límites van aquí y no en HistoriaClinica: ese esquema también se envía a la IA como herramienta,
    # y algunos proveedores rechazan maxLength en modo estricto.
    @field_validator("historia")
    @classmethod
    def limitar_tamano(cls, historia: HistoriaClinica) -> HistoriaClinica:
        textos = list(_textos(historia.model_dump()))
        if any(len(t) > MAX_CARACTERES_CAMPO for t in textos):
            raise ValueError(f"cada campo admite máximo {MAX_CARACTERES_CAMPO} caracteres")
        if sum(len(t) for t in textos) > MAX_CARACTERES_HISTORIA:
            raise ValueError(f"la historia admite máximo {MAX_CARACTERES_HISTORIA} caracteres en total")
        return historia

    @field_validator("alertas_resueltas")
    @classmethod
    def limitar_alertas(cls, alertas: list[str]) -> list[str]:
        if any(len(a) > 100 for a in alertas):
            raise ValueError("identificador de alerta inválido")
        return alertas


class AprobacionFinal(BaseModel):
    explicacion_final: str = Field(..., min_length=20, max_length=8000)
    medico: str = Field(..., min_length=1, max_length=120)
    confirmo_aprobacion: bool
