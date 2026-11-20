import pytest

CLAVE_PRUEBA = "clave-de-prueba-123"


@pytest.fixture
def crear_cliente():
    """Fábrica de clientes: API completa con SQLite en memoria, LLM, Whisper y voz simulados (sin red ni llaves).
    `sesion=True` inicia sesión como el médico; `**config` cambia la configuración para una prueba."""
    from fastapi.testclient import TestClient

    from app.config import Config
    from app.main import crear_app

    abiertos = []

    def fabrica(sesion: bool = True, **config):
        base = dict(database_url="sqlite://", llm_provider="mock", transcripcion_provider="mock",
                    voz_provider="mock", permitir_simular_fallas=True, medico_usuario="medico",
                    medico_clave=CLAVE_PRUEBA)
        base.update(config)
        c = TestClient(crear_app(Config(**base)), raise_server_exceptions=False)
        c.__enter__()
        abiertos.append(c)
        if sesion:
            r = c.post("/api/sesion", json={"usuario": "medico", "clave": CLAVE_PRUEBA})
            assert r.status_code == 200, r.text
        return c

    yield fabrica
    for c in abiertos:
        c.__exit__(None, None, None)


@pytest.fixture
def cliente(crear_cliente):
    """El médico con la sesión iniciada."""
    return crear_cliente()


@pytest.fixture
def anonimo(cliente):
    """Alguien sin sesión (otra persona en la red o en internet) contra la MISMA app y base de datos del médico."""
    from fastapi.testclient import TestClient

    return TestClient(cliente.app, raise_server_exceptions=False)
