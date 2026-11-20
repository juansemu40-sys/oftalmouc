"""Adaptación a Colombia: costos en COP, campos de la consulta y migración aditiva de la BD."""
from sqlalchemy import create_engine, inspect, text

from app.config import Config
from app.db import inicializar_bd
from app.esquemas import CrearConsulta
from app.servicios import resumen_trazas


class TrazaFalsa:
    def __init__(self, costo_usd, tipo="llm", ok=True):
        self.tipo, self.ok, self.costo_usd = tipo, ok, costo_usd
        self.tokens_entrada = self.tokens_salida = 100
        self.latencia_ms = 50.0


def test_resumen_convierte_costo_a_pesos_con_la_trm():
    r = resumen_trazas([TrazaFalsa(0.001), TrazaFalsa(0.002)], trm_cop=3160)
    assert r["costo_usd"] == 0.003
    assert r["costo_cop"] == 9.48


def test_trm_por_defecto_y_configurable():
    assert Config().trm_cop > 1000
    assert Config(trm_cop=4000).trm_cop == 4000


def test_campos_colombianos_opcionales_y_vacios_a_null():
    c = CrearConsulta(paciente_ref="HC-1", medico="Dra. X", registro_medico="  ", ips="IPS Visión Andina")
    assert c.registro_medico is None and c.ips == "IPS Visión Andina"


def test_migracion_agrega_columnas_nuevas_a_una_tabla_existente(tmp_path):
    motor = create_engine(f"sqlite:///{tmp_path / 'vieja.db'}")
    with motor.begin() as cx:  # tabla de la versión anterior, sin registro_medico ni ips
        cx.execute(text("CREATE TABLE consultas (id VARCHAR(36) PRIMARY KEY, paciente_ref VARCHAR(64), "
                        "medico VARCHAR(120), estado VARCHAR(32))"))
        cx.execute(text("INSERT INTO consultas VALUES ('a', 'HC-1', 'Dra. X', 'CREADA')"))
    inicializar_bd(motor)
    columnas = {c["name"] for c in inspect(motor).get_columns("consultas")}
    assert {"registro_medico", "ips", "historia_final"} <= columnas
    with motor.connect() as cx:  # los datos existentes se conservan
        assert cx.execute(text("SELECT paciente_ref FROM consultas")).scalar() == "HC-1"
