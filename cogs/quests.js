const axios = require('axios');

async function delay(ms) { return new Promise(r => setTimeout(r, ms)); }

async function runQuestsForToken(token, log) {
  const headers = { Authorization: token, 'Content-Type': 'application/json' };
  try {
    // 1. Fetch current quests
    const res = await axios.get('https://discord.com/api/v9/quests/@me', { headers });
    const quests = res.data.quests || [];
    let completedCount = 0;

    for (const quest of quests) {
      const { id, config, user_status } = quest;
      const name = config.messages.quest_name;
      const expires = new Date(config.expires_at);
      if (expires < new Date()) continue;

      // 2. Claim already completed quests
      if (user_status?.completed_at && !user_status?.claimed_at) {
        await axios.post(`https://discord.com/api/v9/quests/${id}/claim-reward`, {}, { headers }).catch(()=>{});
        log(`[Claimed] ${name}`);
        completedCount++;
        continue;
      }

      if (user_status?.claimed_at) continue;

      // 3. Enroll if not enrolled
      if (!user_status?.enrolled_at) {
        await axios.post(`https://discord.com/api/v9/quests/${id}/enroll`, { location: 11 }, { headers }).catch(()=>{});
        log(`[Enrolled] ${name}`);
        await delay(2000);
      }

      // 4. Determine task type
      const taskConfig = config.task_config || config.task_config_v2;
      const taskName = Object.keys(taskConfig?.tasks || {})[0];
      if (!taskName) continue;

      const task = taskConfig.tasks[taskName];
      const target = task.target;

      // 5. Spoof progress
      if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
        log(`[Video] Watching ${name} (${target}s)`);
        let current = user_status?.progress?.[taskName]?.value || 0;
        while (current < target) {
          current += 10;
          await axios.post(`https://discord.com/api/v9/quests/${id}/video-progress`, { timestamp: Math.min(target, current) }, { headers }).catch(()=>{});
          await delay(1000);
        }
        log(`[Video] Completed ${name}`);
      } else if (taskName === 'PLAY_ON_DESKTOP' || taskName === 'STREAM_ON_DESKTOP' || taskName === 'PLAY_ACTIVITY') {
        log(`[Game] Playing ${name} (${target}s)`);
        let current = user_status?.progress?.[taskName]?.value || 0;
        while (current < target) {
          await axios.post(`https://discord.com/api/v9/quests/${id}/heartbeat`, { stream_key: null, terminal: false }, { headers }).catch(()=>{});
          current += 60; 
          await delay(2000); 
        }
        await axios.post(`https://discord.com/api/v9/quests/${id}/heartbeat`, { stream_key: null, terminal: true }, { headers }).catch(()=>{});
        log(`[Game] Completed ${name}`);
      }

      // 6. Claim
      await delay(1500);
      await axios.post(`https://discord.com/api/v9/quests/${id}/claim-reward`, {}, { headers }).catch(()=>{});
      completedCount++;
    }
    log(`Token finished. Processed ${completedCount} quests (progress toward Hypersquad).`);
  } catch (e) {
    log(`[Error] ${e.response?.status || e.message}`);
  }
}

async function startQuests(tokens, log) {
  for (let i = 0; i < tokens.length; i++) {
    log(`Processing token ${i + 1}/${tokens.length}...`);
    await runQuestsForToken(tokens[i], log);
    await delay(3000);
  }
  log(`All quests processed!`);
}

module.exports = { startQuests };
