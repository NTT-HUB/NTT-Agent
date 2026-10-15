'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Settings } = require('../lib/settings.cjs');

test('câu hỏi lựa chọn còn nút sau khi lưu và mở lại chat', () => {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'ntt-chat-'));
  try {
    const options = ['Web game', 'Web blog'];
    const settings = new Settings(folder, {});
    settings.setChat('project', [{ role: 'assistant', text: 'Bạn chọn web nào?', options }]);
    assert.deepEqual(new Settings(folder, {}).chat('project')[0].options, options);
    settings.setChat('project', [{ role: 'assistant', text: 'Xong' }]);
    assert.equal(new Settings(folder, {}).chat('project')[0].options, undefined);
  } finally { fs.rmSync(folder, { recursive: true, force: true }); }
});
