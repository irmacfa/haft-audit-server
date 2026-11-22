@echo off
title Haft Audit Server
:menu
cls
echo ==================================================
echo   HAFT AUDIT SYSTEM - SERVER CONTROL
echo ==================================================
echo.
echo   1) Start servers (user + admin)
echo   2) Show server status
echo   3) Stop servers
echo   4) Open panels in browser
echo   5) Exit
echo.
choice /C 12345 /N /M "Select: "
if errorlevel 5 exit /b
if errorlevel 4 goto openpanels
if errorlevel 3 goto stopservers
if errorlevel 2 goto showstatus
if errorlevel 1 goto startservers

:startservers
cls
echo Checking dependencies...
call npm install
echo.
netstat -ano | findstr "LISTENING" | findstr ":2030 " >nul
if %errorlevel%==0 (echo User panel already running on port 2030) else (
  echo Starting USER panel on port 2030...
  start "User Panel - Port 2030" node server.js
)
netstat -ano | findstr "LISTENING" | findstr ":2031 " >nul
if %errorlevel%==0 (echo Admin panel already running on port 2031) else (
  echo Starting ADMIN panel on port 2031...
  start "Admin Panel - Port 2031" node admin-server.js
)
echo.
echo Wait about 20 seconds for the 21MB master Excel to load into memory.
echo Then choose option 2 to check status.
echo.
pause
goto menu

:showstatus
cls
node status.js
echo.
pause
goto menu

:stopservers
cls
echo Stopping servers...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 2030,2031 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo Servers stopped.
echo.
pause
goto menu

:openpanels
start http://%COMPUTERNAME%:2030
start http://%COMPUTERNAME%:2031
echo Panels opened in browser.
echo.
pause
goto menu
