const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.txt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const AUTOCHAT_FILE = path.join(DATA_DIR, 'autochat.txt');

const gateway = require('./cogs/gateway');
const autochatCog = require('./cogs/autochat');
const spoofer = require('./cogs/deviceSpoofer');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '');
if (!fs.existsSync(AUTOCHAT_FILE)) fs.writeFileSync(AUTOCHAT_FILE, '');

const defaultConfig = {
  statuses: ['online', 'idle', 'dnd'],
  rpcs: [
    { name: 'Visual Studio Code', details: 'Editing index.js', state: 'Workspace: soulzy' },
    { name: 'Spotify', details: 'Listening to lofi beats', state: '24/7 Chill' }
  ],
  spooferMode: 'desktop',
  guildId: '', channelId: '', chatDelay: 5000
};
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(defaultConfig, null, 2));

function readTokens() { return fs.readFileSync(TOKENS_FILE, 'utf8').split('\n').map(t => t.trim()).filter(Boolean); }
function saveTokens(t) { fs.writeFileSync(TOKENS_FILE, t.join('\n')); }
function readConfig() { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
function saveConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }

async function checkToken(token) {
  try {
    const res = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
    const user = res.data;
    return { 
      valid: true, username: user.username, 
      discriminator: user.discriminator !== '0' ? `#${user.discriminator}` : '',
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
      nitro: user.premium_type > 0, 
      nitroType: user.premium_type === 2 ? 'Nitro Trial/Full' : (user.premium_type === 1 ? 'Classic' : (user.premium_type === 3 ? 'Basic' : 'No Trial'))
    };
  } catch (err) { return { valid: false }; }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.end();
  const send = (code, data) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };

  if (url.pathname === '/api/login' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => {
      const { user, pass } = JSON.parse(body);
      if (user === (process.env.DASHBOARD_USER || 'loco') && pass === (process.env.DASHBOARD_PASS || 'loco')) {
        res.setHeader('Set-Cookie', 'session=auth; Path=/; HttpOnly');
        return send(200, { ok: true });
      }
      send(401, { error: 'Invalid' });
    });
    return;
  }

  if (url.pathname === '/' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(HTML); }

  if (url.pathname.startsWith('/api')) {
    const cookie = req.headers.cookie || '';
    if (!cookie.includes('session=auth')) return send(401, { error: 'Unauthorized' });
  }

  if (url.pathname === '/api/tokens' && req.method === 'GET') {
    const tokens = readTokens();
    const data = await Promise.all(tokens.map(async (t) => {
      const val = await checkToken(t);
      const isActive = gateway.clients.has(t);
      return {
        token: t.substring(0, 15) + '...', rawToken: t,
        valid: val.valid, username: val.valid ? val.username + val.discriminator : 'Invalid',
        avatar: val.valid ? val.avatar : null, nitro: val.valid ? val.nitro : false,
        nitroType: val.valid ? val.nitroType : 'Unknown',
        status: isActive ? 'online' : 'offline'
      };
    }));
    return send(200, data);
  }

  if (url.pathname === '/api/tokens' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { saveTokens(JSON.parse(body).tokens); send(200, { ok: true }); });
    return;
  }

  if (url.pathname === '/api/toggle' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      const { token, action } = JSON.parse(body);
      const config = readConfig();
      if (action === 'start') {
        const randomStatus = config.statuses[Math.floor(Math.random() * config.statuses.length)] || 'online';
        const randomRpc = config.rpcs[Math.floor(Math.random() * config.rpcs.length)] || null;
        const activities = [];
        if (randomRpc) activities.push({ name: randomRpc.name, type: 0, details: randomRpc.details, state: randomRpc.state });
        const profile = spoofer.generateProfile(config.spooferMode || 'desktop');
        await gateway.connect(token, { status: randomStatus, activities }, profile);
      } else if (action === 'stop') {
        gateway.disconnect(token);
      }
      send(200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/autochat/generate' && req.method === 'POST') {
    try { const content = await autochatCog.generate100Chats(); fs.writeFileSync(AUTOCHAT_FILE, content); send(200, { ok: true, content }); } 
    catch (e) { send(500, { error: e.message }); }
    return;
  }

  if (url.pathname === '/api/autochat/send' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      const { channelId, delay } = JSON.parse(body);
      const lines = fs.readFileSync(AUTOCHAT_FILE, 'utf8').split('\n').filter(Boolean);
      if (!lines.length) return send(400, { error: 'Generate lines first' });
      await autochatCog.sendMessages(readTokens(), channelId, lines, delay);
      send(200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/config' && req.method === 'GET') return send(200, readConfig());
  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { saveConfig(JSON.parse(body)); send(200, { ok: true }); });
    return;
  }
  
  if (url.pathname === '/api/system') {
    return send(200, { active: gateway.clients.size, total: readTokens().length });
  }
  send(404, { error: 'Not found' });
});

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<title>Soulzy Control</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#060910;--panel:rgba(15,23,42,0.6);--border:rgba(59,130,246,0.15);--accent:#3b82f6;--accent-2:#60a5fa;--text:#f8fafc;--text-2:#94a3b8;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;color:var(--text);background:var(--bg);font-size:14px;overflow:hidden;height:100vh}
#bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(circle at 15% 50%, rgba(59,130,246,0.08), transparent 25%),radial-gradient(circle at 85% 30%, rgba(96,165,250,0.08), transparent 25%),var(--bg)}
.orb{position:absolute;border-radius:50%;filter:blur(80px);z-index:-1;opacity:0.4;animation:float 10s infinite ease-in-out alternate}
.orb-1{width:400px;height:400px;background:#3b82f6;top:-100px;left:-100px}
.orb-2{width:300px;height:300px;background:#8b5cf6;bottom:-50px;right:10%}
@keyframes float{0%{transform:translateY(0) scale(1)}100%{transform:translateY(50px) scale(1.1)}}
#login-screen{position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px)}
.login-box{background:var(--panel);padding:50px 40px;border-radius:24px;border:1px solid var(--border);width:360px;text-align:center;backdrop-filter:blur(20px)}
.login-box h2{font-size:24px;font-weight:800;margin-bottom:30px;background:linear-gradient(135deg,#fff,#60a5fa);-webkit-background-clip:text;color:transparent}
input,textarea,select{width:100%;padding:14px 16px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);border-radius:12px;outline:none;margin-bottom:16px;font-family:inherit;transition:all 0.2s}
input:focus,select:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
.btn{padding:14px;border-radius:12px;border:none;cursor:pointer;font-weight:600;font-size:14px;transition:all 0.2s;background:linear-gradient(135deg,var(--accent),#2563eb);color:#fff;width:100%}
header{position:fixed;top:0;left:0;right:0;height:70px;z-index:100;display:flex;align-items:center;gap:16px;padding:0 32px;background:rgba(6,9,16,0.8);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:800}
.logo svg{width:28px;height:28px;fill:var(--accent)}
.logo-text{background:linear-gradient(135deg,#fff,#60a5fa);-webkit-background-clip:text;color:transparent}
.spacer{flex:1}
.hdr-btn{padding:8px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.1);color:#fca5a5;text-decoration:none;display:inline-flex;align-items:center;gap:8px;font-size:13px;font-weight:600}
.layout{display:flex;height:100vh;padding-top:70px}
aside{width:250px;padding:24px 16px;display:flex;flex-direction:column;gap:4px;border-right:1px solid var(--border);background:rgba(6,9,16,0.5);overflow-y:auto}
.sec-label{font-size:11px;font-weight:700;text-transform:uppercase;color:var(--text-2);padding:20px 12px 8px;letter-spacing:0.05em}
.nav-btn{display:flex;align-items:center;gap:12px;padding:12px 16px;border-radius:10px;background:transparent;border:none;color:var(--text-2);font-size:14px;font-weight:600;cursor:pointer;width:100%;transition:all 0.2s}
.nav-btn:hover{background:rgba(255,255,255,0.05);color:var(--text)}
.nav-btn.active{background:rgba(59,130,246,0.15);color:var(--accent-2)}
.nav-btn svg{width:20px;height:20px;fill:currentColor}
main{flex:1;overflow-y:auto;padding:32px}
.tab-panel{display:none;animation:fadeIn 0.3s ease}
.tab-panel.active{display:block}
@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
.page-head{margin-bottom:28px}
.page-title{font-size:26px;font-weight:800}
.page-desc{font-size:14px;color:var(--text-2);margin-top:4px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
.card{background:var(--panel);border:1px solid var(--border);border-radius:16px;padding:24px;backdrop-filter:blur(20px);margin-bottom:16px}
.card-title{font-size:16px;font-weight:700;margin-bottom:16px}
table{width:100%;border-collapse:collapse;}
th{text-align:left;padding:14px;color:var(--text-2);font-size:12px;font-weight:700;border-bottom:1px solid var(--border);}
td{padding:14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;}
.avatar{width:36px;height:36px;border-radius:50%;background:#222;display:inline-block;vertical-align:middle;margin-right:12px;}
.badge{padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;}
.badge.on{background:rgba(34,197,94,0.15);color:var(--ok);}
.badge.off{background:rgba(239,68,68,0.15);color:var(--bad);}
.btn-blue{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px;background:var(--accent);color:#fff;transition:all 0.2s}
.btn-gray{padding:10px 20px;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-weight:600;font-size:14px;background:transparent;color:var(--text);transition:all 0.2s}
.kv{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px}
pre{background:rgba(0,0,0,0.3);padding:16px;border-radius:12px;border:1px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:13px;color:var(--ok);white-space:pre-wrap;overflow-y:auto;max-height:300px;}
</style></head>
<body>
<div id="bg"><div class="orb orb-1"></div><div class="orb orb-2"></div></div>

<div id="login-screen">
  <div class="login-box">
    <h2>Welcome Back</h2>
    <input type="text" id="login-user" placeholder="Username">
    <input type="password" id="login-pass" placeholder="Password">
    <button class="btn" onclick="doLogin()">Sign In</button>
  </div>
</div>

<header style="display:none;" id="top-header">
  <div class="logo"><svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg><span class="logo-text">Soulzy</span></div>
  <div class="spacer"></div>
  <a href="/" class="hdr-btn">Logout</a>
</header>

<div class="layout" id="main-layout" style="display:none;">
  <aside>
    <div class="sec-label">Main</div>
    <button class="nav-btn active" onclick="showTab('overview', this)"><svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>Overview</button>
    <button class="nav-btn" onclick="showTab('tokens', this)"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>Tokens</button>
    <button class="nav-btn" onclick="showTab('validator', this)"><svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>Validator</button>
    <button class="nav-btn" onclick="showTab('genchat', this)"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Generate Lines</button>
    <button class="nav-btn" onclick="showTab('autochat', this)"><svg viewBox="0 0 24 24"><path d="M3 3h18v18H3z"/></svg>Auto Chat Runner</button>
    <div class="sec-label">Setup</div>
    <button class="nav-btn" onclick="showTab('multistatus', this)"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="4"/></svg>Multi Status</button>
    <button class="nav-btn" onclick="showTab('multirpc', this)"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M11 7h2v5.41l3.29 3.3-1.41 1.41L11 13.17z"/></svg>Multi RPC</button>
  </aside>

  <main>
    <section class="tab-panel active" id="tab-overview">
      <div class="page-head"><h1 class="page-title">Overview</h1><p class="page-desc">Live token states</p></div>
      <div class="grid" style="margin-bottom:20px;">
        <div class="card" style="padding:24px;"><div style="font-size:12px;color:var(--text-2);text-transform:uppercase;font-weight:700;">Total Tokens</div><div id="sys-total" style="font-size:32px;font-weight:800;">0</div></div>
        <div class="card" style="padding:24px;"><div style="font-size:12px;color:var(--text-2);text-transform:uppercase;font-weight:700;">Active (Online)</div><div id="sys-active" style="font-size:32px;font-weight:800;color:var(--ok);">0</div></div>
      </div>
      <div class="card"><table><thead><tr><th>User</th><th>Status</th></tr></thead><tbody id="overview-list"></tbody></table></div>
    </section>

    <section class="tab-panel" id="tab-tokens">
      <div class="page-head"><h1 class="page-title">Tokens</h1><p class="page-desc">Manage tokens</p></div>
      <div class="card"><table><thead><tr><th>User</th><th>Status</th><th>Action</th></tr></thead><tbody id="token-list"></tbody></table></div>
      <div class="card">
        <textarea id="token-input" placeholder="Paste tokens one per line..."></textarea>
        <button class="btn-blue" onclick="saveTokens()">Save & Load</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-validator">
      <div class="page-head"><h1 class="page-title">Validator</h1><p class="page-desc">Check account and Nitro status</p></div>
      <div class="card"><button class="btn-blue" onclick="runChecker()">Run Validation</button></div>
      <div class="card"><table><thead><tr><th>User</th><th>Status</th><th>Nitro Trial</th></tr></thead><tbody id="nitro-list"></tbody></table></div>
    </section>

    <section class="tab-panel" id="tab-genchat">
      <div class="page-head"><h1 class="page-title">Generate Lines</h1><p class="page-desc">Groq generates 100 realistic chat lines</p></div>
      <div class="card">
        <button class="btn-blue" onclick="genChat()">Generate via Groq</button>
        <pre id="gen-output" style="margin-top:16px;">No lines generated.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-autochat">
      <div class="page-head"><h1 class="page-title">Auto Chat Runner</h1><p class="page-desc">Send generated lines to a channel</p></div>
      <div class="card">
        <input type="text" id="chat-channel" placeholder="Channel ID">
        <input type="number" id="chat-delay" placeholder="Delay (ms)" value="5000">
        <button class="btn-blue" onclick="startChat()">Start Sending</button>
        <p id="chat-status" style="margin-top:16px;color:var(--ok);"></p>
      </div>
    </section>

    <section class="tab-panel" id="tab-multistatus">
      <div class="page-head"><h1 class="page-title">Multi Status & Device</h1><p class="page-desc">Randomize statuses and spoof devices</p></div>
      <div class="card">
        <label style="display:block;margin-bottom:8px;color:var(--text-2);">Active Device Spoofer</label>
        <select id="spoofer-select" style="margin-bottom:16px;">
          <option value="desktop">Desktop (Windows 11)</option>
          <option value="mobile">Mobile (Android 14)</option>
          <option value="console">Console (PlayStation 5)</option>
          <option value="vr">VR (Oculus Quest 3)</option>
        </select>
        <label style="display:block;margin-bottom:8px;color:var(--text-2);">Status Pool (comma separated)</label>
        <input type="text" id="statuses-input" placeholder="online, idle, dnd, invisible">
        <button class="btn-blue" onclick="saveConfigMulti()">Save Settings</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-multirpc">
      <div class="page-head"><h1 class="page-title">Multi RPC</h1><p class="page-desc">Randomize RPCs across tokens</p></div>
      <div class="card">
        <textarea id="rpcs-input" placeholder='[{"name":"Spotify","details":"Chill","state":"Vibing"}]' style="height:150px;"></textarea>
        <button class="btn-blue" onclick="saveRpcs()">Save RPC Cards</button>
      </div>
    </section>
  </main>
</div>

<script>
let cachedTokens = [];
async function doLogin() {
  const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ user: document.getElementById('login-user').value, pass: document.getElementById('login-pass').value }) });
  if (res.ok) {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('top-header').style.display = 'flex';
    document.getElementById('main-layout').style.display = 'flex';
    loadSys(); loadTokens(); loadConfig();
  } else alert('Invalid credentials');
}
function showTab(id, btn) {
  document.querySelectorAll('.tab-panel').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('tab-' + id).classList.add('active');
  btn.classList.add('active');
}
async function loadSys() {
  const res = await fetch('/api/system'); if(!res.ok) return;
  const d = await res.json();
  document.getElementById('sys-active').innerText = d.active;
  document.getElementById('sys-total').innerText = d.total;
}
async function loadTokens() {
  const res = await fetch('/api/tokens'); if(!res.ok) return;
  cachedTokens = await res.json();
  document.getElementById('overview-list').innerHTML = cachedTokens.map(t => \`<tr><td><img src="\${t.avatar}" class="avatar">\${t.username}</td><td><span class="badge \${t.status === 'online' ? 'on' : 'off'}">\${t.status}</span></td></tr>\`).join('');
  document.getElementById('token-list').innerHTML = cachedTokens.map(t => \`<tr><td><img src="\${t.avatar}" class="avatar">\${t.username}</td><td><span class="badge \${t.status === 'online' ? 'on' : 'off'}">\${t.status}</span></td><td><button class="btn-\${t.status === 'online' ? 'gray' : 'blue'}" onclick="toggle('\${t.rawToken}', '\${t.status === 'online' ? 'stop' : 'start'}')">\${t.status === 'online' ? 'Disconnect' : 'Connect'}</button></td></tr>\`).join('');
  document.getElementById('token-input').value = cachedTokens.map(t => t.rawToken).join('\\n');
}
async function toggle(token, action) { await fetch('/api/toggle', { method:'POST', body: JSON.stringify({ token, action }) }); loadTokens(); loadSys(); }
async function saveTokens() { await fetch('/api/tokens', { method:'POST', body: JSON.stringify({ tokens: document.getElementById('token-input').value.split('\\n').filter(l => l.trim()) }) }); loadTokens(); loadSys(); }
async function runChecker() {
  const tbody = document.getElementById('nitro-list');
  tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Scanning...</td></tr>';
  await loadTokens();
  tbody.innerHTML = cachedTokens.map(t => \`<tr><td><img src="\${t.avatar}" class="avatar">\${t.username}</td><td><span class="badge \${t.valid ? 'on' : 'off'}">\${t.valid ? 'Working' : 'Invalid'}</span></td><td><span class="badge \${t.nitro ? 'on' : ''}">\${t.nitroType}</span></td></tr>\`).join('');
}
async function genChat() {
  const out = document.getElementById('gen-output');
  out.innerText = 'Generating...';
  const res = await fetch('/api/autochat/generate', { method:'POST' });
  const d = await res.json();
  out.innerText = d.error ? 'Error: ' + d.error : d.content;
}
async function startChat() {
  const channelId = document.getElementById('chat-channel').value;
  const delay = document.getElementById('chat-delay').value;
  document.getElementById('chat-status').innerText = 'Sending messages...';
  await fetch('/api/autochat/send', { method:'POST', body: JSON.stringify({ channelId, delay }) });
  document.getElementById('chat-status').innerText = 'Done sending.';
}
async function saveConfigMulti() {
  const s = document.getElementById('statuses-input').value.split(',').map(x => x.trim());
  const spoof = document.getElementById('spoofer-select').value;
  const currentConfig = await (await fetch('/api/config')).json();
  await fetch('/api/config', { method:'POST', body: JSON.stringify({ ...currentConfig, statuses: s, spooferMode: spoof }) });
  alert('Statuses & Device Spoofer saved');
}
async function saveRpcs() {
  try {
    const r = JSON.parse(document.getElementById('rpcs-input').value);
    const currentConfig = await (await fetch('/api/config')).json();
    await fetch('/api/config', { method:'POST', body: JSON.stringify({ ...currentConfig, rpcs: r }) });
    alert('RPCs saved');
  } catch(e) { alert('Invalid JSON format'); }
}
async function loadConfig() {
  const res = await fetch('/api/config'); if(!res.ok) return;
  const d = await res.json();
  document.getElementById('statuses-input').value = (d.statuses || []).join(', ');
  document.getElementById('spoofer-select').value = d.spooferMode || 'desktop';
  document.getElementById('rpcs-input').value = JSON.stringify(d.rpcs || [], null, 2);
}
setInterval(() => { if(document.getElementById('main-layout').style.display !== 'none') loadSys(); }, 3000);
</script>
</body></html>`;

server.listen(PORT, '0.0.0.0', () => console.log('Running on ' + PORT));
