// Tests for the calculation logic: BMR/TDEE, targets, macros, serving
// conversion, recipe nutrition, kJ/kcal conversion, dates and trends.

// Run the date tests in an Australian time zone with daylight saving.
process.env.TZ = 'Australia/Sydney';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ACTIVITIES, exerciseKcal, findActivity } from '../shared/activities.js';
import {
  addDays,
  diffDays,
  dmyToIso,
  eachDate,
  formatDMY,
  friendlyDate,
  fullYearsBetween,
  isDateStr,
  localDate,
  mondayOf,
  weekday,
} from '../shared/dates.js';
import {
  ACTIVITY_LEVELS,
  WEEKLY_GOALS,
  bmr,
  calorieTarget,
  dailyDelta,
  effectiveAge,
  isLowTarget,
  macroGrams,
  macroSplitFromGrams,
  resolveTargets,
  tdee,
} from '../shared/goals.js';
import {
  energyFromMacros,
  kcalToKj,
  kjToKcal,
  macroPercentages,
  nutritionProblems,
  per100FromServing,
  recipeNutrition,
  scaleNutrition,
  sumNutrition,
  unitOptions,
} from '../shared/nutrition.js';
import { computeStreak, weeklyAverages, weightTrend } from '../shared/trend.js';

const close = (actual, expected, tolerance = 1e-9) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);

// ---- BMR / TDEE / targets ---------------------------------------------------

test('BMR uses Mifflin-St Jeor for men', () => {
  // 10 x 80 + 6.25 x 180 - 5 x 30 + 5
  assert.equal(bmr({ sex: 'male', weightKg: 80, heightCm: 180, age: 30 }), 1780);
});

test('BMR uses Mifflin-St Jeor for women', () => {
  // 10 x 65 + 6.25 x 165 - 5 x 40 - 161
  assert.equal(bmr({ sex: 'female', weightKg: 65, heightCm: 165, age: 40 }), 1320.25);
});

test('TDEE multiplies BMR by the standard activity factors', () => {
  const base = { sex: 'male', weightKg: 80, heightCm: 180, age: 30 };
  const expected = { sedentary: 1.2, light: 1.375, moderate: 1.55, very: 1.725, extra: 1.9 };
  assert.deepEqual(
    ACTIVITY_LEVELS.map((a) => a.key),
    Object.keys(expected),
  );
  for (const [activity, factor] of Object.entries(expected)) {
    close(tdee({ ...base, activity }), 1780 * factor);
  }
});

test('the weekly goal changes the daily target by 7,700 kcal per kg', () => {
  close(dailyDelta(-0.5), -550);
  close(dailyDelta(-1), -1100);
  close(dailyDelta(0.25), 275);
  assert.equal(dailyDelta(0), 0);
  assert.deepEqual(
    WEEKLY_GOALS.map((g) => g.kg),
    [-1, -0.75, -0.5, -0.25, 0, 0.25, 0.5],
  );
});

test('calorie target = TDEE + weekly goal adjustment, with a tidy suggestion', () => {
  const t = calorieTarget({ sex: 'male', weightKg: 80, heightCm: 180, age: 30, activity: 'moderate', weeklyGoalKg: -0.5 });
  close(t.bmr, 1780);
  close(t.tdee, 2759);
  close(t.raw, 2209);
  assert.equal(t.suggested, 2210);
  assert.equal(t.minimum, 1500);
  assert.equal(t.belowMinimum, false);
});

test('a target below 1,500 (men) or 1,200 (women) is flagged', () => {
  const small = calorieTarget({ sex: 'female', weightKg: 50, heightCm: 155, age: 60, activity: 'sedentary', weeklyGoalKg: -1 });
  assert.equal(small.minimum, 1200);
  assert.equal(small.belowMinimum, true);
  const man = calorieTarget({ sex: 'male', weightKg: 60, heightCm: 165, age: 50, activity: 'sedentary', weeklyGoalKg: -0.5 });
  assert.equal(man.minimum, 1500);
  assert.equal(man.belowMinimum, true);
  assert.equal(isLowTarget('male', 1499), true);
  assert.equal(isLowTarget('male', 1500), false);
  assert.equal(isLowTarget('female', 1199), true);
  assert.equal(isLowTarget('female', 1200), false);
});

