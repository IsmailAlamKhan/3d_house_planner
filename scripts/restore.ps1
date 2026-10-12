<# Restores a backup made by backup.ps1 into the running app (it keeps running; the content is swapped in one transaction).
   powershell -ExecutionPolicy Bypass -File scripts\restore.ps1 backups\app-20260101-120000.db #>
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Test-Path $File)) { throw "No such file: $File" }
$remote = "/tmp/restore-$PID.db"
docker compose cp $File "app:$remote"
docker compose exec -T app node cli.mjs restore $remote
if ($LASTEXITCODE -ne 0) { throw 'Restore failed.' }
docker compose exec -T app rm -f $remote
Write-Host "Restored from $File. Reload the app on your devices."
