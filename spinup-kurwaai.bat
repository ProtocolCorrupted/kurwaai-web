@echo off
REM ============================================================
REM  KurwaAI full-app spin-up
REM  Runs the WHOLE app locally (local-dev.js on :8888) and
REM  exposes it via ngrok. Browser -> ngrok -> your PC -> Ollama.
REM  This bypasses the flaky Netlify->ngrok egress entirely, so
REM  remote friends get reliable chat with shared accounts.
REM
REM  Requires: node, Ollama running on :11434, ngrok authed,
REM            and a .env file next to this script.
REM ============================================================
setlocal

set "ROOT=%~dp0"
set "LOGDIR=%TEMP%\opencode"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM where ngrok lives (winget install), fallback to PATH
set "NGROK=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.WinGet.Source_8wekyb3d8bbwe\ngrok.exe"
if not exist "%NGROK%" set "NGROK=ngrok.exe"

if not exist "%ROOT%.env" (
  echo [!] Missing .env next to this script. Aborting.
  goto :end
)

echo [*] Stopping any old ngrok / node app...
taskkill /F /IM ngrok.exe >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /R /C:":8888 .*LISTENING"') do taskkill /F /PID %%p >nul 2>&1

echo [*] Checking Ollama on :11434...
powershell -NoProfile -Command "try{ if((Invoke-WebRequest http://localhost:11434/api/tags -UseBasicParsing -TimeoutSec 4).StatusCode -eq 200){ exit 0 } }catch{}; exit 1"
if errorlevel 1 (
  echo [!] Ollama is not responding on :11434. Start Ollama first, then re-run.
  goto :end
)

echo [*] Pre-warming gemma3:4b (keep_alive -1)...
powershell -NoProfile -Command "try{ Invoke-RestMethod -Uri http://localhost:11434/api/generate -Method Post -TimeoutSec 60 -ContentType 'application/json' -Body '{\"model\":\"gemma3:4b\",\"prompt\":\"hi\",\"stream\":false,\"keep_alive\":-1}' | Out-Null }catch{}"

echo [*] Starting local proxy (:9000 -^> /ollama:11434, /comfy:8188)...
start "kurwa-proxy" /min node "%ROOT%local-proxy.js"
timeout /t 2 >nul

echo [*] Starting full app (local-dev.js on :8888)...
start "kurwa-app" /min node "%ROOT%local-dev.js"
timeout /t 3 >nul

echo [*] Verifying app is up...
powershell -NoProfile -Command "try{ if((Invoke-WebRequest http://127.0.0.1:8888/ -UseBasicParsing -TimeoutSec 6).StatusCode -eq 200){ exit 0 } }catch{}; exit 1"
if errorlevel 1 (
  echo [!] App did not start on :8888. Check for errors: node local-dev.js
  goto :end
)

echo [*] Starting ngrok tunnel to :8888 (the full app)...
start "kurwa-ngrok" /min "%NGROK%" http 8888
timeout /t 6 >nul

REM pull the public url from the ngrok local api
set "PUB="
for /f "tokens=*" %%u in ('powershell -NoProfile -Command "(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels[0].public_url"') do set "PUB=%%u"

if "%PUB%"=="" (
  echo [!] Could not read ngrok URL.
  echo     Is ngrok authenticated? Run: ngrok config add-authtoken YOUR_TOKEN
  goto :end
)

echo.
echo ============================================================
echo   KurwaAI is LIVE (full app, reliable chat)
echo ============================================================
echo.
echo   Share this URL with users:
echo.
echo       %PUB%
echo.
echo   Accounts are shared with the Netlify site (same Blobs).
echo   Chat runs on THIS PC via Ollama - no Netlify egress needed.
echo.
echo   Keep this PC on and this app running for chat to work.
echo   To stop everything: taskkill /F /IM ngrok.exe ^&^& taskkill /F /IM node.exe
echo.
echo   NOTE: ngrok free shows a one-time "Visit Site" warning page on
echo   first visit per browser. Tell friends to click "Visit Site" once.
echo ============================================================
echo.

:end
pause
