// Replaces the database with a backup file.
//   1. Stop the app (Ctrl+C in its window).
//   2. npm run restore -- backups/tucker-tally-daily-2026-11-15.sqlite
//   3. npm start
// The database being replaced is kept next to it as a "before-restore" copy.
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { loadConfig, loadEnvFile } from '../server/config.js';

loadEnvFile();
const config = loadConfig();
const source = process.argv[2] ? path.resolve(process.argv[2]) : '';

function stop(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

if (!source) stop('Tell me which backup to restore, for example:\n  npm run restore -- backups/tucker-tally-daily-2026-11-15.sqlite');
if (!fs.existsSync(source)) stop(`There is no file at ${source}`);

// Make sure the backup is a healthy database made by this app before touching anything.
try {
  const check = new Database(source, { readonly: true, fileMustExist: true });
  const result = check.pragma('integrity_check', { simple: true });
  const hasDiary = check.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'diary_entries'").get();
  check.close();
  if (result !== 'ok') stop(`That backup file is damaged (${result}). Nothing was changed.`);
  if (!hasDiary) stop('That file is not a Tucker Tally database. Nothing was changed.');
} catch (err) {
  stop(`That file could not be read as a database (${err.message}). Nothing was changed.`);
}

fs.mkdirSync(config.dataDir, { recursive: true });
if (fs.existsSync(config.dbFile)) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const keep = path.join(config.dataDir, `before-restore-${stamp}.sqlite`);
  fs.copyFileSync(config.dbFile, keep);
  console.log(`Current database kept as ${keep}`);
}
for (const extra of ['-journal', '-wal', '-shm']) fs.rmSync(config.dbFile + extra, { force: true });
fs.copyFileSync(source, config.dbFile);
console.log(`Restored ${source}\nStart the app again with: npm start`);
