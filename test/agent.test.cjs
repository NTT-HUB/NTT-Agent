'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseAction, runAgent, falsePause } = require('../lib/agent.cjs');

test('chỉ object JSON hợp lệ mới trở thành lệnh công cụ', () => {
  assert.equal(parseAction('rm -rf /'), null);
  assert.equal(parseAction('{"type":"tool","tool":"run_command","args":{"command":"pwd"}}'), null);
  assert.equal(parseAction('{"type":"tool","tool":"run_command","reason":"Cần xem thư mục hiện tại","args":{"command":"pwd"}}').tool, 'run_command');
  assert.equal(parseAction('{"type":"tool","tool":"host_command","reason":"Cần chạy trên Windows","args":{"command":"pwd"}}'), null);
});

test('Hỏi không chạy công cụ dù model trả JSON tool', async () => {
  let calls = 0;
  const answer = await runAgent({ provider: 'gemini', model: 'test', mode: 'ask', prompt: 'Chào', history: [], key: 'fake' }, {
    manager: { execute: () => { calls++; } },
    completeModel: async () => '{"type":"tool","tool":"run_command"}'
  });
  assert.equal(calls, 0);
  assert.match(answer, /run_command/);
});

test('Agent tự trả lời không gọi lệnh; gọi file tool đúng một lần khi cần', async () => {
  let calls = 0, responses = 0;
  const manager = {
    listFiles: async () => { calls++; return [{ name: 'main.py', kind: 'file' }]; }
  };
  const answer = await runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: 'Liệt kê file', history: [], territoryId: 'demo', key: 'fake' }, {
    manager,
    completeModel: async () => ++responses === 1
      ? JSON.stringify({ type: 'tool', tool: 'list_files', reason: 'Cần đọc danh sách file', args: { path: '.' } })
      : JSON.stringify({ type: 'final', message: 'Có main.py' })
  });
  assert.equal(calls, 1);
  assert.equal(answer, 'Có main.py');

  calls = 0;
  const direct = await runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: '2+2?', history: [], territoryId: 'demo', key: 'fake' }, {
    manager,
    completeModel: async () => JSON.stringify({ type: 'final', message: '4' })
  });
  assert.equal(direct, '4');
  assert.equal(calls, 0);
});

test('hai lần định dạng sai sẽ dừng an toàn', async () => {
  let calls = 0;
  await assert.rejects(runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: 'Test', history: [], territoryId: 'demo', key: 'fake' }, {
    manager: { execute: () => { calls++; } },
    completeModel: async () => '```bash\nrm -rf /\n```'
  }), /không trả về hành động hợp lệ/);
  assert.equal(calls, 0);
});

test('tự tiếp tục khi model báo sai quota công cụ, rồi ghi file còn thiếu', async () => {
  const replies = [
    { type: 'final', message: 'Đã ghi schema.sql. Do quota công cụ bằng 0, bạn hãy nhắn tiếp để tạo worker.js.' },
    { type: 'tool', tool: 'write_file', reason: 'Cần hoàn tất worker.js cho dự án', args: { path: 'worker.js', content: 'export default {};' } },
    { type: 'final', message: 'Đã tạo worker.js.' }
  ];
  const files = new Map();
  const events = [];
  const answer = await runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: 'Tạo backend', territoryId: 'demo' }, {
    manager: { writeFile: async (_id, file, content) => { files.set(file, content); return { path: file }; } },
    emit: event => events.push(event),
    completeModel: async ({ messages }) => {
      if (replies.length === 2) assert.match(messages.at(-1).content, /Tiếp tục hoàn thành/);
      return JSON.stringify(replies.shift());
    }
  });
  assert.equal(files.get('worker.js'), 'export default {};');
  assert.equal(answer, 'Đã tạo worker.js.');
  assert.equal(events.filter(x => x.type === 'status').length, 1);
  assert.equal(events.filter(x => x.type === 'final').length, 1);
  assert.equal(falsePause('Đã sửa lỗi quota trong source code.'), false);
  assert.equal(falsePause('Tài liệu nói về quota công cụ bằng 0 và cách thiết kế hệ thống.'), false);
  assert.equal(falsePause('Hệ thống đang giới hạn số lần gọi công cụ bằng 0, nên mình chưa thể tự động tạo thêm file.'), true);
});

