<#
.SYNOPSIS
  Build the tarkov-server sidecar (FastAPI OCR service) for Tarkov Tracker.
  Requires Python 3.12 (3.11 also works). Install from python.org first.

.EXAMPLE
  .\build-overlay-sidecar.ps1
#>
param(
  [string]$PythonExecutable = "python"
)

$ErrorActionPreference = "Stop"
$Root = "C:\Users\Sinqy\Documents\tarkov-tracker"
$OverlayDev = "$Root\tarkov-price-overlay-dev\tarkov-price-overlay"
$InternalDir = "$Root\src-tauri\_internal"

Write-Host "=== Building tarkov-server sidecar ===" -ForegroundColor Cyan
Write-Host ""

# Verify Python 3.11 or 3.12
$ver = & $PythonExecutable --version 2>&1
Write-Host "Using: $ver"
if ($ver -notmatch "3\.1[12]") {
  Write-Error "ERROR: Python 3.11 or 3.12 required. Found: $ver"
  exit 1
}

Set-Location $OverlayDev

# Install dependencies
Write-Host "Installing Python dependencies..." -ForegroundColor Yellow
& $PythonExecutable -m pip install --upgrade pip
& $PythonExecutable -m pip install -r python-core/requirements.txt
& $PythonExecutable -m pip install pyinstaller

# Build sidecar
Write-Host "Building with PyInstaller..." -ForegroundColor Yellow
& $PythonExecutable -m PyInstaller --clean --noconfirm --onefile `
  --name tarkov-server `
  --add-data "python-core;python-core" `
  python-core/main.py

# Copy to _internal
Write-Host "Copying to _internal..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InternalDir -Force | Out-Null
Copy-Item "$OverlayDev\dist\tarkov-server.exe" "$InternalDir\tarkov-server.exe" -Force

Write-Host ""
Write-Host "=== Build complete! ===" -ForegroundColor Green
Write-Host "Sidecar copied to: $InternalDir" -ForegroundColor Green