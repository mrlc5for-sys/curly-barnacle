const axios = require('axios');

async function generate100Chats() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing in Variables');

  try {
    // 1. Ask Groq what models this specific API key can access
    const modelsRes = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });

    // 2. Filter out models that don't support chat completions (like Whisper/TTS)
    const availableModels = modelsRes.data.data
      .filter(m => m.active && !m.id.includes('whisper') && !m.id.includes('tts'))
      .map(m => m.id);

    if (availableModels.length === 0) throw new Error('No chat models available for this API key.');

    let lastError = null;

    // 3. Try the available models until one works
    for (const model of availableModels) {
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
        continue; // If this model fails, try the next one
      }
    }
    
    throw new Error(`All available models failed. Last error: ${lastError}`);
  } catch (err) {
    throw new Error(err.message);
  }
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
