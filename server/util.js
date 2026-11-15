// Small helpers: HTTP errors, input validation, ids.
//
// Every value that comes from a request goes through one of the v* functions
// below. They reject wrong types, NaN, negative numbers and out-of-range
// values, and they name the field so the app can show the message next to it.

import crypto from 'node:crypto';
import { isDateStr } from '../shared/dates.js';
import { NUTRIENTS, NUTRIENT_INFO, isKnown, nutritionProblems } from '../shared/nutrition.js';

export class HttpError extends Error {
  constructor(status, code, message, extra = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const invalid = (field, message) => new HttpError(400, 'validation', message, { field });
export const notFound = (message = 'Not found') => new HttpError(404, 'not_found', message);

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function nowIso() {
  return new Date().toISOString();
}

export function vId(v, field = 'id') {
  if (typeof v !== 'string' || !UUID_RE.test(v)) throw invalid(field, `${field} must be a valid id`);
  return v.toLowerCase();
}

export function vDate(v, field = 'date') {
  if (!isDateStr(v)) throw invalid(field, `${field} must be a date in YYYY-MM-DD form`);
  return v;
}

/**
 * A finite number in range. `min` defaults to 0, so negative values are
 * rejected unless a field explicitly allows them.
 */
export function vNum(v, field, { min = 0, max = 1e9, nullable = false, integer = false, exclusiveMin = false } = {}) {
  if (v === null || v === undefined) {
    if (nullable) return null;
    throw invalid(field, `${field} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw invalid(field, `${field} must be a number`);
  if (integer && !Number.isInteger(v)) throw invalid(field, `${field} must be a whole number`);
  if (exclusiveMin ? v <= min : v < min) {
    throw invalid(field, `${field} must be ${exclusiveMin ? 'more than' : 'at least'} ${min}`);
  }
  if (v > max) throw invalid(field, `${field} must be at most ${max}`);
  return v;
}

export function vStr(v, field, { max = 200, min = 0, nullable = false } = {}) {
  if (v === null || v === undefined) {
    if (nullable) return null;
    if (min === 0) return '';
    throw invalid(field, `${field} is required`);
  }
  if (typeof v !== 'string') throw invalid(field, `${field} must be text`);
  // Strip control characters, collapse nothing else.
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  if (s.length < min) throw invalid(field, `${field} is required`);
  if (s.length > max) throw invalid(field, `${field} must be at most ${max} characters`);
  if (nullable && s === '') return null;
  return s;
}

export function vEnum(v, field, allowed) {
  if (!allowed.includes(v)) throw invalid(field, `${field} must be one of: ${allowed.join(', ')}`);
  return v;
}

export function vBool(v, field) {
  if (typeof v !== 'boolean') throw invalid(field, `${field} must be true or false`);
  return v;
}

export function vObj(v, field = 'body') {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(field, `${field} must be an object`);
  return v;
}

export function vArr(v, field, { max = 200, min = 0 } = {}) {
  if (!Array.isArray(v)) throw invalid(field, `${field} must be a list`);
  if (v.length < min) throw invalid(field, `${field} needs at least ${min} item${min === 1 ? '' : 's'}`);
  if (v.length > max) throw invalid(field, `${field} can have at most ${max} items`);
  return v;
}

/** Per-100 nutrition from a request body. Unknown values stay null. */
export function vNutrition(src, field = 'nutrition') {
  vObj(src, field);
  const out = {};
  for (const k of NUTRIENTS) {
    const v = src[k];
    if (v === null || v === undefined) {
      out[k] = null;
      continue;
    }
    if (!isKnown(v)) throw invalid(k, `${NUTRIENT_INFO[k].label} must be a number`);
    out[k] = v;
  }
  const problems = nutritionProblems(out);
  if (problems.length) throw invalid(problems[0].field, problems[0].message);
  return out;
}

/** A list of named serving sizes: [{label, amount}] in base units (g/mL). */
export function vServings(v, field = 'servings') {
  if (v === undefined || v === null) return [];
  vArr(v, field, { max: 12 });
  return v.map((s, i) => {
    vObj(s, `${field}[${i}]`);
    return {
      label: vStr(s.label, 'serving label', { min: 1, max: 60 }),
      amount: vNum(s.amount, 'serving size', { min: 0, exclusiveMin: true, max: 100000 }),
    };
  });
}

/** The unit a food is being logged in: {label, amount}. */
export function vUnit(v, field = 'unit') {
  vObj(v, field);
  return {
    label: vStr(v.label, 'unit', { min: 1, max: 60 }),
    amount: vNum(v.amount, 'unit size', { min: 0, exclusiveMin: true, max: 100000 }),
  };
}

export function vQuantity(v, field = 'quantity') {
  return vNum(v, field, { min: 0, exclusiveMin: true, max: 10000 });
}

/**
 * A stable UUID derived from other values. Used when one request creates
 * several rows (copying a meal, logging a saved meal): repeating the request
 * produces the same ids, so nothing is duplicated.
 */
export function derivedId(...parts) {
  const h = crypto.createHash('sha256').update(parts.join('\u0000')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function searchText(name, brand) {
  return `${name || ''} ${brand || ''}`.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').trim();
}

/** Escape a term for use inside a SQL LIKE pattern (with ESCAPE '\'). */
export function likeEscape(term) {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function parseJson(textValue, fallback) {
  try {
    const v = JSON.parse(textValue);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}
