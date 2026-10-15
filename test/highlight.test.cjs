'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { languageForFile, highlight } = require('../renderer/highlight.js');

test('editor tự chọn cú pháp theo đuôi file và tô màu token cơ bản', () => {
  assert.equal(languageForFile('src/index.html'), 'html');
  assert.equal(languageForFile('src/main.py'), 'python');
  assert.equal(languageForFile('src/app.tsx'), 'javascript');
  assert.equal(languageForFile('config.json'), 'json');
  assert.equal(languageForFile('no-extension'), 'text');
  assert.match(highlight('const value = "x"; // note', 'javascript'), /tok-keyword[^>]*>const/);
  assert.match(highlight('const value = "x"; // note', 'javascript'), /tok-string[^>]*>&quot;x&quot;/);
  assert.match(highlight('# note\nprint("ok")', 'python'), /tok-comment[^>]*># note/);
  assert.match(highlight('color: #aabbcc;', 'css'), /tok-property[^>]*>color/);
});

test('nội dung code được escape, không thể chèn HTML vào editor', () => {
  const html = highlight('<script>alert("x")</script> &', 'html');
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
  assert.equal(highlight('<img src=x onerror=alert(1)>', 'text'), '&lt;img src=x onerror=alert(1)&gt;');
});
