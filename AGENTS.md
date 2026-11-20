# Instrucciones para asistentes de IA

Este archivo lo leen automáticamente los asistentes de programación (Codex, Cursor, Copilot, Claude Code, etc.).

## Si te piden instalar, ejecutar o "dejar funcionando" este proyecto

Sigue **[INSTALAR_CON_IA.md](INSTALAR_CON_IA.md)** paso a paso. Resumen de sus reglas:

- Nunca muestres ni repitas las llaves de API ni `MEDICO_CLAVE`; la persona las escribe en `.env`.
- Nunca desactives la verificación TLS/SSL (un `CERTIFICATE_VERIFY_FAILED` suele ser el antivirus).
- No cambies el código para esquivar errores sin preguntar; no borres datos (`reset`, `down -v`) sin permiso.
- No hagas commit ni push; `.env` nunca va a git.
- Solo datos ficticios de pacientes.

## Si te piden modificar el código

- Mapa: `backend/app` (FastAPI: `api/rutas.py`, `servicios.py`, `seguridad.py`, `ia/`, `clinica/`),
  `frontend/src` (React + TypeScript), `puerta/nginx.conf` (lo único que sale a internet), `docs/decisiones.md`.
- Pruebas: `.\run.ps1 test` (Windows) o `./run.sh test` (Mac / Linux), dentro de Docker, sin red ni llaves.
  Seguridad: `backend/tests/integration/test_seguridad.py`. No las debilites para que pasen.
- Toda ruta nueva del médico va en `router` (exige sesión); solo lo que debe abrirse sin sesión va en `publico`.
- La IA nunca diagnostica: el médico revisa (paso 5) y aprueba (paso 8). No quites esas confirmaciones.
