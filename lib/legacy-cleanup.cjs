'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

// Retire only the helper registered by 0.20 for this app's own user-data folder.
async function retireBrowserLink(userData, { platform = process.platform, run = promisify(execFile) } = {}) {
  if (platform !== 'win32') return false;
  const key = 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.ntt.agentdesktop.link';
  try {
    const result = await run('reg.exe', ['QUERY', key, '/ve'], { windowsHide: true, timeout: 1500 });
    const registered = /REG_SZ\s+(.+?)\s*$/m.exec(result.stdout)?.[1];
    const expected = path.win32.join(userData, 'native-link', 'com.ntt.agentdesktop.link.json');
    if (!registered || path.win32.normalize(registered).toLowerCase() !== path.win32.normalize(expected).toLowerCase()) return false;
    await run('reg.exe', ['DELETE', key, '/f'], { windowsHide: true, timeout: 1500 });
    return true;
  } catch { return false; }
}
module.exports = { retireBrowserLink };
