'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { NativeTerminal } = require('./native-terminal.cjs');

const MAX_FILE_BYTES = 2 * 1024 * 1024;

function boundedInteger(value, fallback, min, max) {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : fallback;
}

function inside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function directoryBytes(root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const dir = pending.pop();
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) pending.push(full);
      else if (entry.isFile()) total += (await fsp.stat(full)).size;
    }
  }
  return total;
}

class TerritoryManager {
  constructor(userData, { terminal = new NativeTerminal() } = {}) {
    this.base = path.join(userData, 'territories');
    this.indexFile = path.join(userData, 'territories.json');
    this.terminal = terminal;
    fs.mkdirSync(this.base, { recursive: true });
    try {
      this.index = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (!Array.isArray(this.index)) throw new Error('Invalid territory index');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.index = [];
    }
    // Keep the same directory and ID when upgrading an existing default memory area.
    if (this.index.length &&
        ['Lãnh địa đầu tiên', 'Phân vùng đầu tiên'].includes(this.index[0].name)) {
      this.index[0].name = 'Bộ nhớ đầu tiên';
      fs.writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
    }
  }

  async saveIndex() {
    const tmp = `${this.indexFile}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(this.index, null, 2));
    await fsp.rename(tmp, this.indexFile);
  }

  list() {
    return this.index.map(item => ({ id: item.id, name: item.name,
      kind: item.kind === 'folder' ? 'folder' : 'internal',
      root: item.kind === 'folder' ? item.root : path.join(this.base, item.id),
      quotaMb: item.quotaMb }));
  }

  get(id) {
    const item = this.index.find(row => row.id === id);
    if (!item || !/^[0-9a-f-]{36}$/.test(item.id)) throw new Error('Phân vùng bộ nhớ không tồn tại.');
    if (item.kind === 'folder') {
      const root = item.root;
      if (typeof root !== 'string' || !path.isAbsolute(root)) throw new Error('Đường dẫn thư mục dự án không hợp lệ.');
      let stat, actual;
      try { stat = fs.lstatSync(root); actual = fs.realpathSync(root); }
      catch (_) { throw new Error('Không tìm thấy thư mục dự án. Hãy kết nối lại thư mục trên máy.'); }
      if (!stat.isDirectory() || path.normalize(actual) !== path.normalize(root))
        throw new Error('Thư mục dự án đã đổi thành đường dẫn liên kết. Hãy kết nối lại.');
      return { ...item, root };
    }
    return { ...item, root: path.join(this.base, item.id) };
  }

  async attach(folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw new Error('Hãy chọn thư mục dự án hợp lệ.');
    const root = await fsp.realpath(folder);
    if (!(await fsp.stat(root)).isDirectory()) throw new Error('Hãy chọn một thư mục, không phải file.');
    if (inside(root, this.base)) throw new Error('Hãy chọn thư mục dự án bên ngoài vùng dữ liệu app.');
    if (path.parse(root).root === root) throw new Error('Hãy chọn thư mục dự án cụ thể, không chọn toàn bộ ổ đĩa.');
    const existing = this.index.find(item => item.kind === 'folder' &&
      path.normalize(item.root) === path.normalize(root));
    if (existing) return { ...existing, root };
    const item = { id: randomUUID(), name: path.basename(root), kind: 'folder', root,
      quotaMb: null };
    this.index.push(item);
    await this.saveIndex();
    return item;
  }

  async create(name, options = {}) {
    const cleanName = String(name || '').trim().slice(0, 60);
    if (!cleanName || cleanName === '.' || cleanName === '..') throw new Error('Hãy đặt tên phân vùng bộ nhớ hợp lệ.');
    const item = {
      id: randomUUID(), name: cleanName,
      quotaMb: boundedInteger(options.quotaMb, 2048, 256, 8192)
    };
    await fsp.mkdir(path.join(this.base, item.id), { recursive: false });
    this.index.push(item);
    await this.saveIndex();
    return item;
  }

  // No AI file operation may follow a symlink or leave its own territory.
  async resolve(id, relative = '.', allowMissing = false) {
    const { root } = this.get(id);
    if (typeof relative !== 'string' || relative.includes('\0') ||
        path.isAbsolute(relative) || /^[A-Za-z]:/.test(relative) || relative.startsWith('\\\\')) {
      throw new Error('Đường dẫn phải nằm trong phân vùng bộ nhớ.');
    }
    const parts = relative.replaceAll('\\', '/').split('/').filter(p => p && p !== '.');
    if (parts.some(p => p === '..' || p.includes(':'))) throw new Error('Đường dẫn vượt phân vùng bộ nhớ.');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const stat = await fsp.lstat(current);
        if (stat.isSymbolicLink()) throw new Error('Không theo đường dẫn liên kết.');
        if (i < parts.length - 1 && !stat.isDirectory()) throw new Error('Đường dẫn không phải thư mục.');
      } catch (error) {
        if (error.code === 'ENOENT' && allowMissing) continue;
        throw error;
      }
    }
    return current;
  }

  async listFiles(id, relative = '.') {
    const dir = await this.resolve(id, relative);
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries.filter(entry => !entry.isSymbolicLink()).map(entry => ({
      name: entry.name,
      path: path.posix.join(relative.replaceAll('\\', '/'), entry.name),
      kind: entry.isDirectory() ? 'folder' : 'file'
    })).sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === 'folder' ? -1 : 1));
  }

  async readFile(id, relative) {
    const target = await this.resolve(id, relative);
    const stat = await fsp.stat(target);
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES) throw new Error('Chỉ mở file văn bản tối đa 2 MB.');
    const buffer = await fsp.readFile(target);
    if (buffer.includes(0)) throw new Error('File nhị phân không thể mở trong editor.');
    return buffer.toString('utf8');
  }

  async writeFile(id, relative, content) {
    if (typeof content !== 'string' || Buffer.byteLength(content) > MAX_FILE_BYTES) {
      throw new Error('Nội dung file vượt giới hạn 2 MB.');
    }
    const target = await this.resolve(id, relative, true);
    const { root, quotaMb, kind } = this.get(id);
    if (kind !== 'folder') {
      const oldSize = await fsp.stat(target).then(s => s.size, () => 0);
      const used = await directoryBytes(root);
      if (used - oldSize + Buffer.byteLength(content) > quotaMb * 1024 * 1024)
        throw new Error('Phân vùng bộ nhớ đã đạt giới hạn dung lượng.');
    }
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const temp = `${target}.${randomUUID()}.tmp`;
    try {
      await fsp.writeFile(temp, content, { flag: 'wx' });
      await fsp.rename(temp, target);
    } finally {
      await fsp.rm(temp, { force: true });
    }
    return { path: relative, bytes: Buffer.byteLength(content) };
  }

  async usage(id) {
    const item = this.get(id);
    if (item.kind === 'folder') return { bytes: null, quotaBytes: null };
    return { bytes: await directoryBytes(item.root), quotaBytes: item.quotaMb * 1024 * 1024 };
  }

  runtimeInfo() { return this.terminal.info(); }

  async execute(id, command, { signal, onChunk = () => {}, timeoutMs = 120000 } = {}) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0'))
      throw new Error('Lệnh trống hoặc quá dài.');
    if (signal?.aborted) throw new Error('Đã dừng.');
    const item = this.get(id);
    const before = await this.usage(id);
    if (before.quotaBytes !== null && before.bytes >= before.quotaBytes)
      throw new Error('Phân vùng bộ nhớ đã đầy.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    let quotaExceeded = false, checking = false;
    const quotaWatch = before.quotaBytes === null ? null : setInterval(async () => {
      if (checking) return;
      checking = true;
      try {
        const { bytes, quotaBytes } = await this.usage(id);
        if (bytes > quotaBytes) { quotaExceeded = true; controller.abort(); }
      } catch (_) {} finally { checking = false; }
    }, 1500);
    try {
      const result = await this.terminal.run(command, { cwd: item.root,
        signal: controller.signal, onChunk, timeoutMs });
      return { ...result, quotaExceeded };
    } finally {
      clearInterval(quotaWatch);
      signal?.removeEventListener('abort', abort);
    }
  }
}

module.exports = { TerritoryManager, directoryBytes, MAX_FILE_BYTES };
