@echo off
set "BUNDLE=C:\Users\Sinqy\Documents\tarkov-tracker\target\debug\_internal"
set "DIST=C:\Users\Sinqy\Documents\tarkov-tracker\tarkov-price-overlay-dev\tarkov-price-overlay\dist\tarkov-server"
taskkill /F /IM tarkov-server.exe /T >nul 2>&1
taskkill /F /IM tarkov-tracker.exe /T >nul 2>&1
if exist "%BUNDLE%\_internal" rmdir /s /q "%BUNDLE%\_internal"
copy /Y "%DIST%\tarkov-server.exe" "%BUNDLE%\tarkov-server.exe" >nul
xcopy /E /I /Y "%DIST%\_internal" "%BUNDLE%\_internal" >nul
echo CLEAN_DEPLOY_DONE
dir /b "%BUNDLE%\_internal" | findstr /I /C:python /C:base_library
exit /b 0
