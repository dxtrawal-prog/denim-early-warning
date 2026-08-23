@echo off
echo Starting Denim Early-Warning Dashboard...
echo.
echo The dashboard now talks to cloud Supabase directly.
echo No PostgREST bridge needed.
echo.
cd /d "%~dp0"
start "Denim Dashboard" cmd /c "npx next dev --port 3000"
timeout /t 5 >nul
start http://localhost:3000
echo Dashboard running at http://localhost:3000
echo Press any key to stop the server...
pause >nul
taskkill /f /im node.exe /fi "WINDOWTITLE eq Denim Dashboard*" >nul 2>&1
