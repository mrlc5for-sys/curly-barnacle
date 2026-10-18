const axios = require('axios');
async function generate100Chats() {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('GROQ_API_KEY missing');
  const res = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: 'llama-3.3-70b-versatile',
    messages: [{ role: 'system', content: 'Return exactly 100 lines of realistic, casual, lowercase Discord chat. No numbering. Just text.' }]
  }, { headers: { Authorization: `Bearer ${key}` } });
  return res.data.choices[0].message.content.trim();
}
module.exports = { generate100Chats };
