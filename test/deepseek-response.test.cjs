'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDeepSeekResponse } = require('../lib/deepseek-response.cjs');

const sse = (...values) => values.map(value => `data: ${JSON.stringify(value)}\n\n`).join('');

test('Đọc response/content và delta nén, giữ khoảng trắng và ID hội thoại', () => {
  const raw = 'event: ready\ndata: {"response_message_id":23}\n\n' + sse(
    { p: 'response/content', o: 'APPEND', v: 'Xin' },
    { v: ' ' }, { v: { text: 'chào' } }, { v: { content: ' bạn' } },
    { p: 'response/status', o: 'SET', v: 'FINISHED' });
  assert.deepEqual(parseDeepSeekResponse(raw), { text: 'Xin chào bạn', responseMessageId: 23 });
});

test('Đọc chỉ số fragment và thao tác không có o; không trộn phần suy nghĩ/tìm kiếm vào câu trả lời', () => {
  const raw = sse(
    { v: { response: { message_id: 7, fragments: [{ type: 'THINK', content: 'Suy nghĩ riêng' }] } } },
    { p: 'response/fragments', o: 'APPEND', v: [
      { type: 'TOOL_SEARCH', content: 'Dữ liệu công cụ' }, { type: 'RESPONSE', content: 'Kết' }
    ] },
    { p: 'response/fragments/2/content', v: ' quả' },
    { v: ' ' },
    { p: 'response/fragments/-1/content', v: { text: 'đúng' } },
    { p: 'response/fragments/-2/results', o: 'APPEND', v: [{ title: 'Tiêu đề tìm kiếm' }] },
    { p: 'response/status', v: 'FINISHED' });
  assert.deepEqual(parseDeepSeekResponse(raw), { text: 'Kết quả đúng', responseMessageId: 7 });
});

