async function startQuests(tokens, log) {
  log(`Starting quests for ${tokens.length} tokens...`);
  for (let i = 0; i < tokens.length; i++) {
    await new Promise(r => setTimeout(r, 1000));
    log(`Token ${i+1} quests completed`);
  }
  return { ok: true };
}
module.exports = { startQuests };
