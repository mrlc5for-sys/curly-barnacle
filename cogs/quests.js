const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = process.env.DATA_DIR || __dirname;
const AUTOQUEST_FILE = path.join(DATA_DIR, 'autoquest.json');
const STORE_FILE = path.join(DATA_DIR, 'tokens.json');
const ALGORITHM = 'aes-256-gcm';

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9215 Chrome/138.0.7204.251 Electron/37.6.0 Safari/537.36';
const Properties = {
  os: 'Windows', browser: 'Discord Client', release_channel: 'stable', client_version: '1.0.9215',
  os_version: '10.0.19045', os_arch: 'x64', app_arch: 'x64', system_locale: 'en-US',
  has_client_mods: false, client_launch_id: crypto.randomUUID(),
  browser_user_agent: USER_AGENT, browser_version: '37.6.0', os_sdk_version: '19045',
  client_build_number: 471091, native_build_number: 72186, client_event_source: null,
  launch_signature: crypto.randomUUID(), client_heartbeat_session_id: crypto.randomUUID(),
  client_app_state: 'focused'
};

class Quest {
  constructor(data) { this._data = data; }
  get id() { return this._data.id; }
  get config() { return this._data.config; }
  get userStatus() { return this._data.user_status; }
  isExpired(ref = new Date()) { return ref.getTime() > new Date(this._data.config.expires_at).getTime(); }
  isCompleted() { return Boolean(this.userStatus?.completed_at); }
  isEnrolledQuest() { return Boolean(this.userStatus?.enrolled_at); }
  hasClaimedRewards() { return Boolean(this.userStatus?.claimed_at); }
  updateUserStatus(s) { this._data.user_status = s; }
}

class QuestManager {
  constructor(client, quests = []) {
    this.client = client;
    this.quests = new Map();
    quests.forEach(q => this.quests.set(q.id, q));
  }
  static fromResponse(client, res) { return new QuestManager(client, res.quests.map(q => new Quest(q))); }
  list() { return Array.from(this.quests.values()); }
  getClaimable() { return this.list().filter(q => q.isCompleted() && !q.hasClaimedRewards()); }
  filterQuestsValid() { return this.list().filter(q => q.id !== '1412491570820812933' && !q.isCompleted() && !q.isExpired()); }
  
  async claimRewards(log) {
    try {
      const fresh = await this.client.get('/quests/@me');
      for (const q of fresh.quests) {
        const existing = this.quests.get(q.id);
        if (existing && q.user_status) existing.updateUserStatus(q.user_status);
      }
    } catch {}
    let claimed = 0;
    for (const q of this.getClaimable()) {
      try {
        await this.client.post(`/quests/${q.id}/claim-reward`);
        claimed++;
        log(`Claimed: ${q.config.messages.quest_name}`);
      } catch (e) { log(`Failed claim: ${e.message}`); }
    }
    return claimed;
  }

  async acceptQuest(questId) {
    const r = await this.client.post(`/quests/${questId}/enroll`, { location: 11, is_targeted: false, metadata_raw: null });
    const q = this.quests.get(questId);
    if (q) q.updateUserStatus(r.user_status || r);
    return q;
  }

  async doingQuest(quest, log) {
    const name = quest.config.messages.quest_name;
    if (!quest.isEnrolledQuest()) {
      log(`Enrolling: ${name}`);
      await this.acceptQuest(quest.id);
    }
    const tc = quest.config.task_config ?? quest.config.task_config_v2;
    if (!tc) return false;
    const taskName = Object.keys(tc.tasks || {}).find(k => tc.tasks[k]);
    if (!taskName) return false;
    const task = tc.tasks[taskName];

    if (taskName === 'WATCH_VIDEO' || taskName === 'WATCH_VIDEO_ON_MOBILE') {
      let done = 0, needed = task.target, ev = task.event_name || task.type || taskName;
      done = quest.userStatus?.progress?.[ev]?.value || 0;
      while (done < needed) {
        try {
          await this.client.post(`/quests/${quest.id}/video-progress`, { timestamp: Math.min(needed, done + 7) });
          done += 7;
        } catch {}
        await new Promise(r => setTimeout(r, 1000));
      }
      await this.client.post(`/quests/${quest.id}/video-progress`, { timestamp: needed }).catch(() => {});
      log(`Completed: ${name}`);
      return true;
    }
    if (taskName === 'PLAY_ON_DESKTOP') {
      let done = 0, needed = task.target, ev = task.event_name || task.type || taskName;
      done = quest.userStatus?.progress?.[ev]?.value || 0;
      while (done < needed && !quest.isCompleted()) {
        try {
          const r = await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: false });
          quest.updateUserStatus(r.user_status || r);
        } catch {}
        await new Promise(r => setTimeout(r, 30000));
        done = quest.userStatus?.progress?.[ev]?.value || done + 30;
      }
      await this.client.post(`/quests/${quest.id}/heartbeat`, { stream_key: null, terminal: true }).catch(() => {});
      log(`Completed: ${name}`);
      return true;
    }
    return false;
  }
}

class QuestClient {
  constructor(token) { this.token = token; }
  _headers() {
    return {
      'Authorization': this.token, 'User-Agent': USER_AGENT, 'Content-Type': 'application/json',
      'accept-language': 'en-US', 'origin': 'https://discord.com', 'referer': 'https://discord.com/channels/@me',
      'x-super-properties': Buffer.from(JSON.stringify(Properties)).toString('base64')
    };
  }
  async get(path) {
    const r = await fetch(`https://discord.com/api/v10${path}`, { headers: this._headers() });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  async post(path, body) {
    const r = await fetch(`https://discord.com/api/v10${path}`, { method: 'POST', headers: this._headers(), body: body ? JSON.stringify(body) : undefined });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }
  async fetchQuests() {
    const res = await this.get('/quests/@me');
    return QuestManager.fromResponse(this, res);
  }
}

async function startQuests(tokens, autoAccept, autoClaim, log = console.log) {
  for (const t of tokens) {
    try {
      log(`Processing ${t.label || 'token'}...`);
      const client = new QuestClient(t.token);
      const manager = await client.fetchQuests();
      
      if (autoClaim) await manager.claimRewards(log);
      if (autoAccept) {
        const valid = manager.filterQuestsValid();
        for (const q of valid) {
          await manager.doingQuest(q, log);
        }
      }
      log(`Finished ${t.label || 'token'}`);
    } catch (e) {
      log(`Error on ${t.label || 'token'}: ${e.message}`);
    }
  }
}

module.exports = { startQuests, QuestClient, QuestManager };
