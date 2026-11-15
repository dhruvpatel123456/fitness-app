// Food diary: entries, copy, water and notes.

import express from 'express';
import {
  entryFromRow,
  getFoodRow,
  getTargetHistory,
  insertDiaryEntry,
  rememberServing,
  snapshotFromFood,
  snapshotFromQuick,
  targetsForDate,
  touchFood,
} from '../store.js';
import {
  HttpError,
  derivedId,
  invalid,
  notFound,
  nowIso,
  vArr,
  vDate,
  vId,
  vNum,
  vObj,
  vQuantity,
  vStr,
  vUnit,
} from '../util.js';

const MAX_AMOUNT = 100000; // 100 kg / 100 L in one entry is clearly a typo

function vMeal(v, field = 'meal') {
  return vNum(v, field, { min: 0, max: 3, integer: true });
}

export function vQuick(src) {
  const q = vObj(src, 'quick');
  return {
    name: vStr(q.name, 'name', { max: 80 }),
    kcal: vNum(q.kcal, 'kcal', { min: 0, max: 20000 }),
    protein: vNum(q.protein, 'protein', { min: 0, max: 2000, nullable: true }),
    carbs: vNum(q.carbs, 'carbs', { min: 0, max: 2000, nullable: true }),
    fat: vNum(q.fat, 'fat', { min: 0, max: 2000, nullable: true }),
  };
}

export function checkAmount(unit, quantity) {
  const amount = unit.amount * quantity;
  if (!(amount > 0) || amount > MAX_AMOUNT) throw invalid('quantity', 'That amount is too large. Check the quantity.');
  return amount;
}

