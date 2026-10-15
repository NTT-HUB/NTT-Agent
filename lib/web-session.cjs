'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { setTimeout: delay } = require('node:timers/promises');
const { PAGES } = require('./provider-pages.cjs');
const { PrivateSessionBridge } = require('./private-session.cjs');

// Reuse the existing Gemini profile so upgrading retains its Google sign-in.
// Both provider windows and their OAuth popups must use this same profile.
const SESSION_PARTITION = 'persist:ntt-session-gemini';

function latestUserMessage(messages, first, ask = false) {
  if (ask) return messages.at(-1)?.content || '';
  if (first) return messages.map(m => `${m.role.toUpperCase()}:\n${m.content}`).join('\n\n');
  return messages.at(-1)?.content || '';
}

function pageStatus(provider) {
  const text = `${document.title || ''} ${document.body?.innerText?.slice(0, 1500) || ''}`;
  if (/just a moment|verifying you are human|checking your browser|verify you are human|xác minh bạn là người/i.test(text) ||
      document.querySelector('#challenge-running, #challenge-form, .cf-challenge'))
    return { ready: false, error: 'Trang đang xác minh Cloudflare. Hoàn tất trong cửa sổ web của app rồi thử lại.', url: location.href };
  if (provider === 'deepseek') {
    // Like mobile waitUntilReady: an authenticated private API runtime needs
    // its token, not a mounted/visible website composer.
    let token = localStorage.getItem('userToken') || '';
    try {
      const parsed = JSON.parse(token);
      if (parsed && typeof parsed === 'object' && typeof parsed.value === 'string') token = parsed.value;
      else if (typeof parsed === 'string') token = parsed;
    } catch (_) {}
    return { ready: Boolean(token), url: location.href };
  }
  const selectors = ['rich-textarea [contenteditable="true"]', '[contenteditable="true"][role="textbox"]', 'textarea'];
  const input = selectors.some(s => [...document.querySelectorAll(s)].some(el => el.getClientRects().length));
  return { ready: input, url: location.href };
}

function navigationAllowed(provider, value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    if (['accounts.google.com', 'accounts.youtube.com', 'consent.google.com', 'myaccount.google.com'].includes(url.hostname)) return true;
    if (provider === 'gemini') return ['gemini.google.com', 'www.google.com'].includes(url.hostname);
    return provider === 'deepseek' && (url.hostname === 'deepseek.com' || url.hostname.endsWith('.deepseek.com'));
  } catch { return false; }
}

class WebSessions {
  constructor({ BrowserWindow, session, userData }) {
    this.BrowserWindow = BrowserWindow;
    this.session = session;
    this.windows = new Map();
    this.popups = new Map();
    this.busy = new Set();
    this.lastErrors = new Map();
    this.closed = false;
    if (userData) {
      // Embedded sessions have separate accounts from the retired external browser.
      const directory = path.join(userData, 'web-ai-lineage');
      fs.mkdirSync(directory, { recursive: true });
      this.private = new PrivateSessionBridge(directory, (provider, source) => this.evaluateSource(provider, source));
    }
  }

  assertProvider(provider) {
    if (!Object.hasOwn(PAGES, provider)) throw new Error('Session provider không hợp lệ.');
  }

  preferences(provider) {
    this.assertProvider(provider);
    return { partition: SESSION_PARTITION, nodeIntegration: false,
      contextIsolation: true, sandbox: true, webSecurity: true,
      allowRunningInsecureContent: false, backgroundThrottling: false };
  }

  secureContents(provider, contents) {
    const prevent = (event, url) => { if (!navigationAllowed(provider, url)) event.preventDefault(); };
    contents.on('will-navigate', prevent);
    contents.on('will-redirect', prevent);
    contents.on('will-attach-webview', event => event.preventDefault());
    contents.setWindowOpenHandler(({ url }) => navigationAllowed(provider, url)
      ? { action: 'allow', overrideBrowserWindowOptions: { webPreferences: this.preferences(provider) } }
      : { action: 'deny' });
    contents.on('did-create-window', child => {
      if (!this.popups.has(provider)) this.popups.set(provider, new Set());
      this.popups.get(provider).add(child);
      this.secureContents(provider, child.webContents);
      child.on('closed', () => this.popups.get(provider)?.delete(child));
    });
  }

  getWindow(provider, show = false) {
    this.assertProvider(provider);
    if (this.closed) throw new Error('Session đã đóng. Mở lại app để tiếp tục.');
    let window = this.windows.get(provider);
    if (window && !window.isDestroyed()) {
      if (show) { if (window.isMinimized?.()) window.restore(); window.show(); window.focus(); }
      return window;
    }
    const preferences = this.preferences(provider);
    const ses = this.session.fromPartition(preferences.partition);
    ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    ses.setPermissionCheckHandler?.(() => false);
    window = new this.BrowserWindow({ width: 1060, height: 850, show,
      title: `${provider === 'gemini' ? 'Gemini' : 'DeepSeek'} · Session`, webPreferences: preferences });
    this.secureContents(provider, window.webContents);
    window.webContents.on('did-finish-load', () => this.lastErrors.delete(provider));
    window.on('closed', () => {
      if (this.windows.get(provider) === window) this.windows.delete(provider);
      this.closePopups(provider);
    });
    this.windows.set(provider, window);
    window.loadURL(PAGES[provider]).catch(error => {
      if (!window.isDestroyed() && error.code !== 'ERR_ABORTED') this.lastErrors.set(provider, error.message);
    });
    return window;
  }

