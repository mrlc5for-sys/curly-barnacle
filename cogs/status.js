const VALID = ['online', 'idle', 'dnd', 'invisible', 'offline'];
const ALIASES = {
  on: 'online', active: 'online', green: 'online', available: 'online',
  away: 'idle', afk: 'idle', yellow: 'idle',
  busy: 'dnd', red: 'dnd', do_not_disturb: 'dnd', donotdisturb: 'dnd', quiet: 'dnd',
  hidden: 'invisible', ghost: 'invisible', grey: 'invisible', gray: 'invisible',
  off: 'offline'
};
const COLOR = { online: '#23a55a', idle: '#f0b232', dnd: '#f23f43', invisible: '#80848e', offline: '#80848e' };
const LABEL = { online: 'Online', idle: 'Idle', dnd: 'Do Not Disturb', invisible: 'Invisible', offline: 'Offline' };

function normalize(value) {
  const raw = String(value == null ? '' : value).trim().toLowerCase();
  if (!raw) return null;
  if (VALID.indexOf(raw) !== -1) return raw;
  if (ALIASES[raw]) return ALIASES[raw];
  return null;
}
function resolve(config) {
  if (!config) return 'online';
  if (config.statusMode === 'random' && Array.isArray(config.statusPool) && config.statusPool.length) {
    const picked = config.statusPool.map(normalize).filter(Boolean);
    if (picked.length) return picked[Math.floor(Math.random() * picked.length)];
  }
  return normalize(config.status) || 'online';
}
function resolveForToken(config, label) {
  if (!config) return 'online';
  const overrides = config.tokenStatusOverrides || {};
  if (label && overrides[label]) {
    const o = normalize(overrides[label]);
    if (o) return o;
  }
  return resolve(config);
}
function resolveNext(config, current) {
  if (!config) return 'online';
  const mode = config.statusChanger || 'off';
  if (mode !== 'rotate') return resolve(config);
  const pool = (config.statusPool || VALID).map(normalize).filter(Boolean);
  if (!pool.length) return resolve(config);
  const filtered = pool.filter(s => s !== current);
  const source = filtered.length ? filtered : pool;
  return source[Math.floor(Math.random() * source.length)];
}
function meta(status) {
  const s = normalize(status) || 'online';
  return { value: s, label: LABEL[s], color: COLOR[s] };
}
function all() { return VALID.map(v => meta(v)); }
function intervalMs(config) {
  if (!config) return 0;
  const sec = Number(config.statusInterval);
  if (!isFinite(sec) || sec <= 0) return 0;
  return Math.max(15, Math.min(86400, Math.floor(sec))) * 1000;
}
module.exports = { VALID, ALIASES, COLOR, LABEL, normalize, resolve, resolveForToken, resolveNext, meta, all, intervalMs };
