'use strict';

const $ = id => document.getElementById(id);
const api = window.ntt;
const MODEL_PRESETS = {
  gemini: [['gemini-4-argon', 'Gemini 4 Argon'], ['gemini-3.8-flash', 'Gemini 3.8 Flash']],
  deepseek: [['deepseek-flash', 'DeepSeek Flash']]
};
const state = {
  territories: [], providers: {}, keyStatus: {}, models: {}, endpoints: {}, runtime: {},
  territoryId: null, provider: 'gemini', file: null, dirty: false,
  chat: [], sending: false, terminalBusy: false, gotFinal: false, liveTool: null
};
let syntaxFrame = 0;

function syncEditorScroll() {
  $('editor-highlight').scrollTop = $('editor').scrollTop;
  $('editor-highlight').scrollLeft = $('editor').scrollLeft;
}

function renderSyntax() {
  syntaxFrame = 0;
  const language = window.NTTHighlight.languageForFile(state.file);
  const source = $('editor').value;
  const large = source.length > 180000;
  $('editor').classList.toggle('plain-text', large);
  $('code-language').textContent = window.NTTHighlight.labels[language] + (large ? ' · file lớn' : '');
  if (large) { $('editor-highlight').textContent = ''; return; }
  $('editor-highlight').innerHTML = window.NTTHighlight.highlight(source, language) +
    (source.endsWith('\n') ? ' ' : '');
  syncEditorScroll();
}

function scheduleSyntax() {
  if (syntaxFrame) cancelAnimationFrame(syntaxFrame);
  syntaxFrame = requestAnimationFrame(renderSyntax);
}

function toast(message) {
  const node = $('toast');
  node.textContent = String(message);
  node.classList.add('visible');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => node.classList.remove('visible'), 3800);
}

function errorMessage(error) { return error?.message || String(error); }
function currentTerritory() { return state.territories.find(x => x.id === state.territoryId); }

function updateBusyControls() {
  const busy = state.sending || state.terminalBusy;
  for (const id of ['territory', 'choose-territory']) $(id).disabled = busy;
  $('new-file').disabled = busy || !state.territoryId;
  for (const id of ['provider', 'connection-mode', 'connection-button', 'model-preset',
    'session-gemini-model', 'session-thinking', 'session-search']) $(id).disabled = state.sending;
  $('send-button').disabled = busy;
  $('clear-chat').disabled = busy || !state.chat.length;
  $('terminal-command').disabled = busy;
  $('editor').disabled = state.sending && document.querySelector('input[name="mode"]:checked')?.value === 'agent';
}

function updateConnection() {
  if (state.provider === 'other')
    $('connection-mode').value = 'api';
  $('connection-mode').querySelector('option[value="session"]').disabled = state.provider === 'other';
  const otherLocal = state.provider === 'other' && /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(state.endpoints.other || '');
  const connected = state.keyStatus[state.provider] || otherLocal;
  const isSession = $('connection-mode').value === 'session';
  $('connection-state').textContent = isSession ? 'Session' :
    (otherLocal && !state.keyStatus.other ? 'Endpoint local sẵn sàng' :
      connected ? 'Đã lưu API key trên máy' : 'Chưa kết nối API');
  $('connection-state').style.color = !isSession && connected ? '#63d6a7' : '#8fa6bd';
  const model = state.models[state.provider] || state.providers[state.provider]?.defaultModel || '';
  const presets = MODEL_PRESETS[state.provider] || [];
  $('model-preset').replaceChildren();
  for (const [value, label] of presets) {
    const option = document.createElement('option'); option.value = value; option.textContent = label;
    $('model-preset').append(option);
  }
  const custom = document.createElement('option'); custom.value = '__custom'; custom.textContent = 'Nhập model khác…';
  $('model-preset').append(custom);
  $('model-preset').value = presets.some(([value]) => value === model) ? model : '__custom';
  $('model').value = model;
  $('model').hidden = $('model-preset').value !== '__custom';
  $('save-model').hidden = $('model').hidden;
  $('model-controls').hidden = isSession || state.provider === 'other';
  $('api-connection').hidden = isSession;
  $('session-connection').hidden = !isSession;
  $('gemini-session-options').hidden = !(isSession && state.provider === 'gemini');
  $('deepseek-session-options').hidden = !(isSession && state.provider === 'deepseek');
  $('argon-direct-hint').hidden = !(isSession && state.provider === 'gemini');
  $('other-endpoint').hidden = state.provider !== 'other';
  $('open-key-page').hidden = state.provider === 'other';
}

