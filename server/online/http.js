// Fetching from online food databases with a hard time limit.
//
// Every failure is turned into an OnlineError with a short reason, so the
// app can say "showing saved foods only" instead of hanging or crashing.

export class OnlineError extends Error {
  /** @param {'timeout'|'offline'|'rate_limited'|'error'} reason */
  constructor(reason) {
    super(`online source unavailable: ${reason}`);
    this.reason = reason;
  }
}

// Identifies this app to the food databases. It contains no personal details.
export const USER_AGENT = 'TuckerTally/1.0 (self-hosted personal food diary)';

/**
 * GET a JSON document. Resolves to { status, data }; a 404 is returned (not
 * thrown) because "not found" is a normal answer for a barcode lookup.
 */
export async function fetchJson(url, { timeoutMs = 5000, fetchImpl = fetch } = {}) {
  let res;
  try {
    res = await fetchImpl(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
      redirect: 'follow',
    });
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new OnlineError('timeout');
    throw new OnlineError('offline');
  }
  if (res.status === 429) throw new OnlineError('rate_limited');
  if (res.status !== 404 && !res.ok) throw new OnlineError('error');
  try {
    const data = await res.json();
    return { status: res.status, data };
  } catch (err) {
    if (err && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new OnlineError('timeout');
    if (res.status === 404) return { status: 404, data: null };
    throw new OnlineError('error');
  }
}

/** Allows at most `max` calls in any `windowMs` period. */
export function createRateLimiter(max, windowMs, now = () => Date.now()) {
  let calls = [];
  return {
    tryTake(n = 1) {
      const cutoff = now() - windowMs;
      calls = calls.filter((t) => t > cutoff);
      if (calls.length + n > max) return false;
      for (let i = 0; i < n; i++) calls.push(now());
      return true;
    },
  };
}
