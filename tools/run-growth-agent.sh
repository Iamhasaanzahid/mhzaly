#!/usr/bin/env bash
# mhzaly Growth Agent — daily runner (cron-safe)
# - ensures local Ollama is up (no paid API key)
# - finds real shop leads, writes email drafts, generates one SEO post
# - builds and deploys the site
set -u

export PATH="/home/mhzaly/.local/opt/node22/bin:$PATH"
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
export CLOUDFLARE_ACCOUNT_ID="578d3b1ea09c06627b87ea4a1753521f"
export OLLAMA_BASE_URL="http://127.0.0.1:11435"

ROOT="/home/mhzaly/Documents/mhzaly"
OUT="$ROOT/automaton-outbox"
mkdir -p "$OUT"

# 1) make sure the local brain is running
if ! curl -sf --max-time 3 "http://127.0.0.1:11435/api/tags" >/dev/null 2>&1; then
  setsid env OLLAMA_HOST=127.0.0.1:11435 \
    OLLAMA_ORIGINS='https://mhzaly.pages.dev,https://*.mhzaly.pages.dev,http://localhost:*,http://127.0.0.1:*' \
    OLLAMA_NUM_PARALLEL=1 OLLAMA_KEEP_ALIVE=30m OLLAMA_CONTEXT_LENGTH=16384 \
    /home/mhzaly/.local/bin/ollama serve > /tmp/opencode/ollama-11435.log 2>&1 < /dev/null &
  sleep 8
fi

cd "$ROOT" || exit 1

# 2) growth agent: leads + drafts + one SEO post + deploy
node tools/growth-agent.mjs --deploy >> "$OUT/cron.log" 2>&1
GROWTH=$?

# 3) daily social marketing kit (real AI, no keys)
node tools/sales-automaton.mjs >> "$OUT/cron.log" 2>&1
SALES=$?

echo "$(date -Is) growth=$GROWTH sales=$SALES" >> "$OUT/cron.log"
exit $GROWTH
