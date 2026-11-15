// Test helpers: start the app on a spare port with a throw-away database,
// and a stand-in for the online food databases.

import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { migrate, openDb } from '../server/db.js';

export const uuid = () => randomUUID();

const silent = { log() {}, error() {}, warn() {} };

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

/**
 * Start a fresh copy of the app. Returns helpers to call it; cookies set by
 * the server are remembered like a browser would.
 */
export async function startApp({ env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tucker-test-'));
  const config = loadConfig({
    DATA_DIR: path.join(dir, 'data'),
    BACKUP_DIR: path.join(dir, 'backups'),
    BCRYPT_ROUNDS: '4',
    ...env,
  });
  config.distDir = path.join(dir, 'no-dist');
  const db = openDb(config.dbFile);
  migrate(db);
  const { app, backups } = createApp({ db, config, log: silent });
  const server = http.createServer(app);
  await listen(server);
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';

  async function call(method, urlPath, body, { headers = {}, noCookie = false } = {}) {
    const res = await fetch(base + urlPath, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie && !noCookie ? { Cookie: cookie } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    for (const line of res.headers.getSetCookie()) {
      const m = /^tt_session=([^;]*)/.exec(line);
      if (m && !noCookie) cookie = m[1] ? `tt_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json, text, headers: res.headers };
  }

  return {
    base,
    db,
    config,
    backups,
    call,
    get: (p, opts) => call('GET', p, undefined, opts),
    post: (p, body, opts) => call('POST', p, body ?? {}, opts),
    put: (p, body, opts) => call('PUT', p, body ?? {}, opts),
    patch: (p, body, opts) => call('PATCH', p, body ?? {}, opts),
    del: (p, opts) => call('DELETE', p, undefined, opts),
    cookie: () => cookie,
    setCookie: (value) => {
      cookie = value;
    },
    /** Choose a PIN and log in (first-run setup). */
    async setup(pin = '246810') {
      const res = await call('POST', '/api/auth/setup', { pin });
      if (res.status !== 200) throw new Error(`setup failed: ${res.status} ${res.text}`);
      return pin;
    },
    async close() {
      backups.stop();
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      });
      db.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---- stand-in for Open Food Facts and USDA ------------------------------------

export const OFF_PRODUCTS = {
  // An Australian product with full data.
  '9300633000011': {
    code: '9300633000011',
    product_name: 'Wholegrain Biscuits',
    brands: 'Aussie Mills, Other Brand',
    quantity: '375 g',
    product_quantity: 375,
    product_quantity_unit: 'g',
    serving_size: '2 biscuits (30 g)',
    serving_quantity: 30,
    serving_quantity_unit: 'g',
    countries_tags: ['en:australia'],
    nutriments: {
      'energy-kcal_100g': 356,
      energy_100g: 1490,
      proteins_100g: 12.4,
      carbohydrates_100g: 67,
      fat_100g: 1.3,
      fiber_100g: 11,
      sugars_100g: 2.8,
      'saturated-fat_100g': 0.3,
      sodium_100g: 0.27,
    },
  },
  // Lists energy in kJ only, and several values are missing.
  '9310072000220': {
    code: '9310072000220',
    product_name: 'Orange Juice',
    brands: 'Sunny',
    quantity: '2 L',
    serving_size: '250 ml',
    serving_quantity: 250,
    serving_quantity_unit: 'ml',
    countries_tags: ['en:australia'],
    nutriments: { energy_100g: 180, 'energy-kj_100g': 180, carbohydrates_100g: 9.5, sugars_100g: 8.2, salt_100g: 0.01 },
  },
  // Sold overseas, values only per serving.
  '0041220576555': {
    code: '0041220576555',
    product_name: 'Corn Chips',
    brands: 'Crunch Co',
    serving_size: '28 g',
    serving_quantity: 28,
    countries_tags: ['en:united-states'],
    nutriments: { 'energy-kcal_serving': 140, proteins_serving: 2, carbohydrates_serving: 18, fat_serving: 7 },
  },
};

export const USDA_FOODS = [
  {
    fdcId: 173944,
    description: 'Bananas, raw',
    dataType: 'SR Legacy',
    foodNutrients: [
      { nutrientId: 1008, value: 89 },
      { nutrientId: 1003, value: 1.09 },
      { nutrientId: 1004, value: 0.33 },
      { nutrientId: 1005, value: 22.8 },
      { nutrientId: 1079, value: 2.6 },
      { nutrientId: 2000, value: 12.2 },
      { nutrientId: 1258, value: 0.112 },
      { nutrientId: 1093, value: 1 },
    ],
    foodMeasures: [
      { disseminationText: '1 medium', gramWeight: 118 },
      { disseminationText: 'Quantity not specified', gramWeight: 126 },
    ],
  },
  {
    // A Foundation food: energy is only given by the Atwater factors (2047/2048).
    fdcId: 2346411,
    description: 'BANANA CHIPS',
    dataType: 'Foundation',
    foodNutrients: [
      { nutrientId: 2047, value: 519 },
      { nutrientId: 1003, value: 2.3 },
      { nutrientId: 1004, value: 33.6 },
      { nutrientId: 1005, value: 58.4 },
    ],
    foodMeasures: [],
  },
];

/**
 * A local server that answers like Open Food Facts and USDA FoodData Central.
 * `state` lets a test break it: state.down = true (errors), state.slowMs.
 */
export async function startMockOnline() {
  const state = { down: false, slowMs: 0, requests: [] };
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock');
    state.requests.push(url.pathname + url.search);
    if (state.slowMs) await new Promise((resolve) => setTimeout(resolve, state.slowMs));
    const send = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (state.down) return send(500, { error: 'down' });

    const product = /^\/api\/v2\/product\/(\d+)\.json$/.exec(url.pathname);
    if (product) {
      const p = OFF_PRODUCTS[product[1]];
      return p ? send(200, { status: 1, product: p }) : send(404, { status: 0, status_verbose: 'product not found' });
    }
    if (url.pathname === '/cgi/search.pl') {
      const term = (url.searchParams.get('search_terms') || '').toLowerCase();
      const country = url.searchParams.get('tag_0');
      const products = Object.values(OFF_PRODUCTS).filter((p) => {
        if (!`${p.product_name} ${p.brands}`.toLowerCase().includes(term)) return false;
        return country ? p.countries_tags.includes(`en:${country}`) : true;
      });
      return send(200, { count: products.length, products });
    }
    if (url.pathname === '/fdc/v1/foods/search') {
      if (url.searchParams.get('api_key') !== 'TESTKEY') return send(403, { error: 'API_KEY_INVALID' });
      const term = (url.searchParams.get('query') || '').toLowerCase();
      return send(200, { foods: USDA_FOODS.filter((f) => f.description.toLowerCase().includes(term)) });
    }
    const food = /^\/fdc\/v1\/food\/(\d+)$/.exec(url.pathname);
    if (food) {
      const f = USDA_FOODS.find((x) => String(x.fdcId) === food[1]);
      if (!f) return send(404, {});
      // The detail endpoint uses a different shape from search.
      return send(200, {
        fdcId: f.fdcId,
        description: f.description,
        foodNutrients: f.foodNutrients.map((n) => ({ nutrient: { id: n.nutrientId }, amount: n.value })),
        foodPortions: [{ amount: 1, modifier: 'medium', gramWeight: 118, measureUnit: { name: 'undetermined' } }],
      });
    }
    return send(404, { error: 'unknown path' });
  });
  await listen(server);
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    state,
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections?.();
      }),
  };
}

export const PROFILE = {
  sex: 'male',
  age: 30,
  height_cm: 180,
  goal_weight_kg: 75,
  activity: 'moderate',
  weekly_goal_kg: -0.5,
};

export const TARGETS = { kcal: 2210, protein_g: 165.75, carbs_g: 221, fat_g: 73.67 };

/** Set up a PIN and complete onboarding. */
export async function onboard(app, today = '2026-11-15') {
  await app.setup();
  const res = await app.put('/api/onboarding', { today, profile: PROFILE, weight_kg: 80, targets: TARGETS });
  if (res.status !== 200) throw new Error(`onboarding failed: ${res.status} ${res.text}`);
  return res.json;
}

export function foodBody(overrides = {}) {
  return {
    id: uuid(),
    name: 'Rolled oats',
    brand: 'Home Brand',
    barcode: null,
    base_unit: 'g',
    nutrition: { kcal: 380, protein: 13, carbs: 60, fat: 8, fibre: 10, sugar: 1, sat_fat: 1.5, sodium: 5 },
    servings: [{ label: '1 serving (40 g)', amount: 40 }],
    ...overrides,
  };
}
