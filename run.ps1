# Oftalmología + IA — arranque en Windows PowerShell (equivalente a run.sh).
#   .\run.ps1            levanta todo      .\run.ps1 test     pruebas
#   .\run.ps1 demo       levanta todo con la IA simulada (LLM_PROVIDER=mock, sin llaves)
#   .\run.ps1 eval       evaluación        .\run.ps1 eval mock
#   .\run.ps1 logs | stop | reset
# Si PowerShell bloquea el script:  powershell -ExecutionPolicy Bypass -File .\run.ps1
param([string]$Accion = "up", [string]$Opcion = "")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Falla($m) { Write-Host "X $m" -ForegroundColor Red; exit 1 }
function Valor($clave) {
  $linea = Get-Content .env -ErrorAction SilentlyContinue | Where-Object { $_ -match "^$clave=" } | Select-Object -Last 1
  if ($linea) { return ($linea -split "=", 2)[1].Trim().Trim('"') } else { return "" }
}

# Dirección IPv4 de este PC en la red (Wi-Fi o cable): la usa el código QR para que el celular del paciente
# abra su explicación. Ignora las redes virtuales (Docker, WSL), que no tienen puerta de enlace.
function IpDeLaRed {
  try {
    $c = Get-NetIPConfiguration -ErrorAction Stop |
      Where-Object { $_.IPv4DefaultGateway -and $_.NetAdapter.Status -eq "Up" } | Select-Object -First 1
    if ($c) { return ($c.IPv4Address | Select-Object -First 1).IPAddress }
  } catch { }
  return ""
}

# Dirección pública fija de Tailscale Funnel (https://<pc>.<red>.ts.net) si está instalado y Funnel está activo.
# Con ella el código QR abre desde cualquier red. Se activa una sola vez con:  tailscale funnel --bg 8090
function TailscaleExe {
  $c = Get-Command tailscale -ErrorAction SilentlyContinue
  if ($c) { return $c.Source }
  $p = Join-Path $env:ProgramFiles "Tailscale\tailscale.exe"
  if (Test-Path $p) { return $p }
  return ""
}
function DireccionTailscale {
  $ts = TailscaleExe
  if (-not $ts) { return "" }
  try {
    $estado = (& $ts status --json 2>$null | Out-String) | ConvertFrom-Json
    $nombre = "$($estado.Self.DNSName)".TrimEnd(".")
    if (-not $nombre) { return "" }
    $texto = (& $ts funnel status --json 2>$null | Out-String)
    $abierto = $false
    try {
      $cfg = $texto | ConvertFrom-Json
      if ($cfg.AllowFunnel) {
        foreach ($p in $cfg.AllowFunnel.PSObject.Properties) { if ($p.Value -and $p.Name -like "$nombre*") { $abierto = $true } }
      }
    } catch { $abierto = ($texto -match [regex]::Escape($nombre)) -and ($texto -match "(?i)funnel") }
    if ($abierto) { return "https://$nombre" }
  } catch { }
  return ""
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Falla "Docker no está instalado (instale Docker Desktop)." }
docker info *> $null; if ($LASTEXITCODE -ne 0) { Falla "Docker Desktop no está corriendo. Ábralo y reintente." }
if (-not (Test-Path .env)) { Copy-Item .env.example .env; Write-Host "! Se creó .env a partir de .env.example" -ForegroundColor Yellow }

if ($Accion -eq "demo") {
  # Modo demo: fija LLM_PROVIDER=mock en .env (no toca las llaves) y levanta normalmente.
  (Get-Content .env) -replace '^LLM_PROVIDER=.*$', 'LLM_PROVIDER=mock' | Set-Content .env -Encoding ascii
  Write-Host "! Modo demo: IA simulada por reglas (LLM_PROVIDER=mock). Para la IA real edite .env." -ForegroundColor Yellow
  $Accion = "up"
}