async function updateUsage() {
  if (!state.territoryId) { $('quota').textContent = 'Chưa chọn thư mục'; return; }
  const usage = await api.usage(state.territoryId);
  if (usage.quotaBytes === null) { $('quota').textContent = 'Thư mục trên máy'; return; }
  const mb = (usage.bytes / 1048576).toFixed(1);
  $('quota').textContent = `${mb} / ${(usage.quotaBytes / 1048576).toFixed(0)} MB`;
}

function fillTerritories() {
  const select = $('territory');
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = ''; placeholder.textContent = 'Chưa chọn thư mục';
  placeholder.disabled = Boolean(state.territoryId);
  select.append(placeholder);
  for (const item of state.territories) {
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.kind === 'internal' ? `${item.name} (bản cũ trong app)` : item.name;
    option.title = item.root;
    select.append(option);
  }
  select.value = state.territoryId || '';
  $('workspace-path').textContent = currentTerritory()?.root || 'Chưa chọn thư mục dự án.';
  $('workspace-path').title = currentTerritory()?.root || '';
}

async function selectTerritory(id) {
  if (state.sending || state.terminalBusy) return;
  if (!state.territories.some(x => x.id === id)) return;
  if (state.dirty && !confirm('File chưa lưu. Chuyển phân vùng bộ nhớ và bỏ thay đổi?')) {
    $('territory').value = state.territoryId;
    return;
  }
  state.territoryId = id;
  localStorage.setItem('selectedTerritory', id);
  state.file = null;
  setDirty(false);
  $('editor').value = '';
  scheduleSyntax();
  $('file-title').textContent = 'Chưa mở file';
  $('save-file').disabled = true;
  $('run-file').disabled = true;
  fillTerritories();
  const [, usage] = await Promise.allSettled([refreshTree(), updateUsage()]);
  if (usage.status === 'rejected') {
    $('quota').textContent = 'Không tìm thấy thư mục';
    toast(errorMessage(usage.reason));
  }
  state.chat = await api.getChat(id);
  renderMessages();
  updateBusyControls();
}

async function refreshTree() {
  const tree = $('file-tree');
  tree.replaceChildren();
  if (!state.territoryId) {
    const empty = document.createElement('div');
    empty.className = 'explorer-foot';
    empty.textContent = 'Chọn thư mục dự án trên máy để mở file và cho AI làm việc tại đó.';
    tree.append(empty);
    return;
  }
  try { await renderDirectory('.', tree); }
  catch (error) { toast(errorMessage(error)); }
}

async function renderDirectory(dir, target) {
  const entries = await api.listFiles(state.territoryId, dir);
  if (!entries.length && dir === '.') {
    const empty = document.createElement('div');
    empty.className = 'explorer-foot';
    empty.textContent = 'Thư mục trống. Tạo file ngay trong thư mục này.';
    target.append(empty);
  }
  for (const entry of entries) {
    const button = document.createElement('button');
    button.className = `tree-row ${entry.kind}`;
    button.textContent = `${entry.kind === 'folder' ? '▸' : '◇'}  ${entry.name}`;
    button.title = entry.path;
    target.append(button);
    if (entry.kind === 'folder') {
      const children = document.createElement('div');
      children.className = 'tree-children';
      children.hidden = true;
      target.append(children);
      button.addEventListener('click', async () => {
        children.hidden = !children.hidden;
        button.textContent = `${children.hidden ? '▸' : '▾'}  ${entry.name}`;
        if (!children.hidden && !children.dataset.loaded) {
          try { await renderDirectory(entry.path, children); children.dataset.loaded = '1'; }
          catch (error) { toast(errorMessage(error)); }
        }
      });
    } else button.addEventListener('click', () => openFile(entry.path));
  }
}

function setDirty(dirty) {
  state.dirty = dirty;
  $('file-title').classList.toggle('dirty', dirty);
  $('file-state').textContent = dirty ? 'Chưa lưu' : 'Đã lưu';
}

