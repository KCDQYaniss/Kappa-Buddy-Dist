@echo off
python -m pip install --dry-run --no-deps torch > "%TEMP%\torchdry.txt" 2>&1
type "%TEMP%\torchdry.txt" | findstr /I "Would ERROR No matching Downloading"
exit /b 0
