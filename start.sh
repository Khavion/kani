#!/usr/bin/env bash
# Kani one-command startup: verify deps, install, migrate, seed, build UI, launch server + UI, open browser.
# Usage: ./start.sh [--reset] [--no-open]
#   --reset    wipe the local database and reseed demo data
#   --no-open  do not open the browser
set -euo pipefail
cd "$(dirname "$0")"
ROOT="$PWD"

RESET=0
OPEN=1
for arg in "$@"; do
  case "$arg" in
    --reset) RESET=1 ;;
    --no-open) OPEN=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

bold() { printf '\033[1m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32mok\033[0m  %s\n' "$*"; }
warn() { printf '  \033[33m!!\033[0m  %s\n' "$*"; }
die() { printf '  \033[31mxx\033[0m  %s\n' "$*" >&2; exit 1; }

# Everything Kani installs stays inside the repo (.local/ is gitignored).
export PLAYWRIGHT_BROWSERS_PATH="$ROOT/.local/ms-playwright"
export UV_CACHE_DIR="$ROOT/.local/uv-cache"
export UV_PYTHON_INSTALL_DIR="$ROOT/.local/python"
export HF_HOME="$ROOT/.local/hf"
export TORCH_HOME="$ROOT/.local/torch"
export npm_config_cache="$ROOT/.local/npm-cache"

[ -f .env ] || cp .env.example .env
getenv() { # read KEY from .env with a default (no shell sourcing of arbitrary content)
  local v
  v="$(grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- || true)"
  echo "${v:-$2}"
}
PORT="${PORT:-$(getenv PORT 3000)}"
OLLAMA_URL="${OLLAMA_URL:-$(getenv OLLAMA_URL http://localhost:11434)}"
MODEL="${MODEL:-$(getenv MODEL qwen3:8b)}"
VISION_MODEL="${VISION_MODEL:-$(getenv VISION_MODEL gemma3:12b)}"
DB_PATH="${DB_PATH:-$(getenv DB_PATH data/kani.db)}"
export PORT OLLAMA_URL MODEL VISION_MODEL DB_PATH

bold "Kani: checking dependencies"

# 1. Node (node:sqlite + native TypeScript type stripping)
command -v node >/dev/null || die "Node.js not found. Install Node 22.18+ (https://nodejs.org)."
node -e "require('node:sqlite'); if (!process.features.typescript) process.exit(1)" 2>/dev/null \
  || die "Node $(node --version) is too old. Kani needs Node 22.18+ (node:sqlite and TypeScript type stripping)."
ok "node $(node --version)"

# 2. Ollama (native, not Docker)
if ! curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1; then
  command -v ollama >/dev/null || die "Ollama is not running at $OLLAMA_URL and the CLI is not installed (https://ollama.com)."
  warn "Ollama not responding, starting 'ollama serve' in the background"
  (ollama serve >"$ROOT/.local/ollama.log" 2>&1 &) || true
  for _ in $(seq 1 30); do curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1 && break; sleep 1; done
  curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1 || die "Ollama did not start. Open the Ollama app and retry."
fi
ok "ollama at $OLLAMA_URL"

# 3. Models
TAGS="$(curl -sf "$OLLAMA_URL/api/tags")"
for m in "$MODEL" "$VISION_MODEL"; do
  if echo "$TAGS" | grep -q "\"name\":\"$m\""; then
    ok "model $m"
  else
    warn "model $m missing, pulling (one-time download)"
    ollama pull "$m" || die "could not pull $m"
    ok "model $m"
  fi
done

# 4. whisperX (voice notes). Installed into .local/venv-whisper with uv when missing.
mkdir -p .local/bin
WHISPERX_BIN="$(getenv WHISPERX_BIN '')"
if [ -n "$WHISPERX_BIN" ] && [ -x "$WHISPERX_BIN" ]; then
  ok "whisperx $WHISPERX_BIN"
elif [ -x .local/venv-whisper/bin/whisperx ]; then
  ok "whisperx .local/venv-whisper"
elif command -v whisperx >/dev/null; then
  ok "whisperx $(command -v whisperx)"
elif command -v uv >/dev/null; then
  warn "whisperX not found, installing into .local/venv-whisper (one-time, a few minutes)"
  uv venv .local/venv-whisper --python 3.12 >/dev/null
  uv pip install --python .local/venv-whisper/bin/python whisperx imageio-ffmpeg >.local/whisperx-install.log 2>&1 \
    || die "whisperX install failed, see .local/whisperx-install.log"
  ok "whisperx installed"
else
  warn "whisperX not found and uv is not installed: voice notes will not be transcribed (install uv: https://docs.astral.sh/uv/)"
fi
if [ -x .local/venv-whisper/bin/python ] && [ ! -e .local/bin/ffmpeg ]; then
  if ! .local/venv-whisper/bin/python -c "import imageio_ffmpeg" 2>/dev/null; then
    uv pip install --python .local/venv-whisper/bin/python imageio-ffmpeg >/dev/null 2>&1 || true
  fi
  FF="$(.local/venv-whisper/bin/python -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())' 2>/dev/null || true)"
  [ -n "$FF" ] && ln -sf "$FF" .local/bin/ffmpeg
fi
if [ -e .local/bin/ffmpeg ] || command -v ffmpeg >/dev/null; then ok "ffmpeg"; else warn "ffmpeg not found: audio uploads cannot be transcribed"; fi

# 5. npm dependencies
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules/.package-lock.json ]; then
  bold "Installing npm dependencies"
  npm ci --no-audit --no-fund >/dev/null
fi
ok "npm dependencies"

# 6. UI build (rebuild when sources changed)
if [ ! -f ui/dist/index.html ] || [ -n "$(find ui/src ui/index.html ui/vite.config.ts -newer ui/dist/index.html 2>/dev/null | head -1)" ]; then
  bold "Building UI"
  npm run -s build:ui >/dev/null
fi
ok "ui built"

# 7. Database: migrate + seed (idempotent)
if [ "$RESET" = 1 ]; then node src/seed/seed-cli.ts --reset; else node src/seed/seed-cli.ts; fi
ok "database $DB_PATH"

# 8. Port
if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  die "port $PORT is already in use (another Kani?). Stop it or run PORT=3001 ./start.sh"
fi

bold "Starting Kani on http://localhost:$PORT"
node src/main.ts &
SERVER_PID=$!
trap 'kill $SERVER_PID 2>/dev/null || true' EXIT INT TERM
for _ in $(seq 1 40); do curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 && break; sleep 0.25; done
curl -sf "http://localhost:$PORT/api/health" >/dev/null 2>&1 || die "server did not start"
ok "server ready: simulator http://localhost:$PORT  admin http://localhost:$PORT/admin"
[ "$OPEN" = 1 ] && command -v open >/dev/null && open "http://localhost:$PORT"
echo "  Press Ctrl+C to stop."
wait "$SERVER_PID"
