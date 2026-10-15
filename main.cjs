'use strict';

const path = require('node:path');
const { app, BrowserWindow, ipcMain, dialog, safeStorage, shell, session } = require('electron');
const { TerritoryManager } = require('./lib/territory.cjs');
const { Settings } = require('./lib/settings.cjs');
const { PROVIDERS } = require('./lib/providers.cjs');
const { runAgent } = require('./lib/agent.cjs');
const { retrySessionFetch } = require('./lib/session-retry.cjs');
const { WebSessions } = require('./lib/web-session.cjs');
const { configureSessionStorage } = require('./lib/session-storage.cjs');
const { retireBrowserLink } = require('./lib/legacy-cleanup.cjs');

let window, territories, settings, webSessions;
let agentJob = null, terminalJob = null;
const primaryInstance = app.requestSingleInstanceLock();
let sessionStorageReady = false;
if (!primaryInstance) app.quit();
else {
  try { configureSessionStorage(app); sessionStorageReady = true; }
  catch (error) {
    dialog.showErrorBox('NTT Agent Desktop', `Không tạo được thư mục cache Session: ${error.message}`);
    app.quit();
  }
  app.on('second-instance', () => {
    if (window && !window.isDestroyed()) {
      if (window.isMinimized()) window.restore();
      window.show(); window.focus();
    }
  });
}

function assertWindow(event) {
  if (!window || event.sender !== window.webContents) throw new Error('Nguồn yêu cầu không hợp lệ.');
}

function validateProvider(provider) {
  if (!Object.hasOwn(PROVIDERS, provider)) throw new Error('Nhà cung cấp không hợp lệ.');
}

function send(channel, value) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}

function register(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertWindow(event);
    return handler(...args);
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1480, height: 900, minWidth: 1060, minHeight: 680,
    backgroundColor: '#080f19',
    title: 'NTT Agent Desktop',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true
    }
  });
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, target) => {
    if (target !== window.webContents.getURL()) event.preventDefault();
  });
  window.on('closed', () => {
    agentJob?.abort(); terminalJob?.abort(); webSessions?.close(); window = null;
  });
}

