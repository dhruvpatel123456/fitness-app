// Reading and writing settings, targets and food/entry rows.
// All SQL is parameterised: values are always bound, never concatenated.

import { NUTRIENTS, pickNutrition } from '../shared/nutrition.js';
import { resolveTargets } from '../shared/goals.js';
import { nowIso, parseJson, searchText } from './util.js';

export const SETTING_DEFAULTS = {
  energy_unit: 'kcal',
  meal_names: ['Breakfast', 'Lunch', 'Dinner', 'Snacks'],
  water_glass_ml: 250,
  water_goal_ml: 2000,
  exercise_adds_back: true,
  theme: 'system',
  macro_mode: 'percent',
  profile: null,
  onboarded: false,
};

export const NUTRIENT_COLUMNS = NUTRIENTS.join(', ');

export function getSetting(db, key) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  if (!row) return structuredClone(SETTING_DEFAULTS[key]);
  return parseJson(row.value, structuredClone(SETTING_DEFAULTS[key]));
}

export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, JSON.stringify(value));
}

export function getAllSettings(db) {
  const out = {};
  for (const key of Object.keys(SETTING_DEFAULTS)) out[key] = getSetting(db, key);
  return out;
}

export function getTargetHistory(db) {
  return db
    .prepare('SELECT effective_from, targets FROM target_history ORDER BY effective_from')
    .all()
    .map((r) => ({ effective_from: r.effective_from, targets: parseJson(r.targets, {}) }));
}

export function targetsForDate(db, date, history = getTargetHistory(db)) {
  return resolveTargets(history, date);
}

export function latestWeight(db, onOrBefore = null) {
  const row = onOrBefore
    ? db.prepare('SELECT date, kg FROM weights WHERE date <= ? ORDER BY date DESC LIMIT 1').get(onOrBefore)
    : db.prepare('SELECT date, kg FROM weights ORDER BY date DESC LIMIT 1').get();
  return row || null;
}

// ---- foods -----------------------------------------------------------------

export function foodFromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    source: row.source,
    source_id: row.source_id,
    name: row.name,
    brand: row.brand,
    barcode: row.barcode,
    base_unit: row.base_unit,
    ...pickNutrition(row),
    servings: parseJson(row.servings, []),
    last:
      row.last_unit_label && row.last_unit_amount > 0 && row.last_quantity > 0
        ? { label: row.last_unit_label, amount: row.last_unit_amount, quantity: row.last_quantity }
        : null,
    is_favourite: row.is_favourite === 1,
    use_count: row.use_count,
    last_used_at: row.last_used_at,
    recipe_servings: row.recipe_servings,
    recipe_cooked_weight: row.recipe_cooked_weight,
    updated_at: row.updated_at,
  };
}

export function getFoodRow(db, id) {
  return db.prepare('SELECT * FROM foods WHERE id = ? AND deleted_at IS NULL').get(id) || null;
}

/** Insert a food. Returns true if a row was inserted, false if the id already existed. */
export function insertFood(db, f) {
  const now = nowIso();
  const n = pickNutrition(f);
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO foods
         (id, source, source_id, name, brand, barcode, base_unit, ${NUTRIENT_COLUMNS},
          servings, recipe_servings, recipe_cooked_weight, search_text, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      f.id,
      f.source,
      f.source_id ?? null,
      f.name,
      f.brand || null,
      f.barcode || null,
      f.base_unit,
      n.kcal,
      n.protein,
      n.carbs,
      n.fat,
      n.fibre,
      n.sugar,
      n.sat_fat,
      n.sodium,
      JSON.stringify(f.servings || []),
      f.recipe_servings ?? null,
      f.recipe_cooked_weight ?? null,
      searchText(f.name, f.brand),
      now,
      now,
    );
  return result.changes === 1;
}

