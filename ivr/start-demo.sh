#!/usr/bin/env bash
#
# SikaVoice IVR demo launcher — keeps the IVR server + a public tunnel alive
# in YOUR terminal (processes started from agent tool sessions get reaped).
#
# Usage:   bash ivr/start-demo.sh
# Stop:    Ctrl+C (kills both the server and the tunnel)
#
# When the public URL prints, paste it into the Arkesel dashboard:
#   VoiceConnect -> Voice Number -> Webhook URL -> <URL>/voice/webhook
#
set -uo pipefail
cd "$(dirname "$0")/.."   # project root

PORT="${IVR_PORT:-8787}"
BASE="http://localhost:${PORT}"

command -v node >/dev/null || { echo "node is required"; exit 1; }
[ -x .tools/cloudflared ] || { echo ".tools/cloudflared missing — re-run the setup"; exit 1; }

echo "── starting IVR server on :${PORT}"
node ivr/server.js &
IVR_PID=$!

# Wait until the webhook actually answers before opening the tunnel.
for i in $(seq 1 20); do
  if curl -s -m 2 -o /dev/null -X POST "$BASE/voice/webhook" \
       -H 'Content-Type: application/json' -d '{"callId":"healthz"}'; then
    break
  fi
  sleep 0.5
done

echo "── opening public tunnel (no account needed)"
.tools/cloudflared tunnel --url "$BASE" --no-autoupdate 2>&1 | while IFS= read -r line; do
  # Surface the trycloudflare URL the moment it appears.
  if [[ "$line" =~ https://[a-z0-9-]+\.trycloudflare\.com ]]; then
    URL="${BASH_REMATCH[0]}"
    echo ""
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║  PUBLIC WEBHOOK URL (live while this window stays open):     ║"
    echo "║  ${URL}/voice/webhook"
    echo "║                                                              ║"
    echo "║  Arkesel dashboard → VoiceConnect → Voice Number →           ║"
    echo "║  Webhook URL → paste the line above, save, then DIAL THE     ║"
    echo "║  NUMBER to test.                                             ║"
    echo "║  Ctrl+C stops the server AND the tunnel.                     ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo ""
  fi
done &
TUNNEL_PID=$!

trap 'kill "$IVR_PID" "$TUNNEL_PID" 2>/dev/null; pkill -f "cloudflared tunnel --url $BASE" 2>/dev/null' EXIT
echo "IVR server: ${BASE} (pid ${IVR_PID}). Ctrl+C to stop everything."
wait "$IVR_PID"
