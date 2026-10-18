@echo off
taskkill /F /IM tarkov-tracker.exe /T 2>nul
taskkill /F /IM tarkov-server.exe /T 2>nul
timeout /t 2 /nobreak >nul
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker\src-tauri"
start "" "target\debug\tarkov-tracker.exe" > "C:\Users\Sinqy\AppData\Local\Temp\opencode\tt_log.txt" 2>&1
echo LAUNCHED
