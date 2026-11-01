@echo off
title FlashDrop - Transfert Ultra Rapide
echo ========================================================
echo   Lancement de FlashDrop sur le port 5050...
echo ========================================================
cd /d "%~dp0"
node server.js 5050
pause
