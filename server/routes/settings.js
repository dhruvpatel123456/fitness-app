// Profile, goals and app settings.

import express from 'express';
import { ACTIVITY_LEVELS, SEXES, WEEKLY_GOALS, minimumKcal } from '../../shared/goals.js';
import { APP_NAME, APP_VERSION } from '../config.js';
import { getAllSettings, getSetting, getTargetHistory, latestWeight, setSetting } from '../store.js';
import { HttpError, invalid, nowIso, vArr, vBool, vDate, vEnum, vNum, vObj, vStr } from '../util.js';

const ACTIVITY_KEYS = ACTIVITY_LEVELS.map((a) => a.key);
const WEEKLY_KG = WEEKLY_GOALS.map((g) => g.kg);

export function vProfile(src, today) {
  const p = vObj(src, 'profile');
  const weekly = vNum(p.weekly_goal_kg, 'weekly_goal_kg', { min: -1, max: 0.5 });
  if (!WEEKLY_KG.includes(weekly)) throw invalid('weekly_goal_kg', 'Choose one of the weekly goals');
  return {
    sex: vEnum(p.sex, 'sex', SEXES),
    age: vNum(p.age, 'age', { min: 13, max: 120, integer: true }),
    age_as_of: today,
    height_cm: vNum(p.height_cm, 'height_cm', { min: 100, max: 250 }),
    goal_weight_kg: vNum(p.goal_weight_kg, 'goal_weight_kg', { min: 25, max: 400 }),
    activity: vEnum(p.activity, 'activity', ACTIVITY_KEYS),
    weekly_goal_kg: weekly,
  };
}

function vTargetSet(src, field) {
  const t = vObj(src, field);
  return {
    kcal: vNum(t.kcal, 'kcal', { min: 500, max: 15000 }),
    protein_g: vNum(t.protein_g, 'protein_g', { min: 0, max: 2000 }),
    carbs_g: vNum(t.carbs_g, 'carbs_g', { min: 0, max: 2000 }),
    fat_g: vNum(t.fat_g, 'fat_g', { min: 0, max: 2000 }),
  };
}

export function vTargets(src) {
  const base = vTargetSet(src, 'targets');
  const weekdays = {};
  if (src.weekdays !== undefined && src.weekdays !== null) {
    const w = vObj(src.weekdays, 'weekdays');
    for (const key of Object.keys(w)) {
      if (!/^[0-6]$/.test(key)) throw invalid('weekdays', 'Weekday targets must be keyed 0 (Sunday) to 6 (Saturday)');
      if (w[key] === null || w[key] === undefined) continue;
      weekdays[key] = vTargetSet(w[key], `weekdays.${key}`);
    }
  }
  return Object.keys(weekdays).length ? { ...base, weekdays } : base;
}

/** Throws unless every calorie target is at or above the minimum, or the user confirmed. */
export function checkLowTarget(targets, sex, confirmed) {
  const minimum = minimumKcal(sex);
  const all = [targets.kcal, ...Object.values(targets.weekdays || {}).map((d) => d.kcal)];
  const lowest = Math.min(...all);
  if (lowest < minimum && confirmed !== true) {
    throw new HttpError(
      422,
      'low_target',
      `A target of ${Math.round(lowest)} kcal is below the usual minimum of ${minimum} kcal a day. Confirm that you want to use it.`,
      { minimum, lowest },
    );
  }
}

export function saveTargets(db, effectiveFrom, targets) {
  db.prepare(
    `INSERT INTO target_history (effective_from, targets, created_at) VALUES (?, ?, ?)
     ON CONFLICT (effective_from) DO UPDATE SET targets = excluded.targets, created_at = excluded.created_at`,
  ).run(effectiveFrom, JSON.stringify(targets), nowIso());
}

export function settingsRoutes({ db, config }) {
  const r = express.Router();

  function bootstrap() {
    const s = getAllSettings(db);
    const history = getTargetHistory(db);
    return {
      app: { name: APP_NAME, version: APP_VERSION },
      settings: {
        energy_unit: s.energy_unit,
        meal_names: s.meal_names,
        water_glass_ml: s.water_glass_ml,
        water_goal_ml: s.water_goal_ml,
        exercise_adds_back: s.exercise_adds_back,
        theme: s.theme,
        macro_mode: s.macro_mode,
      },
      profile: s.profile,
      onboarded: s.onboarded === true,
      targets: history.length ? history[history.length - 1] : null,
      latest_weight: latestWeight(db),
      usda_enabled: Boolean(config.usdaApiKey),
    };
  }

  r.get('/bootstrap', (req, res) => {
    res.json(bootstrap());
  });

  r.put('/settings', (req, res) => {
    const b = vObj(req.body);
    const changes = {};
    if (b.energy_unit !== undefined) changes.energy_unit = vEnum(b.energy_unit, 'energy_unit', ['kcal', 'kJ']);
    if (b.meal_names !== undefined) {
      const names = vArr(b.meal_names, 'meal_names', { min: 4, max: 4 });
      changes.meal_names = names.map((n, i) => vStr(n, `meal name ${i + 1}`, { min: 1, max: 24 }));
    }
    if (b.water_glass_ml !== undefined) changes.water_glass_ml = vNum(b.water_glass_ml, 'water_glass_ml', { min: 50, max: 2000 });
    if (b.water_goal_ml !== undefined) changes.water_goal_ml = vNum(b.water_goal_ml, 'water_goal_ml', { min: 250, max: 10000 });
    if (b.exercise_adds_back !== undefined) changes.exercise_adds_back = vBool(b.exercise_adds_back, 'exercise_adds_back');
    if (b.theme !== undefined) changes.theme = vEnum(b.theme, 'theme', ['system', 'light', 'dark']);
    if (b.macro_mode !== undefined) changes.macro_mode = vEnum(b.macro_mode, 'macro_mode', ['percent', 'grams']);
    const save = db.transaction(() => {
      for (const [key, value] of Object.entries(changes)) setSetting(db, key, value);
    });
    save();
    res.json(bootstrap());
  });

  r.put('/profile', (req, res) => {
    const b = vObj(req.body);
    const today = vDate(b.today, 'today');
    setSetting(db, 'profile', vProfile(b.profile, today));
    res.json(bootstrap());
  });

  r.put('/targets', (req, res) => {
    const b = vObj(req.body);
    const effectiveFrom = vDate(b.effective_from, 'effective_from');
    const targets = vTargets(vObj(b.targets, 'targets'));
    const profile = getSetting(db, 'profile');
    checkLowTarget(targets, profile?.sex, b.confirm_low);
    saveTargets(db, effectiveFrom, targets);
    res.json(bootstrap());
  });

  // First run: profile, starting weight and targets in one step.
  r.put('/onboarding', (req, res) => {
    const b = vObj(req.body);
    const today = vDate(b.today, 'today');
    const profile = vProfile(b.profile, today);
    const weightKg = vNum(b.weight_kg, 'weight_kg', { min: 25, max: 400 });
    const targets = vTargets(vObj(b.targets, 'targets'));
    checkLowTarget(targets, profile.sex, b.confirm_low);
    const save = db.transaction(() => {
      setSetting(db, 'profile', profile);
      db.prepare(
        `INSERT INTO weights (date, kg, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
      ).run(today, weightKg, nowIso());
      saveTargets(db, today, targets);
      setSetting(db, 'onboarded', true);
    });
    save();
    res.json(bootstrap());
  });

  return r;
}
