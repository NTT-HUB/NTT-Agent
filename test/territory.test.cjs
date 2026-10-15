'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TerritoryManager } = require('../lib/territory.cjs');

test('phân vùng bộ nhớ chặn đường dẫn thoát ra ngoài và symbolic link', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ntt-agent-test-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const manager = new TerritoryManager(temp);
  const item = await manager.create('demo');
  await manager.writeFile(item.id, 'src/main.py', 'print("hello")');
  assert.equal(await manager.readFile(item.id, 'src/main.py'), 'print("hello")');
  await assert.rejects(manager.resolve(item.id, '../outside', true), /vượt phân vùng bộ nhớ/);
  await assert.rejects(manager.resolve(item.id, 'C:\\Windows\\secret', true), /phân vùng bộ nhớ/);
  await assert.rejects(manager.resolve(item.id, '/etc/passwd', true), /phân vùng bộ nhớ/);
  const link = path.join(manager.get(item.id).root, 'escape');
  await fs.symlink(temp, link);
  await assert.rejects(manager.resolve(item.id, 'escape/other', true), /liên kết/);
});

test('nâng cấp tên bộ nhớ đầu tiên giữ nguyên ID và file cũ', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ntt-agent-memory-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const first = new TerritoryManager(temp);
  const item = await first.create('Lãnh địa đầu tiên');
  await first.writeFile(item.id, 'notes.txt', 'đã lưu');
  await first.create('Dự án khác');
  const upgraded = new TerritoryManager(temp);
  assert.equal(upgraded.list()[0].name, 'Bộ nhớ đầu tiên');
  assert.equal(upgraded.list()[0].id, item.id);
  assert.equal(await upgraded.readFile(item.id, 'notes.txt'), 'đã lưu');
  assert.equal(upgraded.list()[1].name, 'Dự án khác');
});

test('chọn folder dự án gắn tại chỗ, file và terminal native dùng đúng folder gốc', async t => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ntt-agent-attach-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const userData = path.join(temp, 'appdata');
  const project = path.join(temp, 'Downloads', 'project AI');
  await fs.mkdir(project, { recursive: true });
  await fs.mkdir(userData);
  await fs.writeFile(path.join(project, 'index.html'), '<h1>Gốc</h1>');
  const manager = new TerritoryManager(userData);
  const item = await manager.attach(project);
  assert.equal(item.root, await fs.realpath(project));
  assert.equal(item.name, 'project AI');
  assert.equal(await manager.attach(project).then(row => row.id), item.id);
  assert.deepEqual((await manager.listFiles(item.id)).map(row => row.name), ['index.html']);
  await manager.writeFile(item.id, 'src/new.py', 'print(1)');
  assert.equal(await fs.readFile(path.join(project, 'src', 'new.py'), 'utf8'), 'print(1)');
  await assert.rejects(fs.stat(path.join(userData, 'territories', item.id)), /ENOENT/);
  const restarted = new TerritoryManager(userData);
  assert.equal(restarted.get(item.id).root, await fs.realpath(project));
  assert.deepEqual(await restarted.usage(item.id), { bytes: null, quotaBytes: null });
  let workingDirectory;
  restarted.terminal = { run: async (_command, options) => {
    workingDirectory = options.cwd;
    return { code: 0, output: '', truncated: false };
  } };
  await restarted.execute(item.id, 'Get-Location');
  assert.equal(workingDirectory, await fs.realpath(project));
  await fs.symlink(temp, path.join(project, 'escape'));
  await assert.rejects(restarted.writeFile(item.id, 'escape/outside.txt', 'oops'), /liên kết/);
});
