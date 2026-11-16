// Tests for barcode lookup and online search, using a local stand-in for
// Open Food Facts and USDA FoodData Central (no internet needed).

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';
import { normaliseOffProduct } from '../server/online/off.js';
import { normaliseUsdaFood } from '../server/online/usda.js';
import { chooseAddresses, lanAddresses, servedUrl } from '../server/net.js';
import { barcodeVariants } from '../server/routes/foods.js';
import { OFF_PRODUCTS, USDA_FOODS, onboard, startApp, startMockOnline, uuid } from './helpers.js';

const close = (actual, expected, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);

describe('reading online food data', () => {
  test('Open Food Facts: a complete product', () => {
    const f = normaliseOffProduct(OFF_PRODUCTS['9300633000011']);
    assert.equal(f.source, 'off');
    assert.equal(f.source_id, '9300633000011');
    assert.equal(f.name, 'Wholegrain Biscuits');
    assert.equal(f.brand, 'Aussie Mills');
    assert.equal(f.base_unit, 'g');
    assert.equal(f.kcal, 356);
    assert.equal(f.fibre, 11);
    close(f.sodium, 270); // 0.27 g -> mg
    assert.equal(f.au, true);
    assert.deepEqual(f.servings, [
      { label: '1 serving (2 biscuits (30 g))', amount: 30 },
      { label: '1 pack (375 g)', amount: 375 },
    ]);
  });

  test('Open Food Facts: kJ is converted to kcal, missing values stay unknown', () => {
    const f = normaliseOffProduct(OFF_PRODUCTS['9310072000220']);
    close(f.kcal, 180 / 4.184);
    assert.equal(f.base_unit, 'ml');
    assert.equal(f.protein, null);
    assert.equal(f.fat, null);
    assert.equal(f.fibre, null);
    assert.equal(f.carbs, 9.5);
    close(f.sodium, 4); // 0.01 g salt / 2.5 -> 4 mg sodium
    assert.equal(f.servings[0].amount, 250);
  });

  test('Open Food Facts: per-serving values are converted to per 100', () => {
    const f = normaliseOffProduct(OFF_PRODUCTS['0041220576555']);
    close(f.kcal, 500);
    close(f.protein, (2 / 28) * 100);
    close(f.fat, 25);
    assert.equal(f.au, false);
  });

  test('Open Food Facts: impossible values are dropped, nameless products skipped', () => {
    const f = normaliseOffProduct({ code: '1', product_name: 'Odd', nutriments: { 'energy-kcal_100g': 4000, proteins_100g: -3, fat_100g: '12,5' } });
    assert.equal(f.kcal, null);
    assert.equal(f.protein, null);
    assert.equal(f.fat, 12.5);
    assert.equal(normaliseOffProduct({ code: '2', nutriments: {} }), null);
    assert.equal(normaliseOffProduct(null), null);
    assert.equal(normaliseOffProduct({ code: '3', brands: 'Acme' }).name, 'Acme product');
  });

  test('USDA: nutrients are read by id, in both response shapes', () => {
    const f = normaliseUsdaFood(USDA_FOODS[0]);
    assert.equal(f.source, 'usda');
    assert.equal(f.source_id, '173944');
    assert.equal(f.name, 'Bananas, raw');
    assert.equal(f.kcal, 89);
    assert.equal(f.sugar, 12.2);
    assert.equal(f.sodium, 1);
    assert.deepEqual(f.servings, [{ label: '1 medium (118 g)', amount: 118 }]);
    const detail = normaliseUsdaFood({
      fdcId: 1,
      description: 'Test food',
      foodNutrients: [{ nutrient: { id: 1062 }, amount: 418.4 }, { nutrient: { id: 1003 }, amount: 5 }],
      foodPortions: [{ amount: 1, modifier: 'cup', gramWeight: 240, measureUnit: { name: 'undetermined' } }],
    });
    close(detail.kcal, 100, 1e-9); // only kJ listed
    assert.equal(detail.protein, 5);
    assert.equal(detail.carbs, null);
    assert.equal(detail.servings[0].amount, 240);
  });

  test('USDA: Foundation foods give energy by Atwater factors; shouting names are tidied', () => {
    const f = normaliseUsdaFood(USDA_FOODS[1]);
    assert.equal(f.kcal, 519);
    assert.equal(f.name, 'Banana chips');
    assert.equal(f.fibre, null);
    assert.equal(normaliseUsdaFood({ description: 'no id' }), null);
  });

  test('a barcode is matched with or without leading zeros', () => {
    assert.ok(barcodeVariants('012345678905').includes('0012345678905'));
    assert.ok(barcodeVariants('0012345678905').includes('012345678905'));
    assert.ok(barcodeVariants('12345678905').includes('012345678905'));
  });
});

