@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0mylore.exe" (
    start "" "%~dp0mylore.exe"
) else (
    start "" "%~dp0src-tauri\target\debug\mylore.exe"
)