test('câu hỏi cần lựa chọn được phát ra và dừng chờ người dùng', async () => {
  const events = [];
  let calls = 0;
  const answer = await runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: 'Tạo website', territoryId: 'demo' }, {
    manager: {}, emit: event => events.push(event),
    completeModel: async () => {
      calls++;
      return JSON.stringify({ type: 'question', message: 'Bạn muốn làm web nào?', options: ['Web game', 'Web blog'] });
    }
  });
  assert.equal(answer, 'Bạn muốn làm web nào?');
  assert.equal(calls, 1);
  assert.deepEqual(events[0], { type: 'question', text: answer, options: ['Web game', 'Web blog'] });
  assert.equal(parseAction('{"type":"question","message":"Chọn?","options":["A"]}'), null);
});

test('model liên tục đòi nhắn tiếp sẽ dừng có giải thích, không lặp vô hạn', async () => {
  let calls = 0;
  await assert.rejects(runAgent({ provider: 'gemini', model: 'test', mode: 'agent', prompt: 'Tạo file', territoryId: 'demo' }, {
    manager: {}, completeModel: async () => {
      calls++;
      return JSON.stringify({ type: 'final', message: 'Bạn hãy nhắn tiếp để mình ghi file.' });
    }
  }), /Model liên tục dừng sớm/);
  assert.equal(calls, 4);
});

test('Agent biết shell PowerShell và đường dẫn Windows thật khi yêu cầu chạy lệnh', async () => {
  let calls = 0;
  const root = 'C:\\Users\\ROSA\\Downloads\\project AI';
  const manager = {
    runtimeInfo: () => ({ platform: 'win32', shell: 'PowerShell', label: 'Windows · PowerShell' }),
    get: () => ({ root }),
    execute: async (_id, command) => {
      assert.equal(command, 'Get-ChildItem');
      calls++; return { code: 0, output: 'main.py' };
    }
  };
  const answer = await runAgent({ provider: 'gemini', mode: 'agent', prompt: 'Liệt kê file bằng terminal', territoryId: 'demo' }, {
    manager, completeModel: async ({ messages }) => {
      assert.ok(messages[0].content.includes(JSON.stringify(root)));
      assert.match(messages[0].content, /Windows PowerShell 5\.1/);
      assert.match(messages[0].content, /npm\.cmd/);
      assert.equal(messages[0].content.includes('Lệnh chạy trong container'), false);
      return JSON.stringify(calls ? { type: 'final', message: 'Có main.py' } :
        { type: 'tool', tool: 'run_command', reason: 'Người dùng yêu cầu liệt kê bằng terminal', args: { command: 'Get-ChildItem' } });
    }
  });
  assert.equal(answer, 'Có main.py');
  assert.equal(calls, 1);
});

