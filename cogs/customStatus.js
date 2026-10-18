function build(config) {
  const text = String(config && config.customStatus || '').trim();
  if (!text) return null;
  return { name: 'Custom Status', type: 4, state: text.slice(0, 128) };
}
module.exports = { build };