// ---- macros -------------------------------------------------------------------

test('default macro split is 30% protein, 40% carbs, 30% fat', () => {
  const g = macroGrams(2000);
  close(g.protein_g, 150); // 600 kcal / 4
  close(g.carbs_g, 200); // 800 kcal / 4
  close(g.fat_g, 600 / 9);
});

test('macro grams and percentages convert both ways', () => {
  const g = macroGrams(2400, { protein: 25, carbs: 50, fat: 25 });
  close(g.protein_g, 150);
  close(g.carbs_g, 300);
  close(g.fat_g, 600 / 9);
  const split = macroSplitFromGrams(2400, g);
  close(split.protein, 25);
  close(split.carbs, 50);
  close(split.fat, 25);
  assert.deepEqual(macroSplitFromGrams(0, g), { protein: 0, carbs: 0, fat: 0 });
});

test('energy from macros and macro percentages', () => {
  assert.equal(energyFromMacros(10, 20, 5), 165);
  const pct = macroPercentages(50, 50, 0);
  close(pct.protein, 50);
  close(pct.carbs, 50);
  assert.equal(pct.fat, 0);
  assert.deepEqual(macroPercentages(0, 0, 0), { protein: 0, carbs: 0, fat: 0 });
});

test('targets resolve by date, with weekday overrides', () => {
  const history = [
    { effective_from: '2026-01-10', targets: { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 67 } },
    {
      effective_from: '2026-03-01',
      targets: {
        kcal: 1800,
        protein_g: 135,
        carbs_g: 180,
        fat_g: 60,
        weekdays: { 6: { kcal: 2200, protein_g: 140, carbs_g: 260, fat_g: 70 } },
      },
    },
  ];
  assert.equal(resolveTargets(history, '2026-02-01').kcal, 2000);
  assert.equal(resolveTargets(history, '2026-01-01').kcal, 2000, 'days before the first goal use the first goal');
  assert.equal(resolveTargets(history, '2026-03-02').kcal, 1800); // a Monday
  const saturday = resolveTargets(history, '2026-03-07');
  assert.equal(saturday.kcal, 2200);
  assert.equal(saturday.weekday_override, true);
  assert.equal(resolveTargets(history, '2026-02-28').kcal, 2000, 'a Saturday before the override existed');
  assert.equal(resolveTargets([], '2026-03-07'), null);
});

test('age moves on with the calendar', () => {
  const profile = { age: 30, age_as_of: '2026-03-10' };
  assert.equal(effectiveAge(profile, '2026-11-15'), 30);
  assert.equal(effectiveAge(profile, '2027-03-09'), 30);
  assert.equal(effectiveAge(profile, '2027-03-10'), 31);
  assert.equal(fullYearsBetween('2024-02-29', '2026-02-28'), 1);
});

// ---- serving conversion ---------------------------------------------------------

test('nutrition scales from the per-100 base, unknown stays unknown', () => {
  const chicken = { kcal: 165, protein: 31, carbs: 0, fat: 3.6, fibre: null, sugar: null, sat_fat: 1, sodium: 74 };
  const s = scaleNutrition(chicken, 150);
  close(s.kcal, 247.5);
  close(s.protein, 46.5);
  assert.equal(s.carbs, 0);
  close(s.fat, 5.4);
  assert.equal(s.fibre, null);
  assert.equal(s.sugar, null);
  close(s.sodium, 111);
});

test('values are not rounded in the maths', () => {
  const s = scaleNutrition({ kcal: 52, protein: 0.3, carbs: 13.8, fat: 0.2 }, 182);
  assert.equal(s.kcal, (52 * 182) / 100);
  assert.equal(s.protein, (0.3 * 182) / 100);
});

