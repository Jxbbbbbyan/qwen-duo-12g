@echo off
setlocal EnableDelayedExpansion
REM ============================================================================
REM  start_qwen.bat - Qwen-Image 2.1 on ComfyUI (RTX 3060 12GB, 16GB RAM)
REM  Plan: dsh-plans/2026-10-16-qwen-image-21-local-deploy/PLAN_v3.md  (item I-007)
REM
REM  LAUNCH PROFILE (R-002 / D-013) - do NOT add the banned flags below.
REM    --fast-disk              force disk-backed dynamic loading/offload
REM    --disable-pinned-memory  avoid up to ram*0.40 of NON-PAGEABLE host RAM
REM
REM  BANNED, and why (each was verified in ComfyUI source, see PLAN_v3 evidence):
REM    --gpu-only / --highvram    -> VRAMState.HIGH_VRAM; unload moves weights to
REM                                  the device they are already on, frees nothing,
REM                                  and disables DynamicVRAM. Causes OOM or a
REM                                  silent WDDM spill of weights into system RAM.
REM    --disable-dynamic-vram     -> leaves the disk-backed dynamic loader.
REM    --disable-smart-memory     -> NAME IS MISLEADING: it makes ComfyUI
REM                                  "aggressively offload to regular ram".
REM    --high-ram                 -> re-enables the host-RAM path we are avoiding.
REM    --lowvram / --novram       -> push the text encoder onto the CPU.
REM    --cpu                      -> obviously wrong here.
REM ============================================================================

set "ROOT=C:\ComfyUI\ComfyUI_windows_portable"
set "PY=%ROOT%\python_embeded\python.exe"
set "MAIN=%ROOT%\ComfyUI\main.py"
set "LOGDIR=C:\ComfyUI\logs"
set "THRESHOLD_FILE=C:\ComfyUI\qwen_threshold_mb.txt"

REM ---- Provisional minimum free RAM. Replaced with (B0 + 4096 MB) after I-012.
set "MIN_FREE_MB=6144"

if exist "%THRESHOLD_FILE%" (
  set /p MIN_FREE_MB=<"%THRESHOLD_FILE%"
  echo [info] threshold loaded from qwen_threshold_mb.txt : !MIN_FREE_MB! MB
) else (
  echo [warn] qwen_threshold_mb.txt not found - using PROVISIONAL !MIN_FREE_MB! MB.
  echo [warn] This value will be backfilled from the measured idle baseline B0 after I-012.
)

if not exist "%PY%"  ( echo [FAIL] python_embeded not found: %PY%   & exit /b 2 )
if not exist "%MAIN%" ( echo [FAIL] ComfyUI main.py not found: %MAIN% & exit /b 2 )
if not exist "%LOGDIR%" mkdir "%LOGDIR%"

REM ---- Required model files (E-EXT-003). Missing ones are reported, not fatal here.
set "MODELS=%ROOT%\ComfyUI\models"
call :need "%MODELS%\diffusion_models\qwen_image_2.1_turbo_int8_convrot.safetensors" "Turbo DiT (6.76 GiB)"
call :need "%MODELS%\text_encoders\qwen3vl_8b_int8_convrot.safetensors"            "Text encoder (8.71 GiB)"
call :need "%MODELS%\vae\qwen_image_2.1_vae_bf16.safetensors"                     "VAE (0.63 GiB)"

REM ---- Free-RAM gate (R-005). Refuse to start when below threshold.
for /f "usebackq tokens=*" %%A in (`powershell -NoProfile -Command "[int]((Get-CimInstance Win32_OperatingSystem).FreePhysicalMemory/1KB)"`) do set "FREEMB=%%A"
echo [info] free physical memory = !FREEMB! MB   (threshold !MIN_FREE_MB! MB)
if !FREEMB! LSS !MIN_FREE_MB! (
  echo.
  echo [REFUSE] Not enough free system memory to start safely.
  echo          free=!FREEMB! MB  required=!MIN_FREE_MB! MB
  echo          Close WeChat / Edge / ChatGPT / AweSun and other heavy apps, then retry.
  echo          (Weights must not be pushed into system RAM - that is the whole point.)
  echo.
  exit /b 3
)

set "STAMP=%DATE:~0,4%%DATE:~5,2%%DATE:~8,2%_%TIME:~0,2%%TIME:~3,2%%TIME:~6,2%"
set "STAMP=%STAMP: =0%"
set "LOG=%LOGDIR%\comfy_%STAMP%.log"

echo [info] starting ComfyUI, log -> %LOG%
echo [info] profile: --fast-disk --disable-pinned-memory
cd /d "%ROOT%"
"%PY%" -s "%MAIN%" --fast-disk --disable-pinned-memory --windows-standalone-build > "%LOG%" 2>&1
echo [info] ComfyUI exited with code %ERRORLEVEL%
exit /b %ERRORLEVEL%

:need
if exist %1 ( echo [ok]   %~2 ) else ( echo [MISS] %~2  ->  %~1 )
exit /b 0
