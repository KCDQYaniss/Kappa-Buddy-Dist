@echo off
cd /d C:\Users\Sinqy\Documents\tarkov-tracker\tarkov-price-overlay-dev\tarkov-price-overlay
python -m pip install --dry-run -r python-core\requirements.txt > "%TEMP%\depsdry.txt" 2>&1
type "%TEMP%\depsdry.txt" | findstr /I "Would ERROR No matching Successfully"
exit /b 0
