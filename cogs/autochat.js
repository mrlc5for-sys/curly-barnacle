const axios = require('axios');

async function generateReply(groqKey) {
  try {
    const modelsRes = await axios.get('https://api.groq.com/openai/v1/models', { headers: { Authorization: `Bearer ${groqKey}` } });
    const models = modelsRes.data.data.filter(m => m.active && !m.id.includes('whisper')).map(m => m.id);
    
    for (const model of models) {
      try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: model,
          messages: [{ 
            role: 'system', 
            content: 'You are a real person on Discord. Output ONE short, casual, lowercase message replying to the chat. No punctuation at the end. Do not use names or prefixes.' 
          }, {
            role: 'user',
            content: 'Just chatting with friends, say something normal.'
          }]
        }, { headers: { Authorization: `Bearer ${groqKey}` } });
        return res.data.choices[0].message.content.trim();
      } catch (e) { continue; }
    }
    return "yeah fr";
  } catch (e) { return "lol true"; }
}

async function sendTyping(token, channelId) {
  try { await axios.post(`https://discord.com/api/v10/channels/${channelId}/typing`, {}, { headers: { Authorization: token } }); } catch (e) {}
}

async function sendMessage(token, channelId, content) {
  try { await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, { content }, { headers: { Authorization: token } }); } catch (e) {}
}

let chatInterval = null;

function startChatLoop(tokens, channelId, groqKey, log) {
  if (chatInterval) clearInterval(chatInterval);
  
  chatInterval = setInterval(async () => {
    if (!tokens.length) return;
    const token = tokens[Math.floor(Math.random() * tokens.length)];
    
    // 1. Generate Message
    const message = await generateReply(groqKey);
    
    // 2. Human delay before typing (2-5s)
    await new Promise(r => setTimeout(r, Math.floor(Math.random() * 3000) + 2000));
    
    // 3. Trigger Typing Indicator
    await sendTyping(token, channelId);
    
    // 4. Type based on message length (e.g. 50ms per char)
    await new Promise(r => setTimeout(r, message.length * 50));
    
    // 5. Send Message
    await sendMessage(token, channelId, message);
    log(`Sent: ${message}`);
    
  }, Math.floor(Math.random() * 30000) + 15000); // 15s to 45s between messages
}

function stopChatLoop() {
  if (chatInterval) clearInterval(chatInterval);
  chatInterval = null;
}

module.exports = { startChatLoop, stopChatLoop };
