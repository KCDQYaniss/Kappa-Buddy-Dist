@echo off
git add -A
git commit -q -m "fix: remove unused Verifier import"
git push
echo PUSH_EXIT=%ERRORLEVEL%
