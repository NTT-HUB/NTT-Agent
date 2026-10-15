'use strict';

const NTTHighlight = (() => {
  const extensions = Object.freeze({
    js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
    ts: 'javascript', tsx: 'javascript', json: 'json', jsonc: 'json',
    py: 'python', html: 'html', htm: 'html', xml: 'html', svg: 'html',
    css: 'css', scss: 'css', php: 'php', lua: 'lua',
    sh: 'shell', bash: 'shell', md: 'markdown', markdown: 'markdown',
    sql: 'sql'
  });
  const labels = Object.freeze({ javascript: 'JavaScript / TypeScript', json: 'JSON',
    python: 'Python', html: 'HTML / XML', css: 'CSS', php: 'PHP',
    lua: 'Lua', shell: 'Shell', markdown: 'Markdown', sql: 'SQL', text: 'Text' });
  const quote = String.raw`"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'`;
  const triple = String.raw`"""[\s\S]*?"""|'''[\s\S]*?'''|` + quote;
  const template = String.raw`\x60(?:\\.|[^\x60\\])*\x60|` + quote;
  const number = String.raw`\b(?:0x[0-9a-fA-F]+|\d+(?:\.\d+)?)\b`;
  const words = list => String.raw`\b(?:` + list.join('|') + String.raw`)\b`;
  const grammars = {
    javascript: {
      comment: String.raw`\/\/[^\n]*|\/\*[\s\S]*?\*\/`,
      string: template,
      keyword: words(['async','await','break','case','catch','class','const','continue','debugger','default','delete','do','else','export','extends','false','finally','for','from','function','if','import','in','instanceof','interface','let','new','null','of','return','static','super','switch','this','throw','true','try','typeof','undefined','var','void','while','yield']),
      number
    },
    json: {
      property: String.raw`"(?:\\.|[^"\\])*"(?=\s*:)`,
      string: String.raw`"(?:\\.|[^"\\])*"`,
      keyword: words(['true','false','null']), number
    },
    python: {
      comment: String.raw`#[^\n]*`, string: triple,
      keyword: words(['and','as','assert','async','await','break','class','continue','def','del','elif','else','except','False','finally','for','from','global','if','import','in','is','lambda','None','nonlocal','not','or','pass','raise','return','True','try','while','with','yield','self']), number
    },
    html: {
      comment: String.raw`<!--[\s\S]*?-->`,
      tag: String.raw`<\/?[A-Za-z][^>]*?>|<\?[^>]*\?>|<![^>]*>`,
      keyword: String.raw`&(?:[A-Za-z]+|#\d+);`
    },
    css: {
      comment: String.raw`\/\*[\s\S]*?\*\/`, string: quote,
      property: String.raw`(?:--)?[A-Za-z][\w-]*(?=\s*:)`,
      number: String.raw`#[0-9a-fA-F]{3,8}\b|\b\d+(?:\.\d+)?(?:px|em|rem|vh|vw|%|s|ms)?\b`,
      keyword: words(['important','inherit','initial','unset','none','auto','flex','grid','block','inline'])
    },
    php: {
      comment: String.raw`\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/`,
      string: quote,
      keyword: words(['abstract','array','as','break','case','catch','class','const','continue','declare','default','do','echo','else','elseif','extends','false','final','finally','for','foreach','function','if','implements','include','interface','namespace','new','null','private','protected','public','require','return','static','switch','throw','trait','true','try','use','while']), number
    },
    lua: {
      comment: String.raw`--\[\[[\s\S]*?\]\]|--[^\n]*`,
      string: String.raw`\[\[[\s\S]*?\]\]|` + quote,
      keyword: words(['and','break','do','else','elseif','end','false','for','function','goto','if','in','local','nil','not','or','repeat','return','then','true','until','while']), number
    },
    shell: {
      comment: String.raw`#[^\n]*`, string: quote,
      keyword: words(['case','do','done','elif','else','esac','export','fi','for','function','if','in','local','return','then','while']), number
    },
    markdown: {
      tag: String.raw`^#{1,6}[^\n]*|^>[^\n]*`,
      string: String.raw`\x60[^\x60\n]+\x60`,
      keyword: String.raw`\[[^\]\n]+\]\([^\)\n]+\)`
    },
    sql: {
      comment: String.raw`--[^\n]*|\/\*[\s\S]*?\*\/`, string: quote,
      keyword: words(['SELECT','FROM','WHERE','INSERT','INTO','UPDATE','DELETE','CREATE','ALTER','TABLE','JOIN','LEFT','RIGHT','INNER','OUTER','ON','AS','AND','OR','NOT','NULL','ORDER','BY','GROUP','LIMIT','VALUES','SET','PRIMARY','KEY','DISTINCT']), number
    }
  };
  const patterns = Object.fromEntries(Object.entries(grammars).map(([language, rules]) =>
    [language, new RegExp(Object.entries(rules).map(([type, pattern]) => `(?<${type}>${pattern})`).join('|'),
      language === 'markdown' ? 'gm' : language === 'sql' ? 'gi' : 'g')]));
  const escape = text => String(text).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);

  function languageForFile(filename) {
    const extension = String(filename || '').split('/').pop().split('\\').pop().split('.').pop().toLowerCase();
    return extensions[extension] || 'text';
  }

  function highlight(source, language) {
    const input = String(source || '');
    const pattern = patterns[language];
    if (!pattern) return escape(input);
    // Keep typing responsive for very large files while showing their full text.
    const head = input.slice(0, 180000);
    pattern.lastIndex = 0;
    let cursor = 0, html = '';
    for (const match of head.matchAll(pattern)) {
      html += escape(head.slice(cursor, match.index));
      const type = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
      html += `<span class="tok-${type}">${escape(match[0])}</span>`;
      cursor = match.index + match[0].length;
    }
    return html + escape(head.slice(cursor)) + escape(input.slice(head.length));
  }

  return { languageForFile, highlight, labels };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = NTTHighlight;
else window.NTTHighlight = NTTHighlight;
