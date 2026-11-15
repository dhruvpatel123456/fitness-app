// App-wide state: settings from the laptop, today's date, and the day the
// diary is showing.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { localDate } from '../../shared/dates.js';
import type { Bootstrap, EnergyUnit, ThemeChoice } from '../types';
import { energyValue, fmtEnergy, toKcal } from './format';

type AppState = {
  boot: Bootstrap;
  /** Today's local calendar date, kept current across midnight. */
  today: string;
  /** The day the diary is showing. */
  date: string;
  setDate: (date: string) => void;
  unit: EnergyUnit;
  /** Energy formatted in the chosen unit, e.g. "1,850". */
  energy: (kcal: number | null | undefined) => string;
  energyValue: (kcal: number) => number;
  toKcal: (value: number) => number;
  mealName: (meal: number) => string;
};

const AppContext = createContext<AppState | null>(null);

export function useApp(): AppState {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
}

/**
 * Today's date, re-checked regularly and whenever the app comes back to the
 * front, so an app left open over midnight moves on to the new day.
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDate());
  useEffect(() => {
    const check = () => setToday((prev) => (prev === localDate() ? prev : localDate()));
    const timer = window.setInterval(check, 15000);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    window.addEventListener('pageshow', check);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
      window.removeEventListener('pageshow', check);
    };
  }, []);
  return today;
}

export function AppProvider({ boot, children }: { boot: Bootstrap; children: ReactNode }) {
  const today = useToday();
  // While the diary is "on today", it follows the calendar. Once the user
  // picks another day, it stays there until they come back to today.
  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;

  const setDate = useCallback((next: string) => setPicked(next === localDate() ? null : next), []);

  // If the picked day has become today (for example "tomorrow" after midnight), follow the calendar again.
  useEffect(() => {
    if (picked !== null && picked === today) setPicked(null);
  }, [picked, today]);

  const unit = boot.settings.energy_unit;
  const value = useMemo<AppState>(
    () => ({
      boot,
      today,
      date,
      setDate,
      unit,
      energy: (kcal) => fmtEnergy(kcal, unit),
      energyValue: (kcal) => energyValue(kcal, unit),
      toKcal: (v) => toKcal(v, unit),
      mealName: (meal) => boot.settings.meal_names[meal] ?? `Meal ${meal + 1}`,
    }),
    [boot, today, date, setDate, unit],
  );
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/** Apply a theme choice now and remember it for the next launch. */
export function applyTheme(choice: ThemeChoice) {
  try {
    localStorage.setItem('tt-theme', choice);
  } catch {
    // Private windows may refuse storage; the theme still applies for this visit.
  }
  const dark = choice === 'dark' || (choice === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
}

/** Keep the theme in step with the phone's light/dark setting when on "system". */
export function useThemeSync(choice: ThemeChoice) {
  useEffect(() => {
    applyTheme(choice);
    if (choice !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [choice]);
}

/** True when the page can use the camera and be installed (HTTPS or localhost). */
export function isSecure(): boolean {
  return window.isSecureContext === true;
}

export function meal_for_now(): number {
  const hour = new Date().getHours();
  if (hour < 11) return 0;
  if (hour < 15) return 1;
  if (hour < 21) return 2;
  return 3;
}
