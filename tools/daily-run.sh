#!/usr/bin/env bash
# mhzaly daily agent — automaton finds leads + prepares drafts, then sends within cap.
set -u
export PATH="/home/mhzaly/.local/opt/node22/bin:$PATH"
export NODE_OPTIONS="--dns-result-order=ipv4first --no-network-family-autoselection"
ROOT="/home/mhzaly/Documents/mhzaly"
AUTO="/home/mhzaly/Documents/automaton"
LOG="$ROOT/automaton-outbox/daily-run.log"
cd "$ROOT" || exit 1
echo "=== $(date -u +%FT%TZ) daily run ===" >> "$LOG"

# 1) automaton generates its own acquisition drafts (its identity + ref link)
( cd "$AUTO" && ACQUIRE_LIMIT=10 node scripts/acquire.mjs >> "$LOG" 2>&1 ) || echo "acquire failed" >> "$LOG"

# 2) collect fresh international leads (best effort; API may be down)
node tools/international-leads.mjs >> "$LOG" 2>&1 || echo "intl leads failed" >> "$LOG"

# 3) send within daily cap (10 each, so Gmail stays safe)
EMAIL_DAILY_CAP=10 node tools/international-outreach.mjs --send >> "$LOG" 2>&1 || echo "intl send failed" >> "$LOG"
EMAIL_DAILY_CAP=10 node tools/gmail-send.mjs --send >> "$LOG" 2>&1 || echo "pk send failed" >> "$LOG"

# 4) inbox check (reply / stop / bounce) — best effort
python3 tools/inbox-agent.py >> "$LOG" 2>&1 || echo "inbox failed" >> "$LOG"
echo "=== done $(date -u +%FT%TZ) ===" >> "$LOG"
