@echo off
REM Doble clic para levantar la aplicacion (Windows). Equivale a: .\run.ps1 %*
REM   iniciar.bat          -> con el proveedor configurado en .env
REM   iniciar.bat demo     -> con la IA simulada (sin llaves)
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run.ps1" %*
echo.
pause
