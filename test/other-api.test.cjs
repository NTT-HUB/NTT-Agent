'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { complete, messagesEndpoint } = require('../lib/providers.cjs');

test('Other gọi Anthropic Messages trên Base URL tùy chỉnh và tách system prompt', async () => {
  const original = global.fetch;
  let request;
  global.fetch = async (url, options) => {
    request = { url, headers: options.headers, body: JSON.parse(options.body) };
    return { ok: true, text: async () => JSON.stringify({ content: [
      { type: 'text', text: 'Xin ' }, { type: 'thinking', thinking: 'bỏ qua' },
      { type: 'text', text: 'chào' }
    ] }) };
  };
  try {
    const text = await complete({ provider: 'other', model: 'backend-model',
      baseUrl: 'https://api.example.test', key: 'fake-test-key', messages: [
        { role: 'system', content: 'Trả lời ngắn' },
        { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello' },
        { role: 'user', content: 'Chào' }
      ] });
    assert.equal(text, 'Xin chào');
    assert.equal(request.url, 'https://api.example.test/v1/messages');
    assert.equal(request.headers['x-api-key'], 'fake-test-key');
    assert.equal(request.headers['anthropic-version'], '2023-06-01');
    assert.equal(request.body.system, 'Trả lời ngắn');
    assert.equal(request.body.max_tokens, 4096);
    assert.deepEqual(request.body.messages.map(m => m.role), ['user', 'assistant', 'user']);
  } finally { global.fetch = original; }
});

test('Base URL chấp nhận các hậu tố phổ biến và giới hạn HTTP ở loopback', () => {
  assert.equal(messagesEndpoint('https://api.example.test/v1'), 'https://api.example.test/v1/messages');
  assert.equal(messagesEndpoint('https://api.example.test/v1/messages'), 'https://api.example.test/v1/messages');
  assert.equal(messagesEndpoint('http://localhost:8080'), 'http://localhost:8080/v1/messages');
  assert.throws(() => messagesEndpoint('http://api.example.test'), /HTTPS/);
  assert.throws(() => messagesEndpoint('https://user:pass@api.example.test'), /HTTPS/);
  assert.throws(() => messagesEndpoint('file:///tmp/key'), /HTTPS/);
});
