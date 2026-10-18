const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.txt');
const AUTOCHAT_FILE = path.join(DATA_DIR, 'autochat.txt');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '');
if (!fs.existsSync(AUTOCHAT_FILE)) fs.writeFileSync(AUTOCHAT_FILE, '');

const activeTokens = {};
const startTime = Date.now();

function readTokens() {
  const raw = fs.readFileSync(TOKENS_FILE, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map(t => t.trim()).filter(Boolean);
}
function saveTokens(tokens) { fs.writeFileSync(TOKENS_FILE, tokens.join('\n')); }

async function checkToken(token) {
  try {
    const res = await axios.get('https://discord.com/api/v10/users/@me', { headers: { Authorization: token } });
    const user = res.data;
    return { 
      valid: true, username: user.username, 
      discriminator: user.discriminator !== '0' ? `#${user.discriminator}` : '',
      avatar: user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png` : 'https://cdn.discordapp.com/embed/avatars/0.png',
      nitro: user.premium_type > 0, 
      nitroType: user.premium_type === 2 ? 'Nitro' : (user.premium_type === 1 ? 'Classic' : (user.premium_type === 3 ? 'Basic' : 'None'))
    };
  } catch (err) { return { valid: false }; }
}

async function generate100Chats() {
  const key = process.env.GROQ_API_KEY;
  if (!key || key.trim() === '') throw new Error('GROQ_API_KEY missing in Railway Variables');
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: 'Return exactly 100 lines of realistic, casual, lowercase Discord chat. No numbering. Just text.' }]
  }, { headers: { Authorization: `Bearer ${key}` } });
  return res.data.choices[0].message.content.trim();
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
      if (user === 'loco' && pass === 'loco') {
        res.setHeader('Set-Cookie', 'session=loco_authorized; Path=/; HttpOnly');
        return send(200, { ok: true });
      }
      send(401, { error: 'Invalid' });
    });
    return;
  }

  if (url.pathname === '/' && req.method === 'GET') { 
    res.writeHead(200, { 'Content-Type': 'text/html' }); 
    return res.end(HTML); 
  }

  if (url.pathname.startsWith('/api')) {
    const cookie = req.headers.cookie || '';
    if (!cookie.includes('session=loco_authorized')) return send(401, { error: 'Unauthorized' });
  }

  if (url.pathname === '/api/tokens' && req.method === 'GET') {
    const tokens = readTokens();
    const data = await Promise.all(tokens.map(async (t) => {
      const val = await checkToken(t);
      const isActive = activeTokens[t];
      return {
        token: t.substring(0, 15) + '...', rawToken: t,
        valid: val.valid, username: val.valid ? val.username + val.discriminator : 'Invalid',
        avatar: val.valid ? val.avatar : null, nitro: val.valid ? val.nitro : false,
        nitroType: val.valid ? val.nitroType : 'Unknown',
        status: isActive ? 'running' : 'stopped',
        uptime: isActive ? Math.floor((Date.now() - isActive) / 1000) : 0
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
    req.on('end', () => {
      const { token, action } = JSON.parse(body);
      if (action === 'start') activeTokens[token] = Date.now();
      if (action === 'stop') delete activeTokens[token];
      send(200, { ok: true });
    });
    return;
  }

  if (url.pathname === '/api/autochat/generate' && req.method === 'POST') {
    try {
      const content = await generate100Chats();
      fs.writeFileSync(AUTOCHAT_FILE, content);
      send(200, { ok: true, content });
    } catch (e) { send(500, { error: e.message }); }
    return;
  }

  if (url.pathname === '/api/autochat/read') return send(200, { content: fs.readFileSync(AUTOCHAT_FILE, 'utf8') });

  if (url.pathname === '/api/config') {
    const mask = (str) => str ? str.substring(0, 6) + '...' + str.slice(-4) : 'Not Set';
    return send(200, {
      GROQ_API_KEY: mask(process.env.GROQ_API_KEY),
      DATA_DIR: process.env.DATA_DIR || 'Local',
      PORT: process.env.PORT || '3000',
      NODE_ENV: process.env.NODE_ENV || 'development'
    });
  }

  if (url.pathname === '/api/system') {
    return send(200, {
      uptime: Math.floor((Date.now() - startTime) / 1000),
      mem: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      active: Object.keys(activeTokens).length,
      total: readTokens().length
    });
  }
  send(404, { error: 'Not found' });
});

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Soulzy Control</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233b82f6'/%3E%3Cpath d='M17 5L8 18h6l-1 9 9-13h-6l1-9z' fill='white'/%3E%3C/svg%3E" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#080d18;--bg-2:#0b1220;--panel:#0f1729;--panel-2:#131d33;--card:#111a2e;--border:#1e2a44;--border-hi:#2d3e5f;--accent:#3b82f6;--accent-2:#60a5fa;--accent-light:#93c5fd;--accent-soft:rgba(59,130,246,.12);--text:#e6edf7;--text-2:#94a3b8;--text-3:#5f7291;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',system-ui,sans-serif;color:var(--text);background:var(--bg);font-size:14px;overflow:hidden}
#bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(59,130,246,.10),transparent 70%),radial-gradient(ellipse 60% 50% at 100% 100%,rgba(96,165,250,.08),transparent 60%),linear-gradient(180deg,var(--bg),var(--bg-2))}
header{position:fixed;top:0;left:0;right:0;height:64px;z-index:100;display:flex;align-items:center;gap:16px;padding:0 24px;background:rgba(11,18,32,.88);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:12px;font-size:17px;font-weight:700}
.logo img{width:34px;height:34px;filter:drop-shadow(0 4px 12px rgba(59,130,246,.5))}
.logo-text{background:linear-gradient(135deg,#fff,#93c5fd);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.dev-badge{font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:var(--accent-light);font-weight:600;text-transform:uppercase}
.spacer{flex:1}
.hdr-btn{padding:9px 16px;border-radius:8px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:8px; text-decoration:none;}
.hdr-btn:hover{background:var(--panel-2);border-color:var(--border-hi)}
.hdr-btn.danger{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:#fca5a5}
.layout{display:flex;height:100vh;padding-top:64px}
aside{width:236px;padding:18px 12px;display:flex;flex-direction:column;gap:2px;border-right:1px solid var(--border);background:rgba(11,18,32,.6);overflow-y:auto}
.sec-label{font-size:10.5px;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--text-3);padding:16px 14px 8px}
.nav-btn{display:flex;align-items:center;gap:12px;padding:10px 14px;border-radius:8px;background:transparent;border:none;color:var(--text-2);font-family:inherit;font-size:13.5px;font-weight:500;cursor:pointer;text-align:left;transition:all .15s;width:100%;position:relative}
.nav-btn:hover{background:var(--panel);color:var(--text)}
.nav-btn.active{background:linear-gradient(90deg,rgba(59,130,246,.18),rgba(59,130,246,.06));color:var(--accent-light)}
.nav-btn.active::before{content:'';position:absolute;left:0;top:20%;bottom:20%;width:3px;background:linear-gradient(180deg,#60a5fa,#3b82f6);border-radius:0 3px 3px 0}
.nav-btn img{width:18px;height:18px;opacity:.7;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.nav-btn.active img{opacity:1}
main{flex:1;overflow-y:auto;padding:28px 32px}
main::-webkit-scrollbar{width:8px}main::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px}
.tab-panel{display:none}.tab-panel.active{display:block;animation:tabIn .25s ease}
@keyframes tabIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.page-head{margin-bottom:24px;display:flex;align-items:center;gap:16px}
.page-icon{width:44px;height:44px;padding:10px;background:linear-gradient(135deg,rgba(59,130,246,.2),rgba(59,130,246,.05));border:1px solid rgba(59,130,246,.25);border-radius:12px;display:flex;align-items:center;justify-content:center}
.page-icon img{width:24px;height:24px;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.page-title{font-size:22px;font-weight:700;letter-spacing:-.02em;margin-bottom:2px}
.page-desc{font-size:13px;color:var(--text-2)}
.grid{display:grid;gap:14px;grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:14px;}
.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px}
.card-title{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:10px}
.card-title img{width:16px;height:16px;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.stat{background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--border);border-radius:12px;padding:18px;position:relative;overflow:hidden}
.stat-icon{position:absolute;top:14px;right:14px;width:28px;height:28px;opacity:.35;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.stat-label{font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px}
.stat-value{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1}
.stat-sub{font-size:11.5px;color:var(--text-3);margin-top:8px}
table{width:100%;border-collapse:collapse;}
th{text-align:left;padding:10px;color:var(--text-3);font-size:12px;border-bottom:1px solid var(--border);}
td{padding:10px;border-bottom:1px solid var(--border);font-size:14px;vertical-align:middle;}
.avatar{width:32px;height:32px;border-radius:50%;background:#222;display:inline-block;vertical-align:middle;margin-right:10px;}
.badge{padding:4px 8px;border-radius:4px;font-size:11px;font-weight:bold;}
.badge.on{background:rgba(34,197,94,.2);color:var(--ok);}
.badge.off{background:rgba(239,68,68,.2);color:var(--bad);}
.badge.nitro{background:rgba(234,88,12,0.2);color:#f97316;}
textarea{width:100%;height:120px;background:var(--bg);color:var(--text);border:1px solid var(--border);padding:10px;font-family:'JetBrains Mono',monospace;outline:none;margin-bottom:10px;border-radius:8px;}
.btn{padding:8px 16px;border-radius:6px;border:none;cursor:pointer;font-weight:bold;font-size:13px;}
.btn.blue{background:var(--accent);color:#fff;}
.btn.gray{background:var(--panel-2);color:var(--text);border:1px solid var(--border);}
.kv{display:flex;justify-content:space-between;padding:10px;border-bottom:1px solid var(--border);}
#chat-output{height:400px;overflow-y:auto;background:var(--bg);padding:15px;border-radius:8px;font-family:'JetBrains Mono',monospace;font-size:12.5px;color:var(--ok);white-space:pre-wrap;border:1px solid var(--border);}
#login-screen{position:fixed;inset:0;background:var(--bg);z-index:999;display:flex;align-items:center;justify-content:center;}
.login-box{background:var(--panel);padding:40px;border-radius:12px;border:1px solid var(--border);width:320px;text-align:center;}
input{width:100%;padding:10px;background:var(--bg-2);color:var(--text);border:1px solid var(--border);border-radius:6px;outline:none;margin-bottom:10px;}
</style></head>
<body>
<div id="bg"></div>

<div id="login-screen">
  <div class="login-box">
    <h2 style="color:var(--accent);margin-bottom:20px;">Soulzy Auth</h2>
    <input type="text" id="login-user" placeholder="Username">
    <input type="password" id="login-pass" placeholder="Password">
    <button class="btn blue" style="width:100%;padding:12px;" onclick="doLogin()">Login</button>
  </div>
</div>

<header style="display:none;" id="top-header">
  <div class="logo"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/blender.svg" alt=""><span class="logo-text">soulzy</span><span class="dev-badge">dev: loco</span></div>
  <div class="spacer"></div>
  <a href="/" class="hdr-btn danger"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/power.svg" style="width:16px;filter:invert(63%) sepia(38%) saturate(1486%) hue-rotate(313deg) brightness(102%) contrast(97%)"> Logout</a>
</header>

<div class="layout" id="main-layout" style="display:none;">
  <aside>
    <div class="sec-label">Main</div>
    <button class="nav-btn active" onclick="showTab('overview', this)"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/datadog.svg">Overview</button>
    <button class="nav-btn" onclick="showTab('users', this)"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg">Users</button>
    <button class="nav-btn" onclick="showTab('nitro', this)"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg">Nitro Checker</button>
    <button class="nav-btn" onclick="showTab('autochat', this)"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/chatbot.svg">Auto Chat</button>
    <div class="sec-label">System</div>
    <button class="nav-btn" onclick="showTab('config', this)"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/gnometerminal.svg">Config</button>
  </aside>
  <main>
    <section class="tab-panel active" id="tab-overview">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/datadog.svg"></div><div><h1 class="page-title">Overview</h1><p class="page-desc">System and token farm status</p></div></div>
      <div class="grid">
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg"><div class="stat-label">Tokens</div><div class="stat-value" id="sys-total">0</div><div class="stat-sub">Total loaded</div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/playstation.svg"><div class="stat-label">Active</div><div class="stat-value" id="sys-active">0</div><div class="stat-sub">Running</div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/clockify.svg"><div class="stat-label">Uptime</div><div class="stat-value" id="sys-up">-</div><div class="stat-sub">Process time</div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/raspberrypi.svg"><div class="stat-label">Memory</div><div class="stat-value" id="sys-mem">-</div><div class="stat-sub">RAM Usage</div></div>
      </div>
    </section>

    <section class="tab-panel" id="tab-users">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg"></div><div><h1 class="page-title">Users</h1><p class="page-desc">Manage and start tokens</p></div></div>
      <div class="card">
        <table><thead><tr><th>User</th><th>Token</th><th>Status</th><th>Uptime</th><th>Action</th></tr></thead>
        <tbody id="token-list"></tbody></table>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title">Edit Tokens (One per line)</div></div>
        <textarea id="token-input" placeholder="OTIzODk..."></textarea>
        <button class="btn blue" onclick="saveTokens()">Save & Load</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-nitro">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg"></div><div><h1 class="page-title">Nitro Checker</h1><p class="page-desc">Scan accounts for active trials</p></div></div>
      <div class="card"><button class="btn blue" onclick="runChecker()">Run Check</button></div>
      <div class="card">
        <table><thead><tr><th>User</th><th>Token</th><th>Valid</th><th>Nitro</th></tr></thead>
        <tbody id="nitro-list"><tr><td colspan="4" style="text-align:center;color:var(--text-3);">Click Run Check</td></tr></tbody></table>
      </div>
    </section>

    <section class="tab-panel" id="tab-autochat">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/chatbot.svg"></div><div><h1 class="page-title">Auto Chat</h1><p class="page-desc">Generate 100 realistic messages via Groq</p></div></div>
      <div class="card">
        <div class="card-head">
          <div class="card-title">Generated Messages (autochat.txt)</div>
          <div style="display:flex;gap:8px;">
            <button class="btn gray" onclick="loadChat()">Reload File</button>
            <button class="btn blue" onclick="genChat()">Generate 100</button>
          </div>
        </div>
        <div id="chat-output">No chats loaded.</div>
      </div>
    </section>

    <section class="tab-panel" id="tab-config">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/gnometerminal.svg"></div><div><h1 class="page-title">Config</h1><p class="page-desc">Environment Variables</p></div></div>
      <div class="card"><div id="config-list"></div></div>
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
    loadSys(); loadTokens(); loadConfig(); loadChat();
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
  document.getElementById('sys-up').innerText = Math.floor(d.uptime/60) + 'm';
  document.getElementById('sys-mem').innerText = d.mem;
}
async function loadTokens() {
  const res = await fetch('/api/tokens'); if(!res.ok) return;
  cachedTokens = await res.json();
  document.getElementById('token-list').innerHTML = cachedTokens.map(t => \`
    <tr>
      <td><img src="\${t.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="avatar"> \${t.username}</td>
      <td style="font-family:monospace;color:var(--text-2);">\${t.token}</td>
      <td><span class="badge \${t.status === 'running' ? 'on' : 'off'}">\${t.status}</span></td>
      <td>\${t.uptime > 0 ? Math.floor(t.uptime/60)+'m '+(t.uptime%60)+'s' : '-'}</td>
      <td><button class="btn \${t.status === 'running' ? 'gray' : 'blue'}" onclick="toggle('\${t.rawToken}', '\${t.status === 'running' ? 'stop' : 'start'}')">\${t.status === 'running' ? 'Stop' : 'Start'}</button></td>
    </tr>
  \`).join('') || '<tr><td colspan="5" style="text-align:center;">No tokens loaded.</td></tr>';
  document.getElementById('token-input').value = cachedTokens.map(t => t.rawToken).join('\\n');
}
async function toggle(token, action) { await fetch('/api/toggle', { method:'POST', body: JSON.stringify({ token, action }) }); loadTokens(); loadSys(); }
async function saveTokens() { await fetch('/api/tokens', { method:'POST', body: JSON.stringify({ tokens: document.getElementById('token-input').value.split('\\n').filter(l => l.trim()) }) }); loadTokens(); loadSys(); }
async function runChecker() {
  const tbody = document.getElementById('nitro-list');
  tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">Scanning...</td></tr>';
  await loadTokens();
  tbody.innerHTML = cachedTokens.map(t => \`
    <tr><td><img src="\${t.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="avatar"> \${t.username}</td>
    <td style="font-family:monospace;color:var(--text-2);">\${t.token}</td>
    <td><span class="badge \${t.valid ? 'on' : 'off'}">\${t.valid ? 'Yes' : 'No'}</span></td>
    <td><span class="badge \${t.nitro ? 'nitro' : ''}">\${t.nitroType}</span></td></tr>
  \`).join('');
}
async function genChat() {
  const out = document.getElementById('chat-output');
  out.innerText = 'Generating...';
  const res = await fetch('/api/autochat/generate', { method:'POST' });
  const d = await res.json();
  out.innerText = d.error ? 'Error: ' + d.error : d.content;
}
async function loadChat() {
  const res = await fetch('/api/autochat/read');
  const d = await res.json();
  document.getElementById('chat-output').innerText = d.content || 'File is empty. Click generate.';
}
async function loadConfig() {
  const res = await fetch('/api/config'); if(!res.ok) return;
  const d = await res.json();
  document.getElementById('config-list').innerHTML = Object.entries(d).map(([k, v]) => \`<div class="kv"><span>\${k}</span><span style="font-family:monospace;color:var(--accent);">\${v}</span></div>\`).join('');
}
setInterval(() => { if(document.getElementById('main-layout').style.display !== 'none') loadSys(); }, 3000);
</script>
</body></html>`;

server.listen(PORT, '0.0.0.0', () => console.log('Running on ' + PORT));
