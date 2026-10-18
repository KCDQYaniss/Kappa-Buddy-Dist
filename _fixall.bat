@echo off
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker"
echo === KILLING PROCESSES ===
taskkill /F /IM tarkov-tracker.exe /T 2>nul
taskkill /F /IM tarkov-server.exe /T 2>nul
echo === SLEEP 2s ===
timeout /t 2 /nobreak >nul
echo === DELETING TARGET ===
if exist "target" rmdir /s /q "target"
echo === SLEEP 2s ===
timeout /t 2 /nobreak >nul
echo === BUILD ===
cd src-tauri
cargo build 2>&1
if errorlevel 1 echo BUILD_ERROR
if not errorlevel 1 echo BUILD_OK
cd ..
echo === LAUNCHING ===
start "" /D "C:\Users\Sinqy\Documents\tarkov-tracker\src-tauri" "target\debug\tarkov-tracker.exe"
echo LAUNCHED
exit /b 0
