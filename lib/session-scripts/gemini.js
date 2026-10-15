// Adapted from the user-provided NTT Code X Android Session client.
function startPrivateSession(params) {
  return (() => {
  const resultKey = params.resultKey;
  window[resultKey] = {done:false,status:'running'};
  (async () => {
    const prompt = params.prompt;
    let conversationId = params.conversationId;
    let responseId = params.responseId;
    let choiceId = params.choiceId;
    const modelHeader = params.modelHeader;
    const modelMode = params.modelMode;
    const thinkDepth = params.thinkDepth;

    function finish(value) {
      window[resultKey] = Object.assign({done:true}, value || {});
    }

    function accountPrefix() {
      const match = String(location.pathname || '').match(/^\/u\/[^/]+/);
      return match ? match[0] : '';
    }

    function randomUuid() {
      if (self.crypto && typeof self.crypto.randomUUID === 'function') {
        return self.crypto.randomUUID().toUpperCase();
      }
      let out = '';
      const pattern = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx';
      for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i];
        if (ch !== 'x' && ch !== 'y') { out += ch; continue; }
        const r = Math.floor(Math.random() * 16);
        out += (ch === 'x' ? r : ((r & 3) | 8)).toString(16);
      }
      return out.toUpperCase();
    }

    function extractMeta(html) {
      const tokenMatch = html.match(/\"(?:SNlM0e|thykhd)\":\"([^\"]+)\"/);
      const sidMatch = html.match(/\"FdrFJe\":\"([\d-]+)\"/);
      const blKeyMatch = html.match(/\"cfb2h\":\"([^\"]+)\"/);
      const blFallback = html.match(/boq_assistant-bard-web-server_[A-Za-z0-9_.-]+/);
      return {
        at: tokenMatch ? tokenMatch[1] : '',
        sid: sidMatch ? sidMatch[1] : '',
        bl: blKeyMatch ? blKeyMatch[1] : (blFallback ? blFallback[0] : '')
      };
    }

    async function fetchMeta(prefix) {
      const response = await fetch(prefix + '/app', {
        method:'GET',
        credentials:'include',
        cache:'no-store'
      });
      const html = await response.text();
      if (!response.ok) throw new Error('Gemini session metadata failed (' + response.status + ')');
      const meta = extractMeta(html);
      if (!meta.bl) throw new Error('Gemini build metadata was not found. Reload the Gemini login/session page from Settings.');
      return meta;
    }

    function buildRequest(useConversation, requestUuid) {
      const request = new Array(80).fill(null);
      request[0] = [prompt, 0, null, [], null, null, 0];
      request[1] = ['en'];
      request[2] = [
        useConversation && conversationId ? conversationId : '',
        useConversation && responseId ? responseId : '',
        useConversation && choiceId ? choiceId : '',
        null, null, null, null, null, null, ''
      ];
      request[6] = [0];
      request[7] = 1;
      request[9] = [];
      request[10] = 1;
      request[11] = 0;
      // MODE_CATEGORY from the Gemini Web frontend:
      // 1=Flash, 2=Thinking, 3=Pro, 4=Auto, 6=Flash-Lite.
      // Field 17 controls thinking depth (0 deepest, 4 shallow/default).
      request[17] = [[thinkDepth]];
      request[18] = 0;
      request[27] = 1;
      request[30] = [4];
      request[41] = [2];
      request[53] = 0;
      request[59] = requestUuid;
      request[61] = [];
      request[68] = 1;
      request[79] = modelMode;
      return request;
    }

    function collectResponseParts(value, out) {
      if (!Array.isArray(value)) return;
      if (value.length >= 3 && value[0] === 'wrb.fr' && typeof value[2] === 'string') {
        try {
          const parsed = JSON.parse(value[2]);
          if (Array.isArray(parsed)) out.push(parsed);
        } catch (_) {}
      }
      for (const child of value) {
        if (Array.isArray(child)) collectResponseParts(child, out);
      }
    }

    function responseText(part) {
      if (!Array.isArray(part) || !Array.isArray(part[4])) return '';
      const snapshots = [];
      for (const item of part[4]) {
        if (!Array.isArray(item) || item.length < 2) continue;
        const values = item[1];
        if (typeof values === 'string') snapshots.push(values);
        else if (Array.isArray(values)) {
          for (const value of values) if (typeof value === 'string') snapshots.push(value);
        }
      }
      return snapshots.length ? snapshots[snapshots.length - 1] : '';
    }

    function parseStream(raw) {
      const parts = [];
      for (const line of String(raw || '').split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(")]}'")) continue;
        try {
          const outer = JSON.parse(trimmed);
          collectResponseParts(outer, parts);
        } catch (_) {}
      }

      let selected = null;
      let text = '';
      for (let i = parts.length - 1; i >= 0; i--) {
        const candidateText = responseText(parts[i]);
        if (candidateText) {
          selected = parts[i];
          text = candidateText;
          break;
        }
      }
      if (!selected && parts.length) selected = parts[parts.length - 1];

      let cid = null, rid = null, rcid = null;
      try {
        if (selected && Array.isArray(selected[1])) {
          cid = selected[1][0] == null ? null : String(selected[1][0]);
          rid = selected[1][1] == null ? null : String(selected[1][1]);
        }
        if (selected && Array.isArray(selected[4]) && Array.isArray(selected[4][0])) {
          rcid = selected[4][0][0] == null ? null : String(selected[4][0][0]);
        }
      } catch (_) {}
      const routedModel = typeof selected?.[42] === 'string' ? selected[42] : '';
      return {text:text,cid:cid,rid:rid,rcid:rcid,routedModel:routedModel};
    }

    async function runOnce(meta, prefix, useConversation, includeModelHeader = true) {
      const requestUuid = randomUuid();
      const query = new URLSearchParams({
        bl:meta.bl,
        hl:'en',
        _reqid:String(Math.floor(100000 + Math.random() * 900000)),
        rt:'c'
      });
      if (meta.sid) query.set('f.sid', meta.sid);

      const form = new URLSearchParams();
      form.set('f.req', JSON.stringify([null, JSON.stringify(buildRequest(useConversation, requestUuid))]));
      if (meta.at) form.set('at', meta.at);

      const headers = {
        'content-type':'application/x-www-form-urlencoded;charset=utf-8',
        'x-same-domain':'1',
        'x-goog-ext-525005358-jspb':JSON.stringify([requestUuid,1])
      };
      if (includeModelHeader && modelHeader) {
        headers['x-goog-ext-525001261-jspb'] = modelHeader;
        headers['x-goog-ext-73010989-jspb'] = '[0]';
        headers['x-goog-ext-73010990-jspb'] = '[0]';
      }

      const response = await fetch(
        prefix + '/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate?' + query.toString(),
        {
          method:'POST',
          credentials:'include',
          headers:headers,
          body:form.toString()
        }
      );
      const raw = await response.text();
      return {response:response,raw:raw,parsed:parseStream(raw)};
    }

    try {
      if (String(location.host || '').toLowerCase() !== 'gemini.google.com') {
        finish({status:'not_ready',message:'Gemini login page is not loaded.'});
        return;
      }

      const prefix = accountPrefix();
      let meta = await fetchMeta(prefix);
      const hadConversation = !!(conversationId && responseId && choiceId);
      let run = await runOnce(meta, prefix, hadConversation);

      // Conversation ids can expire or belong to a previous Google
      // account. Retry once stateless before surfacing the failure.
      if ((!run.response.ok || !run.parsed.text) && hadConversation) {
        conversationId = null;
        responseId = null;
        choiceId = null;
        if (run.response.status === 400) meta = await fetchMeta(prefix);
        run = await runOnce(meta, prefix, false, true);
      }

      // Model headers are private and can change between Gemini Web builds.
      // If Google's current account rejects a cached header, retry once using
      // the mode-category field alone instead of failing the whole chat.
      if ((!run.response.ok || !run.parsed.text) && modelHeader && modelMode !== 8) {
        conversationId = null;
        responseId = null;
        choiceId = null;
        run = await runOnce(meta, prefix, false, false);
      }

      if (!run.response.ok) {
        const authError = run.response.status === 401 || run.response.status === 403;
        finish({
          status:authError ? 'not_ready' : 'error',
          message:'Gemini private API ' + run.response.status + ': ' + run.raw.slice(0,700)
        });
        return;
      }

      if (!run.parsed.text || !run.parsed.text.trim()) {
        finish({
          status:'error',
          message:'Gemini private API returned no answer text. Reload the Gemini login/session page from Settings and try again. Raw: ' + run.raw.slice(0,500)
        });
        return;
      }

      // Gemini can silently route an account without Argon access to Flash.
      if (modelMode === 8 && /flash|gemini[- ]?3/i.test(run.parsed.routedModel)) {
        finish({status:'error',message:'Gemini đã chuyển yêu cầu Argon sang ' +
          run.parsed.routedModel + '. Kiểm tra quyền Argon trên tài khoản Gemini đang đăng nhập.'});
        return;
      }

      if (run.parsed.cid) conversationId = run.parsed.cid;
      if (run.parsed.rid) responseId = run.parsed.rid;
      if (run.parsed.rcid) choiceId = run.parsed.rcid;

      finish({
        status:'ok',
        text:run.parsed.text,
        conversationId:conversationId || '',
        responseId:responseId || '',
        choiceId:choiceId || ''
      });
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error);
      const loginLike = /login|sign.?in|account|auth|metadata/i.test(message);
      finish({status:loginLike ? 'not_ready' : 'error',message:message});
    }
  })();
  return 'started';
})();
}
