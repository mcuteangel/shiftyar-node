@echo off
rem Shiftyar Launcher - Windows, no install, no admin required.
rem Double-click this file and pick an option from the menu.
rem Notes:
rem  - Messages are in English on purpose: the Windows console codepage
rem    garbles Persian text. See README.md (Persian) for documentation.
rem  - The server is never installed. It runs from app\ with the portable
rem    node.exe found on PATH (set it in User variables once).
rem  - Only app\ is replaced by updates. This file, update.ps1, data\
rem    and logs\ are never touched by an update. The previous app\
rem    version is kept as app_old\ for manual rollback.
rem  - The database lives in data\shiftyar.db (DB_PATH), outside app\,
rem    so updates can never wipe it. A legacy app\data\shiftyar.db is
rem    moved to data\ automatically on the first update check.
setlocal
cd /d "%~dp0"
set "APP_DIR=%~dp0app"
set "LOG_DIR=%~dp0logs"
set "DATA_FILE=%~dp0data\shiftyar.db"
set "PID_FILE=%~dp0server.pid"
set "PS1=%~dp0update.ps1"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

:menu
cls
echo ========================================
echo Shiftyar Launcher
echo ========================================
call :status
echo Server : %SRV%
echo Version: %VER%
echo.
echo 1) Start server in background (hidden)
echo 2) Start server in window (live logs)
echo 3) View logs (last 50 lines)
echo 4) Stop background server
echo 5) Exit
echo.
choice /c 12345 /n /m "Choose [1-5]: "
if errorlevel 5 goto :eof
if errorlevel 4 goto :stop
if errorlevel 3 goto :logs
if errorlevel 2 goto :startfg
if errorlevel 1 goto :startbg
goto :menu

:status
set "SRV=stopped"
set "VER=none"
set "PID="
if exist "%APP_DIR%\version.txt" set /p VER=<"%APP_DIR%\version.txt"
if not exist "%PID_FILE%" goto :statusdone
set /p PID=<"%PID_FILE%"
tasklist /FI "PID eq %PID%" /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if not errorlevel 1 set "SRV=running (PID %PID%)"
:statusdone
exit /b 0

:startbg
call :update
if not errorlevel 1 goto :bg0
pause
goto :menu
:bg0
if exist "%APP_DIR%\server\index.js" goto :bg1
echo App not found and no update available. Check your connection and try again.
pause
goto :menu
:bg1
call :status
if "%SRV%"=="stopped" goto :bg2
echo Server is already running.
pause
goto :menu
:bg2
where powershell >nul 2>&1
if not errorlevel 1 goto :bg3
echo PowerShell not found. Use option 2 instead.
pause
goto :menu
:bg3
where node >nul 2>&1
if not errorlevel 1 goto :bg4
echo node not found on PATH. Add your portable node folder to User Path first.
pause
goto :menu
:bg4
powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:DB_PATH = '%DATA_FILE%'; $p = Start-Process -FilePath 'node' -ArgumentList 'server\index.js' -WorkingDirectory '%APP_DIR%' -WindowStyle Hidden -RedirectStandardOutput '%LOG_DIR%\server.log' -RedirectStandardError '%LOG_DIR%\server.err.log' -PassThru; $p.Id | Out-File -FilePath '%PID_FILE%' -Encoding ascii"
timeout /t 2 /nobreak >nul
call :status
if not "%SRV%"=="stopped" goto :bg5
echo Failed to start. See logs\server.err.log for details.
pause
goto :menu
:bg5
echo Server started in background.
start http://localhost:3000
pause
goto :menu

:startfg
call :update
if not errorlevel 1 goto :fg0
pause
goto :menu
:fg0
if exist "%APP_DIR%\server\index.js" goto :fg1
echo App not found and no update available. Check your connection and try again.
pause
goto :menu
:fg1
call :status
if "%SRV%"=="stopped" goto :fg2
echo Server is already running in background. Stop it first with option 4.
pause
goto :menu
:fg2
cd /d "%APP_DIR%"
set "DB_PATH=%DATA_FILE%"
node server\index.js
cd /d "%~dp0"
pause
goto :menu

:update
echo Checking for updates...
if exist "%PS1%" goto :upd1
echo Updater not found, skipping update check.
exit /b 0
:upd1
set "UPD=OFFLINE"
for /f "delims=" %%S in ('powershell -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -AppDir "%APP_DIR%" -PidFile "%PID_FILE%" 2^>nul') do set "UPD=%%S"
if "%UPD%"=="DBFAIL" echo Could not move the old database file. Stop the server first and try again.
if "%UPD%"=="DBFAIL" exit /b 1
if "%UPD%"=="UPDATED" echo Updated to latest release.
if "%UPD%"=="OK" echo Already up to date.
if "%UPD%"=="OFFLINE" echo Update check skipped (offline or unavailable). Continuing with local copy.
if "%UPD%"=="NOASSET" echo Release found but no app package. Continuing with local copy.
exit /b 0

:logs
if exist "%LOG_DIR%\server.log" goto :log1
echo No logs yet.
pause
goto :menu
:log1
where powershell >nul 2>&1
if not errorlevel 1 goto :log2
echo PowerShell not found. Open logs\server.log in Notepad instead.
pause
goto :menu
:log2
powershell -NoProfile -Command "Get-Content '%LOG_DIR%\server.log' -Tail 50"
if not exist "%LOG_DIR%\server.err.log" goto :log3
set "ERRSHOW=0"
for %%F in ("%LOG_DIR%\server.err.log") do if %%~zF gtr 0 set "ERRSHOW=1"
if not "%ERRSHOW%"=="1" goto :log3
echo --- errors ---
powershell -NoProfile -Command "Get-Content '%LOG_DIR%\server.err.log' -Tail 20"
:log3
pause
goto :menu

:stop
if exist "%PID_FILE%" goto :stop1
echo No background server recorded.
pause
goto :menu
:stop1
set "PID="
set /p PID=<"%PID_FILE%"
tasklist /FI "PID eq %PID%" /FI "IMAGENAME eq node.exe" 2>nul | find /I "node.exe" >nul
if errorlevel 1 goto :stop2
taskkill /PID %PID% /F >nul 2>&1
echo Background server stopped.
goto :stop3
:stop2
echo Background server is not running (stale PID file).
:stop3
del "%PID_FILE%" >nul 2>&1
pause
goto :menu