test('label values per serving convert to the per-100 base', () => {
  const per100 = per100FromServing({ kcal: 120, protein: 3, carbs: 20, fat: 3, fibre: null }, 30);
  close(per100.kcal, 400);
  close(per100.protein, 10);
  close(per100.carbs, 200 / 3);
  assert.equal(per100.fibre, null);
  assert.equal(per100FromServing({ kcal: 120 }, 0).kcal, null);
});

test('a food offers 100 g, its named servings, and a free gram amount', () => {
  const opts = unitOptions({
    base_unit: 'g',
    servings: [
      { label: '1 slice (30 g)', amount: 30 },
      { label: '1 slice (30 g)', amount: 30 },
      { label: 'bad', amount: 0 },
    ],
  });
  assert.deepEqual(
    opts.map((o) => [o.label, o.amount]),
    [
      ['100 g', 100],
      ['1 slice (30 g)', 30],
      ['g', 1],
    ],
  );
  const drink = unitOptions({ base_unit: 'ml', servings: [{ label: '1 can (375 mL)', amount: 375 }] });
  assert.deepEqual(
    drink.map((o) => o.label),
    ['100 mL', '1 can (375 mL)', 'mL'],
  );
});

test('totals skip unknown values and count them', () => {
  const { totals, unknown } = sumNutrition([
    { kcal: 100, protein: 5, carbs: 10, fat: 2, fibre: null, sugar: 1, sat_fat: null, sodium: 50 },
    { kcal: 50, protein: null, carbs: 5, fat: 1, fibre: 2, sugar: null, sat_fat: null, sodium: null },
  ]);
  assert.equal(totals.kcal, 150);
  assert.equal(totals.protein, 5);
  assert.equal(unknown.protein, 1);
  assert.equal(unknown.kcal, 0);
  assert.equal(unknown.sat_fat, 2);
  assert.equal(totals.fibre, 2);
});

test('impossible per-100 values are reported', () => {
  assert.deepEqual(nutritionProblems({ kcal: 250, protein: 10, carbs: 30, fat: 9 }), []);
  assert.equal(nutritionProblems({ kcal: 1200 })[0].field, 'kcal');
  assert.equal(nutritionProblems({ kcal: 100, protein: -1 })[0].field, 'protein');
  assert.equal(nutritionProblems({ kcal: 100, fat: 101 })[0].field, 'fat');
  assert.equal(nutritionProblems({ kcal: Number.NaN })[0].field, 'kcal');
});

// ---- recipes ----------------------------------------------------------------------

test('recipe nutrition is the ingredient total divided by servings', () => {
  const ingredients = [
    { amount: 200, kcal: 100, protein: 10, carbs: 5, fat: 2, fibre: 1, sugar: 1, sat_fat: 0.5, sodium: 100 },
    { amount: 100, kcal: 350, protein: 12, carbs: 70, fat: 1.5, fibre: 3, sugar: 2, sat_fat: 0.3, sodium: 5 },
  ];
  const r = recipeNutrition(ingredients, 4);
  close(r.total.kcal, 550); // 200 + 350
  close(r.perServing.kcal, 137.5);
  close(r.total.protein, 32); // 20 + 12
  close(r.perServing.protein, 8);
  close(r.total.carbs, 80); // 10 + 70
  close(r.perServing.carbs, 20);
  close(r.total.sodium, 205);
  assert.equal(r.rawWeight, 300);
  close(r.servingWeight, 75);
  close(r.per100.kcal, (550 / 300) * 100);
  assert.deepEqual(r.missing, []);
});

test('a cooked weight changes the per-100 values but not the per-serving values', () => {
  const ingredients = [
    { amount: 200, kcal: 100, protein: 10, carbs: 5, fat: 2 },
    { amount: 100, kcal: 350, protein: 12, carbs: 70, fat: 1.5 },
  ];
  const r = recipeNutrition(ingredients, 4, 250);
  close(r.perServing.kcal, 137.5);
  close(r.per100.kcal, 220);
  close(r.servingWeight, 62.5);
  // Logging one serving by weight gives the same answer as dividing the total.
  close(scaleNutrition(r.per100, r.servingWeight).kcal, 137.5);
});

