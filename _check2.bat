@echo off
set "EXE=C:\Users\Sinqy\Documents\tarkov-tracker\target\debug\tarkov-tracker.exe"
findstr /M "overlay-raw" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: overlay-raw) else (echo FOUND: overlay-raw)
findstr /M "lastSeq" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: lastSeq) else (echo FOUND: lastSeq)
findstr /M "seq" "%EXE%" >nul 2>&1
if errorlevel 1 (echo NOT_FOUND: seq) else (echo FOUND: seq)
exit /b 0
