@echo off
REM ============================================================================
REM  stop_qwen.bat - stop ComfyUI (python_embeded running main.py)
REM
REM  SCOPE WARNING: this stops EVERY python.exe whose command line looks like a
REM  ComfyUI instance - not only the one this repository started. If you run more
REM  than one ComfyUI on this machine, stop them yourself instead of using this.
REM ============================================================================
setlocal

echo [info] looking for ComfyUI (python_embeded running main.py) ...
set "FOUND=0"
set "FAILED=0"
for /f "usebackq tokens=1 delims=," %%P in (`powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name='python.exe'\" | Where-Object { $_.CommandLine -like '*main.py*' -and $_.CommandLine -like '*ComfyUI*' } | Select-Object -ExpandProperty ProcessId"`) do (
  echo [info] stopping PID %%P
  taskkill /PID %%P /T /F >nul 2>&1
  if errorlevel 1 (
    echo [warn] taskkill failed for PID %%P
    set "FAILED=1"
  ) else (
    set "FOUND=1"
  )
)

if "%FOUND%"=="0" (
  echo [info] no running ComfyUI process found.
) else (
  echo [ok] stop signal sent.
)
if "%FAILED%"=="1" (
  echo [warn] one or more PIDs could not be stopped; check Task Manager.
  exit /b 1
)
exit /b 0