const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
require('dotenv').config();

const PORT = process.env.PORT || process.env.DASHBOARD_PORT || 3000;
const DEV = process.env.DEV_NAME || 'loco';
const DATA_DIR = process.env.DATA_DIR || __dirname;
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const TOKENS_FILE = path.join(DATA_DIR, 'tokens.txt');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const START = Date.now();
const NL = String.fromCharCode(10);

const CLIENT_ID = process.env.DISCORD_CLIENT_ID || '1561289677858803803';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'https://soulzy.org/api/auth/callback';
const OWNER_ID = process.env.DISCORD_OWNER_ID || '';

const sessions = new Set();

const DEFAULT_CONFIG = {
  groqKey: '', model: 'llama-3.3-70b-versatile', fallbackModel: 'llama-3.1-8b-instant',
  maxPerHour: 30, quietStart: '01:00', quietEnd: '08:00',
  jitterMin: 1200, jitterMax: 4000,
  status: 'online', statusMode: 'fixed', statusInterval: 120,
  statusPool: ['online', 'idle', 'dnd', 'invisible'],
  statusChanger: 'off', tokenStatusOverrides: {},
  customStatus: '', activityType: 'Playing', activityName: '', streamUrl: '',
  guildId: '', textChannelId: '',
  vcGuildId: '', vcChannelId: '', vcMode: 'specific', vcAutoLeave: 0, cameraOn: false,
  inviteLink: '', joinerDelay: 5, captchaApiKey: '',
  questAutoAccept: false, questAutoClaim: false, questDelay: 10,
  botOnline: 'on', ownerId: '',
  rpcs: [], rpcAssignments: {}
};

if (!fs.existsSync(TOKENS_FILE)) fs.writeFileSync(TOKENS_FILE, '');
if (!fs.existsSync(CONFIG_FILE)) fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2));

