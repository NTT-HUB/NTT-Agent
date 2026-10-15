'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PROVIDERS, complete } = require('../lib/providers.cjs');
const { Settings } = require('../lib/settings.cjs');
const { retireBrowserLink } = require('../lib/legacy-cleanup.cjs');

test('Nhà cung cấp đã gỡ bị từ chối; nâng cấp xóa key/model cũ và giữ chat', async t => {
  assert.deepEqual(Object.keys(PROVIDERS), ['gemini', 'deepseek', 'other']);
  await assert.rejects(complete({ provider: 'openai', model: 'old', key: 'fake', messages: [] }), /không được hỗ trợ/);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntt-migrate-'));
  t.after(() => fs.rmSync(folder, { recursive: true, force: true }));
  fs.writeFileSync(path.join(folder, 'settings.json'), JSON.stringify({
    models: { openai: 'old', gemini: 'current' }, encryptedKeys: { openai: 'old-key' },
    chats: { project: [{ role: 'user', text: 'Giữ tin nhắn này' }] }
  }));
  const settings = new Settings(folder, {});
  assert.equal(Object.hasOwn(settings.data.models, 'openai'), false);
  assert.equal(Object.hasOwn(settings.data.encryptedKeys, 'openai'), false);
  assert.equal(settings.data.models.gemini, 'current');
  assert.equal(settings.chat('project')[0].text, 'Giữ tin nhắn này');
  assert.deepEqual(Object.keys(settings.keyStatus()), ['gemini', 'deepseek', 'other']);
});

test('Dọn helper cũ chỉ xóa đúng đăng ký của app hiện tại, không xóa đường dẫn khác', async () => {
  const home = 'C:\\Users\\ROSA\\AppData\\Roaming\\ntt-agent-desktop';
  const expected = path.win32.join(home, 'native-link', 'com.ntt.agentdesktop.link.json');
  const calls = [];
  const run = async (_exe, args) => { calls.push(args); return { stdout: `    (Default)    REG_SZ    ${expected}\r\n` }; };
  assert.equal(await retireBrowserLink(home, { platform: 'win32', run }), true);
  assert.deepEqual(calls.map(args => args[0]), ['QUERY', 'DELETE']);
  const other = [];
  assert.equal(await retireBrowserLink(home, { platform: 'win32', run: async (_exe, args) => {
    other.push(args); return { stdout: '    (Default)    REG_SZ    C:\\other\\manifest.json\r\n' };
  } }), false);
  assert.equal(other.length, 1);
});