async function openFile(file) {
  if (state.dirty && !confirm('File chưa lưu. Mở file khác và bỏ thay đổi?')) return;
  try {
    $('editor').value = await api.readFile(state.territoryId, file);
    state.file = file;
    scheduleSyntax();
    $('file-title').textContent = file;
    $('save-file').disabled = false;
    $('run-file').disabled = false;
    setDirty(false);
    $('editor').focus();
  } catch (error) { toast(errorMessage(error)); }
}

async function saveFile() {
  if (!state.file) return;
  try {
    await api.writeFile(state.territoryId, state.file, $('editor').value);
    setDirty(false);
    await updateUsage();
    toast('Đã lưu ' + state.file);
  } catch (error) { toast(errorMessage(error)); }
}

function appendMessage(role, text) {
  const node = document.createElement('div');
  node.className = `message ${role}`;
  node.textContent = text;
  $('chat-messages').append(node);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  state.chat.push({ role, text });
  updateBusyControls();
}

function appendEvent(text, isError = false) {
  const node = document.createElement('div');
  node.className = `event${isError ? ' error' : ''}`;
  node.textContent = text;
  $('chat-messages').append(node);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  return node;
}

function appendChoiceButtons(options) {
  const row = document.createElement('div');
  row.className = 'question-actions';
  for (const option of options) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'question-option';
    button.textContent = option;
    button.disabled = state.sending;
    button.addEventListener('click', () => {
      if (state.sending) return;
      document.querySelector('input[name="mode"][value="agent"]').checked = true;
      $('chat-input').value = option;
      $('chat-form').requestSubmit();
    });
    row.append(button);
  }
  $('chat-messages').append(row);
  $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
}

function appendQuestion(message, options) {
  appendMessage('assistant', message);
  state.chat.at(-1).options = options;
  appendChoiceButtons(options);
}

function renderMessages() {
  const box = $('chat-messages');
  box.replaceChildren();
  if (!state.chat.length) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome';
    const title = document.createElement('strong');
    title.textContent = 'Xin chào 👋';
    const body = document.createElement('p');
    body.textContent = 'Chọn thư mục dự án trên máy. Chế độ Agent sẽ đọc, sửa file hoặc chạy lệnh ngay trong thư mục đó khi cần.';
    welcome.append(title, body);
    box.append(welcome);
  }
  for (const message of state.chat) {
    const node = document.createElement('div');
    node.className = `message ${message.role === 'assistant' ? 'assistant' : 'user'}`;
    node.textContent = message.text;
    box.append(node);
    if (message.role === 'assistant' && Array.isArray(message.options) && message.options.length >= 2)
      appendChoiceButtons(message.options);
  }
  box.scrollTop = box.scrollHeight;
}

function setSending(value) {
  state.sending = value;
  $('send-button').hidden = value;
  $('stop-agent').hidden = !value;
  $('chat-input').disabled = value;
  document.querySelectorAll('.question-option').forEach(button => { button.disabled = value; });
  $('task-status').textContent = value ? 'AI đang xử lý...' : 'AI sẽ tự quyết định khi nào cần dùng công cụ.';
  updateBusyControls();
}

async function sendChat(event) {
  event.preventDefault();
  if (state.sending) return;
  const prompt = $('chat-input').value.trim();
  if (!prompt) return;
  const mode = document.querySelector('input[name="mode"]:checked').value;
  if (mode === 'agent' && !state.territoryId) return toast('Hãy chọn thư mục dự án.');
  const history = state.chat.slice(-12);
  state.chat.forEach(message => { delete message.options; });
  document.querySelectorAll('.question-actions').forEach(row => row.remove());
  $('chat-input').value = '';
  appendMessage('user', prompt);
  state.gotFinal = false;
  state.liveTool = null;
  setSending(true);
  try {
    await api.send({
      provider: state.provider, model: $('model').value.trim(),
      connectionMode: $('connection-mode').value, mode, prompt, history, territoryId: state.territoryId,
      sessionModel: $('session-gemini-model').value,
      thinkingEnabled: $('session-thinking').checked, searchEnabled: $('session-search').checked
    });
  } catch (error) {
    appendMessage('assistant', `Lỗi: ${errorMessage(error)}`);
  } finally {
    setSending(false);
    state.liveTool = null;
    await api.saveChat(state.territoryId, state.chat).catch(error => toast(errorMessage(error)));
    if (state.file && !state.dirty) {
      api.readFile(state.territoryId, state.file).then(text => { $('editor').value = text; scheduleSyntax(); }).catch(() => {});
    }
    await Promise.all([refreshTree(), updateUsage()]).catch(() => {});
  }
}

