@echo off
taskkill /F /IM tarkov-tracker.exe /T >nul 2>&1
taskkill /F /IM tarkov-server.exe /T >nul 2>&1
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker\src-tauri"
cargo build 2>&1 | findstr /C:"error" /C:"Finished"
echo BUILD_EXIT=%ERRORLEVEL%
exit /b 0
