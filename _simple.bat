@echo off
taskkill /F /IM tarkov-tracker.exe /T 2>nul
taskkill /F /IM tarkov-server.exe /T 2>nul
cd /d "C:\Users\Sinqy\Documents\tarkov-tracker\src-tauri"
cargo build 2>&1
echo BUILD_DONE
