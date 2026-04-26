@echo off
title USB-Remoto - MODO HOST
echo.
echo  ╔══════════════════════════════════════╗
echo  ║   USB-REMOTO - MODO HOST (Casa)      ║
echo  ╚══════════════════════════════════════╝
echo.
echo  Conecte a controladora MIDI e acesse:
echo  http://localhost:9901
echo.
echo  (Esta janela pode ser MINIMIZADA, nao feche!)
echo.

cd /d "%~dp0.."
node src/host.js %*

pause
