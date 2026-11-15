// Backups of the SQLite database file.
//
//  * One automatic backup a day (made the first time the app runs that day).
//  * Manual backups from the "Back up now" button.
//  * The newest BACKUP_KEEP (default 14) of each kind are kept.
//
// Backups use SQLite's online backup API, so they are consistent even while
// the app is being used.

import fs from 'node:fs';
import path from 'node:path';
import { localDate, pad2 } from '../shared/dates.js';

export const BACKUP_NAME_RE = /^tucker-tally-(daily|manual)-\d{4}-\d{2}-\d{2}(-\d{6})?\.sqlite$/;

export function createBackupManager({ db, config, log = console }) {
  const dir = config.backupDir;
  let timer = null;
  let running = Promise.resolve();

  function describe(name) {
    const stat = fs.statSync(path.join(dir, name));
    return {
      name,
      kind: name.includes('-manual-') ? 'manual' : 'daily',
      size: stat.size,
      created_at: stat.mtime.toISOString(),
    };
  }

  function list() {
    if (!fs.existsSync(dir)) return [];
    return fs
      .readdirSync(dir)
      .filter((f) => BACKUP_NAME_RE.test(f))
      .map(describe)
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }

  function prune(kind) {
    const files = list().filter((b) => b.kind === kind);
    for (const old of files.slice(config.backupKeep)) {
      try {
        fs.unlinkSync(path.join(dir, old.name));
      } catch (err) {
        log.error(`Could not remove old backup ${old.name}: ${err.message}`);
      }
    }
  }

  async function make(kind) {
    fs.mkdirSync(dir, { recursive: true });
    const now = new Date();
    const stamp =
      kind === 'daily'
        ? localDate(now)
        : `${localDate(now)}-${pad2(now.getHours())}${pad2(now.getMinutes())}${pad2(now.getSeconds())}`;
    const name = `tucker-tally-${kind}-${stamp}.sqlite`;
    const dest = path.join(dir, name);
    const tmp = `${dest}.partial`;
    await db.backup(tmp);
    fs.renameSync(tmp, dest);
    prune(kind);
    return describe(name);
  }

  /** Run backups one at a time. */
  function run(kind) {
    const next = running.then(() => make(kind));
    running = next.catch(() => {});
    return next;
  }

  /** Make today's automatic backup if it does not exist yet. */
  async function ensureDaily() {
    const name = `tucker-tally-daily-${localDate()}.sqlite`;
    if (fs.existsSync(path.join(dir, name))) return null;
    return run('daily');
  }

  function start() {
    const check = () =>
      ensureDaily().catch((err) => {
        log.error(`Automatic backup failed: ${err.message}`);
      });
    check();
    timer = setInterval(check, 60 * 60 * 1000);
    timer.unref();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { list, run, ensureDaily, start, stop, dir };
}
