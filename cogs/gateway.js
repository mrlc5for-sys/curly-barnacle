const WebSocket = require('ws');
const axios = require('axios');

const clients = new Map();

function connect(token, presencePayload, deviceProfile) {
  return new Promise(async (resolve) => {
    if (clients.has(token)) clients.get(token).close();
    try {
      const res = await axios.get('https://discord.com/api/v10/gateway');
      const ws = new WebSocket(`${res.data.url}/?v=9&encoding=json`);
      clients.set(token, ws);
      let heartbeatInterval = null;
      let seq = null;

      ws.on('message', (msg) => {
        const data = JSON.parse(msg);
        if (data.op === 10) {
          heartbeatInterval = setInterval(() => ws.send(JSON.stringify({ op: 1, d: seq })), data.d.heartbeat_interval);
          ws.send(JSON.stringify({
            op: 2,
            d: {
              token: token,
              properties: deviceProfile,
              presence: presencePayload,
              compress: false
            }
          }));
        }
        if (data.op === 11) seq = data.s;
        if (data.t === 'READY') resolve(true);
      });

      ws.on('close', () => { clearInterval(heartbeatInterval); clients.delete(token); });
      ws.on('error', () => { clearInterval(heartbeatInterval); clients.delete(token); resolve(false); });
    } catch (e) { resolve(false); }
  });
}

function disconnect(token) {
  if (clients.has(token)) { clients.get(token).close(); clients.delete(token); }
}

module.exports = { connect, disconnect, clients };
