function build(config) {
  const text = String(config && config.customStatus || '').trim();
  if (!text) return null;
  const activity = { name: 'Custom Status', type: 4, state: text.slice(0, 128), emoji: null };
  if (config.customEmoji && (config.customEmoji.name || config.customEmoji.id)) {
    activity.emoji = {
      name: config.customEmoji.name || null,
      id: config.customEmoji.id || null,
      animated: !!config.customEmoji.animated
    };
  }
  return activity;
}
module.exports = { build };