test('Agent được cài runtime còn thiếu và tiếp tục tác vụ; timeout cài đặt được chuyển cho terminal', async () => {
  const commands = [
    { command: 'Get-Command py, python -ErrorAction SilentlyContinue', result: { code: 1, output: 'No Python runtime found' } },
    { command: 'winget show --id Python.Python.3.14 --exact --source winget --disable-interactivity', result: { code: 0, output: 'Python 3.14; publisher Python Software Foundation; user installer available' } },
    { command: 'winget install --id Python.Python.3.14 --exact --source winget --scope user --silent --accept-package-agreements --accept-source-agreements --disable-interactivity', timeoutMs: 600000, result: { code: 0, output: 'Successfully installed' } },
    { command: 'py -3 --version', result: { code: 0, output: 'Python 3.14' } },
    { command: 'py -3 main.py', result: { code: 0, output: 'Task finished' } }
  ];
  let executed = 0;
  const root = 'C:\\Users\\ROSA\\Downloads\\project AI';
  const answer = await runAgent({ provider: 'deepseek', mode: 'agent', prompt: 'Chạy main.py giúp tôi', territoryId: 'demo',
    history: [{ role: 'assistant', text: 'Trước đây app cấm cài phần mềm ngoài dự án.' }] }, {
    manager: {
      runtimeInfo: () => ({ platform: 'win32', label: 'Windows · PowerShell' }),
      get: () => ({ root }),
      execute: async (id, command, options) => {
        const expected = commands[executed++];
        assert.equal(id, 'demo');
        assert.equal(command, expected.command);
        assert.equal(options.timeoutMs, expected.timeoutMs);
        return expected.result;
      }
    },
    completeModel: async ({ messages }) => {
      const instructions = messages[0].content;
      assert.match(instructions, /thiếu runtime\/thư viện\/phần mềm cần thiết/);
      assert.match(instructions, /không cần người dùng nhắc cài riêng/);
      assert.match(instructions, /thay thế mô tả giới hạn cũ trong lịch sử/);
      assert.equal(instructions.includes('không thay đổi cấu hình hệ điều hành, cài đặt toàn máy hoặc file ngoài dự án'), false);
      if (executed) {
        const result = messages.at(-1).content;
        assert.ok(result.includes(commands[executed - 1].result.output));
        assert.ok(result.includes(`"code":${commands[executed - 1].result.code}`));
      }
      const next = commands[executed];
      return JSON.stringify(next
        ? { type: 'tool', tool: 'run_command', reason: 'Kiểm tra và chuẩn bị môi trường để chạy main.py',
          args: { command: next.command, ...(next.timeoutMs ? { timeoutMs: next.timeoutMs } : {}) } }
        : { type: 'final', message: 'Đã cài Python, kiểm tra phiên bản và chạy main.py thành công.' });
    }
  });
  assert.equal(executed, commands.length);
  assert.match(answer, /chạy main.py thành công/);
});

test('run_command chỉ nhận timeout có giới hạn, giữ tương thích lệnh cũ', () => {
  const action = timeoutMs => JSON.stringify({ type: 'tool', tool: 'run_command', reason: 'Chờ bộ cài chương trình hoàn tất',
    args: { command: 'installer.exe', ...(timeoutMs === undefined ? {} : { timeoutMs }) } });
  assert.deepEqual(parseAction(action()).args, { command: 'installer.exe' });
  for (const timeoutMs of [1000, 600000, 900000])
    assert.equal(parseAction(action(timeoutMs)).args.timeoutMs, timeoutMs);
  for (const timeoutMs of [0, -1, 999, 900001, 1.5, '600000', null])
    assert.equal(parseAction(action(timeoutMs)), null);
});

