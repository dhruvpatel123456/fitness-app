// Combines the online food sources, with rate limiting and short-term caching.

import { NUTRIENTS } from '../../shared/nutrition.js';
import { nowIso, parseJson } from '../util.js';
import { OnlineError, createRateLimiter } from './http.js';
import { offProduct, offSearch } from './off.js';
import { usdaFood, usdaSearch } from './usda.js';

const QUERY_CACHE_MS = 10 * 60 * 1000;
const QUERY_CACHE_MAX = 200;

export function createOnline({ db, config, fetchImpl = fetch }) {
  const ctx = { config, fetchImpl };
  // Open Food Facts asks apps to stay under 10 searches and 15 product reads a minute.
  const offSearchLimiter = createRateLimiter(8, 60000);
  const offProductLimiter = createRateLimiter(12, 60000);
  const queryCache = new Map();

  function remember(food) {
    if (!food || !food.source_id) return;
    db.prepare(
      `INSERT INTO online_cache (source, source_id, data, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (source, source_id) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at`,
    ).run(food.source, food.source_id, JSON.stringify(food), nowIso());
  }

  function fromCache(source, sourceId) {
    const row = db.prepare('SELECT data FROM online_cache WHERE source = ? AND source_id = ?').get(source, sourceId);
    return row ? parseJson(row.data, null) : null;
  }

  /** The shape sent to the app for a search result that is not saved locally yet. */
  function toItem(food) {
    const item = {
      key: `${food.source}:${food.source_id}`,
      source: food.source,
      source_id: food.source_id,
      name: food.name,
      brand: food.brand,
      barcode: food.barcode,
      base_unit: food.base_unit,
      servings: food.servings || [],
      au: Boolean(food.au),
      local_id: null,
    };
    for (const k of NUTRIENTS) item[k] = food[k] ?? null;
    return item;
  }

  /** Mark results that are already saved in the local database. */
  function withLocalIds(result) {
    const find = db.prepare('SELECT id FROM foods WHERE source = ? AND source_id = ? AND deleted_at IS NULL');
    return {
      sources: result.sources,
      items: result.items.map((item) => ({ ...item, local_id: find.get(item.source, item.source_id)?.id ?? null })),
    };
  }

  async function runSource(enabled, fn) {
    if (!enabled) return { status: 'disabled', items: [] };
    try {
      return { status: 'ok', items: await fn() };
    } catch (err) {
      return { status: err instanceof OnlineError ? err.reason : 'error', items: [] };
    }
  }

  /**
   * Search every online source at once. Never throws: each source reports
   * 'ok', 'timeout', 'offline', 'rate_limited', 'error' or 'disabled'.
   */
  async function search(query) {
    const key = query.trim().toLowerCase();
    const hit = queryCache.get(key);
    if (hit && Date.now() - hit.at < QUERY_CACHE_MS) return withLocalIds(hit.result);

    const [off, usda] = await Promise.all([
      runSource(true, () => {
        if (!offSearchLimiter.tryTake()) throw new OnlineError('rate_limited');
        return offSearch(query, { ...ctx, takeRequest: () => offSearchLimiter.tryTake() });
      }),
      runSource(Boolean(config.usdaApiKey), () => usdaSearch(query, ctx)),
    ]);

    // Generic foods first, then packaged products with Australian ones leading.
    const offSorted = [...off.items].sort((a, b) => Number(b.au) - Number(a.au));
    const foods = [...usda.items, ...offSorted];
    const save = db.transaction(() => foods.forEach(remember));
    save();

    const result = { sources: { off: off.status, usda: usda.status }, items: foods.map(toItem) };
    if (off.status === 'ok' && (usda.status === 'ok' || usda.status === 'disabled')) {
      if (queryCache.size >= QUERY_CACHE_MAX) queryCache.delete(queryCache.keys().next().value);
      queryCache.set(key, { at: Date.now(), result });
    }
    return withLocalIds(result);
  }

  /** Barcode lookup. Resolves to a food or null (not in the database); throws OnlineError when unreachable. */
  async function barcode(code) {
    if (!offProductLimiter.tryTake()) throw new OnlineError('rate_limited');
    const food = await offProduct(code, ctx);
    if (food) remember(food);
    return food;
  }

  /** One food by source id: from the cache if it was seen recently, otherwise fetched again. */
  async function getOne(source, sourceId) {
    const cached = fromCache(source, sourceId);
    if (cached) return cached;
    let food = null;
    if (source === 'off') {
      if (!offProductLimiter.tryTake()) throw new OnlineError('rate_limited');
      food = await offProduct(sourceId, ctx);
    } else if (source === 'usda' && config.usdaApiKey) {
      food = await usdaFood(sourceId, ctx);
    }
    if (food) remember(food);
    return food;
  }

  function prune(days = 30) {
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    return db.prepare('DELETE FROM online_cache WHERE fetched_at < ?').run(cutoff).changes;
  }

  return { search, barcode, getOne, prune };
}
