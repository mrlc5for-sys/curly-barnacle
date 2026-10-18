const axios = require('axios');

async function generateRpc(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');

  try {
    const modelsRes = await axios.get('https://api.groq.com/openai/v1/models', {
      headers: { Authorization: `Bearer ${key}` }
    });

    const availableModels = modelsRes.data.data
      .filter(m => m.active && !m.id.includes('whisper') && !m.id.includes('tts'))
      .map(m => m.id);

    let lastError = null;

    for (const model of availableModels) {
      try {
        const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
          model: model,
          messages: [
            { role: 'system', content: 'You are a JSON generator. Output ONLY raw JSON with no markdown, no backticks.' },
            { role: 'user', content: `Generate a realistic Discord Rich Presence for: ${prompt}. Format exactly: {"name":"","details":"","state":""}` }
          ]
        }, { headers: { Authorization: `Bearer ${key}` } });

        let text = res.data.choices[0].message.content.trim();
        text = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(text);
      } catch (err) {
        lastError = err.response?.data?.error?.message || err.message;
        continue;
      }
    }
    throw new Error(`All available models failed. Last error: ${lastError}`);
  } catch (err) {
    throw new Error(err.message);
  }
}
module.exports = { generateRpc };
