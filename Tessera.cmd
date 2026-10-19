@echo off
rem Docs: docs/code/server/launcher.md
rem Starts Tessera and opens it in the browser (PLAT-02). Closing this window stops it.
node "%~dp0packages\server\src\launcher\main.ts"
if errorlevel 1 pause
