'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { complete } = require('../lib/providers.cjs');

test('Gemini 4 Argon API gọi Interactions và đọc model_output', async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, body: JSON.parse(options.body) };
    return { ok: true, text: async () => JSON.stringify({
      steps: [
        { type: 'model_thought', content: [{ type: 'text', text: 'ẩn' }] },
        { type: 'model_output', content: [{ type: 'text', text: 'Argon trả lời' }] }
      ]
    }) };
  };
  try {
    const answer = await complete({ provider: 'gemini', model: 'gemini-4-argon',
      messages: [{ role: 'user', content: 'Xin chào' }], key: 'test-key' });
    assert.equal(answer, 'Argon trả lời');
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/interactions');
    assert.equal(request.body.model, 'gemini-4-argon');
  } finally { global.fetch = original; }
});