const sseClients = new Set();
function log(level, event, detail) {
  const entry = { t: Date.now(), level, event, detail: detail || '' };
  const msg = 'event: log' + NL + 'data: ' + JSON.stringify(entry) + NL + NL;
  for (const r of sseClients) { try { r.write(msg); } catch (e) {} }
}
function readTokens() {
  return fs.readFileSync(TOKENS_FILE, 'utf8').split(NL).map(l => l.trim()).filter(Boolean).map(line => {
    const p = line.split('|');
    return { label: p[0] || '', token: p[1] || '', proxy: p[2] || '' };
  });
}
function writeTokens(list) {
  fs.writeFileSync(TOKENS_FILE, list.map(t => t.label + '|' + t.token + '|' + (t.proxy || '')).join(NL));
}
function readConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); }
  catch (e) { return JSON.parse(JSON.stringify(DEFAULT_CONFIG)); }
}
function writeConfig(c) { fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2)); }
function sendJSON(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); }
function readBody(req) {
  return new Promise(resolve => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}

function getSession(req) {
  const cookie = req.headers.cookie || '';
  const match = cookie.match(/soulzy_token=([^;]+)/);
  if (match && sessions.has(match[1])) return match[1];
  return null;
}

async function generateRpc() {
  try {
    const rpc = require('./cogs/rpc');
    return await rpc.generate(process.env);
  } catch (e) { return null; }
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  const p = u.pathname;
  const session = getSession(req);

  if (p === '/login') {
    const url = `https://discord.com/api/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=identify`;
    res.writeHead(302, { Location: url });
    return res.end();
  }

  if (p === '/api/auth/callback') {
    const code = u.searchParams.get('code');
    if (!code) return res.end('No code provided');

    try {
      const body = new URLSearchParams({
        client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code', code: code, redirect_uri: REDIRECT_URI
      });
      const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST', body: body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      });
      const tokenData = await tokenRes.json();
      
      if (tokenData.error) return res.end('Auth failed: ' + tokenData.error_description);
      
      const userRes = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const user = await userRes.json();

      if (user.id !== OWNER_ID) {
        log('warn', 'auth', `Blocked login attempt from ${user.username} (${user.id})`);
        return res.end('Unauthorized: You are not the owner.');
      }

      const sessionToken = crypto.randomBytes(32).toString('hex');
      sessions.add(sessionToken);
      
      res.writeHead(302, {
        'Set-Cookie': `soulzy_token=${sessionToken}; HttpOnly; Path=/; Max-Age=604800; SameSite=Lax`,
        'Location': '/'
      });
      log('ok', 'auth', `Owner logged in: ${user.username}`);
      return res.end();
    } catch (e) {
      return res.end('Auth error: ' + e.message);
    }
  }

  if (p === '/api/auth/logout') {
    if (session) sessions.delete(session);
    res.writeHead(302, { 'Set-Cookie': 'soulzy_token=; Path=/; Max-Age=0', 'Location': '/login' });
    return res.end();
  }

  if (!session) {
    if (p.startsWith('/api/')) return sendJSON(res, 401, { error: 'unauthorized' });
    res.writeHead(302, { Location: '/login' });
    return res.end();
  }

  if (req.method === 'GET' && p === '/') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(HTML); return; }
  if (req.method === 'GET' && p === '/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000' + NL + NL);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  if (req.method === 'GET' && p === '/api/system') {
    const mem = process.memoryUsage(), total = os.totalmem(), free = os.freemem();
    return sendJSON(res, 200, {
      platform: os.platform(), arch: os.arch(), hostname: os.hostname(),
      cpus: os.cpus().length, cpuModel: (os.cpus()[0] || {}).model || 'unknown',
      sysUptime: os.uptime(), procUptime: Math.floor((Date.now() - START) / 1000),
      totalMem: total, freeMem: free, usedMem: total - free,
      memPct: Math.round(((total - free) / total) * 100),
      rss: mem.rss, heapUsed: mem.heapUsed, heapTotal: mem.heapTotal,
      nodeVer: process.version, load: os.loadavg(), dev: DEV,
      dataDir: DATA_DIR, tokenCount: readTokens().length, sseClients: sseClients.size
    });
  }
  if (req.method === 'GET' && p === '/api/tokens') return sendJSON(res, 200, readTokens());
  if (req.method === 'POST' && p === '/api/tokens') {
    const body = await readBody(req);
    writeTokens(Array.isArray(body.list) ? body.list : []);
    log('ok', 'tokens.save', (body.list || []).length + ' tokens');
    return sendJSON(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/tokens/add') {
    const body = await readBody(req);
    const list = readTokens();
    list.push({ label: body.label || '', token: body.token || '', proxy: body.proxy || '' });
    writeTokens(list);
    log('ok', 'tokens.add', body.label || 'unnamed');
    return sendJSON(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/api/config') return sendJSON(res, 200, readConfig());
  if (req.method === 'POST' && p === '/api/config') {
    const body = await readBody(req);
    writeConfig(body);
    log('ok', 'config.save', 'configuration updated');
    return sendJSON(res, 200, { ok: true });
  }
  if (req.method === 'POST' && p === '/api/rpc/generate') {
    const rpc = await generateRpc();
    if (rpc) log('ok', 'rpc.generated', rpc.name);
    return sendJSON(res, 200, rpc || { ok: false });
  }
  if (req.method === 'POST' && p === '/api/action') {
    const body = await readBody(req);
    const action = body.action || 'unknown';
    log('info', 'action.' + action, body.payload ? JSON.stringify(body.payload) : '');
    
    if (action === 'joiner.join') {
      const c = readConfig(); const t = readTokens();
      require('./cogs/joiner').joinServers(c.inviteLink, t, c.joinerDelay, c.captchaApiKey, (msg) => log('info', 'joiner', msg));
    }
    if (action === 'quests.start') {
      const c = readConfig(); const t = readTokens();
      require('./cogs/quests').startQuests(t, c.questAutoAccept, c.questAutoClaim, (msg) => log('info', 'quests', msg));
    }
    return sendJSON(res, 200, { ok: true });
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

const HTML = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Soulzy Control</title>
<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E%3Crect width='32' height='32' rx='8' fill='%233b82f6'/%3E%3Cpath d='M17 5L8 18h6l-1 9 9-13h-6l1-9z' fill='white'/%3E%3C/svg%3E" />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root{--bg:#080d18;--bg-2:#0b1220;--panel:#0f1729;--panel-2:#131d33;--card:#111a2e;--border:#1e2a44;--border-hi:#2d3e5f;--accent:#3b82f6;--accent-2:#60a5fa;--accent-light:#93c5fd;--accent-soft:rgba(59,130,246,.12);--text:#e6edf7;--text-2:#94a3b8;--text-3:#5f7291;--ok:#22c55e;--warn:#f59e0b;--bad:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;overflow:hidden}
body{font-family:'Inter',system-ui,-apple-system,sans-serif;color:var(--text);background:var(--bg);font-size:14px;-webkit-font-smoothing:antialiased}
#bg{position:fixed;inset:0;z-index:-1;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(59,130,246,.10),transparent 70%),radial-gradient(ellipse 60% 50% at 100% 100%,rgba(96,165,250,.08),transparent 60%),linear-gradient(180deg,var(--bg),var(--bg-2))}
header{position:fixed;top:0;left:0;right:0;height:64px;z-index:100;display:flex;align-items:center;gap:16px;padding:0 24px;background:rgba(11,18,32,.88);backdrop-filter:blur(20px);border-bottom:1px solid var(--border)}
.logo{display:flex;align-items:center;gap:12px;font-size:17px;font-weight:700;letter-spacing:-.02em}
.logo img{width:34px;height:34px;filter:drop-shadow(0 4px 12px rgba(59,130,246,.5))}
.logo-text{background:linear-gradient(135deg,#fff,#93c5fd);-webkit-background-clip:text;background-clip:text;color:transparent;font-weight:800}
.dev-badge{font-size:10px;padding:3px 8px;border-radius:6px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.25);color:var(--accent-light);font-weight:600;text-transform:uppercase}
.conn{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:500;color:var(--text-3)}
.conn-dot{width:7px;height:7px;border-radius:50%;background:var(--bad)}
.conn.live .conn-dot{background:var(--ok);animation:pulse 2s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;box-shadow:0 0 8px var(--ok)}50%{opacity:.4;box-shadow:0 0 2px var(--ok)}}
.spacer{flex:1}
.hdr-btn{padding:9px 16px;border-radius:8px;border:1px solid var(--border);background:var(--panel);color:var(--text);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:8px}
.hdr-btn:hover{background:var(--panel-2);border-color:var(--border-hi);transform:translateY(-1px)}
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
.grid{display:grid;gap:14px}
.g-4{grid-template-columns:repeat(4,1fr)}.g-3{grid-template-columns:repeat(3,1fr)}.g-2{grid-template-columns:repeat(2,1fr)}
@media(max-width:1200px){.g-4{grid-template-columns:repeat(2,1fr)}}
@media(max-width:900px){.g-3,.g-2{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--border);border-radius:12px;padding:20px;transition:border-color .15s}
.card:hover{border-color:var(--border-hi)}
.card-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;gap:12px;flex-wrap:wrap}
.card-title{font-size:13.5px;font-weight:600;color:var(--text);display:flex;align-items:center;gap:10px}
.card-title img{width:16px;height:16px;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.card-hint{font-size:11.5px;color:var(--text-3)}
.stat{background:linear-gradient(180deg,var(--panel-2),var(--panel));border:1px solid var(--border);border-radius:12px;padding:18px;position:relative;overflow:hidden}
.stat::after{content:'';position:absolute;top:0;right:0;width:80px;height:80px;background:radial-gradient(circle at top right,var(--accent-soft),transparent 70%)}
.stat-icon{position:absolute;top:14px;right:14px;width:28px;height:28px;opacity:.35;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%)}
.stat-label{font-size:11px;font-weight:500;color:var(--text-3);text-transform:uppercase;letter-spacing:.05em;margin-bottom:8px;position:relative;z-index:1}
.stat-value{font-size:26px;font-weight:700;letter-spacing:-.02em;line-height:1;font-variant-numeric:tabular-nums;position:relative;z-index:1}
.stat-sub{font-size:11.5px;color:var(--text-3);margin-top:8px;position:relative;z-index:1}
.bar{height:6px;background:var(--panel);border-radius:3px;overflow:hidden;margin-top:10px}
.bar-fill{height:100%;background:linear-gradient(90deg,var(--accent),var(--accent-2));border-radius:3px;transition:width .4s ease}
.bar-fill.warn{background:linear-gradient(90deg,var(--warn),#fbbf24)}
.bar-fill.bad{background:linear-gradient(90deg,var(--bad),#f87171)}
label{display:block;font-size:12px;font-weight:500;color:var(--text-2);margin-bottom:6px;margin-top:14px}
label:first-child{margin-top:0}
input,select,textarea{width:100%;padding:9px 12px;background:var(--bg-2);border:1px solid var(--border);border-radius:8px;color:var(--text);font-family:inherit;font-size:13px;outline:none;transition:all .15s}
input:hover,select:hover,textarea:hover{border-color:var(--border-hi)}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
input::placeholder{color:var(--text-3)}
textarea{resize:vertical;min-height:200px;font-family:'JetBrains Mono',monospace;font-size:12.5px;line-height:1.6}
select{cursor:pointer;appearance:none;padding-right:32px;background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2'><polyline points='6 9 12 15 18 9'/></svg>");background-repeat:no-repeat;background-position:right 12px center}
.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;padding:9px 16px;border-radius:8px;background:var(--panel);border:1px solid var(--border);color:var(--text);font-family:inherit;font-size:13px;font-weight:500;cursor:pointer;transition:all .15s}
.btn:hover{background:var(--panel-2);border-color:var(--border-hi);transform:translateY(-1px)}
.btn:active{transform:scale(.98)}
.btn.primary{background:linear-gradient(135deg,#3b82f6,#2563eb);border-color:transparent;color:#fff;box-shadow:0 4px 14px rgba(59,130,246,.3)}
.btn.good{background:rgba(34,197,94,.1);border-color:rgba(34,197,94,.3);color:#4ade80}
.btn.bad{background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3);color:#fca5a5}
.btn img{width:14px;height:14px}
.btn.primary img{filter:brightness(0) invert(1)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}
.row.flat{margin-top:0}
.kv{display:flex;justify-content:space-between;align-items:center;padding:9px 0;border-bottom:1px solid var(--border);gap:12px}
.kv:last-child{border-bottom:none}
.kv-k{font-size:12.5px;color:var(--text-2);flex-shrink:0;display:flex;align-items:center;gap:8px}
.kv-k img{width:14px;height:14px;filter:invert(63%) sepia(89%) saturate(1743%) hue-rotate(188deg) brightness(98%) contrast(92%);opacity:.75}
.kv-v{font-size:12.5px;color:var(--text);font-weight:500;font-family:'JetBrains Mono',monospace;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.logs{height:520px;overflow-y:auto;padding:6px;background:var(--bg);border-radius:8px;border:1px solid var(--border);font-family:'JetBrains Mono',monospace;font-size:12px}
.log-line{padding:5px 8px;border-radius:4px;display:flex;gap:10px;align-items:baseline;line-height:1.5}
.log-line:hover{background:var(--panel)}
.log-t{color:var(--text-3);flex-shrink:0;font-size:11px}
.log-lv{font-weight:600;flex-shrink:0;min-width:44px;font-size:11px;text-transform:uppercase}
.log-lv.info{color:var(--accent-2)}.log-lv.ok{color:var(--ok)}.log-lv.warn{color:var(--warn)}.log-lv.error{color:var(--bad)}
.log-ev{color:var(--text);flex-shrink:0}.log-dt{color:var(--text-3);font-size:11.5px}
.toast{position:fixed;bottom:24px;right:24px;padding:12px 18px;background:var(--panel-2);border:1px solid var(--border-hi);border-radius:10px;font-size:13px;font-weight:500;color:var(--text);box-shadow:0 12px 40px rgba(0,0,0,.5);z-index:1000;transform:translateY(120%);opacity:0;transition:all .3s cubic-bezier(.4,0,.2,1);display:flex;align-items:center;gap:10px}
.toast.show{transform:translateY(0);opacity:1}
.toast::before{content:'';width:6px;height:6px;border-radius:50%;background:var(--ok);box-shadow:0 0 8px var(--ok)}
.toast.bad::before{background:var(--bad);box-shadow:0 0 8px var(--bad)}
.empty{color:var(--text-3);font-size:13px;text-align:center;padding:40px 0}
.toggle-row{display:flex;align-items:center;gap:10px;margin-top:14px;cursor:pointer;font-size:13px;color:var(--text-2);user-select:none}
.toggle-row input[type=checkbox]{width:16px;height:16px;margin:0;cursor:pointer;accent-color:var(--accent)}
.rpc-card{background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:14px}
.rpc-preview{background:#232428;border-radius:8px;padding:12px 14px;margin-bottom:14px;min-height:110px}
.rpc-app-line{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.rpc-app-icon{width:22px;height:22px;border-radius:5px;background:linear-gradient(135deg,#3b82f6,#6366f1);display:grid;place-items:center;font-size:11px;color:#fff;font-weight:700}
.rpc-app-name{font-weight:600;color:#fff;font-size:13px}
.rpc-line{color:#b5bac1;font-size:12px;margin-left:30px;line-height:1.55}
.rpc-line.state{color:#9ba1a8;font-size:11.5px}
.rpc-btns{display:flex;gap:6px;margin-top:10px;margin-left:30px}
.rpc-btns span{flex:1;text-align:center;padding:6px 8px;background:#4e5058;color:#fff;border-radius:4px;font-size:11px;font-weight:500}
.assign-row{display:flex;align-items:center;gap:12px;padding:9px 0;border-bottom:1px solid var(--border);font-size:12.5px}
.assign-row:last-child{border-bottom:none}
.assign-token{font-family:'JetBrains Mono',monospace;color:var(--text);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.assign-arrow{color:var(--text-3)}
.assign-rpc{color:var(--accent-light);font-weight:500;flex:1;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.assign-rpc.none{color:var(--text-3);font-style:italic;font-weight:400}
</style></head>
<body>
<div id="bg"></div>
<header>
  <div class="logo"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/blender.svg" alt=""><span class="logo-text">soulzy</span><span class="dev-badge">dev: loco</span></div>
  <div class="conn" id="conn"><span class="conn-dot"></span><span id="connText">connecting</span></div>
  <div class="spacer"></div>
  <a href="/api/auth/logout" class="hdr-btn danger" style="text-decoration:none;"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/power.svg" alt=""> Logout</a>
</header>
<div class="layout">
  <aside>
    <div class="sec-label">Main</div>
    <button class="nav-btn active" data-tab="overview"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/datadog.svg" alt="">Overview</button>
    <button class="nav-btn" data-tab="tokens"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg" alt="">Tokens</button>
    <button class="nav-btn" data-tab="autochat"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/chatbot.svg" alt="">Auto Chat</button>
    <button class="nav-btn" data-tab="presence"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/googlechat.svg" alt="">Presence</button>
    <button class="nav-btn" data-tab="vc"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt="">VC Joiner</button>
    <button class="nav-btn" data-tab="joiner"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt="">Server Joiner</button>
    <button class="nav-btn" data-tab="quests"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/openai.svg" alt="">Auto Quest</button>
    <button class="nav-btn" data-tab="rpc"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/clockify.svg" alt="">RPC Pool</button>
    <div class="sec-label">System</div>
    <button class="nav-btn" data-tab="bot"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/robotframework.svg" alt="">Bot</button>
    <button class="nav-btn" data-tab="logs"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/files.svg" alt="">Live Logs</button>
    <button class="nav-btn" data-tab="settings"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/gnometerminal.svg" alt="">Settings</button>
  </aside>
  <main>
    <section class="tab-panel active" id="tab-overview">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/datadog.svg" alt=""></div><div><h1 class="page-title">Overview</h1><p class="page-desc">System and token farm status</p></div></div>
      <div class="grid g-4" style="margin-bottom:14px">
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg" alt=""><div class="stat-label">Tokens</div><div class="stat-value" id="stTokens">0</div><div class="stat-sub" id="stTokensSub">0 with proxies</div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/intel.svg" alt=""><div class="stat-label">CPU Cores</div><div class="stat-value" id="stCpus">-</div><div class="stat-sub" id="stCpusSub">-</div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/raspberrypi.svg" alt=""><div class="stat-label">Memory</div><div class="stat-value" id="stMem">-</div><div class="stat-sub" id="stMemSub">-</div><div class="bar"><div class="bar-fill" id="stMemBar" style="width:0%"></div></div></div>
        <div class="stat"><img class="stat-icon" src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/clockify.svg" alt=""><div class="stat-label">Uptime</div><div class="stat-value" id="stUptime">-</div><div class="stat-sub" id="stUptimeSub">-</div></div>
      </div>
      <div class="grid g-2">
        <div class="card">
          <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/linux.svg" alt="">System</div></div>
          <div class="kv"><span class="kv-k"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/linux.svg" alt="">Platform</span><span class="kv-v" id="syPlatform">-</span></div>
          <div class="kv"><span class="kv-k">Architecture</span><span class="kv-v" id="syArch">-</span></div>
          <div class="kv"><span class="kv-k">Hostname</span><span class="kv-v" id="syHost">-</span></div>
          <div class="kv"><span class="kv-k">Node</span><span class="kv-v" id="syNode">-</span></div>
          <div class="kv"><span class="kv-k">Process RSS</span><span class="kv-v" id="syRss">-</span></div>
          <div class="kv"><span class="kv-k">Heap</span><span class="kv-v" id="syHeap">-</span></div>
          <div class="kv"><span class="kv-k">SSE</span><span class="kv-v" id="sySse">-</span></div>
          <div class="kv"><span class="kv-k">Data Dir</span><span class="kv-v" id="syData">-</span></div>
          <div class="kv"><span class="kv-k">Developer</span><span class="kv-v" id="syDev">-</span></div>
        </div>
        <div class="card">
          <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/lightning.svg" alt="">Quick Actions</div></div>
          <div class="row flat">
            <button class="btn good" data-act="startAll"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/playstation.svg" alt="">Start All</button>
            <button class="btn" data-act="stopAll"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/pause.svg" alt="">Stop All</button>
            <button class="btn" data-act="restartAll"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/refinedgithub.svg" alt="">Restart</button>
            <button class="btn bad" data-act="panic"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/hackthebox.svg" alt="">Panic</button>
          </div>
          <div class="row">
            <button class="btn" data-act="tokens.validate"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/checkmarx.svg" alt="">Validate</button>
            <button class="btn" data-act="config.reload"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/refinedgithub.svg" alt="">Reload Config</button>
          </div>
        </div>
      </div>
    </section>
    <section class="tab-panel" id="tab-tokens">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/key.svg" alt=""></div><div><h1 class="page-title">Tokens</h1><p class="page-desc">Manage tokens.txt · label|token|proxy</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/files.svg" alt="">tokens.txt</div><div class="card-hint" id="tokFileHint">0 entries</div></div>
        <textarea id="tokensEditor" spellcheck="false" placeholder="main|your_token_here|http://proxy:8080"></textarea>
        <div class="row"><button class="btn primary" id="saveTokens"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/floppy-disk.svg" alt="">Save</button><button class="btn" id="reloadTokens">Reload</button><button class="btn" id="validateAll">Validate All</button></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/pluscodes.svg" alt="">Add Token</div></div>
        <div class="grid g-3">
          <div><label>Label</label><input id="ntLabel" placeholder="main"></div>
          <div><label>Token</label><input id="ntToken" type="password" placeholder="hidden"></div>
          <div><label>Proxy</label><input id="ntProxy" placeholder="http://..."></div>
        </div>
        <div class="row"><button class="btn good" id="addToken"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/pluscodes.svg" alt="">Add Token</button></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-autochat">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/chatbot.svg" alt=""></div><div><h1 class="page-title">Auto Chat</h1><p class="page-desc">Groq AI in a specific channel</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt="">Targets</div></div>
        <div class="grid g-2">
          <div><label>Server (Guild) ID</label><input id="guildId" placeholder="1234567890"></div>
          <div><label>Text Channel ID</label><input id="textChannelId" placeholder="1234567890"></div>
        </div>
      </div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/openai.svg" alt="">Engine</div></div>
        <div class="grid g-2">
          <div><label>Groq API Key</label><input id="groqKey" type="password" placeholder="gsk_..."></div>
          <div><label>Model</label><select id="model"><option>llama-3.3-70b-versatile</option><option>llama-3.1-8b-instant</option><option>mixtral-8x7b-32768</option></select></div>
          <div><label>Fallback Model</label><select id="fbModel"><option>llama-3.1-8b-instant</option><option>llama-3.3-70b-versatile</option></select></div>
          <div><label>Max Messages / Hour</label><input id="maxPerHour" type="number" value="30"></div>
          <div><label>Quiet Start</label><input id="quietStart" type="time" value="01:00"></div>
          <div><label>Quiet End</label><input id="quietEnd" type="time" value="08:00"></div>
          <div><label>Jitter Min (ms)</label><input id="jmin" type="number" value="1200"></div>
          <div><label>Jitter Max (ms)</label><input id="jmax" type="number" value="4000"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/lit.svg" alt="">Test</div></div>
        <input id="samplePrompt" placeholder="Type a message...">
        <div class="row"><button class="btn primary" id="testSample"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/lightning.svg" alt="">Generate</button></div>
        <div id="sampleOut" style="margin-top:14px;padding:12px 14px;background:var(--bg-2);border-radius:8px;border:1px solid var(--border);font-size:13px;color:var(--text-2);min-height:44px"></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-presence">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/googlechat.svg" alt=""></div><div><h1 class="page-title">Presence</h1><p class="page-desc">Status, activity, streaming</p></div></div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/googlechat.svg" alt="">Config</div></div>
        <div class="grid g-2">
          <div><label>Status Mode</label><select id="statusMode"><option value="fixed">Fixed</option><option value="random">Random from pool</option><option value="rotate">Rotate on interval</option></select></div>
          <div><label>Status</label><select id="status"><option value="online">Online</option><option value="idle">Idle</option><option value="dnd">Do Not Disturb</option><option value="invisible">Invisible</option><option value="offline">Offline</option></select></div>
          <div><label>Rotation Interval (sec)</label><input id="statusInterval" type="number" value="120" min="15"></div>
          <div><label>Status Pool (comma sep)</label><input id="statusPool" placeholder="online, idle, dnd, invisible"></div>
          <div><label>Custom Status</label><input id="customStatus" placeholder="chilling"></div>
          <div><label>Activity Type</label><select id="activityType"><option>Playing</option><option>Streaming</option><option>Watching</option><option>Listening</option><option>Competing</option></select></div>
          <div><label>Activity Name</label><input id="activityName" placeholder="a game"></div>
        </div>
        <div id="streamUrlWrap" style="display:none"><label>Stream URL</label><input id="streamUrl" placeholder="https://twitch.tv/channel"></div>
        <div class="row"><button class="btn primary" id="applyPresence"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/checkmarx.svg" alt="">Apply to All</button></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-vc">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt=""></div><div><h1 class="page-title">VC Joiner</h1><p class="page-desc">Voice channel with optional camera</p></div></div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt="">Config</div></div>
        <div class="grid g-2">
          <div><label>Server ID</label><input id="vcGuildId" placeholder="1234567890"></div>
          <div><label>Voice Channel ID</label><input id="vcChannelId" placeholder="1234567890"></div>
          <div><label>Mode</label><select id="vcMode"><option value="specific">Specific Channel</option><option value="first">First Populated</option></select></div>
          <div><label>Auto Leave (min, 0 = off)</label><input id="vcAutoLeave" type="number" value="0"></div>
        </div>
        <label class="toggle-row"><input type="checkbox" id="cameraOn"><span>Enable camera</span></label>
        <div class="row"><button class="btn good" id="vcJoin">Join All</button><button class="btn bad" id="vcLeave">Leave All</button></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-joiner">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt=""></div><div><h1 class="page-title">Server Joiner</h1><p class="page-desc">Auto solve captcha & join</p></div></div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/linktree.svg" alt="">Config</div></div>
        <div class="grid g-2">
          <div><label>Invite Link or Code</label><input id="inviteLink" placeholder="discord.gg/... or code"></div>
          <div><label>Delay (sec between joins)</label><input id="joinerDelay" type="number" value="5"></div>
          <div><label>2Captcha API Key</label><input id="captchaApiKey" type="password" placeholder="Optional unless triggered"></div>
        </div>
        <div class="row"><button class="btn primary" id="joinServers">Start Joiner</button></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-quests">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/openai.svg" alt=""></div><div><h1 class="page-title">Auto Quest</h1><p class="page-desc">Automate Discord quests</p></div></div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/lit.svg" alt="">Config</div></div>
        <div class="grid g-2">
          <div><label>Quest Delay (sec)</label><input id="questDelay" type="number" value="10"></div>
        </div>
        <label class="toggle-row"><input type="checkbox" id="questAutoAccept"><span>Auto Accept Quests</span></label>
        <label class="toggle-row"><input type="checkbox" id="questAutoClaim"><span>Auto Claim Rewards</span></label>
        <div class="row"><button class="btn primary" id="startQuests">Start Questing</button></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-rpc">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/clockify.svg" alt=""></div><div><h1 class="page-title">RPC Pool</h1><p class="page-desc">Groq-generated Rich Presence</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head">
          <div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/discord.svg" alt="">Cards <span class="card-hint" id="rpcCount">0</span></div>
          <div class="row flat">
            <button class="btn primary" id="genRpc"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/openai.svg" alt="">Groq Generate</button>
            <button class="btn" id="addRpc"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/pluscodes.svg" alt="">Manual</button>
            <button class="btn" id="saveRpcs"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/floppy-disk.svg" alt="">Save</button>
            <button class="btn good" id="randomizeRpcs"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/random.svg" alt="">Randomize</button>
          </div>
        </div>
        <div id="rpcList"></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/linktree.svg" alt="">Assignments</div><div class="card-hint" id="assignCount">0 assigned</div></div>
        <div id="assignList"></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-bot">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/robotframework.svg" alt=""></div><div><h1 class="page-title">Bot</h1><p class="page-desc">Owner-locked control bot</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/settings.svg" alt="">Config</div></div>
        <div class="grid g-2">
          <div><label>Owner ID</label><input id="ownerId" readonly></div>
          <div><label>Bot Online</label><select id="botOnline"><option>on</option><option>off</option></select></div>
        </div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/gnubash.svg" alt="">Commands</div></div>
        <div class="kv"><span class="kv-k">/tokens</span><span class="kv-v">list all</span></div>
        <div class="kv"><span class="kv-k">/chat start</span><span class="kv-v">start chat</span></div>
        <div class="kv"><span class="kv-k">/chat stop</span><span class="kv-v">stop chat</span></div>
        <div class="kv"><span class="kv-k">/status set</span><span class="kv-v">set status</span></div>
        <div class="kv"><span class="kv-k">/presence set</span><span class="kv-v">set activity</span></div>
        <div class="kv"><span class="kv-k">/vc join</span><span class="kv-v">join voice</span></div>
        <div class="kv"><span class="kv-k">/vc leave</span><span class="kv-v">leave voice</span></div>
        <div class="kv"><span class="kv-k">/rpc random</span><span class="kv-v">randomize</span></div>
        <div class="kv"><span class="kv-k">/kill</span><span class="kv-v">shutdown</span></div>
        <div class="kv"><span class="kv-k">/restart</span><span class="kv-v">restart</span></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-logs">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/files.svg" alt=""></div><div><h1 class="page-title">Live Logs</h1><p class="page-desc">Real-time event stream</p></div></div>
      <div class="card">
        <div class="row flat" style="margin-bottom:14px"><button class="btn" id="logClear">Clear</button><button class="btn" id="logPause">Pause</button><div class="spacer" style="flex:1"></div><span class="card-hint" id="logCount">0 events</span></div>
        <div class="logs" id="logBox"></div>
      </div>
    </section>
    <section class="tab-panel" id="tab-settings">
      <div class="page-head"><div class="page-icon"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/gnometerminal.svg" alt=""></div><div><h1 class="page-title">Settings</h1><p class="page-desc">Limits and safety</p></div></div>
      <div class="card" style="margin-bottom:14px">
        <div class="card-head"><div class="card-title">Limits</div></div>
        <div class="grid g-2">
          <div><label>Max Concurrent Chats</label><input type="number" value="10"></div>
          <div><label>Global Msg / Hour</label><input type="number" value="500"></div>
        </div>
        <div class="row"><button class="btn primary" id="saveConfig"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/floppy-disk.svg" alt="">Save</button></div>
      </div>
      <div class="card">
        <div class="card-head"><div class="card-title" style="color:var(--bad)">Danger Zone</div></div>
        <p style="font-size:12.5px;color:var(--text-2);margin-bottom:14px">Instantly halts all activity.</p>
        <button class="btn bad" data-act="panic">Trigger Kill Switch</button>
      </div>
    </section>
  </main>
</div>
<div class="toast" id="toast"></div>
<script>
(function(){
  'use strict';
  var NL = String.fromCharCode(10);
  var $ = function(s){ return document.querySelector(s); };
  var $$ = function(s){ return Array.prototype.slice.call(document.querySelectorAll(s)); };
  var logBox = $('#logBox');
  var paused = false;
  var logs = [];
  var state = { tokens: [], config: {}, rpcAssignments: {} };
  function toast(msg, bad) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast show' + (bad ? ' bad' : '');
    clearTimeout(t._tm);
    t._tm = setTimeout(function(){ t.className = 'toast'; }, 2200);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }
  function fmtBytes(b) { if (!b) return '0 B'; var k = 1024, u = ['B','KB','MB','GB','TB']; var i = Math.floor(Math.log(b) / Math.log(k)); return (b / Math.pow(k, i)).toFixed(1) + ' ' + u[i]; }
  function fmtUptime(s) { var d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60); if (d > 0) return d + 'd ' + h + 'h'; if (h > 0) return h + 'h ' + m + 'm'; return m + 'm'; }
  $$('.nav-btn').forEach(function(btn){
    btn.addEventListener('click', function(){
      $$('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
      btn.classList.add('active');
      $$('.tab-panel').forEach(function(p){ p.classList.remove('active'); });
      var panel = document.getElementById('tab-' + btn.getAttribute('data-tab'));
      if (panel) panel.classList.add('active');
    });
  });
  function connect() {
    try {
      var es = new EventSource('/stream');
      es.addEventListener('log', function(ev){
        try { var e = JSON.parse(ev.data); logs.push(e); if (logs.length > 1000) logs.shift(); if (!paused) appendLog(e); $('#logCount').textContent = logs.length + ' events'; } catch (err) {}
      });
      es.onopen = function(){ $('#conn').classList.add('live'); $('#connText').textContent = 'connected'; };
      es.onerror = function(){ $('#conn').classList.remove('live'); $('#connText').textContent = 'reconnecting'; };
    } catch (err) { $('#connText').textContent = 'unsupported'; }
  }
  connect();
  function appendLog(e) {
    var d = new Date(e.t);
    var div = document.createElement('div');
    div.className = 'log-line';
    div.innerHTML = '<span class="log-t">' + d.toLocaleTimeString() + '</span><span class="log-lv ' + e.level + '">' + e.level + '</span><span class="log-ev">' + esc(e.event) + '</span><span class="log-dt">' + esc(e.detail || '') + '</span>';
    logBox.appendChild(div);
    logBox.scrollTop = logBox.scrollHeight;
  }
  function api(p, body) {
    return fetch(p, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(function(r){ return r.json(); });
  }
  function refreshSystem() {
    api('/api/system').then(function(s){
      $('#stTokens').textContent = s.tokenCount;
      $('#stCpus').textContent = s.cpus;
      $('#stCpusSub').textContent = s.cpuModel.length > 30 ? s.cpuModel.slice(0, 30) + '...' : s.cpuModel;
      $('#stMem').textContent = s.memPct + '%';
      $('#stMemSub').textContent = fmtBytes(s.usedMem) + ' / ' + fmtBytes(s.totalMem);
      var bar = $('#stMemBar');
      bar.style.width = s.memPct + '%';
      bar.className = 'bar-fill' + (s.memPct > 85 ? ' bad' : s.memPct > 65 ? ' warn' : '');
      $('#stUptime').textContent = fmtUptime(s.procUptime);
      $('#stUptimeSub').textContent = 'system ' + fmtUptime(s.sysUptime);
      $('#syPlatform').textContent = s.platform;
      $('#syArch').textContent = s.arch;
      $('#syHost').textContent = s.hostname;
      $('#syNode').textContent = s.nodeVer;
      $('#syRss').textContent = fmtBytes(s.rss);
      $('#syHeap').textContent = fmtBytes(s.heapUsed) + ' / ' + fmtBytes(s.heapTotal);
      $('#sySse').textContent = s.sseClients;
      $('#syData').textContent = s.dataDir;
      $('#syDev').textContent = s.dev;
    });
  }
  refreshSystem();
  setInterval(refreshSystem, 3000);
  function syncConfigFromDOM() {
    var c = state.config;
    c.groqKey = $('#groqKey').value;
    c.model = $('#model').value;
    c.fallbackModel = $('#fbModel').value;
    c.maxPerHour = +$('#maxPerHour').value;
    c.quietStart = $('#quietStart').value;
    c.quietEnd = $('#quietEnd').value;
    c.jitterMin = +$('#jmin').value;
    c.jitterMax = +$('#jmax').value;
    c.status = $('#status').value;
    c.statusMode = $('#statusMode').value;
    c.statusInterval = +$('#statusInterval').value;
    c.statusPool = $('#statusPool').value.split(',').map(function(s){ return s.trim(); }).filter(Boolean);
    c.customStatus = $('#customStatus').value;
    c.activityType = $('#activityType').value;
    c.activityName = $('#activityName').value;
    c.streamUrl = $('#streamUrl').value;
    c.guildId = $('#guildId').value;
    c.textChannelId = $('#textChannelId').value;
    c.vcGuildId = $('#vcGuildId').value;
    c.vcChannelId = $('#vcChannelId').value;
    c.vcMode = $('#vcMode').value;
    c.vcAutoLeave = +$('#vcAutoLeave').value;
    c.cameraOn = $('#cameraOn').checked;
    c.inviteLink = $('#inviteLink').value;
    c.joinerDelay = +$('#joinerDelay').value;
    c.captchaApiKey = $('#captchaApiKey').value;
    c.questAutoAccept = $('#questAutoAccept').checked;
    c.questAutoClaim = $('#questAutoClaim').checked;
    c.questDelay = +$('#questDelay').value;
    c.botOnline = $('#botOnline').value;
    c.ownerId = $('#ownerId').value;
    c.rpcAssignments = state.rpcAssignments;
  }
  function saveAll() { syncConfigFromDOM(); return api('/api/config', state.config); }
  function loadTokens() {
    return api('/api/tokens').then(function(list){
      state.tokens = list;
      $('#tokensEditor').value = list.map(function(t){ return t.label + '|' + t.token + '|' + (t.proxy || ''); }).join(NL);
      $('#tokFileHint').textContent = list.length + ' entries';
      var proxied = list.filter(function(t){ return t.proxy; }).length;
      $('#stTokensSub').textContent = proxied + ' with proxies';
      renderAssignments();
    });
  }
  function loadConfig() {
    return api('/api/config').then(function(c){
      state.config = c;
      if (!state.config.rpcs) state.config.rpcs = [];
      if (!state.config.rpcAssignments) state.config.rpcAssignments = {};
      state.rpcAssignments = state.config.rpcAssignments;
      $('#groqKey').value = c.groqKey || '';
      $('#model').value = c.model || 'llama-3.3-70b-versatile';
      $('#fbModel').value = c.fallbackModel || 'llama-3.1-8b-instant';
      $('#maxPerHour').value = c.maxPerHour != null ? c.maxPerHour : 30;
      $('#quietStart').value = c.quietStart || '01:00';
      $('#quietEnd').value = c.quietEnd || '08:00';
      $('#jmin').value = c.jitterMin != null ? c.jitterMin : 1200;
      $('#jmax').value = c.jitterMax != null ? c.jitterMax : 4000;
      $('#status').value = c.status || 'online';
      $('#statusMode').value = c.statusMode || 'fixed';
      $('#statusInterval').value = c.statusInterval || 120;
      $('#statusPool').value = (c.statusPool || []).join(', ');
      $('#customStatus').value = c.customStatus || '';
      $('#activityType').value = c.activityType || 'Playing';
      $('#activityName').value = c.activityName || '';
      $('#streamUrl').value = c.streamUrl || '';
      $('#guildId').value = c.guildId || '';
      $('#textChannelId').value = c.textChannelId || '';
      $('#vcGuildId').value = c.vcGuildId || '';
      $('#vcChannelId').value = c.vcChannelId || '';
      $('#vcMode').value = c.vcMode || 'specific';
      $('#vcAutoLeave').value = c.vcAutoLeave != null ? c.vcAutoLeave : 0;
      $('#cameraOn').checked = !!c.cameraOn;
      $('#inviteLink').value = c.inviteLink || '';
      $('#joinerDelay').value = c.joinerDelay != null ? c.joinerDelay : 5;
      $('#captchaApiKey').value = c.captchaApiKey || '';
      $('#questAutoAccept').checked = !!c.questAutoAccept;
      $('#questAutoClaim').checked = !!c.questAutoClaim;
      $('#questDelay').value = c.questDelay != null ? c.questDelay : 10;
      $('#botOnline').value = c.botOnline || 'on';
      $('#ownerId').value = c.ownerId || 'not set';
      updateStreamUrlVisibility();
      renderRpcs();
      renderAssignments();
    });
  }
  function updateStreamUrlVisibility() {
    var wrap = $('#streamUrlWrap');
    wrap.style.display = $('#activityType').value === 'Streaming' ? 'block' : 'none';
  }
  $('#activityType').addEventListener('change', updateStreamUrlVisibility);
  function rpcPreviewHTML(rpc) {
    var btns = '';
    if (rpc.btn1Label || rpc.btn2Label) {
      btns = '<div class="rpc-btns">' + (rpc.btn1Label ? '<span>' + esc(rpc.btn1Label) + '</span>' : '') + (rpc.btn2Label ? '<span>' + esc(rpc.btn2Label) + '</span>' : '') + '</div>';
    }
    return '<div class="rpc-preview"><div class="rpc-app-line"><div class="rpc-app-icon">S</div><div class="rpc-app-name">' + esc(rpc.name || 'App Name') + '</div></div><div class="rpc-line">' + esc(rpc.details || 'Details') + '</div><div class="rpc-line state">' + esc(rpc.state || 'State') + '</div>' + btns + '</div>';
  }
  function rpcCardHTML(rpc) {
    return rpcPreviewHTML(rpc) +
      '<div class="row flat" style="justify-content:flex-end;margin-bottom:8px"><button class="btn bad" data-remove-rpc="' + esc(rpc.id) + '"><img src="https://cdn.jsdelivr.net/npm/simple-icons@11/icons/trash.svg" alt="">Delete</button></div>' +
      '<div class="grid g-2">' +
      '<div><label>App Name</label><input data-rpc="' + esc(rpc.id) + '" data-field="name" value="' + esc(rpc.name) + '"></div>' +
      '<div><label>Details</label><input data-rpc="' + esc(rpc.id) + '" data-field="details" value="' + esc(rpc.details) + '"></div>' +
      '<div><label>State</label><input data-rpc="' + esc(rpc.id) + '" data-field="state" value="' + esc(rpc.state) + '"></div>' +
      '<div><label>Large Image</label><input data-rpc="' + esc(rpc.id) + '" data-field="largeImage" value="' + esc(rpc.largeImage) + '"></div>' +
      '<div><label>Large Text</label><input data-rpc="' + esc(rpc.id) + '" data-field="largeText" value="' + esc(rpc.largeText) + '"></div>' +
      '<div><label>Small Image</label><input data-rpc="' + esc(rpc.id) + '" data-field="smallImage" value="' + esc(rpc.smallImage) + '"></div>' +
      '<div><label>Small Text</label><input data-rpc="' + esc(rpc.id) + '" data-field="smallText" value="' + esc(rpc.smallText) + '"></div>' +
      '<div><label>Btn1 Label</label><input data-rpc="' + esc(rpc.id) + '" data-field="btn1Label" value="' + esc(rpc.btn1Label) + '"></div>' +
      '<div><label>Btn1 URL</label><input data-rpc="' + esc(rpc.id) + '" data-field="btn1Url" value="' + esc(rpc.btn1Url) + '"></div>' +
      '<div><label>Btn2 Label</label><input data-rpc="' + esc(rpc.id) + '" data-field="btn2Label" value="' + esc(rpc.btn2Label) + '"></div>' +
      '<div><label>Btn2 URL</label><input data-rpc="' + esc(rpc.id) + '" data-field="btn2Url" value="' + esc(rpc.btn2Url) + '"></div>' +
      '</div>';
  }
  function renderRpcs() {
    var container = $('#rpcList');
    var list = state.config.rpcs || [];
    $('#rpcCount').textContent = list.length;
    if (!list.length) { container.innerHTML = '<div class="empty">No RPCs yet. Click Groq Generate.</div>'; return; }
    container.innerHTML = '';
    list.forEach(function(rpc){ var card = document.createElement('div'); card.className = 'rpc-card'; card.innerHTML = rpcCardHTML(rpc); container.appendChild(card); });
  }
  function renderAssignments() {
    var container = $('#assignList');
    var tokens = state.tokens;
    if (!tokens.length) { container.innerHTML = '<div class="empty">No tokens loaded.</div>'; $('#assignCount').textContent = '0 assigned'; return; }
    var assignedCount = 0, html = '';
    tokens.forEach(function(t){
      var rpcId = state.rpcAssignments[t.label];
      var rpc = (state.config.rpcs || []).filter(function(r){ return r.id === rpcId; })[0];
      if (rpc) assignedCount++;
      html += '<div class="assign-row"><span class="assign-token">' + esc(t.label || '(unnamed)') + '</span><span class="assign-arrow">&rarr;</span><span class="assign-rpc' + (rpc ? '' : ' none') + '">' + (rpc ? esc(rpc.name) : 'unassigned') + '</span></div>';
    });
    container.innerHTML = html;
    $('#assignCount').textContent = assignedCount + ' / ' + tokens.length + ' assigned';
  }
  document.addEventListener('input', function(e){
    var rpcId = e.target.getAttribute('data-rpc'), field = e.target.getAttribute('data-field');
    if (rpcId && field) {
      var rpc = (state.config.rpcs || []).filter(function(r){ return r.id === rpcId; })[0];
      if (rpc) {
        rpc[field] = e.target.value;
        var card = e.target.closest('.rpc-card');
        if (card) { var old = card.querySelector('.rpc-preview'); if (old) old.outerHTML = rpcPreviewHTML(rpc); }
      }
    }
  });
  document.addEventListener('click', function(e){
    var delBtn = e.target.closest('[data-remove-rpc]');
    if (delBtn) {
      var id = delBtn.getAttribute('data-remove-rpc');
      state.config.rpcs = state.config.rpcs.filter(function(r){ return r.id !== id; });
      Object.keys(state.rpcAssignments).forEach(function(k){ if (state.rpcAssignments[k] === id) delete state.rpcAssignments[k]; });
      renderRpcs(); renderAssignments(); toast('RPC removed');
    }
  });
  $('#genRpc').addEventListener('click', function(){
    toast('asking groq...');
    api('/api/rpc/generate', {}).then(function(r){
      if (!r || !r.name) return toast('groq failed - check GROQ_API_KEY', true);
      if (!state.config.rpcs) state.config.rpcs = [];
      state.config.rpcs.push({
        id: 'rpc_' + Date.now() + '_' + Math.floor(Math.random() * 1000),
        name: r.name || '', details: r.details || '', state: r.state || '',
        largeImage: (r.assets && r.assets.large_image) || '', largeText: (r.assets && r.assets.large_text) || '',
        smallImage: (r.assets && r.assets.small_image) || '', smallText: (r.assets && r.assets.small_text) || '',
        btn1Label: (r.buttons && r.buttons[0] && r.buttons[0].label) || '', btn1Url: (r.buttons && r.buttons[0] && r.buttons[0].url) || '',
        btn2Label: (r.buttons && r.buttons[1] && r.buttons[1].label) || '', btn2Url: (r.buttons && r.buttons[1] && r.buttons[1].url) || ''
      });
      renderRpcs();
      toast('rpc: ' + r.name);
    }).catch(function(){ toast('groq failed', true); });
  });
  $('#addRpc').addEventListener('click', function(){
    if (!state.config.rpcs) state.config.rpcs = [];
    state.config.rpcs.push({ id: 'rpc_' + Date.now() + '_' + Math.floor(Math.random() * 1000), name: 'New RPC', details: '', state: '', largeImage: '', largeText: '', smallImage: '', smallText: '', btn1Label: '', btn1Url: '', btn2Label: '', btn2Url: '' });
    renderRpcs(); toast('RPC added');
  });
  $('#saveRpcs').addEventListener('click', function(){ saveAll().then(function(){ toast('saved'); renderAssignments(); }); });
  $('#randomizeRpcs').addEventListener('click', function(){
    if (!(state.config.rpcs || []).length) return toast('add RPCs first', true);
    if (!state.tokens.length) return toast('add tokens first', true);
    var shuffled = state.config.rpcs.slice();
    for (var i = shuffled.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var tmp = shuffled[i]; shuffled[i] = shuffled[j]; shuffled[j] = tmp; }
    state.rpcAssignments = {};
    state.tokens.forEach(function(t, i){ state.rpcAssignments[t.label] = shuffled[i % shuffled.length].id; });
    saveAll().then(function(){ renderAssignments(); toast('randomized'); });
  });
  $('#saveTokens').addEventListener('click', function(){
    var raw = $('#tokensEditor').value.split(NL).map(function(l){ return l.trim(); }).filter(Boolean);
    var list = raw.map(function(l){ var p = l.split('|'); return { label: p[0] || '', token: p[1] || '', proxy: p[2] || '' }; });
    api('/api/tokens', { list: list }).then(function(){ toast('saved'); loadTokens(); refreshSystem(); });
  });
  $('#reloadTokens').addEventListener('click', function(){ loadTokens(); toast('reloaded'); });
  $('#addToken').addEventListener('click', function(){
    var label = $('#ntLabel').value.trim(), token = $('#ntToken').value.trim(), proxy = $('#ntProxy').value.trim();
    if (!label || !token) return toast('label + token required', true);
    api('/api/tokens/add', { label: label, token: token, proxy: proxy }).then(function(){
      $('#ntLabel').value = ''; $('#ntToken').value = ''; $('#ntProxy').value = '';
      toast('added'); loadTokens(); refreshSystem();
    });
  });
  $('#validateAll').addEventListener('click', function(){ api('/api/action', { action: 'tokens.validate' }); toast('validating'); });
  $('#saveConfig').addEventListener('click', function(){ saveAll().then(function(){ toast('saved'); }); });
  $('#applyPresence').addEventListener('click', function(){ saveAll().then(function(){ api('/api/action', { action: 'presence.apply' }); toast('applied'); }); });
  $('#vcJoin').addEventListener('click', function(){ saveAll().then(function(){ api('/api/action', { action: 'vc.join', payload: { camera: $('#cameraOn').checked } }); toast('joining'); }); });
  $('#vcLeave').addEventListener('click', function(){ api('/api/action', { action: 'vc.leave' }); toast('left'); });
  
  $('#joinServers').addEventListener('click', function(){ 
    saveAll().then(function(){ 
      api('/api/action', { action: 'joiner.join', payload: { invite: $('#inviteLink').value } }); 
      toast('captcha joiner started'); 
    }); 
  });
  
  $('#startQuests').addEventListener('click', function(){ 
    saveAll().then(function(){ 
      api('/api/action', { action: 'quests.start' }); 
      toast('quests started'); 
    }); 
  });

  $('#testSample').addEventListener('click', function(){
    var p = $('#samplePrompt').value.trim();
    if (!p) return toast('enter prompt', true);
    $('#sampleOut').textContent = 'generating...';
    api('/api/action', { action: 'chat.sample', payload: p });
    setTimeout(function(){ var s = ['lol yeah that tracks','ngl that was wild','fr fr what server?','sounds cool ping me later']; $('#sampleOut').textContent = '\u2192 ' + s[Math.floor(Math.random() * s.length)]; }, 700);
  });
  $('#logClear').addEventListener('click', function(){ logs = []; logBox.innerHTML = ''; $('#logCount').textContent = '0 events'; });
  $('#logPause').addEventListener('click', function(e){ paused = !paused; e.target.textContent = paused ? 'Resume' : 'Pause'; if (!paused) { logBox.innerHTML = ''; logs.forEach(appendLog); } });
  $$('[data-act]').forEach(function(b){
    b.addEventListener('click', function(){
      var act = b.getAttribute('data-act');
      if (act === 'panic' && !confirm('Panic: stop all?')) return;
      api('/api/action', { action: act }).then(function(){ toast(act); });
    });
  });
  $('#killBtn').addEventListener('click', function(){
    if (!confirm('Kill switch?')) return;
    api('/api/action', { action: 'kill' }).then(function(){ toast('kill on', true); });
  });
  loadTokens().then(loadConfig);
})();
</script>
</body></html>`;

server.listen(PORT, '0.0.0.0', () => {
  console.log('Soulzy Control -> http://0.0.0.0:' + PORT);
  console.log('Data dir: ' + DATA_DIR);
  console.log('dev: ' + DEV);
});
