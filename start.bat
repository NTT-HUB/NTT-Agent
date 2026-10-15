@echo off
cd /d "%~dp0"
if not exist node_modules\electron (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)
call npm start
