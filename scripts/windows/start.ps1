<#
  Starts Duplex Designer for this PC and everyone on your home Wi-Fi.
  Run:   powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1
  (Task Scheduler / NSSM: see docs\HOSTING_WINDOWS.md)
#>
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

# Settings from .env (defaults match .env.example).
$port = 8080; $ollamaUrl = 'http://127.0.0.1:11434'
if (Test-Path .env) {
  Get-Content .env | ForEach-Object {
    if ($_ -match '^\s*PORT\s*=\s*(\d+)') { $port = [int]$Matches[1] }
    if ($_ -match '^\s*OLLAMA_URL\s*=\s*(\S+)') { $ollamaUrl = $Matches[1].Trim('"', "'") }
  }
}

if (-not (Test-Path dist\index.html)) {
  Write-Host 'The app is not built yet - run scripts\windows\setup.ps1 first.' -ForegroundColor Red
  exit 1
}

# Ollama runs in the background after installation; start it if it is not answering.
function Test-Ollama { try { Invoke-RestMethod -Uri "$ollamaUrl/api/tags" -TimeoutSec 2 | Out-Null; $true } catch { $false } }
if (-not (Test-Ollama)) {
  Write-Host 'Ollama is not answering - starting it...' -ForegroundColor Yellow
  $exe = Get-Command ollama -ErrorAction SilentlyContinue
  if ($exe) { Start-Process -WindowStyle Hidden -FilePath $exe.Source -ArgumentList 'serve' }
  for ($i = 0; $i -lt 15 -and -not (Test-Ollama); $i++) { Start-Sleep -Seconds 1 }
}
if (Test-Ollama) { Write-Host 'Ollama is running.' -ForegroundColor Green }
else { Write-Host 'Ollama is not running. The app still works; AI design uses its built-in offline generator.' -ForegroundColor Yellow }

# Friendly LAN address(es) for phones and tablets.
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' -and $_.PrefixOrigin -ne 'WellKnown' } |
  Select-Object -ExpandProperty IPAddress
Write-Host "`nDuplex Designer"
Write-Host "  On this PC:        http://localhost:$port"
foreach ($ip in $ips) { Write-Host "  From your phone:   http://${ip}:$port   (same Wi-Fi)" -ForegroundColor Green }
Write-Host "`nPress Ctrl+C to stop.`n"

npx tsx server/index.ts
