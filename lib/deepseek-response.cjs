'use strict';

// Self-contained: the bridge also runs this function on the DeepSeek origin.
function parseDeepSeekResponse(raw) {
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const response = { fragments: [] };
  let responseMessageId = null;
  let lastPath = 'response/content';
  let lastOperation = 'APPEND';
  let frames = 0;
  let malformed = 0;
  const notices = [];
  const trace = [];
  let retryRequested = false;
  const paths = new Set();
  const answerTypes = new Set(['RESPONSE', 'TEXT', 'ANSWER', 'TEMPLATE_RESPONSE']);

  function fail(message, code, reason) {
    const error = new Error(`DeepSeek: ${message}${code == null ? '' : ` (mã ${code})`}`);
    error.notReady = [401, 403].includes(Number(code));
    error.resetConversation = ['INVALID_SESSION_ID', 'SESSION_NOT_FOUND', 'PARENT_MESSAGE_NOT_FOUND', 'INVALID_PARENT_MESSAGE_ID'].includes(reason);
    error.refreshPow = ['INVALID_POW_RESPONSE', 'POW_HEADER_ERROR'].includes(reason);
    error.reason = reason || '';
    error.retryable = ['backend_err', 'generation_err'].includes(reason);
    throw error;
  }

  function checkError(value, forced = false, depth = 0) {
    if (!record(value)) {
      if (forced) fail(typeof value === 'string' ? value.slice(0, 500) : 'máy chủ trả về lỗi.');
      return;
    }
    for (const key of ['code', 'biz_code', 'error_code']) {
      const code = value[key];
      if (code != null && code !== '' && String(code) !== '0') {
        const detail = value.biz_msg || value.error_message || value.error_msg || value.message || value.msg || value.error?.message || 'máy chủ từ chối yêu cầu.';
        fail(String(detail).slice(0, 500), code);
      }
    }
    if (value.error || forced) {
      const detail = value.error?.message || value.error_message || value.error_msg || value.message || value.msg || value.biz_msg ||
        (typeof value.error === 'string' ? value.error : 'máy chủ trả về lỗi.');
      fail(String(detail).slice(0, 500), value.error?.code);
    }
    if (depth < 6) for (const key of ['data', 'biz_data', 'v', 'response'])
      if (record(value[key])) checkError(value[key], false, depth + 1);
  }

  function text(value) {
    if (typeof value === 'string') return value;
    if (record(value) && typeof value.content === 'string') return value.content;
    if (record(value) && typeof value.text === 'string') return value.text;
    return null;
  }

  function snapshot(value) {
    if (!record(value)) return;
    for (const key of ['content', 'status', 'quasi_status', 'thinking_content', 'reasoning_content'])
      if (typeof value[key] === 'string') response[key] = value[key];
    if (value.message_id != null) responseMessageId = value.message_id;
    if (Array.isArray(value.fragments)) response.fragments = value.fragments.filter(record).map(f => ({ ...f }));
    lastPath = response.fragments.length ? 'response/fragments/-1/content' : 'response/content';
  }

  function updateContent(target, key, value, operation) {
    const chunk = text(value);
    if (chunk === null) return;
    target[key] = operation === 'SET' || operation === 'REPLACE'
      ? chunk : (typeof target[key] === 'string' ? target[key] : '') + chunk;
  }

  function apply(patch, base = '') {
    if (!record(patch)) return;
    checkError(patch);
    const supplied = typeof patch.p === 'string' && patch.p !== '';
    let path = supplied ? patch.p.replace(/^\//, '') : '';
    if (path && base && path !== 'response' && !path.startsWith('response/')) path = `${base}/${path}`;
    const explicitOperation = typeof patch.o === 'string' ? patch.o.toUpperCase() : '';
    const operation = explicitOperation || lastOperation;
    // DeepSeek compresses both p and o. In particular, an appended TIP can
    // omit o; treating it as SET would discard the preceding answer entirely.
    if (explicitOperation && explicitOperation !== 'BATCH') lastOperation = explicitOperation;
    const value = patch.v;
    if (operation === 'BATCH' || (!path && Array.isArray(value) && value.every(item => record(item) && 'p' in item))) {
      if (Array.isArray(value)) for (const item of value) apply(item, path || base || 'response');
      return;
    }
    if (record(value) && record(value.response)) { snapshot(value.response); return; }
    if (path === 'response' && record(value)) { snapshot(value); return; }
    if (!path && record(patch.response)) { snapshot(patch.response); return; }
    if (!path) path = lastPath;
    else lastPath = path;
    paths.add(path);
    const relative = path.replace(/^response\//, '');
    if (relative === 'message_id') { if (value != null) responseMessageId = value; return; }
    if (relative === 'status' || relative === 'quasi_status') {
      if (typeof value === 'string') response[relative] = value;
      return;
    }
    if (relative === 'fragments' && Array.isArray(value)) {
      const fragments = value.filter(record).map(f => ({ ...f }));
      response.fragments = operation === 'APPEND' ? response.fragments.concat(fragments) : fragments;
      lastPath = 'response/fragments/-1/content';
      return;
    }
    const match = /^fragments\/(-?\d+)(?:\/(content|type|status))?$/.exec(relative);
    if (match) {
      const rawIndex = Number(match[1]);
      const index = rawIndex < 0 ? response.fragments.length + rawIndex : rawIndex;
      if (!Number.isSafeInteger(index) || index < 0 || index > 10000) return;
      // The protocol sometimes sends an indexed content delta before a list snapshot.
      if (!response.fragments[index]) response.fragments[index] = { type: 'RESPONSE', content: '' };
      if (!match[2] && record(value)) {
        response.fragments[index] = operation === 'SET' || operation === 'REPLACE'
          ? { ...value } : { ...response.fragments[index], ...value };
        lastPath = `response/fragments/${index}/content`;
      } else if (match[2] === 'content') updateContent(response.fragments[index], 'content', value, operation);
      else if (match[2] && typeof value === 'string') response.fragments[index][match[2]] = value;
      return;
    }
    if (['content', 'thinking_content', 'reasoning_content'].includes(relative))
      updateContent(response, relative, value, operation);
  }

  function consume(value, event = '') {
    frames++;
    // Only shapes go into empty-response diagnostics: no prompt, token,
    // cookie, account identifier or answer text is copied into the trace.
    if (trace.length < 8) {
      const keys = record(value) ? Object.keys(value).slice(0, 10).map(key => key.replace(/[^\w/-]/g, '').slice(0, 40)).join(',') : typeof value;
      const nestedKeys = record(value?.v) ? Object.keys(value.v).slice(0, 6).map(key => key.replace(/[^\w/-]/g, '').slice(0, 40)).join(',') : '';
      trace.push(`${String(event || 'message').replace(/[^\w-]/g, '').slice(0, 32)}{${keys}}${nestedKeys ? ` v{${nestedKeys}}` : ''}`);
    }
    checkError(value, event === 'error');
    if (!record(value)) return;
    if (value.response_message_id != null) responseMessageId = value.response_message_id;
    // These are first-class server events in the current DeepSeek web app.
    // They carry the real refusal/busy/verification message, not answer text.
    if (event === 'hint' || event === 'toast') {
      notices.push({ content: typeof value.content === 'string' ? value.content.slice(0, 800) : '',
        type: value.type, reason: typeof value.finish_reason === 'string' ? value.finish_reason.slice(0, 100) : '',
        clearResponse: value.clear_response === true });
      return;
    }
    if (event === 'close') retryRequested = value.click_behavior === 'retry';
    if (['ready', 'update_session', 'title', 'finish', 'close'].includes(event)) return;
    const body = value.data?.biz_data;
    if (record(body?.response)) snapshot(body.response);
    else apply(value);
  }

  const source = String(raw || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  if (/^\s*[{[]/.test(source)) {
    let value;
    try { value = JSON.parse(source); } catch (_) { fail('phản hồi JSON bị cắt hoặc không hợp lệ.'); }
    consume(value);
  } else {
    for (const block of source.split(/\n\n+/)) {
      let event = '';
      const data = [];
      for (const line of block.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
      }
      const payload = data.join('\n');
      if (!payload.trim() || payload.trim() === '[DONE]') continue;
      let value;
      try { value = JSON.parse(payload); } catch (_) { malformed++; continue; }
      consume(value, event);
    }
  }
  if (malformed) fail('luồng phản hồi bị cắt hoặc có dữ liệu JSON không hợp lệ. Chưa dùng câu trả lời dở dang.');
  const fatalNotice = notices.find(notice => notice.type === 'error' || notice.clearResponse || notice.reason);
  if (fatalNotice) fail(`${fatalNotice.content || 'máy chủ đã dừng yêu cầu.'}${fatalNotice.reason ? ` [${fatalNotice.reason}]` : ''}`, null, fatalNotice.reason);
  const fragments = response.fragments.filter(record);
  const templates = fragments.filter(f => f.type === 'TEMPLATE_RESPONSE').map(f => text(f) || '').join('');
  const statuses = [response.status, response.quasi_status];
  if (statuses.includes('CONTENT_FILTER')) {
    if (templates.trim()) return { text: templates, responseMessageId };
    fail('máy chủ đã chặn nội dung trả lời (CONTENT_FILTER).');
  }
  if (statuses.some(status => ['INCOMPLETE', 'AUTO_CONTINUE'].includes(status)))
    fail('máy chủ chưa hoàn tất câu trả lời. Chưa dùng nội dung dở dang.');
  const output = fragments.filter(f => answerTypes.has(String(f.type || '').toUpperCase()))
    .map(f => text(f) || '').join('');
  const answer = output.trim() ? output : typeof response.content === 'string' ? response.content : '';
  if (answer.trim()) return { text: answer, responseMessageId };
  if (notices.length) {
    const notice = notices.at(-1);
    fail(notice.content || 'máy chủ gửi thông báo nhưng chưa trả lời.');
  }
  const hasThinking = fragments.some(f => ['THINK', 'THINKING'].includes(f.type) && text(f)?.trim()) ||
    Boolean(response.thinking_content?.trim() || response.reasoning_content?.trim());
  if (hasThinking) fail('chỉ nhận được phần suy nghĩ, chưa có câu trả lời cuối cùng.');
  const shape = [...paths].slice(0, 6).join(', ') || 'không có trường nội dung';
  fail(`không nhận được nội dung trả lời (${frames} gói; ${shape}).${retryRequested ? ' Máy chủ yêu cầu thử lại.' : ''} Gói nhận: ${trace.join(' → ') || 'rỗng'}.`);
}

module.exports = { parseDeepSeekResponse };
