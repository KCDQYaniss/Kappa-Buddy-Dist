@echo off
type "%TEMP%\sidecar_build.log" > "%TEMP%\sidecar_tail.txt" 2>&1
powershell -NoProfile -Command "Get-Content '%TEMP%\sidecar_build.log' -Tail 40"
exit /b 0