app.whenReady().then(async () => {
  if (!primaryInstance || !sessionStorageReady) return;
  territories = new TerritoryManager(app.getPath('userData'));
  settings = new Settings(app.getPath('userData'), safeStorage);
  await retireBrowserLink(app.getPath('userData'));
  webSessions = new WebSessions({ BrowserWindow, session, userData: app.getPath('userData') });

  register('bootstrap', () => ({
    version: app.getVersion(),
    runtime: territories.runtimeInfo(),
    territories: territories.list(),
    providers: PROVIDERS,
    keyStatus: settings.keyStatus(),
    models: settings.data.models,
    endpoints: { other: settings.endpoint('other') }
  }));
  register('attach-territory', async () => {
    if (agentJob || terminalJob) throw new Error('Hãy đợi tác vụ hiện tại hoàn tất.');
    const result = await dialog.showOpenDialog(window, {
      title: 'Chọn thư mục dự án cho AI', properties: ['openDirectory', 'createDirectory']
    });
    if (result.canceled) return null;
    return territories.attach(result.filePaths[0]);
  });
  register('usage', id => territories.usage(id));
  register('list-files', (id, relative) => territories.listFiles(id, relative));
  register('read-file', (id, relative) => territories.readFile(id, relative));
  register('write-file', (id, relative, content) => territories.writeFile(id, relative, content));
  register('save-key', (provider, key) => {
    validateProvider(provider);
    if (typeof key !== 'string' || key.length > 1000) throw new Error('Khóa không hợp lệ.');
    settings.setKey(provider, key.trim());
    return settings.keyStatus();
  });
  register('save-model', (provider, model) => {
    validateProvider(provider);
    settings.setModel(provider, model);
    return settings.model(provider, PROVIDERS[provider].defaultModel);
  });
  register('save-endpoint', (provider, url) => {
    if (provider !== 'other') throw new Error('Endpoint tùy chỉnh không hợp lệ.');
    settings.setEndpoint(provider, url);
    return settings.endpoint(provider);
  });
  register('get-chat', id => settings.chat(id || 'general'));
  register('save-chat', (id, messages) => {
    settings.setChat(id || 'general', messages);
    return true;
  });
  register('clear-chat', id => {
    if (agentJob || terminalJob) throw new Error('Hãy đợi tác vụ hiện tại hoàn tất trước khi dọn chat.');
    if (id) territories.get(id);
    settings.setChat(id || 'general', []);
    webSessions.resetConversations();
    return true;
  });
  register('open-connection-page', async provider => {
    validateProvider(provider);
    const urls = {
      gemini: 'https://aistudio.google.com/api-keys',
      deepseek: 'https://platform.deepseek.com/api_keys'
    };
    if (!urls[provider]) throw new Error('Nhập Base URL do nhà cung cấp của bạn đưa ra.');
    await shell.openExternal(urls[provider]);
  });
  register('open-web-session', provider => { validateProvider(provider); return webSessions.open(provider); });
  register('web-session-status', provider => { validateProvider(provider); return webSessions.status(provider); });
  register('clear-web-session', provider => {
    validateProvider(provider);
    if (agentJob) throw new Error('Hãy dừng yêu cầu AI trước khi xóa Session.');
    return webSessions.clear(provider);
  });
  register('run-command', async (id, command) => {
    if (agentJob || terminalJob) throw new Error('Đang có một tác vụ chạy. Hãy dừng hoặc đợi hoàn tất.');
    const controller = new AbortController();
    terminalJob = controller;
    try {
      const result = await territories.execute(id, command, {
        signal: controller.signal,
        timeoutMs: 0,
        onChunk: chunk => send('terminal-event', { type: 'chunk', ...chunk })
      });
      send('terminal-event', { type: 'done', result });
      return result;
    } finally { terminalJob = null; }
  });
  register('stop-command', () => { terminalJob?.abort(); return true; });
  register('agent-send', async data => {
    if (agentJob || terminalJob) throw new Error('Đang có một tác vụ chạy. Hãy dừng hoặc đợi hoàn tất.');
    validateProvider(data.provider);
    if (!['api', 'session'].includes(data.connectionMode)) throw new Error('Kiểu kết nối không hợp lệ.');
    if (data.provider === 'other' && data.connectionMode === 'session')
      throw new Error('Nhà cung cấp này hiện hỗ trợ kết nối bằng API key.');
    if (data.mode === 'agent') territories.get(data.territoryId);
    const controller = new AbortController();
    agentJob = controller;
    try {
      let firstSessionCall = true;
      const completeModel = data.connectionMode === 'session'
        ? async ({ provider, messages, signal }) => {
            const response = await retrySessionFetch(() => webSessions.complete(provider, messages, {
              signal, first: firstSessionCall, ask: data.mode !== 'agent',
              model: data.sessionModel,
              thinkingEnabled: data.thinkingEnabled,
              searchEnabled: data.searchEnabled
            }), {
              signal,
              onRetry: (next, max, error) => send('agent-event', {
                type: 'status', text: `${provider} Session ${['backend_err', 'generation_err'].includes(error?.code) ? 'tạm lỗi' : 'lỗi kết nối'}, đang thử lại ${next}/${max}…`
              })
            });
            firstSessionCall = false;
            return response;
          }
        : undefined;
      const answer = await runAgent({
        provider: data.provider,
        model: data.model || settings.model(data.provider, PROVIDERS[data.provider].defaultModel),
        mode: data.mode,
        prompt: data.prompt,
        history: data.history,
        territoryId: data.territoryId,
        key: settings.key(data.provider),
        baseUrl: data.provider === 'other' ? settings.endpoint('other') : undefined,
      }, {
        manager: territories, signal: controller.signal,
        emit: event => send('agent-event', event), completeModel
      });
      return answer;
    } finally { agentJob = null; }
  });
  register('stop-agent', () => { agentJob?.abort(); return true; });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  dialog.showErrorBox('NTT Agent Desktop', error.message);
  app.quit();
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('before-quit', () => { agentJob?.abort(); terminalJob?.abort(); webSessions?.close(); });
