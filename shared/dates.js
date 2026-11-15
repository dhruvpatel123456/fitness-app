// Calendar-date helpers.
//
// A diary date is a plain local calendar date string, "YYYY-MM-DD". It is never
// derived from a UTC timestamp, so entries cannot shift days around midnight or
// across daylight-saving changes. All arithmetic below is done on the calendar
// (via Date.UTC), which has no daylight-saving time.

const RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86400000;

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function pad2(n) {
  return String(n).padStart(2, '0');
}

/** The local calendar date of a Date object, as YYYY-MM-DD. */
export function localDate(d = new Date()) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Parse "YYYY-MM-DD" into parts, or null if it is not a real calendar date. */
export function parseDate(s) {
  if (typeof s !== 'string') return null;
  const m = RE.exec(s);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1900 || y > 2200 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}

export function isDateStr(s) {
  return parseDate(s) !== null;
}

function toMs(s) {
  const p = parseDate(s);
  if (!p) throw new Error(`Invalid date: ${s}`);
  return Date.UTC(p.y, p.m - 1, p.d);
}

function fromMs(ms) {
  const t = new Date(ms);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

/** Add (or subtract) whole days to a date string. */
export function addDays(s, n) {
  return fromMs(toMs(s) + Math.round(n) * DAY_MS);
}

/** Whole days from a to b (positive when b is later). */
export function diffDays(a, b) {
  return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

/** Day of week, 0 = Sunday … 6 = Saturday. */
export function weekday(s) {
  return new Date(toMs(s)).getUTCDay();
}

/** The Monday on or before the given date. */
export function mondayOf(s) {
  const wd = weekday(s);
  return addDays(s, wd === 0 ? -6 : 1 - wd);
}

/** Every date from `from` to `to`, inclusive. */
export function eachDate(from, to) {
  const out = [];
  const n = diffDays(from, to);
  for (let i = 0; i <= n; i++) out.push(addDays(from, i));
  return out;
}

/** "2026-11-16" -> "16/11/2026" */
export function formatDMY(s) {
  const p = parseDate(s);
  if (!p) return '';
  return `${pad2(p.d)}/${pad2(p.m)}/${p.y}`;
}

/** "2026-11-16" -> "16/11" */
export function formatDM(s) {
  const p = parseDate(s);
  if (!p) return '';
  return `${pad2(p.d)}/${pad2(p.m)}`;
}

/** "16/11/2026" (or 16-11-2026, 16.11.2026) -> "2026-11-16", or null. */
export function dmyToIso(s) {
  if (typeof s !== 'string') return null;
  const m = /^\s*(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})\s*$/.exec(s);
  if (!m) return null;
  const iso = `${m[3]}-${pad2(Number(m[2]))}-${pad2(Number(m[1]))}`;
  return isDateStr(iso) ? iso : null;
}

/** "Mon 16 Nov" style label. */
export function formatShort(s) {
  const p = parseDate(s);
  if (!p) return '';
  return `${WEEKDAY_SHORT[weekday(s)]} ${p.d} ${MONTH_SHORT[p.m - 1]}`;
}

/** "Today", "Yesterday", "Tomorrow", or "Mon 16 Nov". */
export function friendlyDate(s, today) {
  const d = diffDays(today, s);
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  return formatShort(s);
}

/** Full years between two dates (used for age). */
export function fullYearsBetween(from, to) {
  const a = parseDate(from);
  const b = parseDate(to);
  if (!a || !b) return 0;
  let years = b.y - a.y;
  if (b.m < a.m || (b.m === a.m && b.d < a.d)) years -= 1;
  return Math.max(0, years);
}