test('Sau khi chuẩn bị runtime, Agent tự ghi và thực thi file thật thay cho lời nhắc người dùng chạy', async t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { TerritoryManager } = require('../lib/territory.cjs');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ntt-agent execute-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'project có khoảng trắng');
  fs.mkdirSync(root);
  const manager = new TerritoryManager(path.join(base, 'app-data'));
  const area = await manager.attach(root);
  const quotedNode = process.platform === 'win32'
    ? `& '${process.execPath.replaceAll("'", "''")}'`
    : `'${process.execPath.replaceAll("'", "'\\''")}'`;
  const command = `${quotedNode} ./main.cjs`;
  const handoff = 'Đã chuẩn bị runtime. Bạn có thể chạy ngay lệnh dưới đây để tạo result.txt:\n```powershell\nDO_NOT_EXECUTE_THIS_PROSE\n```';
  const replies = [
    { type: 'tool', tool: 'run_command', reason: 'Kiểm tra runtime trước khi chạy file', args: { command: `${quotedNode} --version` } },
    { type: 'final', message: handoff },
    { type: 'tool', tool: 'write_file', reason: 'Ghi script tạo kết quả của tác vụ', args: {
      path: 'main.cjs', content: "require('node:fs').writeFileSync('result.txt', 'đã chạy'); console.log('TASK_EXECUTED');" } },
    { type: 'tool', tool: 'run_command', reason: 'Thực thi script để tạo file kết quả', args: { command } },
    { type: 'tool', tool: 'read_file', reason: 'Đọc lại file kết quả vừa tạo', args: { path: 'result.txt' } },
    { type: 'final', message: 'Đã chạy main.cjs và kiểm tra result.txt.' }
  ];
  const events = [];
  let modelCalls = 0;
  const result = await runAgent({ provider: 'deepseek', mode: 'agent', prompt: 'Tạo và chạy main.cjs để xuất result.txt', territoryId: area.id }, {
    manager, emit: event => events.push(event),
    completeModel: async ({ messages }) => {
      modelCalls++;
      assert.match(messages[0].content, /Thực thi file: được phép dùng run_command/);
      if (modelCalls === 3) assert.match(messages.at(-1).content, /Không chuyển lệnh cho tôi tự chạy/);
      return JSON.stringify(replies.shift());
    }
  });
  assert.equal(result, 'Đã chạy main.cjs và kiểm tra result.txt.');
  assert.equal(fs.readFileSync(path.join(root, 'result.txt'), 'utf8'), 'đã chạy');
  assert.equal(modelCalls, 6);
  assert.equal(events.filter(event => event.type === 'status').length, 1);
  assert.equal(events.filter(event => event.type === 'final').length, 1);
  const runs = events.filter(event => event.type === 'tool' && event.tool === 'run_command');
  assert.deepEqual(runs.map(event => event.args.command), [`${quotedNode} --version`, command]);
  assert.ok(events.some(event => event.type === 'tool-result' && event.text.includes('TASK_EXECUTED')));
});

test('Lời giao chạy bằng văn bản thường cũng được yêu cầu trả tool; không chạy đoạn văn trực tiếp', async () => {
  let responses = 0, commands = 0;
  const result = await runAgent({ provider: 'gemini', mode: 'agent', prompt: 'Chạy main.py giúp tôi', territoryId: 'demo' }, {
    manager: { execute: async (_id, command) => { commands++; assert.equal(command, 'python main.py'); return { code: 0, output: 'OK' }; } },
    completeModel: async ({ messages }) => {
      responses++;
      if (responses === 1) return 'Mình không có quyền thực thi file. Bạn hãy chạy python main.py.';
      if (responses === 2) {
        assert.match(messages.at(-1).content, /quyền thực thi file bằng run_command/);
        return JSON.stringify({ type: 'tool', tool: 'run_command', reason: 'Chạy file theo yêu cầu của người dùng', args: { command: 'python main.py' } });
      }
      return JSON.stringify({ type: 'final', message: 'Đã chạy main.py, kết quả OK.' });
    }
  });
  assert.equal(commands, 1);
  assert.equal(responses, 3);
  assert.match(result, /kết quả OK/);
});

test('Chỉ hỏi cách chạy hoặc yêu cầu không thực thi thì không tự tiếp tục chạy lệnh', async () => {
  for (const [mode, prompt] of [
    ['agent', 'Chỉ hướng dẫn cách chạy main.py'],
    ['agent', 'Giải thích main.py, đừng chạy file'],
    ['agent', 'Đọc main.py, không cần tự chạy'],
    ['ask', 'Chạy main.py giúp tôi']
  ]) {
    let calls = 0;
    const message = 'Bạn có thể chạy lệnh dưới đây:\n```powershell\npython main.py\n```';
    const result = await runAgent({ provider: 'gemini', mode, prompt, territoryId: 'demo' }, {
      manager: { execute: () => { throw new Error('must not execute'); } },
      completeModel: async () => { calls++; return mode === 'ask' ? message : JSON.stringify({ type: 'final', message }); }
    });
    assert.equal(result, message);
    assert.equal(calls, 1);
  }
});

