'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { NativeTerminal, runtimeInfo, MAX_OUTPUT_BYTES } = require('../lib/native-terminal.cjs');
const { commandForFile } = require('../renderer/terminal-commands.js');

const quote = value => `'${value.replaceAll("'", process.platform === 'win32' ? "''" : "'\\''")}'`;
async function project(t, source) {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'ntt-native-'));
  t.after(() => fs.rm(temp, { recursive: true, force: true }));
  const cwd = path.join(temp, 'project AI tiếng Việt');
  await fs.mkdir(cwd);
  await fs.writeFile(path.join(cwd, 'run.cjs'), source);
  return { cwd, command: `${process.platform === 'win32' ? '& ' : ''}${quote(process.execPath)} ${quote('./run.cjs')}` };
}

test('Chạy chương trình thật trong thư mục dự án có dấu/khoảng trắng, stream stdout và stderr', async t => {
  const { cwd, command } = await project(t, `const fs=require('node:fs'); fs.writeFileSync('kết quả.txt','Xin chào'); console.log(process.cwd()); console.error('stderr-ok');`);
  const chunks = [];
  const result = await new NativeTerminal().run(command, { cwd, onChunk: item => chunks.push(item) });
  assert.equal(result.code, 0);
  assert.ok(result.output.includes(cwd));
  assert.equal(await fs.readFile(path.join(cwd, 'kết quả.txt'), 'utf8'), 'Xin chào');
  assert.ok(chunks.some(item => item.stream === 'stdout'));
  assert.ok(chunks.some(item => item.stream === 'stderr' && item.text.includes('stderr-ok')));
  assert.equal(result.truncated, false);
});

test('Giữ exit code của chương trình bị lỗi', async t => {
  const { cwd, command } = await project(t, 'process.exit(7)');
  assert.equal((await new NativeTerminal().run(command, { cwd })).code, 7);
});

test('Output có giới hạn theo byte và không cắt hỏng ký tự UTF-8', async t => {
  const { cwd, command } = await project(t, `process.stdout.write('a'+'🙂'.repeat(40000));`);
  const result = await new NativeTerminal().run(command, { cwd });
  assert.equal(result.code, 0);
  assert.equal(result.truncated, true);
  assert.ok(Buffer.byteLength(result.output) <= MAX_OUTPUT_BYTES);
  assert.equal(result.output.includes('\uFFFD'), false);
  assert.ok(result.output.startsWith('a🙂'));
});

test('Nút Dừng kết thúc lệnh native đang chạy', { timeout: 8000 }, async t => {
  const { cwd, command } = await project(t, `console.log('ready');setInterval(()=>{},1000);`);
  const controller = new AbortController();
  const result = await new NativeTerminal().run(command, { cwd, signal: controller.signal,
    onChunk: item => { if (item.text.includes('ready')) controller.abort(); } });
  assert.equal(result.aborted, true);
  assert.equal(result.timedOut, false);
});

test('Lệnh quá thời gian bị kết thúc và trả đúng trạng thái', { timeout: 8000 }, async t => {
  const { cwd, command } = await project(t, 'setInterval(()=>{},1000);');
  const result = await new NativeTerminal().run(command, { cwd, timeoutMs: 80 });
  assert.equal(result.timedOut, true);
  assert.equal(result.aborted, false);
});

function fakeChild(pid = 4242) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kill = () => { queueMicrotask(() => child.emit('close', 1, null)); return true; };
  return child;
}

test('Windows gọi PowerShell trực tiếp, bảo toàn Unicode/cú pháp và dùng cwd dự án', async () => {
  let captured;
  const terminal = new NativeTerminal({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' },
    spawnProcess: (file, args, options) => {
      captured = { file, args, options };
      const child = fakeChild();
      queueMicrotask(() => child.emit('close', 0, null));
      return child;
    } });
  const command = "Write-Output 'Xin chào'; Get-Location";
  await terminal.run(command, { cwd: 'C:\\Users\\ROSA\\Downloads\\project AI' });
  assert.equal(captured.file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe');
  assert.equal(captured.options.cwd, 'C:\\Users\\ROSA\\Downloads\\project AI');
  assert.equal(captured.options.windowsHide, true);
  assert.notEqual(captured.options.shell, true);
  const script = Buffer.from(captured.args.at(-1), 'base64').toString('utf16le');
  assert.ok(script.includes(command));
  assert.ok(script.includes('exit $LASTEXITCODE'));
  assert.ok(script.includes("[Environment]::GetEnvironmentVariable('Path', 'Machine')"));
  assert.ok(script.includes("[Environment]::GetEnvironmentVariable('Path', 'User')"));
  assert.ok(script.includes('$env:Path'));
  assert.equal(script.includes('SetEnvironmentVariable'), false);
  assert.ok(captured.args.includes('-NoProfile'));
  assert.equal(captured.args.includes('-ExecutionPolicy'), false);
  assert.deepEqual(runtimeInfo('win32'), { platform: 'win32', shell: 'PowerShell', label: 'Windows · PowerShell',
    native: true, filesystemIsolation: false, networkIsolation: false });
});

test('Dừng Windows dùng taskkill /T /F cho đúng cây tiến trình đang chạy', async () => {
  const calls = [], child = fakeChild(7312);
  const terminal = new NativeTerminal({ platform: 'win32', env: { SystemRoot: 'C:\\Windows' },
    spawnProcess: (file, args) => {
      calls.push({ file, args });
      if (calls.length === 1) return child;
      const killer = new EventEmitter();
      queueMicrotask(() => { killer.emit('close', 0); child.emit('close', 1, null); });
      return killer;
    } });
  const controller = new AbortController();
  const pending = terminal.run('node bot.js', { cwd: 'C:\\project', signal: controller.signal });
  controller.abort();
  const result = await pending;
  assert.equal(result.aborted, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].file, 'C:\\Windows\\System32\\taskkill.exe');
  assert.deepEqual(calls[1].args, ['/PID', '7312', '/T', '/F']);
});

test('Lệnh đã bị hủy trước khi chạy không tạo tiến trình', async () => {
  let calls = 0;
  const terminal = new NativeTerminal({ spawnProcess: () => { calls++; throw new Error('must not start'); } });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(terminal.run('node bot.js', { cwd: '/tmp', signal: controller.signal }), /Đã dừng/);
  assert.equal(calls, 0);
});

test('Nút chạy file tạo lệnh Windows đúng với tên có dấu/khoảng trắng/dấu nháy', () => {
  const command = commandForFile("src/Tôi's bot.py", 'win32');
  assert.ok(command.includes("& py -3 './src/Tôi''s bot.py'"));
  assert.ok(command.includes("& python './src/Tôi''s bot.py'"));
  assert.equal(commandForFile('src/app.js', 'win32'), "& node './src/app.js'");
  assert.equal(commandForFile('tool.ps1', 'win32'), "& './tool.ps1'");
  assert.equal(commandForFile('start.cmd', 'win32'), "& './start.cmd'");
  for (const name of ['../outside.py', 'C:\\Windows\\test.py', '/etc/file.py'])
    assert.throws(() => commandForFile(name, 'win32'), /trong thư mục dự án/);
});
