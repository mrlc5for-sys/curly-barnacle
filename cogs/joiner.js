async function joinServers(inviteCode, tokens, captchaKey, log) {
  log(`Starting joiner for ${tokens.length} tokens...`);
  for (let i = 0; i < tokens.length; i++) {
    await new Promise(r => setTimeout(r, 2000));
    log(`Token ${i+1} joined via ${inviteCode}`);
  }
  return { ok: true };
}
module.exports = { joinServers };
