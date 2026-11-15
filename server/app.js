// Builds the Express app: security headers, login, API routes, and the built
// web app (static files). Kept separate from index.js so tests can start it
// on any port with a temporary database.

import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { createAuth } from './auth.js';
import { createBackupManager } from './backup.js';
import { APP_ID, APP_NAME, APP_VERSION } from './config.js';
import { createOnline } from './online/index.js';
import { dataRoutes } from './routes/data.js';
import { diaryRoutes } from './routes/diary.js';
import { exerciseRoutes } from './routes/exercise.js';
import { foodRoutes } from './routes/foods.js';
import { progressRoutes } from './routes/progress.js';
import { recipeRoutes } from './routes/recipes.js';
import { settingsRoutes } from './routes/settings.js';
import { HttpError } from './util.js';

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

const NOT_BUILT_PAGE = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${APP_NAME}</title>
<body style="font-family:system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem;line-height:1.5">
<h1>${APP_NAME} is not built yet</h1>
<p>The server is running, but the app's web pages have not been built.</p>
<p>In the project folder, run <code>npm run setup</code>, then <code>npm start</code> again.</p>`;

export function createApp({ db, config, fetchImpl = fetch, log = console, backups: providedBackups } = {}) {
  const app = express();
  app.disable('x-powered-by');
  // Trust X-Forwarded-* only from this computer, which is how `tailscale serve`
  // passes on the phone's address and the fact that the connection is HTTPS.
  app.set('trust proxy', 'loopback');

  const auth = createAuth({ db, config });
  const online = createOnline({ db, config, fetchImpl });
  const backups = providedBackups || createBackupManager({ db, config, log });
  const ctx = { db, config, auth, online, backups, log };

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    next();
  });

  // ---- API ------------------------------------------------------------------

  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, app: APP_ID, version: APP_VERSION });
  });

  // Requests that change data must come from this app's own pages. A request
  // started by another website carries that site's Origin and is refused.
  app.use('/api', (req, res, next) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.get('origin');
    if (!origin) return next();
    let originHost;
    try {
      originHost = new URL(origin).host;
    } catch {
      return res.status(403).json({ error: 'bad_origin', message: 'Request refused.' });
    }
    const allowed = new Set([req.get('host'), req.get('x-forwarded-host')].filter(Boolean));
    if (config.publicUrl) {
      try {
        allowed.add(new URL(config.publicUrl).host);
      } catch {
        // An unusable PUBLIC_URL is simply not added.
      }
    }
    if (!allowed.has(originHost)) {
      return res.status(403).json({ error: 'bad_origin', message: 'Request refused.' });
    }
    return next();
  });

  const smallBody = express.json({ limit: '1mb' });
  const largeBody = express.json({ limit: '80mb' });
  app.use('/api', (req, res, next) => (req.path === '/import' ? largeBody : smallBody)(req, res, next));

  app.use('/api/auth', auth.router);
  app.use('/api', auth.requireAuth);
  app.use('/api', settingsRoutes(ctx));
  app.use('/api', diaryRoutes(ctx));
  app.use('/api', foodRoutes(ctx));
  app.use('/api', recipeRoutes(ctx));
  app.use('/api', exerciseRoutes(ctx));
  app.use('/api', progressRoutes(ctx));
  app.use('/api', dataRoutes(ctx));
  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such API route.' });
  });

  // ---- the web app (static files) ---------------------------------------------

  const indexFile = path.join(config.distDir, 'index.html');
  if (fs.existsSync(indexFile)) {
    app.use(
      express.static(config.distDir, {
        index: false,
        setHeaders(res, file) {
          // Files under /assets have a content hash in their name, so they can be cached forever.
          if (file.includes(`${path.sep}assets${path.sep}`)) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    // Every other page address belongs to the single-page app.
    app.use((req, res, next) => {
      if (req.method !== 'GET' && req.method !== 'HEAD') return next();
      if (path.extname(req.path)) return res.status(404).type('text/plain').send('Not found');
      res.setHeader('Cache-Control', 'no-cache');
      return res.sendFile(indexFile);
    });
  } else {
    app.use((req, res) => {
      res.status(503).type('html').send(NOT_BUILT_PAGE);
    });
  }

  // ---- errors -----------------------------------------------------------------

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (res.headersSent) return;
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
      return;
    }
    if (err && err.type === 'entity.parse.failed') {
      res.status(400).json({ error: 'bad_json', message: 'The request was not valid JSON.' });
      return;
    }
    if (err && err.type === 'entity.too.large') {
      res.status(413).json({ error: 'too_large', message: 'That is too large to send.' });
      return;
    }
    if (err && typeof err.code === 'string' && err.code.startsWith('SQLITE_CONSTRAINT')) {
      res.status(400).json({ error: 'validation', message: 'That value is not allowed.' });
      return;
    }
    log.error(err);
    res.status(500).json({
      error: 'server_error',
      message: 'Something went wrong on the laptop. The window running the app shows the details.',
    });
  });

  return { app, auth, online, backups };
}
