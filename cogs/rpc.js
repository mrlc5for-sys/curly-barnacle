const axios = require('axios');
async function generateRpc(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'user', content: `Generate a realistic Discord Rich Presence JSON for: ${prompt}. Format exactly: {"name":"","details":"","state":""}` }],
    response_format: { type: 'json_object' }
  }, { headers: { Authorization: `Bearer ${key}` } });
  return JSON.parse(res.data.choices[0].message.content);
}
module.exports = { generateRpc };
