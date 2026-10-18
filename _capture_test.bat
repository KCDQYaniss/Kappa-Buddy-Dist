@echo off
curl -s -m 60 -X POST http://127.0.0.1:8765/lookup -H "Content-Type: application/json" -d "{\"x\":975,\"y\":455,\"width\":360,\"height\":100,\"lang\":\"en\",\"game_mode\":\"regular\",\"mirror_x\":585,\"cursor_x\":960,\"cursor_y\":540,\"ground_x\":880,\"ground_y\":570,\"ground_width\":160,\"ground_height\":30,\"client_seq\":1}" > "%TEMP%\lookup_test.json" 2>&1
powershell -NoProfile -Command "$j = Get-Content \"%TEMP%\lookup_test.json\" -Raw | ConvertFrom-Json; Write-Output ('raw_text=' + $j.raw_text); Write-Output ('item=' + $j.item_name); Write-Output ('attempt=' + $j.attempt)"
exit /b 0
