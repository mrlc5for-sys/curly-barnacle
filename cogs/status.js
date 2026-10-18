const VALID = ['online', 'idle', 'dnd', 'invisible', 'offline'];
function resolve(config) {
  const s = String(config && config.status || 'online').toLowerCase();
  return VALID.includes(s) ? s : 'online';
}
module.exports = { resolve, VALID };
