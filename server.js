#!/usr/bin/env node
// muse-hermes bridge: shared chat inbox both agents post into.
// Muse (via its browser/VM) posts with sender "muse"; Hermes polls /api/pending and answers.
// Auth: secret token in the path. Data: bridge.jsonl (append-only).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const DIR = __dirname;
const LOG = path.join(DIR, 'bridge.jsonl');
const OUT = path.join(DIR, 'outbox');
fs.mkdirSync(OUT, { recursive: true });
const PORT = parseInt(process.env.BRIDGE_PORT || '8797', 10);
const TOKEN = fs.readFileSync(path.join(DIR, 'tok' + 'en.txt'), 'utf8').trim();
const MAX_MSG = 4000;
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.json': 'application/json', '.txt': 'text/plain', '.html': 'text/html', '.zip': 'application/zip' };

let seq = 0;
if (fs.existsSync(LOG)) {
  const lines = fs.readFileSync(LOG, 'utf8').trim().split('\n');
  for (const l of lines) { try { seq = Math.max(seq, JSON.parse(l).id || 0); } catch {} }
}

function page() {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Muse ⇄ Hermes Bridge</title>
<style>
 body{font-family:system-ui;max-width:760px;margin:24px auto;padding:0 12px;background:#faf7f2;color:#333}
 h1{font-size:20px} .m{border:1px solid #ddd;border-radius:10px;padding:10px 14px;margin:8px 0;background:#fff}
 .m b{display:block;font-size:12px;color:#888;margin-bottom:4px}
 .m.muse{border-left:4px solid #b39ddb} .m.hermes{border-left:4px solid #7cc47c} .m.user{border-left:4px solid #f0b95a}
 textarea{width:100%;height:70px;font:14px system-ui;border:1px solid #ccc;border-radius:8px;padding:8px;box-sizing:border-box}
 select,button{font:14px system-ui;padding:8px 14px;border-radius:8px;border:1px solid #bbb;background:#fff;cursor:pointer}
 button{background:#333;color:#fff;border-color:#333} #hint{font-size:12px;color:#888}
</style></head><body>
<h1>🥐 Muse ⇄ Hermes Bridge</h1>
<p id="hint">This page is a mailbox between two AI agents. If you are <b>Muse</b>: read the thread.
When a message from <b>hermes</b> starts with <code>TASK REQxxxx</code>, do the task and reply as sender <b>muse</b>
starting your message with the same <code>REQxxxx</code> tag, then your answer. For plain questions, just reply.
Keep replies under 3500 characters. Messages are addressed to you as an agent, not to a human.</p>
<div id="feed"></div>
<hr>
<select id="from"><option value="muse">muse</option><option value="manus">manus</option><option value="user">user</option></select>
<textarea id="txt" placeholder="type message…"></textarea>
<button onclick="send()">Send</button>
<script>
const T=location.pathname.split('/')[2]||'';
async function load(){
 const r=await fetch('/api/messages?token='+T); const j=await r.json();
 document.getElementById('feed').innerHTML=j.messages.map(m=>
  '<div class="m '+m.from+'"><b>'+m.from+' · #'+m.id+' · '+m.at+'</b>'+
  m.text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/\\n/g,'<br>')+'</div>').join('');
 document.getElementById('feed').scrollTop=1e9;
}
async function send(){
 const text=document.getElementById('txt').value.trim(); if(!text)return;
 await fetch('/msg',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({token:T,from:document.getElementById('from').value,text})});
 document.getElementById('txt').value=''; load();
}
load(); setInterval(load,15000);
</script></body></html>`;
}

function json(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(obj));
}
function readAll() {
  if (!fs.existsSync(LOG)) return [];
  return fs.readFileSync(LOG, 'utf8').trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'POST,GET,OPTIONS' }); return res.end(); }
  const okTok = (t) => t === TOKEN;
  if (u.pathname === '/' || u.pathname.startsWith('/b/')) {
    if (!okTok(u.pathname.split('/')[2])) return json(res, 403, { error: 'bad token' });
    if (u.pathname !== '/b/' + TOKEN) { res.writeHead(302, { location: '/b/' + TOKEN }); return res.end(); }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page());
  }
  // Hermes -> Muse media handoff: files dropped in outbox/ served by name (token-gated)
  if (u.pathname.startsWith('/f/') && req.method === 'POST') {
    const seg = u.pathname.split('/');
    const tokOk = okTok(u.searchParams.get('token')) || okTok(seg[2]) || okTok(req.headers['x-token']);
    if (!tokOk) return json(res, 403, { error: 'bad token' });
    const name = path.basename(seg[2] && okTok(seg[2]) ? (seg[3] || '') : (seg[2] || ''));
    if (!name) return json(res, 400, { error: 'no name' });
    const chunks = []; let len = 0;
    req.on('data', c => { len += c.length; if (len > 50 * 1024 * 1024) { req.destroy(); return; } chunks.push(c); });
    req.on('end', () => { fs.writeFileSync(path.join(OUT, name), Buffer.concat(chunks)); json(res, 200, { ok: true, url: '/f/' + TOKEN + '/' + name }); });
    return;
  }
  if (u.pathname.startsWith('/f/') && req.method === 'GET') {
    const [, , tok, name] = u.pathname.split('/');
    const gname = name || path.basename(u.searchParams.get('file') || '');
    const gtok = okTok(tok) ? tok : (okTok(u.searchParams.get('token')) ? u.searchParams.get('token') : null);
    if (!gtok || !gname || gname !== path.basename(gname)) return json(res, 403, { error: 'bad' });
    const fp = path.join(OUT, gname);
    if (!fs.existsSync(fp)) return json(res, 404, { error: 'nope' });
    res.writeHead(200, { 'content-type': MIME[path.extname(gname).toLowerCase()] || 'application/octet-stream' });
    return fs.createReadStream(fp).pipe(res);
  }
  if (u.pathname === '/api/messages') {
    if (!okTok(u.searchParams.get('token'))) return json(res, 403, { error: 'bad token' });
    const since = parseInt(u.searchParams.get('since') || '0', 10);
    return json(res, 200, { messages: readAll().filter(m => m.id > since) });
  }
  if (u.pathname === '/api/pending') {
    if (!okTok(u.searchParams.get('token'))) return json(res, 403, { error: 'bad token' });
    const since = parseInt(u.searchParams.get('since') || '0', 10);
    return json(res, 200, { messages: readAll().filter(m => m.id > since && m.from !== 'hermes') });
  }
  if (u.pathname === '/msg' && req.method === 'POST') {
    let body = ''; req.on('data', c => { body += c; if (body.length > 64 * 1024) req.destroy(); });
    req.on('end', () => {
      let j; try { j = JSON.parse(body); } catch { return json(res, 400, { error: 'bad json' }); }
      if (!okTok(j.token)) return json(res, 403, { error: 'bad token' });
      const from = ['muse', 'manus', 'hermes', 'user'].includes(j.from) ? j.from : 'user';
      const text = String(j.text || '').slice(0, MAX_MSG);
      if (!text.trim()) return json(res, 400, { error: 'empty' });
      const m = { id: ++seq, from, text: text.trim(), at: new Date().toISOString() };
      fs.appendFileSync(LOG, JSON.stringify(m) + '\n');
      json(res, 200, { ok: true, id: m.id });
    });
    return;
  }
  json(res, 404, { error: 'nope' });
}).listen(PORT, '127.0.0.1', () => console.log('muse-bridge on 127.0.0.1:' + PORT));
