// PIN / password login.
//
//  * The PIN is stored only as a bcrypt hash.
//  * A session is a random token in a long-lived httpOnly cookie. Only the
//    SHA-256 of the token is stored, so the database never holds a usable
//    session value.
//  * Wrong guesses are rate limited per address and overall.

import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import express from 'express';
import { HttpError, invalid, nowIso, vObj } from './util.js';

export const COOKIE_NAME = 'tt_session';

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_ADDRESS = 5;
const MAX_FAILS_OVERALL = 25;

/** Counts recent failed logins and decides when to refuse further attempts. */
export function createLoginLimiter({ now = () => Date.now() } = {}) {
  const fails = new Map(); // key -> [timestamps]

  function recent(key) {
    const cutoff = now() - WINDOW_MS;
    const list = (fails.get(key) || []).filter((t) => t > cutoff);
    if (list.length) fails.set(key, list);
    else fails.delete(key);
    return list;
  }

  function retryAfter(list, max) {
    if (list.length < max) return 0;
    const oldestCounted = list[list.length - max];
    return Math.max(1, Math.ceil((oldestCounted + WINDOW_MS - now()) / 1000));
  }

  return {
    /** Seconds to wait before another attempt is allowed (0 = allowed now). */
    blockedFor(address) {
      return Math.max(
        retryAfter(recent(`a:${address}`), MAX_FAILS_PER_ADDRESS),
        retryAfter(recent('all'), MAX_FAILS_OVERALL),
      );
    },
    fail(address) {
      for (const key of [`a:${address}`, 'all']) {
        const list = recent(key);
        list.push(now());
        fails.set(key, list);
      }
    },
    attemptsLeft(address) {
      return Math.max(0, MAX_FAILS_PER_ADDRESS - recent(`a:${address}`).length);
    },
    succeed(address) {
      fails.delete(`a:${address}`);
    },
  };
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function vPin(v, field = 'pin') {
  if (typeof v !== 'string') throw invalid(field, 'Enter a PIN or password');
  if (v.length < 4) throw invalid(field, 'Use at least 4 characters');
  if (v.length > 72) throw invalid(field, 'Use at most 72 characters');
  return v;
}

export function createAuth({ db, config, limiter = createLoginLimiter() }) {
  const sessionSeconds = config.sessionDays * 86400;

  const getHash = () => db.prepare('SELECT pin_hash FROM auth WHERE id = 1').get()?.pin_hash ?? null;
  const isSetUp = () => getHash() !== null;

  function setCookie(req, res, value, maxAgeSeconds) {
    const parts = [`${COOKIE_NAME}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAgeSeconds}`];
    // `req.secure` is true over HTTPS, including behind `tailscale serve`.
    if (req.secure) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  function createSession(req, res) {
    const token = crypto.randomBytes(32).toString('base64url');
    const now = new Date();
    db.prepare(
      'INSERT INTO sessions (token_hash, created_at, last_seen_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)',
    ).run(
      hashToken(token),
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + sessionSeconds * 1000).toISOString(),
      String(req.get('user-agent') || '').slice(0, 300),
    );
    setCookie(req, res, token, sessionSeconds);
  }

  /** The valid session for this request, or null. Keeps active sessions alive. */
  function currentSession(req, res) {
    const token = readCookie(req, COOKIE_NAME);
    if (!token || token.length > 200) return null;
    const tokenHash = hashToken(token);
    const row = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
    if (!row) return null;
    const now = new Date();
    if (row.expires_at <= now.toISOString()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
      return null;
    }
    // Once a day, push the expiry out again so a session in regular use never ends.
    if (now.getTime() - Date.parse(row.last_seen_at) > 86400000) {
      db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?').run(
        now.toISOString(),
        new Date(now.getTime() + sessionSeconds * 1000).toISOString(),
        tokenHash,
      );
      if (res) setCookie(req, res, token, sessionSeconds);
    }
    return row;
  }

  function requireAuth(req, res, next) {
    const session = currentSession(req, res);
    if (!session) {
      res.status(401).json({ error: 'unauthorized', message: 'Please log in.', setup_required: !isSetUp() });
      return;
    }
    req.session = session;
    next();
  }

  /** Check a PIN with rate limiting. Throws an HttpError when wrong or blocked. */
  async function checkPin(req, pin) {
    const address = req.ip || 'unknown';
    const wait = limiter.blockedFor(address);
    if (wait > 0) {
      throw new HttpError(429, 'rate_limited', `Too many wrong attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`, {
        retry_after_s: wait,
      });
    }
    const hash = getHash();
    const ok = hash ? await bcrypt.compare(pin, hash) : false;
    if (!ok) {
      limiter.fail(address);
      throw new HttpError(401, 'wrong_pin', 'That PIN is not right.', { attempts_left: limiter.attemptsLeft(address) });
    }
    limiter.succeed(address);
  }

  const router = express.Router();

  router.get('/status', (req, res) => {
    res.json({ setup: isSetUp(), authed: Boolean(currentSession(req, res)) });
  });

  // First run only: choose the PIN.
  router.post('/setup', async (req, res) => {
    const body = vObj(req.body);
    const pin = vPin(body.pin);
    if (isSetUp()) throw new HttpError(409, 'already_set_up', 'A PIN has already been set. Log in instead.');
    const hash = await bcrypt.hash(pin, config.bcryptRounds);
    const result = db
      .prepare('INSERT OR IGNORE INTO auth (id, pin_hash, updated_at) VALUES (1, ?, ?)')
      .run(hash, nowIso());
    if (result.changes === 0) throw new HttpError(409, 'already_set_up', 'A PIN has already been set. Log in instead.');
    createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/login', async (req, res) => {
    const body = vObj(req.body);
    if (typeof body.pin !== 'string' || body.pin.length === 0 || body.pin.length > 72) {
      throw invalid('pin', 'Enter your PIN');
    }
    if (!isSetUp()) throw new HttpError(409, 'not_set_up', 'No PIN has been set yet.');
    await checkPin(req, body.pin);
    createSession(req, res);
    res.json({ ok: true });
  });

  router.post('/logout', (req, res) => {
    const token = readCookie(req, COOKIE_NAME);
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
    setCookie(req, res, '', 0);
    res.json({ ok: true });
  });

  router.post('/change-pin', requireAuth, async (req, res) => {
    const body = vObj(req.body);
    if (typeof body.current !== 'string') throw invalid('current', 'Enter your current PIN');
    const next = vPin(body.next, 'next');
    await checkPin(req, body.current);
    const hash = await bcrypt.hash(next, config.bcryptRounds);
    db.prepare('UPDATE auth SET pin_hash = ?, updated_at = ? WHERE id = 1').run(hash, nowIso());
    // Sign out every other device.
    db.prepare('DELETE FROM sessions WHERE token_hash <> ?').run(req.session.token_hash);
    res.json({ ok: true });
  });

  return { router, requireAuth, checkPin, isSetUp, currentSession };
}

export function purgeExpiredSessions(db) {
  return db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso()).changes;
}
