const axios = require('axios');
async function generateRpc(prompt) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY is missing');
  
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama3-8b-8192',
    messages: [
      { role: 'system', content: 'You are a JSON generator. Output ONLY raw JSON with no markdown, no backticks.' },
      { role: 'user', content: `Generate a realistic Discord Rich Presence for: ${prompt}. Format exactly: {"name":"","details":"","state":""}` }
    ]
  }, { headers: { Authorization: `Bearer ${key}` } });

  let text = res.data.choices[0].message.content.trim();
  text = text.replace(/```json/g, '').replace(/```/g, '').trim();
  return JSON.parse(text);
}
module.exports = { generateRpc };