function terminalText(text) {
  const output = $('terminal-output');
  output.textContent += String(text);
  if (output.textContent.length > 120000) output.textContent = output.textContent.slice(-120000);
  output.scrollTop = output.scrollHeight;
}

async function runCommand(command) {
  if (!state.territoryId) return toast('Hãy chọn thư mục dự án trước.');
  if (state.terminalBusy || state.sending) return toast('Đang có tác vụ chạy.');
  if (!command.trim()) return;
  state.terminalBusy = true;
  $('stop-terminal').disabled = false;
  updateBusyControls();
  terminalText(`\n${state.runtime.platform === 'win32' ? 'PS>' : '$'} ${command}\n`);
  try { await api.runCommand(state.territoryId, command); }
  catch (error) { terminalText(`\n[Lỗi] ${errorMessage(error)}\n`); }
  finally {
    state.terminalBusy = false;
    $('stop-terminal').disabled = true;
    updateBusyControls();
    updateUsage().catch(() => {});
    refreshTree().catch(() => {});
  }
}

async function init() {
  const boot = await api.bootstrap();
  $('app-version').textContent = `DESKTOP · v${boot.version}`;
  state.territories = boot.territories;
  state.providers = boot.providers;
  state.keyStatus = boot.keyStatus;
  state.models = boot.models;
  state.endpoints = boot.endpoints || {};
  state.runtime = boot.runtime || { platform: 'win32', shell: 'PowerShell', label: 'Windows · PowerShell' };
  $('runtime-status').textContent = `● ${state.runtime.label}`;
  $('terminal-title').textContent = `TERMINAL · ${state.runtime.shell.toUpperCase()}`;
  $('terminal-prompt').textContent = state.runtime.platform === 'win32' ? 'PS>' : '$';
  $('terminal-output').textContent = `Lệnh chạy trực tiếp bằng quyền tài khoản hiện tại (${state.runtime.label}).\nMỗi lượt bắt đầu trong thư mục dự án đã chọn. Đây không phải vùng cách ly hệ điều hành.\n`;
  state.provider = Object.hasOwn(state.providers, localStorage.getItem('selectedProvider'))
    ? localStorage.getItem('selectedProvider') : 'gemini';
  $('provider').value = state.provider;
  const savedMode = localStorage.getItem('connectionMode');
  $('connection-mode').value = ['api', 'session'].includes(savedMode) ? savedMode : 'session';
  localStorage.setItem('connectionMode', $('connection-mode').value);
  $('session-gemini-model').value = localStorage.getItem('sessionGeminiModel') || '3.6 Flash';
  $('session-thinking').checked = localStorage.getItem('sessionThinking') === 'true';
  $('session-search').checked = localStorage.getItem('sessionSearch') === 'true';
  let saved = localStorage.getItem('selectedTerritory');
  if (localStorage.getItem('folderWorkspaceMigrated') !== '1') {
    localStorage.setItem('folderWorkspaceMigrated', '1');
    saved = null;
  }
  state.territoryId = state.territories.find(x => x.id === saved)?.id ||
    state.territories.find(x => x.kind === 'folder')?.id || null;
  updateConnection();
  if (state.territoryId) await selectTerritory(state.territoryId);
  else {
    fillTerritories();
    state.chat = await api.getChat('general');
    renderMessages();
    await refreshTree();
    await updateUsage();
    updateBusyControls();
  }
}

