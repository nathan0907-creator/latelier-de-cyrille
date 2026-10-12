@echo off
rem Double-cliquez sur ce fichier : le site demarre et s'ouvre dans le navigateur.
rem Fermer cette fenetre arrete le site.
chcp 65001 >nul
title L'atelier de Cyrille
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   Node.js n'est pas installe sur cet ordinateur.
  echo   Installez-le depuis https://nodejs.org puis relancez ce fichier.
  echo.
  pause
  exit /b 1
)

node server.js --open

rem Code 2 : le site tournait deja, il vient d'etre rouvert dans le navigateur.
if %errorlevel%==2 (
  timeout /t 3 >nul
  exit /b 0
)

echo.
pause
