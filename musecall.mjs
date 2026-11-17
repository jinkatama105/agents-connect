#!/usr/bin/env node
// musecall — call Meta Muse like an API through the bridge mailbox.
// usage: node musecall.mjs "your task for muse" [--timeout 2700] [--no-wait] [--ack-timeout 180] [--attach file]
// Two-phase protocol: Muse replies "ACK <REQ> — on working" instantly, then "DONE <REQ> — <result>" at the end.
// Prints ACK line (if seen) to stderr as [ACK], final result to stdout. Exit 0 on reply, 2 on timeout.
// Env: BRIDGE_DIR (default ~/muse-bridge), BRIDGE_PORT (default 8797),
//      BRIDGE_HOST (public URL of the tunnel, needed only for --attach file links).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
const DIR = process.env.BRIDGE_DIR || path.join(os.homedir(), 'muse-bridge');
const PORT = process.env.BRIDGE_PORT || '8797';
const BASE = 'http://127.0.0.1:' + PORT;
const TOKEN = fs.readFileSync(path.join(DIR, 'tok' + 'en.txt'), 'utf8').trim();

const args = process.argv.slice(2);
let timeout = 240, nowait = false, ackTimeout = 180, text = '', attach = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--timeout') timeout = parseInt(args[++i], 10);
  else if (args[i] === '--ack-timeout') ackTimeout = parseInt(args[++i], 10);
  else if (args[i] === '--no-wait') nowait = true;
  else if (args[i] === '--attach') attach.push(args[++i]);
  else text += (text ? ' ' : '') + args[i];
}
if (!text.trim()) { console.error('usage: musecall.mjs "task" [--timeout s] [--no-wait] [--attach file]'); process.exit(1); }

const req = 'REQ' + Date.now().toString(36).toUpperCase();
// attachments: copy into outbox/, expose via public tunnel URL (token-gated)
const HOST = process.env.BRIDGE_HOST || BASE;
let attachNote = '';
for (const f of attach) {
  const name = path.basename(f);
  fs.copyFileSync(f, path.join(DIR, 'outbox', name));
  attachNote += `\nFILE: ${HOST}/f/${TOKEN}/${name}`;
}
const protocol = `REPLY PROTOCOL (MANDATORY, two phase): (1) RIGHT NOW, before any work, send a first reply that is exactly: "ACK ${req} — on working". (2) Then do the task. (3) When done or stuck, send a second reply (start with): "DONE ${req} — <final result>". If you produce or find any image, video, or file, PASTE its public URL in the DONE body (not just mention it). Do not send other replies.${attachNote}`;
const body = JSON.stringify({ token: TOKEN, from: 'hermes', text: `TASK ${req} — ${text.slice(0, 3500)} ||| ${protocol}` });

async function api(p) { return (await fetch(BASE + p)).json(); }
async function lastId() { const j = await api('/api/messages?token=' + TOKEN); return j.messages.length ? j.messages[j.messages.length - 1].id : 0; }

const before = await lastId();
const post = await (await fetch(BASE + '/msg', { method: 'POST', headers: { 'content-type': 'application/json' }, body })).json();
if (!post.ok) { console.error('post failed', JSON.stringify(post)); process.exit(1); }
if (nowait) { console.log(req); process.exit(0); }

const isAck = m => m.includes(req) && /\bACK\b/.test(m);
const isDone = m => m.includes(req) && !/\bACK\b/.test(m);

const deadline = Date.now() + timeout * 1000;
const ackDeadline = Date.now() + ackTimeout * 1000;
let acked = false;
while (Date.now() < deadline) {
  await new Promise(r => setTimeout(r, 5000));
  const j = await api('/api/messages?token=' + TOKEN);
  const cands = j.messages.filter(m => m.id > before && m.from === 'muse');
  if (!acked) {
    const a = cands.find(m => isAck(m.text));
    if (a) { acked = true; console.error('[ACK] ' + a.text.slice(0, 200)); }
    else if (Date.now() > ackDeadline && !cands.some(m => isDone(m.text))) {
      console.error('[NO-ACK] no ACK within ' + ackTimeout + 's — the Muse app is likely closed / its bridge tab dead (REQ ' + req + ')');
    }
  }
  const hit = cands.find(m => isDone(m.text));
  if (hit) { console.log(hit.text.replace(/^.*?REQ\w+\s*[—:-]?\s*(on working\s*[—:-]?\s*)?/i, '').slice(0, 8000)); process.exit(0); }
}
console.error('TIMEOUT: no DONE within ' + timeout + 's (REQ ' + req + (acked ? ', ACKed' : ', never ACKed') + ')');
process.exit(2);
