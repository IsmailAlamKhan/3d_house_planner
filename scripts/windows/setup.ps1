<#
  Duplex Designer - one-time setup on Windows.
  Checks Node.js and Ollama, installs and builds the app, downloads the AI model, creates .env.
  Run from the project folder:   powershell -ExecutionPolicy Bypass -File scripts\windows\setup.ps1
#>
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..\..')

function Fail($msg) { Write-Host "`n[!] $msg" -ForegroundColor Red; exit 1 }
function Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }

Step 'Checking Node.js (version 22 or newer)'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Fail 'Node.js is not installed. Install the LTS version from https://nodejs.org and run this script again.' }
$major = [int]((node --version).TrimStart('v').Split('.')[0])
if ($major -lt 22) { Fail "Node.js $(node --version) is too old. Install version 22 or newer from https://nodejs.org." }
Write-Host "Node.js $(node --version) - OK"

Step 'Checking Ollama'
$ollama = Get-Command ollama -ErrorAction SilentlyContinue
if (-not $ollama) { Fail 'Ollama is not installed. Install it from https://ollama.com/download/windows, start it once, and run this script again.' }
Write-Host "$(ollama --version) - OK"

Step 'Creating .env (if it does not exist yet)'
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host 'Created .env from .env.example. Open it in Notepad to change the port, model or set APP_PASSWORD.'
} else { Write-Host '.env already exists - keeping it.' }

# Read the model from .env (default qwen3:14b).
$model = 'qwen3:14b'
Get-Content .env | ForEach-Object { if ($_ -match '^\s*OLLAMA_MODEL\s*=\s*(\S+)') { $model = $Matches[1].Trim('"', "'") } }

Step 'Installing dependencies'
npm install
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed. If the error mentions node-gyp / Visual Studio: better-sqlite3 has to be compiled on Windows. Install Python 3 and the Visual Studio Build Tools workload "Desktop development with C++" (see docsHOSTING_WINDOWS.md, Option B), or use Docker instead.' }

Step 'Building the app'
npm run build
if ($LASTEXITCODE -ne 0) { Fail 'The build failed.' }

Step "Downloading the AI model '$model' (several GB the first time; it is stored on this PC)"
ollama pull $model
if ($LASTEXITCODE -ne 0) { Fail "Could not download '$model'. Is Ollama running? Open the Ollama app and try again." }

Write-Host "`nAll set. Start the app with:  powershell -ExecutionPolicy Bypass -File scripts\windows\start.ps1" -ForegroundColor Green
