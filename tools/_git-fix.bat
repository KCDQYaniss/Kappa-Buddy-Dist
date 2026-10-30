@echo off
"C:\Program Files\Git\bin\git.exe" add -A
"C:\Program Files\Git\bin\git.exe" commit -q -m "chore: remove temp build scripts"
"C:\Program Files\Git\bin\git.exe" rebase --continue
echo DONE_EXIT=%ERRORLEVEL%
