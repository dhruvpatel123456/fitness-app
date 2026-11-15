// Opens the SQLite database and applies versioned migrations.

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ROOT } from './config.js';

export const MIGRATIONS_DIR = path.join(ROOT, 'server', 'migrations');

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  // One process, one database file: the classic rollback journal keeps
  // everything in a single file at rest, and FULL sync means a committed
  // change survives a crash or power cut.
  db.pragma('journal_mode = DELETE');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

/** Apply any migrations that have not run yet. Returns the names applied. */
export function migrate(db, dir = MIGRATIONS_DIR) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
  const applied = new Set(db.prepare('SELECT version FROM schema_migrations').all().map((r) => r.version));
  const files = fs
    .readdirSync(dir)
    .filter((f) => /^\d+_.+\.sql$/.test(f))
    .sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  const ran = [];
  for (const file of files) {
    const version = parseInt(file, 10);
    if (applied.has(version)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        version,
        file,
        new Date().toISOString(),
      );
    });
    apply();
    ran.push(file);
  }
  return ran;
}

export function schemaVersion(db) {
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migrations').get();
  return row?.v ?? 0;
}
