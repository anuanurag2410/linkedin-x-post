#!/usr/bin/env bash
set -euo pipefail

TEXT_MODEL="${OLLAMA_MODEL:-gemma3:4b}"
IMAGE_MODEL="${DRAWTHINGS_MODEL:-flux_2_klein_4b_q8p.ckpt}"

say() {
  printf "\n\033[1;36m%s\033[0m\n" "$1"
}

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This one-step setup currently targets macOS because Draw Things CLI is macOS-first."
  echo "See REQUIREMENTS.md for manual/provider alternatives."
  exit 1
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "Homebrew is required for the one-step installer."
  echo "Install Homebrew from https://brew.sh and run this script again."
  exit 1
fi

say "1/7 Checking Node.js"
NODE_OK=0
if command -v node >/dev/null 2>&1; then
  if node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
    NODE_OK=1
  fi
fi

if [[ "$NODE_OK" -ne 1 ]]; then
  echo "Node 22.12+ is required for the Electron desktop build. Installing node@22..."
  brew install node@22 || brew upgrade node@22 || true

  if [[ -d "/opt/homebrew/opt/node@22/bin" ]]; then
    export PATH="/opt/homebrew/opt/node@22/bin:$PATH"
  elif [[ -d "/usr/local/opt/node@22/bin" ]]; then
    export PATH="/usr/local/opt/node@22/bin:$PATH"
  fi
fi

if ! node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)'; then
  echo "Node is still below 22.12.0."
  echo "Add Homebrew Node 22 to your shell PATH and reopen Terminal:"
  echo '  export PATH="/opt/homebrew/opt/node@22/bin:$PATH"'
  exit 1
fi

node --version
npm --version

say "2/7 Installing Ollama"
if ! command -v ollama >/dev/null 2>&1; then
  brew install ollama
else
  echo "Ollama already installed: $(ollama --version 2>/dev/null || true)"
fi

say "3/7 Installing Draw Things CLI"
if ! command -v draw-things-cli >/dev/null 2>&1; then
  brew install draw-things-cli || brew install drawthingsai/draw-things/draw-things-cli
else
  echo "Draw Things CLI already installed."
fi

say "4/7 Installing app dependencies"
npm install

say "5/7 Creating local environment file"
if [[ ! -f ".env.local" ]]; then
  cp .env.example .env.local
  echo "Created .env.local from .env.example"
else
  echo ".env.local already exists; leaving it unchanged."
fi

say "6/7 Starting Ollama and downloading text model: $TEXT_MODEL"
if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  brew services start ollama >/dev/null 2>&1 || true

  for _ in {1..8}; do
    if curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

if ! curl -fsS http://127.0.0.1:11434/api/tags >/dev/null 2>&1; then
  echo "Ollama service did not start through Homebrew. Starting a local background server..."
  nohup ollama serve > /tmp/post-studio-ollama.log 2>&1 &
  sleep 3
fi

ollama pull "$TEXT_MODEL"

say "7/7 Downloading image model: $IMAGE_MODEL"
draw-things-cli models ensure --model "$IMAGE_MODEL"

echo
echo "=============================================================="
echo "Post Studio local AI setup is ready."
echo "Text model : $TEXT_MODEL"
echo "Image model: $IMAGE_MODEL"
echo
echo "Next:"
echo "  1. Edit config/creator.config.ts to personalize the creator."
echo "  2. Add social publishing credentials to .env.local if needed."
echo "  3. Run: npm run dev:all"
echo "  4. Open: http://localhost:3000"
echo "=============================================================="
