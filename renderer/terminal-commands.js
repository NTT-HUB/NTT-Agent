(function (root) {
  'use strict';
  function commandForFile(file, platform) {
    const name = String(file || '').replaceAll('\\', '/');
    if (!name || name.startsWith('/') || /^[A-Za-z]:/.test(name) || name.includes('\0') ||
        name.split('/').includes('..')) throw new Error('Hãy chọn file trong thư mục dự án.');
    const target = name.startsWith('./') ? name : `./${name}`;
    const extension = name.split('.').at(-1).toLowerCase();
    const windows = platform === 'win32';
    const quoted = `'${target.replaceAll("'", windows ? "''" : "'\\''")}'`;
    if (extension === 'py') return windows
      ? `if (Get-Command py -ErrorAction SilentlyContinue) { & py -3 ${quoted} } else { & python ${quoted} }`
      : `python3 ${quoted}`;
    const runtimes = { js: 'node', mjs: 'node', cjs: 'node', php: 'php', lua: 'lua' };
    if (runtimes[extension]) return `${windows ? '& ' : ''}${runtimes[extension]} ${quoted}`;
    if (windows && ['ps1', 'bat', 'cmd'].includes(extension)) return `& ${quoted}`;
    if (!windows && extension === 'sh') return `sh ${quoted}`;
    throw new Error(windows
      ? 'Chạy file hỗ trợ Python, JS, PHP, Lua, PowerShell và BAT/CMD trên Windows.'
      : 'Chạy file hỗ trợ Python, JS, PHP, Lua và shell script.');
  }
  const api = { commandForFile };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.NTTTerminal = api;
})(typeof window === 'object' ? window : globalThis);