  open(provider) { this.getWindow(provider, true); return true; }

  closePopups(provider) {
    for (const child of this.popups.get(provider) || []) if (!child.isDestroyed()) child.destroy();
    this.popups.delete(provider);
  }

  async clear(provider) {
    this.assertProvider(provider);
    const window = this.windows.get(provider);
    this.closePopups(provider);
    if (window && !window.isDestroyed()) window.destroy();
    this.windows.delete(provider);
    const ses = this.session.fromPartition(SESSION_PARTITION);
    // Never clear the entire shared profile or Google cookies here. Cookie
    // clearing for a google.com origin also affects the Google sign-in used
    // by the other provider. Reset only this site's non-cookie storage.
    await ses.clearStorageData({ origin: new URL(PAGES[provider]).origin,
      storages: ['filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] });
    if (provider === 'deepseek') {
      // Electron scopes this cookie reset to the registrable deepseek.com domain.
      await ses.clearData({ dataTypes: ['cookies'], origins: [new URL(PAGES.deepseek).origin] });
    }
    this.private?.clear(provider);
    this.lastErrors.delete(provider);
    return true;
  }

  resetConversations() {
    for (const provider of Object.keys(PAGES)) this.private?.clear(provider);
  }

  async evaluateSource(provider, source) {
    const window = this.getWindow(provider);
    const contents = window.webContents;
    if (contents.isLoadingMainFrame()) {
      await new Promise(resolve => {
        const finish = () => { clearTimeout(timer); contents.removeListener('did-finish-load', finish); resolve(); };
        const timer = setTimeout(finish, 20000);
        contents.once('did-finish-load', finish);
      });
    }
    if (window.isDestroyed()) throw new Error('Cửa sổ Session đã đóng. Mở lại trong Kết nối.');
    const expected = new URL(PAGES[provider]).origin;
    let origin;
    try { origin = new URL(contents.getURL()).origin; } catch { origin = ''; }
    if (origin !== expected) throw new Error('Trang đang ở bước đăng nhập. Hoàn tất trong cửa sổ web của app rồi thử lại.');
    // Check origin again inside the page to cover a redirect between URL check and execution.
    return contents.executeJavaScript(`(() => { if (location.origin !== ${JSON.stringify(expected)}) throw new Error('Trang đang chuyển sang đăng nhập.'); return (${source}); })()`, true);
  }

  async status(provider) {
    try {
      this.assertProvider(provider);
      if (this.lastErrors.has(provider)) return { ready: false, error: this.lastErrors.get(provider) };
      return await this.evaluateSource(provider, `(${pageStatus.toString()})(${JSON.stringify(provider)})`);
    } catch (error) { return { ready: false, error: error.message }; }
  }

  async waitUntilReady(provider, { signal, attempts = 30, delayMs = 500 } = {}) {
    for (let attempt = 0; ; attempt++) {
      if (signal?.aborted) throw new Error('Đã dừng.');
      const status = await this.status(provider);
      if (status.ready || attempt >= attempts) return status;
      try { await delay(delayMs, undefined, { signal }); }
      catch (error) { if (signal?.aborted) throw new Error('Đã dừng.'); throw error; }
    }
  }

  async complete(provider, messages, { signal, first = true, ask = false, model, thinkingEnabled, searchEnabled } = {}) {
    this.assertProvider(provider);
    if (this.busy.has(provider)) throw new Error('Session này đang xử lý yêu cầu khác.');
    if (signal?.aborted) throw new Error('Đã dừng.');
    this.busy.add(provider);
    try {
      const status = provider === 'deepseek'
        ? await this.waitUntilReady(provider, { signal }) : await this.status(provider);
      if (!status.ready) throw new Error(`Session chưa sẵn sàng: ${status.error || 'mở Kết nối, đăng nhập trong app và bấm Kiểm tra.'}`);
      const input = latestUserMessage(messages, first, ask);
      if (!input.trim() || input.length > 100000) throw new Error('Nội dung Session quá dài hoặc trống.');
      if (!this.private) throw new Error('Session chưa được khởi tạo.');
      return await this.private.complete(provider, input, { signal, model, thinkingEnabled, searchEnabled });
    } finally { this.busy.delete(provider); }
  }

  close() {
    this.closed = true;
    for (const provider of Object.keys(PAGES)) {
      this.closePopups(provider);
      const window = this.windows.get(provider);
      if (window && !window.isDestroyed()) window.destroy();
    }
    this.windows.clear();
  }
}
module.exports = { WebSessions, PAGES, SESSION_PARTITION, pageStatus, navigationAllowed, latestUserMessage };
