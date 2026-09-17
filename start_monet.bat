@echo off
rem MONET launcher for Windows: double-click this file or run it from a terminal.
rem First run: creates .venv next to this file and installs requirements.txt (internet needed once).
rem Later runs: starts MONET; dependencies are reinstalled only when requirements.txt changes.
rem Extra arguments are passed to start_monet.py (e.g. --port 8766). Set MONET_SETUP_ONLY=1 to stop after the setup.
setlocal
cd /d "%~dp0"
set "VENV_PY=.venv\Scripts\python.exe"

if exist "%VENV_PY%" goto requirements
set "PYTHON="
if defined MONET_PYTHON (
  "%MONET_PYTHON%" -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1 && set PYTHON="%MONET_PYTHON%"
)
if not defined PYTHON (
  py -3 -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1 && set "PYTHON=py -3"
)
if not defined PYTHON (
  python -c "import sys; sys.exit(sys.version_info < (3, 10))" >nul 2>&1 && set "PYTHON=python"
)
if not defined PYTHON (
  echo MONET: Python 3.10 or newer was not found.
  echo Install it from https://www.python.org/downloads/ ^(tick "Add python.exe to PATH"^) or use conda ^(see README^), then run this file again.
  goto fail
)
echo Creating the MONET environment ...
%PYTHON% -m venv .venv
if errorlevel 1 (
  echo MONET: could not create .venv.
  goto fail
)

:requirements
fc /b requirements.txt .venv\monet-requirements.txt >nul 2>&1
if not errorlevel 1 goto start
echo Installing ASE and MDAnalysis ^(first run or updated requirements^) ...
"%VENV_PY%" -m pip install --upgrade pip >nul 2>&1
"%VENV_PY%" -m pip install -r requirements.txt
if errorlevel 1 (
  echo MONET: installing the requirements failed; check the internet connection and the messages above.
  goto fail
)
copy /y requirements.txt .venv\monet-requirements.txt >nul

:start
if not "%MONET_SETUP_ONLY%"=="1" goto launch
"%VENV_PY%" -c "import ase, MDAnalysis; print(f'MONET environment ready: ASE {ase.__version__}, MDAnalysis {MDAnalysis.__version__}')"
exit /b %errorlevel%

:launch
echo Starting MONET - keep this window open; press Ctrl+C to stop.
"%VENV_PY%" start_monet.py %*
if errorlevel 1 goto fail
exit /b 0

:fail
if not "%MONET_SETUP_ONLY%"=="1" pause
exit /b 1
