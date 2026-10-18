const crypto = require('crypto');
const PROFILES = [
  { os: 'Windows', version: '10.0.19045', browser: 'Discord Client', client: '1.0.9164' },
  { os: 'Mac OS X', version: '14.5.0', browser: 'Discord Client', client: '1.0.9164' },
  { os: 'Android', version: '14', browser: 'Discord Android', client: '245.14', device: 'SM-S928B' },
  { os: 'iOS', version: '17.5', browser: 'Discord iOS', client: '244.0', device: 'iPhone' }
];
function generateProfile() {
  const p = PROFILES[Math.floor(Math.random() * PROFILES.length)];
  return {
    os: p.os, os_version: p.version, browser: p.browser, client_version: p.client,
    device: p.device || '',
    client_build_number: Math.floor(Math.random() * 1000) + 290000,
    launch_signature: crypto.randomUUID(),
    client_heartbeat_session_id: crypto.randomUUID()
  };
}
module.exports = { generateProfile };