switch ($Accion) {
  "up" {
    $p = Valor "LLM_PROVIDER"; if (-not $p) { $p = "groq" }
    if ($p -ne "mock" -and -not (Valor "$($p.ToUpper())_API_KEY")) {
      Write-Host "! Falta $($p.ToUpper())_API_KEY en .env: la IA responderá 'falta la llave' (o use LLM_PROVIDER=mock)." -ForegroundColor Yellow
    }
    # Contraseña del médico: si .env no tiene la línea, se agrega vacía para que el usuario sepa dónde escribirla.
    if (-not (Get-Content .env -ErrorAction SilentlyContinue | Where-Object { $_ -match "^MEDICO_CLAVE=" })) {
      Add-Content .env -Encoding ascii -Value "`r`n# Acceso del medico (minimo 10 caracteres). Escriba su contrasena despues del =`r`nMEDICO_USUARIO=medico`r`nMEDICO_CLAVE="
    }
    if ((Valor "MEDICO_CLAVE").Length -lt 10) {
      Write-Host "! Falta la contraseña del médico: abra .env, escriba MEDICO_CLAVE=<su contraseña> (mínimo 10 caracteres) y vuelva a ejecutar iniciar.bat. Sin ella nadie puede entrar." -ForegroundColor Yellow
    }
    $web = Valor "PUERTO_WEB"; if (-not $web) { $web = "8080" }
    # Código QR del paciente. Orden: URL_PUBLICA en .env > Tailscale Funnel (cualquier red) > IP del Wi-Fi.
    $modoQR = "env"
    if (-not (Valor "URL_PUBLICA")) {
      $publica = DireccionTailscale
      if ($publica) { $env:URL_PUBLICA = $publica; $modoQR = "internet" }
      else {
        $ip = IpDeLaRed
        if ($ip) { $env:URL_PUBLICA = "http://${ip}:$web"; $modoQR = "wifi" }
        else { $modoQR = "local"; Write-Host "! No se encontró la IP de este PC en la red: el código QR solo abrirá en este computador." -ForegroundColor Yellow }
      }
    }
    docker compose up --build -d; if ($LASTEXITCODE -ne 0) { Falla "docker compose falló." }
    Write-Host "Esperando a la API..."
    for ($i = 0; $i -lt 90; $i++) {
      docker compose exec -T backend python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/salud', timeout=3)" *> $null
      if ($LASTEXITCODE -eq 0) { break }; Start-Sleep 2
    }
    Write-Host "OK Web: http://localhost:$web   API: http://localhost:8000/docs" -ForegroundColor Green
    $qr = Valor "URL_PUBLICA"; if (-not $qr) { $qr = $env:URL_PUBLICA }
    if ($modoQR -eq "internet") {
      Write-Host "   Código QR: abre desde CUALQUIER red -> $qr (Tailscale; solo se ve la página del paciente)" -ForegroundColor Green
    } elseif ($modoQR -eq "env") {
      Write-Host "   Código QR -> $qr (fijada en .env con URL_PUBLICA)" -ForegroundColor Green
    } elseif ($qr) {
      Write-Host "   Código QR: solo abre en el mismo Wi-Fi -> $qr" -ForegroundColor Green
      if ($modoQR -eq "wifi" -and (TailscaleExe)) {
        Write-Host "   Para que abra desde cualquier red, ejecute una vez:  tailscale funnel --bg 8090   y vuelva a abrir la app." -ForegroundColor Yellow
      }
    }
  }
  "test" { docker compose build backend; docker compose run --rm --no-deps backend pytest -v; docker compose build frontend }
  "eval" {
    docker compose build backend
    $extra = @(); if ($Opcion -eq "mock") { $extra = @("--proveedor", "mock") }
    docker compose run --rm --no-deps -v "${PWD}/eval:/eval" backend python /eval/run_eval.py @extra
  }
  "logs"  { docker compose logs -f backend }
  "stop"  { docker compose down }
  "reset" { docker compose down -v }
  default { Falla "Acción desconocida: $Accion" }
}
