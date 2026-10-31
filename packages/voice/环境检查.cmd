@echo off
"%~dp0runtime\node\node.exe" "%~dp0tools\cli.mjs" doctor %*
pause
