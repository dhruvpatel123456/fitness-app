// USDA FoodData Central (https://fdc.nal.usda.gov): generic and whole foods.
// Needs a free API key in .env (USDA_API_KEY). Without a key this source is
// simply skipped.

import { KJ_PER_KCAL, NUTRIENTS, NUTRIENT_INFO } from '../../shared/nutrition.js';
import { fetchJson } from './http.js';

// FoodData Central nutrient ids.
const ID = {
  kcal: [1008, 2048, 2047], // Energy; Atwater specific; Atwater general (Foundation foods use the last two)
  kj: [1062],
  protein: [1003],
  fat: [1004],
  carbs: [1005, 1050],
  fibre: [1079],
  sugar: [2000, 1063],
  sat_fat: [1258],
  sodium: [1093],
};

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/** Map of nutrient id -> amount, for both the search and the detail response shapes. */
function nutrientMap(food) {
  const map = new Map();
  for (const n of Array.isArray(food.foodNutrients) ? food.foodNutrients : []) {
    const id = n?.nutrientId ?? n?.nutrient?.id;
    const value = num(n?.value) ?? num(n?.amount);
    if (id !== undefined && value !== null && !map.has(id)) map.set(id, value);
  }
  return map;
}

function first(map, ids) {
  for (const id of ids) if (map.has(id)) return map.get(id);
  return null;
}

function tidyName(description) {
  const s = String(description || '').replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Descriptions arrive in many cases ("BANANAS, RAW"); make them sentence case.
  const lower = s === s.toUpperCase() ? s.toLowerCase() : s;
  return (lower.charAt(0).toUpperCase() + lower.slice(1)).slice(0, 120);
}

function portions(food) {
  const out = [];
  const seen = new Set();
  const push = (label, grams) => {
    const text = String(label || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    if (!text || !(grams > 0) || grams > 5000 || /not specified/i.test(text)) return;
    const full = `${text} (${Math.round(grams * 10) / 10} g)`;
    if (seen.has(full)) return;
    seen.add(full);
    out.push({ label: full, amount: grams });
  };
  // Search results.
  for (const m of Array.isArray(food.foodMeasures) ? food.foodMeasures : []) {
    push(m?.disseminationText, num(m?.gramWeight));
  }
  // Detail responses.
  for (const p of Array.isArray(food.foodPortions) ? food.foodPortions : []) {
    const amount = num(p?.amount);
    const unit = p?.measureUnit?.name && p.measureUnit.name !== 'undetermined' ? p.measureUnit.name : '';
    const label = p?.portionDescription || [amount ?? '', unit, p?.modifier || ''].join(' ');
    push(label, num(p?.gramWeight));
  }
  return out.slice(0, 6);
}

/** Turn a FoodData Central food into this app's food shape (values are per 100 g). */
export function normaliseUsdaFood(food) {
  if (!food || typeof food !== 'object' || food.fdcId === undefined || food.fdcId === null) return null;
  const name = tidyName(food.description);
  if (!name) return null;
  const map = nutrientMap(food);
  let kcal = first(map, ID.kcal);
  if (kcal === null) {
    const kj = first(map, ID.kj);
    if (kj !== null) kcal = kj / KJ_PER_KCAL;
  }
  const out = {
    source: 'usda',
    source_id: String(food.fdcId),
    barcode: null,
    name,
    brand: null,
    base_unit: 'g',
    kcal,
    protein: first(map, ID.protein),
    carbs: first(map, ID.carbs),
    fat: first(map, ID.fat),
    fibre: first(map, ID.fibre),
    sugar: first(map, ID.sugar),
    sat_fat: first(map, ID.sat_fat),
    sodium: first(map, ID.sodium),
    servings: portions(food),
    au: false,
  };
  for (const key of NUTRIENTS) {
    const v = out[key];
    out[key] = v === null || v < 0 || v > NUTRIENT_INFO[key].max100 ? null : v;
  }
  return out;
}

export async function usdaSearch(query, { config, fetchImpl }) {
  const params = new URLSearchParams({
    api_key: config.usdaApiKey,
    query,
    dataType: 'Foundation,SR Legacy,Survey (FNDDS)',
    pageSize: '12',
  });
  const { status, data } = await fetchJson(`${config.usdaBaseUrl}/fdc/v1/foods/search?${params.toString()}`, {
    timeoutMs: config.onlineTimeoutMs,
    fetchImpl,
  });
  if (status === 404) return [];
  const foods = Array.isArray(data?.foods) ? data.foods : [];
  return foods.map(normaliseUsdaFood).filter((f) => f && f.kcal !== null);
}

export async function usdaFood(fdcId, { config, fetchImpl }) {
  const url = `${config.usdaBaseUrl}/fdc/v1/food/${encodeURIComponent(fdcId)}?api_key=${encodeURIComponent(config.usdaApiKey)}`;
  const { status, data } = await fetchJson(url, { timeoutMs: config.onlineTimeoutMs, fetchImpl });
  if (status === 404) return null;
  return normaliseUsdaFood(data);
}
