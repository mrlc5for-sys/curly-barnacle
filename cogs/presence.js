const statusCog = require('./status');
const customStatusCog = require('./customStatus');
const rpcCog = require('./rpc');

function assemble(config, tokenLabel) {
  const activities = [];
  const custom = customStatusCog.build(config);
  if (custom) activities.push(custom);
  const rpc = rpcCog.build(config);
  if (rpc) activities.push(rpc);
  return {
    status: statusCog.resolveForToken(config, tokenLabel),
    activities,
    afk: false,
    since: null
  };
}
function transition(config, tokenLabel, current) {
  const next = statusCog.resolveNext(config, current);
  return {
    status: next,
    activities: [],
    afk: false,
    since: next === 'idle' ? Date.now() : null
  };
}
module.exports = { assemble, transition };
