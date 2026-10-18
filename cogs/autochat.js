const axios = require('axios');

async function generate100Chats() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing in Variables');
  
  // Array of models to try in order
  const models = [
    'llama-3.1-8b-instant',
    'gemma2-9b-it',
    'mixtral-8x7b-32768'
  ];

  let lastError = null;

  for (const model of models) {
    try {
      const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
        model: model,
        messages: [{ 
          role: 'system', 
          content: 'Return exactly 100 lines of realistic, casual, lowercase Discord chat. No numbering. Just text.' 
        }]
      }, { headers: { Authorization: `Bearer ${key}` } });
      
      return res.data.choices[0].message.content.trim();
    } catch (err) {
      lastError = err.response?.data?.error?.message || err.message;
      // If it's a 400 (model not found), continue to the next model
      if (err.response?.status === 400) {
        continue;
      }
      // If it's another error (like 401 Unauthorized), throw it immediately
      throw new Error(lastError);
    }
  }

  throw new Error(`All models failed. Last error: ${lastError}`);
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
