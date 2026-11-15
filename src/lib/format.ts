// Formatting for display. Rounding happens here and nowhere else.

import { KJ_PER_KCAL } from '../../shared/nutrition.js';
import type { EnergyUnit } from '../types';

const formatters = new Map<number, Intl.NumberFormat>();

function formatter(digits: number) {
  let f = formatters.get(digits);
  if (!f) {
    f = new Intl.NumberFormat('en-AU', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    formatters.set(digits, f);
  }
  return f;
}

/** "1,234" / "12.5": a number with at most `digits` decimals. */
export function fmt(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  // Avoid showing "-0".
  const rounded = Math.abs(value) < 0.5 * Math.pow(10, -digits) ? 0 : value;
  return formatter(digits).format(rounded);
}

/** Grams: one decimal below 10 g, whole numbers above. */
export function fmtG(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';
  return fmt(value, Math.abs(value) < 10 ? 1 : 0);
}

/** Energy in the chosen unit (the app stores kcal). */
export function energyValue(kcal: number, unit: EnergyUnit): number {
  return unit === 'kJ' ? kcal * KJ_PER_KCAL : kcal;
}

export function fmtEnergy(kcal: number | null | undefined, unit: EnergyUnit): string {
  if (kcal === null || kcal === undefined || !Number.isFinite(kcal)) return '–';
  return fmt(energyValue(kcal, unit), 0);
}

/** What the user typed in their energy unit, as kcal. */
export function toKcal(value: number, unit: EnergyUnit): number {
  return unit === 'kJ' ? value / KJ_PER_KCAL : value;
}

/** Read a typed number. Accepts a comma as the decimal mark. Empty or invalid gives null. */
export function parseNum(text: string): number | null {
  const cleaned = text.trim().replace(',', '.');
  if (cleaned === '' || !/^\d*\.?\d*$/.test(cleaned) || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** A number as text for an input field (no thousands separators, trimmed decimals). */
export function numText(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  const k = Math.pow(10, digits);
  return String(Math.round(value * k) / k);
}

export function fmtBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024, 0)} kB`;
  return `${fmt(bytes / 1024 / 1024, 1)} MB`;
}

export function mlText(ml: number): string {
  return ml >= 1000 ? `${fmt(ml / 1000, 2)} L` : `${fmt(ml, 0)} mL`;
}
