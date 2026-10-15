'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const reference = require('./fixtures/deepseek-mobile-wire.json');
const { runDeepSeekScript } = require('./helpers/deepseek-runtime.cjs');
const { parseDeepSeekResponse } = require('../lib/deepseek-response.cjs');
const desktop = fs.readFileSync(path.join(__dirname, '../lib/session-scripts/deepseek.js'), 'utf8');

for (const { params, expected } of reference.cases) {
  test(`Request PC khớp bản mobile đã gửi: Thinking=${params.thinkingEnabled}, Web Search=${params.searchEnabled}`, async () => {
    const code = `(() => { const parseDeepSeekResponse = ${parseDeepSeekResponse.toString()};\n${desktop}\nreturn startPrivateSession(${JSON.stringify(params)}); })()`;
    const actual = await runDeepSeekScript(code);
    assert.deepEqual(actual, expected);
  });
}
