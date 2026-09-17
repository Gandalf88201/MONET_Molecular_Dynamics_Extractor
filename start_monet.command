#!/usr/bin/env bash
# MONET launcher for macOS and Linux: double-click (macOS) or run ./start_monet.command.
# First run: creates .venv next to this file and installs requirements.txt (internet needed once).
# Later runs: starts MONET; dependencies are reinstalled only when requirements.txt changes.
# Extra arguments are passed to start_monet.py (e.g. --port 8766). MONET_SETUP_ONLY=1 stops after the setup.
set -euo pipefail
cd "$(dirname "$0")"

fail () {
  echo
  echo "MONET: $1"
  # Keep a double-clicked Terminal window open long enough to read the message.
  [ -t 0 ] && read -r -p "Press Enter to close." _ || true
  exit 1
}

find_python () {
  for candidate in "${MONET_PYTHON:-}" python3.13 python3.12 python3.11 python3.10 python3.14 python3 python; do
    [ -n "$candidate" ] || continue
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 10))' 2>/dev/null; then
      echo "$candidate"; return 0
    fi
  done
  return 1
}

VENV_PY=.venv/bin/python
if [ ! -x "$VENV_PY" ]; then
  PYTHON=$(find_python) || fail "Python 3.10 or newer was not found. Install it from https://www.python.org/downloads/ (or use conda: see README), then run this launcher again."
  echo "Creating the MONET environment with $("$PYTHON" --version) …"
  "$PYTHON" -m venv .venv || fail "Could not create .venv (on Debian/Ubuntu install python3-venv)."
fi

STAMP=.venv/monet-requirements.txt
if ! cmp -s requirements.txt "$STAMP"; then
  echo "Installing ASE and MDAnalysis (first run or updated requirements) …"
  "$VENV_PY" -m pip install --upgrade pip >/dev/null || true
  "$VENV_PY" -m pip install -r requirements.txt || fail "Installing the requirements failed; check the internet connection and the messages above."
  cp requirements.txt "$STAMP"
fi

if [ "${MONET_SETUP_ONLY:-}" = "1" ]; then
  "$VENV_PY" -c 'import ase, MDAnalysis; print(f"MONET environment ready: ASE {ase.__version__}, MDAnalysis {MDAnalysis.__version__}")'
  exit 0
fi

echo "Starting MONET — keep this window open; press Ctrl+C to stop."
exec "$VENV_PY" start_monet.py "$@"