$('territory').addEventListener('change', event => selectTerritory(event.target.value));
$('refresh-files').addEventListener('click', refreshTree);
$('choose-territory').addEventListener('click', async () => {
  try {
    const item = await api.attachTerritory();
    if (!item) return;
    if (!state.territories.some(x => x.id === item.id)) state.territories.push(item);
    await selectTerritory(item.id);
  } catch (error) { toast(errorMessage(error)); }
});
$('new-file').addEventListener('click', async () => {
  if (!state.territoryId) return toast('Hãy chọn thư mục dự án trước.');
  const filename = prompt('Tên file trong thư mục dự án (ví dụ src/main.py):');
  if (!filename) return;
  if (state.dirty && !confirm('File chưa lưu. Bỏ thay đổi?')) return;
  try {
    await api.writeFile(state.territoryId, filename, '');
    setDirty(false);
    await refreshTree();
    await openFile(filename);
  } catch (error) { toast(errorMessage(error)); }
});
$('editor').addEventListener('input', () => { if (state.file) setDirty(true); scheduleSyntax(); });
$('editor').addEventListener('scroll', syncEditorScroll);
$('editor').addEventListener('keydown', event => {
  if (event.key === 'Tab') {
    event.preventDefault();
    const field = event.target, start = field.selectionStart;
    field.setRangeText('    ', start, field.selectionEnd, 'end');
    setDirty(true);
    scheduleSyntax();
  }
});
$('save-file').addEventListener('click', saveFile);
$('run-file').addEventListener('click', async () => {
  if (!state.file) return;
  if (state.dirty) await saveFile();
  if (state.dirty) return;
  try { await runCommand(window.NTTTerminal.commandForFile(state.file, state.runtime.platform)); }
  catch (error) { toast(errorMessage(error)); }
});
document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); saveFile(); }
});
$('terminal-form').addEventListener('submit', event => {
  event.preventDefault();
  const command = $('terminal-command').value;
  $('terminal-command').value = '';
  runCommand(command);
});
$('stop-terminal').addEventListener('click', () => api.stopCommand());
$('clear-terminal').addEventListener('click', () => { $('terminal-output').textContent = ''; });
$('clear-chat').addEventListener('click', async () => {
  if (state.sending || state.terminalBusy || !state.chat.length) return;
  if (!confirm('Dọn toàn bộ lịch sử chat của phân vùng bộ nhớ này trong app? Hội thoại trên trang AI vẫn còn.')) return;
  $('clear-chat').disabled = true;
  try {
    await api.clearChat(state.territoryId);
    state.chat = [];
    renderMessages();
    toast('Đã dọn lịch sử chat trong app.');
  } catch (error) { toast(errorMessage(error)); }
  finally { updateBusyControls(); }
});
$('provider').addEventListener('change', event => {
  state.provider = event.target.value;
  localStorage.setItem('selectedProvider', state.provider);
  updateConnection();
});
$('connection-mode').addEventListener('change', event => {
  localStorage.setItem('connectionMode', event.target.value);
  updateConnection();
});
$('session-gemini-model').addEventListener('change', event => localStorage.setItem('sessionGeminiModel', event.target.value));
$('session-thinking').addEventListener('change', event => localStorage.setItem('sessionThinking', String(event.target.checked)));
$('session-search').addEventListener('change', event => localStorage.setItem('sessionSearch', String(event.target.checked)));
$('model-preset').addEventListener('change', async event => {
  const custom = event.target.value === '__custom';
  $('model').hidden = !custom;
  $('save-model').hidden = !custom;
  if (custom) {
    if ((MODEL_PRESETS[state.provider] || []).some(([value]) => value === $('model').value)) $('model').value = '';
    $('model').focus(); return;
  }
  $('model').value = event.target.value;
  const provider = state.provider;
  try { state.models[provider] = await api.saveModel(provider, event.target.value); }
  catch (error) { toast(errorMessage(error)); }
});
$('save-model').addEventListener('click', async () => {
  try { state.models[state.provider] = await api.saveModel(state.provider, $('model').value); toast('Đã lưu model.'); }
  catch (error) { toast(errorMessage(error)); }
});
$('connection-button').addEventListener('click', () => {
  $('connect-desc').textContent = state.providers[state.provider].label;
  $('api-key').value = '';
  $('base-url').value = state.endpoints.other || '';
  $('other-model').value = state.models.other || state.providers.other.defaultModel;
  $('session-status').textContent = 'Chưa kiểm tra tab AI.';
  $('connect-dialog').showModal();
});
$('open-session').addEventListener('click', async () => {
  try { await api.openWebSession(state.provider); toast('Đã mở trang AI trong app. Đăng nhập tại cửa sổ đó.'); }
  catch (error) { toast(errorMessage(error)); }
});
$('check-session').addEventListener('click', async () => {
  try {
    const status = await api.webSessionStatus(state.provider);
    $('session-status').textContent = status.ready
      ? 'Session đã sẵn sàng. Bạn có thể gửi thử ở chế độ Hỏi.'
      : `Session chưa sẵn sàng: ${status.error || 'hãy mở trang AI và đăng nhập trong app.'}`;
  } catch (error) { toast(errorMessage(error)); }
});
$('use-provider-api').addEventListener('click', () => {
  $('connection-mode').value = 'api';
  localStorage.setItem('connectionMode', 'api');
  updateConnection();
  $('api-key').focus();
});
$('clear-session').addEventListener('click', async () => {
  const detail = state.provider === 'deepseek'
    ? 'DeepSeek sẽ cần đăng nhập lại. Phiên Google và Gemini được giữ.'
    : 'Dữ liệu trang Gemini và hội thoại được đặt lại. Phiên Google và DeepSeek được giữ.';
  if (!confirm(`Đặt lại Session? ${detail}`)) return;
  try { await api.clearWebSession(state.provider); $('session-status').textContent = 'Đã đặt lại Session. Phiên Google được giữ.'; }
  catch (error) { toast(errorMessage(error)); }
});
$('open-key-page').addEventListener('click', () => api.connectionPage(state.provider));
$('store-key').addEventListener('click', async () => {
  try {
    if (state.provider === 'other') {
      if (!$('other-model').value.trim()) throw new Error('Hãy nhập model.');
      state.endpoints.other = await api.saveEndpoint('other', $('base-url').value);
      state.models.other = await api.saveModel('other', $('other-model').value);
      $('model').value = state.models.other;
    }
    if ($('api-key').value.trim()) state.keyStatus = await api.saveKey(state.provider, $('api-key').value);
    if (!state.keyStatus[state.provider] && state.provider !== 'other') throw new Error('Hãy nhập API key.');
    if (state.provider === 'other' && !state.keyStatus.other &&
        !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?(?:\/|$)/i.test(state.endpoints.other)) {
      throw new Error('Hãy nhập API key cho endpoint này.');
    }
    $('api-key').value = '';
    $('connect-dialog').close(); updateConnection(); toast('Đã lưu kết nối.');
  }
  catch (error) { toast(errorMessage(error)); }
});
$('remove-key').addEventListener('click', async () => {
  try { state.keyStatus = await api.saveKey(state.provider, ''); $('connect-dialog').close(); updateConnection(); toast('Đã xóa khóa.'); }
  catch (error) { toast(errorMessage(error)); }
});
$('chat-form').addEventListener('submit', sendChat);
$('chat-input').addEventListener('keydown', event => {
  if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); $('chat-form').requestSubmit(); }
});
$('stop-agent').addEventListener('click', () => api.stop());

