'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
contextBridge.exposeInMainWorld('ntt', {
  bootstrap: () => call('bootstrap'),
  attachTerritory: () => call('attach-territory'),
  usage: id => call('usage', id),
  listFiles: (id, relative) => call('list-files', id, relative),
  readFile: (id, relative) => call('read-file', id, relative),
  writeFile: (id, relative, content) => call('write-file', id, relative, content),
  saveKey: (provider, key) => call('save-key', provider, key),
  saveEndpoint: (provider, url) => call('save-endpoint', provider, url),
  saveModel: (provider, model) => call('save-model', provider, model),
  getChat: id => call('get-chat', id),
  saveChat: (id, messages) => call('save-chat', id, messages),
  clearChat: id => call('clear-chat', id),
  connectionPage: provider => call('open-connection-page', provider),
  openWebSession: provider => call('open-web-session', provider),
  webSessionStatus: provider => call('web-session-status', provider),
  clearWebSession: provider => call('clear-web-session', provider),
  runCommand: (id, command) => call('run-command', id, command),
  stopCommand: () => call('stop-command'),
  send: data => call('agent-send', data),
  stop: () => call('stop-agent'),
  onAgent: callback => { const fn = (_event, data) => callback(data); ipcRenderer.on('agent-event', fn); return () => ipcRenderer.removeListener('agent-event', fn); },
  onTerminal: callback => { const fn = (_event, data) => callback(data); ipcRenderer.on('terminal-event', fn); return () => ipcRenderer.removeListener('terminal-event', fn); }
});
