'use strict';
const vm = require('node:vm');

// Isolated browser harness. All HTTP and Worker responses are synthetic;
// this validates the mobile-to-desktop port, not a real provider account.
async function runDeepSeekScript(source) {
  const requests = [];
  let finish;
  const result = new Promise(resolve => { finish = resolve; });
  const window = {};
  Object.defineProperty(window, '__mobile_fixture', {
    configurable: true,
    get() { return this.value; },
    set(value) { this.value = value; if (value?.done) finish(value); }
  });
  const context = {
    window, location: { host: 'chat.deepseek.com' },
    localStorage: { getItem: () => JSON.stringify({ value: 'mobile-fixture-token' }) },
    TextEncoder, TextDecoder, btoa, Blob, setTimeout, clearTimeout, AbortController,
    URL: { createObjectURL: () => 'blob:fixture', revokeObjectURL() {} },
    Worker: class {
      postMessage({ challenge }) {
        this.onmessage({ data: { type: 'pow-answer', answer: {
          algorithm: challenge.algorithm, challenge: challenge.challenge,
          salt: challenge.salt, signature: challenge.signature, answer: 5
        } } });
      }
      terminate() {}
    },
    fetch: async (url, options = {}) => {
      requests.push({ url, method: options.method || 'GET', credentials: options.credentials,
        headers: options.headers ? { ...options.headers } : undefined,
        body: options.body ? JSON.parse(options.body) : undefined });
      let body;
      if (url === '/api/v0/chat_session/create') body = { data: { biz_data: { chat_session: { id: 'fixture-chat' } } } };
      else if (url === '/api/v0/chat/create_pow_challenge') body = { data: { biz_data: { challenge: {
        algorithm: 'DeepSeekHashV1', challenge: 'thử-thách', salt: 'fixture-salt',
        signature: 'fixture-signature', difficulty: 1, expire_at: 123
      } } } };
      else if (url === '/api/v0/chat/completion') body =
        'event: ready\ndata: {"response_message_id":17}\n\n' +
        'data: {"v":{"response":{"fragments":[{"type":"THINK","content":"thinking"},{"type":"RESPONSE","content":"OK"}]}}}\n\n';
      else if (url === 'https://fe-static.deepseek.com/chat/static/76608.8f2a9fa413.js') body = 'fixture worker';
      else throw new Error(`Unexpected fixture URL: ${url}`);
      return { ok: true, status: 200, text: async () => typeof body === 'string' ? body : JSON.stringify(body) };
    }
  };
  const started = vm.runInNewContext(source, context);
  const completed = await result;
  return JSON.parse(JSON.stringify({ started, result: completed, requests }));
}

module.exports = { runDeepSeekScript };
