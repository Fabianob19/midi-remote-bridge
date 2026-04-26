@echo off
:: Inicia o HOST minimizado na bandeja
start "USB-Remoto HOST" /MIN cmd /c "cd /d %~dp0.. && node src/host.js %*"
echo USB-Remoto HOST iniciado (minimizado).
echo Para parar, feche a janela "USB-Remoto HOST" na barra de tarefas.
