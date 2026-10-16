@echo off
chcp 65001 >nul
cd /d "%~dp0.."
if not exist node_modules call npm install --omit=dev
REM لتوسعة التخزين على قرص آخر: أزل REM من السطر التالي وعدّل المسار
REM set BOUTIKA_DATA=D:\BoutikaData
node src\server.js
pause
