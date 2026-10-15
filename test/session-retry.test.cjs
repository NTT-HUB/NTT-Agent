'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { retrySessionFetch } = require('../lib/session-retry.cjs');

test('Failed to fetch thử lại tối đa 3 lần và báo tiến độ', async () => {
  let attempts = 0;
  const retries = [];
  const answer = await retrySessionFetch(async () => {
    attempts++;
    if (attempts < 3) throw new Error('gemini Session: Failed to fetch');
    return 'xong';
  }, { delays: [0, 0], onRetry: (next, max) => retries.push([next, max]) });
  assert.equal(answer, 'xong');
  assert.equal(attempts, 3);
  assert.deepEqual(retries, [[2, 3], [3, 3]]);
  await assert.rejects(retrySessionFetch(async () => { throw new Error('Failed to fetch'); }, { delays: [0, 0] }), /Failed to fetch/);
});

test('lỗi khác không thử lại; dừng tác vụ trong khi đợi retry', async () => {
  let attempts = 0;
  await assert.rejects(retrySessionFetch(async () => { attempts++; throw new Error('HTTP 403'); }), /403/);
  assert.equal(attempts, 1);
  const controller = new AbortController();
  await assert.rejects(retrySessionFetch(async () => {
    attempts++;
    controller.abort();
    throw new Error('Failed to fetch');
  }, { signal: controller.signal, delays: [0, 0] }), /Đã dừng/);
  assert.equal(attempts, 2);
});

test('backend_err chỉ thử tối đa ba lần khi có cờ xác nhận; không suy đoán từ nội dung văn bản', async () => {
  let attempts = 0;
  await assert.rejects(retrySessionFetch(async () => {
    attempts++;
    const error = new Error('Server is temporarily unavailable. [backend_err]');
    error.code = 'backend_err'; error.retryable = true;
    throw error;
  }, { delays: [0, 0] }), /backend_err/);
  assert.equal(attempts, 3);
  attempts = 0;
  await assert.rejects(retrySessionFetch(async () => {
    attempts++; throw new Error('backend_err');
  }, { delays: [0, 0] }), /backend_err/);
  assert.equal(attempts, 1);
});

test('generation_err thử tối đa ba lượt và gửi nguyên nhân cho trạng thái thử lại', async () => {
  let attempts = 0;
  const retries = [];
  await assert.rejects(retrySessionFetch(async () => {
    attempts++;
    const error = new Error('服务器暂时不可用 [generation_err]');
    error.code = 'generation_err'; error.retryable = true;
    throw error;
  }, { delays: [0, 0], onRetry: (next, max, error) => retries.push([next, max, error.code]) }), /generation_err/);
  assert.equal(attempts, 3);
  assert.deepEqual(retries, [[2, 3, 'generation_err'], [3, 3, 'generation_err']]);
});

test('Dừng trong lúc chờ thử lại generation_err thì không gửi thêm request', async () => {
  const controller = new AbortController();
  let attempts = 0;
  await assert.rejects(retrySessionFetch(async () => {
    attempts++;
    const error = new Error('generation_err');
    error.code = 'generation_err'; error.retryable = true;
    throw error;
  }, { signal: controller.signal, onRetry: () => controller.abort() }), /Đã dừng/);
  assert.equal(attempts, 1);
});
