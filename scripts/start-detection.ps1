$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$service = Join-Path $root 'detection-service'
Set-Location $service
if (-not (Test-Path '.venv\Scripts\python.exe')) { py -3 -m venv .venv }
& '.venv\Scripts\python.exe' -m pip install -r requirements.txt
& '.venv\Scripts\python.exe' -m uvicorn app.main:app --host 0.0.0.0 --port 8000
