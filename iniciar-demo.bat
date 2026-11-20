@echo off
REM Doble clic: levanta la aplicacion con la IA SIMULADA (no requiere llave de API).
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" demo
echo.
pause
