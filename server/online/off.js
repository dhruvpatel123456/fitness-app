// Open Food Facts (https://world.openfoodfacts.org): free, no key needed.
// Used for barcode lookups and for searching packaged foods.

import { KJ_PER_KCAL, NUTRIENTS, NUTRIENT_INFO } from '../../shared/nutrition.js';
import { fetchJson } from './http.js';

const FIELDS = [
  'code',
  'product_name',
  'product_name_en',
  'generic_name',
  'generic_name_en',
  'brands',
  'quantity',
  'product_quantity',
  'product_quantity_unit',
  'serving_size',
  'serving_quantity',
  'serving_quantity_unit',
  'nutriments',
  'countries_tags',
].join(',');

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function clean(text, max) {
  if (typeof text !== 'string') return '';
  return text.replace(/\s+/g, ' ').trim().slice(0, max);
}

function isLiquidText(text) {
  if (typeof text !== 'string') return false;
  return /\d\s*(ml|cl|dl|l|litre|liter|fl\.? ?oz)\b/i.test(text) && !/\d\s*(g|kg|mg)\b/i.test(text);
}

/** Drop values that cannot be right (negative, or more than is physically possible per 100). */
function plausible(key, value) {
  if (value === null) return null;
  if (value < 0 || value > NUTRIENT_INFO[key].max100) return null;
  return value;
}

/**
 * Turn an Open Food Facts product into this app's food shape.
 * Missing values stay null ("unknown"). Returns null when the product has
 * no usable name.
 */
export function normaliseOffProduct(p, fallbackCode = '') {
  if (!p || typeof p !== 'object') return null;
  const code = clean(String(p.code ?? fallbackCode ?? ''), 32).replace(/\D/g, '');
  const brand = clean(String(p.brands ?? '').split(',')[0], 80);
  const name = clean(p.product_name_en || p.product_name || p.generic_name_en || p.generic_name || '', 120);
  if (!name && !brand) return null;

  const n = p.nutriments && typeof p.nutriments === 'object' ? p.nutriments : {};
  const servingQty = num(p.serving_quantity);

  // Prefer per-100 values; fall back to per-serving values when that is all there is.
  const per100 = (key) => {
    const direct = num(n[`${key}_100g`]);
    if (direct !== null) return direct;
    const perServing = num(n[`${key}_serving`]);
    if (perServing !== null && servingQty > 0) return (perServing / servingQty) * 100;
    return null;
  };

  // Energy: use kcal when listed, otherwise convert kJ. (`energy` is in kJ.)
  let kcal = per100('energy-kcal');
  if (kcal === null) {
    const kj = per100('energy-kj') ?? per100('energy');
    if (kj !== null) kcal = kj / KJ_PER_KCAL;
  }

  // Sodium is listed in grams; salt is 2.5 x sodium.
  let sodium = per100('sodium');
  if (sodium !== null) sodium *= 1000;
  else {
    const salt = per100('salt');
    if (salt !== null) sodium = (salt / 2.5) * 1000;
  }

  const unitHint = String(p.serving_quantity_unit || p.product_quantity_unit || '').toLowerCase();
  const baseUnit =
    unitHint === 'ml' || unitHint === 'l' || (!unitHint && (isLiquidText(p.serving_size) || isLiquidText(p.quantity)))
      ? 'ml'
      : 'g';
  const u = baseUnit === 'ml' ? 'mL' : 'g';

  const servings = [];
  if (servingQty > 0 && servingQty <= 5000) {
    const text = clean(p.serving_size, 28);
    servings.push({ label: text ? `1 serving (${text})` : `1 serving (${servingQty} ${u})`, amount: servingQty });
  }
  const packQty = num(p.product_quantity);
  if (packQty > 0 && packQty <= 5000 && packQty !== servingQty) {
    servings.push({ label: `1 pack (${packQty} ${u})`, amount: packQty });
  }

  const food = {
    source: 'off',
    source_id: code || null,
    barcode: code || null,
    name: name || `${brand} product`,
    brand: brand || null,
    base_unit: baseUnit,
    kcal,
    protein: per100('proteins'),
    carbs: per100('carbohydrates'),
    fat: per100('fat'),
    fibre: per100('fiber'),
    sugar: per100('sugars'),
    sat_fat: per100('saturated-fat'),
    sodium,
    servings,
    au: Array.isArray(p.countries_tags) && p.countries_tags.includes('en:australia'),
  };
  for (const key of NUTRIENTS) food[key] = plausible(key, food[key]);
  return food;
}

/** Look up one product by barcode. Resolves to a food, or null when it is not in the database. */
export async function offProduct(code, { config, fetchImpl }) {
  const url = `${config.offBaseUrl}/api/v2/product/${encodeURIComponent(code)}.json?fields=${FIELDS}`;
  const { status, data } = await fetchJson(url, { timeoutMs: config.onlineTimeoutMs, fetchImpl });
  if (status === 404 || !data || data.status === 0 || !data.product) return null;
  return normaliseOffProduct(data.product, code);
}

/**
 * Search products by text. When a country is configured, products sold there
 * are asked for first; the wider database is used only if that finds little.
 * `takeRequest()` must return true before each request (rate limiting).
 */
export async function offSearch(query, { config, fetchImpl, takeRequest = () => true }) {
  const build = (country) => {
    const params = new URLSearchParams({
      search_terms: query,
      search_simple: '1',
      action: 'process',
      json: '1',
      page_size: '24',
      sort_by: 'unique_scans_n',
      fields: FIELDS,
    });
    if (country) {
      params.set('tagtype_0', 'countries');
      params.set('tag_contains_0', 'contains');
      params.set('tag_0', country);
    }
    return `${config.offBaseUrl}/cgi/search.pl?${params.toString()}`;
  };

  const run = async (country) => {
    const { data } = await fetchJson(build(country), { timeoutMs: config.onlineTimeoutMs, fetchImpl });
    const products = Array.isArray(data?.products) ? data.products : [];
    return products.map((p) => normaliseOffProduct(p)).filter((f) => f && f.source_id && f.kcal !== null);
  };

  const seen = new Set();
  const merged = [];
  const add = (foods) => {
    for (const f of foods) {
      if (seen.has(f.source_id)) continue;
      seen.add(f.source_id);
      merged.push(f);
    }
  };

  if (config.offCountry) {
    add(await run(config.offCountry));
    if (merged.length >= 6 || !takeRequest()) return merged;
    try {
      add(await run(''));
    } catch {
      // The country results are still useful on their own.
    }
    return merged;
  }
  add(await run(''));
  return merged;
}