describe('barcode lookup and online search', () => {
  let app;
  let mock;
  before(async () => {
    mock = await startMockOnline();
    app = await startApp({
      env: { OFF_BASE_URL: mock.url, USDA_BASE_URL: mock.url, USDA_API_KEY: 'TESTKEY', OFF_COUNTRY: 'australia', ONLINE_TIMEOUT_MS: '400' },
    });
    await onboard(app);
  });
  after(async () => {
    await app.close();
    await mock.close();
  });

  test('a scanned product is found online and saved locally', async () => {
    const res = await app.get('/api/barcode/9300633000011');
    assert.equal(res.status, 200);
    assert.equal(res.json.status, 'found');
    assert.equal(res.json.origin, 'online');
    assert.equal(res.json.food.name, 'Wholegrain Biscuits');
    assert.equal(res.json.food.barcode, '9300633000011');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM foods WHERE source = 'off'").get().n, 1);
  });

  test('the same barcode then works with the internet off', async () => {
    mock.state.down = true;
    const res = await app.get('/api/barcode/9300633000011');
    assert.equal(res.json.status, 'found');
    assert.equal(res.json.origin, 'local');
    // …and it can be logged.
    const log = await app.post('/api/diary/entries', {
      id: uuid(),
      date: '2026-11-15',
      meal: 3,
      food_id: res.json.food.id,
      unit: { label: '1 serving (2 biscuits (30 g))', amount: 30 },
      quantity: 1,
    });
    assert.equal(log.status, 200);
    close((log.json.entry.kcal * log.json.entry.amount) / 100, 106.8);
    mock.state.down = false;
  });

  test('an unknown barcode says so, so the app can open the create-food form', async () => {
    const res = await app.get('/api/barcode/4000000000006');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { status: 'not_found', barcode: '4000000000006' });
  });

  test('a custom food with a barcode is found without going online', async () => {
    const before = mock.state.requests.length;
    await app.post('/api/foods', { id: uuid(), name: 'My muesli', barcode: '4000000000006', base_unit: 'g', nutrition: { kcal: 400 }, servings: [] });
    const res = await app.get('/api/barcode/4000000000006');
    assert.equal(res.json.status, 'found');
    assert.equal(res.json.origin, 'local');
    assert.equal(res.json.food.name, 'My muesli');
    assert.equal(mock.state.requests.length, before);
  });

  test('a slow or broken food database gives a clear answer within the time limit', async () => {
    mock.state.slowMs = 1500;
    const started = Date.now();
    const slow = await app.get('/api/barcode/9310072000220');
    assert.equal(slow.status, 200);
    assert.deepEqual(slow.json, { status: 'unavailable', reason: 'timeout', barcode: '9310072000220' });
    assert.ok(Date.now() - started < 1200, 'gave up at the time limit instead of hanging');
    mock.state.slowMs = 0;
    mock.state.down = true;
    const down = await app.get('/api/barcode/9310072000220');
    assert.deepEqual(down.json, { status: 'unavailable', reason: 'error', barcode: '9310072000220' });
    mock.state.down = false;
    assert.equal((await app.get('/api/barcode/12ab')).status, 400);
  });

  test('a product that lists only kJ is stored in kcal', async () => {
    const res = await app.get('/api/barcode/9310072000220');
    assert.equal(res.json.status, 'found');
    close(res.json.food.kcal, 180 / 4.184);
    assert.equal(res.json.food.base_unit, 'ml');
    assert.equal(res.json.food.protein, null, 'unknown, not zero');
  });

  test('online search returns generic foods and packaged products, Australian first', async () => {
    const res = await app.get('/api/search/online?q=banana');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json.sources, { off: 'ok', usda: 'ok' });
    assert.deepEqual(
      res.json.items.map((i) => i.name),
      ['Bananas, raw', 'Banana chips'],
    );
    assert.equal(res.json.items[0].local_id, null);

    const chips = await app.get('/api/search/online?q=co');
    const names = chips.json.items.filter((i) => i.source === 'off').map((i) => i.name);
    assert.deepEqual(names, ['Corn Chips'], 'found worldwide when Australia has no match');
    const asked = mock.state.requests.filter((r) => r.startsWith('/cgi/search.pl') && r.includes('search_terms=co&'));
    assert.equal(asked.length, 2);
    assert.match(asked[0], /tag_0=australia/);
    assert.doesNotMatch(asked[1], /tag_0=/);
  });

  test('a search result is saved to the local database on first use', async () => {
    const item = (await app.get('/api/search/online?q=banana')).json.items[0];
    const body = { id: uuid(), source: item.source, source_id: item.source_id };
    const adopted = await app.post('/api/foods/adopt', body);
    assert.equal(adopted.status, 200);
    assert.equal(adopted.json.food.id, body.id);
    assert.equal(adopted.json.food.kcal, 89);
    const again = await app.post('/api/foods/adopt', { ...body, id: uuid() });
    assert.equal(again.json.food.id, body.id, 'adopting twice gives the same food');
    assert.equal(app.db.prepare("SELECT COUNT(*) AS n FROM foods WHERE source = 'usda'").get().n, 1);
    // Local search now finds it, and the online results point at the saved copy.
    assert.equal((await app.get('/api/foods?tab=search&q=banana')).json.foods[0].id, body.id);
    assert.equal((await app.get('/api/search/online?q=banana')).json.items[0].local_id, body.id);
    assert.equal((await app.post('/api/foods/adopt', { id: uuid(), source: 'ftp', source_id: '1' })).status, 400);
  });

  test('a deleted online food comes back when it is used again', async () => {
    const food = (await app.get('/api/foods?tab=search&q=banana')).json.foods[0];
    await app.del(`/api/foods/${food.id}`);
    assert.equal((await app.get('/api/foods?tab=search&q=banana')).json.foods.length, 0);
    const again = await app.post('/api/foods/adopt', { id: uuid(), source: 'usda', source_id: food.source_id });
    assert.equal(again.status, 200);
    assert.equal(again.json.food.id, food.id);
  });

  test('when the internet is down, search answers quickly with a notice instead of failing', async () => {
    mock.state.down = true;
    const res = await app.get('/api/search/online?q=biscuits');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { sources: { off: 'error', usda: 'error' }, items: [] });
    mock.state.down = false;
    mock.state.slowMs = 1500;
    const started = Date.now();
    const slow = await app.get('/api/search/online?q=wholegrain');
    assert.deepEqual(slow.json.sources, { off: 'timeout', usda: 'timeout' });
    assert.ok(Date.now() - started < 1200);
    mock.state.slowMs = 0;
    // Local search is unaffected.
    assert.equal((await app.get('/api/foods?tab=search&q=wholegrain')).json.foods.length, 1);
    assert.deepEqual((await app.get('/api/search/online?q=a')).json.sources, { off: 'skipped', usda: 'skipped' });
  });

  test('searches are held back before the food database would block the app', async () => {
    let limited = 0;
    for (let i = 0; i < 12; i++) {
      const res = await app.get(`/api/search/online?q=biscuit${i}`);
      assert.equal(res.status, 200);
      if (res.json.sources.off === 'rate_limited') limited += 1;
    }
    assert.ok(limited >= 1, 'some searches were held back');
  });
});

