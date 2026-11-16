@echo off
chcp 65001 >nul
title سامانه انبارگردانی هفت - سرورها

:menu
cls
echo ==================================================
echo   سامانه انبارگردانی فروشگاههای هفت
echo ==================================================
echo.
echo   1) اجرای سرورها (کاربر + مدیریت)
echo   2) نمایش وضعیت سرورها
echo   3) توقف سرورها
echo   4) باز کردن پنلها در مرورگر
echo   5) خروج
echo.
choice /C 12345 /N /M "انتخاب کنید: "

if errorlevel 5 exit /b
if errorlevel 4 goto openpanels
if errorlevel 3 goto stopservers
if errorlevel 2 goto showstatus
if errorlevel 1 goto startservers

:startservers
cls
echo در حال بررسی وابستگیها...
call npm install
echo.
netstat -ano | findstr ":3000 " >nul
if %errorlevel%==0 (echo سرور کاربر قبلاً در حال اجراست.) else (
  echo در حال اجرای پنل کاربر^(پورت 3000^)...
  start "User Panel - Port 3000" node server.js
)
netstat -ano | findstr ":3001 " >nul
if %errorlevel%==0 (echo سرور مدیریت قبلاً در حال اجراست.) else (
  echo در حال اجرای پنل مدیریت^(پورت 3001^)...
  start "Admin Panel - Port 3001" node admin-server.js
)
echo.
echo لطفاً ۲۰ ثانیه صبر کنید تا فایل مادر در حافظه بارگذاری شود.
echo سپس گزینه 2 را برای مشاهده وضعیت انتخاب کنید.
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
echo در حال توقف سرورها...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort 3000,3001 -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }"
echo سرورها متوقف شدند.
echo.
pause
goto menu

:openpanels
start http://localhost:3000
start http://localhost:3001
echo پنلها در مرورگر باز شدند.
echo.
pause
goto menu
