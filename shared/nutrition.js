// Nutrition maths shared by the server and the app.
//
// Rules:
//  * The base for every food is "per 100 g" (or per 100 mL for liquids).
//    Servings are derived from that base.
//  * Values are never rounded here. Rounding happens only when displaying.
//  * A missing value is `null` ("unknown"), which is different from 0.

/** @typedef {'kcal' | 'protein' | 'carbs' | 'fat' | 'fibre' | 'sugar' | 'sat_fat' | 'sodium'} NutrientKey */
/** @typedef {Record<NutrientKey, number | null>} Nutrients */
/** @typedef {Record<NutrientKey, number>} NutrientTotals */

export const KJ_PER_KCAL = 4.184;

/**
 * The nutrients tracked, in display order. `kcal` is always first.
 * @type {NutrientKey[]}
 */
export const NUTRIENTS = ['kcal', 'protein', 'carbs', 'fat', 'fibre', 'sugar', 'sat_fat', 'sodium'];

/** @type {Record<NutrientKey, { label: string, unit: string, max100: number }>} */
export const NUTRIENT_INFO = {
  kcal: { label: 'Energy', unit: 'kcal', max100: 950 },
  protein: { label: 'Protein', unit: 'g', max100: 100 },
  carbs: { label: 'Carbohydrate', unit: 'g', max100: 100 },
  fat: { label: 'Fat', unit: 'g', max100: 100 },
  fibre: { label: 'Fibre', unit: 'g', max100: 100 },
  sugar: { label: 'Sugars', unit: 'g', max100: 100 },
  sat_fat: { label: 'Saturated fat', unit: 'g', max100: 100 },
  sodium: { label: 'Sodium', unit: 'mg', max100: 40000 },
};

export const kjToKcal = (kj) => kj / KJ_PER_KCAL;
export const kcalToKj = (kcal) => kcal * KJ_PER_KCAL;

/** True for a real, finite number. null/undefined/NaN mean "unknown". */
export function isKnown(v) {
  return typeof v === 'number' && Number.isFinite(v);
}

/**
 * Pick the nutrient fields of any object into a clean per-100 record.
 * @param {any} src
 * @returns {Nutrients}
 */
export function pickNutrition(src) {
  const out = /** @type {Nutrients} */ ({});
  for (const k of NUTRIENTS) out[k] = src && isKnown(src[k]) ? src[k] : null;
  return out;
}

/**
 * Nutrition for `amount` base units (g or mL), from per-100 values.
 * Unknown values stay unknown.
 * @param {any} per100
 * @param {number} amount
 * @returns {Nutrients}
 */
export function scaleNutrition(per100, amount) {
  const out = /** @type {Nutrients} */ ({});
  for (const k of NUTRIENTS) out[k] = isKnown(per100?.[k]) ? (per100[k] * amount) / 100 : null;
  return out;
}

/**
 * Convert label values given for one serving of `servingAmount` g/mL into
 * per-100 values.
 * @param {any} values
 * @param {number} servingAmount
 * @returns {Nutrients}
 */
export function per100FromServing(values, servingAmount) {
  const out = /** @type {Nutrients} */ ({});
  for (const k of NUTRIENTS) {
    out[k] = isKnown(values?.[k]) && servingAmount > 0 ? (values[k] / servingAmount) * 100 : null;
  }
  return out;
}

/** Total base units eaten: the weight of one unit times how many. */
export function totalAmount(unitAmount, quantity) {
  return unitAmount * quantity;
}

/**
 * Nutrition of one diary entry / ingredient (it carries per-100 values and an amount).
 * @param {any} entry
 * @returns {Nutrients}
 */
export function entryNutrition(entry) {
  return scaleNutrition(entry, entry.amount);
}

/**
 * Add up nutrition records. Unknown values are skipped, and `unknown[k]`
 * counts how many records had no value for nutrient k, so totals can be
 * labelled as incomplete instead of silently treating unknown as zero.
 * @param {any[]} records
 * @returns {{ totals: NutrientTotals, unknown: NutrientTotals }}
 */
export function sumNutrition(records) {
  const totals = /** @type {NutrientTotals} */ ({});
  const unknown = /** @type {NutrientTotals} */ ({});
  for (const k of NUTRIENTS) {
    totals[k] = 0;
    unknown[k] = 0;
  }
  for (const r of records) {
    for (const k of NUTRIENTS) {
      if (isKnown(r?.[k])) totals[k] += r[k];
      else unknown[k] += 1;
    }
  }
  return { totals, unknown };
}

export function baseUnitLabel(baseUnit) {
  return baseUnit === 'ml' ? 'mL' : 'g';
}

/**
 * The serving units a food can be logged in:
 * "100 g", each named serving ("1 slice (30 g)"), and a free amount in g/mL.
 * @param {{ base_unit: string, servings?: { label: string, amount: number }[] }} food
 * @returns {{ key: string, label: string, amount: number }[]}
 */
