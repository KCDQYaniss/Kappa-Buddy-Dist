@echo off
setlocal
set "DL=%TEMP%\python-3.12.10-amd64.exe"
if not exist "%DL%" (
  echo Downloading Python 3.12.10...
  powershell -NoProfile -Command "Invoke-WebRequest -Uri 'https://www.python.org/ftp/python/3.12.10/python-3.12.10-amd64.exe' -OutFile '%DL%'"
  if errorlevel 1 (echo DOWNLOAD_FAILED & exit /b 1)
)
echo Installing Python 3.12.10 (per-user)...
"%DL%" /quiet InstallAllUsers=0 PrependPath=0 Include_test=0 Include_launcher=1
echo INSTALL_EXIT=%ERRORLEVEL%
py -0p
exit /b 0
