'use strict';

const path = require('node:path');
const { spawn } = require('node:child_process');
const { StringDecoder } = require('node:string_decoder');

const MAX_OUTPUT_BYTES = 96 * 1024;

function runtimeInfo(platform = process.platform) {
  return { platform, shell: platform === 'win32' ? 'PowerShell' : 'sh',
    label: platform === 'win32' ? 'Windows · PowerShell' : `${platform} · sh`,
    native: true, filesystemIsolation: false, networkIsolation: false };
}

function launchSpec(command, { platform = process.platform, env = process.env } = {}) {
  if (platform !== 'win32') return { file: '/bin/sh', args: ['-c', command] };
  // UTF-16LE EncodedCommand preserves Unicode, newlines and quotes without
  // passing the command through cmd.exe or changing execution-policy settings.
  const script = `$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$OutputEncoding = [Console]::OutputEncoding
# Re-read registered paths after an installer changes PATH. This only updates
# this child shell; keep the app's existing entries and do not write the registry.
$nttRegisteredPaths = @($env:Path, [Environment]::GetEnvironmentVariable('Path', 'Machine'), [Environment]::GetEnvironmentVariable('Path', 'User'))
$env:Path = ($nttRegisteredPaths | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) -join ';'
$LASTEXITCODE = 0
try {
  & {
${command}
  }
  $nttCommandSucceeded = $?
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  if (-not $nttCommandSucceeded) {
    exit 1
  }
  exit 0
} catch {
  [Console]::Error.WriteLine(($_ | Out-String))
  exit 1
}`;
  return { file: path.win32.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text',
      '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

function utf8Prefix(text, limit) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= limit) return text;
  let end = limit;
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end--;
  return bytes.subarray(0, end).toString('utf8');
}

class NativeTerminal {
  constructor({ platform = process.platform, env = process.env,
    spawnProcess = spawn, killGroup = process.kill.bind(process) } = {}) {
    this.platform = platform;
    this.env = env;
    this.spawn = spawnProcess;
    this.killGroup = killGroup;
  }

  info() { return runtimeInfo(this.platform); }

  run(command, { cwd, signal, onChunk = () => {}, timeoutMs = 120000 } = {}) {
    if (typeof command !== 'string' || !command.trim() || command.length > 4000 || command.includes('\0'))
      return Promise.reject(new Error('Lệnh trống hoặc quá dài.'));
    if (signal?.aborted) return Promise.reject(new Error('Đã dừng.'));
    if (typeof cwd !== 'string' || !cwd) return Promise.reject(new Error('Chưa chọn thư mục dự án.'));
    const spec = launchSpec(command, this);
    return new Promise((resolve, reject) => {
      let child;
      try {
        child = this.spawn(spec.file, spec.args, { cwd, windowsHide: true,
          detached: this.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...this.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1', NO_COLOR: '1' } });
      } catch (error) { reject(error); return; }
      let output = '', bytes = 0, truncated = false, settled = false;
      let aborted = false, timedOut = false, stopping = false;
      let timer, killTimer;
      const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
      const push = (stream, text) => {
        if (!text || truncated) return;
        const retained = utf8Prefix(text, MAX_OUTPUT_BYTES - bytes);
        output += retained;
        bytes += Buffer.byteLength(retained, 'utf8');
        if (retained) onChunk({ stream, text: retained });
        if (retained !== text) truncated = true;
      };
      const cleanup = () => {
        clearTimeout(timer); clearTimeout(killTimer);
        signal?.removeEventListener('abort', abort);
      };
      const stop = reason => {
        if (settled || stopping) return;
        stopping = true;
        aborted = reason === 'abort'; timedOut = reason === 'timeout';
        if (!child.pid) return;
        if (this.platform === 'win32') {
          const fallback = () => { if (!settled) child.kill(); };
          try {
            const killer = this.spawn(path.win32.join(this.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'),
              ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
            killer.on('error', fallback);
            killer.on('close', code => { if (code !== 0) fallback(); });
          } catch (_) { fallback(); }
          killTimer = setTimeout(fallback, 2000);
        } else {
          try { this.killGroup(-child.pid, 'SIGTERM'); } catch (_) { child.kill(); }
          killTimer = setTimeout(() => {
            if (settled) return;
            try { this.killGroup(-child.pid, 'SIGKILL'); } catch (_) { child.kill('SIGKILL'); }
          }, 1500);
        }
        killTimer?.unref?.();
      };
      const abort = () => stop('abort');
      child.stdout.on('data', chunk => push('stdout', decoders.stdout.write(chunk)));
      child.stderr.on('data', chunk => push('stderr', decoders.stderr.write(chunk)));
      child.once('error', error => {
        if (settled) return;
        settled = true; cleanup();
        if (error.code === 'ENOENT') {
          const detail = new Error(`Không khởi động được ${this.info().shell}. Kiểm tra shell và đường dẫn thư mục dự án.`);
          detail.code = error.code; reject(detail);
        } else reject(error);
      });
      child.once('close', (code, exitSignal) => {
        if (settled) return;
        settled = true; cleanup();
        push('stdout', decoders.stdout.end()); push('stderr', decoders.stderr.end());
        resolve({ code, signal: exitSignal || null, output, truncated, timedOut, aborted,
          runtime: this.info().shell, cwd });
      });
      if (timeoutMs > 0) timer = setTimeout(() => stop('timeout'), timeoutMs);
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
  }
}

module.exports = { NativeTerminal, runtimeInfo, launchSpec, MAX_OUTPUT_BYTES };
