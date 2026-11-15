// Foods: the local food database, barcode lookup, online search.

import { randomUUID } from 'node:crypto';
import express from 'express';
import { OnlineError } from '../online/http.js';
import { foodFromRow, getFoodRow, insertFood, itemFromRow, updateFood } from '../store.js';
import {
  HttpError,
  invalid,
  likeEscape,
  notFound,
  nowIso,
  searchText,
  vBool,
  vEnum,
  vId,
  vNutrition,
  vObj,
  vServings,
  vStr,
} from '../util.js';

const TABS = ['search', 'recent', 'frequent', 'mine', 'favourites', 'recipes'];
const BARCODE_RE = /^\d{6,14}$/;

export function vBarcode(v, field = 'barcode') {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !BARCODE_RE.test(v.trim())) throw invalid(field, 'A barcode is 6 to 14 digits');
  return v.trim();
}

/** The same barcode can be written with or without leading zeros (UPC-A vs EAN-13). */
export function barcodeVariants(code) {
  const stripped = code.replace(/^0+/, '') || '0';
  return [...new Set([code, stripped, stripped.padStart(8, '0'), stripped.padStart(12, '0'), stripped.padStart(13, '0')])];
}

function vFood(src, { requireEnergy }) {
  const b = vObj(src, 'food');
  const nutrition = vNutrition(vObj(b.nutrition, 'nutrition'));
  if (requireEnergy && nutrition.kcal === null) throw invalid('kcal', 'Energy is required');
  return {
    name: vStr(b.name, 'name', { min: 1, max: 120 }),
    brand: vStr(b.brand, 'brand', { max: 80, nullable: true }),
    barcode: vBarcode(b.barcode),
    base_unit: vEnum(b.base_unit ?? 'g', 'base_unit', ['g', 'ml']),
    ...nutrition,
    servings: vServings(b.servings),
  };
}

