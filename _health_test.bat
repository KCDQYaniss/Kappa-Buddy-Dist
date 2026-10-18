@echo off
echo === HEALTH ===
curl -s -m 10 http://127.0.0.1:8765/health
echo.
echo === LOOKUP (override_text) ===
curl -s -m 120 -X POST http://127.0.0.1:8765/lookup -H "Content-Type: application/json" -d "{\"x\":1,\"y\":1,\"width\":10,\"height\":10,\"lang\":\"en\",\"game_mode\":\"regular\",\"override_text\":\"Bandage\"}"
echo.
exit /b 0
