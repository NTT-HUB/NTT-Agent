'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { PrivateSessionBridge, GEMINI_ROUTES } = require('../lib/private-session.cjs');

test('Argon Session có route riêng mode 8 và model ID của Argon', () => {
  const route = GEMINI_ROUTES['4 Argon'];
  const header = JSON.parse(route.modelHeader);
  assert.equal(route.modelMode, 8);
  assert.equal(header[4], '95a4c0abcba24364');
  assert.equal(header[14], 8);
  assert.notEqual(route.modelHeader, GEMINI_ROUTES['3.1 Pro'].modelHeader);
});

async function fixture(provider, fetch) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'ntt-private-'));
  const context = {
    window: {}, document: { title: 'Session', body: { innerText: '' } },
    location: { host: provider === 'gemini' ? 'gemini.google.com' : 'chat.deepseek.com', pathname: '/app' },
    localStorage: { getItem: () => 'test-token' },
    self: { crypto: { randomUUID: () => '12345678-1234-4234-8234-123456789abc' } },
    crypto: { randomUUID: () => '12345678-1234-4234-8234-123456789abc' },
    URLSearchParams, TextEncoder, TextDecoder, AbortController, btoa, fetch, setTimeout, clearTimeout,
    navigator: { language: 'vi-VN' }, Intl,
    Blob, URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
    Worker: class { postMessage() { this.onmessage({ data: { type: 'pow-answer',
      answer: { algorithm: 'algo', challenge: 'challenge', salt: 'salt', answer: 5, signature: 'sign' }
    } }); } terminate() {} }
  };
  const bridge = new PrivateSessionBridge(userData, (_provider, code) => vm.runInNewContext(code, context));
  return { bridge, userData, context };
}

test('Gemini Session gọi StreamGenerate và giữ ID hội thoại từ response', async t => {
  const urls = [];
  const modes = [];
  const part = [null, ['cid-1', 'rid-1'], null, null, [['choice-1', ['Xin chào']]]];
  const stream = JSON.stringify(['wrb.fr', null, JSON.stringify(part)]);
  const fetch = async (url, options = {}) => {
    urls.push(url);
    if (options.body && String(url).includes('StreamGenerate')) {
      const request = JSON.parse(JSON.parse(new URLSearchParams(options.body).get('f.req'))[1]);
      modes.push(request[79]);
    }
    return { ok: true, status: 200, text: async () => url.endsWith('/app')
      ? '{"SNlM0e":"at","FdrFJe":"123","cfb2h":"build"}' : stream };
  };
  const { bridge, userData } = await fixture('gemini', fetch);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const result = await bridge.complete('gemini', 'hi', { model: '3.6 Flash' });
  assert.equal(result, 'Xin chào');
  assert.ok(urls.some(url => url.includes('/StreamGenerate?')));
  assert.equal(bridge.lineage.gemini.conversationId, 'cid-1');
  assert.equal(await bridge.complete('gemini', 'hi Argon', { model: '4 Argon' }), 'Xin chào');
  assert.deepEqual(modes, [1, 8]);
});

test('Argon Session báo lỗi khi Gemini trả về model Flash', async t => {
  const fallback = [null, ['cid', 'rid'], null, null, [['choice', ['Trả lời Flash']]]];
  fallback[42] = 'gemini-3.6-flash';
  const stream = JSON.stringify(['wrb.fr', null, JSON.stringify(fallback)]);
  const { bridge, userData } = await fixture('gemini', async url => ({
    ok: true, status: 200, text: async () => url.endsWith('/app')
      ? '{"SNlM0e":"at","FdrFJe":"123","cfb2h":"build"}' : stream
  }));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  await assert.rejects(bridge.complete('gemini', 'hi', { model: '4 Argon' }), /chuyển yêu cầu Argon sang/);
});