describe('one time limit for a whole search', () => {
  let app;
  let mock;
  before(async () => {
    mock = await startMockOnline();
    app = await startApp({
      env: { OFF_BASE_URL: mock.url, USDA_BASE_URL: mock.url, USDA_API_KEY: 'TESTKEY', OFF_COUNTRY: 'australia', ONLINE_TIMEOUT_MS: '400' },
    });
    await onboard(app);
  });
  after(async () => {
    await app.close();
    await mock.close();
  });

  test('a slow first answer does not earn the wider search a second full wait', async () => {
    // Each request takes 300 ms. The Australian search answers in time but finds little, so the app
    // would normally search the whole world too; that would double the wait (600 ms) past the limit.
    mock.state.slowMs = 300;
    const started = Date.now();
    const res = await app.get('/api/search/online?q=biscuits');
    const took = Date.now() - started;
    assert.equal(res.json.sources.off, 'ok');
    assert.ok(res.json.items.some((i) => i.name === 'Wholegrain Biscuits'), 'the Australian results are still returned');
    assert.ok(took < 480, `the whole search stayed near one time limit (took ${took} ms)`);
    mock.state.slowMs = 0;
  });

  test('with a quick answer the wider search still runs', async () => {
    const res = await app.get('/api/search/online?q=juice');
    assert.equal(res.json.sources.off, 'ok');
    assert.ok(res.json.items.length >= 1);
  });
});

