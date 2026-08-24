@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem UricAcid local temporary test console.
rem The menu stays open. The server runs in a separate persistent cmd /k window.
rem Stop uses the PID recorded by this script; it never kills all node.exe processes.

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
set "PORT=4317"
set "LOCAL_URL=http://127.0.0.1:%PORT%"
set "SERVER_TITLE=UricAcid Local Server - UricAcid"
set "PID_FILE=%PROJECT_DIR%\data\local-test-server.pid"
set "CLI_MODE="
set "ACTION_EXIT_CODE=0"

if /I "%~1"=="start" (
    set "CLI_MODE=1"
    goto start_server
)
if /I "%~1"=="stop" (
    set "CLI_MODE=1"
    goto stop_server
)
if /I "%~1"=="restart" (
    set "CLI_MODE=1"
    goto restart_server
)
if /I "%~1"=="status" (
    set "CLI_MODE=1"
    goto show_status
)
if /I "%~1"=="check" (
    set "CLI_MODE=1"
    goto run_checks
)
if /I "%~1"=="browser" (
    set "CLI_MODE=1"
    goto run_browser_smoke
)
if /I "%~1"=="setup" (
    set "CLI_MODE=1"
    goto setup_password
)
if /I "%~1"=="open" (
    set "CLI_MODE=1"
    goto open_browser
)
if /I "%~1"=="folder" (
    set "CLI_MODE=1"
    goto open_folder
)
if /I "%~1"=="help" goto show_help
if not "%~1"=="" goto show_help

:menu
cls
echo.
echo  ================================================================
echo   UricAcid Local Test Console
echo  ================================================================
echo   Project : %PROJECT_DIR%
echo   Address : %LOCAL_URL%
echo.
echo   [1] Start local server
echo   [2] Stop local server
echo   [3] Restart local server
echo   [4] Show server status and health response
echo   [5] Run build and automated checks
echo   [6] Run browser smoke test
echo   [7] Set up or change local access password
echo   [8] Open local site in the default browser
echo   [9] Open project folder
echo   [0] Exit this console
echo.
choice /C 1234567890 /N /M "Select an action [1-9,0]: "
if errorlevel 10 goto exit_console
if errorlevel 9 goto open_folder
if errorlevel 8 goto open_browser
if errorlevel 7 goto setup_password
if errorlevel 6 goto run_browser_smoke
if errorlevel 5 goto run_checks
if errorlevel 4 goto show_status
if errorlevel 3 goto restart_server
if errorlevel 2 goto stop_server
if errorlevel 1 goto start_server
goto menu

:start_server
set "ACTION_EXIT_CODE=0"
call :port_is_open
if not errorlevel 1 (
    echo.
    echo The local server is already listening on port %PORT%.
    echo Use option 8 to open it or option 2 to stop the server window.
    goto finish_action
)

if not exist "%PROJECT_DIR%\dist\src\server.js" (
    echo.
    echo The compiled server was not found. Building the project first...
    pushd "%PROJECT_DIR%"
    call npm run build
    set "BUILD_EXIT_CODE=!ERRORLEVEL!"
    popd
    if not "!BUILD_EXIT_CODE!"=="0" (
        echo.
        echo Build failed. The server was not started.
        set "ACTION_EXIT_CODE=1"
        goto finish_action
    )
)

echo.
echo Starting the server in a persistent window...
if not exist "%PROJECT_DIR%\data" mkdir "%PROJECT_DIR%\data" >nul 2>&1
powershell -NoProfile -ExecutionPolicy Bypass -Command "$project=[IO.Path]::GetFullPath('%PROJECT_DIR%'); $data=[IO.Path]::Combine($project,'data'); $command='title %SERVER_TITLE%&&set NODE_ENV=development&&set PORT=%PORT%&&set DATA_DIR=' + $data + '&&npm run start'; $process=Start-Process -FilePath $env:ComSpec -ArgumentList @('/k',$command) -WorkingDirectory $project -PassThru -WindowStyle Normal; Start-Sleep -Milliseconds 1500; $listener=Get-NetTCPConnection -LocalPort %PORT% -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; $serverPid=if($listener){$listener.OwningProcess}else{$process.Id}; [IO.File]::WriteAllText([IO.Path]::Combine($data,'local-test-server.pid'),([string]$process.Id + [Environment]::NewLine + [string]$serverPid))"
if errorlevel 1 (
    echo Failed to open the persistent server window.
    set "ACTION_EXIT_CODE=1"
    goto finish_action
)
powershell -NoProfile -Command "Start-Sleep -Milliseconds 2000"
call :port_is_open
if errorlevel 1 (
    echo The server window was opened, but port %PORT% is not ready yet.
    echo Keep that window open and check its output.
) else (
    echo Local server is ready: %LOCAL_URL%
)
goto finish_action

:stop_server
set "ACTION_EXIT_CODE=0"
call :port_is_open
if errorlevel 1 (
    echo.
    echo The local server is not listening on port %PORT%.
    if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1
    goto finish_action
)
echo.
echo Closing the UricAcid server window and its child processes...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$file='%PID_FILE%'; if(Test-Path -LiteralPath $file){$ids=Get-Content -LiteralPath $file; $wrapper=[int]$ids[0]; $server=[int]$ids[$ids.Count-1]; $wrapperProcess=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $wrapper) -ErrorAction SilentlyContinue; if($wrapperProcess -and $wrapperProcess.CommandLine -like '*UricAcid Local Server*'){taskkill /PID $wrapper /T /F >$null 2>&1}; $serverProcess=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $server) -ErrorAction SilentlyContinue; if($serverProcess -and $serverProcess.CommandLine -match 'dist[\\/]src[\\/]server\.js'){taskkill /PID $server /T /F >$null 2>&1}; Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}"
powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000"
call :port_is_open
if errorlevel 1 (
    echo Local server stopped.
) else (
    echo The port is still in use. Check the server window or another process using port %PORT%.
    set "ACTION_EXIT_CODE=1"
)
goto finish_action

