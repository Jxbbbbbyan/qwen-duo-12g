@echo off
REM ===========================================================================
REM  Qwen Console launcher.  ASCII ONLY - see launch.ps1 for why.
REM  cmd.exe parses .bat in the system ANSI codepage (GBK on a Chinese Windows),
REM  so Chinese text in here turns into mojibake and gets run as commands.
REM  All logic and all Chinese messages live in launch.ps1 instead.
REM ===========================================================================
pwsh -NoProfile -ExecutionPolicy Bypass -File "C:\ComfyUI\orchestrator\launch.ps1"
if errorlevel 1 pause
exit /b 0
