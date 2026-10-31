@echo off
chcp 65001 >nul
cd /d "%~dp0"
if exist "%~dp0src-tauri\target\debug\mylore.exe" (
    xcopy /D /Y /Q "%~dp0src-tauri\target\debug\mylore.exe" "%~dp0" >nul 2>&1
    start "" "%~dp0src-tauri\target\debug\mylore.exe"
) else if exist "%~dp0mylore.exe" (
    start "" "%~dp0mylore.exe"
)
