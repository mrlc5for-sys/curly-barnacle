const axios = require('axios');

async function generateRpc(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');

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
      if (err.response?.status === 400) continue;
      throw new Error(lastError);
    }
  }
  throw new Error(`All models failed. Last error: ${lastError}`);
}
module.exports = { generateRpc };
