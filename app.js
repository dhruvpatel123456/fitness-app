/* FitTrack — calorie counter PWA. Data stays on the device (localStorage).
   Food lookups use the free Open Food Facts database (https://world.openfoodfacts.org). */
(() => {
  'use strict';

  const STORAGE_KEY = 'fittrack:v2';
  const LB = 2.20462;
  const OFF = 'https://world.openfoodfacts.org';
  const OFF_FIELDS = 'code,product_name,product_name_en,generic_name,brands,nutriments,serving_quantity,serving_size,image_front_small_url';
  const MEALS = [['breakfast', 'Breakfast'], ['lunch', 'Lunch'], ['dinner', 'Dinner'], ['snacks', 'Snacks']];
  const MEAL_NAME = Object.fromEntries(MEALS);
  const EXERCISES = {
    walk:     ['🚶 Walking', 3.5], run: ['🏃 Running', 9.8], cycle: ['🚴 Cycling', 7.5],
    swim:     ['🏊 Swimming', 7], strength: ['🏋️ Weight training', 5], hiit: ['🔥 HIIT / circuit', 8],
    yoga:     ['🧘 Yoga', 3], elliptical: ['⚙️ Elliptical', 5], rowing: ['🚣 Rowing', 7],
    sports:   ['⚽ Sports', 7], dance: ['💃 Dancing', 5], hike: ['🥾 Hiking', 6], other: ['⭐ Other', 4.5],
  };

  const DEFAULT_SETTINGS = {
    name: '', sex: 'male', age: 30, heightCm: 175, weightKg: 75, activity: 1.375, goal: -500, goalWeightKg: null,
    autoGoal: true, calorieGoal: 2000, carbsPct: 50, fatPct: 30, proteinPct: 20,
    waterGoal: 8, stepGoal: 10000, unit: 'kg', welcomed: false,
  };

  // ============ storage ============
  function fresh() { return { settings: { ...DEFAULT_SETTINGS }, diary: {}, recent: [], myFoods: [], weights: [] }; }
  function normalize(d) {
    const s = fresh();
    if (!d || typeof d !== 'object') return s;
    s.settings = { ...s.settings, ...(isObj(d.settings) ? d.settings : {}) };
    s.diary = isObj(d.diary) ? d.diary : {};
    s.recent = Array.isArray(d.recent) ? d.recent.filter(validTpl) : [];
    s.myFoods = Array.isArray(d.myFoods) ? d.myFoods.filter(validTpl) : [];
    s.weights = Array.isArray(d.weights) ? d.weights.filter(w => w && w.date && Number(w.kg) > 0) : [];
    for (const k of Object.keys(s.diary)) {
      const day = s.diary[k];
      if (!isObj(day)) { delete s.diary[k]; continue; }
      day.food = Array.isArray(day.food) ? day.food.filter(f => f && MEAL_NAME[f.meal]) : [];
      day.exercise = Array.isArray(day.exercise) ? day.exercise : [];
      day.water = Math.max(0, Number(day.water) || 0);
      day.steps = Math.max(0, Number(day.steps) || 0);
    }
    return s;
  }
  function validTpl(t) { return t && t.name && t.per && (t.basis === 'g' || t.basis === 'serving'); }
  function load() {
    try { const raw = localStorage.getItem(STORAGE_KEY); return raw ? normalize(JSON.parse(raw)) : fresh(); }
    catch (e) { console.warn(e); return fresh(); }
  }
  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
    catch (e) { toast('⚠️ Phone storage is full — export a backup and delete old photos'); return false; }
  }
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);

  let state = load();

  // ============ helpers ============
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const num = (v, f = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : f; };
  const r0 = n => Math.round(n);
  const r1 = n => Math.round(n * 10) / 10;
  const fmt = n => r0(n).toLocaleString();
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeImg = u => (typeof u === 'string' && (/^https:\/\//.test(u) || /^data:image\//.test(u))) ? u : '';

  function dateKey(d = new Date()) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
  const addDays = (d, n) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
  function prettyDate(k) {
    if (k === dateKey()) return 'Today';
    if (k === dateKey(addDays(new Date(), -1))) return 'Yesterday';
    if (k === dateKey(addDays(new Date(), 1))) return 'Tomorrow';
    return parseKey(k).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function day(k) {
    if (!state.diary[k]) state.diary[k] = { food: [], exercise: [], water: 0, steps: 0 };
    return state.diary[k];
  }
  const peekDay = k => state.diary[k] || { food: [], exercise: [], water: 0, steps: 0 };

  const wDisp = kg => r1(state.settings.unit === 'lb' ? kg * LB : kg);
  const toKg = v => state.settings.unit === 'lb' ? v / LB : v;

  let toastT;
  function toast(msg) {
    const t = $('#toast'); t.textContent = msg; t.classList.add('show');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function totals(k) {
    const d = peekDay(k);
    const t = { kcal: 0, carbs: 0, fat: 0, protein: 0, exercise: 0 };
    for (const f of d.food) { t.kcal += num(f.kcal); t.carbs += num(f.carbs); t.fat += num(f.fat); t.protein += num(f.protein); }
    for (const e of d.exercise) t.exercise += num(e.kcal);
    return t;
  }
  function macroGoals() {
    const s = state.settings, g = num(s.calorieGoal, 2000);
    return { carbs: g * s.carbsPct / 100 / 4, fat: g * s.fatPct / 100 / 9, protein: g * s.proteinPct / 100 / 4 };
  }

  // ============ calorie goal (Mifflin-St Jeor) ============
  function computeGoal(s) {
    const bmr = 10 * s.weightKg + 6.25 * s.heightCm - 5 * s.age + (s.sex === 'female' ? -161 : 5);
    const tdee = bmr * num(s.activity, 1.375);
    const floor = s.sex === 'female' ? 1200 : 1500;
    const goal = Math.max(floor, tdee + num(s.goal, 0));
    return { bmr: r0(bmr), tdee: r0(tdee), goal: Math.round(goal / 10) * 10, floored: tdee + num(s.goal) < floor };
  }

  // ============ navigation ============
  const TITLES = { home: 'Dashboard', diary: 'Diary', add: 'Add Food', progress: 'Progress', more: 'Settings' };
  let currentView = 'home';
  let selectedDate = dateKey();

  function goto(view) {
    if (!TITLES[view]) view = 'home';
    currentView = view;
    $$('.view').forEach(v => v.classList.toggle('active', v.id === `view-${view}`));
    $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.goto === view));
    let title = TITLES[view];
    if (view === 'home' && state.settings.name) title = `Hi, ${state.settings.name}`;
    if (view === 'add') title = `Add Food · ${prettyDate(selectedDate)}`;
    $('#page-title').textContent = title;
    $('#back-btn').hidden = view !== 'add';
    $('#settings-shortcut').hidden = view === 'more';
    if (location.hash !== `#${view}`) history.replaceState(null, '', `#${view}`);
    window.scrollTo(0, 0);
    render();
  }
  document.addEventListener('click', e => {
    const g = e.target.closest('[data-goto]');
    if (!g) return;
    e.preventDefault();
    if (g.dataset.goto === 'add' && currentView !== 'diary') selectedDate = dateKey();
    goto(g.dataset.goto);
  });
  $('#back-btn').addEventListener('click', () => goto('diary'));
  window.addEventListener('hashchange', () => { const v = location.hash.slice(1); if (v !== currentView) goto(v); });

  function render() {
    ({ home: renderHome, diary: renderDiary, add: renderAdd, progress: renderProgress, more: renderSettings })[currentView]();
  }

  // ============ dashboard ============
  const RING_C = 2 * Math.PI * 52;
  function setRing(el, frac, over) {
    el.style.strokeDashoffset = String(RING_C * (1 - Math.max(0, Math.min(1, frac))));
    el.classList.toggle('over', !!over);
  }
  function macroBlock(key, label, eaten, goal) {
    const pct = goal > 0 ? Math.min(100, eaten / goal * 100) : 0;
    const left = goal - eaten;
    return `<div class="macro">
      <div class="m-name c-${key}">${label}</div>
      <div class="m-val">${fmt(eaten)}<span class="muted small"> / ${fmt(goal)}g</span></div>
      <div class="bar"><i class="bg-${key}" style="width:${pct}%"></i></div>
      <div class="m-left">${left >= 0 ? `${fmt(left)}g left` : `${fmt(-left)}g over`}</div>
    </div>`;
  }
  function renderHome() {
    const k = dateKey(), s = state.settings, t = totals(k), d = peekDay(k);
    const goal = num(s.calorieGoal, 2000);
    const remaining = goal - t.kcal + t.exercise;
    $('#home-goal').textContent = fmt(goal);
    $('#home-food').textContent = fmt(t.kcal);
    $('#home-exercise').textContent = fmt(t.exercise);
    const remEl = $('#home-remaining');
    remEl.textContent = fmt(remaining);
    remEl.classList.toggle('over', remaining < 0);
    $('.ring-center span', remEl.parentElement).textContent = remaining < 0 ? 'Over' : 'Remaining';
    setRing($('#ring-cal'), t.kcal / (goal + t.exercise || 1), remaining < 0);

    const mg = macroGoals();
    $('#home-macros').innerHTML = macroBlock('carbs', 'Carbs', t.carbs, mg.carbs) + macroBlock('fat', 'Fat', t.fat, mg.fat) + macroBlock('protein', 'Protein', t.protein, mg.protein);

    $('#home-steps').textContent = fmt(d.steps);
    $('#home-steps-goal').textContent = `Goal ${fmt(s.stepGoal)}`;
    $('#home-water').textContent = d.water;
    $('#home-water-goal').textContent = `of ${s.waterGoal} cups`;
    $('#home-streak').textContent = streak();

    const labels = [], vals = [];
    for (let i = 6; i >= 0; i--) {
      const dd = addDays(new Date(), -i);
      labels.push(dd.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 2));
      vals.push(totals(dateKey(dd)).kcal);
    }
    drawBars($('#chart-week'), labels, vals, goal);
  }
  function streak() {
    const has = k => peekDay(k).food.length > 0;
    let d = new Date(); if (!has(dateKey(d))) d = addDays(d, -1);
    let n = 0; while (has(dateKey(d)) && n < 3650) { n++; d = addDays(d, -1); }
    return n;
  }

  // ============ diary ============
  function entryLi(f) {
    const img = safeImg(f.photo) || safeImg(f.tpl && f.tpl.image);
    const sub = [f.brand, servingText(f)].filter(Boolean).join(', ');
    return `<li data-entry="${esc(f.id)}">
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : ''}
      <div class="e-info"><div class="e-name">${esc(f.name)}</div><div class="e-sub">${esc(sub)}</div></div>
      <span class="e-kcal">${fmt(f.kcal)}</span>
    </li>`;
  }
  function servingText(f) {
    const q = r1(num(f.qty, 1));
    if (f.tpl && f.tpl.basis === 'g' && f.servingG) {
      const lbl = f.tpl.servingLabel && Number(f.servingG) === Number(f.tpl.servingG) ? f.tpl.servingLabel : `${r1(f.servingG)} g`;
      return `${q} × ${lbl}`;
    }
    return q === 1 ? '1 serving' : `${q} servings`;
  }
  function renderDiary() {
    const k = selectedDate, d = peekDay(k), t = totals(k), goal = num(state.settings.calorieGoal, 2000);
    $('#day-label').textContent = prettyDate(k);
    const rem = goal - t.kcal + t.exercise;
    $('#diary-equation').innerHTML = `
      <div><b>${fmt(goal)}</b><small>Goal</small></div><span class="op">−</span>
      <div><b>${fmt(t.kcal)}</b><small>Food</small></div><span class="op">+</span>
      <div><b>${fmt(t.exercise)}</b><small>Exercise</small></div><span class="op">=</span>
      <div class="rem ${rem < 0 ? 'over' : ''}"><b>${fmt(rem)}</b><small>Remaining</small></div>`;

    $('#diary-meals').innerHTML = MEALS.map(([key, label]) => {
      const items = d.food.filter(f => f.meal === key);
      const sum = items.reduce((a, f) => a + num(f.kcal), 0);
      return `<div class="meal-card">
        <div class="meal-head"><h3>${label}</h3><span>${items.length ? fmt(sum) : ''}</span></div>
        <ul class="entries">${items.map(entryLi).join('')}</ul>
        <button class="add-link" data-add-meal="${key}">ADD FOOD</button>
      </div>`;
    }).join('');

    $('#ex-total').textContent = d.exercise.length ? fmt(t.exercise) : '';
    $('#ex-list').innerHTML = d.exercise.map(e => `<li data-ex="${esc(e.id)}" class="nolink">
      <div class="e-info"><div class="e-name">${esc(e.name)}</div><div class="e-sub">${esc(e.minutes)} minutes</div></div>
      <span class="e-kcal">${fmt(e.kcal)}</span>
      <button class="del" data-del-ex="${esc(e.id)}" aria-label="Delete exercise">✕</button></li>`).join('');
    $('#diary-water').textContent = `${d.water} cup${d.water === 1 ? '' : 's'}`;

    const mg = macroGoals();
    const row = (label, v, g, unit = 'g') => `<div class="nut-row"><span>${label}</span><span><b>${fmt(v)}</b> / ${fmt(g)} ${unit}</span></div>`;
    $('#diary-nutrition').innerHTML = row('Calories', t.kcal, goal, 'cal') + row('Carbohydrates', t.carbs, mg.carbs) + row('Fat', t.fat, mg.fat) + row('Protein', t.protein, mg.protein);
  }
  $('#day-prev').addEventListener('click', () => { selectedDate = dateKey(addDays(parseKey(selectedDate), -1)); renderDiary(); });
  $('#day-next').addEventListener('click', () => { selectedDate = dateKey(addDays(parseKey(selectedDate), 1)); renderDiary(); });
  $('#day-label').addEventListener('click', () => { selectedDate = dateKey(); renderDiary(); });
  $('#diary-meals').addEventListener('click', e => {
    const add = e.target.closest('[data-add-meal]');
    if (add) { $('#add-meal').value = add.dataset.addMeal; goto('add'); return; }
    const li = e.target.closest('[data-entry]');
    if (li) {
      const f = peekDay(selectedDate).food.find(x => x.id === li.dataset.entry);
      if (f) openFoodDialog(f.tpl || tplFromEntry(f), { entry: f });
    }
  });
  $('#ex-list').addEventListener('click', e => {
    const del = e.target.closest('[data-del-ex]');
    if (del && confirm('Remove this exercise?')) {
      const d = day(selectedDate); d.exercise = d.exercise.filter(x => x.id !== del.dataset.delEx); save(); renderDiary();
    }
  });
  function tplFromEntry(f) {
    return { name: f.name, brand: f.brand || '', basis: 'serving', per: { kcal: num(f.kcal) / num(f.qty, 1), carbs: num(f.carbs) / num(f.qty, 1), fat: num(f.fat) / num(f.qty, 1), protein: num(f.protein) / num(f.qty, 1) } };
  }

  // ============ water & steps ============
  document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    const k = currentView === 'diary' ? selectedDate : dateKey();
    if (act === 'water-plus' || act === 'water-minus') {
      const d = day(k);
      d.water = Math.max(0, d.water + (act === 'water-plus' ? 1 : -1)); save(); render();
      if (act === 'water-plus' && d.water === Number(state.settings.waterGoal)) toast('💧 Water goal reached!');
    } else if (act === 'steps-add') {
      askNumber('Add steps', 'e.g. 2500', v => {
        const n = r0(v); if (n <= 0) return;
        const d = day(dateKey()), before = d.steps; d.steps += n; save(); render();
        toast(before < state.settings.stepGoal && d.steps >= state.settings.stepGoal ? '🎉 Step goal reached!' : `+${fmt(n)} steps`);
      });
    } else if (act === 'add-exercise') openExercise();
    else if (act === 'add-weight') {
      askNumber(`Log weight (${state.settings.unit})`, state.settings.unit === 'lb' ? 'e.g. 165.4' : 'e.g. 75.2', v => addWeight(v));
    }
    else if (act === 'scan') openScanner();
    else if (act === 'photo') { $('#photo-input').value = ''; $('#photo-input').click(); }
    else if (act === 'quick-add') openCustom('quick');
    else if (act === 'create-food') openCustom('create');
  });

  let numberCb = null;
  function askNumber(title, placeholder, cb) {
    const dlg = $('#number-dialog'), f = $('#number-form');
    f.reset(); $('#nd-title').textContent = title; f.elements.value.placeholder = placeholder || '';
    numberCb = cb; dlg.returnValue = ''; dlg.showModal();
    setTimeout(() => f.elements.value.focus(), 50);
  }
  $('#number-dialog').addEventListener('close', () => {
    const dlg = $('#number-dialog');
    if (dlg.returnValue === 'ok' && numberCb) numberCb(num($('#number-form').elements.value.value));
    numberCb = null;
  });

  // ============ add food view ============
  let addTab = 'recent';
  let searchResults = [];
  function renderAdd() {
    $('#add-meal').value = $('#add-meal').value || guessMeal();
    $$('#add-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === addTab));
    $('#add-tabs [data-tab=results]').hidden = !searchResults.length && addTab !== 'results';
    const list = addTab === 'recent' ? state.recent : addTab === 'myfoods' ? state.myFoods : searchResults;
    const status = $('#search-status');
    if (addTab !== 'results') {
      status.hidden = list.length > 0;
      status.textContent = addTab === 'recent' ? 'Foods you log will show up here for quick adding.' : 'Foods you create or save will show up here.';
    }
    $('#food-results').innerHTML = list.map((t, i) => foodLi(t, i)).join('');
  }
  function foodLi(t, i) {
    const img = safeImg(t.image);
    const sv = defaultServing(t);
    const kcal = calc(t, sv, 1).kcal;
    const sub = [t.brand, servingLabel(t, sv)].filter(Boolean).join(', ');
    return `<li data-food-idx="${i}">
      ${img ? `<img class="thumb" src="${esc(img)}" alt="" loading="lazy">` : ''}
      <div class="f-info"><div class="f-name">${esc(t.name)}</div><div class="f-sub">${fmt(kcal)} cal · ${esc(sub)}</div></div>
      <button class="f-add" data-quick-idx="${i}" aria-label="Add ${esc(t.name)}">+</button>
    </li>`;
  }
  function guessMeal() {
    const h = new Date().getHours();
    return h < 11 ? 'breakfast' : h < 15 ? 'lunch' : h < 21 ? 'dinner' : 'snacks';
  }
  $('#add-tabs').addEventListener('click', e => {
    const b = e.target.closest('[data-tab]'); if (!b) return;
    addTab = b.dataset.tab; $('#search-status').hidden = true; renderAdd();
  });
  $('#food-results').addEventListener('click', e => {
    const list = addTab === 'recent' ? state.recent : addTab === 'myfoods' ? state.myFoods : searchResults;
    const q = e.target.closest('[data-quick-idx]');
    if (q) {
      const t = list[Number(q.dataset.quickIdx)];
      if (t) { addEntry(t, defaultServing(t), 1, $('#add-meal').value); toast(`Added ${t.name} to ${MEAL_NAME[$('#add-meal').value]}`); }
      return;
    }
    const li = e.target.closest('[data-food-idx]');
    if (li) { const t = list[Number(li.dataset.foodIdx)]; if (t) openFoodDialog(t, { meal: $('#add-meal').value }); }
  });

  // ---- search ----
  let searchAbort = null, typeT = null;
  function localSearch(q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = t => words.every(w => (t.name + ' ' + (t.brand || '')).toLowerCase().includes(w));
    const mine = [...state.myFoods, ...state.recent].filter(match);
    const common = (window.COMMON_FOODS || []).map(commonTpl).filter(match);
    return dedupe([...mine, ...common]);
  }
  function commonTpl(c) {
    return { name: c[0], brand: '', basis: 'g', per: { kcal: c[1], carbs: c[2], fat: c[3], protein: c[4] }, servingG: c[5], servingLabel: c[6], source: 'common' };
  }
  function dedupe(arr) {
    const seen = new Set();
    return arr.filter(t => { const k = tplKey(t); if (seen.has(k)) return false; seen.add(k); return true; });
  }
  const tplKey = t => t.barcode ? `bc:${t.barcode}` : `n:${t.name.toLowerCase()}|${(t.brand || '').toLowerCase()}`;

  $('#search-input').addEventListener('input', e => {
    const q = e.target.value.trim();
    clearTimeout(typeT);
    if (!q) { searchResults = []; addTab = 'recent'; $('#search-status').hidden = true; renderAdd(); return; }
    typeT = setTimeout(() => {
      searchResults = localSearch(q); addTab = 'results';
      const st = $('#search-status'); st.hidden = false;
      st.textContent = searchResults.length ? 'Press Search on your keyboard to search the full food database' : 'No saved matches. Press Search to look online.';
      renderAdd();
    }, 150);
  });
  $('#search-form').addEventListener('submit', async e => {
    e.preventDefault();
    clearTimeout(typeT);
    const q = $('#search-input').value.trim(); if (!q) return;
    $('#search-input').blur();
    const local = localSearch(q);
    searchResults = local; addTab = 'results'; renderAdd();
    const st = $('#search-status'); st.hidden = false; st.textContent = 'Searching food database…';
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const url = `${OFF}/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
      const res = await fetchTimeout(url, searchAbort.signal, 15000);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      if ($('#search-input').value.trim() !== q) return; // user typed something new
      const online = (data.products || []).map(offToTpl).filter(Boolean);
      searchResults = dedupe([...local, ...online]);
      st.textContent = searchResults.length ? `${searchResults.length} results` : `No results for “${q}”. Try Quick add or Create food.`;
    } catch (err) {
      if (err.name === 'AbortError' && !err.timeout) return;
      st.textContent = navigator.onLine === false
        ? 'You are offline — showing saved & common foods only.'
        : 'Could not reach the food database. Showing saved & common foods.';
    }
    renderAdd();
  });
  async function fetchTimeout(url, signal, ms) {
    const ctrl = new AbortController();
    const onAbort = () => ctrl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    const t = setTimeout(() => { const e = new Error('timeout'); e.name = 'AbortError'; e.timeout = true; ctrl.abort(e); }, ms);
    try { return await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } }); }
    catch (e) { if (ctrl.signal.reason && ctrl.signal.reason.timeout) { const x = new Error('timeout'); x.name = 'TimeoutError'; throw x; } throw e; }
    finally { clearTimeout(t); if (signal) signal.removeEventListener('abort', onAbort); }
  }

  function offToTpl(p) {
    if (!p) return null;
    const n = p.nutriments || {};
    let kcal = num(n['energy-kcal_100g'], NaN);
    if (!Number.isFinite(kcal)) {
      const kj = num(n['energy-kj_100g'], num(n.energy_100g, NaN));
      if (Number.isFinite(kj)) kcal = kj / 4.184;
    }
    const name = (p.product_name || p.product_name_en || p.generic_name || '').trim();
    if (!name || !Number.isFinite(kcal)) return null;
    const sq = num(p.serving_quantity, 0);
    return {
      name: name.slice(0, 100), brand: String(p.brands || '').split(',')[0].trim().slice(0, 60),
      barcode: p.code ? String(p.code) : undefined,
      basis: 'g',
      per: { kcal: r1(kcal), carbs: r1(num(n.carbohydrates_100g)), fat: r1(num(n.fat_100g)), protein: r1(num(n.proteins_100g)) },
      servingG: sq > 0 ? sq : 100,
      servingLabel: sq > 0 && p.serving_size ? String(p.serving_size).slice(0, 40) : (sq > 0 ? `${sq} g` : '100 g'),
      image: safeImg(p.image_front_small_url) || undefined,
      source: 'off',
    };
  }

  // ============ food math ============
  function defaultServing(t) { return t.basis === 'g' ? num(t.lastServingG, num(t.servingG, 100)) : 1; }
  function servingLabel(t, sv) {
    if (t.basis !== 'g') return t.servingLabel || '1 serving';
    if (t.servingLabel && Number(sv) === Number(t.servingG)) return t.servingLabel;
    return `${r1(sv)} g`;
  }
  function calc(t, servingG, qty) {
    const f = t.basis === 'g' ? (num(servingG) * num(qty)) / 100 : num(qty);
    return { kcal: r0(t.per.kcal * f), carbs: r1(num(t.per.carbs) * f), fat: r1(num(t.per.fat) * f), protein: r1(num(t.per.protein) * f) };
  }
  function addEntry(t, servingG, qty, meal, extra = {}) {
    const v = calc(t, servingG, qty);
    const { photo, ...tplNoPhoto } = t;
    const entry = { id: uid(), meal, name: t.name, brand: t.brand || '', qty: num(qty, 1), servingG: t.basis === 'g' ? num(servingG) : null, ...v, tpl: tplNoPhoto, ...extra };
    day(selectedDate).food.push(entry);
    remember(t, servingG);
    if (!save()) { day(selectedDate).food.pop(); return null; }
    render();
    return entry;
  }
  function remember(t, servingG) {
    if (t.noRecent) return;
    const { photo, ...clean } = t;
    const copy = { ...clean, lastServingG: t.basis === 'g' ? num(servingG) : undefined };
    const k = tplKey(copy);
    state.recent = [copy, ...state.recent.filter(x => tplKey(x) !== k)].slice(0, 40);
  }

  // ============ food detail dialog ============
  let fdCtx = null;
  function openFoodDialog(tpl, { entry = null, meal = null } = {}) {
    fdCtx = { tpl, entry };
    $('#fd-title').textContent = entry ? 'Edit Entry' : 'Add Food';
    $('#fd-name').textContent = tpl.name;
    $('#fd-brand').textContent = [tpl.brand, tpl.barcode ? `Barcode ${tpl.barcode}` : ''].filter(Boolean).join(' · ');
    const img = safeImg((entry && entry.photo) || tpl.image);
    $('#fd-img').hidden = !img; if (img) $('#fd-img').src = img; else $('#fd-img').removeAttribute('src');
    const isG = tpl.basis === 'g';
    $('#fd-serving-row').hidden = !isG;
    $('#fd-serving').value = isG ? r1(entry ? num(entry.servingG, tpl.servingG) : defaultServing(tpl)) : '';
    $('#fd-qty').value = entry ? r1(num(entry.qty, 1)) : 1;
    $('#fd-meal').value = entry ? entry.meal : (meal || $('#add-meal').value || guessMeal());
    $('#fd-delete').hidden = !entry;
    updateFd();
    $('#food-dialog').returnValue = '';
    $('#food-dialog').showModal();
  }
  function updateFd() {
    if (!fdCtx) return;
    const t = fdCtx.tpl;
    const v = calc(t, $('#fd-serving').value, $('#fd-qty').value);
    $('#fd-kcal').textContent = fmt(v.kcal);
    const ck = v.carbs * 4, fk = v.fat * 9, pk = v.protein * 4, tot = ck + fk + pk || 1;
    $('#fd-macros').innerHTML = [['carbs', 'Carbs', v.carbs, ck], ['fat', 'Fat', v.fat, fk], ['protein', 'Protein', v.protein, pk]]
      .map(([k, l, g, kc]) => `<div><div class="pct c-${k}">${r0(kc / tot * 100)}%</div><b>${r1(g)} g</b><small>${l}</small></div>`).join('');
    setRing($('#fd-ring'), v.kcal / (num(state.settings.calorieGoal, 2000) || 1));
    $('#fd-goal-pct').textContent = `${r0(v.kcal / num(state.settings.calorieGoal, 2000) * 100)}% of your daily calorie goal`;
  }
  $('#fd-serving').addEventListener('input', updateFd);
  $('#fd-qty').addEventListener('input', updateFd);
  $('#food-dialog').addEventListener('close', () => {
    const dlg = $('#food-dialog');
    if (dlg.returnValue === 'ok' && fdCtx) {
      const t = fdCtx.tpl;
      const qty = num($('#fd-qty').value, 0), sv = t.basis === 'g' ? num($('#fd-serving').value, 0) : 1;
      const meal = $('#fd-meal').value;
      if (qty <= 0 || sv <= 0) { toast('Enter a serving amount'); }
      else if (fdCtx.entry) {
        const e = fdCtx.entry;
        Object.assign(e, calc(t, sv, qty), { qty, servingG: t.basis === 'g' ? sv : null, meal });
        save(); render(); toast('Entry updated');
      } else if (addEntry(t, sv, qty, meal)) {
        toast(`Added to ${MEAL_NAME[meal]}`);
      }
    }
    fdCtx = null;
  });
  $('#fd-delete').addEventListener('click', () => {
    if (!fdCtx || !fdCtx.entry) return;
    const id = fdCtx.entry.id;
    for (const k of Object.keys(state.diary)) state.diary[k].food = state.diary[k].food.filter(f => f.id !== id);
    save(); fdCtx = null; $('#food-dialog').close('cancel'); render(); toast('Removed');
  });

  // ============ quick add / create / photo ============
  let cfMode = 'quick', cfPhoto = null, cfBarcode = null;
  function openCustom(mode, opts = {}) {
    cfMode = mode; cfPhoto = opts.photo || null; cfBarcode = opts.barcode || null;
    const f = $('#custom-form'); f.reset();
    $('#cf-title').textContent = { quick: 'Quick Add', create: 'Create Food', photo: 'Meal Photo' }[mode];
    $('#cf-photo-wrap').hidden = !cfPhoto;
    if (cfPhoto) $('#cf-photo').src = cfPhoto;
    $('#cf-brand-row').hidden = mode !== 'create';
    $('#cf-serving-row').hidden = mode !== 'create';
    $('#cf-save-row').hidden = mode === 'create';
    f.elements.saveMine.checked = mode !== 'quick';
    $('#cf-estimate').hidden = mode !== 'photo';
    f.elements.name.placeholder = mode === 'create' ? 'e.g. Homemade granola' : mode === 'photo' ? 'What did you eat?' : 'Quick add (optional name)';
    f.elements.name.required = mode === 'create';
    f.elements.meal.value = $('#add-meal').value || guessMeal();
    if (opts.barcode) {
      f.elements.name.placeholder = 'Product name from the package';
      $('#cf-title').textContent = 'New Product';
    }
    $('#custom-dialog').returnValue = '';
    $('#custom-dialog').showModal();
  }
  $('#cf-estimates').innerHTML = (window.PHOTO_ESTIMATES || []).map((p, i) => `<button type="button" class="chip" data-est="${i}">${esc(p[0])} · ${p[1]}</button>`).join('');
  $('#cf-estimates').addEventListener('click', e => {
    const b = e.target.closest('[data-est]'); if (!b) return;
    const p = window.PHOTO_ESTIMATES[Number(b.dataset.est)], f = $('#custom-form').elements;
    f.kcal.value = p[1]; f.carbs.value = p[2]; f.fat.value = p[3]; f.protein.value = p[4];
    if (!f.name.value) f.name.value = p[0];
  });
  $('#cf-retake').addEventListener('click', () => { $('#custom-dialog').close('cancel'); $('#photo-input').value = ''; $('#photo-input').click(); });
  $('#custom-dialog').addEventListener('close', () => {
    if ($('#custom-dialog').returnValue !== 'ok') return;
    const f = $('#custom-form').elements;
    const kcal = num(f.kcal.value, NaN);
    if (!Number.isFinite(kcal) || kcal < 0) { toast('Enter calories'); return; }
    const name = f.name.value.trim() || (cfMode === 'photo' ? 'Meal photo' : 'Quick add');
    const meal = f.meal.value;
    const per = { kcal, carbs: num(f.carbs.value), fat: num(f.fat.value), protein: num(f.protein.value) };
    if (cfMode === 'create') {
      const sg = num(f.servingG.value, 0);
      // values entered are per serving; store per-100 g when a serving weight is given so grams can be adjusted later
      const tpl = sg > 0
        ? { name, brand: f.brand.value.trim(), basis: 'g', servingG: sg, servingLabel: `1 serving (${r1(sg)} g)`, per: scalePer(per, 100 / sg), barcode: cfBarcode || undefined, source: 'mine' }
        : { name, brand: f.brand.value.trim(), basis: 'serving', servingLabel: '1 serving', per, barcode: cfBarcode || undefined, source: 'mine' };
      saveMine(tpl);
      if (addEntry(tpl, defaultServing(tpl), 1, meal)) toast(`Saved to My Foods & added to ${MEAL_NAME[meal]}`);
    } else {
      const tpl = { name, brand: '', basis: 'serving', servingLabel: '1 serving', per, source: cfMode, noRecent: !f.saveMine.checked };
      if (f.saveMine.checked) saveMine({ ...tpl, noRecent: undefined });
      if (addEntry(tpl, 1, 1, meal, cfPhoto ? { photo: cfPhoto } : {})) toast(`Added to ${MEAL_NAME[meal]}`);
    }
    cfPhoto = null; cfBarcode = null;
  });
  function scalePer(p, k) { return { kcal: r1(p.kcal * k), carbs: r1(p.carbs * k), fat: r1(p.fat * k), protein: r1(p.protein * k) }; }
  function saveMine(t) {
    const k = tplKey(t);
    state.myFoods = [t, ...state.myFoods.filter(x => tplKey(x) !== k)].slice(0, 200);
  }

  // photo capture -> compress -> meal photo form
  $('#photo-input').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; if (!file) return;
    try { openCustom('photo', { photo: await compressImage(file, 480, 0.7) }); }
    catch (err) { console.warn(err); toast('Could not read that photo'); }
  });
  function compressImage(file, max, quality) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const s = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
      img.src = url;
    });
  }

  // ============ barcode scanner ============
  let scanner = null, scanning = false, scanHandled = false;
  function lib() { return window.__Html5QrcodeLibrary__; }
  function scanFormats() {
    const F = lib().Html5QrcodeSupportedFormats;
    return [F.EAN_13, F.EAN_8, F.UPC_A, F.UPC_E, F.CODE_128, F.CODE_39, F.ITF];
  }
  async function openScanner() {
    const dlg = $('#scan-dialog');
    $('#scan-status').textContent = 'Starting camera…';
    $('#scan-torch').hidden = true;
    $('#scan-manual').reset();
    dlg.showModal();
    scanHandled = false;
    if (!lib()) { $('#scan-status').textContent = 'Scanner failed to load. Type the barcode numbers below.'; return; }
    if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('#scan-status').textContent = 'Live camera needs the app opened over https. Use "Scan from a photo" or type the numbers.';
      return;
    }
    try {
      scanner = new (lib().Html5Qrcode)('scan-reader', { formatsToSupport: scanFormats(), verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
      await scanner.start(
        { facingMode: 'environment' },
        { fps: 12, qrbox: (w, h) => ({ width: Math.max(120, Math.floor(Math.min(w * 0.85, 340))), height: Math.max(80, Math.floor(Math.min(h * 0.45, 180))) }), aspectRatio: 1.333 },
        code => onScanned(code),
        () => {}
      );
      scanning = true;
      $('#scan-status').textContent = 'Line the barcode up inside the box';
      try {
        const torch = scanner.getRunningTrackCameraCapabilities().torchFeature();
        if (torch.isSupported()) { $('#scan-torch').hidden = false; $('#scan-torch').onclick = () => torch.apply(!torch.value()).catch(() => {}); }
      } catch (_) {}
    } catch (err) {
      console.warn('camera', err);
      const msg = String(err && (err.name || err.message || err));
      $('#scan-status').textContent = /NotAllowed|Permission/i.test(msg)
        ? 'Camera permission was blocked. Allow camera access in your browser settings, or use a photo / type the numbers.'
        : 'Could not start the camera. Use "Scan from a photo" or type the numbers.';
      await stopScanner();
    }
  }
  async function stopScanner() {
    if (scanner) {
      try { if (scanning) await scanner.stop(); } catch (_) {}
      try { scanner.clear(); } catch (_) {}
    }
    scanner = null; scanning = false;
  }
  async function onScanned(code) {
    if (scanHandled) return;
    scanHandled = true;
    if (navigator.vibrate) navigator.vibrate(80);
    await stopScanner();
    $('#scan-dialog').close();
    lookupBarcode(String(code).trim());
  }
  $('#scan-close').addEventListener('click', () => $('#scan-dialog').close());
  $('#scan-dialog').addEventListener('close', () => { stopScanner(); });
  $('#scan-dialog').addEventListener('cancel', () => { stopScanner(); });
  $('#scan-manual').addEventListener('submit', e => {
    e.preventDefault();
    const code = e.target.elements.code.value.replace(/\D/g, '');
    if (code.length < 6) { toast('Enter the full barcode number'); return; }
    onScanned(code);
  });
  $('#scan-file').addEventListener('change', async e => {
    const file = e.target.files && e.target.files[0]; e.target.value = '';
    if (!file || !lib()) return;
    $('#scan-status').textContent = 'Reading barcode from photo…';
    await stopScanner();
    const reader = new (lib().Html5Qrcode)('scan-file-reader', { formatsToSupport: scanFormats(), verbose: false, experimentalFeatures: { useBarCodeDetectorIfSupported: true } });
    try {
      const code = await reader.scanFile(file, false);
      onScanned(code);
    } catch (_) {
      $('#scan-status').textContent = 'No barcode found in that photo. Try again closer, with good light, or type the numbers.';
    } finally { try { reader.clear(); } catch (_) {} }
  });

  async function lookupBarcode(code) {
    if (currentView !== 'add') goto('add');
    const local = [...state.myFoods, ...state.recent].find(t => t.barcode === code);
    if (local) { openFoodDialog(local, { meal: $('#add-meal').value }); return; }
    toast('Looking up product…');
    try {
      const res = await fetchTimeout(`${OFF}/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`, null, 15000);
      if (res.status === 404) throw Object.assign(new Error('nf'), { notFound: true });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      const tpl = data && data.status === 1 ? offToTpl({ ...data.product, code }) : null;
      if (!tpl) throw Object.assign(new Error('nf'), { notFound: true });
      openFoodDialog(tpl, { meal: $('#add-meal').value });
    } catch (err) {
      if (err.notFound) {
        toast('Product not found — add it from the nutrition label');
        openCustom('create', { barcode: code });
      } else {
        toast('Could not reach the food database. Check your connection.');
      }
    }
  }

  // ============ exercise ============
  $('#ex-type').innerHTML = Object.entries(EXERCISES).map(([k, [l]]) => `<option value="${k}">${l}</option>`).join('');
  let exKcalTouched = false;
  function exEstimate() {
    const f = $('#exercise-form').elements;
    const met = (EXERCISES[f.type.value] || EXERCISES.other)[1];
    return r0(met * num(state.settings.weightKg, 75) * num(f.minutes.value) / 60);
  }
  function openExercise() {
    const f = $('#exercise-form'); f.reset(); exKcalTouched = false;
    f.elements.kcal.value = exEstimate();
    $('#exercise-dialog').returnValue = ''; $('#exercise-dialog').showModal();
  }
  $('#exercise-form').addEventListener('input', e => {
    if (e.target.name === 'kcal') { exKcalTouched = true; return; }
    if (!exKcalTouched) $('#exercise-form').elements.kcal.value = exEstimate();
  });
  $('#exercise-dialog').addEventListener('close', () => {
    if ($('#exercise-dialog').returnValue !== 'ok') return;
    const f = $('#exercise-form').elements;
    const minutes = r0(num(f.minutes.value)); if (minutes <= 0) { toast('Enter minutes'); return; }
    const label = EXERCISES[f.type.value][0].replace(/^\S+\s/, '');
    day(selectedDate).exercise.push({ id: uid(), type: f.type.value, name: f.name.value.trim() || label, minutes, kcal: Math.max(0, r0(num(f.kcal.value, exEstimate()))) });
    save(); render(); toast('Exercise added');
  });

  // ============ progress ============
  function addWeight(v) {
    if (v <= 0) return;
    const kg = Math.round(toKg(v) * 100) / 100;
    if (kg < 20 || kg > 300) { toast('That weight looks off — check the unit in Settings'); return; }
    const k = dateKey();
    const ex = state.weights.find(w => w.date === k);
    if (ex) ex.kg = kg; else state.weights.push({ id: uid(), date: k, kg });
    state.settings.weightKg = r1(kg);
    if (state.settings.autoGoal) state.settings.calorieGoal = computeGoal(state.settings).goal;
    save(); render(); toast(ex ? 'Updated today’s weight' : 'Weight logged');
  }
  function renderProgress() {
    const unit = state.settings.unit;
    const ws = [...state.weights].sort((a, b) => a.date.localeCompare(b.date));
    if (ws.length) {
      const first = ws[0].kg, last = ws[ws.length - 1].kg, gw = state.settings.goalWeightKg;
      $('#weight-stats').innerHTML = `
        <div class="stat"><strong>${wDisp(last)}</strong><span>Current (${unit})</span></div>
        <div class="stat"><strong>${last - first > 0 ? '+' : ''}${r1(wDisp(last) - wDisp(first))}</strong><span>Change (${unit})</span></div>
        <div class="stat"><strong>${gw ? r1(Math.abs(wDisp(last) - wDisp(gw))) : '—'}</strong><span>To goal (${unit})</span></div>`;
    } else $('#weight-stats').innerHTML = '';
    const recent = ws.slice(-60);
    drawLine($('#chart-weight'), recent.map(w => parseKey(w.date).toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' })), recent.map(w => wDisp(w.kg)),
      state.settings.goalWeightKg ? wDisp(state.settings.goalWeightKg) : null);
    $('#weight-list').innerHTML = ws.length
      ? [...ws].reverse().slice(0, 20).map(w => `<li class="nolink"><div class="e-info"><div class="e-name">${wDisp(w.kg)} ${unit}</div><div class="e-sub">${esc(prettyDate(w.date))}</div></div>
        <button class="del" data-del-weight="${esc(w.id || w.date)}" aria-label="Delete weigh-in">✕</button></li>`).join('')
      : `<li class="empty">No weigh-ins yet. Tap “Log weight”.</li>`;

    const labels = [], vals = [];
    for (let i = 13; i >= 0; i--) { const d = addDays(new Date(), -i); labels.push(String(d.getDate())); vals.push(totals(dateKey(d)).kcal); }
    drawBars($('#chart-cal'), labels, vals, num(state.settings.calorieGoal, 2000));

    const s = state.settings, h = num(s.heightCm) / 100, w = ws.length ? ws[ws.length - 1].kg : num(s.weightKg);
    if (h > 0 && w > 0) {
      const bmi = r1(w / (h * h));
      const [cat, col] = bmi < 18.5 ? ['Underweight', 'var(--blue)'] : bmi < 25 ? ['Healthy weight', 'var(--green)'] : bmi < 30 ? ['Overweight', 'var(--protein)'] : ['Obese', 'var(--red)'];
      $('#bmi-box').innerHTML = `<strong style="color:${col}">${bmi}</strong><div>${cat}</div><div class="muted small">Based on ${s.heightCm} cm and ${wDisp(w)} ${unit}</div>`;
    } else $('#bmi-box').innerHTML = '<span class="muted">Add your height in Settings.</span>';
  }
  $('#weight-list').addEventListener('click', e => {
    const d = e.target.closest('[data-del-weight]');
    if (d && confirm('Delete this weigh-in?')) {
      state.weights = state.weights.filter(w => (w.id || w.date) !== d.dataset.delWeight); save(); renderProgress();
    }
  });

  // ============ charts ============
  function prep(canvas) {
    const dpr = window.devicePixelRatio || 1;
    if (!canvas.dataset.h) canvas.dataset.h = canvas.getAttribute('height') || '150';
    const w = canvas.clientWidth || 300, h = Number(canvas.dataset.h);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); canvas.style.height = h + 'px';
    const ctx = canvas.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
    const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
    return { ctx, w, h, muted: v('--muted'), blue: v('--blue'), red: v('--red'), grid: v('--border'), text: v('--text') };
  }
  function drawBars(canvas, labels, vals, goal) {
    const { ctx, w, h, muted, blue, red, grid, text } = prep(canvas);
    const max = Math.max(...vals, goal || 0, 1) * 1.12, padB = 20, padT = 14, slot = w / labels.length, bw = Math.min(28, slot * 0.6);
    const y = v => h - padB - (v / max) * (h - padB - padT);
    ctx.font = '10px system-ui'; ctx.textAlign = 'center';
    labels.forEach((l, i) => {
      const cx = slot * (i + 0.5), v = vals[i], top = y(v);
      ctx.fillStyle = v ? (goal && v > goal ? red : blue) : grid;
      rr(ctx, cx - bw / 2, Math.min(top, h - padB - 3), bw, Math.max(h - padB - top, 3), 4);
      ctx.fillStyle = muted; ctx.fillText(l, cx, h - 5);
      if (v && slot > 26) { ctx.fillStyle = text; ctx.fillText(fmt(v), cx, top - 3); }
    });
    if (goal) {
      ctx.strokeStyle = muted; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(0, y(goal)); ctx.lineTo(w, y(goal)); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.fillText(`Goal ${fmt(goal)}`, w - 2, y(goal) - 3);
    }
  }
  function drawLine(canvas, labels, vals, goalLine) {
    const { ctx, w, h, muted, blue, grid, text } = prep(canvas);
    ctx.font = '11px system-ui';
    if (vals.length < 2) { ctx.fillStyle = muted; ctx.textAlign = 'center'; ctx.fillText(vals.length ? 'Log one more weigh-in to see your trend' : 'No weigh-ins yet', w / 2, h / 2); return; }
    const all = goalLine ? [...vals, goalLine] : vals;
    let min = Math.min(...all), max = Math.max(...all); if (max - min < 2) { min -= 1; max += 1; }
    const pL = 38, pR = 10, pT = 12, pB = 22;
    const x = i => pL + i / (vals.length - 1) * (w - pL - pR), y = v => pT + (1 - (v - min) / (max - min)) * (h - pT - pB);
    ctx.strokeStyle = grid; ctx.fillStyle = muted; ctx.textAlign = 'right'; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const v = min + i / 3 * (max - min); ctx.beginPath(); ctx.moveTo(pL, y(v)); ctx.lineTo(w - pR, y(v)); ctx.stroke(); ctx.fillText(r1(v), pL - 4, y(v) + 4); }
    ctx.textAlign = 'center';
    const step = Math.ceil(labels.length / 6);
    labels.forEach((l, i) => { if (i % step === 0 || i === labels.length - 1) ctx.fillText(l, x(i), h - 5); });
    if (goalLine) { ctx.strokeStyle = text; ctx.setLineDash([4, 4]); ctx.beginPath(); ctx.moveTo(pL, y(goalLine)); ctx.lineTo(w - pR, y(goalLine)); ctx.stroke(); ctx.setLineDash([]); }
    ctx.strokeStyle = blue; ctx.lineWidth = 2.5; ctx.lineJoin = 'round';
    ctx.beginPath(); vals.forEach((v, i) => i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))); ctx.stroke();
    ctx.fillStyle = blue; vals.forEach((v, i) => { ctx.beginPath(); ctx.arc(x(i), y(v), 3, 0, 7); ctx.fill(); });
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2); ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); ctx.fill();
  }

  // ============ settings ============
  const pf = $('#profile-form');
  function renderSettings() {
    const s = state.settings, e = pf.elements;
    e.name.value = s.name; e.sex.value = s.sex; e.age.value = s.age; e.heightCm.value = s.heightCm;
    e.weight.value = wDisp(s.weightKg); e.activity.value = String(s.activity); e.goal.value = String(s.goal);
    e.goalWeight.value = s.goalWeightKg ? wDisp(s.goalWeightKg) : '';
    e.autoGoal.checked = !!s.autoGoal; e.calorieGoal.value = s.calorieGoal;
    e.carbsPct.value = s.carbsPct; e.fatPct.value = s.fatPct; e.proteinPct.value = s.proteinPct;
    e.waterGoal.value = s.waterGoal; e.stepGoal.value = s.stepGoal; e.unit.value = s.unit;
    $$('.unit-label').forEach(x => x.textContent = s.unit);
    previewGoal();
  }
  function formProfile() {
    const e = pf.elements, unit = e.unit.value === 'lb' ? 'lb' : 'kg';
    const kgFrom = v => unit === 'lb' ? v / LB : v;
    return {
      name: e.name.value.trim().slice(0, 40), sex: e.sex.value === 'female' ? 'female' : 'male',
      age: Math.min(100, Math.max(13, r0(num(e.age.value, 30)))), heightCm: Math.min(250, Math.max(100, num(e.heightCm.value, 175))),
      weightKg: r1(Math.min(300, Math.max(25, kgFrom(num(e.weight.value, 75))))),
      activity: num(e.activity.value, 1.375), goal: num(e.goal.value, 0),
      goalWeightKg: num(e.goalWeight.value, 0) > 0 ? r1(kgFrom(num(e.goalWeight.value))) : null,
      autoGoal: e.autoGoal.checked, calorieGoal: Math.min(6000, Math.max(800, r0(num(e.calorieGoal.value, 2000)))),
      carbsPct: r0(num(e.carbsPct.value, 50)), fatPct: r0(num(e.fatPct.value, 30)), proteinPct: r0(num(e.proteinPct.value, 20)),
      waterGoal: Math.max(1, r0(num(e.waterGoal.value, 8))), stepGoal: Math.max(500, r0(num(e.stepGoal.value, 10000))), unit,
    };
  }
  function previewGoal() {
    const p = formProfile(), g = computeGoal(p), e = pf.elements;
    e.calorieGoal.readOnly = p.autoGoal;
    if (p.autoGoal) e.calorieGoal.value = g.goal;
    $('#goal-explain').textContent = p.autoGoal
      ? `Your body burns about ${fmt(g.tdee)} cal/day (BMR ${fmt(g.bmr)} × activity). Goal = ${fmt(g.goal)} cal/day.${g.floored ? ' Raised to a safe minimum.' : ''}`
      : 'Using your custom calorie goal.';
    const sum = p.carbsPct + p.fatPct + p.proteinPct;
    $('#macro-sum').textContent = sum === 100 ? 'Macros add up to 100% ✓' : `Macros add up to ${sum}% — they must total 100%.`;
    $('#macro-sum').style.color = sum === 100 ? '' : 'var(--red)';
  }
  pf.addEventListener('input', e => {
    if (e.target.name === 'unit') {
      // convert displayed weights when switching unit
      const old = state.settings.unit, nu = e.target.value, f = old === nu ? 1 : (nu === 'lb' ? LB : 1 / LB);
      ['weight', 'goalWeight'].forEach(n => { if (pf.elements[n].value) pf.elements[n].value = r1(num(pf.elements[n].value) * f); });
      $$('.unit-label').forEach(x => x.textContent = nu);
      state.settings.unit = nu; save();
    }
    previewGoal();
  });
  pf.addEventListener('submit', e => {
    e.preventDefault();
    const p = formProfile();
    if (p.carbsPct + p.fatPct + p.proteinPct !== 100) { toast('Macro percentages must add up to 100%'); return; }
    if (p.autoGoal) p.calorieGoal = computeGoal(p).goal;
    state.settings = { ...state.settings, ...p, welcomed: true };
    save(); toast('Settings saved'); goto('home');
  });

  $('#export-btn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(state)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `fittrack-backup-${dateKey()}.json`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup downloaded');
  });
  $('#import-file').addEventListener('change', async e => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!d || !isObj(d.diary) || !isObj(d.settings)) throw new Error('bad');
      if (!confirm('Replace all data on this phone with this backup?')) return;
      state = normalize(d); save(); renderSettings(); toast('Backup restored');
    } catch (_) { toast('⚠️ Not a valid FitTrack backup file'); }
    finally { e.target.value = ''; }
  });
  $('#reset-btn').addEventListener('click', () => {
    if (!confirm('Delete ALL food, exercise, weight and settings? This cannot be undone.')) return;
    state = fresh(); save(); renderSettings(); toast('All data deleted');
  });

  // ============ PWA install ============
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; $('#install-card').hidden = false; });
  $('#install-btn').addEventListener('click', async () => {
    if (!deferred) return; deferred.prompt(); await deferred.userChoice.catch(() => {}); deferred = null; $('#install-card').hidden = true;
  });
  const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (isIOS && !standalone) $('#ios-install-card').hidden = false;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW', err)));
  }

  // ============ init ============
  let resizeT;
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(render, 150); });
  let lastDay = dateKey();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (scanning) $('#scan-dialog').close(); return; }
    if (dateKey() !== lastDay) { if (selectedDate === lastDay) selectedDate = dateKey(); lastDay = dateKey(); render(); }
  });
  $('#add-meal').value = guessMeal();
  if (!state.settings.welcomed) {
    state.settings.welcomed = true; save();
    goto('more');
    setTimeout(() => toast('👋 Welcome! Set up your profile to get your calorie goal'), 400);
  } else {
    goto(location.hash.slice(1) || 'home');
  }
})();
