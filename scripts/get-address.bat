@echo off
chcp 65001 >nul
title 여기양 주소 발급 (HTTPS)
echo ============================================
echo   외부 접속용 HTTPS 주소를 발급합니다.
echo   먼저 "여기양 서버 실행"이 켜져 있어야 합니다!
echo   (이 창을 닫으면 발급된 주소도 닫힙니다)
echo ============================================
echo.

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo cloudflared 가 없어 설치를 시도합니다...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [오류] cloudflared 설치에 실패했습니다.
  echo        https://github.com/cloudflare/cloudflared/releases 에서
  echo        cloudflared-windows-amd64.exe 를 직접 받아 설치하세요.
  echo.
  pause
  exit /b
)

echo.
echo 잠시 후 아래에 표시되는
echo    https://xxxxx.trycloudflare.com
echo 주소를 호스트/시청자에게 공유하세요.
echo.
cloudflared tunnel --url http://localhost:3000

echo.
echo 터널이 종료되었습니다.
pause