export function unitOptions(food) {
  const u = baseUnitLabel(food.base_unit);
  const opts = [{ key: 'base100', label: `100 ${u}`, amount: 100 }];
  const seen = new Set();
  for (const s of food.servings || []) {
    if (!s || !(s.amount > 0) || !s.label) continue;
    const key = `s:${s.label}:${s.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    opts.push({ key, label: s.label, amount: s.amount });
  }
  opts.push({ key: 'base1', label: u, amount: 1 });
  return opts;
}

/**
 * Nutrition of a recipe.
 *
 * ingredients: [{ amount, kcal, protein, … }] with per-100 values and the
 *              amount (g/mL) of each ingredient used.
 * servings:    how many servings the recipe makes.
 * cookedWeight: optional final weight in grams (cooking changes the weight).
 *
 * A nutrient is unknown for the recipe if it is unknown for any ingredient.
 * @param {any[]} ingredients
 * @param {number} servings
 * @param {number | null} [cookedWeight]
 */
export function recipeNutrition(ingredients, servings, cookedWeight) {
  const parts = ingredients.map((i) => scaleNutrition(i, i.amount));
  const { totals, unknown } = sumNutrition(parts);
  const rawWeight = ingredients.reduce((a, i) => a + (isKnown(i.amount) ? i.amount : 0), 0);
  const weight = isKnown(cookedWeight) && cookedWeight > 0 ? cookedWeight : rawWeight;
  const n = isKnown(servings) && servings > 0 ? servings : 1;
  const total = /** @type {Nutrients} */ ({});
  const perServing = /** @type {Nutrients} */ ({});
  const per100 = /** @type {Nutrients} */ ({});
  /** @type {NutrientKey[]} */
  const missing = [];
  for (const k of NUTRIENTS) {
    const known = ingredients.length > 0 && unknown[k] === 0;
    if (!known) missing.push(k);
    total[k] = known ? totals[k] : null;
    perServing[k] = known ? totals[k] / n : null;
    per100[k] = known && weight > 0 ? (totals[k] / weight) * 100 : null;
  }
  return { total, perServing, per100, weight, rawWeight, servingWeight: weight / n, servings: n, missing };
}

/** Energy implied by macros (4 kcal/g protein and carbs, 9 kcal/g fat). */
export function energyFromMacros(protein, carbs, fat) {
  return 4 * (protein || 0) + 4 * (carbs || 0) + 9 * (fat || 0);
}

/** Share of energy from each macro, in percent (0 when there is no energy). */
export function macroPercentages(protein, carbs, fat) {
  const p = 4 * (protein || 0);
  const c = 4 * (carbs || 0);
  const f = 9 * (fat || 0);
  const total = p + c + f;
  if (!(total > 0)) return { protein: 0, carbs: 0, fat: 0 };
  return { protein: (p / total) * 100, carbs: (c / total) * 100, fat: (f / total) * 100 };
}

/**
 * Validate a per-100 record. Returns a list of problems (empty when fine).
 * @param {any} per100
 * @returns {{ field: NutrientKey, message: string }[]}
 */
export function nutritionProblems(per100) {
  /** @type {{ field: NutrientKey, message: string }[]} */
  const problems = [];
  for (const k of NUTRIENTS) {
    const v = per100?.[k];
    if (v === null || v === undefined) continue;
    if (!isKnown(v)) problems.push({ field: k, message: `${NUTRIENT_INFO[k].label} must be a number` });
    else if (v < 0) problems.push({ field: k, message: `${NUTRIENT_INFO[k].label} cannot be negative` });
    else if (v > NUTRIENT_INFO[k].max100) {
      problems.push({
        field: k,
        message: `${NUTRIENT_INFO[k].label} works out to more than ${NUTRIENT_INFO[k].max100} ${NUTRIENT_INFO[k].unit} per 100, which is not possible. Check the serving size.`,
      });
    }
  }
  return problems;
}

/**
 * The serving used when a food is added with one tap: whatever was used last
 * time, otherwise its first named serving, otherwise 100 g / 100 mL.
 */
export function defaultServing(food) {
  if (food.last && food.last.amount > 0 && food.last.quantity > 0) {
    return { label: food.last.label, amount: food.last.amount, quantity: food.last.quantity };
  }
  const first = (food.servings || []).find((s) => s && s.amount > 0 && s.label);
  if (first) return { label: first.label, amount: first.amount, quantity: 1 };
  return { label: `100 ${baseUnitLabel(food.base_unit)}`, amount: 100, quantity: 1 };
}

/** "2 × 1 slice (30 g)" / "150 g" style description of an amount. */
export function describeServing(unitLabel, unitAmount, quantity, baseUnit) {
  const u = baseUnitLabel(baseUnit);
  const q = Math.round(quantity * 100) / 100;
  if (unitAmount === 1) return `${q} ${u}`;
  if (unitAmount === 100 && unitLabel === `100 ${u}`) return `${Math.round(quantity * 100 * 100) / 100} ${u}`;
  return q === 1 ? unitLabel : `${q} × ${unitLabel}`;
}