api.onAgent(event => {
  if (event.type === 'status') appendEvent(event.text);
  else if (event.type === 'final') { appendMessage('assistant', event.text); state.gotFinal = true; }
  else if (event.type === 'question') { appendQuestion(event.text, event.options); state.gotFinal = true; }
  else if (event.type === 'tool') {
    const details = event.tool === 'write_file' ? `${event.args.path} (${event.args.bytes} bytes)`
      : event.tool === 'run_command' ? event.args.command : event.args.path || '.';
    state.liveTool = appendEvent(`${event.tool}: ${details}\n${event.reason}`);
  } else if (event.type === 'tool-output' && state.liveTool) {
    state.liveTool.textContent = (state.liveTool.textContent + '\n' + event.text).slice(-6000);
    $('chat-messages').scrollTop = $('chat-messages').scrollHeight;
  } else if (event.type === 'tool-result') {
    appendEvent(`${event.tool} → ${event.text.slice(0, 700)}`);
    state.liveTool = null;
  }
});
api.onTerminal(event => {
  if (event.type === 'chunk') terminalText(event.text);
  else if (event.type === 'done') terminalText(`\n[exit ${event.result.code ?? event.result.signal ?? 'n/a'}${event.result.timedOut ? ', quá giờ' : ''}${event.result.aborted ? ', đã dừng' : ''}${event.result.quotaExceeded ? ', vượt dung lượng' : ''}${event.result.truncated ? ', đã giới hạn output' : ''}]\n`);
});

init().catch(error => toast(errorMessage(error)));
