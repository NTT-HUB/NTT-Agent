'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const vm = require('node:vm');
const { WebSessions, PAGES, SESSION_PARTITION, pageStatus, navigationAllowed, latestUserMessage } = require('../lib/web-session.cjs');

function fixture() {
  const windows = [], partitions = new Map();
  class FakeWindow extends EventEmitter {
    constructor(options) {
      super(); this.options = options; this.dead = false; this.shown = 0;
      this.webContents = new EventEmitter();
      const contents = this.webContents;
      contents.url = '';
      contents.scripts = [];
      contents.getURL = () => contents.url;
      contents.isLoadingMainFrame = () => false;
      contents.setWindowOpenHandler = handler => { contents.openHandler = handler; };
      contents.executeJavaScript = async source => { contents.scripts.push(source); return { ready: true }; };
      windows.push(this);
    }
    loadURL(url) { this.webContents.url = url; return Promise.resolve(); }
    isDestroyed() { return this.dead; }
    show() { this.shown++; }
    focus() {}
    destroy() { this.dead = true; this.emit('closed'); }
  }
  const session = { fromPartition(name) {
    if (!partitions.has(name)) partitions.set(name, {
      clears: [], dataClears: [], caches: 0,
      setPermissionRequestHandler(handler) { this.permission = handler; },
      setPermissionCheckHandler(handler) { this.check = handler; },
      async clearStorageData(options) { this.clears.push(options); },
      async clearData(options) { this.dataClears.push(options); },
      async clearCache() { this.caches++; }
    });
    return partitions.get(name);
  } };
  return { sessions: new WebSessions({ BrowserWindow: FakeWindow, session }), windows, partitions, FakeWindow };
}

test('Hai cửa sổ dùng chung phiên Google hiện có của Gemini và cô lập khỏi Node/IPC', () => {
  const { sessions, windows, partitions } = fixture();
  assert.equal(sessions.open('gemini'), true);
  assert.equal(sessions.open('deepseek'), true);
  sessions.open('gemini');
  assert.equal(windows.length, 2);
  assert.equal(windows[0].shown, 1);
  for (const [index, provider] of ['gemini', 'deepseek'].entries()) {
    const prefs = windows[index].options.webPreferences;
    assert.equal(windows[index].webContents.url, PAGES[provider]);
    assert.equal(prefs.partition, 'persist:ntt-session-gemini');
    assert.equal(prefs.nodeIntegration, false);
    assert.equal(prefs.contextIsolation, true);
    assert.equal(prefs.sandbox, true);
    assert.equal(prefs.webSecurity, true);
    assert.equal(prefs.preload, undefined);
    let granted;
    partitions.get(prefs.partition).permission(null, 'filesystem', value => { granted = value; });
    assert.equal(granted, false);
  }
  assert.equal(partitions.size, 1);
  assert.throws(() => sessions.open('openai'), /không hợp lệ/);
  assert.throws(() => sessions.open('other'), /không hợp lệ/);
});

test('Chỉ thực thi Session đúng origin; không chạy script trên trang đăng nhập hoặc khi redirect', async () => {
  const { sessions, windows } = fixture();
  sessions.open('gemini');
  const contents = windows[0].webContents;
  await sessions.evaluateSource('gemini', '42');
  assert.equal(contents.scripts.length, 1);
  contents.url = 'https://accounts.google.com/login';
  await assert.rejects(sessions.evaluateSource('gemini', '42'), /bước đăng nhập/);
  assert.equal(contents.scripts.length, 1);
  contents.url = PAGES.gemini;
  contents.executeJavaScript = async source => vm.runInNewContext(source,
    { location: { origin: 'https://accounts.google.com' } });
  await assert.rejects(sessions.evaluateSource('gemini', '42'), /chuyển sang đăng nhập/);
});

test('Popup dùng chung phiên; đặt lại Gemini giữ cookie Google và cửa sổ DeepSeek', async () => {
  const { sessions, windows, partitions, FakeWindow } = fixture();
  sessions.open('gemini'); sessions.open('deepseek');
  const contents = windows[0].webContents;
  const allowed = contents.openHandler({ url: 'https://accounts.google.com/signin' });
  assert.equal(allowed.action, 'allow');
  assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.partition, 'persist:ntt-session-gemini');
  assert.equal(contents.openHandler({ url: 'file:///C:/secret' }).action, 'deny');
  assert.equal(contents.openHandler({ url: 'https://gemini.google.com.evil.example/' }).action, 'deny');
  const popup = new FakeWindow(allowed.overrideBrowserWindowOptions);
  contents.emit('did-create-window', popup);
  await sessions.clear('gemini');
  assert.equal(popup.isDestroyed(), true);
  assert.equal(windows[0].isDestroyed(), true);
  assert.equal(windows[1].isDestroyed(), false);
  const shared = partitions.get(SESSION_PARTITION);
  assert.deepEqual(shared.clears, [{ origin: 'https://gemini.google.com',
    storages: ['filesystem', 'indexdb', 'localstorage', 'serviceworkers', 'cachestorage'] }]);
  assert.deepEqual(shared.dataClears, []);
  assert.equal(shared.caches, 0);
  for (const url of ['javascript:alert(1)', 'http://gemini.google.com/', 'https://evil.example/'])
    assert.equal(navigationAllowed('gemini', url), false);
});

