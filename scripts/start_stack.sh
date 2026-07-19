#!/usr/bin/env bash
#
# One-command local stack for VoiceSaver:
#   1. FastAPI backend  (uvicorn, 127.0.0.1:$BACKEND_PORT)
#   2. ngrok tunnel     (public HTTPS -> backend, so ElevenLabs can reach the tools)
#   3. Vite frontend    (the cockpit UI, pointed at the backend)
#
# Idempotent: any component already running is reused, not started twice.
# Foreground: prints all URLs, then waits; Ctrl+C tears down what THIS run started.
#
# Usage:
#   ./scripts/start_stack.sh
#   BACKEND_PORT=8080 NGROK_BIN=/tmp/ngrok-bin/ngrok ./scripts/start_stack.sh
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

BACKEND_PORT="${BACKEND_PORT:-8080}"
VENV_PY="$ROOT/.venv/bin"
LOG_DIR="${LOG_DIR:-/tmp/voicesaver}"
mkdir -p "$LOG_DIR"

# Resolve the ngrok binary: PATH first, then the download location used during setup.
NGROK_BIN="${NGROK_BIN:-}"
if [ -z "$NGROK_BIN" ]; then
  if command -v ngrok >/dev/null 2>&1; then NGROK_BIN="$(command -v ngrok)"
  elif [ -x /tmp/ngrok-bin/ngrok ]; then NGROK_BIN="/tmp/ngrok-bin/ngrok"
  else echo "ERROR: ngrok not found (set NGROK_BIN=/path/to/ngrok)"; exit 1; fi
fi

STARTED_PIDS=()
cleanup() {
  echo
  echo "Shutting down components started by this run..."
  for pid in "${STARTED_PIDS[@]:-}"; do
    [ -n "$pid" ] && kill "$pid" 2>/dev/null || true
  done
  echo "Done. (Components that were already running are left untouched.)"
}
trap cleanup INT TERM

wait_for() { # url attempts
  local url="$1" tries="${2:-15}"
  for _ in $(seq 1 "$tries"); do
    if curl -s -o /dev/null -w '%{http_code}' -H 'ngrok-skip-browser-warning: 1' "$url" 2>/dev/null | grep -q '^200$'; then
      return 0
    fi
    sleep 1
  done
  return 1
}

# 1) Backend ----------------------------------------------------------------
if wait_for "http://127.0.0.1:$BACKEND_PORT/api/health" 1; then
  echo "backend    : already running on :$BACKEND_PORT (reused)"
else
  echo "backend    : starting uvicorn on :$BACKEND_PORT ..."
  "$VENV_PY/uvicorn" src.server:app --host 127.0.0.1 --port "$BACKEND_PORT" \
    > "$LOG_DIR/backend.log" 2>&1 &
  STARTED_PIDS+=("$!")
  wait_for "http://127.0.0.1:$BACKEND_PORT/api/health" 20 \
    || { echo "ERROR: backend did not become healthy; see $LOG_DIR/backend.log"; exit 1; }
  echo "backend    : up"
fi

# 2) ngrok ------------------------------------------------------------------
ngrok_url() {
  curl -s http://127.0.0.1:4040/api/tunnels 2>/dev/null \
    | "$VENV_PY/python" -c "import sys,json
try:
    d=json.load(sys.stdin); print(next(t['public_url'] for t in d['tunnels'] if t['public_url'].startswith('https')))
except Exception: pass" 2>/dev/null
}

PUBLIC_URL="$(ngrok_url || true)"
if [ -n "$PUBLIC_URL" ]; then
  echo "ngrok      : already running -> $PUBLIC_URL (reused)"
else
  echo "ngrok      : starting tunnel to :$BACKEND_PORT ..."
  "$NGROK_BIN" http "$BACKEND_PORT" --log stdout --log-format logfmt \
    > "$LOG_DIR/ngrok.log" 2>&1 &
  STARTED_PIDS+=("$!")
  for _ in $(seq 1 15); do PUBLIC_URL="$(ngrok_url || true)"; [ -n "$PUBLIC_URL" ] && break; sleep 1; done
  [ -n "$PUBLIC_URL" ] || { echo "ERROR: ngrok tunnel did not come up; see $LOG_DIR/ngrok.log"; exit 1; }
  echo "ngrok      : up -> $PUBLIC_URL"
fi

# 3) Frontend ---------------------------------------------------------------
if wait_for "http://localhost:5173" 1; then
  echo "frontend   : already running on :5173 (reused)"
else
  echo "frontend   : starting Vite (VITE_API_BASE=http://localhost:$BACKEND_PORT) ..."
  ( cd "$ROOT/frontend" && VITE_API_BASE="http://localhost:$BACKEND_PORT" npm run dev \
      > "$LOG_DIR/frontend.log" 2>&1 ) &
  STARTED_PIDS+=("$!")
  wait_for "http://localhost:5173" 20 \
    || { echo "ERROR: frontend did not come up; see $LOG_DIR/frontend.log"; exit 1; }
  echo "frontend   : up"
fi

cat <<EOF

============================================================
VoiceSaver local stack is up:

  Frontend (cockpit UI) : http://localhost:5173
  Backend API / docs    : http://127.0.0.1:$BACKEND_PORT/docs
  Public webhook base   : $PUBLIC_URL
  ngrok inspector       : http://127.0.0.1:4040

Logs: $LOG_DIR/{backend,ngrok,frontend}.log
EOF

if [ "${#STARTED_PIDS[@]:-0}" -eq 0 ]; then
  echo "Everything was already running; nothing new to supervise. Exiting."
  exit 0
fi

echo "Press Ctrl+C to stop the components started by this run."
wait
