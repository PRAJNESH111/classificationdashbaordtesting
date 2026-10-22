$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location (Join-Path $root 'BoxFolding\backend')
dotnet run --no-launch-profile
