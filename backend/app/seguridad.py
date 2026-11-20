"""Acceso del médico: inicio de sesión, sesiones, límite de intentos y protección CSRF.

Diseño (pensado para un consultorio con un médico y una sola instalación):
  - Usuario y contraseña en .env (MEDICO_USUARIO / MEDICO_CLAVE). Se comparan en tiempo constante.
  - La sesión es un token aleatorio de 256 bits en una cookie HttpOnly + SameSite=Strict, solo para /api.
    El servidor guarda únicamente el hash SHA-256 del token: si alguien leyera la memoria, no obtiene la cookie.
  - Cierre por inactividad (SESION_INACTIVIDAD_MIN, 2 h por defecto) y siempre a las 12 h.
  - Fuerza bruta: 5 intentos fallidos por IP en 15 min, y 20 en total en 15 min (por si cambian de IP).
  - CSRF (que otra página use la sesión del médico): la cookie es SameSite=Strict y, además, toda petición
    que cambia algo se rechaza si el navegador dice que viene de otro sitio (cabeceras Sec-Fetch-Site y Origin,
    "Fetch Metadata", recomendación de OWASP).
  - El paciente NO usa sesión: abre su explicación con el token privado del QR (rutas /api/paciente/...).
"""
from __future__ import annotations

import hashlib
import hmac
import math
import secrets
import threading
import time
from collections import deque
from urllib.parse import urlsplit
from dataclasses import dataclass
from typing import Callable, Optional

from fastapi import Request

from .config import Config
from .errores import (AccesoNoConfigurado, CredencialesInvalidas, DemasiadosIntentos, SesionRequerida,
                      SolicitudNoPermitida)

COOKIE_SESION = "oftalmouc_sesion"
METODOS_SEGUROS = frozenset({"GET", "HEAD", "OPTIONS"})
# Rutas que se abren sin sesión. Todo lo demás bajo /api exige sesión del médico.
RUTAS_PUBLICAS = ("/api/sesion", "/api/salud", "/api/paciente/")

CLAVE_LARGO_MINIMO = 10
DURACION_MAXIMA_S = 12 * 3600
VENTANA_INTENTOS_S = 15 * 60
MAX_FALLOS_POR_IP = 5
MAX_FALLOS_TOTALES = 20


def _hash(texto: str) -> bytes:
    return hashlib.sha256(texto.encode("utf-8")).digest()


@dataclass
class Sesion:
    usuario: str
    creada: float
    ultima: float


