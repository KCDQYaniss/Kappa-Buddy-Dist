@echo off
taskkill /F /IM tarkov-tracker.exe /T 2>nul
timeout /t 2 >nul
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker\"
start "" "target\debug\tarkov-tracker.exe"
echo LAUNCHED