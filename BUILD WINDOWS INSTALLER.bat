@echo off
rem =====================================================
rem  ApolloCut 1.3.1 — offline installer builder
rem  Everything needed is bundled: NO downloads, NO admin.
rem  =====================================================
cd /d "%~dp0"

rem --- seed the electron / electron-builder caches (offline) ---
if not exist "%LOCALAPPDATA%\electron\Cache" mkdir "%LOCALAPPDATA%\electron\Cache" 2>nul
copy /Y "builder-cache\electron\electron-v33.4.11-win32-x64.zip" "%LOCALAPPDATA%\electron\Cache\" >nul
if not exist "%LOCALAPPDATA%\electron-builder\Cache" mkdir "%LOCALAPPDATA%\electron-builder\Cache" 2>nul
xcopy "builder-cache\electron-builder" "%LOCALAPPDATA%\electron-builder\Cache\" /E /I /Y /Q >nul

where npm >nul 2>nul || (echo Node.js/npm not installed - get it from nodejs.org ^& pause ^& exit /b 1)
set CSC_IDENTITY_AUTO_DISCOVERY=false
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
call npx electron-builder --win nsis --x64 --publish never
echo.
echo === Done. Installer is in the release\ folder ===
pause
