// Starts Tucker Tally: one process, one database file.

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import { createApp } from './app.js';
import { purgeExpiredSessions } from './auth.js';
import { APP_NAME, loadConfig, loadEnvFile } from './config.js';
import { migrate, openDb } from './db.js';
import { printBanner } from './net.js';

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

function listen(server, port, host, label) {
  return new Promise((resolve) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        fail(
          `Port ${port} is already in use, so ${APP_NAME} could not start (${label}).\n` +
            `Either the app is already running in another window, or another program uses that port.\n` +
            `To use a different port, put a line like PORT=3001 in the .env file, then start again.\n` +
            `See "Port already in use" in README.md for how to find what is using it.`,
        );
      } else if (err.code === 'EACCES') {
        fail(`This computer did not allow ${APP_NAME} to use port ${port}. Choose a port above 1024 in .env.`);
      } else {
        fail(`${APP_NAME} could not start: ${err.message}`);
      }
    });
    server.listen(port, host, resolve);
  });
}

async function main() {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    fail(err.message);
  }

  const db = openDb(config.dbFile);
  const applied = migrate(db);
  if (applied.length) console.log(`Database updated (${applied.join(', ')}).`);

  // Housekeeping: expired logins, and diary entries deleted more than a day ago.
  purgeExpiredSessions(db);
  db.prepare('DELETE FROM diary_entries WHERE deleted_at IS NOT NULL AND deleted_at < ?').run(
    new Date(Date.now() - 86400000).toISOString(),
  );

  const { app, backups, online } = createApp({ db, config });
  online.prune();

  // The server listens on every network interface (0.0.0.0 by default) so the
  // phone can reach it. It is protected by the PIN.
  const server = http.createServer(app);
  await listen(server, config.port, config.host, 'HTTP');
  const servers = [server];

  let httpsEnabled = false;
  if (config.httpsCertFile || config.httpsKeyFile) {
    if (!config.httpsCertFile || !config.httpsKeyFile) {
      fail('Set both HTTPS_CERT_FILE and HTTPS_KEY_FILE in .env, or neither.');
    }
    let cert;
    let key;
    try {
      cert = fs.readFileSync(config.httpsCertFile);
      key = fs.readFileSync(config.httpsKeyFile);
    } catch (err) {
      fail(`Could not read the HTTPS certificate files named in .env: ${err.message}`);
    }
    const secure = https.createServer({ cert, key }, app);
    await listen(secure, config.httpsPort, config.host, 'HTTPS');
    servers.push(secure);
    httpsEnabled = true;
  }

  backups.start();
  await printBanner({ config, httpsEnabled });

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    console.log(`\nStopping ${APP_NAME}…`);
    backups.stop();
    for (const s of servers) {
      s.close();
      s.closeAllConnections?.();
    }
    try {
      db.close();
    } catch {
      // Already closed.
    }
    process.exit(0);
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('SIGHUP', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
