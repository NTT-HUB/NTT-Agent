'use strict';

const fs = require('node:fs');
const path = require('node:path');

function configureSessionStorage(app, env = process.env, platform = process.platform) {
  const local = platform === 'win32' && env.LOCALAPPDATA && path.isAbsolute(env.LOCALAPPDATA)
    ? env.LOCALAPPDATA : app.getPath('userData');
  const folder = path.join(local, 'NTTAgentDesktop', 'browser-session-v2');
  fs.mkdirSync(folder, { recursive: true });
  fs.accessSync(folder, fs.constants.R_OK | fs.constants.W_OK);
  // Keep app settings and workspace references in the original userData directory.
  // Electron needs this before ready; existing web sessions may need signing in again.
  app.setPath('sessionData', folder);
  return folder;
}

module.exports = { configureSessionStorage };
