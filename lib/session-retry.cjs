'use strict';

const MAX_ATTEMPTS = 3;

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('Đã dừng.'));
    const timer = setTimeout(done, ms);
    function done() { signal?.removeEventListener('abort', abort); resolve(); }
    function abort() { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new Error('Đã dừng.')); }
    signal?.addEventListener('abort', abort, { once: true });
  });
}

async function retrySessionFetch(call, { signal, onRetry = () => {}, delays = [400, 1000] } = {}) {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw new Error('Đã dừng.');
    try { return await call(); }
    catch (error) {
      if (signal?.aborted) throw new Error('Đã dừng.');
      const retryable = /\bfailed to fetch\b/i.test(String(error?.message || error)) ||
        (['backend_err', 'generation_err'].includes(error?.code) && error?.retryable === true);
      if (!retryable || attempt === MAX_ATTEMPTS)
        throw error;
      onRetry(attempt + 1, MAX_ATTEMPTS, error);
      await wait(delays[attempt - 1], signal);
    }
  }
}

module.exports = { retrySessionFetch, MAX_ATTEMPTS };