:restart_server
set "ACTION_EXIT_CODE=0"
call :port_is_open
if not errorlevel 1 (
    echo.
    echo Stopping the current local server...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$file='%PID_FILE%'; if(Test-Path -LiteralPath $file){$ids=Get-Content -LiteralPath $file; $wrapper=[int]$ids[0]; $server=[int]$ids[$ids.Count-1]; $wrapperProcess=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $wrapper) -ErrorAction SilentlyContinue; if($wrapperProcess -and $wrapperProcess.CommandLine -like '*UricAcid Local Server*'){taskkill /PID $wrapper /T /F >$null 2>&1}; $serverProcess=Get-CimInstance Win32_Process -Filter ('ProcessId=' + $server) -ErrorAction SilentlyContinue; if($serverProcess -and $serverProcess.CommandLine -match 'dist[\\/]src[\\/]server\.js'){taskkill /PID $server /T /F >$null 2>&1}; Remove-Item -LiteralPath $file -Force -ErrorAction SilentlyContinue}"
    powershell -NoProfile -Command "Start-Sleep -Milliseconds 1000"
)
goto start_server

:show_status
set "ACTION_EXIT_CODE=0"
echo.
call :port_is_open
if errorlevel 1 (
    echo Server status: STOPPED
    echo URL: %LOCAL_URL%
    if exist "%PID_FILE%" del /f /q "%PID_FILE%" >nul 2>&1
    goto finish_action
)
echo Server status: LISTENING
echo URL: %LOCAL_URL%
echo.
powershell -NoProfile -Command "$ProgressPreference='SilentlyContinue'; try { $response=Invoke-WebRequest -UseBasicParsing -Uri '%LOCAL_URL%/api/auth/status' -TimeoutSec 3; Write-Host ('Health response: HTTP ' + [int]$response.StatusCode + ' ' + $response.Content); exit 0 } catch { Write-Host 'Health response: FAILED'; exit 1 }"
if errorlevel 1 set "ACTION_EXIT_CODE=1"
goto finish_action

:run_checks
set "ACTION_EXIT_CODE=0"
echo.
echo Running TypeScript build and automated tests...
pushd "%PROJECT_DIR%"
call npm run check
set "ACTION_EXIT_CODE=!ERRORLEVEL!"
popd
goto finish_action

:run_browser_smoke
set "ACTION_EXIT_CODE=0"
call :port_is_open
if errorlevel 1 (
    echo.
    echo Start the local server before running the browser smoke test.
    set "ACTION_EXIT_CODE=1"
    goto finish_action
)
echo.
echo Enter the shared password configured for the running local server.
set "SMOKE_PASSWORD="
set /P "SMOKE_PASSWORD=Password: "
if not defined SMOKE_PASSWORD (
    echo No password was entered. Browser smoke test cancelled.
    set "ACTION_EXIT_CODE=1"
    goto clear_smoke_password
)
pushd "%PROJECT_DIR%"
node test/browser-smoke.mjs
set "ACTION_EXIT_CODE=!ERRORLEVEL!"
popd
:clear_smoke_password
set "SMOKE_PASSWORD="
goto finish_action

:setup_password
set "ACTION_EXIT_CODE=0"
echo.
echo This runs the interactive password setup and never accepts a password argument.
pushd "%PROJECT_DIR%"
call npm run setup:password
set "ACTION_EXIT_CODE=!ERRORLEVEL!"
popd
echo Restart the local server after changing the password.
goto finish_action

:open_browser
set "ACTION_EXIT_CODE=0"
echo.
start "" "%LOCAL_URL%"
echo Opened %LOCAL_URL% in the default browser.
goto finish_action

:open_folder
set "ACTION_EXIT_CODE=0"
echo.
start "" "%PROJECT_DIR%"
echo Opened the project folder.
goto finish_action

:show_help
echo.
echo Usage: local-test.bat [start^|stop^|restart^|status^|check^|browser^|setup^|open^|folder]
echo.
echo Double-click this file to use the persistent interactive menu.
echo The local server runs in a separate persistent console window.
set "ACTION_EXIT_CODE=0"
set "CLI_MODE=1"
goto finish_action

:port_is_open
powershell -NoProfile -Command "$client=New-Object Net.Sockets.TcpClient; try { $client.Connect('127.0.0.1',%PORT%); exit 0 } catch { exit 1 } finally { $client.Dispose() }" >nul 2>&1
if errorlevel 1 (exit /b 1) else (exit /b 0)

:finish_action
echo.
if defined CLI_MODE (
    echo Press any key to close this window.
    pause >nul
    exit /b %ACTION_EXIT_CODE%
)
pause
goto menu

:exit_console
echo.
echo This control console is closing. The local server is not stopped automatically.
echo Use option 2 before exiting if you also want to stop the server.
echo.
pause
exit /b 0
