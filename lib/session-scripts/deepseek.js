// Port of DeepSeekPrivateSessionClient.kt from the uploaded NTT Code X 0.6.55.
// Keep the wire headers/body aligned with the mobile client. Responses are read
// by the desktop decoder so provider toast/hint errors are not discarded.
function startPrivateSession(params) {
  return (() => {
  const resultKey = params.resultKey;
  window[resultKey] = {done:false,status:'running'};
  (async () => {
    const record = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
    const clientHeaders = {
      'x-client-platform': 'web',
      'x-client-version': '2.2.0',
      'x-client-locale': 'zh_CN',
      'x-client-bundle-id': 'com.deepseek.chat'
    };
    const completionPath = '/api/v0/chat/completion';
    const powWorkerUrl = params.powWorkerUrl;
    const prompt = params.prompt;
    const thinkingEnabled = params.thinkingEnabled;
    const searchEnabled = params.searchEnabled;
    let sessionId = params.sessionId;
    let parentMessageId = params.parentMessageId;

    function finish(value) {
      window[resultKey] = Object.assign({done:true}, value || {});
    }

    function readToken() {
      const raw = localStorage.getItem('userToken');
      if (!raw) return '';
      try {
        const parsed = JSON.parse(raw);
        if (record(parsed) && typeof parsed.value === 'string') return parsed.value;
        if (typeof parsed === 'string') return parsed;
      } catch (_) {}
      return raw;
    }

    async function jsonOrText(response) {
      const text = await response.text();
      try { return JSON.parse(text); } catch (_) { return {raw:text}; }
    }

    async function createSession(authHeaders) {
      const response = await fetch('/api/v0/chat_session/create', {
        method:'POST', headers:authHeaders, body:'{}', credentials:'include'
      });
      const body = await jsonOrText(response);
      const session = body && body.data && body.data.biz_data && body.data.biz_data.chat_session;
      const id = session && session.id;
      if (!response.ok || !id) throw new Error('session create failed (' + response.status + ')');
      return String(id);
    }

    async function solvePow(authHeaders) {
      const response = await fetch('/api/v0/chat/create_pow_challenge', {
        method:'POST',
        headers:authHeaders,
        body:JSON.stringify({target_path:completionPath}),
        credentials:'include'
      });
      const body = await jsonOrText(response);
      const challenge = body && body.data && body.data.biz_data && body.data.biz_data.challenge;
      if (!response.ok || !challenge) throw new Error('pow challenge failed (' + response.status + ')');

      const workerResponse = await fetch(powWorkerUrl, {credentials:'omit'});
      if (!workerResponse.ok) throw new Error('pow worker fetch failed (' + workerResponse.status + ')');
      const workerSource = await workerResponse.text();
      const workerUrl = URL.createObjectURL(new Blob([workerSource], {type:'application/javascript'}));
      try {
        const answer = await new Promise((resolve, reject) => {
          const worker = new Worker(workerUrl);
          const timer = setTimeout(() => {
            worker.terminate();
            reject(new Error('pow timeout'));
          }, 120000);
          worker.onmessage = (event) => {
            clearTimeout(timer);
            worker.terminate();
            const message = record(event.data) ? event.data : null;
            const value = message && record(message.answer) ? message.answer : null;
            if (message && message.type === 'pow-answer' && value) resolve(value);
            else reject(new Error('pow failed'));
          };
          worker.onerror = (event) => {
            clearTimeout(timer);
            worker.terminate();
            reject(new Error(event.message || 'pow worker error'));
          };
          worker.postMessage({
            type:'pow-challenge',
            challenge:{
              algorithm:challenge.algorithm,
              challenge:challenge.challenge,
              salt:challenge.salt,
              difficulty:challenge.difficulty,
              signature:challenge.signature,
              expireAt:challenge.expire_at
            }
          });
        });
        const payload = JSON.stringify({
          algorithm:answer.algorithm,
          challenge:answer.challenge,
          salt:answer.salt,
          answer:answer.answer,
          signature:answer.signature,
          target_path:completionPath
        });
        const bytes = new TextEncoder().encode(payload);
        let binary = '';
        for (const b of bytes) binary += String.fromCharCode(b);
        return btoa(binary);
      } finally {
        URL.revokeObjectURL(workerUrl);
      }
    }

    async function completeOnce(token, reuseSession) {
      const authHeaders = Object.assign({
        authorization:'Bearer ' + token,
        'content-type':'application/json',
        accept:'text/event-stream'
      }, clientHeaders);

      if (!reuseSession || !sessionId) {
        sessionId = await createSession(authHeaders);
        parentMessageId = null;
      }
      const pow = await solvePow(authHeaders);
      const headers = Object.assign({}, authHeaders, {'x-ds-pow-response':pow});
      const response = await fetch(completionPath, {
        method:'POST',
        headers,
        credentials:'include',
        body:JSON.stringify({
          chat_session_id:sessionId,
          parent_message_id:parentMessageId,
          model_type:'default',
          prompt,
          ref_file_ids:[],
          thinking_enabled:thinkingEnabled,
          search_enabled:searchEnabled,
          action:null,
          preempt:false
        })
      });
      const raw = await response.text();
      return {response, raw};
    }

    try {
      if (location.host !== 'chat.deepseek.com') {
        finish({status:'not_ready',message:'DeepSeek login page is not loaded.'});
        return;
      }
      const token = readToken();
      if (!token) {
        finish({status:'not_ready',message:'DeepSeek userToken is missing. Login again.'});
        return;
      }

      const hadSavedSession = Boolean(sessionId);
      let run = await completeOnce(token, true);
      let recovered = false;
      if (!run.response.ok && ![401, 403].includes(run.response.status)) {
        // A saved conversation can disappear if it was deleted/expired on the
        // website. Retry once with a brand-new DeepSeek chat session.
        sessionId = null;
        parentMessageId = null;
        run = await completeOnce(token, false);
        recovered = true;
      }

      if (!run.response.ok) {
        const authError = run.response.status === 401 || run.response.status === 403;
        let detail = run.raw.slice(0, 500);
        try { const errorBody = JSON.parse(run.raw); detail = String(errorBody.message || errorBody.msg || errorBody.error?.message || detail); }
        catch (_) {}
        finish({
          status:authError ? 'not_ready' : 'error',
          message:'DeepSeek private API ' + run.response.status + ': ' + detail
        });
        return;
      }

      let parsed;
      try { parsed = parseDeepSeekResponse(run.raw); }
      catch (error) {
        if (recovered || (!error.refreshPow && !(hadSavedSession && error.resetConversation))) throw error;
        // Recover once only when DeepSeek explicitly identifies the failed
        // proof or invalid conversation. Do not replay an unknown refusal.
        if (error.resetConversation) { sessionId = null; parentMessageId = null; }
        run = await completeOnce(token, !error.resetConversation);
        if (!run.response.ok) throw new Error('DeepSeek private API ' + run.response.status + ' khi phục hồi yêu cầu.');
        parsed = parseDeepSeekResponse(run.raw);
      }
      if (parsed.responseMessageId != null) parentMessageId = parsed.responseMessageId;
      finish({
        status:'ok',
        text:parsed.text,
        sessionId:String(sessionId || ''),
        parentMessageId:parentMessageId == null ? null : String(parentMessageId)
      });
    } catch (error) {
      const message = error && error.message ? String(error.message) : String(error);
      finish({status:error?.notReady ? 'not_ready' : 'error',message,
        reason:error?.reason || '', retryable:error?.retryable === true});
    }
  })();
  return 'started';
})();
}
