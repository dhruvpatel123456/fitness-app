// End-to-end check: drives the app the way a phone user would, in an
// emulated phone browser (Chromium via Playwright).
//
// This is a developer tool, not part of `npm test`. It needs Playwright
// installed, the app running with a FRESH database, and the stand-in food
// databases (tests/e2e/mock-online.mjs). See tests/e2e/README.md.
//
//   APP_URL=http://localhost:3100 node tests/e2e/phone-flows.cjs
//
// Optional:
//   LAN_URL=http://192.168.1.23:3100   also check the plain-http (insecure) behaviour
//   BARCODE_VIDEO=/path/to/barcode.mjpeg  a video of barcode 9300633000011 for the fake camera
//   SHOTS=/path/to/folder               where to save screenshots

const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const APP = process.env.APP_URL || 'http://localhost:3100';
const LAN = process.env.LAN_URL || '';
const VIDEO = process.env.BARCODE_VIDEO || '';
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
const PIN = '246810';
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const problems = [];
let expectNetworkErrors = false;

function watch(page, label) {
  page.on('pageerror', (e) => problems.push(`${label} PAGE ERROR: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    if (expectNetworkErrors && /Failed to load resource|net::ERR|ERR_INTERNET_DISCONNECTED/i.test(text)) return;
    problems.push(`${label} CONSOLE ERROR: ${text}`);
  });
}

async function step(name, fn, page) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: String(err.message || err).split('\n')[0] });
    console.log(`  FAIL ${name}\n       ${String(err.message || err).split('\n').slice(0, 4).join('\n       ')}`);
    if (page) {
      await page.screenshot({ path: path.join(SHOTS, `fail-${name.replace(/[^a-z0-9]+/gi, '-').slice(0, 50)}.png`) }).catch(() => {});
      // Close any screens left open so one failure does not cascade into the next flows.
      for (let i = 0; i < 8 && (await page.locator('[role="dialog"]').count().catch(() => 0)) > 0; i++) {
        await page.goBack().catch(() => {});
        await page.waitForTimeout(150);
      }
    }
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message);
}

/** The big "Add to <meal>" button on a food's detail screen (not "Add to favourites"). */
const ADD_TO_MEAL = /^Add to (Breakfast|Lunch|Dinner|Snacks)$/;

/** Screenshot after letting slide-in animations settle. */
async function snap(page, file) {
  await page.waitForTimeout(450);
  await page.screenshot({ path: path.join(SHOTS, file) });
}

const near = (a, b, tol = 1.01) => Math.abs(a - b) <= tol;

/** The screen on top (a page or sheet), or the whole page when only the tabs are showing. */
const top = (page) => page.locator('[role="dialog"]').last();

async function summary(page) {
  const label = await page.locator('[aria-label^="Goal "]').first().getAttribute('aria-label');
  const nums = label.match(/-?[\d,]+(\.\d+)?/g).map((n) => Number(n.replace(/,/g, '')));
  return { goal: nums[0], food: nums[1], exercise: nums[2], remaining: nums[3], label };
}

async function api(page, method, url, body) {
  return page.evaluate(
    async ([m, u, b]) => {
      const res = await fetch(u, { method: m, headers: b ? { 'Content-Type': 'application/json' } : undefined, body: b ? JSON.stringify(b) : undefined });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, url, body],
  );
}

async function login(page) {
  await page.getByLabel('PIN', { exact: true }).fill(PIN);
  await page.getByRole('button', { name: 'Unlock' }).click();
  await page.getByRole('tab', { name: 'Diary' }).waitFor();
}

const phone = { ...devices['iPhone 13'], deviceScaleFactor: 1, locale: 'en-AU', timezoneId: 'Australia/Sydney' };

async function main() {
  const browser = await chromium.launch({
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', ...(VIDEO ? [`--use-file-for-fake-video-capture=${VIDEO}`] : [])],
  });

  // =========================================================================
  // 1. Main flow on the secure address
  // =========================================================================
  const ctx = await browser.newContext({ ...phone, permissions: ['camera'] });
  const page = await ctx.newPage();
  watch(page, 'main');
  const shot = async (n) => {
    await page.waitForTimeout(450); // let slide-in animations settle
    await page.screenshot({ path: path.join(SHOTS, `${n}.png`) });
  };
  const addButton = page.locator('nav button[aria-label="Add food"]');
  const back = async () => {
    await top(page).getByRole('button', { name: /^(Back|Close)$/ }).first().click();
  };
  const toDiary = async () => {
    while ((await page.locator('[role="dialog"]').count()) > 0) {
      await page.goBack();
      await page.waitForTimeout(120);
    }
    // (Tapping the Diary tab while already on it jumps back to today, so only tap it when needed.)
    const diaryTab = page.getByRole('tab', { name: 'Diary' });
    if ((await diaryTab.getAttribute('aria-selected')) !== 'true') await diaryTab.click();
  };

  console.log('\nMain flow');
  await step(
    'first run: set PIN, answer onboarding, land on the diary',
    async () => {
      await page.goto(APP);
      await page.getByLabel('PIN or password').fill(PIN);
      await page.getByLabel('Type it again').fill(PIN);
      await page.getByRole('button', { name: /Set PIN/ }).click();
      await page.getByRole('tab', { name: 'Male', exact: true }).click();
      await page.getByRole('textbox', { name: 'Age' }).fill('30');
      await page.getByRole('textbox', { name: 'Height' }).fill('180');
      await page.getByRole('textbox', { name: 'Current weight' }).fill('80');
      await page.getByRole('button', { name: 'Next' }).click();
      await page.getByRole('textbox', { name: 'Goal weight' }).fill('75');
      await page.getByText('Active', { exact: true }).click();
      await page.getByRole('button', { name: 'Next' }).click();
      assert((await page.getByRole('textbox', { name: 'Daily energy target' }).inputValue()) === '2210', 'suggested target should be 2210');
      await page.getByRole('button', { name: 'Start tracking' }).click();
      await page.getByRole('tab', { name: 'Diary' }).waitFor();
      const s = await summary(page);
      assert(s.goal === 2210 && s.food === 0 && s.remaining === 2210, `unexpected summary: ${s.label}`);
    },
    page,
  );

  await step(
    'create a custom food and add it; the totals update',
    async () => {
      await addButton.click();
      await top(page).getByRole('button', { name: 'Create a food' }).click();
      const form = top(page);
      await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Rolled oats');
      await form.getByRole('textbox', { name: 'Brand' }).fill('Home Brand');
      await form.getByRole('button', { name: 'Add a serving size' }).click();
      await form.getByRole('textbox', { name: 'Serving name' }).fill('1 bowl');
      await form.getByRole('textbox', { name: 'Serving size' }).fill('40');
      await form.getByRole('textbox', { name: 'Energy' }).fill('380');
      await form.getByRole('textbox', { name: 'Protein' }).fill('13');
      await form.getByRole('textbox', { name: 'Carbohydrate' }).fill('60');
      await form.getByRole('textbox', { name: 'Fat', exact: true }).fill('8');
      await shot('10-food-form');
      await form.getByRole('button', { name: 'Save food' }).click();
      const detail = top(page);
      await detail.getByRole('heading', { name: 'Rolled oats' }).waitFor();
      await shot('11-food-detail');
      assert((await detail.getByRole('combobox', { name: 'Serving size' }).locator('option:checked').innerText()).includes('1 bowl (40 g)'), 'default serving should be the bowl');
      await detail.getByRole('button', { name: ADD_TO_MEAL }).click();
      await page.getByRole('button', { name: /Rolled oats/ }).first().waitFor();
      const s = await summary(page);
      assert(near(s.food, 152), `food should be 152, got ${s.food}`);
      assert(near(s.remaining, 2058), `remaining should be 2058, got ${s.remaining}`);
    },
    page,
  );

  await step(
    'tap the entry, change the serving, totals update',
    async () => {
      await page.getByRole('button', { name: /Rolled oats/ }).first().click();
      const sheet = top(page);
      await sheet.getByRole('textbox', { name: 'Number of servings' }).fill('2');
      await shot('12-entry-sheet');
      await sheet.getByRole('button', { name: 'Save' }).click();
      await page.waitForTimeout(400);
      let s = await summary(page);
      assert(near(s.food, 304), `food should be 304 after 2 bowls, got ${s.food}`);
      // Switch to grams: the amount carries over (80 g), then set 100 g.
      await page.getByRole('button', { name: /Rolled oats/ }).first().click();
      const again = top(page);
      await again.getByRole('combobox', { name: 'Serving size' }).selectOption({ label: 'g (type the amount)' });
      assert((await again.getByRole('textbox', { name: 'Amount in g' }).inputValue()) === '80', 'switching to grams should keep the total (80 g)');
      await again.getByRole('textbox', { name: 'Amount in g' }).fill('100');
      await again.getByRole('button', { name: 'Save' }).click();
      await page.waitForTimeout(400);
      s = await summary(page);
      assert(near(s.food, 380), `food should be 380 for 100 g, got ${s.food}`);
    },
    page,
  );

  await step(
    'search: own foods first, then online; add a generic (USDA) food',
    async () => {
      await addButton.click();
      const add = top(page);
      await add.getByPlaceholder('Search foods').fill('oat');
      await add.getByRole('button', { name: /^Add Rolled oats to / }).waitFor();
      await add.getByPlaceholder('Search foods').fill('banana');
      await add.getByText('Bananas, raw').waitFor({ timeout: 8000 });
      await shot('13-search');
      await add.getByRole('button', { name: /^Add Bananas, raw to / }).click();
      await page.getByText(/Added Bananas, raw to /).waitFor();
      await toDiary();
      await page.getByRole('button', { name: /Bananas, raw/ }).first().waitFor();
      const s = await summary(page);
      // 118 g x 89 kcal/100 g = 105.02
      assert(near(s.food, 485.02, 1.5), `food should be about 485, got ${s.food}`);
    },
    page,
  );

  await step(
    'a food logged before is under Recent and re-logs in two taps',
    async () => {
      const before = await page.getByRole('button', { name: /Rolled oats/ }).count();
      await addButton.click(); // tap 1
      await top(page).getByRole('button', { name: /^Add Rolled oats to / }).click(); // tap 2
      await page.getByText(/Added Rolled oats to /).waitFor();
      await toDiary();
      await page.waitForTimeout(300);
      const after = await page.getByRole('button', { name: /Rolled oats/ }).count();
      assert(after === before + 1, `expected one more Rolled oats entry (${before} -> ${after})`);
      // It was re-logged with the serving used last time (100 g).
      const s = await summary(page);
      assert(near(s.food, 865.02, 1.5), `food should be about 865, got ${s.food}`);
    },
    page,
  );

  if (VIDEO) {
    await step(
      'scan a barcode with the camera: product found and logged',
      async () => {
        await addButton.click();
        await top(page).getByRole('button', { name: 'Scan a barcode' }).click();
        const detail = page.getByRole('heading', { name: 'Wholegrain Biscuits' });
        await detail.waitFor({ timeout: 20000 });
        await shot('14-scanned');
        await top(page).getByRole('button', { name: ADD_TO_MEAL }).click();
        await page.getByRole('button', { name: /Wholegrain Biscuits/ }).first().waitFor();
        const s = await summary(page);
        // 30 g x 356 = 106.8
        assert(near(s.food, 971.82, 1.5), `food should be about 972, got ${s.food}`);
      },
      page,
    );
  }

  await step(
    'multi-add: tick several foods and add them at once',
    async () => {
      const before = (await summary(page)).food;
      await addButton.click();
      const add = top(page);
      await add.getByRole('button', { name: 'Select several foods' }).click();
      await add.getByRole('checkbox', { name: 'Select Rolled oats' }).click();
      await add.getByRole('checkbox', { name: 'Select Bananas, raw' }).click();
      await shot('15-multi');
      await add.getByRole('button', { name: /^Add 2 foods to / }).click();
      await page.getByText(/Added 2 foods to /).waitFor();
      await page.waitForTimeout(400);
      const s = await summary(page);
      assert(near(s.food, before + 380 + 105.02, 1.5), `food should rise by 485, got ${s.food - before}`);
    },
    page,
  );

  await step(
    'quick add: energy only',
    async () => {
      const before = (await summary(page)).food;
      await page.getByRole('button', { name: 'Snacks options' }).click();
      await top(page).getByRole('button', { name: 'Quick add energy' }).click();
      const sheet = top(page);
      await sheet.getByRole('textbox', { name: 'Energy' }).fill('120');
      await sheet.getByRole('button', { name: 'Add to diary' }).click();
      await page.getByRole('button', { name: /Quick add/ }).first().waitFor();
      const s = await summary(page);
      assert(near(s.food, before + 120), `food should rise by 120, got ${s.food - before}`);
    },
    page,
  );

  await step(
    'swipe an entry away, then undo',
    async () => {
      const before = (await summary(page)).food;
      const row = page.getByRole('button', { name: /Quick add/ }).first();
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      await page.mouse.move(box.x + box.width - 30, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width - 120, box.y + box.height / 2, { steps: 6 });
      await page.mouse.move(box.x + 20, box.y + box.height / 2, { steps: 8 });
      await page.mouse.up();
      await page.getByText('Removed Quick add').waitFor();
      await page.waitForTimeout(300);
      let s = await summary(page);
      assert(near(s.food, before - 120), `food should drop by 120 after delete, got ${s.food - before}`);
      await shot('16-undo-toast');
      await page.getByRole('button', { name: 'Undo' }).click();
      await page.waitForTimeout(500);
      s = await summary(page);
      assert(near(s.food, before), `food should be back to ${before} after undo, got ${s.food}`);
    },
    page,
  );

  await step(
    'exercise changes the remaining energy',
    async () => {
      const before = await summary(page);
      await page.getByRole('button', { name: 'Add exercise' }).click();
      const sheet = top(page);
      await sheet.getByRole('combobox', { name: 'Activity' }).selectOption({ label: 'Running, 10 km/h (6:00 per km)' });
      await sheet.getByRole('textbox', { name: 'Minutes' }).fill('30');
      // MET 9.8 x 80 kg x 0.5 h = 392
      assert((await sheet.getByRole('textbox', { name: 'Energy burned' }).inputValue()) === '392', 'estimate should be 392 kcal');
      await shot('17-exercise');
      await sheet.getByRole('button', { name: 'Add to diary' }).click();
      await page.getByRole('button', { name: /Running, 10 km\/h/ }).waitFor();
      const s = await summary(page);
      assert(near(s.exercise, 392), `exercise should be 392, got ${s.exercise}`);
      assert(near(s.remaining, before.remaining + 392), `remaining should rise by 392, got ${s.remaining - before.remaining}`);
    },
    page,
  );

  await step(
    'water: add glasses',
    async () => {
      await page.getByRole('button', { name: /Add a glass/ }).click();
      await page.getByRole('button', { name: /Add a glass/ }).click();
      await page.getByRole('button', { name: 'Set water amount' }).filter({ hasText: '500 mL' }).waitFor();
      await page.waitForTimeout(500);
      const day = await api(page, 'GET', `/api/diary/${await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))}`);
      assert(day.json.water_ml === 500, `stored water should be 500, got ${day.json.water_ml}`);
    },
    page,
  );

  await step(
    'notes are saved and survive a reload',
    async () => {
      await page.getByRole('button', { name: 'Add a note for this day' }).click();
      await page.getByPlaceholder('How did today go?').fill('Felt good, long walk at lunch.');
      await page.waitForTimeout(1300);
      await page.reload();
      await page.getByPlaceholder('How did today go?').waitFor();
      assert((await page.getByPlaceholder('How did today go?').inputValue()) === 'Felt good, long walk at lunch.', 'note should persist');
    },
    page,
  );

  await shot('20-diary-full');
  await page.evaluate(() => document.querySelector('.scroll-area').scrollTo(0, 99999));
  await shot('21-diary-bottom');
  await page.evaluate(() => document.querySelector('.scroll-area').scrollTo(0, 0));

  await step(
    'save a meal, then log the saved meal on another day',
    async () => {
      const entries = await api(page, 'GET', `/api/diary/${await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))}`);
      const meal = entries.json.entries[0].meal;
      const names = ['Breakfast', 'Lunch', 'Dinner', 'Snacks'];
      const inMeal = entries.json.entries.filter((e) => e.meal === meal).length;
      await page.getByRole('button', { name: `${names[meal]} options` }).click();
      await top(page).getByRole('button', { name: 'Save as a saved meal…' }).click();
      await top(page).getByRole('textbox', { name: 'Saved meal name' }).fill('My usual');
      await top(page).getByRole('button', { name: 'Save meal' }).click();
      await page.getByText(/Saved\. Find it under Saved Meals/).waitFor();
      await page.getByRole('button', { name: 'Next day' }).click();
      await addButton.click();
      await top(page).getByRole('tab', { name: 'Saved Meals' }).click();
      await shot('22-saved-meals');
      await top(page).getByRole('button', { name: /^Add My usual to / }).click();
      await page.getByText(new RegExp(`Added ${inMeal} items? to `)).waitFor();
      await toDiary();
      await page.waitForTimeout(300);
      assert((await page.locator('ul li button').filter({ hasText: /Rolled oats|Bananas|Biscuits/ }).count()) >= 1, 'tomorrow should now have entries');
    },
    page,
  );

  await step(
    'copy a whole day to another date',
    async () => {
      // Still on tomorrow: copy it to the day after.
      await page.getByRole('button', { name: 'Day options' }).click();
      await top(page).getByRole('button', { name: 'Copy this day to another date…' }).click();
      await shot('23-copy');
      await top(page).getByRole('button', { name: 'Copy', exact: true }).click();
      await page.getByText(/Copied \d+ items? to /).waitFor();
      await page.getByRole('button', { name: 'Day options' }).click();
      await top(page).getByRole('button', { name: 'Go to today' }).click();
      await page.getByText('Today').first().waitFor();
    },
    page,
  );

  await step(
    'recipe: ingredients, servings, per-serving nutrition; then log it',
    async () => {
      await page.getByRole('tab', { name: 'Foods' }).click();
      await page.getByRole('tab', { name: 'Recipes' }).click();
      await page.getByRole('button', { name: 'New recipe' }).click();
      const form = top(page);
      await form.getByRole('textbox', { name: 'Recipe name' }).fill('Banana porridge');
      await form.getByRole('textbox', { name: 'Servings' }).fill('2');
      await form.getByRole('button', { name: 'Add ingredient' }).click();
      await top(page).getByRole('button', { name: 'Use Rolled oats' }).click(); // 100 g oats = 380 kcal
      await form.getByRole('button', { name: 'Add ingredient' }).click();
      await top(page).getByRole('button', { name: 'Use Bananas, raw' }).click(); // 118 g = 105.02 kcal
      await form.getByText(/Per serving \(1 of 2/).waitFor();
      await shot('24-recipe');
      const tiles = await form.locator('text=/Per serving/').locator('xpath=..').innerText();
      // (380 + 105.02) / 2 = 242.51 -> "243"
      assert(/\b243\b/.test(tiles), `per-serving energy should show 243: ${tiles.replace(/\n/g, ' ')}`);
      await form.getByRole('button', { name: 'Save recipe' }).click();
      await page.getByRole('button', { name: /Banana porridge/ }).first().waitFor();
      const res = await api(page, 'GET', '/api/foods?tab=recipes');
      const recipe = res.json.foods[0];
      assert(near((recipe.kcal * recipe.servings[0].amount) / 100, 242.51, 0.01), 'stored per-serving energy should be 242.51');
      // Log it from the Foods tab with one tap.
      await page.getByRole('button', { name: 'Add Banana porridge to the diary' }).click();
      await page.getByText(/Added Banana porridge to /).waitFor();
      await page.getByRole('tab', { name: 'Diary' }).click();
      await page.getByRole('button', { name: /Banana porridge/ }).first().waitFor();
    },
    page,
  );

  await step(
    'progress: logging weight updates the chart; calories and macros show',
    async () => {
      await page.getByRole('tab', { name: 'Progress' }).click();
      await page.getByRole('textbox', { name: 'Weight in kilograms' }).fill('79.4');
      await page.getByRole('button', { name: /Replace|Save weight/ }).click();
      await page.getByText('Weight updated').waitFor();
      await page.locator('.recharts-wrapper svg').first().waitFor();
      assert((await page.getByText('79.4 kg').count()) >= 1, 'latest weight should show 79.4 kg');
      await shot('30-progress-weight');
      await page.getByRole('tab', { name: 'Calories' }).click();
      await page.locator('.recharts-bar-rectangle').first().waitFor();
      await page.getByText('Weekly averages').waitFor();
      await shot('31-progress-calories');
      await page.getByRole('tab', { name: 'Macros' }).click();
      await page.getByText('Weekly average').waitFor();
      await page.getByRole('columnheader', { name: '% of energy' }).first().waitFor();
      await shot('32-progress-macros');
      await page.getByRole('tab', { name: 'Body' }).click();
      await page.getByRole('textbox', { name: 'Waist in cm' }).fill('91.5');
      await page.getByRole('button', { name: 'Save measurement' }).click();
      await page.getByText('91.5 cm').waitFor();
      assert((await page.getByText(/\d+-day streak/).innerText()).startsWith('1-day'), 'streak should be 1 day');
    },
    page,
  );

  await step(
    'settings: switch to kJ and to the dark theme',
    async () => {
      await page.getByRole('tab', { name: 'Settings' }).click();
      await shot('40-settings');
      await page.getByRole('tab', { name: 'Kilojoules (kJ)' }).click();
      await page.getByRole('tab', { name: 'Dark' }).click();
      assert(await page.evaluate(() => document.documentElement.classList.contains('dark')), 'dark theme should apply');
      await page.getByRole('tab', { name: 'Diary' }).click();
      await page.getByText('Energy (kJ)').waitFor();
      const s = await summary(page);
      assert(near(s.goal, 2210 * 4.184, 1), `goal should show in kJ (9247), got ${s.goal}`);
      await shot('41-diary-kj-dark');
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByRole('tab', { name: 'Calories (kcal)' }).click();
      await page.getByRole('tab', { name: 'Match phone' }).click();
      await page.waitForTimeout(300);
    },
    page,
  );

  await step(
    'goals: a target under the minimum needs confirmation',
    async () => {
      await page.getByRole('button', { name: /Goals and targets/ }).click();
      const goals = top(page);
      await goals.getByRole('textbox', { name: 'Daily energy target' }).fill('1300');
      await goals.getByText('1,300 kcal a day is very low').waitFor();
      await shot('42-low-target');
      await goals.getByRole('button', { name: 'Save targets' }).click();
      await page.getByText('Tick the box to confirm the low target first.').waitFor();
      const boot = await api(page, 'GET', '/api/bootstrap');
      assert(boot.json.targets.targets.kcal === 2210, 'the low target must not be saved without confirming');
      await goals.getByRole('button', { name: /Use 1,500 kcal instead/ }).click();
      await goals.getByRole('textbox', { name: 'Daily energy target' }).fill('2210');
      await goals.getByText('Saturday', { exact: true }).click();
      await goals.getByRole('textbox', { name: 'Saturday energy target' }).fill('2500');
      await goals.getByRole('button', { name: 'Save targets' }).click();
      await page.getByText('Targets saved. They apply from today.').waitFor();
      const saved = await api(page, 'GET', '/api/bootstrap');
      assert(saved.json.targets.targets.weekdays['6'].kcal === 2500, 'Saturday target should be 2500');
    },
    page,
  );

  await step(
    'data: back up now, and the export links work',
    async () => {
      await page.getByRole('button', { name: /Data and backups/ }).click();
      const data = top(page);
      await data.getByRole('button', { name: 'Back up now' }).click();
      await page.getByText('Backup saved on your laptop').waitFor();
      await data.getByText(/^Manual · /).first().waitFor();
      await shot('43-data');
      const json = await api(page, 'GET', '/api/export/json');
      assert(json.status === 200 && json.json.tables.diary_entries.length > 5, 'export should contain the diary');
      const csv = await page.evaluate(async () => (await fetch('/api/export/diary.csv')).text());
      assert(/^﻿?Date,Meal,Food/.test(csv) && /\d{2}\/\d{2}\/\d{4},/.test(csv), 'CSV should have DD/MM/YYYY rows');
      await back();
    },
    page,
  );

  await step(
    'offline: a banner shows, typing is kept, and it saves when the laptop is back',
    async () => {
      await page.getByRole('tab', { name: 'Diary' }).click();
      expectNetworkErrors = true;
      await ctx.setOffline(true);
      const note = page.getByPlaceholder('How did today go?');
      await note.fill('Typed while the laptop was unreachable.');
      await page.getByText(/Offline: can't reach your laptop/).waitFor({ timeout: 15000 });
      await shot('50-offline');
      assert((await note.inputValue()) === 'Typed while the laptop was unreachable.', 'typing must not be lost');
      await ctx.setOffline(false);
      await page.getByText(/Offline: can't reach your laptop/).waitFor({ state: 'hidden', timeout: 15000 });
      await page.waitForTimeout(4500);
      expectNetworkErrors = false;
      const day = await api(page, 'GET', `/api/diary/${await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))}`);
      assert(day.json.note === 'Typed while the laptop was unreachable.', `note should be saved after reconnecting, got "${day.json.note}"`);
    },
    page,
  );

  await step(
    'installable: manifest, icons and service worker; the app shell loads with the laptop unreachable',
    async () => {
      const manifest = await page.evaluate(async () => (await fetch('/manifest.webmanifest')).json());
      assert(manifest.display === 'standalone' && manifest.icons.length >= 3, 'manifest should be installable');
      for (const icon of manifest.icons) {
        const status = await page.evaluate(async (src) => (await fetch(src)).status, icon.src);
        assert(status === 200, `icon ${icon.src} should load`);
      }
      await page.evaluate(() => navigator.serviceWorker.ready);
      await page.reload();
      await page.getByRole('tab', { name: 'Diary' }).waitFor();
      assert(await page.evaluate(() => Boolean(navigator.serviceWorker.controller)), 'service worker should control the page');
      expectNetworkErrors = true;
      await ctx.setOffline(true);
      await page.reload();
      await page.getByRole('heading', { name: "Can't reach your laptop" }).waitFor({ timeout: 15000 });
      await shot('51-shell-offline');
      await ctx.setOffline(false);
      await page.getByRole('tab', { name: 'Diary' }).waitFor({ timeout: 20000 });
      expectNetworkErrors = false;
    },
    page,
  );

  // =========================================================================
  // 1b. More acceptance checks on the same data: touch gestures, layout,
  //     targets, slow or failing food databases, wipe and restore
  // =========================================================================
  console.log('\nTouch, layout and data safety');
  const layoutProblems = [];

  /** Real touch input (not mouse), the way a finger moves. */
  const cdp = await ctx.newCDPSession(page);
  const touchSwipe = async (from, to, steps = 10) => {
    const at = (x, y) => [{ x, y, id: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: at(from.x, from.y) });
    for (let i = 1; i <= steps; i++) {
      await cdp.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: at(from.x + ((to.x - from.x) * i) / steps, from.y + ((to.y - from.y) * i) / steps),
      });
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  /** Look at what is on screen right now: tap targets under 44 px and anything wider than the screen. */
  async function auditHere(label, { targets = true } = {}) {
    await page.waitForTimeout(450);
    const found = await page.evaluate((checkTargets) => {
      const small = [];
      const overflow = [];
      const shown = (el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[inert]') && !el.closest('.sr-only');
      };
      if (checkTargets) {
        const sel = 'button, a[href], input:not([type=hidden]):not([type=file]), select, textarea, [role=tab], [role=button], summary';
        for (const el of document.querySelectorAll(sel)) {
          if (!shown(el) || el.classList.contains('sr-only')) continue;
          const r = el.getBoundingClientRect();
          if (r.width < 43.5 || r.height < 43.5) {
            const name = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40);
            small.push(`<${el.tagName.toLowerCase()}> "${name}" is ${Math.round(r.width)}x${Math.round(r.height)}`);
          }
        }
      }
      if (document.documentElement.scrollWidth > window.innerWidth + 1) overflow.push(`page is ${document.documentElement.scrollWidth}px wide on a ${window.innerWidth}px screen`);
      for (const el of document.querySelectorAll('.scroll-area, [role=dialog]')) {
        if (shown(el) && el.scrollWidth > el.clientWidth + 1) overflow.push(`${el.getAttribute('aria-label') || el.className.toString().slice(0, 30)} scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`);
      }
      return { small, overflow };
    }, targets);
    for (const m of found.small) layoutProblems.push(`${label}: ${m}`);
    for (const m of found.overflow) layoutProblems.push(`${label}: ${m}`);
  }

  await step(
    'swipe sideways on the top of the diary to change day (real touch)',
    async () => {
      await page.getByRole('tab', { name: 'Diary' }).click(); // tapping the active tab returns to today
      const header = page.locator('header').first();
      await header.getByText('Today', { exact: true }).waitFor();
      const box = await header.boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe({ x: 300, y }, { x: 80, y });
      await header.getByText('Tomorrow', { exact: true }).waitFor({ timeout: 5000 });
      await touchSwipe({ x: 80, y }, { x: 300, y });
      await header.getByText('Today', { exact: true }).waitFor({ timeout: 5000 });
      await touchSwipe({ x: 80, y }, { x: 300, y });
      await header.getByText('Yesterday', { exact: true }).waitFor({ timeout: 5000 });
      await page.getByRole('tab', { name: 'Diary' }).click();
      await header.getByText('Today', { exact: true }).waitFor();
    },
    page,
  );

  await step(
    'swipe-to-delete works with real touch, and Undo brings the entry back',
    async () => {
      await page.getByRole('button', { name: 'Snacks options' }).click();
      await top(page).getByRole('button', { name: 'Quick add energy' }).click();
      await top(page).getByRole('textbox', { name: 'Energy' }).fill('77');
      await top(page).getByRole('button', { name: 'Add to diary' }).click();
      await page.waitForTimeout(500);
      const before = (await summary(page)).food;
      const row = page.getByRole('button', { name: /Quick add/ }).last();
      await row.scrollIntoViewIfNeeded();
      const box = await row.boundingBox();
      const y = box.y + box.height / 2;
      await touchSwipe({ x: box.x + box.width - 30, y }, { x: box.x + 30, y }, 12);
      await page.getByText('Removed Quick add').waitFor({ timeout: 5000 });
      await page.waitForTimeout(300);
      assert(near((await summary(page)).food, before - 77), 'swiping away a 77 kcal quick add should lower the total by 77');
      await page.getByRole('button', { name: 'Undo' }).click();
      await page.waitForTimeout(500);
      assert(near((await summary(page)).food, before), 'Undo should put it back');
    },
    page,
  );

  await step(
    'number fields bring up the numeric keypad',
    async () => {
      await addButton.click();
      await top(page).getByRole('button', { name: 'Create a food' }).click();
      const form = top(page);
      for (const name of ['Energy', 'Protein', 'Carbohydrate']) {
        const mode = await form.getByRole('textbox', { name, exact: true }).first().getAttribute('inputmode');
        assert(mode === 'decimal' || mode === 'numeric', `${name} should use a numeric keypad, found inputmode=${mode}`);
      }
      assert((await form.locator('input[type=number]').count()) === 0, 'no input should use type=number (it breaks decimals on some phones)');
      await page.goBack();
      await page.goBack();
    },
    page,
  );

  await step(
    'goals: the Saturday target applies on Saturdays only',
    async () => {
      const info = await page.evaluate(() => {
        const d = new Date();
        let n = 0;
        while (d.getDay() !== 6) {
          d.setDate(d.getDate() + 1);
          n++;
        }
        return { n, date: new Intl.DateTimeFormat('en-CA').format(d) };
      });
      const sat = await api(page, 'GET', `/api/diary/${info.date}`);
      assert(sat.json.targets.kcal === 2500, `Saturday ${info.date} should have the 2,500 target, got ${sat.json.targets.kcal}`);
      const sun = await page.evaluate(async (date) => {
        const d = new Date(`${date}T12:00:00`);
        d.setDate(d.getDate() + 1);
        const next = new Intl.DateTimeFormat('en-CA').format(d);
        return { next, json: await (await fetch(`/api/diary/${next}`)).json() };
      }, info.date);
      assert(sun.json.targets.kcal === 2210, `Sunday ${sun.next} should keep the 2,210 target, got ${sun.json.targets.kcal}`);
      // And on screen:
      await page.getByRole('tab', { name: 'Diary' }).click();
      for (let i = 0; i < info.n; i++) await page.getByRole('button', { name: 'Next day' }).click();
      await page.getByText('Weekday target', { exact: true }).waitFor();
      const s = await summary(page);
      assert(s.goal === 2500, `diary on Saturday should show a 2,500 goal, got ${s.goal}`);
      await page.getByRole('tab', { name: 'Diary' }).click();
    },
    page,
  );

  await step(
    'exercise can be left out of the daily budget',
    async () => {
      await page.getByRole('tab', { name: 'Diary' }).click();
      const on = await summary(page);
      assert(on.exercise > 0, 'there should be exercise logged today');
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByText('Add exercise to my daily budget', { exact: true }).click();
      await page.getByRole('tab', { name: 'Diary' }).click();
      const off = await summary(page);
      assert(near(off.remaining, on.remaining - on.exercise), `remaining should drop by the exercise (${on.exercise}), ${on.remaining} -> ${off.remaining}`);
      await page.getByText('Exercise*', { exact: true }).waitFor();
      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByText('Add exercise to my daily budget', { exact: true }).click();
      await page.getByRole('tab', { name: 'Diary' }).click();
      assert(near((await summary(page)).remaining, on.remaining), 'turning it back on should restore the remaining energy');
    },
    page,
  );

  await step(
    'tap targets are 44 px and nothing scrolls sideways (390 px wide)',
    async () => {
      const visit = async (label, open, close) => {
        await open();
        await auditHere(label);
        if (close) await close();
      };
      const closeTop = async () => {
        await page.goBack();
        await page.waitForTimeout(150);
      };
      await page.getByRole('tab', { name: 'Diary' }).click();
      await auditHere('diary (top)');
      await page.evaluate(() => document.querySelector('.scroll-area').scrollTo(0, 99999));
      await auditHere('diary (bottom)');
      await page.evaluate(() => document.querySelector('.scroll-area').scrollTo(0, 0));
      await visit('add food', async () => addButton.click());
      await top(page).getByRole('button', { name: 'Select several foods' }).click();
      await auditHere('add food (multi-select)');
      await top(page).getByRole('button', { name: 'Stop selecting several' }).click();
      await top(page).getByRole('tab', { name: 'Recent' }).click();
      await auditHere('add food (recent)');
      await top(page).getByRole('tab', { name: 'Saved Meals' }).click();
      await auditHere('add food (saved meals)');
      await top(page).getByRole('tab', { name: 'Recent' }).click();
      await top(page).getByRole('button', { name: /^Rolled oats/ }).first().click();
      await auditHere('food details');
      await closeTop();
      await top(page).getByRole('tab', { name: 'Search' }).click();
      await top(page).getByRole('button', { name: 'Create a food' }).click();
      await auditHere('create a food');
      await closeTop();
      await closeTop();
      await visit('foods', async () => page.getByRole('tab', { name: 'Foods', exact: true }).click());
      for (const tab of ['My Foods', 'Recipes', 'Saved Meals']) {
        const t = page.getByRole('tab', { name: tab });
        if (await t.count()) {
          await t.click();
          await auditHere(`foods (${tab})`);
        }
      }
      await page.getByRole('tab', { name: 'Progress' }).click();
      for (const tab of ['Weight', 'Calories', 'Macros', 'Body']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.waitForTimeout(700); // charts draw in
        await auditHere(`progress (${tab})`);
      }
      await page.getByRole('tab', { name: 'Settings' }).click();
      await auditHere('settings');
      for (const [label, name] of [
        ['profile', /^Profile/],
        ['goals', /Goals and targets/],
        ['meal names', /Meal names/],
        ['water', /^Water/],
        ['PIN', /PIN/],
        ['install', /Install on this phone/],
        ['data', /Data and backups/],
      ]) {
        const row = page.getByRole('button', { name }).first();
        if (!(await row.count())) continue;
        await row.click();
        await auditHere(`settings: ${label}`);
        await closeTop();
      }
      await page.getByRole('tab', { name: 'Diary' }).click();
    },
    page,
  );

  await step(
    'nothing scrolls sideways on a small phone (320 px wide)',
    async () => {
      const original = page.viewportSize();
      await page.setViewportSize({ width: 320, height: 568 });
      await page.waitForTimeout(300);
      await page.getByRole('tab', { name: 'Diary' }).click();
      await auditHere('320: diary', { targets: false });
      await addButton.click();
      await auditHere('320: add food', { targets: false });
      await top(page).getByRole('tab', { name: 'Recent' }).click();
      await top(page).getByRole('button', { name: /^Rolled oats/ }).first().click();
      await auditHere('320: food details', { targets: false });
      await page.goBack();
      await page.goBack();
      for (const tab of ['Progress', 'Foods', 'Settings']) {
        await page.getByRole('tab', { name: tab, exact: true }).click();
        await page.waitForTimeout(700);
        await auditHere(`320: ${tab}`, { targets: false });
      }
      await page.getByRole('tab', { name: 'Diary' }).click();
      await page.setViewportSize(original);
    },
    page,
  );

  await step(
    'layout audit result',
    async () => {
      const unique = [...new Set(layoutProblems)];
      assert(unique.length === 0, `${unique.length} layout problem(s):\n         ${unique.join('\n         ')}`);
    },
    page,
  );

  // --- slow or failing online food databases (needs the stand-in server's control URL) ---
  const MOCK = process.env.MOCK_URL || 'http://127.0.0.1:4010';
  const mockState = async (query) => {
    try {
      await fetch(`${MOCK}/__state?${query}`);
      return true;
    } catch {
      return false;
    }
  };
  if (await mockState('down=0&slowMs=0')) {
    await step(
      'slow food databases: your own foods show at once, a notice follows after 5 seconds, logging still works',
      async () => {
        await mockState('slowMs=9000');
        const started = Date.now();
        await addButton.click();
        const add = top(page);
        await add.getByPlaceholder('Search foods').fill('rolled');
        await add.getByRole('button', { name: /^Add Rolled oats to / }).waitFor({ timeout: 3000 });
        const localMs = Date.now() - started;
        assert(localMs < 3000, `own foods should appear straight away, took ${localMs} ms`);
        await add.getByText('Searching online…').waitFor({ timeout: 3000 });
        await add.getByText(/took too long to answer/).first().waitFor({ timeout: 12000 });
        const noticeMs = Date.now() - started;
        assert(noticeMs > 4500 && noticeMs < 11000, `the notice should come after about 5 seconds, came after ${noticeMs} ms`);
        await shot('52-slow-online');
        const before = (await (async () => {
          await page.goBack();
          return summary(page);
        })()).food;
        await addButton.click();
        await top(page).getByRole('tab', { name: 'Recent' }).click();
        await top(page).getByRole('button', { name: /^Add Rolled oats to / }).click();
        await page.getByText(/Added Rolled oats to /).waitFor();
        await toDiary();
        await page.waitForTimeout(400);
        assert((await summary(page)).food > before + 100, 'a previously used food can still be logged while the online sources are slow');
      },
      page,
    );
    await step(
      'online databases failing: a notice, previously used foods and scanned barcodes still work',
      async () => {
        await mockState('down=1&slowMs=0');
        await addButton.click();
        const add = top(page);
        await add.getByPlaceholder('Search foods').fill('wholegrain');
        await add.getByRole('button', { name: /^Add Wholegrain Biscuits to / }).waitFor({ timeout: 3000 });
        await add.getByText(/had a problem|could not be reached|unavailable|paused/).first().waitFor({ timeout: 12000 });
        await page.goBack();
        const known = await api(page, 'GET', '/api/barcode/9300633000011');
        assert(known.json.status === 'found' && known.json.origin === 'local', `a barcode scanned before should be found locally, got ${JSON.stringify(known.json)}`);
        const unknown = await api(page, 'GET', '/api/barcode/4000000000099');
        assert(unknown.json.status === 'unavailable', `an unknown barcode while the database is down should say so, got ${JSON.stringify(unknown.json)}`);
        await mockState('down=0&slowMs=0');
      },
      page,
    );
    await mockState('down=0&slowMs=0');
  } else {
    console.log('  skip slow/failing online database checks (no stand-in server at ' + MOCK + ')');
  }

  await step(
    'the phone follows the system dark/light setting by default',
    async () => {
      const dark = await browser.newContext({ ...phone, colorScheme: 'dark' });
      const dp = await dark.newPage();
      watch(dp, 'dark');
      await dp.goto(APP);
      await login(dp);
      assert(await dp.evaluate(() => document.documentElement.classList.contains('dark')), 'a phone set to dark should get the dark theme');
      await dp.screenshot({ path: path.join(SHOTS, '53-system-dark.png') });
      await dark.close();
      const light = await browser.newContext({ ...phone, colorScheme: 'light' });
      const lp = await light.newPage();
      watch(lp, 'light');
      await lp.goto(APP);
      await login(lp);
      assert(!(await lp.evaluate(() => document.documentElement.classList.contains('dark'))), 'a phone set to light should get the light theme');
      await light.close();
    },
    page,
  );

  await step(
    'export, erase everything, then restore from the file: all data is back',
    async () => {
      const before = await api(page, 'GET', '/api/export/json');
      assert(before.status === 200, 'export should work');
      const countBefore = Object.fromEntries(Object.entries(before.json.tables).map(([k, v]) => [k, v.length]));
      const file = path.join(SHOTS, 'export-for-restore.json');
      fs.writeFileSync(file, JSON.stringify(before.json));
      await page.getByRole('tab', { name: 'Diary' }).click();
      const goalBefore = (await summary(page)).goal;
      const foodBefore = (await summary(page)).food;

      await page.getByRole('tab', { name: 'Settings' }).click();
      await page.getByRole('button', { name: /Data and backups/ }).click();
      await top(page).getByRole('button', { name: 'Erase all data…' }).click();
      await top(page).getByLabel('PIN', { exact: true }).fill(PIN);
      await top(page).getByRole('button', { name: 'Erase everything' }).click();
      await page.getByRole('heading', { name: 'About you' }).waitFor({ timeout: 10000 });
      const boot = await api(page, 'GET', '/api/bootstrap');
      assert(boot.json.onboarded === false, 'after erasing, the app should be back at the first question');
      const day = await api(page, 'GET', `/api/diary/${await page.evaluate(() => new Intl.DateTimeFormat('en-CA').format(new Date()))}`);
      assert(day.json.entries.length === 0, 'the diary should be empty after erasing');
      await shot('54-after-erase');

      await page.setInputFiles('input[type=file]', file);
      await page.getByRole('tab', { name: 'Diary' }).waitFor({ timeout: 15000 });
      const after = await api(page, 'GET', '/api/export/json');
      const differences = [];
      for (const [table, rows] of Object.entries(before.json.tables)) {
        if (JSON.stringify(after.json.tables[table]) !== JSON.stringify(rows)) differences.push(`${table} (${rows.length} rows before, ${after.json.tables[table]?.length} after)`);
      }
      assert(differences.length === 0, `these tables are different after restoring: ${differences.join(', ')}`);
      const s = await summary(page);
      assert(s.goal === goalBefore && near(s.food, foodBefore), `the diary should look the same again (goal ${goalBefore}, food ${foodBefore}), got ${s.label}`);
      assert(countBefore.diary_entries > 10, 'the export should have had real data in it');
    },
    page,
  );

  // =========================================================================
  // 2. Unknown barcode, typed by hand (camera without a barcode in view)
  // =========================================================================
  console.log('\nBarcodes typed by hand');
  const browser2 = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx2 = await browser2.newContext({ ...phone, permissions: ['camera'] });
  const page2 = await ctx2.newPage();
  watch(page2, 'manual');
  await step(
    'an unknown barcode opens the create-food form with the barcode filled in',
    async () => {
      await page2.goto(APP);
      await login(page2);
      await page2.locator('nav button[aria-label="Add food"]').click();
      await top(page2).getByRole('button', { name: 'Scan a barcode' }).click();
      const scanner = page2.getByRole('dialog', { name: 'Scan a barcode' });
      await scanner.getByText('Hold the barcode inside the frame').waitFor({ timeout: 15000 });
      await snap(page2, '60-scanner.png');
      await scanner.getByPlaceholder('Or type the barcode number').fill('4000000000006');
      await scanner.getByRole('button', { name: 'Look up' }).click();
      const form = top(page2);
      await form.getByText(/Barcode 4000000000006 is not in the online database/).waitFor();
      assert((await form.getByRole('textbox', { name: 'Barcode' }).inputValue()) === '4000000000006', 'barcode should be pre-filled');
      await snap(page2, '61-unknown-barcode.png');
      await form.getByRole('textbox', { name: 'Name', exact: true }).fill('Corner shop muesli bar');
      await form.getByRole('textbox', { name: 'Energy' }).fill('410');
      await form.getByRole('button', { name: 'Save food' }).click();
      await top(page2).getByRole('heading', { name: 'Corner shop muesli bar' }).waitFor();
      // Scanning (typing) it again now finds the saved food straight away.
      const found = await api(page2, 'GET', '/api/barcode/4000000000006');
      assert(found.json.status === 'found' && found.json.origin === 'local', 'the saved food should be found by its barcode');
    },
    page2,
  );
  await step(
    'a barcode typed by hand finds a known product',
    async () => {
      await page2.goto(APP);
      await page2.getByRole('tab', { name: 'Diary' }).waitFor();
      await page2.locator('nav button[aria-label="Add food"]').click();
      await top(page2).getByRole('button', { name: 'Scan a barcode' }).click();
      const scanner = page2.getByRole('dialog', { name: 'Scan a barcode' });
      await scanner.getByPlaceholder('Or type the barcode number').fill('9310072000220');
      await scanner.getByRole('button', { name: 'Look up' }).click();
      const detail = top(page2);
      await detail.getByRole('heading', { name: 'Orange Juice' }).waitFor();
      // kJ-only product: 180 kJ per 100 mL = 43 kcal; one 250 mL serving = 108 kcal. Protein is unknown.
      await detail.getByText('108').first().waitFor();
      await detail.getByText(/not known for this food/).waitFor();
      await snap(page2, '62-kj-product.png');
    },
    page2,
  );
  await browser2.close();

  // =========================================================================
  // 3. Plain http on the network address (not a secure context)
  // =========================================================================
  if (LAN) {
    console.log('\nPlain http (insecure) address');
    const ctx3 = await browser.newContext({ ...phone });
    const page3 = await ctx3.newPage();
    watch(page3, 'insecure');
    await step(
      'over plain http: no crash, camera hidden with an explanation, typing a barcode still works',
      async () => {
        await page3.goto(LAN);
        assert((await page3.evaluate(() => window.isSecureContext)) === false, 'this address should not be a secure context');
        await login(page3);
        await page3.locator('nav button[aria-label="Add food"]').click();
        await top(page3).getByText('The camera scanner needs a secure (https) address').waitFor();
        await top(page3).getByRole('button', { name: 'Scan a barcode' }).click();
        const scanner = page3.getByRole('dialog', { name: 'Scan a barcode' });
        await scanner.getByText(/The camera only works on a secure \(https\) address/).waitFor();
        assert((await scanner.locator('video').count()) === 0, 'no camera view should be shown');
        await snap(page3, '70-insecure-scanner.png');
        await scanner.getByPlaceholder('Or type the barcode number').fill('9300633000011');
        await scanner.getByRole('button', { name: 'Look up' }).click();
        await top(page3).getByRole('heading', { name: 'Wholegrain Biscuits' }).waitFor();
        // Ids are still generated without crypto.randomUUID (which needs https).
        await top(page3).getByRole('button', { name: ADD_TO_MEAL }).click();
        await page3.getByText(/Added Wholegrain Biscuits to /).waitFor();
      },
      page3,
    );
    await ctx3.close();
  }

  // =========================================================================
  // 4. Midnight: 11:55 pm and 12:05 am land on the right days
  // =========================================================================
  console.log('\nMidnight');
  const ctx4 = await browser.newContext({ ...phone });
  const page4 = await ctx4.newPage();
  watch(page4, 'midnight');
  await step(
    'entries at 11:55 pm and 12:05 am land on their own days',
    async () => {
      await page4.clock.install({ time: new Date('2026-12-31T23:55:00+11:00') });
      await page4.goto(APP);
      await login(page4);
      await page4.getByText('31/12/2026').waitFor();
      const quick = async (energy) => {
        await page4.getByRole('button', { name: 'Snacks options' }).click();
        await top(page4).getByRole('button', { name: 'Quick add energy' }).click();
        await top(page4).getByRole('textbox', { name: 'Energy' }).fill(String(energy));
        await top(page4).getByRole('button', { name: 'Add to diary' }).click();
        await page4.getByRole('button', { name: /Quick add/ }).first().waitFor();
      };
      await quick(111);
      // Ten minutes pass with the app left open.
      await page4.clock.fastForward('10:00');
      await page4.getByText('01/01/2027').waitFor({ timeout: 10000 });
      await page4.getByText('Today').first().waitFor();
      await snap(page4, '80-after-midnight.png');
      await quick(222);
      const before = await api(page4, 'GET', '/api/diary/2026-12-31');
      const after = await api(page4, 'GET', '/api/diary/2027-01-01');
      const kcal = (d) => d.json.entries.map((e) => Math.round((e.kcal * e.amount) / 100));
      assert(JSON.stringify(kcal(before)) === '[111]', `31/12 should hold only the 11:55 pm entry, got ${JSON.stringify(kcal(before))}`);
      assert(JSON.stringify(kcal(after)) === '[222]', `01/01 should hold only the 12:05 am entry, got ${JSON.stringify(kcal(after))}`);
    },
    page4,
  );
  await ctx4.close();

  await browser.close();

  // =========================================================================
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length} of ${results.length} flows passed.`);
  if (problems.length) {
    console.log(`\nBrowser console problems (${problems.length}):`);
    for (const p of [...new Set(problems)]) console.log(`  ${p}`);
  } else {
    console.log('No errors in the browser console.');
  }
  process.exit(failed.length || problems.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
