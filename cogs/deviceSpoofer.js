const crypto = require('crypto');

const PROFILES = {
  desktop: {
    os: 'Windows', browser: 'Discord Client', device: '',
    os_version: '10.0.22631', os_arch: 'x64', app_version: '1.0.9164',
    browser_user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) discord/1.0.9164 Chrome/124.0.6367.243 Electron/30.0.9 Safari/537.36',
    browser_version: '22.11.0', os_sdk_version: '0'
  },
  mobile: {
    os: 'Android', browser: 'Discord Android', device: 'SM-S928B',
    os_version: '14', os_arch: 'arm64', app_version: '245.14',
    browser_user_agent: 'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36',
    browser_version: '245.14', os_sdk_version: '34'
  },
  console: {
    os: 'PlayStation 5', browser: 'Discord Console', device: 'PS5',
    os_version: '3.00', os_arch: 'x64', app_version: '1.0.0',
    browser_user_agent: 'Mozilla/5.0 (PlayStation; PlayStation 5/3.00) AppleWebKit/605.1.15 (KHTML, like Gecko)',
    browser_version: '1.0.0', os_sdk_version: '0'
  },
  vr: {
    os: 'Oculus', browser: 'Discord VR', device: 'Quest 3',
    os_version: '12', os_arch: 'arm64', app_version: '1.0.0',
    browser_user_agent: 'Mozilla/5.0 (Linux; Android 12; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/32.0.0.0.0 SamsungBrowser/4.0 Chrome/120.0.0.0 VR Safari/537.36',
    browser_version: '1.0.0', os_sdk_version: '32'
  }
};

function generateProfile(type = 'desktop') {
  const p = PROFILES[type] || PROFILES.desktop;
  return {
    os: p.os,
    browser: p.browser,
    device: p.device,
    system_locale: 'en-US',
    client_version: p.app_version,
    os_version: p.os_version,
    os_arch: p.os_arch,
    app_version: p.app_version,
    release_channel: 'stable',
    browser_user_agent: p.browser_user_agent,
    browser_version: p.browser_version,
    os_sdk_version: p.os_sdk_version,
    client_build_number: Math.floor(Math.random() * 5000) + 290000,
    native_build_number: Math.floor(Math.random() * 5000) + 45000,
    client_event_source: null,
    launch_signature: crypto.randomUUID(),
    client_heartbeat_session_id: crypto.randomUUID(),
    client_app_state: 'focused',
    has_client_mods: false
  };
}

module.exports = { generateProfile, PROFILES };