test('Lỗi thực thi thật được báo lại thay vì buộc chạy lặp', async () => {
  let commands = 0, responses = 0;
  const result = await runAgent({ provider: 'gemini', mode: 'agent', prompt: 'Chạy main.py', territoryId: 'demo' }, {
    manager: { execute: async () => { commands++; return { code: 1, output: 'Access is denied' }; } },
    completeModel: async () => JSON.stringify(++responses === 1
      ? { type: 'tool', tool: 'run_command', reason: 'Thực thi file theo yêu cầu người dùng', args: { command: 'python main.py' } }
      : { type: 'final', message: 'Lệnh báo Access is denied. Bạn có thể chạy lại sau khi sửa quyền truy cập.' })
  });
  assert.equal(commands, 1);
  assert.equal(responses, 2);
  assert.match(result, /Access is denied/);
});

test('Tài liệu lệnh đã chạy không bị nhầm thành bước chưa thực hiện', async () => {
  let commands = 0;
  const message = 'Đã chạy xong. Bạn có thể chạy lại:\n```powershell\npython main.py\n```';
  const result = await runAgent({ provider: 'gemini', mode: 'agent', prompt: 'Chạy main.py', territoryId: 'demo' }, {
    manager: { execute: async () => { commands++; return { code: 0, output: 'OK' }; } },
    completeModel: async () => JSON.stringify(commands
      ? { type: 'final', message }
      : { type: 'tool', tool: 'run_command', reason: 'Thực thi file theo yêu cầu người dùng', args: { command: 'python main.py' } })
  });
  assert.equal(commands, 1);
  assert.equal(result, message);
});

test('Nhắn tiếp kế thừa yêu cầu thực thi trước đó, câu hỏi lựa chọn vẫn dừng chờ', async () => {
  let calls = 0;
  const events = [];
  const result = await runAgent({ provider: 'gemini', mode: 'agent', prompt: 'làm tiếp đi bn', territoryId: 'demo', history: [
    { role: 'user', text: 'Chạy script để xuất kết quả' },
    { role: 'assistant', text: 'Đang chuẩn bị môi trường.' },
    { role: 'user', text: 'ok' }
  ] }, {
    manager: {}, emit: event => events.push(event), completeModel: async () => JSON.stringify(++calls === 1
      ? { type: 'final', message: 'Bạn có thể chạy script này để xuất kết quả.' }
      : { type: 'question', message: 'Bạn muốn xuất định dạng nào?', options: ['JSON', 'CSV'] })
  });
  assert.equal(result, 'Bạn muốn xuất định dạng nào?');
  assert.equal(calls, 2);
  assert.equal(events.filter(event => event.type === 'question').length, 1);
});

test('Model chỉ giao lại lệnh thì dừng sau ba lời nhắc; Dừng không tạo lượt tiếp theo', async () => {
  let calls = 0;
  await assert.rejects(runAgent({ provider: 'deepseek', mode: 'agent', prompt: 'Chạy main.py', territoryId: 'demo' }, {
    manager: {}, completeModel: async () => {
      calls++;
      return JSON.stringify({ type: 'final', message: 'Bạn có thể chạy python main.py.' });
    }
  }), /Model liên tục dừng sớm/);
  assert.equal(calls, 4);
  const controller = new AbortController();
  calls = 0;
  await assert.rejects(runAgent({ provider: 'deepseek', mode: 'agent', prompt: 'Chạy main.py', territoryId: 'demo' }, {
    manager: {}, signal: controller.signal, completeModel: async () => {
      calls++; controller.abort();
      return JSON.stringify({ type: 'final', message: 'Bạn có thể chạy python main.py.' });
    }
  }), /Đã dừng/);
  assert.equal(calls, 1);
});
