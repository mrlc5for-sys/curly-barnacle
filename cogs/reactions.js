const axios = require('axios');

let reactInterval = null;

async function fetchRecentMessages(token, channelId) {
  try {
    const res = await axios.get(`https://discord.com/api/v10/channels/${channelId}/messages?limit=20`, {
      headers: { Authorization: token }
    });
    return res.data;
  } catch (e) {
    return [];
  }
}

async function addReaction(token, channelId, messageId, emoji) {
  try {
    // URL encode the emoji to support standard unicode emojis
    const encodedEmoji = encodeURIComponent(emoji);
    await axios.put(`https://discord.com/api/v10/channels/${channelId}/messages/${messageId}/reactions/${encodedEmoji}/@me`, {}, {
      headers: { Authorization: token }
    });
  } catch (e) {}
}

function startReactLoop(tokens, channelId, emojis, log) {
  if (reactInterval) clearInterval(reactInterval);
  
  reactInterval = setInterval(async () => {
    if (!tokens.length) return;
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    
    // 1. Fetch recent messages to react to
    const messages = await fetchRecentMessages(token, channelId);
    if (!messages || !messages.length) return;
    
    // 2. Pick a random message and random emoji
    const message = messages[Math.floor(Math.random() * messages.length)];
    const emoji = emojis[Math.floor(Math.random() * emojis.length)];
    
    // 3. React
    await addReaction(token, channelId, message.id, emoji);
    log(`Reacted with ${emoji} to message: "${message.content.substring(0, 20)}..."`);
    
  }, Math.floor(Math.random() * 15000) + 10000); // 10s to 25s delay
}

function stopReactLoop() {
  if (reactInterval) clearInterval(reactInterval);
  reactInterval = null;
}

module.exports = { startReactLoop, stopReactLoop };
