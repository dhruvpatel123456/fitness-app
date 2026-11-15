// Energy and macro targets: Mifflin-St Jeor BMR, activity multipliers,
// weekly-goal adjustment, and macro splits.

import { fullYearsBetween, weekday } from './dates.js';

export const SEXES = ['male', 'female'];

/** Daily targets below these need an explicit confirmation. */
export const MIN_KCAL = { male: 1500, female: 1200 };

/** Energy in one kilogram of body weight change (the common 7,700 kcal estimate). */
export const KCAL_PER_KG = 7700;

export const ACTIVITY_LEVELS = [
  { key: 'sedentary', label: 'Not very active', detail: 'Mostly sitting, e.g. desk job', factor: 1.2 },
  { key: 'light', label: 'Lightly active', detail: 'On your feet for part of the day', factor: 1.375 },
  { key: 'moderate', label: 'Active', detail: 'On your feet most of the day', factor: 1.55 },
  { key: 'very', label: 'Very active', detail: 'Physical work for most of the day', factor: 1.725 },
  { key: 'extra', label: 'Extremely active', detail: 'Heavy physical work or twice-daily training', factor: 1.9 },
];

/** Weekly goals in kg per week (negative = lose). */
export const WEEKLY_GOALS = [
  { kg: -1, label: 'Lose 1 kg per week' },
  { kg: -0.75, label: 'Lose 0.75 kg per week' },
  { kg: -0.5, label: 'Lose 0.5 kg per week' },
  { kg: -0.25, label: 'Lose 0.25 kg per week' },
  { kg: 0, label: 'Maintain my weight' },
  { kg: 0.25, label: 'Gain 0.25 kg per week' },
  { kg: 0.5, label: 'Gain 0.5 kg per week' },
];

export const DEFAULT_MACRO_SPLIT = { protein: 30, carbs: 40, fat: 30 };
export const KCAL_PER_GRAM = { protein: 4, carbs: 4, fat: 9 };

/** Basal metabolic rate, Mifflin-St Jeor (kcal/day). */
export function bmr({ sex, weightKg, heightCm, age }) {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  return sex === 'female' ? base - 161 : base + 5;
}

export function activityFactor(key) {
  const level = ACTIVITY_LEVELS.find((a) => a.key === key);
  return level ? level.factor : 1.2;
}

/** Total daily energy expenditure (kcal/day). */
export function tdee(profile) {
  return bmr(profile) * activityFactor(profile.activity);
}

/** Daily energy change for a weekly weight goal (kg/week, negative = deficit). */
export function dailyDelta(weeklyKg) {
  return (weeklyKg * KCAL_PER_KG) / 7;
}

export function minimumKcal(sex) {
  return MIN_KCAL[sex] ?? MIN_KCAL.female;
}

export function isLowTarget(sex, kcal) {
  return kcal < minimumKcal(sex);
}

/**
 * Daily calorie target from a profile.
 * profile: { sex, weightKg, heightCm, age, activity, weeklyGoalKg }
 */
export function calorieTarget(profile) {
  const b = bmr(profile);
  const t = b * activityFactor(profile.activity);
  const delta = dailyDelta(profile.weeklyGoalKg || 0);
  const raw = t + delta;
  const minimum = minimumKcal(profile.sex);
  return {
    bmr: b,
    tdee: t,
    delta,
    raw,
    /** The raw target rounded to the nearest 10 kcal, as a tidy suggestion. */
    suggested: Math.round(raw / 10) * 10,
    minimum,
    belowMinimum: raw < minimum,
  };
}

/** Grams of each macro for a calorie target and a percentage split. */
export function macroGrams(kcal, split = DEFAULT_MACRO_SPLIT) {
  return {
    protein_g: (kcal * split.protein) / 100 / KCAL_PER_GRAM.protein,
    carbs_g: (kcal * split.carbs) / 100 / KCAL_PER_GRAM.carbs,
    fat_g: (kcal * split.fat) / 100 / KCAL_PER_GRAM.fat,
  };
}

/** Percentage split of a calorie target for given gram targets. */
export function macroSplitFromGrams(kcal, grams) {
  if (!(kcal > 0)) return { protein: 0, carbs: 0, fat: 0 };
  return {
    protein: ((grams.protein_g * KCAL_PER_GRAM.protein) / kcal) * 100,
    carbs: ((grams.carbs_g * KCAL_PER_GRAM.carbs) / kcal) * 100,
    fat: ((grams.fat_g * KCAL_PER_GRAM.fat) / kcal) * 100,
  };
}

/** Age today, given the age that was entered and the date it was entered on. */
export function effectiveAge(profile, today) {
  if (!profile) return 0;
  const extra = profile.age_as_of && today ? fullYearsBetween(profile.age_as_of, today) : 0;
  return profile.age + extra;
}

/**
 * The targets that apply on a given date.
 *
 * history: [{ effective_from: 'YYYY-MM-DD', targets: { kcal, protein_g, carbs_g, fat_g, weekdays? } }]
 *   `weekdays` optionally overrides targets for a day of the week, keyed
 *   "0" (Sunday) to "6" (Saturday).
 *
 * The entry used is the latest one that started on or before the date. Days
 * before the first entry use the first entry.
 */
export function resolveTargets(history, date) {
  if (!history || history.length === 0) return null;
  const sorted = [...history].sort((a, b) => (a.effective_from < b.effective_from ? -1 : 1));
  let chosen = sorted[0];
  for (const h of sorted) {
    if (h.effective_from <= date) chosen = h;
    else break;
  }
  const t = chosen.targets;
  const override = t.weekdays ? t.weekdays[String(weekday(date))] : null;
  const src = override || t;
  return {
    kcal: src.kcal,
    protein_g: src.protein_g,
    carbs_g: src.carbs_g,
    fat_g: src.fat_g,
    effective_from: chosen.effective_from,
    weekday_override: Boolean(override),
  };
}