test('BATCH ghép đường dẫn tương đối, thay nội dung và bỏ qua metadata', () => {
  const raw = sse({ p: 'response', o: 'BATCH', v: [
    { p: 'message_id', v: 0 },
    { p: 'fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: 'bản cũ' }] },
    { p: 'fragments/0', o: 'BATCH', v: [{ p: 'content', o: 'SET', v: 'bản mới' }] },
    { p: 'fragments/-1/content', o: 'APPEND', v: ' hoàn chỉnh' },
    { p: 'accumulated_token_usage', v: 123 },
    { p: 'status', o: 'SET', v: 'FINISHED' }
  ] });
  assert.deepEqual(parseDeepSeekResponse(raw), { text: 'bản mới hoàn chỉnh', responseMessageId: 0 });
});

test('Snapshot thay dữ liệu cũ, không lặp nội dung khi nhận lại toàn bộ câu trả lời', () => {
  const raw = sse(
    { v: { response: { fragments: [{ type: 'RESPONSE', content: 'Một' }] } } },
    { v: ' phần' },
    { v: { response: { fragments: [{ type: 'RESPONSE', content: 'Một phần hoàn chỉnh' }] } } },
    { p: 'response/status', v: 'FINISHED' });
  assert.equal(parseDeepSeekResponse(raw).text, 'Một phần hoàn chỉnh');
});

test('TIP cuối luồng không có o kế thừa APPEND, giữ nguyên câu trả lời trước đó', () => {
  const raw = sse(
    { v: { response: { fragments: [{ type: 'THINK', content: 'Suy nghĩ' }] } } },
    { p: 'response/fragments', o: 'APPEND', v: [{ type: 'RESPONSE', content: '##' }] },
    { p: 'response/fragments/-1/content', v: ' Kết quả' },
    { v: '\n\nNội dung đầy đủ.' },
    { p: 'response/fragments', v: [{ type: 'TIP', content: 'Thông báo từ trang' }] },
    { p: 'response', o: 'BATCH', v: [{ p: 'quasi_status', v: 'FINISHED' }] },
    { p: 'response/status', o: 'SET', v: 'FINISHED' });
  assert.equal(parseDeepSeekResponse(raw).text, '## Kết quả\n\nNội dung đầy đủ.');
});

test('Nhận JSON thành công ngoài SSE và message_id bằng 0', () => {
  const raw = JSON.stringify({ code: 0, data: { biz_code: 0, biz_data: {
    response: { message_id: 0, content: 'Xin chào' }
  } } });
  assert.deepEqual(parseDeepSeekResponse(raw), { text: 'Xin chào', responseMessageId: 0 });
});

test('Lỗi nghiệp vụ trong HTTP 200 và lỗi stream được báo đúng thay vì báo không có câu trả lời', () => {
  assert.throws(() => parseDeepSeekResponse(JSON.stringify({ code: 0, data: {
    biz_code: 101, biz_msg: 'Search temporarily unavailable'
  } })), /Search temporarily unavailable.*101/);
  assert.throws(() => parseDeepSeekResponse('event: error\ndata: {"message":"Server busy"}\n\n'), /Server busy/);
  assert.throws(() => parseDeepSeekResponse(sse({ code: '403', msg: 'Login expired' })),
    error => /Login expired/.test(error.message) && error.notReady === true);
});

test('SSE hỗ trợ BOM, CRLF, nhiều dòng data, heartbeat và gói cuối không có dòng trống', () => {
  const raw = '\uFEFF: ping\r\n\r\nevent: message\r\ndata: {"p":"response/content",\r\ndata: "v":"a  b"}\r\n\r\n' +
    'event: title\r\ndata: {"v":"không phải câu trả lời"}\r\n\r\ndata: [DONE]';
  assert.equal(parseDeepSeekResponse(raw).text, 'a  b');
});

test('Không dùng phần suy nghĩ hoặc metadata tìm kiếm làm câu trả lời cho Agent', () => {
  assert.throws(() => parseDeepSeekResponse(sse({ v: { response: {
    fragments: [{ type: 'THINK', content: '{"tool":"write_file"}' }]
  } } })), /chỉ nhận được phần suy nghĩ/);
  assert.throws(() => parseDeepSeekResponse(sse({ p: 'response/fragments', v: [
    { type: 'TOOL_SEARCH', content: 'search text' }
  ] })), /không nhận được nội dung trả lời/);
});

test('Không dùng câu trả lời dở dang khi JSON bị cắt hoặc máy chủ báo chưa hoàn tất', () => {
  assert.throws(() => parseDeepSeekResponse(sse({ v: 'dở dang' }) + 'data: {"v":"thiếu'), /bị cắt/);
  assert.throws(() => parseDeepSeekResponse(sse(
    { p: 'response/content', v: 'dở dang' }, { p: 'response/status', v: 'INCOMPLETE' }
  )), /chưa hoàn tất/);
});

test('Tôn trọng CONTENT_FILTER và trả template của máy chủ nếu có', () => {
  const previous = { v: { response: { fragments: [{ type: 'RESPONSE', content: 'Nội dung trước' }] } } };
  assert.throws(() => parseDeepSeekResponse(sse(previous, { p: 'response/status', v: 'CONTENT_FILTER' })), /CONTENT_FILTER/);
  const replacement = { v: [
    { p: 'status', v: 'CONTENT_FILTER' },
    { p: 'fragments', v: [{ type: 'TEMPLATE_RESPONSE', content: 'Không thể trả lời yêu cầu này.' }] }
  ] };
  assert.equal(parseDeepSeekResponse(sse(previous, replacement)).text, 'Không thể trả lời yêu cầu này.');
});

test('Phản hồi rỗng hoặc đổi schema chỉ ghi cấu trúc, không lộ giá trị dữ liệu', () => {
  assert.throws(() => parseDeepSeekResponse(''), /0 gói/);
  assert.throws(() => parseDeepSeekResponse(sse({ p: 'response/unknown', v: 'PRIVATE_VALUE' })),
    error => /response\/unknown/.test(error.message) && !error.message.includes('PRIVATE_VALUE'));
});

test('Ba gói update_session/toast/close phải hiện lý do của DeepSeek thay vì báo thiếu nội dung', () => {
  const raw = 'event: update_session\ndata: {"updated_at":1}\n\n' +
    'event: toast\ndata: {"type":"error","content":"Client version is out of date","finish_reason":"CLIENT_VERSION_UNSUPPORTED"}\n\n' +
    'event: close\ndata: {"click_behavior":"none"}\n\n';
  assert.throws(() => parseDeepSeekResponse(raw), error =>
    /Client version is out of date/.test(error.message) && /CLIENT_VERSION_UNSUPPORTED/.test(error.message) &&
    !/không nhận được nội dung/.test(error.message));
});

test('Hint xóa phản hồi phải dừng Agent dù trước đó đã nhận được nội dung', () => {
  const raw = sse({ p: 'response/content', o: 'APPEND', v: '{"tool":"write_file"}' }) +
    'event: hint\ndata: {"type":"warning","content":"Request was blocked","clear_response":true,"finish_reason":"CONTENT_FILTER"}\n\n';
  assert.throws(() => parseDeepSeekResponse(raw), /Request was blocked.*CONTENT_FILTER/);
});

test('Toast cảnh báo không kết thúc không làm mất câu trả lời hợp lệ', () => {
  const raw = 'event: toast\ndata: {"type":"warning","content":"Search used fewer sources"}\n\n' +
    sse({ p: 'response/content', o: 'APPEND', v: 'Câu trả lời' });
  assert.equal(parseDeepSeekResponse(raw).text, 'Câu trả lời');
});

test('Nhận lỗi trong v/response và chỉ phục hồi đúng nguyên nhân máy chủ xác nhận', () => {
  assert.throws(() => parseDeepSeekResponse(sse({ v: { response: {
    error_code: 401, error_message: 'Login expired'
  } } })), error => /Login expired/.test(error.message) && error.notReady);
  for (const [reason, flag] of [['INVALID_SESSION_ID', 'resetConversation'], ['INVALID_POW_RESPONSE', 'refreshPow']]) {
    const raw = `event: toast\ndata: ${JSON.stringify({ type: 'error', content: reason, finish_reason: reason })}\n\n`;
    assert.throws(() => parseDeepSeekResponse(raw), error => error[flag] === true);
  }
});

test('Thông báo phản hồi rỗng ghi tên từng gói và khóa, giữ kín giá trị', () => {
  const raw = 'event: ready\ndata: {"response_message_id":99999,"request_message_id":88888}\n\n' +
    'event: unexpected\ndata: {"v":{"secret":"PRIVATE_SECRET_VALUE"}}\n\n' +
    'event: close\ndata: {"click_behavior":"retry"}\n\n';
  assert.throws(() => parseDeepSeekResponse(raw), error =>
    /3 gói/.test(error.message) && /ready\{/.test(error.message) && /unexpected\{v\} v\{secret\}/.test(error.message) &&
    /close\{/.test(error.message) && !/PRIVATE_SECRET_VALUE|99999|88888/.test(error.message));
});
