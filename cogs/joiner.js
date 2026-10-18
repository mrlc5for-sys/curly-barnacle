const crypto = require('crypto');
const delay = (ms) => new Promise(r => setTimeout(r, ms));

async function solveHCaptcha(apiKey, sitekey, url, log) {
  try {
    const reqUrl = `https://2captcha.com/in.php?key=${apiKey}&method=hcaptcha&sitekey=${sitekey}&pageurl=${encodeURIComponent(url)}&json=1`;
    const res = await fetch(reqUrl);
    const data = await res.json();
    if (data.status !== 1) throw new Error(data.request);
    
    log(`Captcha sent to 2Captcha (ID: ${data.request}). Waiting...`);
    const taskId = data.request;

    for (let i = 0; i < 30; i++) {
      await delay(5000);
      const pollUrl = `https://2captcha.com/res.php?key=${apiKey}&action=get&id=${taskId}&json=1`;
      const pollRes = await fetch(pollUrl);
      const pollData = await pollRes.json();
      
      if (pollData.status === 1) {
        log('Captcha solved successfully.');
        return pollData.request;
      }
      if (pollData.request !== 'CAPCHA_NOT_READY') throw new Error(pollData.request);
    }
    throw new Error('Captcha timeout');
  } catch (e) {
    log(`Solver error: ${e.message}`);
    return null;
  }
}

async function joinServers(inviteCode, tokens, delaySec, captchaKey, log = console.log) {
  if (!tokens.length) return log('No tokens provided');
  if (!inviteCode) return log('No invite code provided');

  const extractCode = (str) => str.replace(/(https?:\/\/)?(www\.)?(discord\.gg|discord\.com\/invite)\//i, '').trim();
  const code = extractCode(inviteCode);
  
  const headers = (token) => ({
    'Authorization': token,
    'Content-Type': 'application/json',
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36'
  });

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    log(`[${i+1}/${tokens.length}] ${t.label} joining...`);
    
    let payload = { session_id: crypto.randomUUID() };
    let success = false;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(`https://discord.com/api/v10/invites/${code}`, {
          method: 'POST',
          headers: headers(t.token),
          body: JSON.stringify(payload)
        });
        
        if (res.ok) {
          log(`Success: ${t.label}`);
          success = true;
          break;
        }

        const err = await res.json();
        
        if (err.captcha_key && err.captcha_sitekey && captchaKey) {
          log(`Captcha required for ${t.label}.`);
          const solvedKey = await solveHCaptcha(captchaKey, err.captcha_sitekey, `https://discord.com/invite/${code}`, log);
          if (solvedKey) {
            payload.captcha_key = solvedKey;
            if (err.captcha_rqtoken) payload.captcha_rqtoken = err.captcha_rqtoken;
            continue;
          } else {
            break;
          }
        } else {
          log(`Failed: ${t.label} (${res.status} ${err.message || ''})`);
          break;
        }
      } catch (e) {
        log(`Error on ${t.label}: ${e.message}`);
        break;
      }
    }
    await delay(delaySec * 1000);
  }
  log('Joiner task finished.');
}

module.exports = { joinServers };
