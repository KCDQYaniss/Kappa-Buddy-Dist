@echo off
set "EXE=C:\Users\Sinqy\Documents\tarkov-tracker\target\debug\tarkov-tracker.exe"
findstr /M "get_overlay_data" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: get_overlay_data) else (echo FOUND: get_overlay_data)
findstr /M "setInterval" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: setInterval) else (echo FOUND: setInterval)
findstr /M "poll" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: poll) else (echo FOUND: poll)
exit /b 0
