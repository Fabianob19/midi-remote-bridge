@echo off
:: Inicia o REMOTE minimizado na bandeja
start "USB-Remoto REMOTE" /MIN cmd /c "cd /d %~dp0.. && node src/remote.js %*"
echo USB-Remoto REMOTE iniciado (minimizado).
echo Para parar, feche a janela "USB-Remoto REMOTE" na barra de tarefas.
