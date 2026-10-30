git -C "C:\Users\Sinqy\Documents\tarkov-tracker" add -A
git -C "C:\Users\Sinqy\Documents\tarkov-tracker" commit --amend --no-edit --quiet
git -C "C:\Users\Sinqy\Documents\tarkov-tracker" push --force-with-lease 2>&1
if ($LASTEXITCODE -ne 0) {
  Write-Host "PUSH_FAILED"
  exit 1
}
Write-Host "PUSH_OK"
