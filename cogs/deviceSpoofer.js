const PROFILES = [
  { os: 'Windows', os_version: '10.0.19045', os_arch: 'x64', browser: 'Discord Client', browser_version: '22.11.0', client_version: '1.0.9164', browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.0.9 Safari/537.36', device: '' },
  { os: 'Windows', os_version: '10.0.22631', os_arch: 'x64', browser: 'Discord Client', browser_version: '22.11.0', client_version: '1.0.9164', browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.0.9 Safari/537.36', device: '' },
  { os: 'Mac OS X', os_version: '14.5.0', os_arch: 'arm64', browser: 'Discord Client', browser_version: '22.11.0', client_version: '1.0.9164', browser_user_agent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.0.9 Safari/537.36', device: '' },
  { os: 'Android', os_version: '14', os_arch: 'arm64', browser: 'Discord Android', browser_version: '245.14', client_version: '245.14', browser_user_agent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36', device: 'SM-S928B' },
  { os: 'iOS', os_version: '17.5', os_arch: 'arm64', browser: 'Discord iOS', browser_version: '244.0', client_version: '244.0', browser_user_agent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', device: 'iPhone' }
];
function pickProfile() { return PROFILES[Math.floor(Math.random() * PROFILES.length)]; }
function buildIdentify() {
  const p = pickProfile();
  return {
    properties: {
      os: p.os, browser: p.browser, device: p.device, system_locale: 'en-US', client_version: p.client_version, os_version: p.os_version, os_arch: p.os_arch, app_version: p.client_version, release_channel: 'stable', browser_user_agent: p.browser_user_agent, browser_version: p.browser_version, os_sdk_version: '0', client_build_number: 290000 + Math.floor(Math.random() * 1000), native_build_number: 45000 + Math.floor(Math.random() * 1000), client_event_source: null
    },
    compress: false
  };
}
function buildSuperProperties() {
  const p = pickProfile();
  return Buffer.from(JSON.stringify({
    os: p.os, browser: p.browser, device: p.device, system_locale: 'en-US', client_version: p.client_version, os_version: p.os_version, os_arch: p.os_arch, app_version: p.client_version, release_channel: 'stable', browser_user_agent: p.browser_user_agent, browser_version: p.browser_version, os_sdk_version: '0', client_build_number: 290000 + Math.floor(Math.random() * 1000), native_build_number: 45000 + Math.floor(Math.random() * 1000)
  })).toString('base64');
}
module.exports = { pickProfile, buildIdentify, buildSuperProperties, PROFILES };
