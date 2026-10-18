@echo off
taskkill /F /IM tarkov-tracker.exe /T 2>nul
taskkill /F /IM tarkov-server.exe /T 2>nul
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker\src-tauri"
cargo build 2>&1 | findstr /R /C:"error" /C:"Finished"
echo BUILD_EXIT=%ERRORLEVEL%
start "" "target\debug\tarkov-tracker.exe" > "C:\Users\Sinqy\AppData\Local\Temp\opencode\tt_log.txt" 2>&1
echo LAUNCHED