test('a recipe value is unknown if any ingredient lacks it', () => {
  const r = recipeNutrition(
    [
      { amount: 100, kcal: 100, protein: 5, carbs: 10, fat: 2, fibre: 3 },
      { amount: 100, kcal: 200, protein: 5, carbs: 10, fat: 2, fibre: null },
    ],
    2,
  );
  close(r.perServing.kcal, 150);
  assert.equal(r.perServing.fibre, null);
  assert.ok(r.missing.includes('fibre'));
  assert.ok(!r.missing.includes('kcal'));
});

// ---- kJ / kcal ----------------------------------------------------------------------

test('kJ and kcal convert with 4.184', () => {
  close(kjToKcal(418.4), 100);
  close(kcalToKj(100), 418.4);
  close(kjToKcal(kcalToKj(2345.6)), 2345.6);
  close(kjToKcal(8700), 2079.35, 0.01); // the 8,700 kJ figure on Australian food labels
});

// ---- dates ---------------------------------------------------------------------------

test('a diary date is the local calendar date, also around midnight', () => {
  assert.equal(localDate(new Date(2026, 10, 16, 23, 55)), '2026-11-16');
  assert.equal(localDate(new Date(2026, 10, 17, 0, 5)), '2026-11-17');
  assert.equal(localDate(new Date(2026, 11, 31, 23, 59, 59)), '2026-12-31');
  assert.equal(localDate(new Date(2027, 0, 1, 0, 0, 0)), '2027-01-01');
});

test('local dates are right on daylight-saving change days (Sydney)', () => {
  // Clocks go forward at 2 am on 4 Oct 2026 and back at 3 am on 5 Apr 2026.
  assert.equal(localDate(new Date(2026, 9, 4, 1, 30)), '2026-10-04');
  assert.equal(localDate(new Date(2026, 9, 4, 3, 30)), '2026-10-04');
  assert.equal(localDate(new Date(2026, 9, 3, 23, 59)), '2026-10-03');
  assert.equal(localDate(new Date(2026, 3, 5, 2, 30)), '2026-04-05');
  assert.equal(localDate(new Date(2026, 3, 4, 23, 59)), '2026-04-04');
  // UTC is still "yesterday" in the Australian morning; the local date must win.
  const morning = new Date(2026, 10, 16, 8, 0);
  assert.equal(morning.toISOString().slice(0, 10), '2026-11-15');
  assert.equal(localDate(morning), '2026-11-16');
});

test('adding days never skips or repeats a date', () => {
  assert.equal(addDays('2026-10-03', 1), '2026-10-04');
  assert.equal(addDays('2026-10-04', 1), '2026-10-05');
  assert.equal(addDays('2026-04-04', 1), '2026-04-05');
  assert.equal(addDays('2026-04-05', 1), '2026-04-06');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(diffDays('2026-01-01', '2026-12-31'), 364);
  assert.equal(diffDays('2026-10-03', '2026-10-05'), 2);
  const year = eachDate('2026-01-01', '2026-12-31');
  assert.equal(year.length, 365);
  assert.equal(new Set(year).size, 365);
});

test('weekday, week start and date formats', () => {
  assert.equal(weekday('2026-11-15'), 0); // Sunday
  assert.equal(weekday('2026-11-16'), 1); // Monday
  assert.equal(mondayOf('2026-11-15'), '2026-11-09');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
  assert.equal(mondayOf('2026-11-18'), '2026-11-16');
  assert.equal(formatDMY('2026-11-05'), '05/11/2026');
  assert.equal(dmyToIso('5/11/2026'), '2026-11-05');
  assert.equal(dmyToIso('31/02/2026'), null);
  assert.equal(friendlyDate('2026-11-15', '2026-11-15'), 'Today');
  assert.equal(friendlyDate('2026-11-14', '2026-11-15'), 'Yesterday');
  assert.equal(friendlyDate('2026-11-16', '2026-11-15'), 'Tomorrow');
  assert.equal(friendlyDate('2026-11-10', '2026-11-15'), 'Tue 10 Nov');
});

