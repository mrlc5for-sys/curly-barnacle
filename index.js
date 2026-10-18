const http = require('http');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
require('dotenv').config();

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || __dirname;
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.txt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');

const spoofer = require('./cogs/deviceSpoofer');
const autochatCog = require('./cogs/autochat');
const rpcCog = require('./cogs/rpc');
const joinerCog = require('./cogs/joiner');
const questsCog = require('./cogs/quests');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '');
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify({ status: 'online', customStatus: '', botOnline: 'on' }));

const activeTokens = {};
const startTime = Date.now();

function readTokens() {
  const raw = fs.readFileSync(TOKENS_FILE, 'utf8').trim();
  return raw ? raw.split('\n').map(t => t.trim()).filter(Boolean) : [];
}
function saveTokens(tokens) { fs.writeFileSync(TOKENS_FILE, tokens.join('\n')); }
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
      nitroType: user.premium_type === 2 ? 'Nitro' : (user.premium_type === 1 ? 'Classic' : (user.premium_type === 3 ? 'Basic' : 'None')),
      emailVerified: user.verified
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

  if (url.pathname === '/' && req.method === 'GET') { 
    res.writeHead(200, { 'Content-Type': 'text/html' }); 
    return res.end(HTML); 
  }

  if (url.pathname.startsWith('/api')) {
    const cookie = req.headers.cookie || '';
    if (!cookie.includes('session=auth')) return send(401, { error: 'Unauthorized' });
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

  if (url.pathname === '/api/spoofer') {
    return send(200, spoofer.generateProfile());
  }

  if (url.pathname === '/api/autochat/generate' && req.method === 'POST') {
    try { send(200, { ok: true, content: await autochatCog.generate100Chats() }); } 
    catch (e) { send(500, { error: e.message }); }
    return;
  }

  if (url.pathname === '/api/rpc/generate' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      try { send(200, await rpcCog.generateRpc(JSON.parse(body).prompt)); } 
      catch (e) { send(500, { error: e.message }); }
    });
    return;
  }

  if (url.pathname === '/api/joiner' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', async () => {
      const { invite, captcha } = JSON.parse(body);
      const logs = [];
      await joinerCog.joinServers(invite, readTokens(), captcha, (msg) => logs.push(msg));
      send(200, { logs });
    });
    return;
  }

  if (url.pathname === '/api/quests' && req.method === 'POST') {
    const logs = [];
    await questsCog.startQuests(readTokens(), (msg) => logs.push(msg));
    return send(200, { logs });
  }

  if (url.pathname === '/api/config' && req.method === 'GET') {
    const mask = (str) => str ? str.substring(0, 6) + '...' + str.slice(-4) : 'Not Set';
    return send(200, {
      env: { GROQ_API_KEY: mask(process.env.GROQ_API_KEY), CAPTCHA_API_KEY: mask(process.env.CAPTCHA_API_KEY), DATA_DIR: process.env.DATA_DIR || 'Local' },
      config: readConfig()
    });
  }

  if (url.pathname === '/api/config' && req.method === 'POST') {
    let body = ''; req.on('data', c => body += c);
    req.on('end', () => { saveConfig(JSON.parse(body)); send(200, { ok: true }); });
    return;
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
<title>Soulzy Control</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono&display=swap" rel="stylesheet">
<style>
:root{--bg:#060910;--bg-2:#0a101d;--panel:rgba(15,23,42,0.6);--border:rgba(59,130,246,0.15);--accent:#3b82f6;--accent-2:#60a5fa;--text:#f8fafc;--text-2:#94a3b8;--ok:#22c55e;--bad:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:'Inter',sans-serif;color:var(--text);background:var(--bg);font-size:14px;overflow:hidden;height:100vh}
#bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(circle at 15% 50%, rgba(59,130,246,0.08), transparent 25%),radial-gradient(circle at 85% 30%, rgba(96,165,250,0.08), transparent 25%),var(--bg)}
.orb{position:absolute;border-radius:50%;filter:blur(80px);z-index:-1;opacity:0.4;animation:float 10s infinite ease-in-out alternate}
.orb-1{width:400px;height:400px;background:#3b82f6;top:-100px;left:-100px}
.orb-2{width:300px;height:300px;background:#8b5cf6;bottom:-50px;right:10%}
@keyframes float{0%{transform:translateY(0) scale(1)}100%{transform:translateY(50px) scale(1.1)}}
#login-screen{position:fixed;inset:0;z-index:999;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(10px)}
.login-box{background:var(--panel);padding:50px 40px;border-radius:24px;border:1px solid var(--border);width:360px;text-align:center;box-shadow:0 25px 50px -12px rgba(0,0,0,0.5);backdrop-filter:blur(20px)}
.login-box h2{font-size:24px;font-weight:800;margin-bottom:30px;background:linear-gradient(135deg,#fff,#60a5fa);-webkit-background-clip:text;color:transparent}
input{width:100%;padding:14px 16px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);border-radius:12px;outline:none;margin-bottom:16px;font-family:inherit;transition:all 0.2s}
input:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,0.2)}
.btn{padding:14px;border-radius:12px;border:none;cursor:pointer;font-weight:600;font-size:14px;transition:all 0.2s;background:linear-gradient(135deg,var(--accent),#2563eb);color:#fff;width:100%}
.btn:hover{transform:translateY(-2px);box-shadow:0 10px 20px -10px var(--accent)}
header{position:fixed;top:0;left:0;right:0;height:70px;z-index:100;display:flex;align-items:center;gap:16px;padding:0 32px;background:rgba(6,9,16,0.8);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:12px;font-size:18px;font-weight:800}
.logo svg{width:28px;height:28px;fill:var(--accent);filter:drop-shadow(0 0 10px rgba(59,130,246,0.5))}
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
.stat{background:linear-gradient(180deg,rgba(30,41,59,0.6),rgba(15,23,42,0.6));border:1px solid var(--border);border-radius:16px;padding:24px;position:relative;backdrop-filter:blur(20px)}
.stat svg{position:absolute;top:24px;right:24px;width:32px;height:32px;fill:var(--accent);opacity:0.3}
.stat-label{font-size:12px;font-weight:600;color:var(--text-2);text-transform:uppercase;margin-bottom:12px;letter-spacing:0.05em}
.stat-value{font-size:32px;font-weight:800;line-height:1}
table{width:100%;border-collapse:collapse;}
th{text-align:left;padding:14px;color:var(--text-2);font-size:12px;font-weight:700;text-transform:uppercase;border-bottom:1px solid var(--border);}
td{padding:14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px;}
.avatar{width:36px;height:36px;border-radius:50%;background:#222;display:inline-block;vertical-align:middle;margin-right:12px;}
.badge{padding:6px 10px;border-radius:6px;font-size:12px;font-weight:700;}
.badge.on{background:rgba(34,197,94,0.15);color:var(--ok);}
.badge.off{background:rgba(239,68,68,0.15);color:var(--bad);}
.badge.nitro{background:rgba(234,88,12,0.15);color:#f97316;}
textarea{width:100%;padding:16px;background:rgba(0,0,0,0.3);color:var(--text);border:1px solid var(--border);border-radius:12px;outline:none;margin-bottom:16px;font-family:'JetBrains Mono',monospace;height:120px;resize:vertical;}
.btn-blue{padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600;font-size:14px;background:var(--accent);color:#fff;transition:all 0.2s}
.btn-blue:hover{background:#2563eb}
.btn-gray{padding:10px 20px;border-radius:8px;border:1px solid var(--border);cursor:pointer;font-weight:600;font-size:14px;background:transparent;color:var(--text);transition:all 0.2s}
.btn-gray:hover{background:rgba(255,255,255,0.05)}
.kv{display:flex;justify-content:space-between;padding:14px;border-bottom:1px solid rgba(255,255,255,0.05);font-size:14px}
.kv:last-child{border-bottom:none}
.kv span:first-child{color:var(--text-2);font-weight:600}
.kv span:last-child{font-family:'JetBrains Mono',monospace;color:var(--accent-2)}
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
  <div class="logo">
    <svg viewBox="0 0 24 24"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
    <span class="logo-text">Soulzy</span>
  </div>
  <div class="spacer"></div>
  <a href="/" class="hdr-btn">
    <svg style="width:16px;height:16px;fill:currentColor" viewBox="0 0 24 24"><path d="M16 13v-2H7V8l-5 4 5 4v-3zM20 3h-8v2h8v14h-8v2h8a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z"/></svg> Logout
  </a>
</header>

<div class="layout" id="main-layout" style="display:none;">
  <aside>
    <div class="sec-label">Main</div>
    <button class="nav-btn active" onclick="showTab('overview', this)"><svg viewBox="0 0 24 24"><path d="M3 3h8v8H3V3zm10 0h8v8h-8V3zM3 13h8v8H3v-8zm10 0h8v8h-8v-8z"/></svg>Overview</button>
    <button class="nav-btn" onclick="showTab('tokens', this)"><svg viewBox="0 0 24 24"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>Tokens</button>
    <button class="nav-btn" onclick="showTab('validator', this)"><svg viewBox="0 0 24 24"><path d="M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm-2 16l-4-4 1.41-1.41L10 14.17l6.59-6.59L18 9l-8 8z"/></svg>Validator</button>
    <button class="nav-btn" onclick="showTab('autochat', this)"><svg viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>Auto Chat</button>
    <button class="nav-btn" onclick="showTab('rpc', this)"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><path d="M11 7h2v5.41l3.29 3.3-1.41 1.41L11 13.17z"/></svg>RPC Pool</button>
    <div class="sec-label">Actions</div>
    <button class="nav-btn" onclick="showTab('joiner', this)"><svg viewBox="0 0 24 24"><path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z"/></svg>Server Joiner</button>
    <button class="nav-btn" onclick="showTab('quests', this)"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/></svg>Auto Quest</button>
    <button class="nav-btn" onclick="showTab('spoofer', this)"><svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 9h-2V7h-2v5H6v2h2v5h2v-5h2v-2z"/></svg>Device Spoofer</button>
    <div class="sec-label">System</div>
    <button class="nav-btn" onclick="showTab('status', this)"><svg viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"/><circle cx="12" cy="12" r="4"/></svg>Status</button>
    <button class="nav-btn" onclick="showTab('bot', this)"><svg viewBox="0 0 24 24"><path d="M20 9V7c0-1.1-.9-2-2-2h-3c0-1.66-1.34-3-3-3S9 3.34 9 5H6c-1.1 0-2 .9-2 2v2c-1.66 0-3 1.34-3 3s1.34 3 3 3v4c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2v-4c1.66 0 3-1.34 3-3s-1.34-3-3-3zM7.5 11.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5S9.83 13 9 13s-1.5-.67-1.5-1.5zM16 17H8v-2h8v2zm-1-4c-.83 0-1.5-.67-1.5-1.5S14.17 10 15 10s1.5.67 1.5 1.5S15.83 13 15 13z"/></svg>Bot Control</button>
    <button class="nav-btn" onclick="showTab('config', this)"><svg viewBox="0 0 24 24"><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>Config</button>
  </aside>

  <main>
    <section class="tab-panel active" id="tab-overview">
      <div class="page-head"><h1 class="page-title">Overview</h1><p class="page-desc">System and token farm status</p></div>
      <div class="grid">
        <div class="stat"><svg viewBox="0 0 24 24"><path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65zM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg><div class="stat-label">Total Tokens</div><div class="stat-value" id="sys-total">0</div></div>
        <div class="stat"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg><div class="stat-label">Active</div><div class="stat-value" id="sys-active">0</div></div>
        <div class="stat"><svg viewBox="0 0 24 24"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg><div class="stat-label">Uptime</div><div class="stat-value" id="sys-up">-</div></div>
        <div class="stat"><svg viewBox="0 0 24 24"><path d="M15 9H9v6h6V9zm-2 4h-2v-2h2v2zm8-2V9h-2V7c0-1.1-.9-2-2-2h-2V3h-2v2h-2V3H9v2H7c-1.1 0-2 .9-2 2v2H3v2h2v2H3v2h2v2c0 1.1.9 2 2 2h2v2h2v-2h2v2h2v-2h2c1.1 0 2-.9 2-2v-2h2v-2h-2v-2h2zm-4 6H7V7h10v10z"/></svg><div class="stat-label">Memory</div><div class="stat-value" id="sys-mem">-</div></div>
      </div>
    </section>

    <section class="tab-panel" id="tab-tokens">
      <div class="page-head"><h1 class="page-title">Tokens</h1><p class="page-desc">Manage and start tokens</p></div>
      <div class="card">
        <table><thead><tr><th>User</th><th>Token</th><th>Status</th><th>Uptime</th><th>Action</th></tr></thead>
        <tbody id="token-list"></tbody></table>
      </div>
      <div class="card">
        <div class="card-title">Edit Tokens (One per line)</div>
        <textarea id="token-input" placeholder="OTIzODk..."></textarea>
        <button class="btn-blue" onclick="saveTokens()">Save & Load</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-validator">
      <div class="page-head"><h1 class="page-title">Validator</h1><p class="page-desc">Check account status and Nitro trials</p></div>
      <div class="card"><button class="btn-blue" onclick="runChecker()">Run Validation</button></div>
      <div class="card">
        <table><thead><tr><th>User</th><th>Token</th><th>Valid</th><th>Nitro</th></tr></thead>
        <tbody id="nitro-list"><tr><td colspan="4" style="text-align:center;color:var(--text-2);">Click Run Validation</td></tr></tbody></table>
      </div>
    </section>

    <section class="tab-panel" id="tab-autochat">
      <div class="page-head"><h1 class="page-title">Auto Chat</h1><p class="page-desc">Generate 100 realistic messages via Groq</p></div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px;">
          <div class="card-title">Generated Messages (autochat.txt)</div>
          <div style="display:flex;gap:8px;">
            <button class="btn-blue" onclick="genChat()">Generate 100</button>
          </div>
        </div>
        <pre id="chat-output">No chats loaded.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-rpc">
      <div class="page-head"><h1 class="page-title">RPC Generator</h1><p class="page-desc">Groq-powered Rich Presence</p></div>
      <div class="card">
        <div class="card-title">Generate RPC</div>
        <input type="text" id="rpc-prompt" placeholder="Playing Valorant..." style="margin-bottom:16px;">
        <button class="btn-blue" onclick="genRpc()">Generate</button>
        <pre id="rpc-output" style="margin-top:16px;">No RPC generated.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-joiner">
      <div class="page-head"><h1 class="page-title">Server Joiner</h1><p class="page-desc">Mass join servers with Captcha bypass</p></div>
      <div class="card">
        <div class="card-title">Join Config</div>
        <input type="text" id="invite-link" placeholder="discord.gg/invite" style="margin-bottom:16px;">
        <input type="password" id="captcha-key" placeholder="2Captcha API Key (if required)" style="margin-bottom:16px;">
        <button class="btn-blue" onclick="startJoiner()">Start Joiner</button>
        <pre id="joiner-output" style="margin-top:16px;">Ready.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-quests">
      <div class="page-head"><h1 class="page-title">Auto Quest</h1><p class="page-desc">Automate Discord Quests</p></div>
      <div class="card">
        <div class="card-title">Start Questing</div>
        <p style="color:var(--text-2);margin-bottom:16px;">Runs the quest automation on all loaded tokens.</p>
        <button class="btn-blue" onclick="startQuests()">Start Quests</button>
        <pre id="quests-output" style="margin-top:16px;">Idle.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-spoofer">
      <div class="page-head"><h1 class="page-title">Device Spoofer</h1><p class="page-desc">Generate realistic device signatures</p></div>
      <div class="card">
        <button class="btn-blue" onclick="genSpoofer()">Generate Profile</button>
        <pre id="spoofer-output" style="margin-top:16px;">Click Generate.</pre>
      </div>
    </section>

    <section class="tab-panel" id="tab-status">
      <div class="page-head"><h1 class="page-title">Status</h1><p class="page-desc">Control bot presence and activity</p></div>
      <div class="card">
        <div class="card-title">Presence Settings</div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:8px;color:var(--text-2);">Status</label>
          <select id="status-select" style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:8px;color:#fff;outline:none;">
            <option value="online">Online</option>
            <option value="idle">Idle</option>
            <option value="dnd">Do Not Disturb</option>
            <option value="invisible">Invisible</option>
          </select>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:8px;color:var(--text-2);">Custom Status Text</label>
          <input type="text" id="custom-status" placeholder="chilling...">
        </div>
        <button class="btn-blue" onclick="saveStatus()">Save Settings</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-bot">
      <div class="page-head"><h1 class="page-title">Bot Control</h1><p class="page-desc">Manage the main Discord bot instance</p></div>
      <div class="card">
        <div class="card-title">Bot Configuration</div>
        <div style="margin-bottom:16px;">
          <label style="display:block;margin-bottom:8px;color:var(--text-2);">Bot Status</label>
          <select id="bot-online" style="width:100%;padding:12px;background:rgba(0,0,0,0.3);border:1px solid var(--border);border-radius:8px;color:#fff;outline:none;">
            <option value="on">Enabled</option>
            <option value="off">Disabled</option>
          </select>
        </div>
        <button class="btn-blue" onclick="saveBot()">Save Config</button>
      </div>
    </section>

    <section class="tab-panel" id="tab-config">
      <div class="page-head"><h1 class="page-title">Config</h1><p class="page-desc">Environment & System Variables</p></div>
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
  document.getElementById('sys-up').innerText = Math.floor(d.uptime/60) + 'm';
  document.getElementById('sys-mem').innerText = d.mem;
}
async function loadTokens() {
  const res = await fetch('/api/tokens'); if(!res.ok) return;
  cachedTokens = await res.json();
  document.getElementById('token-list').innerHTML = cachedTokens.map(t => \`
    <tr>
      <td><img src="\${t.avatar || 'https://cdn.discordapp.com/embed/avatars/0.png'}" class="avatar"> \${t.username}</td>
      <td style="font-family:'JetBrains Mono';color:var(--text-2);">\${t.token}</td>
      <td><span class="badge \${t.status === 'running' ? 'on' : 'off'}">\${t.status}</span></td>
      <td>\${t.uptime > 0 ? Math.floor(t.uptime/60)+'m '+(t.uptime%60)+'s' : '-'}</td>
      <td><button class="btn-\${t.status === 'running' ? 'gray' : 'blue'}" onclick="toggle('\${t.rawToken}', '\${t.status === 'running' ? 'stop' : 'start'}')">\${t.status === 'running' ? 'Stop' : 'Start'}</button></td>
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
    <td style="font-family:'JetBrains Mono';color:var(--text-2);">\${t.token}</td>
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
async function genRpc() {
  const prompt = document.getElementById('rpc-prompt').value;
  const out = document.getElementById('rpc-output');
  out.innerText = 'Generating...';
  const res = await fetch('/api/rpc/generate', { method:'POST', body: JSON.stringify({ prompt }) });
  const d = await res.json();
  out.innerText = d.error ? 'Error: ' + d.error : JSON.stringify(d, null, 2);
}
async function startJoiner() {
  const invite = document.getElementById('invite-link').value;
  const captcha = document.getElementById('captcha-key').value;
  const out = document.getElementById('joiner-output');
  out.innerText = 'Starting...';
  const res = await fetch('/api/joiner', { method:'POST', body: JSON.stringify({ invite, captcha }) });
  const d = await res.json();
  out.innerText = d.logs.join('\\n');
}
async function startQuests() {
  const out = document.getElementById('quests-output');
  out.innerText = 'Starting...';
  const res = await fetch('/api/quests', { method:'POST' });
  const d = await res.json();
  out.innerText = d.logs.join('\\n');
}
async function genSpoofer() {
  const out = document.getElementById('spoofer-output');
  const res = await fetch('/api/spoofer');
  const d = await res.json();
  out.innerText = JSON.stringify(d, null, 2);
}
async function saveStatus() {
  const s = document.getElementById('status-select').value;
  const c = document.getElementById('custom-status').value;
  await fetch('/api/config', { method: 'POST', body: JSON.stringify({ status: s, customStatus: c, botOnline: 'on' }) });
  alert('Status saved');
}
async function saveBot() {
  const b = document.getElementById('bot-online').value;
  await fetch('/api/config', { method: 'POST', body: JSON.stringify({ status: 'online', customStatus: '', botOnline: b }) });
  alert('Bot config saved');
}
async function loadConfig() {
  const res = await fetch('/api/config'); if(!res.ok) return;
  const d = await res.json();
  document.getElementById('config-list').innerHTML = Object.entries(d.env).map(([k, v]) => \`<div class="kv"><span>\${k}</span><span>\${v}</span></div>\`).join('');
  if(d.config) {
    document.getElementById('status-select').value = d.config.status || 'online';
    document.getElementById('custom-status').value = d.config.customStatus || '';
    document.getElementById('bot-online').value = d.config.botOnline || 'on';
  }
}
setInterval(() => { if(document.getElementById('main-layout').style.display !== 'none') loadSys(); }, 3000);
</script>
</body></html>`;

server.listen(PORT, '0.0.0.0', () => console.log('Running on ' + PORT));
