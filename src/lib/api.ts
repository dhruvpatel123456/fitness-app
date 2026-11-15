// Talking to the laptop.
//
//  * Every request that changes data carries ids made on the phone, so it is
//    safe to send again. That lets this file retry automatically when the
//    connection drops, without ever creating duplicates.
//  * If the laptop cannot be reached, the app is marked "offline" (a banner
//    shows) and a background check brings it back as soon as it can.

export class ApiError extends Error {
  status: number;
  code: string;
  field?: string;
  data: Record<string, unknown>;
  constructor(status: number, data: Record<string, unknown>) {
    super(typeof data.message === 'string' ? data.message : 'Something went wrong.');
    this.status = status;
    this.code = typeof data.error === 'string' ? data.error : 'error';
    this.field = typeof data.field === 'string' ? data.field : undefined;
    this.data = data;
  }
}

/** The laptop could not be reached at all. Nothing was lost; try again. */
export class OfflineError extends Error {
  constructor() {
    super('Could not reach your laptop. Check that it is on and awake, then try again.');
  }
}

// ---- connection state --------------------------------------------------------

let online = true;
let pollTimer: number | undefined;
const listeners = new Set<() => void>();

export const connection = {
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  isOnline: () => online,
};

function setOnline(value: boolean) {
  if (online === value) return;
  online = value;
  listeners.forEach((fn) => fn());
  if (!value) startPolling();
  else stopPolling();
}

function startPolling() {
  if (pollTimer !== undefined) return;
  pollTimer = window.setInterval(async () => {
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      if (res.ok) setOnline(true);
    } catch {
      // Still unreachable; keep checking.
    }
  }, 2500);
}

function stopPolling() {
  if (pollTimer !== undefined) window.clearInterval(pollTimer);
  pollTimer = undefined;
}

// ---- signed out ---------------------------------------------------------------

const unauthorizedListeners = new Set<() => void>();
export function onUnauthorized(fn: () => void) {
  unauthorizedListeners.add(fn);
  return () => {
    unauthorizedListeners.delete(fn);
  };
}

// ---- requests ---------------------------------------------------------------------

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
const RETRY_DELAYS = [400, 1200, 2500];

export async function api<T = unknown>(method: string, path: string, body?: unknown): Promise<T> {
  // Reads are retried by the data layer; changes are retried here.
  const attempts = method === 'GET' ? 1 : RETRY_DELAYS.length + 1;
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`/api${path}`, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch {
      setOnline(false);
      if (attempt < attempts) {
        await sleep(RETRY_DELAYS[attempt - 1]);
        continue;
      }
      throw new OfflineError();
    }

    let data: Record<string, unknown> | null = null;
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      data = null;
    }

    // A gateway error without our own JSON means the app on the laptop is not answering.
    if (!res.ok && (data === null || typeof data.error !== 'string') && res.status >= 502 && res.status <= 504) {
      setOnline(false);
      if (attempt < attempts) {
        await sleep(RETRY_DELAYS[attempt - 1]);
        continue;
      }
      throw new OfflineError();
    }

    setOnline(true);
    if (!res.ok) {
      const err = new ApiError(res.status, data ?? {});
      if (res.status === 401 && err.code === 'unauthorized') unauthorizedListeners.forEach((fn) => fn());
      throw err;
    }
    return (data ?? {}) as T;
  }
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body: unknown = {}) => api<T>('POST', path, body);
export const put = <T>(path: string, body: unknown = {}) => api<T>('PUT', path, body);
export const patch = <T>(path: string, body: unknown = {}) => api<T>('PATCH', path, body);
export const del = <T>(path: string) => api<T>('DELETE', path);

/** A message fit to show a person, for any error. */
export function errorMessage(err: unknown): string {
  if (err instanceof ApiError || err instanceof OfflineError) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return 'Something went wrong.';
}
