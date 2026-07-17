@echo off
REM KurwaAI quick spin-up: local proxy + ngrok tunnel, then prints the env URLs.
REM Run this as a normal user (ngrok authtoken already configured).
setlocal

set "ROOT=%~dp0"
set "LOGDIR=%TEMP%\opencode"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM where ngrok lives (winget install)
set "NGROK=%LOCALAPPDATA%\Microsoft\WinGet\Packages\Ngrok.Ngrok_Microsoft.WinGet.Source_8wekyb3d8bbwe\ngrok.exe"
if not exist "%NGROK%" set "NGROK=ngrok.exe"

echo [*] Killing any old ngrok/proxy...
taskkill /F /IM ngrok.exe >nul 2>&1

echo [*] Starting local proxy (port 9000 -^> /ollama:11434, /comfy:8188)...
start "kurwa-proxy" node %ROOT%local-proxy.js
timeout /t 2 >nul

echo [*] Starting ngrok tunnel to 9000...
start "kurwa-ngrok" "%NGROK%" http 9000
timeout /t 6 >nul

REM pull the public url from the ngrok local api
set "PUB="
for /f "tokens=*" %%u in ('powershell -NoProfile -Command "(Invoke-RestMethod http://127.0.0.1:4040/api/tunnels).tunnels[0].public_url"') do set "PUB=%%u"

if "%PUB%"=="" (
  echo [!] Could not read ngrok URL. Check %LOGDIR%\ngrok-proxy.log
  echo     Is ngrok authenticated? Run: ngrok config add-authtoken YOUR_TOKEN
  goto :end
)

echo.
echo ============================================================
echo  KurwaAI tunnels are LIVE
echo ============================================================
echo  Public host : %PUB%
echo.
echo  Paste these into Netlify env vars (then redeploy):
echo.
echo    OLLAMA_URL = %PUB%/ollama
echo    COMFY_URL  = %PUB%/comfy
echo.
echo  Deployment : https://app.netlify.com/projects/kurwaai-web/configuration/env
echo ============================================================
echo.
echo  This window can stay closed; the proxy and ngrok run in the background.
echo  To stop everything later, run: taskkill /F /IM ngrok.exe
echo.

:end
pause
