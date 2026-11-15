// Recipes and saved meals. Both are lists of foods with amounts.
//
// A recipe becomes a food of its own (nutrition worked out per serving) and
// can be logged like any other food. A saved meal is a group of foods that
// are logged together.

import express from 'express';
import { pickNutrition, recipeNutrition } from '../../shared/nutrition.js';
import {
  NUTRIENT_COLUMNS,
  foodFromRow,
  getFoodRow,
  insertDiaryEntry,
  insertFood,
  itemFromRow,
  snapshotFromFood,
  updateFood,
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
import { checkAmount } from './diary.js';

function vItems(src, field, max) {
  return vArr(src, field, { min: 1, max }).map((raw, i) => {
    const it = vObj(raw, `${field}[${i}]`);
    const unit = vUnit(it.unit);
    const quantity = vQuantity(it.quantity);
    checkAmount(unit, quantity);
    return {
      id: vId(it.id, `${field}[${i}].id`),
      food_id: it.food_id === null || it.food_id === undefined ? null : vId(it.food_id, 'food_id'),
      unit,
      quantity,
    };
  });
}

export function recipeRoutes({ db }) {
  const r = express.Router();

  /**
   * Work out what to store for each item. A food that still exists is read
   * fresh; an item whose food has since been deleted keeps the values it
   * already had.
   */
  function resolveItems(items, existingById, ownId) {
    return items.map((it, i) => {
      if (ownId && it.food_id === ownId) throw invalid('ingredients', 'A recipe cannot contain itself.');
      const live = it.food_id ? getFoodRow(db, it.food_id) : null;
      const previous = existingById.get(it.id);
      if (!live && !previous) throw notFound(`Item ${i + 1} no longer exists. Remove it and add it again.`);
      const quick = !live && previous.kind === 'quick';
      const base = live ? snapshotFromFood(live, it.unit, it.quantity) : previous;
      return {
        id: it.id,
        food_id: live ? live.id : previous.food_id,
        kind: quick ? 'quick' : 'food',
        name: base.name,
        brand: base.brand,
        base_unit: base.base_unit,
        unit_label: quick ? previous.unit_label : it.unit.label,
        unit_amount: quick ? previous.unit_amount : it.unit.amount,
        quantity: quick ? previous.quantity : it.quantity,
        amount: quick ? previous.amount : it.unit.amount * it.quantity,
        ...pickNutrition(base),
        servings: live ? live.servings : (previous.servings ?? '[]'),
      };
    });
  }

  // ---- recipes --------------------------------------------------------------

  const saveRecipe = db.transaction((id, body) => {
    const name = vStr(body.name, 'name', { min: 1, max: 120 });
    const servings = vNum(body.servings, 'servings', { min: 0, exclusiveMin: true, max: 1000 });
    const cookedWeight = vNum(body.cooked_weight, 'cooked_weight', {
      min: 0,
      exclusiveMin: true,
      max: 100000,
      nullable: true,
    });
    const items = vItems(body.ingredients, 'ingredients', 100);

    const existing = db.prepare('SELECT * FROM foods WHERE id = ?').get(id);
    if (existing && existing.source !== 'recipe') throw new HttpError(409, 'id_in_use', 'That id belongs to another food.');
    const previous = new Map(
      db.prepare('SELECT * FROM recipe_ingredients WHERE recipe_id = ?').all(id).map((row) => [row.id, row]),
    );
    const resolved = resolveItems(items, previous, id);
    const calc = recipeNutrition(resolved, servings, cookedWeight);

    const food = {
      name,
      brand: null,
      barcode: null,
      base_unit: 'g',
      ...calc.per100,
      servings: [{ label: '1 serving', amount: calc.servingWeight }],
      recipe_servings: servings,
      recipe_cooked_weight: cookedWeight,
    };
    if (existing) {
      if (existing.deleted_at) db.prepare('UPDATE foods SET deleted_at = NULL WHERE id = ?').run(id);
      updateFood(db, id, food);
    } else {
      insertFood(db, { ...food, id, source: 'recipe', source_id: null });
    }

    db.prepare('DELETE FROM recipe_ingredients WHERE recipe_id = ?').run(id);
    const insert = db.prepare(
      `INSERT INTO recipe_ingredients
         (id, recipe_id, food_id, position, name, brand, base_unit, unit_label, unit_amount, quantity, amount, ${NUTRIENT_COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    resolved.forEach((it, i) => {
      insert.run(
        it.id,
        id,
        it.food_id,
        i,
        it.name,
        it.brand ?? null,
        it.base_unit,
        it.unit_label,
        it.unit_amount,
        it.quantity,
        it.amount,
        it.kcal,
        it.protein,
        it.carbs,
        it.fat,
        it.fibre,
        it.sugar,
        it.sat_fat,
        it.sodium,
      );
    });
    return calc;
  });

  function recipeResponse(id, calc) {
    return {
      food: foodFromRow(getFoodRow(db, id)),
      per_serving: calc.perServing,
      missing: calc.missing,
      serving_weight: calc.servingWeight,
    };
  }

  // Create (or, if the same id is sent again, update) a recipe.
  r.post('/recipes', (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    res.json(recipeResponse(id, saveRecipe(id, b)));
  });

  r.put('/recipes/:id', (req, res) => {
    const id = vId(req.params.id);
    const row = getFoodRow(db, id);
    if (!row || row.source !== 'recipe') throw notFound('That recipe no longer exists.');
    res.json(recipeResponse(id, saveRecipe(id, vObj(req.body))));
  });

  // ---- saved meals ----------------------------------------------------------

  function loadSavedMeal(row) {
    const items = db
      .prepare('SELECT * FROM saved_meal_items WHERE saved_meal_id = ? ORDER BY position')
      .all(row.id)
      .map(itemFromRow);
    return { id: row.id, name: row.name, use_count: row.use_count, last_used_at: row.last_used_at, items };
  }

  const insertSavedItem = db.prepare(
    `INSERT OR IGNORE INTO saved_meal_items
       (id, saved_meal_id, food_id, position, kind, name, brand, base_unit, unit_label, unit_amount, quantity, amount,
        ${NUTRIENT_COLUMNS}, servings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  function writeSavedItems(mealId, items) {
    items.forEach((it, i) => {
      insertSavedItem.run(
        it.id,
        mealId,
        it.food_id ?? null,
        i,
        it.kind ?? 'food',
        it.name,
        it.brand ?? null,
        it.base_unit,
        it.unit_label,
        it.unit_amount,
        it.quantity,
        it.amount,
        it.kcal ?? null,
        it.protein ?? null,
        it.carbs ?? null,
        it.fat ?? null,
        it.fibre ?? null,
        it.sugar ?? null,
        it.sat_fat ?? null,
        it.sodium ?? null,
        typeof it.servings === 'string' ? it.servings : JSON.stringify(it.servings || []),
      );
    });
  }

  r.get('/saved-meals', (req, res) => {
    const rows = db.prepare('SELECT * FROM saved_meals ORDER BY name COLLATE NOCASE').all();
    res.json({ saved_meals: rows.map(loadSavedMeal) });
  });

  // Create a saved meal, either from a meal in the diary or from a list of foods.
  r.post('/saved-meals', (req, res) => {
    const b = vObj(req.body);
    const id = vId(b.id);
    const name = vStr(b.name, 'name', { min: 1, max: 80 });

    const create = db.transaction(() => {
      const now = nowIso();
      const made = db
        .prepare('INSERT OR IGNORE INTO saved_meals (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)')
        .run(id, name, now, now);
      if (made.changes === 0) return; // already created by an earlier attempt

      if (b.from_diary !== undefined && b.from_diary !== null) {
        const from = vObj(b.from_diary, 'from_diary');
        const date = vDate(from.date);
        const meal = vNum(from.meal, 'meal', { min: 0, max: 3, integer: true });
        const rows = db
          .prepare(
            'SELECT * FROM diary_entries WHERE date = ? AND meal = ? AND deleted_at IS NULL ORDER BY created_at, id',
          )
          .all(date, meal);
        if (rows.length === 0) throw new HttpError(400, 'empty_meal', 'That meal has nothing in it yet.');
        writeSavedItems(
          id,
          rows.map((row) => ({ ...row, id: derivedId('saved', id, row.id) })),
        );
      } else {
        writeSavedItems(id, resolveItems(vItems(b.items, 'items', 60), new Map(), null));
      }
    });
    create();
    res.json({ saved_meal: loadSavedMeal(db.prepare('SELECT * FROM saved_meals WHERE id = ?').get(id)) });
  });

  r.put('/saved-meals/:id', (req, res) => {
    const id = vId(req.params.id);
    const b = vObj(req.body);
    const row = db.prepare('SELECT * FROM saved_meals WHERE id = ?').get(id);
    if (!row) throw notFound('That saved meal no longer exists.');
    const name = vStr(b.name, 'name', { min: 1, max: 80 });
    const items = vItems(b.items, 'items', 60);
    const update = db.transaction(() => {
      const previous = new Map(
        db.prepare('SELECT * FROM saved_meal_items WHERE saved_meal_id = ?').all(id).map((it) => [it.id, it]),
      );
      const resolved = resolveItems(items, previous, null);
      db.prepare('UPDATE saved_meals SET name = ?, updated_at = ? WHERE id = ?').run(name, nowIso(), id);
      db.prepare('DELETE FROM saved_meal_items WHERE saved_meal_id = ?').run(id);
      writeSavedItems(id, resolved);
    });
    update();
    res.json({ saved_meal: loadSavedMeal(db.prepare('SELECT * FROM saved_meals WHERE id = ?').get(id)) });
  });

  r.delete('/saved-meals/:id', (req, res) => {
    db.prepare('DELETE FROM saved_meals WHERE id = ?').run(vId(req.params.id));
    res.json({ ok: true });
  });

  // Add every item of a saved meal to the diary.
  r.post('/saved-meals/:id/log', (req, res) => {
    const id = vId(req.params.id);
    const b = vObj(req.body);
    const opId = vId(b.op_id, 'op_id');
    const date = vDate(b.date);
    const meal = vNum(b.meal, 'meal', { min: 0, max: 3, integer: true });
    const row = db.prepare('SELECT * FROM saved_meals WHERE id = ?').get(id);
    if (!row) throw notFound('That saved meal no longer exists.');
    const items = db.prepare('SELECT * FROM saved_meal_items WHERE saved_meal_id = ? ORDER BY position').all(id);
    if (items.length === 0) throw new HttpError(400, 'empty_meal', 'That saved meal has nothing in it.');

    const log = db.transaction(() => {
      const base = Date.now();
      let added = 0;
      items.forEach((it, i) => {
        if (insertDiaryEntry(db, derivedId('log', opId, it.id), date, meal, it, new Date(base + i).toISOString())) {
          added += 1;
        }
      });
      if (added > 0) {
        db.prepare('UPDATE saved_meals SET use_count = use_count + 1, last_used_at = ? WHERE id = ?').run(nowIso(), id);
      }
      return added;
    });
    res.json({ added: log(), total: items.length });
  });

  return r;
}
