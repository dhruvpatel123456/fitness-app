// Weight log, body measurements, and the numbers behind the charts.

import express from 'express';
import { addDays, diffDays, eachDate } from '../../shared/dates.js';
import { MEASUREMENT_KINDS, findMeasurementKind } from '../../shared/measures.js';
import { computeStreak } from '../../shared/trend.js';
import { getTargetHistory, targetsForDate } from '../store.js';
import { invalid, nowIso, vDate, vEnum, vId, vNum, vObj } from '../util.js';
import { dailyTotals } from './diary.js';

export function progressRoutes({ db }) {
  const r = express.Router();

  // ---- weight ---------------------------------------------------------------

  r.get('/weights', (req, res) => {
    res.json({ weights: db.prepare('SELECT date, kg FROM weights ORDER BY date').all() });
  });

  // One entry per day: logging again on the same day replaces it.
  r.put('/weights/:date', (req, res) => {
    const date = vDate(req.params.date);
    const kg = vNum(vObj(req.body).kg, 'kg', { min: 25, max: 400 });
    db.prepare(
      `INSERT INTO weights (date, kg, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
    ).run(date, kg, nowIso());
    res.json({ date, kg });
  });

  r.delete('/weights/:date', (req, res) => {
    db.prepare('DELETE FROM weights WHERE date = ?').run(vDate(req.params.date));
    res.json({ ok: true });
  });

  // ---- measurements -----------------------------------------------------------

  r.get('/measurements', (req, res) => {
    res.json({
      measurements: db.prepare('SELECT id, date, kind, value FROM measurements ORDER BY date, kind').all(),
    });
  });

  // One value per kind per day: saving again on the same day replaces it.
  r.put('/measurements', (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    const date = vDate(b.date);
    const kind = vEnum(
      b.kind,
      'kind',
      MEASUREMENT_KINDS.map((k) => k.key),
    );
    const info = findMeasurementKind(kind);
    const value = vNum(b.value, 'value', { min: info.min, max: info.max });
    const save = db.transaction(() => {
      const existing = db.prepare('SELECT id FROM measurements WHERE date = ? AND kind = ?').get(date, kind);
      if (existing) {
        db.prepare('UPDATE measurements SET value = ?, updated_at = ? WHERE id = ?').run(value, nowIso(), existing.id);
      } else {
        db.prepare('INSERT OR IGNORE INTO measurements (id, date, kind, value, updated_at) VALUES (?, ?, ?, ?, ?)').run(
          id,
          date,
          kind,
          value,
          nowIso(),
        );
      }
    });
    save();
    res.json({
      measurement: db.prepare('SELECT id, date, kind, value FROM measurements WHERE date = ? AND kind = ?').get(date, kind),
    });
  });

  r.delete('/measurements/:id', (req, res) => {
    db.prepare('DELETE FROM measurements WHERE id = ?').run(vId(req.params.id));
    res.json({ ok: true });
  });

  // ---- statistics -------------------------------------------------------------

  // Intake, exercise and target for every day in a range (for the charts).
  r.get('/stats/daily', (req, res) => {
    const from = vDate(req.query.from, 'from');
    const to = vDate(req.query.to, 'to');
    const span = diffDays(from, to);
    if (span < 0) throw invalid('to', 'The end date must be on or after the start date');
    if (span > 800) throw invalid('from', 'That range is too long');

    const totals = new Map(dailyTotals(db, from, to).map((d) => [d.date, d]));
    const exercise = new Map(
      db
        .prepare('SELECT date, SUM(kcal) AS kcal FROM exercise_entries WHERE date BETWEEN ? AND ? GROUP BY date')
        .all(from, to)
        .map((e) => [e.date, e.kcal]),
    );
    const history = getTargetHistory(db);
    const days = eachDate(from, to).map((date) => {
      const t = totals.get(date);
      const target = targetsForDate(db, date, history);
      return {
        date,
        entries: t?.entries ?? 0,
        kcal: t?.kcal ?? 0,
        protein: t?.protein ?? 0,
        carbs: t?.carbs ?? 0,
        fat: t?.fat ?? 0,
        exercise_kcal: exercise.get(date) ?? 0,
        target: target
          ? { kcal: target.kcal, protein_g: target.protein_g, carbs_g: target.carbs_g, fat_g: target.fat_g }
          : null,
      };
    });
    res.json({ from, to, days });
  });

  // Consecutive days with something logged. `today` comes from the phone,
  // because "today" is the user's local calendar date.
  r.get('/stats/streak', (req, res) => {
    const today = vDate(req.query.today, 'today');
    const rows = db
      .prepare(
        'SELECT DISTINCT date FROM diary_entries WHERE deleted_at IS NULL AND date <= ? AND date >= ? ORDER BY date DESC',
      )
      .all(today, addDays(today, -3660));
    res.json(computeStreak(rows.map((x) => x.date), today));
  });

  return r;
}
