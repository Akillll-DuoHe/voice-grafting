@echo off
chcp 65001 >nul
"%~dp0runtime\node\node.exe" "%~dp0tools\cli.mjs" setup %*
if errorlevel 1 goto done
"%~dp0runtime\node\node.exe" "%~dp0tools\cli.mjs" install %*
:done
pause