export function diaryRoutes({ db }) {
  const r = express.Router();

  const getEntryRow = (id) => db.prepare('SELECT * FROM diary_entries WHERE id = ? AND deleted_at IS NULL').get(id);

  /** Validate one "log this" request and work out what to store. */
  function prepareEntry(src) {
    const b = vObj(src, 'entry');
    const id = vId(b.id);
    const date = vDate(b.date);
    const meal = vMeal(b.meal);
    if (b.quick !== undefined && b.quick !== null) {
      return { id, date, meal, snap: snapshotFromQuick(vQuick(b.quick)), touch: null };
    }
    const foodId = vId(b.food_id, 'food_id');
    const unit = vUnit(b.unit);
    const quantity = vQuantity(b.quantity);
    checkAmount(unit, quantity);
    const food = getFoodRow(db, foodId);
    if (!food) throw notFound('That food no longer exists.');
    return { id, date, meal, snap: snapshotFromFood(food, unit, quantity), touch: { foodId, unit, quantity } };
  }

  const createMany = db.transaction((items) => {
    const base = Date.now();
    items.forEach((item, i) => {
      // Stagger timestamps so entries added together keep their order.
      const inserted = insertDiaryEntry(db, item.id, item.date, item.meal, item.snap, new Date(base + i).toISOString());
      if (inserted && item.touch) touchFood(db, item.touch.foodId, item.touch.unit, item.touch.quantity);
    });
  });

  r.get('/diary/:date', (req, res) => {
    const date = vDate(req.params.date);
    const entries = db
      .prepare('SELECT * FROM diary_entries WHERE date = ? AND deleted_at IS NULL ORDER BY meal, created_at, id')
      .all(date)
      .map(entryFromRow);
    const exercise = db
      .prepare('SELECT id, date, name, activity_key, minutes, kcal FROM exercise_entries WHERE date = ? ORDER BY created_at, id')
      .all(date);
    const day = db.prepare('SELECT water_ml, note FROM days WHERE date = ?').get(date);
    res.json({
      date,
      entries,
      exercise,
      water_ml: day?.water_ml ?? 0,
      note: day?.note ?? '',
      targets: targetsForDate(db, date, getTargetHistory(db)),
    });
  });

  // Log one food (or a quick add). Safe to repeat: the id decides whether it already exists.
  r.post('/diary/entries', (req, res) => {
    const item = prepareEntry(req.body);
    createMany([item]);
    const row = db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(item.id);
    res.json({ entry: entryFromRow(row) });
  });

  // Log several foods at once (multi-add).
  r.post('/diary/entries/batch', (req, res) => {
    const b = vObj(req.body);
    const items = vArr(b.entries, 'entries', { min: 1, max: 50 }).map(prepareEntry);
    createMany(items);
    res.json({ added: items.length });
  });

  r.patch('/diary/entries/:id', (req, res) => {
    const id = vId(req.params.id);
    const b = vObj(req.body);
    const row = getEntryRow(id);
    if (!row) throw notFound('That entry no longer exists.');

    const next = {
      date: b.date !== undefined ? vDate(b.date) : row.date,
      meal: b.meal !== undefined ? vMeal(b.meal) : row.meal,
      name: row.name,
      unit_label: row.unit_label,
      unit_amount: row.unit_amount,
      quantity: row.quantity,
      kcal: row.kcal,
      protein: row.protein,
      carbs: row.carbs,
      fat: row.fat,
    };

    if (row.kind === 'quick') {
      if (b.quick !== undefined) {
        const q = vQuick(b.quick);
        next.name = q.name || 'Quick add';
        next.kcal = q.kcal;
        next.protein = q.protein;
        next.carbs = q.carbs;
        next.fat = q.fat;
      }
    } else {
      if (b.unit !== undefined) {
        const unit = vUnit(b.unit);
        next.unit_label = unit.label;
        next.unit_amount = unit.amount;
      }
      if (b.quantity !== undefined) next.quantity = vQuantity(b.quantity);
    }
    const amount = checkAmount({ amount: next.unit_amount }, next.quantity);

    db.prepare(
      `UPDATE diary_entries
         SET date = ?, meal = ?, name = ?, unit_label = ?, unit_amount = ?, quantity = ?, amount = ?,
             kcal = ?, protein = ?, carbs = ?, fat = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      next.date,
      next.meal,
      next.name,
      next.unit_label,
      next.unit_amount,
      next.quantity,
      amount,
      next.kcal,
      next.protein,
      next.carbs,
      next.fat,
      nowIso(),
      id,
    );
    // The serving you settled on is what one-tap logging offers next time.
    if (row.kind === 'food' && row.food_id && (b.unit !== undefined || b.quantity !== undefined)) {
      rememberServing(db, row.food_id, { label: next.unit_label, amount: next.unit_amount }, next.quantity);
    }
    res.json({ entry: entryFromRow(db.prepare('SELECT * FROM diary_entries WHERE id = ?').get(id)) });
  });

  // Delete is reversible for a while (the undo toast calls /restore).
  r.delete('/diary/entries/:id', (req, res) => {
    const id = vId(req.params.id);
    db.prepare('UPDATE diary_entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL').run(nowIso(), id);
    res.json({ ok: true });
  });

  r.post('/diary/entries/:id/restore', (req, res) => {
    const id = vId(req.params.id);
    const result = db.prepare('UPDATE diary_entries SET deleted_at = NULL WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('That entry can no longer be restored.');
    res.json({ ok: true });
  });

  // Copy one meal, or a whole day, to another date.
  r.post('/diary/copy', (req, res) => {
    const b = vObj(req.body);
    const opId = vId(b.op_id, 'op_id');
    const fromDate = vDate(b.from_date, 'from_date');
    const toDate = vDate(b.to_date, 'to_date');
    const fromMeal = b.from_meal === null || b.from_meal === undefined ? null : vMeal(b.from_meal, 'from_meal');
    const toMeal = b.to_meal === null || b.to_meal === undefined ? null : vMeal(b.to_meal, 'to_meal');

    const source =
      fromMeal === null
        ? db
            .prepare('SELECT * FROM diary_entries WHERE date = ? AND deleted_at IS NULL ORDER BY meal, created_at, id')
            .all(fromDate)
        : db
            .prepare(
              'SELECT * FROM diary_entries WHERE date = ? AND meal = ? AND deleted_at IS NULL ORDER BY created_at, id',
            )
            .all(fromDate, fromMeal);
    if (source.length === 0) throw new HttpError(400, 'nothing_to_copy', 'There is nothing to copy.');

    const copy = db.transaction(() => {
      const base = Date.now();
      let copied = 0;
      source.forEach((row, i) => {
        // The new id is derived from the operation id, so repeating this request copies nothing twice.
        const inserted = insertDiaryEntry(
          db,
          derivedId('copy', opId, row.id),
          toDate,
          toMeal === null ? row.meal : toMeal,
          row,
          new Date(base + i).toISOString(),
        );
        if (inserted) copied += 1;
      });
      return copied;
    });
    res.json({ copied: copy(), total: source.length });
  });

  r.put('/days/:date/water', (req, res) => {
    const date = vDate(req.params.date);
    const ml = vNum(vObj(req.body).ml, 'ml', { min: 0, max: 20000 });
    db.prepare(
      `INSERT INTO days (date, water_ml) VALUES (?, ?)
       ON CONFLICT (date) DO UPDATE SET water_ml = excluded.water_ml`,
    ).run(date, ml);
    res.json({ date, water_ml: ml });
  });

  r.put('/days/:date/note', (req, res) => {
    const date = vDate(req.params.date);
    const note = vStr(vObj(req.body).note, 'note', { max: 2000 });
    db.prepare(
      `INSERT INTO days (date, note) VALUES (?, ?)
       ON CONFLICT (date) DO UPDATE SET note = excluded.note`,
    ).run(date, note);
    res.json({ date, note });
  });

  return r;
}

/** Totals per day for a date range (used by charts and the CSV export). */
export function dailyTotals(db, from, to) {
  return db
    .prepare(
      `SELECT date,
              COUNT(*) AS entries,
              COALESCE(SUM(kcal * amount / 100.0), 0) AS kcal,
              COALESCE(SUM(protein * amount / 100.0), 0) AS protein,
              COALESCE(SUM(carbs * amount / 100.0), 0) AS carbs,
              COALESCE(SUM(fat * amount / 100.0), 0) AS fat
         FROM diary_entries
        WHERE deleted_at IS NULL AND date BETWEEN ? AND ?
        GROUP BY date
        ORDER BY date`,
    )
    .all(from, to);
}

