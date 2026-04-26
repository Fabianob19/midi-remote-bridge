@echo off
title USB-Remoto - MODO REMOTE
echo.
echo  ╔══════════════════════════════════════╗
echo  ║  USB-REMOTO - MODO REMOTE (vMix)     ║
echo  ╚══════════════════════════════════════╝
echo.
echo  Certifique-se que o loopMIDI esta rodando!
echo  Painel: http://localhost:9902
echo  WebSocket: porta 9900 (aguardando host)
echo.

cd /d "%~dp0.."
node src/remote.js %*

pause
