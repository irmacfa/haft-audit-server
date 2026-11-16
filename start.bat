@echo off
echo Checking dependencies...
call npm install
echo Starting user panel on port 3000...
start "User Panel - Port 3000" node server.js
echo Starting admin panel on port 3001...
start "Admin Panel - Port 3001" node admin-server.js
echo Waiting for servers to initialize...
timeout /t 5
echo Opening both panels...
start http://localhost:3000
start http://localhost:3001
echo.
echo User panel:  http://localhost:3000
echo Admin panel: http://localhost:3001
echo.
pause