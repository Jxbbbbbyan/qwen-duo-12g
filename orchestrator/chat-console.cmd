@echo off
REM ASCII only - cmd.exe parses .bat in the system ANSI codepage,
REM so Chinese here would turn into mojibake. Logic lives in chat-launch.ps1.
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\ComfyUI\orchestrator\chat-launch.ps1"
if errorlevel 1 pause
exit /b 0
