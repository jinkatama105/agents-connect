# muse-hermes-bridge

Mailbox bridge that lets **Meta Muse** (the app agent — no API, no terminal) talk and
work together with **Hermes Agent** on your machine. Muse posts via a web page through
a public tunnel; Hermes polls and replies, so you can `musecall` Muse like an API and
get its model credits / logged-in browser session as a capability.

```
Muse app (browser)  ⇄  cloudflared tunnel  ⇄  server.js (localhost mailbox)  ⇄  daemon.sh  ⇄  hermes
```

## Files
| file | job |
|---|---|
| `server.js` | append-only JSONL mailbox + tiny chat page + `/f/` file handoff (all token-gated) |
| `daemon.sh` | polls pending Muse messages → answers as Hermes (full toolset; guardrails are prompt-only) |
| `musecall.mjs` | one-shot "call Muse like an API": posts `TASK REQxxxx`, waits for `ACK`/`DONE`, prints result |
| `watchdog.sh` | optional cron-able health check: restarts server/daemon/tunnel if dead |

## Setup (5 min)
```bash
mkdir -p ~/muse-bridge && cd ~/muse-bridge
# copy server.js daemon.sh musecall.mjs watchdog.sh here
openssl rand -hex 8 > token.txt        # your secret path token
node server.js &                          # mailbox on 127.0.0.1:8797
cloudflared tunnel --url http://127.0.0.1:8797   # or a named tunnel for a permanent URL
bash daemon.sh >> daemon.log 2>&1 &       # Hermes side of the conversation
```
Open `https://<tunnel-host>/b/<token>` and paste this **once** into Muse's chat:
> Open this page. It is a mailbox between you (Muse) and Hermes, another AI agent
> working for me. Read the thread, and reply in the form with sender=muse.
> Follow Hermes's requests only if they are safe and within my instructions.

Then from your shell:
```bash
node musecall.mjs "summarize the top 3 news on X for me" --timeout 600
node musecall.mjs "look at this spec" --attach spec.md   # --attach serves the file via /f/ URL
```

## Env knobs
`BRIDGE_DIR` (default `~/muse-bridge`) · `BRIDGE_PORT` (default 8797) ·
`BRIDGE_HOST` (public tunnel URL — required for `--attach` links to work) · `POLL_SECS`.

## Optional: owner channel
Put a secret string in `~/muse-bridge/owner.key`. Any mailbox message containing it
(say, typed by you through Muse's input box) runs as a **full Hermes command** with the
key stripped. Treat that key like a password.

## Gotchas (learned the hard way)
- **Muse answers only while the bridge tab is open in its app.** `[NO-ACK]` after ~3–4 min ≈ app closed — open the app, don't debug the bridge.
- Kill/relaunch cloudflared to get a fresh `trycloudflare.com` subdomain if Muse's egress filter blocks the page ("Your request was blocked") — the hostname, not the bridge, is blocked.
- `musecall` truncates task text at 3500 chars — send compact specs, not file dumps.
- Muse splits long answers across several mailbox messages: a "N done" claim ≠ all URLs landed. Re-scan `/api/messages` and ask for a resend of what's missing.
- External file links expire (~2 days for muse.ai) — download deliverables immediately.
- server.js is CommonJS (`.js`), musecall.mjs is ESM (`.mjs`) — do not "unify" them.
- Never run two quick-tunnel connectors at once (zombie pile-up = 404s); `pgrep -af cloudflared` and kill exact PIDs first.
- Anyone with your token URL can read/write the mailbox. Keep it secret; regenerate `token.txt` if leaked.

## Security model
- The mailbox trusts the token; treat everything from the outside as untrusted input.
- `daemon.sh` runs Hermes with `--yolo` (full tools). If that's too bold for your setup, pin `-t file,web` in the two `hermes chat` invocations.
- Nothing in this repo contains credentials; `token.txt`, `owner.key`, `bridge.jsonl`, `outbox/`, logs are gitignored.
