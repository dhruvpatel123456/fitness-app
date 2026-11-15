// Export, import, erase and backups.

import path from 'node:path';
import express from 'express';
import { formatDMY, localDate } from '../../shared/dates.js';
import { BACKUP_NAME_RE } from '../backup.js';
import { APP_ID, APP_NAME, APP_VERSION } from '../config.js';
import { schemaVersion } from '../db.js';
import { getSetting } from '../store.js';
import { HttpError, invalid, notFound, nowIso, vObj } from '../util.js';

export const EXPORT_FORMAT = 1;

// Order matters for import: a table comes after the tables it refers to.
export const EXPORT_TABLES = [
  'settings',
  'target_history',
  'foods',
  'recipe_ingredients',
  'diary_entries',
  'exercise_entries',
  'days',
  'weights',
  'measurements',
  'saved_meals',
  'saved_meal_items',
];

// Order matters for erasing: a table goes before the tables it refers to.
const WIPE_TABLES = [
  'saved_meal_items',
  'saved_meals',
  'measurements',
  'weights',
  'days',
  'exercise_entries',
  'diary_entries',
  'recipe_ingredients',
  'foods',
  'target_history',
  'settings',
  'online_cache',
];

/** Everything the app knows, as one JSON-ready object. The PIN is not included. */
export function exportData(db) {
  const tables = {};
  for (const table of EXPORT_TABLES) {
    // Table names come from the fixed list above, never from a request.
    tables[table] =
      table === 'diary_entries'
        ? db.prepare('SELECT * FROM diary_entries WHERE deleted_at IS NULL ORDER BY date, meal, created_at').all()
        : db.prepare(`SELECT * FROM ${table}`).all();
  }
  return {
    app: APP_ID,
    app_name: APP_NAME,
    app_version: APP_VERSION,
    format: EXPORT_FORMAT,
    schema_version: schemaVersion(db),
    exported_at: nowIso(),
    tables,
  };
}

export function wipeData(db) {
  for (const table of WIPE_TABLES) db.prepare(`DELETE FROM ${table}`).run();
}

const badFile = (message) => new HttpError(400, 'bad_file', message);

/** Replace all data with the contents of an export. All or nothing. */
export function importData(db, data) {
  if (!data || typeof data !== 'object' || data.app !== APP_ID || !data.tables || typeof data.tables !== 'object') {
    throw badFile(`That file is not a ${APP_NAME} export.`);
  }
  if (data.format !== EXPORT_FORMAT) throw badFile('That export file is in a format this version cannot read.');
  if (typeof data.schema_version === 'number' && data.schema_version > schemaVersion(db)) {
    throw badFile('That export was made by a newer version of the app. Update the app, then import again.');
  }

  const counts = {};
  const run = db.transaction(() => {
    wipeData(db);
    for (const table of EXPORT_TABLES) {
      const rows = data.tables[table];
      if (rows === undefined) continue;
      if (!Array.isArray(rows)) throw badFile(`The "${table}" section of the file is damaged.`);
      const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      const statements = new Map();
      for (const row of rows) {
        if (!row || typeof row !== 'object' || Array.isArray(row)) throw badFile(`The "${table}" section has an invalid row.`);
        // Only columns that exist in this table are used; column names never come from the file.
        const used = columns.filter((c) => Object.hasOwn(row, c));
        if (used.length === 0) throw badFile(`The "${table}" section has an empty row.`);
        const key = used.join(',');
        if (!statements.has(key)) {
          statements.set(
            key,
            db.prepare(`INSERT INTO ${table} (${used.join(', ')}) VALUES (${used.map(() => '?').join(', ')})`),
          );
        }
        const values = used.map((c) => {
          const v = row[c];
          if (v === null || typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v))) return v;
          throw badFile(`The "${table}" section has an invalid value in "${c}".`);
        });
        statements.get(key).run(...values);
      }
      counts[table] = rows.length;
    }
  });

  try {
    run();
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw badFile(`The file could not be imported, so nothing was changed. (${err.message})`);
  }
  return counts;
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  // Stop spreadsheet programs treating text as a formula.
  if (/^[=+\-@\t\r]/.test(s) && typeof value !== 'number') s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function round2(v) {
  return v === null || v === undefined ? '' : Math.round(v * 100) / 100;
}

