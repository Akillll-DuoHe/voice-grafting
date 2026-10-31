@echo off
chcp 65001 >nul
"%~dp0runtime\node\node.exe" "%~dp0tools\cli.mjs" start %*
pause
