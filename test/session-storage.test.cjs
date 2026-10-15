'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { configureSessionStorage } = require('../lib/session-storage.cjs');

test('cache Session dùng folder ghi được riêng; userData hiện có giữ nguyên', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntt-session-data-'));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const userData = path.join(temp, 'settings');
  fs.mkdirSync(userData);
  fs.writeFileSync(path.join(userData, 'settings.json'), '{"models":{}}');
  let selected;
  const app = { getPath(name) { assert.equal(name, 'userData'); return userData; },
    setPath(name, folder) { assert.equal(name, 'sessionData'); selected = folder; } };
  const folder = configureSessionStorage(app, { LOCALAPPDATA: temp }, 'win32');
  assert.equal(folder, selected);
  assert.equal(folder, path.join(temp, 'NTTAgentDesktop', 'browser-session-v2'));
  fs.writeFileSync(path.join(folder, 'writable'), 'yes');
  assert.equal(fs.readFileSync(path.join(userData, 'settings.json'), 'utf8'), '{"models":{}}');
});
