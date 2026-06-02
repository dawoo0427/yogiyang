@echo off
chcp 65001 >nul
title 여기양 서버
cd /d "C:\Users\user\event-location"
echo ============================================
echo   여기양 서버를 시작합니다...
echo   (이 창을 닫으면 서버가 종료됩니다)
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [오류] Node.js가 설치되어 있지 않습니다.
  echo        https://nodejs.org 에서 LTS 버전을 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b
)

if not exist node_modules (
  echo 최초 실행입니다. 의존성을 설치합니다...
  call npm install
  echo.
)

echo 서버 주소: http://localhost:3000
echo 다음으로 "여기양 주소 발급" 아이콘을 실행해 외부 주소를 받으세요.
echo.
call npm start

echo.
echo 서버가 종료되었습니다.
pause