export function foodRoutes({ db, online }) {
  const r = express.Router();

  function findByBarcode(code) {
    const variants = barcodeVariants(code);
    const marks = variants.map(() => '?').join(', ');
    return (
      db
        .prepare(
          `SELECT * FROM foods
            WHERE deleted_at IS NULL AND barcode IN (${marks})
            ORDER BY (source = 'custom') DESC, last_used_at DESC
            LIMIT 1`,
        )
        .get(...variants) || null
    );
  }

  /**
   * Save an online food into the local database (or return the copy that is
   * already there). Safe to repeat.
   */
  const adopt = db.transaction((id, food) => {
    const existing = db.prepare('SELECT * FROM foods WHERE source = ? AND source_id = ?').get(food.source, food.source_id);
    if (existing) {
      if (existing.deleted_at) {
        db.prepare('UPDATE foods SET deleted_at = NULL, updated_at = ? WHERE id = ?').run(nowIso(), existing.id);
      }
      return existing.id;
    }
    insertFood(db, { ...food, id });
    return db.prepare('SELECT id FROM foods WHERE source = ? AND source_id = ?').get(food.source, food.source_id).id;
  });

  // ---- local lists ----------------------------------------------------------

  r.get('/foods', (req, res) => {
    const tab = vEnum(req.query.tab ?? 'search', 'tab', TABS);
    const q = typeof req.query.q === 'string' ? req.query.q.slice(0, 80) : '';
    const terms = searchText(q, '').split(/\s+/).filter(Boolean).slice(0, 6);

    if (tab === 'search' && terms.length === 0) {
      res.json({ foods: [] });
      return;
    }

    const where = ['deleted_at IS NULL'];
    const params = [];
    for (const term of terms) {
      where.push("search_text LIKE ? ESCAPE '\\'");
      params.push(`%${likeEscape(term)}%`);
    }
    let order = 'is_favourite DESC, use_count DESC, name COLLATE NOCASE';
    let limit = 40;
    if (tab === 'recent') {
      where.push('last_used_at IS NOT NULL');
      order = 'last_used_at DESC';
    } else if (tab === 'frequent') {
      where.push('use_count > 0');
      order = 'use_count DESC, last_used_at DESC';
    } else if (tab === 'mine') {
      where.push("source = 'custom'");
      order = 'name COLLATE NOCASE';
      limit = 500;
    } else if (tab === 'favourites') {
      where.push('is_favourite = 1');
      order = 'name COLLATE NOCASE';
      limit = 500;
    } else if (tab === 'recipes') {
      where.push("source = 'recipe'");
      order = 'name COLLATE NOCASE';
      limit = 500;
    }
    // The WHERE and ORDER BY text above is fixed; every user value is bound.
    const rows = db
      .prepare(`SELECT * FROM foods WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`)
      .all(...params, limit);
    res.json({ foods: rows.map(foodFromRow) });
  });

  r.get('/foods/:id', (req, res) => {
    const row = getFoodRow(db, vId(req.params.id));
    if (!row) throw notFound('That food no longer exists.');
    const food = foodFromRow(row);
    if (row.source === 'recipe') {
      const liveServings = db.prepare('SELECT servings FROM foods WHERE id = ? AND deleted_at IS NULL');
      food.ingredients = db
        .prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ? ORDER BY position')
        .all(row.id)
        .map((ing) => {
          const live = ing.food_id ? liveServings.get(ing.food_id) : null;
          return itemFromRow({ ...ing, servings: live?.servings ?? '[]' });
        });
    }
    res.json({ food });
  });

  // ---- create / edit --------------------------------------------------------

  r.post('/foods', (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    const food = vFood(b, { requireEnergy: true });
    insertFood(db, { ...food, id, source: 'custom', source_id: null });
    res.json({ food: foodFromRow(db.prepare('SELECT * FROM foods WHERE id = ?').get(id)) });
  });

  r.put('/foods/:id', (req, res) => {
    const id = vId(req.params.id);
    const row = getFoodRow(db, id);
    if (!row) throw notFound('That food no longer exists.');
    if (row.source === 'recipe') throw new HttpError(400, 'is_recipe', 'Edit this as a recipe.');
    const food = vFood(req.body, { requireEnergy: row.source === 'custom' });
    updateFood(db, id, { ...food, recipe_servings: null, recipe_cooked_weight: null });
    res.json({ food: foodFromRow(getFoodRow(db, id)) });
  });

  // Deleting hides the food. Diary entries keep their own copy of its values.
  r.delete('/foods/:id', (req, res) => {
    const id = vId(req.params.id);
    db.prepare('UPDATE foods SET deleted_at = ?, is_favourite = 0 WHERE id = ? AND deleted_at IS NULL').run(nowIso(), id);
    res.json({ ok: true });
  });

  r.post('/foods/:id/restore', (req, res) => {
    const id = vId(req.params.id);
    const result = db.prepare('UPDATE foods SET deleted_at = NULL WHERE id = ?').run(id);
    if (result.changes === 0) throw notFound('That food can no longer be restored.');
    res.json({ ok: true });
  });

  r.put('/foods/:id/favourite', (req, res) => {
    const id = vId(req.params.id);
    const value = vBool(vObj(req.body).value, 'value');
    const result = db
      .prepare('UPDATE foods SET is_favourite = ? WHERE id = ? AND deleted_at IS NULL')
      .run(value ? 1 : 0, id);
    if (result.changes === 0) throw notFound('That food no longer exists.');
    res.json({ ok: true, is_favourite: value });
  });

  // ---- barcode --------------------------------------------------------------

  r.get('/barcode/:code', async (req, res) => {
    const code = String(req.params.code || '').trim();
    if (!BARCODE_RE.test(code)) throw invalid('barcode', 'A barcode is 6 to 14 digits');

    const local = findByBarcode(code);
    if (local) {
      res.json({ status: 'found', origin: 'local', food: foodFromRow(local) });
      return;
    }
    let found;
    try {
      found = await online.barcode(code);
    } catch (err) {
      const reason = err instanceof OnlineError ? err.reason : 'error';
      res.json({ status: 'unavailable', reason, barcode: code });
      return;
    }
    if (!found) {
      res.json({ status: 'not_found', barcode: code });
      return;
    }
    // A scan is a first use: keep the product so it works offline from now on.
    const id = adopt(randomUUID(), { ...found, source_id: found.source_id || code, barcode: found.barcode || code });
    res.json({ status: 'found', origin: 'online', food: foodFromRow(getFoodRow(db, id)) });
  });

  // ---- online search ----------------------------------------------------------

  r.get('/search/online', async (req, res) => {
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
    if (q.length < 2) {
      res.json({ sources: { off: 'skipped', usda: 'skipped' }, items: [] });
      return;
    }
    res.json(await online.search(q));
  });

  // Save a search result locally the first time it is used.
  r.post('/foods/adopt', async (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    const source = vEnum(b.source, 'source', ['off', 'usda']);
    const sourceId = vStr(b.source_id, 'source_id', { min: 1, max: 40 });
    const existing = db
      .prepare('SELECT id FROM foods WHERE source = ? AND source_id = ? AND deleted_at IS NULL')
      .get(source, sourceId);
    if (existing) {
      res.json({ food: foodFromRow(getFoodRow(db, existing.id)) });
      return;
    }
    let food;
    try {
      food = await online.getOne(source, sourceId);
    } catch (err) {
      const reason = err instanceof OnlineError ? err.reason : 'error';
      throw new HttpError(503, 'online_unavailable', 'Could not reach the online food database. Try again.', { reason });
    }
    if (!food) throw notFound('That food is no longer available online.');
    const localId = adopt(id, food);
    res.json({ food: foodFromRow(getFoodRow(db, localId)) });
  });

  return r;
}
