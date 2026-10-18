const axios = require('axios');

async function generate100Chats() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama3-8b-8192',
    messages: [{ role: 'system', content: 'Return exactly 100 lines of realistic, casual, lowercase Discord chat. No numbering. Just text.' }]
  }, { headers: { Authorization: `Bearer ${key}` } });
  return res.data.choices[0].message.content.trim();
}

async function sendMessages(tokens, channelId, messages, delayMs) {
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const msg = messages[Math.floor(Math.random() * messages.length)];
    try {
      await axios.post(`https://discord.com/api/v10/channels/${channelId}/messages`, 
        { content: msg }, 
        { headers: { Authorization: token } }
      );
    } catch (e) {}
    await new Promise(r => setTimeout(r, delayMs));
  }
  return { ok: true };
}

module.exports = { generate100Chats, sendMessages };
