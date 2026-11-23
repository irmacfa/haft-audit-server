@echo off
title Haft Audit Server
cd /d "%~dp0"

if not exist "node_modules" (
  echo Installing dependencies...
  call npm install --no-audit --no-fund
  echo.
)

node start.js
if errorlevel 1 (
  echo.
  echo Server could not be started. Check the message above.
  timeout /t 5 >nul
)
