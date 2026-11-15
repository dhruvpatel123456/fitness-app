// Tests for the main API routes, run against a real server with a throw-away
// database.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { PROFILE, TARGETS, foodBody, onboard, startApp, uuid } from './helpers.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);

const DAY = '2026-11-15';

describe('login and sessions', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(() => app.close());

  test('health check needs no login and sends security headers', async () => {
    const res = await app.get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.json.ok, true);
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(res.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  test('everything else is refused before a PIN exists', async () => {
    const status = await app.get('/api/auth/status');
    assert.deepEqual(status.json, { setup: false, authed: false });
    const res = await app.get('/api/bootstrap');
    assert.equal(res.status, 401);
    assert.equal(res.json.setup_required, true);
  });

  test('first run sets the PIN; it must be at least 4 characters', async () => {
    assert.equal((await app.post('/api/auth/setup', { pin: '12' })).status, 400);
    assert.equal((await app.post('/api/auth/setup', { pin: 1234 })).status, 400);
    const res = await app.post('/api/auth/setup', { pin: '246810' });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('tt_session='));
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.match(cookie, /Max-Age=15552000/); // 180 days
    assert.doesNotMatch(cookie, /Secure/, 'plain http must not get a Secure cookie');
    assert.equal((await app.get('/api/bootstrap')).status, 200);
  });

  test('the PIN is stored hashed, and the session token is not stored as-is', () => {
    const hash = app.db.prepare('SELECT pin_hash FROM auth').get().pin_hash;
    assert.match(hash, /^\$2[aby]\$/);
    assert.ok(!hash.includes('246810'));
    const token = app.cookie().split('=')[1];
    const stored = app.db.prepare('SELECT token_hash FROM sessions').all().map((r) => r.token_hash);
    assert.equal(stored.length, 1);
    assert.notEqual(stored[0], token);
  });

  test('setup cannot be run twice', async () => {
    const res = await app.post('/api/auth/setup', { pin: '999999' }, { noCookie: true });
    assert.equal(res.status, 409);
  });

  test('a cookie over HTTPS (behind tailscale serve) is marked Secure', async () => {
    const res = await app.post(
      '/api/auth/login',
      { pin: '246810' },
      { noCookie: true, headers: { 'X-Forwarded-Proto': 'https', 'X-Forwarded-For': '100.64.0.9' } },
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.getSetCookie().join(';'), /Secure/);
  });

  test('a wrong PIN is refused, and five wrong tries lock that address out', async () => {
    const from = { noCookie: true, headers: { 'X-Forwarded-For': '10.0.0.5' } };
    for (let i = 0; i < 5; i++) {
      const res = await app.post('/api/auth/login', { pin: 'wrong' }, from);
      assert.equal(res.status, 401);
      assert.equal(res.json.error, 'wrong_pin');
      assert.equal(res.json.attempts_left, 4 - i);
    }
    const locked = await app.post('/api/auth/login', { pin: '246810' }, from);
    assert.equal(locked.status, 429);
    assert.ok(locked.json.retry_after_s > 0);
    // Another address is not affected.
    const other = await app.post('/api/auth/login', { pin: '246810' }, { noCookie: true, headers: { 'X-Forwarded-For': '10.0.0.6' } });
    assert.equal(other.status, 200);
  });

  test('a request started by another website is refused', async () => {
    const res = await app.put('/api/settings', { theme: 'dark' }, { headers: { Origin: 'https://evil.example' } });
    assert.equal(res.status, 403);
    const own = await app.put('/api/settings', { theme: 'dark' }, { headers: { Origin: app.base } });
    assert.equal(own.status, 200);
  });

  test('changing the PIN needs the current one and signs out other devices', async () => {
    assert.equal((await app.post('/api/auth/change-pin', { current: 'nope', next: '135790' })).status, 401);
    assert.equal((await app.post('/api/auth/change-pin', { current: '246810', next: '13' })).status, 400);
    const before = app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
    assert.ok(before > 1);
    const res = await app.post('/api/auth/change-pin', { current: '246810', next: '135790' });
    assert.equal(res.status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n, 1);
    assert.equal((await app.get('/api/bootstrap')).status, 200, 'this device stays logged in');
  });

  test('logging out ends the session', async () => {
    const cookie = app.cookie();
    assert.equal((await app.post('/api/auth/logout')).status, 200);
    app.setCookie(cookie);
    assert.equal((await app.get('/api/bootstrap')).status, 401);
    const login = await app.post('/api/auth/login', { pin: '135790' }, { headers: { 'X-Forwarded-For': '10.0.0.7' } });
    assert.equal(login.status, 200);
    assert.equal((await app.get('/api/bootstrap')).status, 200);
  });

  test('unknown API routes and bad JSON give clean errors', async () => {
    assert.equal((await app.get('/api/nope')).status, 404);
    const res = await fetch(`${app.base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Cookie: app.cookie() },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'bad_json');
  });
});

describe('onboarding, goals and settings', () => {
  let app;
  before(async () => {
    app = await startApp();
    await app.setup();
  });
  after(() => app.close());

  test('a fresh app is not onboarded', async () => {
    const res = await app.get('/api/bootstrap');
    assert.equal(res.json.onboarded, false);
    assert.equal(res.json.targets, null);
    assert.deepEqual(res.json.settings.meal_names, ['Breakfast', 'Lunch', 'Dinner', 'Snacks']);
    assert.equal(res.json.settings.energy_unit, 'kcal');
  });

  test('a target under the minimum needs confirmation', async () => {
    const low = { kcal: 1300, protein_g: 97.5, carbs_g: 130, fat_g: 43.3 };
    const body = { today: DAY, profile: PROFILE, weight_kg: 80, targets: low };
    const refused = await app.put('/api/onboarding', body);
    assert.equal(refused.status, 422);
    assert.equal(refused.json.error, 'low_target');
    assert.equal(refused.json.minimum, 1500);
    assert.equal((await app.get('/api/bootstrap')).json.onboarded, false, 'nothing was saved');
    const confirmed = await app.put('/api/onboarding', { ...body, confirm_low: true });
    assert.equal(confirmed.status, 200);
    assert.equal(confirmed.json.targets.targets.kcal, 1300);
  });

  test('onboarding stores profile, weight and targets', async () => {
    const res = await app.put('/api/onboarding', { today: DAY, profile: PROFILE, weight_kg: 80, targets: TARGETS });
    assert.equal(res.status, 200);
    assert.equal(res.json.onboarded, true);
    assert.equal(res.json.profile.sex, 'male');
    assert.equal(res.json.profile.age_as_of, DAY);
    assert.deepEqual(res.json.latest_weight, { date: DAY, kg: 80 });
    assert.equal(res.json.targets.targets.kcal, 2210);
    assert.equal(res.json.targets.targets.fat_g, 73.67, 'targets are stored unrounded');
  });

  test('profile input is validated', async () => {
    const bad = [
      { ...PROFILE, sex: 'other' },
      { ...PROFILE, age: 5 },
      { ...PROFILE, age: 30.5 },
      { ...PROFILE, height_cm: -180 },
      { ...PROFILE, activity: 'lazy' },
      { ...PROFILE, weekly_goal_kg: -2 },
      { ...PROFILE, weekly_goal_kg: -0.3 },
      { ...PROFILE, goal_weight_kg: null },
    ];
    for (const profile of bad) {
      const res = await app.put('/api/profile', { today: DAY, profile });
      assert.equal(res.status, 400, JSON.stringify(profile));
    }
    assert.equal((await app.put('/api/profile', { today: DAY, profile: { ...PROFILE, age: 31 } })).status, 200);
  });

  test('a goal change does not rewrite the goal on earlier days', async () => {
    const later = '2026-11-20';
    const res = await app.put('/api/targets', {
      effective_from: later,
      targets: { kcal: 1900, protein_g: 140, carbs_g: 190, fat_g: 63 },
    });
    assert.equal(res.status, 200);
    assert.equal((await app.get(`/api/diary/${DAY}`)).json.targets.kcal, 2210);
    assert.equal((await app.get('/api/diary/2026-11-19')).json.targets.kcal, 2210);
    assert.equal((await app.get(`/api/diary/${later}`)).json.targets.kcal, 1900);
    assert.equal((await app.get('/api/diary/2026-12-25')).json.targets.kcal, 1900);
  });

  test('different targets for chosen weekdays', async () => {
    const res = await app.put('/api/targets', {
      effective_from: '2026-11-23',
      targets: {
        kcal: 2000,
        protein_g: 150,
        carbs_g: 200,
        fat_g: 66,
        weekdays: { 6: { kcal: 2400, protein_g: 150, carbs_g: 290, fat_g: 70 }, 0: null },
      },
    });
    assert.equal(res.status, 200);
    assert.equal((await app.get('/api/diary/2026-11-27')).json.targets.kcal, 2000); // Friday
    assert.equal((await app.get('/api/diary/2026-11-28')).json.targets.kcal, 2400); // Saturday
    assert.equal((await app.get('/api/diary/2026-11-29')).json.targets.kcal, 2000); // Sunday
    const bad = await app.put('/api/targets', {
      effective_from: '2026-11-23',
      targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 66, weekdays: { 9: { kcal: 1 } } },
    });
    assert.equal(bad.status, 400);
    const low = await app.put('/api/targets', {
      effective_from: '2026-11-23',
      targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 66, weekdays: { 1: { kcal: 1000, protein_g: 80, carbs_g: 100, fat_g: 30 } } },
    });
    assert.equal(low.status, 422, 'a low weekday target also needs confirmation');
  });

  test('settings are validated and saved', async () => {
    const res = await app.put('/api/settings', {
      energy_unit: 'kJ',
      meal_names: ['Brekkie', 'Lunch', 'Tea', 'Snacks'],
      water_glass_ml: 300,
      water_goal_ml: 2500,
      exercise_adds_back: false,
      theme: 'dark',
    });
    assert.equal(res.status, 200);
    assert.equal(res.json.settings.energy_unit, 'kJ');
    assert.deepEqual(res.json.settings.meal_names, ['Brekkie', 'Lunch', 'Tea', 'Snacks']);
    assert.equal(res.json.settings.exercise_adds_back, false);
    for (const bad of [
      { energy_unit: 'cal' },
      { meal_names: ['a', 'b', 'c'] },
      { meal_names: ['', 'b', 'c', 'd'] },
      { water_glass_ml: -5 },
      { water_goal_ml: 'lots' },
      { exercise_adds_back: 'yes' },
      { theme: 'neon' },
    ]) {
      assert.equal((await app.put('/api/settings', bad)).status, 400, JSON.stringify(bad));
    }
    assert.equal((await app.get('/api/bootstrap')).json.settings.water_glass_ml, 300, 'bad requests changed nothing');
  });
});

describe('foods and diary', () => {
  let app;
  let oats;
  before(async () => {
    app = await startApp();
    await onboard(app, DAY);
  });
  after(() => app.close());

  test('create a custom food; sending it twice does not duplicate it', async () => {
    const body = foodBody();
    const first = await app.post('/api/foods', body);
    assert.equal(first.status, 200);
    oats = first.json.food;
    assert.equal(oats.name, 'Rolled oats');
    assert.equal(oats.kcal, 380);
    assert.deepEqual(oats.servings, [{ label: '1 serving (40 g)', amount: 40 }]);
    const again = await app.post('/api/foods', body);
    assert.equal(again.status, 200);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM foods').get().n, 1);
  });

  test('food input is validated on the server', async () => {
    const cases = [
      foodBody({ name: '' }),
      foodBody({ name: 'x'.repeat(200) }),
      foodBody({ base_unit: 'cups' }),
      foodBody({ barcode: 'abc' }),
      foodBody({ nutrition: { kcal: -1 } }),
      foodBody({ nutrition: { kcal: 5000 } }),
      foodBody({ nutrition: { kcal: 100, protein: 150 } }),
      foodBody({ nutrition: { kcal: '100' } }),
      foodBody({ nutrition: { kcal: null } }),
      foodBody({ servings: [{ label: 'x', amount: 0 }] }),
      foodBody({ servings: [{ label: '', amount: 10 }] }),
      foodBody({ servings: 'none' }),
      foodBody({ id: 'not-an-id' }),
    ];
    for (const body of cases) {
      const res = await app.post('/api/foods', body);
      assert.equal(res.status, 400, JSON.stringify(body).slice(0, 120));
      assert.equal(res.json.error, 'validation');
    }
    // NaN and Infinity cannot be sent as JSON numbers; they arrive as null or are rejected.
    const raw = await fetch(`${app.base}/api/foods`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: app.cookie() },
      body: `{"id":"${uuid()}","name":"x","base_unit":"g","nutrition":{"kcal":NaN}}`,
    });
    assert.equal(raw.status, 400);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM foods').get().n, 1);
  });

  test('unknown nutrition values are stored as unknown, not zero', async () => {
    const res = await app.post('/api/foods', foodBody({ name: 'Mystery bar', nutrition: { kcal: 400, protein: 20 } }));
    assert.equal(res.json.food.protein, 20);
    assert.equal(res.json.food.carbs, null);
    assert.equal(res.json.food.sodium, null);
  });

  test('search finds foods by name and brand, ignoring case', async () => {
    assert.equal((await app.get('/api/foods?tab=search&q=OATS')).json.foods[0].id, oats.id);
    assert.equal((await app.get('/api/foods?tab=search&q=home%20rolled')).json.foods.length, 1);
    assert.equal((await app.get('/api/foods?tab=search&q=zzz')).json.foods.length, 0);
    assert.equal((await app.get('/api/foods?tab=search&q=')).json.foods.length, 0);
    assert.equal((await app.get("/api/foods?tab=search&q=%25'%3B--")).status, 200, 'odd characters are just text');
    assert.equal((await app.get('/api/foods?tab=mine')).json.foods.length, 2);
    assert.equal((await app.get('/api/foods?tab=bogus')).status, 400);
  });

  test('log a food to breakfast and read it back', async () => {
    const id = uuid();
    const res = await app.post('/api/diary/entries', {
      id,
      date: DAY,
      meal: 0,
      food_id: oats.id,
      unit: { label: '1 serving (40 g)', amount: 40 },
      quantity: 1.5,
    });
    assert.equal(res.status, 200);
    const entry = res.json.entry;
    assert.equal(entry.amount, 60);
    assert.equal(entry.kcal, 380, 'the entry keeps per-100 values');
    const day = (await app.get(`/api/diary/${DAY}`)).json;
    assert.equal(day.entries.length, 1);
    assert.equal(day.entries[0].id, id);
    close((day.entries[0].kcal * day.entries[0].amount) / 100, 228);
    assert.equal(day.targets.kcal, 2210);
  });

  test('a double tap (same id sent twice) creates one entry and counts one use', async () => {
    const body = { id: uuid(), date: DAY, meal: 1, food_id: oats.id, unit: { label: 'g', amount: 1 }, quantity: 50 };
    const [a, b] = await Promise.all([app.post('/api/diary/entries', body), app.post('/api/diary/entries', body)]);
    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    await app.post('/api/diary/entries', body);
    const day = (await app.get(`/api/diary/${DAY}`)).json;
    assert.equal(day.entries.filter((e) => e.id === body.id).length, 1);
    assert.equal(day.entries.length, 2);
    assert.equal(app.db.prepare('SELECT use_count FROM foods WHERE id = ?').get(oats.id).use_count, 2);
  });

  test('changing the serving, quantity or meal updates the entry', async () => {
    const entry = (await app.get(`/api/diary/${DAY}`)).json.entries[0];
    const res = await app.patch(`/api/diary/entries/${entry.id}`, { unit: { label: '100 g', amount: 100 }, quantity: 2, meal: 2 });
    assert.equal(res.status, 200);
    assert.equal(res.json.entry.amount, 200);
    assert.equal(res.json.entry.meal, 2);
    assert.equal(res.json.entry.unit_label, '100 g');
    const back = await app.patch(`/api/diary/entries/${entry.id}`, { unit: { label: '1 serving (40 g)', amount: 40 }, quantity: 1.5, meal: 0 });
    assert.equal(back.json.entry.amount, 60);
    assert.equal((await app.patch(`/api/diary/entries/${entry.id}`, { quantity: 0 })).status, 400);
    assert.equal((await app.patch(`/api/diary/entries/${entry.id}`, { quantity: -1 })).status, 400);
    assert.equal((await app.patch(`/api/diary/entries/${entry.id}`, { meal: 7 })).status, 400);
    assert.equal((await app.patch(`/api/diary/entries/${uuid()}`, { quantity: 1 })).status, 404);
  });

  test('diary input is validated', async () => {
    const good = { id: uuid(), date: DAY, meal: 0, food_id: oats.id, unit: { label: 'g', amount: 1 }, quantity: 10 };
    const cases = [
      { ...good, date: '2026-02-30' },
      { ...good, date: '15/11/2026' },
      { ...good, meal: 4 },
      { ...good, meal: 1.5 },
      { ...good, quantity: 0 },
      { ...good, quantity: -3 },
      { ...good, quantity: '2' },
      { ...good, quantity: 1e9 },
      { ...good, unit: { label: 'g', amount: -1 } },
      { ...good, unit: null },
      { ...good, id: '123' },
    ];
    for (const body of cases) assert.equal((await app.post('/api/diary/entries', body)).status, 400, JSON.stringify(body));
    assert.equal((await app.post('/api/diary/entries', { ...good, food_id: uuid() })).status, 404);
    assert.equal((await app.get('/api/diary/2026-02-30')).status, 400);
    assert.equal((await app.get(`/api/diary/${DAY}`)).json.entries.length, 2, 'bad requests added nothing');
  });

  test('editing or deleting a food does not change past diary days', async () => {
    const before = (await app.get(`/api/diary/${DAY}`)).json.entries[0];
    const edit = await app.put(`/api/foods/${oats.id}`, foodBody({ name: 'Oats (renamed)', nutrition: { kcal: 100, protein: 1, carbs: 1, fat: 1 } }));
    assert.equal(edit.status, 200);
    assert.equal(edit.json.food.kcal, 100);
    let now = (await app.get(`/api/diary/${DAY}`)).json.entries[0];
    assert.equal(now.kcal, 380);
    assert.equal(now.name, 'Rolled oats');
    assert.deepEqual(now, before);

    assert.equal((await app.del(`/api/foods/${oats.id}`)).status, 200);
    now = (await app.get(`/api/diary/${DAY}`)).json.entries[0];
    assert.deepEqual(now, before, 'the entry still shows what was eaten');
    assert.equal((await app.get('/api/foods?tab=search&q=oats')).json.foods.length, 0, 'the food is gone from search');
    assert.equal((await app.get(`/api/foods/${oats.id}`)).status, 404);
    // The entry can still be edited from its own snapshot.
    const patched = await app.patch(`/api/diary/entries/${before.id}`, { quantity: 2 });
    assert.equal(patched.json.entry.amount, 80);
    assert.equal(patched.json.entry.kcal, 380);
    // Undo the delete for the tests that follow.
    assert.equal((await app.post(`/api/foods/${oats.id}/restore`)).status, 200);
    await app.put(`/api/foods/${oats.id}`, foodBody());
    await app.patch(`/api/diary/entries/${before.id}`, { quantity: 1.5 });
  });

  test('quick add stores calories without a food', async () => {
    const id = uuid();
    const res = await app.post('/api/diary/entries', { id, date: DAY, meal: 3, quick: { name: 'Coffee out', kcal: 120, protein: 6, carbs: null, fat: null } });
    assert.equal(res.status, 200);
    const e = res.json.entry;
    assert.equal(e.kind, 'quick');
    assert.equal(e.name, 'Coffee out');
    close((e.kcal * e.amount) / 100, 120);
    close((e.protein * e.amount) / 100, 6);
    assert.equal(e.carbs, null);
    const edited = await app.patch(`/api/diary/entries/${id}`, { quick: { name: '', kcal: 150, protein: null, carbs: 10, fat: 5 } });
    assert.equal(edited.json.entry.kcal, 150);
    assert.equal(edited.json.entry.name, 'Quick add');
    assert.equal((await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 3, quick: { kcal: -5 } })).status, 400);
    assert.equal((await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 3, quick: { kcal: 1e7 } })).status, 400);
  });

  test('delete can be undone', async () => {
    const day = (await app.get(`/api/diary/${DAY}`)).json;
    const target = day.entries.find((e) => e.kind === 'quick');
    assert.equal((await app.del(`/api/diary/entries/${target.id}`)).status, 200);
    assert.equal((await app.del(`/api/diary/entries/${target.id}`)).status, 200, 'deleting twice is fine');
    assert.equal((await app.get(`/api/diary/${DAY}`)).json.entries.length, day.entries.length - 1);
    assert.equal((await app.post(`/api/diary/entries/${target.id}/restore`)).status, 200);
    assert.deepEqual((await app.get(`/api/diary/${DAY}`)).json.entries, day.entries);
  });

  test('several foods can be added at once', async () => {
    const entries = [1, 2, 3].map((q) => ({ id: uuid(), date: '2026-11-14', meal: 1, food_id: oats.id, unit: { label: 'g', amount: 1 }, quantity: q * 10 }));
    const res = await app.post('/api/diary/entries/batch', { entries });
    assert.equal(res.status, 200);
    await app.post('/api/diary/entries/batch', { entries });
    const day = (await app.get('/api/diary/2026-11-14')).json;
    assert.deepEqual(
      day.entries.map((e) => e.amount),
      [10, 20, 30],
    );
    const bad = await app.post('/api/diary/entries/batch', { entries: [entries[0], { ...entries[1], id: uuid(), quantity: -1 }] });
    assert.equal(bad.status, 400);
    assert.equal((await app.get('/api/diary/2026-11-14')).json.entries.length, 3, 'a bad batch adds nothing');
  });

  test('recent and frequent lists remember the last serving used', async () => {
    const recent = (await app.get('/api/foods?tab=recent')).json.foods;
    assert.equal(recent[0].id, oats.id);
    assert.deepEqual(recent[0].last, { label: 'g', amount: 1, quantity: 30 });
    const frequent = (await app.get('/api/foods?tab=frequent')).json.foods;
    assert.equal(frequent[0].id, oats.id);
    assert.equal(frequent[0].use_count, 5);
  });

  test('favourites', async () => {
    assert.equal((await app.put(`/api/foods/${oats.id}/favourite`, { value: true })).status, 200);
    assert.deepEqual(
      (await app.get('/api/foods?tab=favourites')).json.foods.map((f) => f.id),
      [oats.id],
    );
    assert.equal((await app.put(`/api/foods/${oats.id}/favourite`, { value: 'yes' })).status, 400);
    await app.put(`/api/foods/${oats.id}/favourite`, { value: false });
    assert.equal((await app.get('/api/foods?tab=favourites')).json.foods.length, 0);
  });

  test('copy one meal to another day, and it is safe to repeat', async () => {
    const body = { op_id: uuid(), from_date: '2026-11-14', to_date: '2026-11-16', from_meal: 1, to_meal: 2 };
    const res = await app.post('/api/diary/copy', body);
    assert.equal(res.status, 200);
    assert.equal(res.json.copied, 3);
    const again = await app.post('/api/diary/copy', body);
    assert.equal(again.json.copied, 0);
    const day = (await app.get('/api/diary/2026-11-16')).json;
    assert.equal(day.entries.length, 3);
    assert.ok(day.entries.every((e) => e.meal === 2));
    assert.deepEqual(
      day.entries.map((e) => e.amount),
      [10, 20, 30],
    );
    assert.equal((await app.get('/api/diary/2026-11-14')).json.entries.length, 3, 'the original day is untouched');
  });

  test('copy a whole day keeps each item in its meal', async () => {
    const res = await app.post('/api/diary/copy', { op_id: uuid(), from_date: DAY, to_date: '2026-11-17' });
    const source = (await app.get(`/api/diary/${DAY}`)).json.entries;
    assert.equal(res.json.copied, source.length);
    const copied = (await app.get('/api/diary/2026-11-17')).json.entries;
    assert.deepEqual(
      copied.map((e) => [e.meal, e.name, e.amount]),
      source.map((e) => [e.meal, e.name, e.amount]),
    );
    const empty = await app.post('/api/diary/copy', { op_id: uuid(), from_date: '2020-01-01', to_date: DAY });
    assert.equal(empty.status, 400);
  });

  test('entries just before and just after midnight stay on their own days', async () => {
    // The app sends the local calendar date it is showing; the server stores exactly that.
    const late = { id: uuid(), date: '2026-03-28', meal: 3, quick: { kcal: 100 } };
    const early = { id: uuid(), date: '2026-03-29', meal: 0, quick: { kcal: 200 } };
    await app.post('/api/diary/entries', late);
    await app.post('/api/diary/entries', early);
    assert.deepEqual(
      (await app.get('/api/diary/2026-03-28')).json.entries.map((e) => e.id),
      [late.id],
    );
    assert.deepEqual(
      (await app.get('/api/diary/2026-03-29')).json.entries.map((e) => e.id),
      [early.id],
    );
    const stored = app.db.prepare('SELECT date FROM diary_entries WHERE id = ?').get(late.id).date;
    assert.equal(stored, '2026-03-28', 'stored as a plain date string');
  });

  test('water and notes are kept per day', async () => {
    assert.equal((await app.put(`/api/days/${DAY}/water`, { ml: 750 })).status, 200);
    assert.equal((await app.put(`/api/days/${DAY}/water`, { ml: 750 })).status, 200);
    assert.equal((await app.put(`/api/days/${DAY}/note`, { note: 'Felt good today' })).status, 200);
    const day = (await app.get(`/api/diary/${DAY}`)).json;
    assert.equal(day.water_ml, 750);
    assert.equal(day.note, 'Felt good today');
    assert.equal((await app.get('/api/diary/2026-11-14')).json.water_ml, 0);
    assert.equal((await app.put(`/api/days/${DAY}/water`, { ml: -1 })).status, 400);
    assert.equal((await app.put(`/api/days/${DAY}/water`, { ml: 99999 })).status, 400);
    assert.equal((await app.put(`/api/days/${DAY}/note`, { note: 'x'.repeat(3000) })).status, 400);
  });
});

describe('recipes, saved meals and exercise', () => {
  let app;
  let rice;
  let chicken;
  const recipeId = uuid();
  before(async () => {
    app = await startApp();
    await onboard(app, DAY);
    rice = (await app.post('/api/foods', foodBody({ name: 'Rice, cooked', brand: null, nutrition: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3, fibre: 0.4 }, servings: [{ label: '1 cup (158 g)', amount: 158 }] }))).json.food;
    chicken = (await app.post('/api/foods', foodBody({ name: 'Chicken breast', brand: null, nutrition: { kcal: 165, protein: 31, carbs: 0, fat: 3.6 }, servings: [] }))).json.food;
  });
  after(() => app.close());

  test('a recipe works out nutrition per serving', async () => {
    const res = await app.post('/api/recipes', {
      id: recipeId,
      name: 'Chicken and rice',
      servings: 4,
      ingredients: [
        { id: uuid(), food_id: rice.id, unit: { label: '1 cup (158 g)', amount: 158 }, quantity: 2 },
        { id: uuid(), food_id: chicken.id, unit: { label: 'g', amount: 1 }, quantity: 400 },
      ],
    });
    assert.equal(res.status, 200);
    // rice: 316 g -> 410.8 kcal, 8.532 P; chicken: 400 g -> 660 kcal, 124 P
    close(res.json.per_serving.kcal, (410.8 + 660) / 4);
    close(res.json.per_serving.protein, (8.532 + 124) / 4);
    close(res.json.per_serving.carbs, 88.48 / 4);
    close(res.json.serving_weight, 716 / 4);
    assert.equal(res.json.per_serving.fibre, null, 'chicken has no fibre value, so the recipe total is unknown');
    assert.ok(res.json.missing.includes('fibre'));
    const food = res.json.food;
    assert.equal(food.source, 'recipe');
    assert.equal(food.recipe_servings, 4);
    close(food.kcal, (1070.8 / 716) * 100);
    assert.deepEqual(food.servings.map((s) => s.label), ['1 serving']);
    close(food.servings[0].amount, 179);
  });

  test('a recipe can be logged like any food', async () => {
    const res = await app.post('/api/diary/entries', {
      id: uuid(),
      date: DAY,
      meal: 2,
      food_id: recipeId,
      unit: { label: '1 serving', amount: 179 },
      quantity: 1,
    });
    assert.equal(res.status, 200);
    const e = res.json.entry;
    close((e.kcal * e.amount) / 100, 267.7);
    assert.equal((await app.get('/api/foods?tab=recipes')).json.foods.length, 1);
  });

  test('editing a recipe recalculates it; the diary keeps the old values', async () => {
    const detail = (await app.get(`/api/foods/${recipeId}`)).json.food;
    assert.equal(detail.ingredients.length, 2);
    assert.equal(detail.ingredients[0].name, 'Rice, cooked');
    assert.deepEqual(detail.ingredients[0].servings, [{ label: '1 cup (158 g)', amount: 158 }]);
    const res = await app.put(`/api/recipes/${recipeId}`, {
      name: 'Chicken and rice (big)',
      servings: 2,
      cooked_weight: 600,
      ingredients: detail.ingredients.map((i) => ({ id: i.id, food_id: i.food_id, unit: { label: i.unit_label, amount: i.unit_amount }, quantity: i.quantity })),
    });
    assert.equal(res.status, 200);
    close(res.json.per_serving.kcal, 1070.8 / 2);
    close(res.json.food.kcal, (1070.8 / 600) * 100);
    close(res.json.serving_weight, 300);
    const entry = (await app.get(`/api/diary/${DAY}`)).json.entries[0];
    close((entry.kcal * entry.amount) / 100, 267.7);
    assert.equal(entry.name, 'Chicken and rice');
  });

  test('a recipe survives one of its foods being deleted', async () => {
    await app.del(`/api/foods/${chicken.id}`);
    const detail = (await app.get(`/api/foods/${recipeId}`)).json.food;
    const res = await app.put(`/api/recipes/${recipeId}`, {
      name: detail.name,
      servings: 2,
      ingredients: detail.ingredients.map((i) => ({ id: i.id, food_id: i.food_id, unit: { label: i.unit_label, amount: i.unit_amount }, quantity: i.quantity })),
    });
    assert.equal(res.status, 200);
    close(res.json.per_serving.kcal, 1070.8 / 2);
    await app.post(`/api/foods/${chicken.id}/restore`);
  });

  test('recipe input is validated', async () => {
    const ing = { id: uuid(), food_id: rice.id, unit: { label: 'g', amount: 1 }, quantity: 100 };
    const cases = [
      { id: uuid(), name: '', servings: 2, ingredients: [ing] },
      { id: uuid(), name: 'x', servings: 0, ingredients: [ing] },
      { id: uuid(), name: 'x', servings: -1, ingredients: [ing] },
      { id: uuid(), name: 'x', servings: 2, ingredients: [] },
      { id: uuid(), name: 'x', servings: 2, ingredients: [{ ...ing, quantity: 0 }] },
      { id: uuid(), name: 'x', servings: 2, cooked_weight: -10, ingredients: [ing] },
    ];
    for (const body of cases) assert.equal((await app.post('/api/recipes', body)).status, 400, JSON.stringify(body).slice(0, 100));
    assert.equal((await app.post('/api/recipes', { id: uuid(), name: 'x', servings: 2, ingredients: [{ ...ing, food_id: uuid() }] })).status, 404);
    const self = uuid();
    await app.post('/api/recipes', { id: self, name: 'Loop', servings: 1, ingredients: [ing] });
    const loop = await app.put(`/api/recipes/${self}`, { name: 'Loop', servings: 1, ingredients: [{ id: uuid(), food_id: self, unit: { label: 'g', amount: 1 }, quantity: 10 }] });
    assert.equal(loop.status, 400);
  });

  test('save a diary meal as a saved meal and log it on another day', async () => {
    await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 0, food_id: rice.id, unit: { label: '1 cup (158 g)', amount: 158 }, quantity: 1 });
    await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 0, quick: { name: 'Sauce', kcal: 40 } });
    const mealId = uuid();
    const body = { id: mealId, name: 'Usual breakfast', from_diary: { date: DAY, meal: 0 } };
    const made = await app.post('/api/saved-meals', body);
    assert.equal(made.status, 200);
    assert.equal(made.json.saved_meal.items.length, 2);
    await app.post('/api/saved-meals', body);
    const list = (await app.get('/api/saved-meals')).json.saved_meals;
    assert.equal(list.length, 1);
    assert.equal(list[0].items.length, 2);

    const log = { op_id: uuid(), date: '2026-11-18', meal: 0 };
    const logged = await app.post(`/api/saved-meals/${mealId}/log`, log);
    assert.equal(logged.json.added, 2);
    assert.equal((await app.post(`/api/saved-meals/${mealId}/log`, log)).json.added, 0, 'repeating adds nothing');
    const day = (await app.get('/api/diary/2026-11-18')).json;
    assert.deepEqual(
      day.entries.map((e) => [e.name, e.kind]),
      [
        ['Rice, cooked', 'food'],
        ['Sauce', 'quick'],
      ],
    );
    assert.equal((await app.get('/api/saved-meals')).json.saved_meals[0].use_count, 1);
    assert.equal((await app.post('/api/saved-meals', { id: uuid(), name: 'Empty', from_diary: { date: '2020-01-01', meal: 0 } })).status, 400);
  });

  test('a saved meal can be built from foods, edited and deleted', async () => {
    const id = uuid();
    const made = await app.post('/api/saved-meals', {
      id,
      name: 'Lunch box',
      items: [{ id: uuid(), food_id: rice.id, unit: { label: 'g', amount: 1 }, quantity: 150 }],
    });
    assert.equal(made.status, 200);
    const item = made.json.saved_meal.items[0];
    assert.equal(item.amount, 150);
    const edited = await app.put(`/api/saved-meals/${id}`, {
      name: 'Lunch box v2',
      items: [
        { id: item.id, food_id: item.food_id, unit: { label: 'g', amount: 1 }, quantity: 200 },
        { id: uuid(), food_id: chicken.id, unit: { label: 'g', amount: 1 }, quantity: 120 },
      ],
    });
    assert.equal(edited.status, 200);
    assert.equal(edited.json.saved_meal.name, 'Lunch box v2');
    assert.deepEqual(
      edited.json.saved_meal.items.map((i) => i.amount),
      [200, 120],
    );
    assert.equal((await app.del(`/api/saved-meals/${id}`)).status, 200);
    assert.equal((await app.get('/api/saved-meals')).json.saved_meals.length, 1);
    assert.equal(app.db.prepare('SELECT COUNT(*) AS n FROM saved_meal_items WHERE saved_meal_id = ?').get(id).n, 0);
  });

  test('exercise is logged, edited and removed', async () => {
    const body = { id: uuid(), date: DAY, name: 'Running, 10 km/h', activity_key: 'run_10', minutes: 30, kcal: 392 };
    assert.equal((await app.post('/api/exercise', body)).status, 200);
    await app.post('/api/exercise', body);
    let day = (await app.get(`/api/diary/${DAY}`)).json;
    assert.equal(day.exercise.length, 1);
    assert.equal(day.exercise[0].kcal, 392);
    const edited = await app.put(`/api/exercise/${body.id}`, { ...body, minutes: 45, kcal: 588 });
    assert.equal(edited.json.exercise.kcal, 588);
    for (const bad of [{ ...body, id: uuid(), minutes: -5 }, { ...body, id: uuid(), kcal: -1 }, { ...body, id: uuid(), name: '' }, { ...body, id: uuid(), minutes: 5000 }]) {
      assert.equal((await app.post('/api/exercise', bad)).status, 400);
    }
    assert.equal((await app.put(`/api/exercise/${uuid()}`, body)).status, 404);
    assert.equal((await app.del(`/api/exercise/${body.id}`)).status, 200);
    day = (await app.get(`/api/diary/${DAY}`)).json;
    assert.equal(day.exercise.length, 0);
  });
});

describe('progress', () => {
  let app;
  before(async () => {
    app = await startApp();
    await onboard(app, '2026-11-10');
  });
  after(() => app.close());

  test('one weight per day; logging again replaces it', async () => {
    assert.equal((await app.put('/api/weights/2026-11-12', { kg: 79.6 })).status, 200);
    assert.equal((await app.put('/api/weights/2026-11-12', { kg: 79.4 })).status, 200);
    assert.equal((await app.put('/api/weights/2026-11-15', { kg: 79.1 })).status, 200);
    const list = (await app.get('/api/weights')).json.weights;
    assert.deepEqual(list, [
      { date: '2026-11-10', kg: 80 },
      { date: '2026-11-12', kg: 79.4 },
      { date: '2026-11-15', kg: 79.1 },
    ]);
    assert.deepEqual((await app.get('/api/bootstrap')).json.latest_weight, { date: '2026-11-15', kg: 79.1 });
    for (const kg of [0, -70, 1000, '80', null]) assert.equal((await app.put('/api/weights/2026-11-13', { kg })).status, 400);
    assert.equal((await app.put('/api/weights/2026-13-40', { kg: 80 })).status, 400);
    assert.equal((await app.del('/api/weights/2026-11-12')).status, 200);
    assert.equal((await app.get('/api/weights')).json.weights.length, 2);
  });

  test('daily statistics give intake, exercise and the goal for each day', async () => {
    const food = (await app.post('/api/foods', foodBody())).json.food;
    const add = (date, grams) => app.post('/api/diary/entries', { id: uuid(), date, meal: 0, food_id: food.id, unit: { label: 'g', amount: 1 }, quantity: grams });
    await add('2026-11-13', 100);
    await add('2026-11-14', 50);
    await add('2026-11-14', 50);
    await add('2026-11-15', 200);
    await app.post('/api/exercise', { id: uuid(), date: '2026-11-14', name: 'Walk', activity_key: 'walk', minutes: 60, kcal: 280 });
    const res = await app.get('/api/stats/daily?from=2026-11-12&to=2026-11-15');
    assert.equal(res.status, 200);
    const days = res.json.days;
    assert.deepEqual(days.map((d) => d.date), ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']);
    assert.equal(days[0].entries, 0);
    assert.equal(days[0].kcal, 0);
    close(days[1].kcal, 380);
    close(days[2].kcal, 380);
    assert.equal(days[2].entries, 2);
    assert.equal(days[2].exercise_kcal, 280);
    close(days[3].kcal, 760);
    close(days[3].protein, 26);
    assert.equal(days[3].target.kcal, 2210);
    assert.equal((await app.get('/api/stats/daily?from=2026-11-15&to=2026-11-12')).status, 400);
    assert.equal((await app.get('/api/stats/daily?from=2020-01-01&to=2026-11-12')).status, 400);
    assert.equal((await app.get('/api/stats/daily?from=nope&to=2026-11-12')).status, 400);
  });

  test('the streak counts consecutive logged days', async () => {
    assert.deepEqual((await app.get('/api/stats/streak?today=2026-11-15')).json, { streak: 3, loggedToday: true });
    assert.deepEqual((await app.get('/api/stats/streak?today=2026-11-16')).json, { streak: 3, loggedToday: false });
    assert.deepEqual((await app.get('/api/stats/streak?today=2026-11-17')).json, { streak: 0, loggedToday: false });
    assert.equal((await app.get('/api/stats/streak')).status, 400);
  });

  test('body measurements: one value per kind per day', async () => {
    const first = await app.put('/api/measurements', { id: uuid(), date: '2026-11-15', kind: 'waist', value: 92 });
    assert.equal(first.status, 200);
    const second = await app.put('/api/measurements', { id: uuid(), date: '2026-11-15', kind: 'waist', value: 91.5 });
    assert.equal(second.json.measurement.id, first.json.measurement.id);
    assert.equal(second.json.measurement.value, 91.5);
    await app.put('/api/measurements', { id: uuid(), date: '2026-11-15', kind: 'chest', value: 104 });
    assert.equal((await app.get('/api/measurements')).json.measurements.length, 2);
    for (const bad of [{ kind: 'tail', value: 10 }, { kind: 'waist', value: -3 }, { kind: 'waist', value: 5000 }, { kind: 'body_fat', value: 99 }]) {
      assert.equal((await app.put('/api/measurements', { id: uuid(), date: '2026-11-15', ...bad })).status, 400);
    }
    assert.equal((await app.del(`/api/measurements/${first.json.measurement.id}`)).status, 200);
    assert.equal((await app.get('/api/measurements')).json.measurements.length, 1);
  });
});

describe('export, import, erase and backups', () => {
  let app;
  let pin;
  before(async () => {
    app = await startApp({ env: { BACKUP_KEEP: '2' } });
    pin = await app.setup();
    await app.put('/api/onboarding', { today: DAY, profile: PROFILE, weight_kg: 80, targets: TARGETS });
    const food = (await app.post('/api/foods', foodBody({ name: 'Yoghurt, "Greek", plain' }))).json.food;
    await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 0, food_id: food.id, unit: { label: '1 serving (40 g)', amount: 40 }, quantity: 2 });
    await app.post('/api/diary/entries', { id: uuid(), date: DAY, meal: 3, quick: { name: '=cmd', kcal: 99 } });
    await app.post('/api/recipes', { id: uuid(), name: 'Bowl', servings: 2, ingredients: [{ id: uuid(), food_id: food.id, unit: { label: 'g', amount: 1 }, quantity: 300 }] });
    await app.post('/api/saved-meals', { id: uuid(), name: 'Brekkie', from_diary: { date: DAY, meal: 0 } });
    await app.post('/api/exercise', { id: uuid(), date: DAY, name: 'Walk', activity_key: 'walk', minutes: 30, kcal: 140 });
    await app.put(`/api/days/${DAY}/water`, { ml: 500 });
    await app.put(`/api/days/${DAY}/note`, { note: 'note' });
    await app.put('/api/weights/2026-11-14', { kg: 80.4 });
    await app.put('/api/measurements', { id: uuid(), date: DAY, kind: 'waist', value: 90 });
    await app.put('/api/settings', { energy_unit: 'kJ', meal_names: ['A', 'B', 'C', 'D'] });
  });
  after(() => app.close());

  const snapshot = async () => {
    const data = (await app.get('/api/export/json')).json;
    delete data.exported_at;
    return data;
  };

  test('the JSON export holds everything except the PIN', async () => {
    const res = await app.get('/api/export/json');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="tucker-tally-export-\d{4}-\d{2}-\d{2}\.json"/);
    const data = res.json;
    assert.equal(data.app, 'tucker-tally');
    assert.equal(data.tables.diary_entries.length, 2);
    assert.equal(data.tables.foods.length, 2);
    assert.equal(data.tables.recipe_ingredients.length, 1);
    assert.equal(data.tables.saved_meal_items.length, 1);
    assert.equal(data.tables.weights.length, 2);
    assert.equal(data.tables.exercise_entries.length, 1);
    assert.ok(!res.text.includes('pin_hash'));
    assert.ok(!('auth' in data.tables) && !('sessions' in data.tables));
  });

  test('the diary CSV has one row per item, with DD/MM/YYYY dates', async () => {
    const res = await app.get('/api/export/diary.csv');
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    const lines = res.text.replace(/^﻿/, '').trim().split('\r\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^Date,Meal,Food,Brand,Quantity,Unit,Amount,Amount unit,Energy \(kcal\)/);
    assert.match(lines[1], /^15\/11\/2026,A,"Yoghurt, ""Greek"", plain",Home Brand,2,1 serving \(40 g\),80,g,304,10\.4,48,6\.4,8,0\.8,1\.2,4$/);
    assert.match(lines[2], /^15\/11\/2026,D,'=cmd,,,,,,99,,,,,,,$/, 'formula-like text is neutralised and unknowns are blank');
  });

  test('export, erase, then import restores everything', async () => {
    const before = await snapshot();
    const file = (await app.get('/api/export/json')).json;

    assert.equal((await app.post('/api/wipe', { pin: 'wrong-pin' })).status, 401);
    assert.equal((await snapshot()).tables.diary_entries.length, 2, 'a wrong PIN erases nothing');
    assert.equal((await app.post('/api/wipe', { pin })).status, 200);

    const empty = await snapshot();
    for (const [table, rows] of Object.entries(empty.tables)) assert.equal(rows.length, 0, `${table} is empty`);
    const boot = (await app.get('/api/bootstrap')).json;
    assert.equal(boot.onboarded, false);
    assert.equal((await app.get(`/api/diary/${DAY}`)).json.entries.length, 0);

    assert.equal((await app.post('/api/import', { data: file })).status, 400, 'import must be confirmed');
    const res = await app.post('/api/import', { data: file, confirm: true });
    assert.equal(res.status, 200);
    assert.equal(res.json.counts.diary_entries, 2);
    assert.deepEqual(await snapshot(), before);
    const restored = (await app.get('/api/bootstrap')).json;
    assert.equal(restored.onboarded, true);
    assert.equal(restored.settings.energy_unit, 'kJ');
    assert.equal((await app.get(`/api/diary/${DAY}`)).json.entries.length, 2);
  });

  test('a bad import file changes nothing', async () => {
    const before = await snapshot();
    const good = (await app.get('/api/export/json')).json;
    const cases = [
      { nonsense: true },
      { ...good, app: 'another-app' },
      { ...good, format: 99 },
      { ...good, schema_version: 999 },
      { ...good, tables: { ...good.tables, diary_entries: 'oops' } },
      { ...good, tables: { ...good.tables, diary_entries: [{ id: 'x', date: 'not-a-date', meal: 0 }] } },
      { ...good, tables: { ...good.tables, weights: [{ date: '2026-11-01', kg: 'heavy', updated_at: 'x' }] } },
      { ...good, tables: { ...good.tables, weights: [{ date: '2026-11-01', kg: { $gt: 0 }, updated_at: 'x' }] } },
      { ...good, tables: { ...good.tables, diary_entries: good.tables.diary_entries.map((e) => ({ ...e, food_id: '00000000-0000-4000-8000-000000000000' })) } },
    ];
    for (const data of cases) {
      const res = await app.post('/api/import', { data, confirm: true });
      assert.equal(res.status, 400, JSON.stringify(data).slice(0, 80));
      assert.equal(res.json.error, 'bad_file');
    }
    assert.deepEqual(await snapshot(), before);
  });

  test('"back up now" writes a database file, and only the newest are kept', async () => {
    const first = await app.post('/api/backups');
    assert.equal(first.status, 200);
    assert.match(first.json.backup.name, /^tucker-tally-manual-\d{4}-\d{2}-\d{2}-\d{6}\.sqlite$/);
    const file = path.join(app.config.backupDir, first.json.backup.name);
    assert.ok(fs.statSync(file).size > 10000);
    assert.equal(fs.readFileSync(file).subarray(0, 15).toString(), 'SQLite format 3');

    // Make three more with different names; BACKUP_KEEP is 2 in this test.
    for (const stamp of ['2026-01-01-010101', '2026-01-02-010101', '2026-01-03-010101']) {
      const name = `tucker-tally-manual-${stamp}.sqlite`;
      fs.copyFileSync(file, path.join(app.config.backupDir, name));
      const old = new Date(`${stamp.slice(0, 10)}T01:01:01Z`);
      fs.utimesSync(path.join(app.config.backupDir, name), old, old);
    }
    await new Promise((resolve) => setTimeout(resolve, 1100));
    await app.post('/api/backups');
    const list = (await app.get('/api/backups')).json;
    assert.equal(list.keep, 2);
    assert.equal(list.backups.filter((b) => b.kind === 'manual').length, 2);
    assert.ok(list.backups.every((b) => !b.name.includes('2026-01-0')), 'the old ones were removed');
  });

  test('the automatic daily backup is made once per day', async () => {
    const made = await app.backups.ensureDaily();
    assert.match(made.name, /^tucker-tally-daily-\d{4}-\d{2}-\d{2}\.sqlite$/);
    assert.equal(await app.backups.ensureDaily(), null, 'already done today');
    assert.equal((await app.get('/api/backups')).json.backups.filter((b) => b.kind === 'daily').length, 1);
  });

  test('a backup can be downloaded, but only by its exact name', async () => {
    const name = (await app.get('/api/backups')).json.backups[0].name;
    const res = await fetch(`${app.base}/api/backups/${name}`, { headers: { Cookie: app.cookie() } });
    assert.equal(res.status, 200);
    assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 15).toString(), 'SQLite format 3');
    assert.equal((await app.get('/api/backups/..%2F..%2Fdata%2Ftucker-tally.sqlite')).status, 404);
    assert.equal((await app.get('/api/backups/tucker-tally-daily-1999-01-01.sqlite')).status, 404);
  });
});