test('Đặt lại DeepSeek chỉ xóa dữ liệu DeepSeek, không xóa cookie Google hay dữ liệu Gemini', async () => {
  const { sessions, windows, partitions, FakeWindow } = fixture();
  sessions.open('gemini'); sessions.open('deepseek');
  const contents = windows[1].webContents;
  const allowed = contents.openHandler({ url: 'https://accounts.google.com/signin' });
  assert.equal(allowed.overrideBrowserWindowOptions.webPreferences.partition, SESSION_PARTITION);
  const popup = new FakeWindow(allowed.overrideBrowserWindowOptions);
  contents.emit('did-create-window', popup);
  await sessions.clear('deepseek');
  assert.equal(windows[0].isDestroyed(), false);
  assert.equal(windows[1].isDestroyed(), true);
  assert.equal(popup.isDestroyed(), true);
  const shared = partitions.get(SESSION_PARTITION);
  assert.equal(shared.clears.length, 1);
  assert.equal(shared.clears[0].origin, 'https://chat.deepseek.com');
  assert.equal(shared.clears[0].storages.includes('cookies'), false);
  assert.deepEqual(shared.dataClears, [{ dataTypes: ['cookies'], origins: ['https://chat.deepseek.com'] }]);
  assert.equal(shared.caches, 0);
});

test('Trang xác minh chưa sẵn sàng; DeepSeek dùng token như mobile dù không có ô nhập web', () => {
  const old = { document: global.document, location: global.location, localStorage: global.localStorage };
  global.document = { title: 'Just a moment...', body: { innerText: 'Verifying you are human' },
    querySelector: () => null, querySelectorAll: () => [] };
  global.location = { href: PAGES.deepseek };
  let token = '';
  global.localStorage = { getItem: () => token };
  try {
    assert.match(pageStatus('deepseek').error, /Cloudflare/);
    global.document.title = 'DeepSeek'; global.document.body.innerText = '';
    assert.equal(pageStatus('deepseek').ready, false);
    token = 'fake';
    assert.equal(pageStatus('deepseek').ready, true);
    token = '{"value":"wrapped-token"}';
    assert.equal(pageStatus('deepseek').ready, true);
    token = '{"value":""}';
    assert.equal(pageStatus('deepseek').ready, false);
    token = '""';
    assert.equal(pageStatus('deepseek').ready, false);
  } finally { Object.assign(global, old); }
});

test('Chờ DeepSeek sẵn sàng bằng token, dùng lại cùng cửa sổ và dừng đúng giới hạn', async () => {
  const { sessions, windows } = fixture();
  sessions.open('deepseek');
  let calls = 0;
  sessions.status = async () => ({ ready: ++calls === 3 });
  assert.equal((await sessions.waitUntilReady('deepseek', { attempts: 3, delayMs: 0 })).ready, true);
  assert.equal(calls, 3);
  assert.equal(windows.length, 1);
  calls = 0;
  sessions.status = async () => { calls++; return { ready: false, error: 'login required' }; };
  assert.deepEqual(await sessions.waitUntilReady('deepseek', { attempts: 2, delayMs: 0 }),
    { ready: false, error: 'login required' });
  assert.equal(calls, 3);
});

test('Nút dừng hủy được bước chờ Session khởi tạo', async () => {
  const { sessions } = fixture();
  let calls = 0;
  sessions.status = async () => { calls++; return { ready: false }; };
  const controller = new AbortController();
  const pending = sessions.waitUntilReady('deepseek', { signal: controller.signal, delayMs: 1000 });
  controller.abort();
  await assert.rejects(pending, /Đã dừng/);
  assert.equal(calls, 1);
});

test('Session chuyển model và cờ DeepSeek vào private client; dọn chat chỉ reset hội thoại', async () => {
  const { sessions, windows } = fixture();
  let params, prompt;
  const cleared = [];
  sessions.private = {
    complete: async (_provider, input, options) => { prompt = input; params = options; return 'OK'; },
    clear: provider => cleared.push(provider)
  };
  const messages = [{ role: 'system', content: 'Quy tắc' }, { role: 'user', content: 'Câu hỏi' }];
  assert.equal(await sessions.complete('deepseek', messages, { ask: true, thinkingEnabled: true, searchEnabled: true }), 'OK');
  assert.equal(prompt, 'Câu hỏi');
  assert.equal(params.thinkingEnabled, true); assert.equal(params.searchEnabled, true);
  assert.match(latestUserMessage(messages, true), /Quy tắc/);
  sessions.resetConversations();
  assert.deepEqual(cleared, ['gemini', 'deepseek']);
  assert.equal(windows[0].isDestroyed(), false);
  sessions.close();
  assert.equal(windows[0].isDestroyed(), true);
  assert.throws(() => sessions.open('gemini'), /đã đóng/);
});