/** The diary as CSV: one row per logged item. */
export function diaryCsv(db) {
  const mealNames = getSetting(db, 'meal_names');
  const rows = db
    .prepare('SELECT * FROM diary_entries WHERE deleted_at IS NULL ORDER BY date, meal, created_at, id')
    .all();
  const header = [
    'Date',
    'Meal',
    'Food',
    'Brand',
    'Quantity',
    'Unit',
    'Amount',
    'Amount unit',
    'Energy (kcal)',
    'Protein (g)',
    'Carbohydrate (g)',
    'Fat (g)',
    'Fibre (g)',
    'Sugars (g)',
    'Saturated fat (g)',
    'Sodium (mg)',
  ];
  const lines = [header.map(csvCell).join(',')];
  const per = (row, key) => (row[key] === null ? null : (row[key] * row.amount) / 100);
  for (const row of rows) {
    const quick = row.kind === 'quick';
    lines.push(
      [
        formatDMY(row.date),
        mealNames[row.meal] ?? `Meal ${row.meal + 1}`,
        row.name,
        row.brand ?? '',
        quick ? '' : round2(row.quantity),
        quick ? '' : row.unit_label,
        quick ? '' : round2(row.amount),
        quick ? '' : row.base_unit === 'ml' ? 'mL' : 'g',
        round2(per(row, 'kcal')),
        round2(per(row, 'protein')),
        round2(per(row, 'carbs')),
        round2(per(row, 'fat')),
        round2(per(row, 'fibre')),
        round2(per(row, 'sugar')),
        round2(per(row, 'sat_fat')),
        round2(per(row, 'sodium')),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  // The leading BOM makes Excel read the file as UTF-8.
  return `﻿${lines.join('\r\n')}\r\n`;
}

export function dataRoutes({ db, auth, backups, config }) {
  const r = express.Router();

  r.get('/export/json', (req, res) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tucker-tally-export-${localDate()}.json"`);
    res.send(JSON.stringify(exportData(db), null, 1));
  });

  r.get('/export/diary.csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tucker-tally-diary-${localDate()}.csv"`);
    res.send(diaryCsv(db));
  });

  // Replaces everything with the contents of an export file.
  r.post('/import', (req, res) => {
    const b = vObj(req.body);
    if (b.confirm !== true) throw invalid('confirm', 'Importing replaces all current data. Confirm to continue.');
    const counts = importData(db, b.data);
    res.json({ ok: true, counts });
  });

  // Erases all data (the PIN and this login are kept). Requires the PIN.
  r.post('/wipe', async (req, res) => {
    const b = vObj(req.body);
    if (typeof b.pin !== 'string' || b.pin.length === 0 || b.pin.length > 72) throw invalid('pin', 'Enter your PIN');
    await auth.checkPin(req, b.pin);
    const erase = db.transaction(() => wipeData(db));
    erase();
    res.json({ ok: true });
  });

  r.get('/backups', (req, res) => {
    res.json({ backups: backups.list(), keep: config.backupKeep, folder: backups.dir });
  });

  r.post('/backups', async (req, res) => {
    res.json({ backup: await backups.run('manual') });
  });

  r.get('/backups/:name', (req, res) => {
    const name = String(req.params.name || '');
    if (!BACKUP_NAME_RE.test(name)) throw notFound('No such backup.');
    const file = path.join(backups.dir, name);
    res.download(file, name, (err) => {
      if (err && !res.headersSent) res.status(404).json({ error: 'not_found', message: 'No such backup.' });
    });
  });

  return r;
}
