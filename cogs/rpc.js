const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const SYSTEM_PROMPT = 'You generate realistic Discord Rich Presence activities as strict JSON. Never include prose or code fences.';
const USER_PROMPT = 'Generate ONE realistic Discord Rich Presence activity.\n\nReturn ONLY valid JSON matching this shape:\n{"name":"string","details":"string or null","state":"string or null","startTimestamp":boolean,"largeImage":"string or null","largeText":"string or null","smallImage":"string or null","smallText":"string or null","buttons":[{"label":"string","url":"string"}]}\n\nRules:\n- "name" must be a real Discord-registered application name (Spotify, Visual Studio Code, YouTube, Twitch, Steam, Notion, Figma, etc.)\n- "details" and "state" must sound like a real person is using the app\n- "startTimestamp": true for anything played, watched, or listened to\n- "largeImage" and "smallImage" must be plausible asset keys for that app\n- "buttons" must be 0 or 1 items, only when a real https URL exists\n- All strings must be plain text, no markdown, no emoji\n- Return JSON only';

function normalize(rpc) {
  const out = {
    name: typeof rpc.name === 'string' ? rpc.name.slice(0, 128) : 'Unknown',
    details: rpc.details ? String(rpc.details).slice(0, 128) : null,
    state: rpc.state ? String(rpc.state).slice(0, 128) : null,
    startTimestamp: !!rpc.startTimestamp,
    assets: {}
  };
  if (rpc.largeImage) out.assets.large_image = String(rpc.largeImage);
  if (rpc.largeText) out.assets.large_text = String(rpc.largeText).slice(0, 128);
  if (rpc.smallImage) out.assets.small_image = String(rpc.smallImage);
  if (rpc.smallText) out.assets.small_text = String(rpc.smallText).slice(0, 128);
  if (!Object.keys(out.assets).length) delete out.assets;
  out.buttons = Array.isArray(rpc.buttons) ? rpc.buttons.filter(b => b && b.label && typeof b.url === 'string' && b.url.indexOf('http') === 0).slice(0, 2) : [];
  return out;
}

async function generate(env) {
  const apiKey = env.GROQ_API_KEY;
  const model = env.GROQ_MODEL || 'llama-3.3-70b-versatile';
  if (!apiKey) throw new Error('missing GROQ_API_KEY');
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: USER_PROMPT }],
      temperature: 1,
      max_tokens: 400,
      response_format: { type: 'json_object' }
    })
  });
  if (!res.ok) throw new Error('groq ' + res.status);
  const data = await res.json();
  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '{}';
  let parsed;
  try { parsed = JSON.parse(text); } catch (e) { throw new Error('groq returned invalid json'); }
  return normalize(parsed);
}

function build(config) {
  const r = config && config.rpc;
  if (!r || !r.name) return null;
  const activity = {
    name: r.name,
    type: 0,
    details: r.details || undefined,
    state: r.state || undefined,
    assets: r.assets || undefined,
    buttons: r.buttons && r.buttons.length ? r.buttons : undefined
  };
  if (r.startTimestamp) activity.timestamps = { start: Date.now() };
  return activity;
}

module.exports = { generate, build, normalize };