describe('without a USDA key, and with an unreachable address', () => {
  let app;
  before(async () => {
    // Port 9 on this machine refuses connections: the "no internet" case.
    app = await startApp({ env: { OFF_BASE_URL: 'http://127.0.0.1:9', USDA_BASE_URL: 'http://127.0.0.1:9', USDA_API_KEY: '', ONLINE_TIMEOUT_MS: '400' } });
    await onboard(app);
  });
  after(() => app.close());

  test('USDA is skipped, and no connection is reported as offline', async () => {
    assert.equal((await app.get('/api/bootstrap')).json.usda_enabled, false);
    const res = await app.get('/api/search/online?q=banana');
    assert.equal(res.status, 200);
    assert.deepEqual(res.json, { sources: { off: 'offline', usda: 'disabled' }, items: [] });
    const scan = await app.get('/api/barcode/9300633000011');
    assert.deepEqual(scan.json, { status: 'unavailable', reason: 'offline', barcode: '9300633000011' });
  });
});

describe('addresses shown at startup', () => {
  test('home network addresses are listed, Tailscale and loopback are not', () => {
    const found = lanAddresses({
      lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
      tailscale0: [{ family: 'IPv4', internal: false, address: '100.101.102.103' }],
      eth0: [{ family: 'IPv4', internal: false, address: '203.0.113.9' }],
      wlan0: [
        { family: 'IPv6', internal: false, address: 'fe80::1' },
        { family: 'IPv4', internal: false, address: '192.168.1.23' },
      ],
    });
    assert.deepEqual(found, ['192.168.1.23', '203.0.113.9']);
  });

  test('the Tailscale serve address for this port is recognised', () => {
    const serve = {
      TCP: { 443: { HTTPS: true } },
      Web: { 'laptop.tail1234.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:3000' } } } },
    };
    assert.equal(servedUrl(serve, 3000), 'https://laptop.tail1234.ts.net');
    assert.equal(servedUrl(serve, 3001), null);
    assert.equal(servedUrl({ Web: { 'laptop.tail1234.ts.net:8443': { Handlers: { '/': { Proxy: 'http://localhost:3000/' } } } } }, 3000), 'https://laptop.tail1234.ts.net:8443');
    assert.equal(servedUrl({}, 3000), null);
    assert.equal(servedUrl(null, 3000), null);
  });

  test('the QR code points at the secure address when there is one', () => {
    const config = { port: 3000, httpsPort: 3443, publicUrl: '' };
    const lan = ['192.168.1.23'];
    assert.equal(chooseAddresses({ config, lan, tailscale: null, httpsEnabled: false }).qrTarget, 'http://192.168.1.23:3000');
    assert.equal(chooseAddresses({ config, lan, tailscale: { servingUrl: 'https://laptop.tail1234.ts.net' }, httpsEnabled: false }).qrTarget, 'https://laptop.tail1234.ts.net');
    assert.equal(chooseAddresses({ config, lan, tailscale: null, httpsEnabled: true }).qrTarget, 'https://192.168.1.23:3443');
    assert.equal(chooseAddresses({ config: { ...config, publicUrl: 'https://my.example' }, lan, tailscale: null, httpsEnabled: true }).qrTarget, 'https://my.example');
    assert.equal(chooseAddresses({ config, lan: [], tailscale: null, httpsEnabled: false }).qrTarget, 'http://localhost:3000');
  });
});
