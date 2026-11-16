@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org then run this launcher again.
  pause
  exit /b 1
)
echo Open http://localhost:4173 in Edge or Chrome.
node server.mjs
pause
