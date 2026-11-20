@echo off
REM Doble clic: corre las pruebas automaticas (backend y frontend) dentro de Docker.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" test
echo.
pause
