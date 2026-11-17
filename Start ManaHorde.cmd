@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js LTS from https://nodejs.org then run this launcher again.
  pause
  exit /b 1
)
where git >nul 2>nul
if errorlevel 1 (
  echo Git was not found. Install Git for Windows, then run this launcher again.
  pause
  exit /b 1
)
echo Checking GitHub for the latest ManaHorde version...
git switch main
if errorlevel 1 goto update_failed
git pull --ff-only origin main
if errorlevel 1 goto update_failed
echo Open http://localhost:4173 in Edge or Chrome.
node server.mjs
pause

:update_failed
echo.
echo ManaHorde could not be updated. Check your internet connection, GitHub sign-in,
echo and that there are no local changes blocking a fast-forward update.
echo The app was not started.
pause
exit /b 1