test('DeepSeek Session gọi /api/v0, giải thử thách qua worker và giữ parent_message_id', async t => {
  const urls = [];
  const completions = [];
  let created = 11;
  const sse = 'event: ready\ndata: {"response_message_id":17}\n\n' +
    'data: {"v":{"response":{"fragments":[{"type":"RESPONSE","content":"Xin chào"}]}}}\n\n';
  const fetch = async (url, options = {}) => {
    urls.push(url);
    let body = sse;
    if (url.includes('chat_session/create')) body = JSON.stringify({ data: { biz_data: { chat_session: { id: ++created } } } });
    if (url.includes('chat/completion')) completions.push(JSON.parse(options.body));
    else if (url.includes('pow_challenge')) body = JSON.stringify({ data: { biz_data: { challenge: {
      algorithm: 'algo', challenge: 'challenge', salt: 'salt', difficulty: 1, signature: 'sign', expire_at: 1
    } } } });
    else if (url.includes('fe-static')) body = 'worker source';
    return { ok: true, status: 200, text: async () => body };
  };
  const { bridge, userData } = await fixture('deepseek', fetch);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const result = await bridge.complete('deepseek', 'hi');
  assert.equal(result, 'Xin chào');
  assert.ok(urls.some(url => url === '/api/v0/chat/completion'));
  assert.equal(bridge.lineage.deepseek.sessionId, '12');
  assert.equal(bridge.lineage.deepseek.parentMessageId, '17');
  assert.equal(await bridge.complete('deepseek', 'bật nghĩ', { thinkingEnabled: true }), 'Xin chào');
  assert.equal(bridge.lineage.deepseek.sessionId, '12');
  assert.equal(completions[1].parent_message_id, 17);
  assert.equal(completions[1].thinking_enabled, true);
  assert.equal(completions[1].search_enabled, false);
  assert.equal(await bridge.complete('deepseek', 'bật tìm kiếm', { thinkingEnabled: true, searchEnabled: true }), 'Xin chào');
  assert.equal(bridge.lineage.deepseek.sessionId, '12');
  assert.equal(completions[2].parent_message_id, 17);
  assert.equal(completions[2].search_enabled, true);
  assert.equal(await bridge.complete('deepseek', 'tiếp', { thinkingEnabled: true, searchEnabled: true }), 'Xin chào');
  assert.equal(bridge.lineage.deepseek.sessionId, '12');
  assert.equal(completions[3].parent_message_id, 17);
});

test('DeepSeek phục hồi HTTP không phải lỗi đăng nhập một lần như mobile rồi báo lỗi', async t => {
  let creates = 0, completions = 0;
  const fetch = async url => {
    let status = 200, body = '';
    if (url.includes('chat_session/create')) {
      creates++;
      body = JSON.stringify({ data: { biz_data: { chat_session: { id: 55 } } } });
    } else if (url.includes('pow_challenge')) {
      body = JSON.stringify({ data: { biz_data: { challenge: {
        algorithm: 'algo', challenge: 'challenge', salt: 'salt', difficulty: 1, signature: 'sign', expire_at: 1
      } } } });
    } else if (url.includes('fe-static')) body = 'worker source';
    else if (url.includes('chat/completion')) {
      completions++;
      status = 400;
      body = JSON.stringify({ message: 'Chế độ tìm kiếm chưa sẵn sàng' });
    }
    return { ok: status === 200, status, text: async () => body };
  };
  const { bridge, userData } = await fixture('deepseek', fetch);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  await assert.rejects(bridge.complete('deepseek', 'tìm giúp', { searchEnabled: true }),
    /DeepSeek private API 400: Chế độ tìm kiếm chưa sẵn sàng/);
  assert.equal(creates, 2);
  assert.equal(completions, 2);
});

