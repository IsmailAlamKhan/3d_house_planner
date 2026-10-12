<# Backs up the shared projects database from the running app container into .\backups\app-<timestamp>.db
   (SQLite's online backup API inside the container - never a raw copy of a live database).
   powershell -ExecutionPolicy Bypass -File scripts\backup.ps1 [-Folder backups] #>
param([string]$Folder = 'backups')
$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
New-Item -ItemType Directory -Force -Path $Folder | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$remote = "/tmp/backup-$stamp.db"
docker compose exec -T app node cli.mjs backup $remote
if ($LASTEXITCODE -ne 0) { throw 'Backup failed - is the app container running? (docker compose up -d)' }
docker compose cp "app:$remote" "$Folder\app-$stamp.db"
docker compose exec -T app rm -f $remote
Write-Host "Saved $Folder\app-$stamp.db"
