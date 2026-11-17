#!/bin/bash
# muse-bridge watchdog: run from cron (e.g. */30). Restarts whatever died; exits quietly otherwise.
# NOTE: keeps ONE cloudflared process — kill exact PIDs, never blanket pkill while other tunnels matter.
DIR="${BRIDGE_DIR:-$HOME/muse-bridge}"
cd "$DIR" || exit 0
ALERT=""

if ! pgrep -f "node.*server\.js" >/dev/null; then
  (setsid node server.js >> server.log 2>&1 &)
  ALERT="server restarted"
fi
if ! pgrep -f "daemon\.sh" >/dev/null; then
  (setsid bash daemon.sh >> daemon.log 2>&1 &)
  ALERT="${ALERT:+$ALERT; }daemon restarted"
fi
if ! pgrep -f cloudflared >/dev/null; then
  rm -f tunnel.log
  (setsid cloudflared tunnel --url "http://127.0.0.1:${BRIDGE_PORT:-8797}" > tunnel.log 2>&1 &)
  sleep 25
  NEW=$(grep -oE "https://[a-z0-9-]+\.trycloudflare\.com" tunnel.log | head -1)
  echo "tunnel restarted: $NEW"
  ALERT="${ALERT:+$ALERT; }NEW tunnel URL: $NEW — update Muse's bridge tab"
fi
[ -n "$ALERT" ] && echo "muse-bridge watchdog: $ALERT"
exit 0