class Seguridad:
    """Sesiones y límite de intentos en memoria: al reiniciar la app, el médico vuelve a iniciar sesión."""

    def __init__(self, config: Config, reloj: Callable[[], float] = time.monotonic):
        self.config = config
        self.reloj = reloj
        self._sesiones: dict[bytes, Sesion] = {}
        self._fallos_ip: dict[str, deque[float]] = {}
        self._fallos_totales: deque[float] = deque()
        self._candado = threading.Lock()

    @property
    def inactividad_s(self) -> int:
        return max(5, self.config.sesion_inactividad_min) * 60

    @property
    def configurada(self) -> bool:
        return len(self.config.medico_clave) >= CLAVE_LARGO_MINIMO

    # ------------------------------------------------------------------ inicio de sesión
    def iniciar(self, usuario: str, clave: str, ip: str) -> str:
        if not self.configurada:
            raise AccesoNoConfigurado()
        ahora = self.reloj()
        with self._candado:
            fallos_ip = self._fallos_ip.setdefault(ip, deque())
            for cola in (fallos_ip, self._fallos_totales):
                while cola and ahora - cola[0] > VENTANA_INTENTOS_S:
                    cola.popleft()
            bloqueo = None
            if len(fallos_ip) >= MAX_FALLOS_POR_IP:
                bloqueo = fallos_ip[0]
            elif len(self._fallos_totales) >= MAX_FALLOS_TOTALES:
                bloqueo = self._fallos_totales[0]
            if bloqueo is not None:
                minutos = max(1, math.ceil((VENTANA_INTENTOS_S - (ahora - bloqueo)) / 60))
                raise DemasiadosIntentos(
                    f"Demasiados intentos fallidos. Espere {minutos} minuto{'s' if minutos != 1 else ''} "
                    "e inténtelo de nuevo.", detalle={"espera_min": minutos})

        # Siempre se comparan ambos (usuario y clave) en tiempo constante: no se revela cuál falló.
        usuario_ok = hmac.compare_digest(_hash(usuario.strip().lower()), _hash(self.config.medico_usuario.strip().lower()))
        clave_ok = hmac.compare_digest(_hash(clave), _hash(self.config.medico_clave))
        if not (usuario_ok and clave_ok):
            with self._candado:
                self._fallos_ip.setdefault(ip, deque()).append(ahora)
                self._fallos_totales.append(ahora)
            raise CredencialesInvalidas()

        token = secrets.token_urlsafe(32)
        with self._candado:
            self._fallos_ip.pop(ip, None)
            self._purgar(ahora)
            self._sesiones[_hash(token)] = Sesion(self.config.medico_usuario, ahora, ahora)
        return token

    def validar(self, token: Optional[str]) -> Optional[Sesion]:
        if not token or len(token) > 200:
            return None
        clave, ahora = _hash(token), self.reloj()
        with self._candado:
            sesion = self._sesiones.get(clave)
            if sesion is None:
                return None
            if ahora - sesion.ultima > self.inactividad_s or ahora - sesion.creada > DURACION_MAXIMA_S:
                del self._sesiones[clave]
                return None
            sesion.ultima = ahora
            return sesion

    def cerrar(self, token: Optional[str]) -> None:
        if token:
            with self._candado:
                self._sesiones.pop(_hash(token), None)

    def _purgar(self, ahora: float) -> None:
        vencidas = [k for k, s in self._sesiones.items()
                    if ahora - s.ultima > self.inactividad_s or ahora - s.creada > DURACION_MAXIMA_S]
        for k in vencidas:
            del self._sesiones[k]


# ---------------------------------------------------------------------- dependencias de FastAPI
def ip_cliente(request: Request) -> str:
    """IP real del navegador. nginx agrega la suya al final de X-Forwarded-For: se toma el último valor,
    que el cliente no puede falsificar (lo que él envíe queda a la izquierda)."""
    reenviada = request.headers.get("x-forwarded-for", "")
    if reenviada.strip():
        return reenviada.split(",")[-1].strip()[:64]
    return request.client.host if request.client else "desconocida"


def es_https(request: Request) -> bool:
    return request.url.scheme == "https" or request.headers.get("x-forwarded-proto", "").lower() == "https"


def peticion_de_otro_sitio(metodo: str, cabeceras) -> bool:
    """True si una petición que cambia datos viene de otra página (CSRF)."""
    if metodo in METODOS_SEGUROS:
        return False
    sitio = (cabeceras.get("sec-fetch-site") or "").lower()
    if sitio and sitio not in ("same-origin", "none"):
        return True
    origen = cabeceras.get("origin")
    if origen is not None:
        if origen == "null":
            return True
        host = (cabeceras.get("host") or "").rsplit(":", 1)[0].strip("[]").lower()
        if (urlsplit(origen).hostname or "").lower() != host:
            return True
    return False


def verificar_csrf(request: Request) -> None:
    if peticion_de_otro_sitio(request.method, request.headers):
        raise SolicitudNoPermitida()


def es_ruta_publica(ruta: str) -> bool:
    return ruta == "/api/sesion" or ruta == "/api/salud" or ruta.startswith("/api/paciente/")


def seguridad_de(request: Request) -> Seguridad:
    return request.app.state.seguridad


def requiere_medico(request: Request) -> Sesion:
    """Toda ruta del médico pasa por aquí: sin sesión válida, 401; sin la cabecera anti-CSRF, 403."""
    sesion = seguridad_de(request).validar(request.cookies.get(COOKIE_SESION))
    if sesion is None:
        raise SesionRequerida()
    verificar_csrf(request)
    return sesion