export function updateFood(db, id, f) {
  const n = pickNutrition(f);
  return db
    .prepare(
      `UPDATE foods SET
         name = ?, brand = ?, barcode = ?, base_unit = ?,
         kcal = ?, protein = ?, carbs = ?, fat = ?, fibre = ?, sugar = ?, sat_fat = ?, sodium = ?,
         servings = ?, recipe_servings = ?, recipe_cooked_weight = ?, search_text = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    )
    .run(
      f.name,
      f.brand || null,
      f.barcode || null,
      f.base_unit,
      n.kcal,
      n.protein,
      n.carbs,
      n.fat,
      n.fibre,
      n.sugar,
      n.sat_fat,
      n.sodium,
      JSON.stringify(f.servings || []),
      f.recipe_servings ?? null,
      f.recipe_cooked_weight ?? null,
      searchText(f.name, f.brand),
      nowIso(),
      id,
    ).changes;
}

// ---- logged items (diary entries, saved-meal items, recipe ingredients) ----

/** The snapshot fields copied from a food when it is logged. */
export function snapshotFromFood(foodRow, unit, quantity) {
  return {
    food_id: foodRow.id,
    kind: 'food',
    name: foodRow.name,
    brand: foodRow.brand,
    base_unit: foodRow.base_unit,
    unit_label: unit.label,
    unit_amount: unit.amount,
    quantity,
    amount: unit.amount * quantity,
    ...pickNutrition(foodRow),
    servings: foodRow.servings || '[]',
  };
}

/** A quick-add snapshot: the values entered are stored against a nominal 100 units. */
export function snapshotFromQuick(q) {
  return {
    food_id: null,
    kind: 'quick',
    name: q.name || 'Quick add',
    brand: null,
    base_unit: 'g',
    unit_label: 'quick add',
    unit_amount: 100,
    quantity: 1,
    amount: 100,
    kcal: q.kcal,
    protein: q.protein ?? null,
    carbs: q.carbs ?? null,
    fat: q.fat ?? null,
    fibre: null,
    sugar: null,
    sat_fat: null,
    sodium: null,
    servings: '[]',
  };
}

export function itemFromRow(row) {
  return {
    id: row.id,
    food_id: row.food_id,
    kind: row.kind ?? 'food',
    name: row.name,
    brand: row.brand,
    base_unit: row.base_unit,
    unit_label: row.unit_label,
    unit_amount: row.unit_amount,
    quantity: row.quantity,
    amount: row.amount,
    ...pickNutrition(row),
    servings: parseJson(row.servings ?? '[]', []),
  };
}

export function entryFromRow(row) {
  return { ...itemFromRow(row), date: row.date, meal: row.meal, created_at: row.created_at };
}

/** Insert a diary entry. Returns true if inserted, false if the id already existed. */
export function insertDiaryEntry(db, id, date, meal, snap, createdAt = nowIso()) {
  const result = db
    .prepare(
      `INSERT OR IGNORE INTO diary_entries
         (id, date, meal, food_id, kind, name, brand, base_unit, unit_label, unit_amount, quantity, amount,
          ${NUTRIENT_COLUMNS}, servings, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      date,
      meal,
      snap.food_id ?? null,
      snap.kind,
      snap.name,
      snap.brand ?? null,
      snap.base_unit,
      snap.unit_label,
      snap.unit_amount,
      snap.quantity,
      snap.amount,
      snap.kcal ?? null,
      snap.protein ?? null,
      snap.carbs ?? null,
      snap.fat ?? null,
      snap.fibre ?? null,
      snap.sugar ?? null,
      snap.sat_fat ?? null,
      snap.sodium ?? null,
      typeof snap.servings === 'string' ? snap.servings : JSON.stringify(snap.servings || []),
      createdAt,
      createdAt,
    );
  return result.changes === 1;
}

/** Remember that a food was just used, and how, for Recent / Frequent and one-tap re-logging. */
export function touchFood(db, foodId, unit, quantity) {
  db.prepare(
    `UPDATE foods SET use_count = use_count + 1, last_used_at = ?,
       last_unit_label = ?, last_unit_amount = ?, last_quantity = ?
     WHERE id = ?`,
  ).run(nowIso(), unit.label, unit.amount, quantity, foodId);
}
