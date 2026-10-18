@echo off
setlocal
set "ROOT=C:\Users\Sinqy\Documents\tarkov-tracker"
set "DEV=%ROOT%\tarkov-price-overlay-dev\tarkov-price-overlay"
set "BUNDLE=%ROOT%\target\debug\_internal"
set "LOG=%TEMP%\sidecar_build.log"

echo === [1/5] Install deps === > "%LOG%"
cd /d "%DEV%"
py -3.12 -m pip install --upgrade pip >> "%LOG%" 2>&1
py -3.12 -m pip install -r python-core\requirements.txt >> "%LOG%" 2>&1
if errorlevel 1 (echo PIP_FAILED >> "%LOG%" & exit /b 1)

echo === [2/5] Install pyinstaller === >> "%LOG%"
py -3.12 -m pip install pyinstaller >> "%LOG%" 2>&1

echo === [3/5] Copy OCR models === >> "%LOG%"
if not exist "%DEV%\python-core\models\easyocr" (
  mkdir "%DEV%\python-core\models\easyocr"
  xcopy /E /I /Y "%BUNDLE%\_internal\models\easyocr" "%DEV%\python-core\models\easyocr" >> "%LOG%" 2>&1
)

echo === [4/5] PyInstaller build === >> "%LOG%"
cd /d "%DEV%"
py -3.12 -m PyInstaller --clean --noconfirm tarkov-server.spec >> "%LOG%" 2>&1
if errorlevel 1 (echo BUILD_FAILED >> "%LOG%" & exit /b 1)

echo === [5/5] Deploy to target\debug\_internal === >> "%LOG%"
taskkill /F /IM tarkov-server.exe /T >nul 2>&1
if exist "%DEV%\dist\tarkov-server\tarkov-server.exe" (
  copy /Y "%DEV%\dist\tarkov-server\tarkov-server.exe" "%BUNDLE%\tarkov-server.exe" >> "%LOG%" 2>&1
  xcopy /E /I /Y "%DEV%\dist\tarkov-server\_internal" "%BUNDLE%\_internal" >> "%LOG%" 2>&1
  echo DEPLOY_OK >> "%LOG%"
) else (
  echo DEPLOY_FAILED_NO_EXE >> "%LOG%"
  exit /b 1
)

echo SIDECAR_BUILD_DONE >> "%LOG%"
findstr /I "SIDECAR_BUILD_DONE" "%LOG%" >nul
exit /b 0
