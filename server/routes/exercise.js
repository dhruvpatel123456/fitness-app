// Exercise log.

import express from 'express';
import { notFound, nowIso, vDate, vId, vNum, vObj, vStr } from '../util.js';

function vExercise(src) {
  const b = vObj(src, 'exercise');
  return {
    date: vDate(b.date),
    name: vStr(b.name, 'name', { min: 1, max: 80 }),
    activity_key: vStr(b.activity_key, 'activity_key', { max: 40, nullable: true }),
    minutes: vNum(b.minutes, 'minutes', { min: 0, max: 1440 }),
    kcal: vNum(b.kcal, 'kcal', { min: 0, max: 20000 }),
  };
}

export function exerciseRoutes({ db }) {
  const r = express.Router();
  const get = (id) =>
    db.prepare('SELECT id, date, name, activity_key, minutes, kcal FROM exercise_entries WHERE id = ?').get(id);

  // Safe to repeat: the id decides whether the entry already exists.
  r.post('/exercise', (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    const e = vExercise(b);
    const now = nowIso();
    db.prepare(
      `INSERT OR IGNORE INTO exercise_entries (id, date, name, activity_key, minutes, kcal, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(id, e.date, e.name, e.activity_key, e.minutes, e.kcal, now, now);
    res.json({ exercise: get(id) });
  });

  r.put('/exercise/:id', (req, res) => {
    const id = vId(req.params.id);
    const e = vExercise(req.body);
    const result = db
      .prepare(
        'UPDATE exercise_entries SET date = ?, name = ?, activity_key = ?, minutes = ?, kcal = ?, updated_at = ? WHERE id = ?',
      )
      .run(e.date, e.name, e.activity_key, e.minutes, e.kcal, nowIso(), id);
    if (result.changes === 0) throw notFound('That exercise entry no longer exists.');
    res.json({ exercise: get(id) });
  });

  r.delete('/exercise/:id', (req, res) => {
    db.prepare('DELETE FROM exercise_entries WHERE id = ?').run(vId(req.params.id));
    res.json({ ok: true });
  });

  return r;
}