test('only real calendar dates are accepted', () => {
  assert.equal(isDateStr('2026-11-15'), true);
  assert.equal(isDateStr('2028-02-29'), true);
  assert.equal(isDateStr('2026-02-29'), false);
  assert.equal(isDateStr('2026-02-30'), false);
  assert.equal(isDateStr('2026-13-01'), false);
  assert.equal(isDateStr('2026-1-1'), false);
  assert.equal(isDateStr('15/11/2026'), false);
  assert.equal(isDateStr(''), false);
  assert.equal(isDateStr(null), false);
  assert.equal(isDateStr(20261115), false);
});

// ---- exercise ---------------------------------------------------------------------------

test('exercise energy = MET x weight x hours', () => {
  close(exerciseKcal(8, 80, 30), 320);
  close(exerciseKcal(3.5, 70, 60), 245);
  assert.equal(exerciseKcal(8, 80, 0), 0);
  assert.equal(exerciseKcal(0, 80, 30), 0);
});

test('about 40 built-in activities, each with a sensible MET', () => {
  assert.ok(ACTIVITIES.length >= 38 && ACTIVITIES.length <= 50, `${ACTIVITIES.length} activities`);
  assert.equal(new Set(ACTIVITIES.map((a) => a.key)).size, ACTIVITIES.length);
  for (const a of ACTIVITIES) {
    assert.ok(a.name.length > 2);
    assert.ok(a.met >= 1.5 && a.met <= 16, `${a.name} MET ${a.met}`);
  }
  assert.equal(findActivity('run_10').met, 9.8);
  assert.equal(findActivity('nope'), null);
});

// ---- trends ---------------------------------------------------------------------------------

test('weight trend smooths the daily numbers', () => {
  const t = weightTrend([
    { date: '2026-11-03', kg: 79 },
    { date: '2026-11-01', kg: 80 },
    { date: '2026-11-02', kg: 81 },
  ]);
  assert.deepEqual(
    t.map((p) => p.date),
    ['2026-11-01', '2026-11-02', '2026-11-03'],
  );
  close(t[0].trend, 80);
  close(t[1].trend, 80.1); // 80 + 0.1 x (81 - 80)
  close(t[2].trend, 80.1 + 0.1 * (79 - 80.1));
  // A gap of several days moves the trend further towards the new weight.
  const gap = weightTrend([
    { date: '2026-11-01', kg: 80 },
    { date: '2026-11-11', kg: 78 },
  ]);
  close(gap[1].trend, 80 + (1 - Math.pow(0.9, 10)) * (78 - 80));
  assert.deepEqual(weightTrend([]), []);
});

test('logging streak counts back from today, and survives until the day ends', () => {
  const logged = ['2026-11-15', '2026-11-14', '2026-11-13', '2026-11-11'];
  assert.deepEqual(computeStreak(logged, '2026-11-15'), { streak: 3, loggedToday: true });
  assert.deepEqual(computeStreak(logged, '2026-11-16'), { streak: 3, loggedToday: false });
  assert.deepEqual(computeStreak(logged, '2026-11-17'), { streak: 0, loggedToday: false });
  assert.deepEqual(computeStreak([], '2026-11-15'), { streak: 0, loggedToday: false });
});

test('weekly averages use Monday weeks and only logged days', () => {
  const weeks = weeklyAverages([
    { date: '2026-11-09', kcal: 2000, protein: 100, carbs: 200, fat: 60, entries: 3 },
    { date: '2026-11-10', kcal: 1800, protein: 120, carbs: 180, fat: 50, entries: 2 },
    { date: '2026-11-11', kcal: 0, protein: 0, carbs: 0, fat: 0, entries: 0 },
    { date: '2026-11-16', kcal: 2200, protein: 110, carbs: 250, fat: 70, entries: 4 },
  ]);
  assert.equal(weeks.length, 2);
  assert.equal(weeks[0].week_start, '2026-11-09');
  assert.equal(weeks[0].days_logged, 2);
  close(weeks[0].kcal, 1900);
  close(weeks[0].protein, 110);
  assert.equal(weeks[1].week_start, '2026-11-16');
  close(weeks[1].kcal, 2200);
});
