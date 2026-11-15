// Progress maths: weight trend, logging streak, weekly averages.

import { addDays, diffDays, mondayOf } from './dates.js';

/**
 * Smoothed weight trend (an exponential moving average that allows for gaps
 * between weigh-ins). Day-to-day weight is noisy; the trend shows direction.
 *
 * points: [{ date, kg }] in any order. Returns them sorted, with `trend`.
 */
export function weightTrend(points, dailySmoothing = 0.1) {
  const sorted = [...points].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const out = [];
  let trend = null;
  let prevDate = null;
  for (const p of sorted) {
    if (trend === null) {
      trend = p.kg;
    } else {
      const gap = Math.max(1, diffDays(prevDate, p.date));
      const weight = 1 - Math.pow(1 - dailySmoothing, gap);
      trend = trend + weight * (p.kg - trend);
    }
    prevDate = p.date;
    out.push({ date: p.date, kg: p.kg, trend });
  }
  return out;
}

/**
 * Logging streak: consecutive days with at least one diary entry, counted
 * back from today. If nothing is logged yet today, the streak up to
 * yesterday still counts (it is not broken until the day ends).
 */
export function computeStreak(loggedDates, today) {
  const set = loggedDates instanceof Set ? loggedDates : new Set(loggedDates);
  const loggedToday = set.has(today);
  let cursor = loggedToday ? today : addDays(today, -1);
  let streak = 0;
  while (set.has(cursor)) {
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return { streak, loggedToday };
}

/**
 * Weekly averages (weeks start on Monday). Only days with something logged
 * count towards the average, so an unlogged day does not drag it down.
 *
 * days: [{ date, kcal, protein, carbs, fat, entries }]
 */
export function weeklyAverages(days) {
  const weeks = new Map();
  for (const d of days) {
    const key = mondayOf(d.date);
    if (!weeks.has(key)) weeks.set(key, { week_start: key, days_logged: 0, kcal: 0, protein: 0, carbs: 0, fat: 0 });
    if (!(d.entries > 0)) continue;
    const w = weeks.get(key);
    w.days_logged += 1;
    w.kcal += d.kcal || 0;
    w.protein += d.protein || 0;
    w.carbs += d.carbs || 0;
    w.fat += d.fat || 0;
  }
  return [...weeks.values()]
    .sort((a, b) => (a.week_start < b.week_start ? -1 : 1))
    .map((w) => {
      const n = w.days_logged || 1;
      return {
        week_start: w.week_start,
        days_logged: w.days_logged,
        kcal: w.days_logged ? w.kcal / n : 0,
        protein: w.days_logged ? w.protein / n : 0,
        carbs: w.days_logged ? w.carbs / n : 0,
        fat: w.days_logged ? w.fat / n : 0,
      };
    });
}
