@echo off
set "EXE=C:\Users\Sinqy\Documents\tarkov-tracker\target\debug\tarkov-tracker.exe"
findstr /M "cursor-overlay" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: cursor-overlay) else (echo FOUND: cursor-overlay)
findstr /M "overlay-flea" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: overlay-flea) else (echo FOUND: overlay-flea)
findstr /M "hideTimer" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: hideTimer) else (echo FOUND: hideTimer)
findstr /M "set_overlay_size" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: set_overlay_size) else (echo FOUND: set_overlay_size)
exit /b 0
