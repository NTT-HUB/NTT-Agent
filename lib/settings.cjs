'use strict';

const fs = require('node:fs');
const path = require('node:path');

class Settings {
  constructor(userData, safeStorage) {
    this.file = path.join(userData, 'settings.json');
    this.safeStorage = safeStorage;
    try { this.data = JSON.parse(fs.readFileSync(this.file, 'utf8')); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.data = { models: {}, encryptedKeys: {}, chats: {} };
    }
    this.data.models ||= {};
    this.data.encryptedKeys ||= {};
    this.data.chats ||= {};
    this.data.endpoints ||= {};
    let migrated = false;
    for (const provider of ['claude', 'openai']) {
      for (const values of [this.data.encryptedKeys, this.data.models, this.data.endpoints]) {
        if (Object.hasOwn(values, provider)) { delete values[provider]; migrated = true; }
      }
    }
    if (migrated) this.save();
  }

  save() {
    const temp = `${this.file}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(this.data, null, 2), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }

  setKey(provider, value) {
    if (!this.safeStorage.isEncryptionAvailable()) {
      throw new Error('Windows chưa sẵn sàng mã hóa khóa. Hãy mở lại app.');
    }
    if (!value) delete this.data.encryptedKeys[provider];
    else this.data.encryptedKeys[provider] = this.safeStorage.encryptString(value).toString('base64');
    this.save();
  }

  key(provider) {
    const encrypted = this.data.encryptedKeys[provider];
    if (!encrypted) return '';
    return this.safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
  }

  keyStatus() {
    return Object.fromEntries(['gemini', 'deepseek', 'other'].map(p => [p, Boolean(this.data.encryptedKeys[p])]));
  }

  endpoint(provider) { return this.data.endpoints[provider] || ''; }
  setEndpoint(provider, url) {
    // Validate here too, so malformed settings cannot later become an arbitrary fetch URL.
    const { messagesEndpoint } = require('./providers.cjs');
    messagesEndpoint(url);
    this.data.endpoints[provider] = url.trim();
    this.save();
  }

  model(provider, fallback) { return this.data.models[provider] || fallback; }
  setModel(provider, model) {
    if (typeof model !== 'string' || model.trim().length > 100) throw new Error('Tên model không hợp lệ.');
    this.data.models[provider] = model.trim();
    this.save();
  }

  chat(id) { return Array.isArray(this.data.chats[id]) ? this.data.chats[id] : []; }
  setChat(id, messages) {
    if (!Array.isArray(messages)) throw new Error('Lịch sử không hợp lệ.');
    this.data.chats[id] = messages.slice(-80).map(m => {
      const result = { role: m.role === 'assistant' ? 'assistant' : 'user',
        text: String(m.text || '').slice(0, 30000) };
      if (result.role === 'assistant' && Array.isArray(m.options) &&
          m.options.length >= 2 && m.options.length <= 3 &&
          m.options.every(x => typeof x === 'string' && x.trim() && x.length <= 100))
        result.options = m.options.map(x => x.trim());
      return result;
    });
    this.save();
  }
}

module.exports = { Settings };