async function deepseekFixture(completion) {
  const requests = [], headers = [];
  let creates = 0, challenges = 0;
  const fetch = async (url, options = {}) => {
    let body;
    if (url.includes('chat_session/create')) { creates++; body = JSON.stringify({ data: { biz_data: { chat_session: { id: 54 + creates } } } }); }
    else if (url.includes('pow_challenge')) { challenges++; body = JSON.stringify({ data: { biz_data: { challenge: {
      algorithm: 'algo', challenge: 'challenge', salt: 'salt', difficulty: 1, signature: 'sign', expire_at: 1
    } } } }); }
    else if (url.includes('fe-static')) body = 'worker source';
    else if (url.includes('chat/completion')) {
      requests.push(JSON.parse(options.body));
      headers.push(options.headers);
      body = typeof completion === 'function' ? completion(requests.length) : completion;
    } else throw new Error(`Unexpected test request: ${url}`);
    return { ok: true, status: 200, text: async () => body };
  };
  return { ...await fixture('deepseek', fetch), requests, headers, counts: () => ({ creates, challenges }) };
}

test('DeepSeek đọc được câu trả lời dạng content qua bridge, truyền đúng DeepThink/Web Search và tiếp nối ID mới', async t => {
  const { bridge, userData, requests } = await deepseekFixture(turn =>
    `event: ready\ndata: {"response_message_id":${turn + 20}}\n\n` +
    'data: {"p":"response/content","o":"APPEND","v":"Xin"}\n\n' +
    'data: {"v":" chào"}\n\n' +
    'data: {"p":"response/status","v":"FINISHED"}\n\n');
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  for (let i = 0; i < 2; i++)
    assert.equal(await bridge.complete('deepseek', 'hi', { thinkingEnabled: true, searchEnabled: true }), 'Xin chào');
  assert.equal(requests[0].thinking_enabled, true);
  assert.equal(requests[0].search_enabled, true);
  assert.equal(requests[1].parent_message_id, 21);
  assert.equal(bridge.lineage.deepseek.parentMessageId, '22');
});

test('DeepSeek HTTP 200 chứa lỗi nghiệp vụ được báo nguyên nhân, không gửi lặp và không lưu hội thoại lỗi', async t => {
  const { bridge, userData, requests } = await deepseekFixture(JSON.stringify({ code: 0, data: {
    biz_code: 101, biz_msg: 'Search temporarily unavailable'
  } }));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  await assert.rejects(bridge.complete('deepseek', 'hi', { searchEnabled: true }), /Search temporarily unavailable/);
  assert.equal(requests.length, 1);
  assert.equal(bridge.lineage.deepseek, undefined);
});

test('Bridge báo toast ba gói, không gửi lại lỗi chưa rõ và dùng đúng header mobile', async t => {
  const raw = 'event: update_session\ndata: {"updated_at":1}\n\n' +
    'event: toast\ndata: {"type":"error","content":"Server refused the request","finish_reason":"REQUEST_REJECTED"}\n\n' +
    'event: close\ndata: {"click_behavior":"none"}\n\n';
  const { bridge, userData, requests, headers } = await deepseekFixture(raw);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  await assert.rejects(bridge.complete('deepseek', 'hi'), /Server refused the request.*REQUEST_REJECTED/);
  assert.equal(requests.length, 1);
  assert.equal(headers[0]['x-client-version'], '2.2.0');
  assert.equal(headers[0]['x-client-locale'], 'zh_CN');
  assert.equal(headers[0]['x-client-timezone-offset'], undefined);
});

test('Session ID bị máy chủ báo không hợp lệ được thay một lần, không xóa đăng nhập', async t => {
  const ok = 'event: ready\ndata: {"response_message_id":23}\n\n' +
    'data: {"p":"response/content","o":"APPEND","v":"OK"}\n\n';
  const refused = 'event: toast\ndata: {"type":"error","content":"Session no longer exists","finish_reason":"INVALID_SESSION_ID"}\n\n';
  const { bridge, userData, requests, counts } = await deepseekFixture(turn => turn === 2 ? refused : ok);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  assert.equal(await bridge.complete('deepseek', 'first'), 'OK');
  assert.equal(await bridge.complete('deepseek', 'second'), 'OK');
  assert.equal(requests.length, 3);
  assert.equal(requests[1].chat_session_id, '55');
  assert.equal(requests[2].chat_session_id, '56');
  assert.equal(requests[2].parent_message_id, null);
  assert.deepEqual(counts(), { creates: 2, challenges: 3 });
});

