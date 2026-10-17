@echo off
rem =====================================================
rem  ApolloCut 1.3.1 — portable Windows edition
rem  Double-click this file to launch the editor.
rem  (If Windows SmartScreen asks: "More info" -> "Run anyway")
rem =====================================================
cd /d "%~dp0"
if not exist "node_modules\electron\dist\electron.exe" (
  echo Electron binary missing - redownload the ApolloCut package.
  pause
  exit /b 1
)
start "ApolloCut" "node_modules\electron\dist\electron.exe" "."
