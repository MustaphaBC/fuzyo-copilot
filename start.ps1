# Fuzyo Copilot - launch backend + frontend (Windows)
# Usage (from repo root):
#   .\start.ps1
#   powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$BackendPort = 8000
$FrontendPort = 5173
$FuzyoNodeDir = Join-Path $env:LOCALAPPDATA "fuzyo-tools\node"
$FrontendDir = Join-Path $Root "frontend"
$NpmCmd = Join-Path $FuzyoNodeDir "npm.cmd"
$NpxCmd = Join-Path $FuzyoNodeDir "npx.cmd"

# Never inherit Playwright e2e auth bypass into a normal UI session.
Remove-Item Env:\VITE_E2E_AUTH_BYPASS -ErrorAction SilentlyContinue

$PythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $PythonCmd) {
  Write-Error "Python not found on PATH. Install Python or add it to PATH."
}

if (-not (Test-Path (Join-Path $FuzyoNodeDir "node.exe"))) {
  $NodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $NodeCmd) {
    Write-Error "Node.js not found. Expected $FuzyoNodeDir\node.exe"
  }
  $FuzyoNodeDir = Split-Path -Parent $NodeCmd.Source
  $NpmCmd = Join-Path $FuzyoNodeDir "npm.cmd"
  $NpxCmd = Join-Path $FuzyoNodeDir "npx.cmd"
}

if (-not (Test-Path $NpmCmd)) {
  $npmFound = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($npmFound) { $NpmCmd = $npmFound.Source } else { Write-Error "npm.cmd not found" }
}
if (-not (Test-Path $NpxCmd)) {
  $npxFound = Get-Command npx.cmd -ErrorAction SilentlyContinue
  if ($npxFound) { $NpxCmd = $npxFound.Source } else { $NpxCmd = $null }
}

if (-not (Test-Path (Join-Path $Root "backend\.env"))) {
  Write-Warning "backend\.env missing - API keys / Supabase may fail."
}
if (-not (Test-Path (Join-Path $Root "frontend\.env"))) {
  Write-Warning "frontend\.env missing - Supabase Auth may fail."
}
if (-not (Test-Path (Join-Path $Root "frontend\node_modules"))) {
  Write-Host "Installing frontend dependencies..."
  Push-Location $FrontendDir
  try {
    & $NpmCmd install
    if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
  } finally {
    Pop-Location
  }
}

function Stop-ListenersOnPort {
  param([int]$Port)
  try {
    $pids = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -ExpandProperty OwningProcess -Unique
  } catch {
    return
  }
  foreach ($procId in $pids) {
    if (-not $procId -or $procId -eq 0) { continue }
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if (-not $proc) { continue }
      Write-Host "Stopping $($proc.ProcessName) (PID $procId) on port $Port"
      Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    } catch { }
  }
  Start-Sleep -Seconds 1
}

function Write-TempScript {
  param([string]$Path, [string]$Content)
  # UTF-8 without BOM — BOM breaks some PowerShell launches
  $utf8 = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

function Start-ServiceWindow {
  param(
    [string]$Title,
    [string]$ScriptBody
  )
  $tmp = Join-Path $env:TEMP ("fuzyo-" + [guid]::NewGuid().ToString() + ".ps1")
  $full = @"
`$ErrorActionPreference = 'Continue'
`$Host.UI.RawUI.WindowTitle = '$Title'
Write-Host '$Title - Ctrl+C to stop' -ForegroundColor Cyan
try {
$ScriptBody
} catch {
  Write-Host `$_ -ForegroundColor Red
}
Write-Host ''
Write-Host 'Process exited. Press Enter to close this window.'
Read-Host | Out-Null
"@
  Write-TempScript -Path $tmp -Content $full
  Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit -ExecutionPolicy Bypass -File `"$tmp`""
}

function Test-HttpOk {
  param([string]$Url)
  try {
    $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
    return ($r.StatusCode -ge 200 -and $r.StatusCode -lt 500)
  } catch {
    return $false
  }
}

Write-Host "Freeing ports $BackendPort / $FrontendPort if needed..."
Stop-ListenersOnPort -Port $BackendPort
Stop-ListenersOnPort -Port $FrontendPort

Write-Host "Starting backend  http://127.0.0.1:$BackendPort  (uvicorn --reload)"
$backendBody = @"
  `$env:PYTHONPATH = '$Root'
  Set-Location '$Root'
  python -m uvicorn backend.app.main:app --host 127.0.0.1 --port $BackendPort --reload
"@
Start-ServiceWindow -Title "Fuzyo backend" -ScriptBody $backendBody

Write-Host "Starting frontend http://127.0.0.1:$FrontendPort  (vite)"
# Call npx.cmd/vite with --host=... form so PowerShell does not strip flags.
if ($NpxCmd) {
  $frontendBody = @"
  `$env:Path = '$FuzyoNodeDir;' + `$env:Path
  Remove-Item Env:\VITE_E2E_AUTH_BYPASS -ErrorAction SilentlyContinue
  Set-Location '$FrontendDir'
  & '$NpxCmd' vite --host=127.0.0.1 --port=$FrontendPort
"@
} else {
  $frontendBody = @"
  `$env:Path = '$FuzyoNodeDir;' + `$env:Path
  Remove-Item Env:\VITE_E2E_AUTH_BYPASS -ErrorAction SilentlyContinue
  Set-Location '$FrontendDir'
  & '$NpmCmd' run dev -- --host=127.0.0.1 --port=$FrontendPort
"@
}
Start-ServiceWindow -Title "Fuzyo frontend" -ScriptBody $frontendBody

Write-Host ""
Write-Host "Waiting for services..."
$deadline = (Get-Date).AddSeconds(90)
$backendOk = $false
$frontendOk = $false
do {
  if (-not $backendOk) {
    if (Test-HttpOk "http://127.0.0.1:$BackendPort/health") {
      $backendOk = $true
      Write-Host "  backend  OK"
    }
  }
  if (-not $frontendOk) {
    if ((Test-HttpOk "http://127.0.0.1:$FrontendPort/") -or (Test-HttpOk "http://localhost:$FrontendPort/")) {
      $frontendOk = $true
      Write-Host "  frontend OK"
    }
  }
  if ($backendOk -and $frontendOk) { break }
  Start-Sleep -Seconds 1
} while ((Get-Date) -lt $deadline)

if (-not $backendOk) { Write-Warning "Backend not ready yet - check the 'Fuzyo backend' window." }
if (-not $frontendOk) { Write-Warning "Frontend not ready yet - check the 'Fuzyo frontend' window for errors." }

if ($frontendOk) {
  Start-Process "http://127.0.0.1:$FrontendPort/"
}

Write-Host ""
Write-Host "Fuzyo Copilot"
Write-Host "  UI:  http://127.0.0.1:$FrontendPort/"
Write-Host "  API: http://127.0.0.1:$BackendPort/health"
Write-Host "Sign in with email/password (do not use Playwright e2e bypass)."
Write-Host "Leave the two PowerShell windows open while you work."