test('PoW chỉ được lấy mới một lần khi máy chủ báo sai proof; không lặp vô hạn', async t => {
  const raw = 'event: toast\ndata: {"type":"error","content":"Proof is invalid","finish_reason":"INVALID_POW_RESPONSE"}\n\n';
  const { bridge, userData, requests, counts } = await deepseekFixture(raw);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  await assert.rejects(bridge.complete('deepseek', 'hi'), /Proof is invalid/);
  assert.equal(requests.length, 2);
  assert.deepEqual(counts(), { creates: 1, challenges: 2 });
});

test('backend_err từ server qua bridge được thử lại, thành công ở lần thứ ba', async t => {
  const { retrySessionFetch } = require('../lib/session-retry.cjs');
  const busy = 'event: toast\ndata: {"type":"error","content":"Server is temporarily unavailable.","finish_reason":"backend_err"}\n\n';
  const ok = 'data: {"p":"response/content","o":"APPEND","v":"OK"}\n\n';
  const { bridge, userData, requests } = await deepseekFixture(turn => turn < 3 ? busy : ok);
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const result = await retrySessionFetch(() => bridge.complete('deepseek', 'hi'), { delays: [0, 0] });
  assert.equal(result, 'OK');
  assert.equal(requests.length, 3);
});

test('Agent gặp generation_err thì thử lại đúng bước model, giữ bước ghi file đã xong', async t => {
  const { retrySessionFetch } = require('../lib/session-retry.cjs');
  const { runAgent } = require('../lib/agent.cjs');
  const tool = { type: 'tool', tool: 'write_file', reason: 'Tạo file được người dùng yêu cầu', args: { path: 'done.txt', content: 'xong' } };
  const partial = { type: 'tool', tool: 'run_command', reason: 'Câu trả lời dở dang phải được bỏ qua', args: { command: 'must-not-execute' } };
  const answer = { type: 'final', message: 'Đã ghi done.txt.' };
  const stream = (value, id) => `event: ready\ndata: {"response_message_id":${id}}\n\n` +
    `data: ${JSON.stringify({ v: { response: { fragments: [{ type: 'RESPONSE', content: JSON.stringify(value) }] } } })}\n\n`;
  const failed = stream(partial, 24) +
    'event: hint\ndata: {"type":"error","content":"服务器暂时不可用","finish_reason":"generation_err","clear_response":true}\n\n';
  const { bridge, userData, requests } = await deepseekFixture(turn =>
    turn === 1 ? stream(tool, 23) : turn < 4 ? failed : stream(answer, 24));
  t.after(() => fs.rmSync(userData, { recursive: true, force: true }));
  const writes = [], retries = [];
  let commands = 0;
  const result = await runAgent({ provider: 'deepseek', mode: 'agent', prompt: 'Tạo done.txt', territoryId: 'demo' }, {
    manager: {
      writeFile: async (_id, file, content) => { writes.push([file, content]); return { path: file }; },
      execute: async () => { commands++; throw new Error('partial tool must never run'); }
    },
    completeModel: ({ messages }) => retrySessionFetch(() => bridge.complete('deepseek', messages.at(-1).content), {
      delays: [0, 0], onRetry: next => retries.push(next)
    })
  });
  assert.equal(result, 'Đã ghi done.txt.');
  assert.deepEqual(writes, [['done.txt', 'xong']]);
  assert.equal(commands, 0);
  assert.deepEqual(retries, [2, 3]);
  assert.equal(requests.length, 4);
  assert.ok(requests.slice(1).every(request => request.chat_session_id === '55' && request.parent_message_id === 23));
  assert.equal(requests[1].prompt, requests[2].prompt);
  assert.equal(requests[2].prompt, requests[3].prompt);
});
