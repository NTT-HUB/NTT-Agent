'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { parseDeepSeekResponse } = require('./deepseek-response.cjs');

const POLL_MS = 250;
const TIMEOUT_MS = 300000;
const POW_WORKER_URL = 'https://fe-static.deepseek.com/chat/static/76608.8f2a9fa413.js';

const GEMINI_ROUTES = Object.freeze({
  // Gemini Web 4 Argon uses mode 8 and this model ID; paid account access is checked by Gemini.
  '4 Argon': { modelMode: 8, thinkDepth: 4, modelHeader: '[1,null,null,null,"95a4c0abcba24364",null,null,0,[4,5,6,8],null,null,2,null,null,8,1,"09D681E7-26F2-4A94-A465-38386B7AB93B"]' },
  '3.6 Flash': { modelMode: 1, thinkDepth: 4, modelHeader: '[1,null,null,null,"fbb127bbb056c959",null,null,0,[4,5,6,8],null,null,1,null,null,1,1,"0827BFC9-35C9-4CF1-A987-87F0B2BF0C6E"]' },
  '3.1 Pro': { modelMode: 3, thinkDepth: 4, modelHeader: '[1,null,null,null,"e6fa609c3fa255c0",null,null,0,[4,5,6,8],null,null,2,null,null,3,1,"09D681E7-26F2-4A94-A465-38386B7AB93B"]' },
  'Tư duy mở rộng': { modelMode: 2, thinkDepth: 0, modelHeader: null },
  '3.5 Flash-Lite': { modelMode: 6, thinkDepth: 4, modelHeader: '[1,null,null,null,"cf41b0e0dd7d53e5",null,null,0,[4,5,6,8],null,null,1,null,null,6,1,"0827BFC9-35C9-4CF1-A987-87F0B2BF0C6E"]' }
});

const scripts = Object.fromEntries(['gemini', 'deepseek'].map(provider => [provider,
  fs.readFileSync(path.join(__dirname, 'session-scripts', `${provider}.js`), 'utf8')]));

class PrivateSessionBridge {
  constructor(userData, evaluateSource) {
    this.file = path.join(userData, 'session-lineage.json');
    this.evaluateSource = evaluateSource;
    try { this.lineage = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; this.lineage = {}; }
    let migrated = false;
    for (const provider of ['claude', 'openai']) if (Object.hasOwn(this.lineage, provider)) {
      delete this.lineage[provider]; migrated = true;
    }
    if (migrated) this.save();
  }

  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.lineage, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  clear(provider) {
    delete this.lineage[provider];
    this.save();
  }

  async complete(provider, prompt, { model, thinkingEnabled = false, searchEnabled = false, signal } = {}) {
    if (!scripts[provider]) throw new Error('Private Session chưa hỗ trợ nhà cung cấp này.');
    if (signal?.aborted) throw new Error('Đã dừng.');
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 100000) {
      throw new Error('Prompt Session trống hoặc quá dài.');
    }
    const key = `__ntt_desktop_${provider}_${randomUUID().replaceAll('-', '')}`;
    const old = this.lineage[provider] || {};
    let params;
    if (provider === 'gemini') {
      const selected = Object.hasOwn(GEMINI_ROUTES, model) ? model : '3.6 Flash';
      const route = GEMINI_ROUTES[selected];
      const ids = old.model === selected ? old : {};
      params = { resultKey: key, prompt, conversationId: ids.conversationId || null,
        responseId: ids.responseId || null, choiceId: ids.choiceId || null, ...route };
    } else {
      // The mobile client keeps the same lineage when its two switches change.
      const parent = old.parentMessageId;
      params = { resultKey: key, prompt, sessionId: old.sessionId || null,
        parentMessageId: parent == null ? null : /^\d+$/.test(String(parent)) ? Number(parent) : parent,
        thinkingEnabled: thinkingEnabled === true, searchEnabled: searchEnabled === true,
        powWorkerUrl: POW_WORKER_URL };
    }
    const parser = provider === 'deepseek' ? `const parseDeepSeekResponse = ${parseDeepSeekResponse.toString()};\n` : '';
    const code = `(() => {\n${parser}${scripts[provider]}\nreturn startPrivateSession(${JSON.stringify(params)});\n})()`;
    // Script starts a fetch on the logged-in provider origin; no cookie/token is returned to Node.
    const started = await this.evaluateSource(provider, code);
    if (started !== 'started') throw new Error(`${provider} Session không khởi động được: ${String(started)}`);
    const startedAt = Date.now();
    let completed = false;
    try {
      while (Date.now() - startedAt < TIMEOUT_MS) {
        if (signal?.aborted) throw new Error('Đã dừng.');
        await new Promise(resolve => setTimeout(resolve, POLL_MS));
        const result = await this.evaluateSource(provider, `window[${JSON.stringify(key)}] || null`);
        if (!result?.done) continue;
        if (result.status !== 'ok') {
          if (result.status === 'not_ready') this.clear(provider);
          const error = new Error(`${provider} Session: ${result.message || result.status}`);
          error.code = result.reason || '';
          error.retryable = provider === 'deepseek' && result.retryable === true &&
            ['backend_err', 'generation_err'].includes(result.reason);
          throw error;
        }
        if (provider === 'gemini') {
          this.lineage.gemini = { model: Object.hasOwn(GEMINI_ROUTES, model) ? model : '3.6 Flash',
            conversationId: result.conversationId, responseId: result.responseId, choiceId: result.choiceId };
        } else {
          this.lineage.deepseek = { sessionId: result.sessionId, parentMessageId: result.parentMessageId,
            thinkingEnabled: params.thinkingEnabled, searchEnabled: params.searchEnabled };
        }
        this.save();
        completed = true;
        return result.text;
      }
      throw new Error(`${provider} Session quá 5 phút không trả lời.`);
    } finally {
      if (!completed) {
        try {
          await this.evaluateSource(provider, `window[${JSON.stringify(key + '_abort')}]?.()`);
        } catch (_) {}
      }
      try {
        await this.evaluateSource(provider, `delete window[${JSON.stringify(key)}]`);
        await this.evaluateSource(provider, `delete window[${JSON.stringify(key + '_abort')}]`);
      } catch (_) {}
    }
  }
}

module.exports = { PrivateSessionBridge, GEMINI_ROUTES };
