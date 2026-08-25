@echo off
setlocal
cd /d "%~dp0"

if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron is not installed. Running npm install...
  call npm.cmd install
  if errorlevel 1 goto :error
)

node.exe scripts\needs-build.cjs
if errorlevel 1 (
  echo Building Claude Export Data Reader...
  call npm.cmd run build
  if errorlevel 1 goto :error
) else (
  echo Using the existing Claude Export Data Reader build...
)

echo Starting the desktop reader...
start "" "node_modules\electron\dist\electron.exe" .
exit /b 0

:error
echo.
echo The reader could not start. Review the error above.
pause
exit /b 1
