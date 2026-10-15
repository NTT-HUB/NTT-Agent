'use strict';

const PROVIDERS = {
  gemini: { label: 'Gemini API', defaultModel: 'gemini-3.8-flash' },
  deepseek: { label: 'DeepSeek API', defaultModel: 'deepseek-flash' },
  other: { label: 'Other', defaultModel: '' }
};

function messagesEndpoint(baseUrl) {
  if (typeof baseUrl !== 'string' || !baseUrl.trim() || baseUrl.length > 2048) {
    throw new Error('Hãy nhập Base URL của endpoint Anthropic Messages.');
  }
  let url;
  try { url = new URL(baseUrl.trim()); } catch { throw new Error('Base URL không hợp lệ.'); }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) ||
      url.username || url.password || url.search || url.hash) {
    throw new Error('Base URL phải là HTTPS (HTTP chỉ cho localhost), không kèm tài khoản hoặc tham số.');
  }
  const path = url.pathname.replace(/\/+$/, '');
  url.pathname = path.endsWith('/v1/messages') ? path :
    path.endsWith('/v1') ? `${path}/messages` : `${path}/v1/messages`;
  return url.toString();
}

async function postJson(url, headers, body, signal, timeoutMs = 120000) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal;
  try {
    const response = await fetch(url, {
      method: 'POST', headers, body: JSON.stringify(body), signal: combined
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); } catch { data = { error: { message: raw.slice(0, 500) } }; }
    if (!response.ok) {
      const message = data.error?.message || data.message || raw.slice(0, 500);
      throw new Error(`${response.status}: ${message}`);
    }
    return data;
  } finally { clearTimeout(timer); }
}

async function complete({ provider, model, messages, key, signal, baseUrl }) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Nhà cung cấp không được hỗ trợ.');
  if (!model || typeof model !== 'string') throw new Error('Hãy chọn model.');

  if (provider === 'other') {
    const url = messagesEndpoint(baseUrl);
    if (!key && !new URL(url).hostname.match(/^(localhost|127\.0\.0\.1|\[::1\])$/)) {
      throw new Error(`Hãy nhập API key cho ${PROVIDERS[provider].label}.`);
    }
    const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const body = { model, max_tokens: 4096,
      messages: messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content
      })) };
    if (system) body.system = system;
    const headers = { 'content-type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (key) headers['x-api-key'] = key;
    const data = await postJson(url, headers, body, signal);
    const text = (data.content || []).filter(p => p.type === 'text').map(p => p.text || '').join('');
    if (!text.trim()) throw new Error('Endpoint không trả về văn bản theo định dạng Anthropic Messages.');
    return text;
  }
  if (!key) throw new Error(`Chưa kết nối ${PROVIDERS[provider].label}. Mở mục Kết nối để nhập API key.`);

  if (provider === 'gemini') {
    if (model === 'gemini-4-argon') {
      const input = messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
      const data = await postJson('https://generativelanguage.googleapis.com/v1beta/interactions',
        { 'content-type': 'application/json', 'x-goog-api-key': key },
        { model, input }, signal, 300000);
      const text = (data.steps || []).filter(step => step.type === 'model_output')
        .flatMap(step => step.content || []).filter(part => part.type === 'text')
        .map(part => part.text || '').join('');
      if (!text.trim()) throw new Error('Gemini Argon không trả về văn bản trong Interactions API.');
      return text;
    }
    const systemText = messages.filter(m => m.role === 'system').map(m => m.content).join('\n');
    const contents = messages.filter(m => m.role !== 'system').map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));
    const body = { contents };
    if (systemText) body.systemInstruction = { parts: [{ text: systemText }] };
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const data = await postJson(url, { 'content-type': 'application/json', 'x-goog-api-key': key }, body, signal);
    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || '').join('');
    if (!text.trim()) throw new Error('Gemini không trả về văn bản.');
    return text;
  }

  const url = 'https://api.deepseek.com/chat/completions';
  const data = await postJson(url, {
    'content-type': 'application/json',
    authorization: `Bearer ${key}`
  }, { model, messages, stream: false }, signal);
  const content = data.choices?.[0]?.message?.content;
  const text = Array.isArray(content) ? content.map(p => p.text || '').join('') : content;
  if (typeof text !== 'string' || !text.trim()) throw new Error('Model không trả về văn bản.');
  return text;
}

module.exports = { PROVIDERS, complete, messagesEndpoint };
