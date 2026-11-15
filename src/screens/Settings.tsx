// Settings: profile, goals, units, meal names, water, theme, PIN, and data
// (export, import, backups, erase).

import {
  ChevronRight,
  Database,
  Download,
  KeyRound,
  LogOut,
  Ruler,
  Smartphone,
  Target,
  Upload,
  User,
  Utensils,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { WEEKDAY_NAMES, formatDMY } from '../../shared/dates.js';
import { ACTIVITY_LEVELS, WEEKLY_GOALS, calorieTarget, effectiveAge, minimumKcal } from '../../shared/goals.js';
import { LowTargetWarning } from '../components/LowTargetWarning';
import { TargetFields, draftFromTargets, draftWithEnergy, readDraft, type TargetDraft } from '../components/TargetFields';
import {
  Button,
  Card,
  Field,
  Loadable,
  Notice,
  NumInput,
  Page,
  Row,
  SectionTitle,
  Segmented,
  SelectInput,
  Sheet,
  TextInput,
  Toggle,
} from '../components/ui';
import { ApiError, errorMessage, post } from '../lib/api';
import { applyTheme, isSecure, useApp } from '../lib/app';
import { fmt, fmtBytes, numText, parseNum } from '../lib/format';
import { isInstalled, phoneKind, promptInstall, useCanInstall } from '../lib/install';
import { useNav } from '../lib/nav';
import { putBoot, queryClient, refresh, useBackups } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import type { Profile, Sex, TargetSet, Targets, ThemeChoice } from '../types';

function useSetting() {
  return async (patch: Record<string, unknown>) => {
    try {
      await putBoot('/settings', patch);
    } catch (err) {
      toastError(errorMessage(err));
    }
  };
}

const chevron = <ChevronRight size={20} className="shrink-0 text-muted" aria-hidden />;

export function SettingsScreen() {
  const nav = useNav();
  const { boot, energy, unit } = useApp();
  const save = useSetting();
  const s = boot.settings;
  const t = boot.targets?.targets;
  const p = boot.profile;

  const logout = async () => {
    try {
      await post('/auth/logout');
    } catch {
      // Even if the laptop cannot be reached, forget the session on this device.
    }
    queryClient.setQueryData(['auth'], { setup: true, authed: false });
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== 'auth' });
  };

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe px-safe shrink-0 border-b border-line bg-surface">
        <div className="mx-auto max-w-xl px-4 py-3">
          <h1 className="text-[22px] font-bold">Settings</h1>
        </div>
      </header>
      <div className="scroll-area px-safe min-h-0 flex-1">
        <div className="mx-auto w-full max-w-xl px-4 pb-10">
          <SectionTitle>You</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            <Row
              icon={<User size={20} />}
              title="Profile"
              detail={p ? `${p.sex === 'female' ? 'Female' : 'Male'} · ${p.height_cm} cm · goal ${fmt(p.goal_weight_kg, 1)} kg` : 'Not set'}
              right={chevron}
              onClick={() => nav.push(<ProfilePage />)}
            />
            <Row
              icon={<Target size={20} />}
              title="Goals and targets"
              detail={t ? `${energy(t.kcal)} ${unit} · P ${fmt(t.protein_g)} g · C ${fmt(t.carbs_g)} g · F ${fmt(t.fat_g)} g` : 'Not set'}
              right={chevron}
              onClick={() => nav.push(<GoalsPage />)}
            />
          </Card>

          <SectionTitle>Diary</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            <Row icon={<Utensils size={20} />} title="Meal names" detail={s.meal_names.join(', ')} right={chevron} onClick={() => nav.push(<MealNamesPage />)} />
            <Row
              icon={<Ruler size={20} />}
              title="Water"
              detail={`Glass ${fmt(s.water_glass_ml)} mL · goal ${fmt(s.water_goal_ml)} mL a day`}
              right={chevron}
              onClick={() => nav.push(<WaterPage />)}
            />
            <div className="px-4">
              <Toggle
                checked={s.exercise_adds_back}
                onChange={(value) => void save({ exercise_adds_back: value })}
                label="Add exercise to my daily budget"
                detail="When on, energy burned in exercise increases what you can eat that day."
              />
            </div>
          </Card>

          <SectionTitle>Display</SectionTitle>
          <Card className="space-y-4 p-4">
            <Field label="Energy unit">
              <Segmented
                label="Energy unit"
                value={s.energy_unit}
                onChange={(value) => void save({ energy_unit: value })}
                options={[
                  { value: 'kcal', label: 'Calories (kcal)' },
                  { value: 'kJ', label: 'Kilojoules (kJ)' },
                ]}
              />
            </Field>
            <Field label="Theme">
              <Segmented
                label="Theme"
                value={s.theme}
                onChange={(value) => {
                  applyTheme(value as ThemeChoice);
                  void save({ theme: value });
                }}
                options={[
                  { value: 'system', label: 'Match phone' },
                  { value: 'light', label: 'Light' },
                  { value: 'dark', label: 'Dark' },
                ]}
              />
            </Field>
            <p className="text-[13px] text-muted">Weights are in kg, heights in cm, food in g and mL, and dates as day/month/year.</p>
          </Card>

          <SectionTitle>App and data</SectionTitle>
          <Card className="divide-y divide-line overflow-hidden">
            <Row
              icon={<Smartphone size={20} />}
              title="Install on this phone"
              detail={isInstalled() ? 'Installed' : 'Add the app to your home screen'}
              right={chevron}
              onClick={() => nav.push(<InstallPage />)}
            />
            <Row icon={<Database size={20} />} title="Data and backups" detail="Export, import, back up, erase" right={chevron} onClick={() => nav.push(<DataPage />)} />
            <Row icon={<KeyRound size={20} />} title="Change PIN" right={chevron} onClick={() => nav.push(<PinPage />)} />
            <Row icon={<LogOut size={20} />} title="Log out of this device" onClick={() => void logout()} />
          </Card>

          <p className="mt-6 text-center text-[13px] text-muted">
            {boot.app.name} {boot.app.version}. Your data is stored on your laptop and nowhere else.
          </p>
        </div>
      </div>
    </div>
  );
}

// ---- profile -------------------------------------------------------------------------

function ProfilePage() {
  const nav = useNav();
  const { boot, today } = useApp();
  const p = boot.profile;
  const [sex, setSex] = useState<Sex>(p?.sex ?? 'male');
  const [age, setAge] = useState(p ? String(effectiveAge(p, today)) : '');
  const [height, setHeight] = useState(p ? numText(p.height_cm, 1) : '');
  const [goalWeight, setGoalWeight] = useState(p ? numText(p.goal_weight_kg, 1) : '');
  const [weekly, setWeekly] = useState(p?.weekly_goal_kg ?? 0);
  const [activity, setActivity] = useState(p?.activity ?? 'sedentary');
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const ageN = parseNum(age);
  const heightN = parseNum(height);
  const goalN = parseNum(goalWeight);
  const ageOk = ageN !== null && Number.isInteger(ageN) && ageN >= 13 && ageN <= 120;
  const heightOk = heightN !== null && heightN >= 100 && heightN <= 250;
  const goalOk = goalN !== null && goalN >= 25 && goalN <= 400;

  const save = async () => {
    setShowErrors(true);
    if (!ageOk || !heightOk || !goalOk) return;
    setBusy(true);
    try {
      const profile: Omit<Profile, 'age_as_of'> = { sex, age: ageN as number, height_cm: heightN as number, goal_weight_kg: goalN as number, activity, weekly_goal_kg: weekly };
      await putBoot('/profile', { today, profile });
      nav.pop();
      toast('Profile saved. Review your targets?', { action: { label: 'Review', run: () => nav.push(<GoalsPage />) }, duration: 7000 });
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Profile"
      footer={
        <Button block busy={busy} onClick={() => void save()}>
          Save profile
        </Button>
      }
    >
      <Card className="space-y-4 p-4">
        <Field label="Sex (used in the energy formula)">
          <Segmented
            label="Sex"
            value={sex}
            onChange={setSex}
            options={[
              { value: 'male', label: 'Male' },
              { value: 'female', label: 'Female' },
            ]}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Age" error={showErrors && !ageOk ? '13 to 120' : null}>
            <NumInput aria-label="Age" value={age} onChange={setAge} decimal={false} suffix="years" />
          </Field>
          <Field label="Height" error={showErrors && !heightOk ? '100 to 250 cm' : null}>
            <NumInput aria-label="Height" value={height} onChange={setHeight} suffix="cm" />
          </Field>
        </div>
        <Field label="Goal weight" error={showErrors && !goalOk ? '25 to 400 kg' : null} hint="Your current weight comes from the weight log on the Progress tab.">
          <NumInput aria-label="Goal weight" value={goalWeight} onChange={setGoalWeight} suffix="kg" />
        </Field>
        <Field label="Weekly goal">
          <SelectInput aria-label="Weekly goal" value={String(weekly)} onChange={(e) => setWeekly(Number(e.target.value))}>
            {WEEKLY_GOALS.map((g: { kg: number; label: string }) => (
              <option key={g.kg} value={String(g.kg)}>
                {g.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="How active is a normal day?">
          <SelectInput aria-label="Activity level" value={activity} onChange={(e) => setActivity(e.target.value)}>
            {ACTIVITY_LEVELS.map((a: { key: string; label: string; detail: string }) => (
              <option key={a.key} value={a.key}>
                {a.label}: {a.detail.toLowerCase()}
              </option>
            ))}
          </SelectInput>
        </Field>
      </Card>
    </Page>
  );
}

// ---- goals and targets -------------------------------------------------------------------

const WEEK_ORDER = ['1', '2', '3', '4', '5', '6', '0'];

function GoalsPage() {
  const nav = useNav();
  const { boot, today, unit, energy } = useApp();
  const current = boot.targets?.targets ?? null;
  const mode = boot.settings.macro_mode;
  const base: TargetSet = current ?? { kcal: 2000, protein_g: 150, carbs_g: 200, fat_g: 66.7 };
  const [draft, setDraft] = useState<TargetDraft>(() => draftFromTargets(base, mode, unit));
  const [days, setDays] = useState<Record<string, TargetDraft>>(() => {
    const out: Record<string, TargetDraft> = {};
    for (const [key, value] of Object.entries(current?.weekdays ?? {})) out[key] = draftFromTargets(value, mode, unit);
    return out;
  });
  const [confirmLow, setConfirmLow] = useState(false);
  const [busy, setBusy] = useState(false);

  const p = boot.profile;
  const weight = boot.latest_weight?.kg ?? null;
  const calc =
    p && weight
      ? calorieTarget({ sex: p.sex, weightKg: weight, heightCm: p.height_cm, age: effectiveAge(p, today), activity: p.activity, weeklyGoalKg: p.weekly_goal_kg })
      : null;
  const minimum = minimumKcal(p?.sex ?? 'female');

  const main = readDraft(draft, unit);
  const dayReads = Object.fromEntries(Object.entries(days).map(([key, d]) => [key, readDraft(d, unit)]));
  const dayError = Object.entries(dayReads).find(([, r]) => r.error);
  const allKcal = [main.targets?.kcal, ...Object.values(dayReads).map((r) => r.targets?.kcal)].filter((v): v is number => typeof v === 'number');
  const lowest = allKcal.length ? Math.min(...allKcal) : null;
  const isLow = lowest !== null && lowest < minimum;
  const valid = main.targets !== null && !dayError;

  const change = (d: TargetDraft) => {
    setDraft(d);
    setConfirmLow(false);
  };

  const save = async () => {
    if (!valid || !main.targets) {
      toastError(main.error ?? `${WEEKDAY_NAMES[Number(dayError?.[0])]}: ${dayError?.[1].error}`);
      return;
    }
    if (isLow && !confirmLow) {
      toastError('Tick the box to confirm the low target first.');
      return;
    }
    const weekdays: Record<string, TargetSet> = {};
    for (const [key, r] of Object.entries(dayReads)) if (r.targets) weekdays[key] = r.targets;
    const targets: Targets = Object.keys(weekdays).length ? { ...main.targets, weekdays } : main.targets;
    setBusy(true);
    try {
      await putBoot('/targets', { effective_from: today, targets, confirm_low: isLow ? true : undefined });
      if (draft.mode !== mode) await putBoot('/settings', { macro_mode: draft.mode });
      nav.pop();
      toast('Targets saved. They apply from today.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'low_target') setConfirmLow(false);
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title="Goals and targets"
      footer={
        <Button block busy={busy} disabled={!valid} onClick={() => void save()}>
          Save targets
        </Button>
      }
    >
      <div className="space-y-4">
        {calc && (
          <Card className="p-4">
            <h2 className="font-semibold">Worked out from your profile</h2>
            <dl className="mt-2 space-y-1.5 text-[15px]">
              <div className="flex justify-between">
                <dt className="text-muted">At rest (BMR, Mifflin-St Jeor)</dt>
                <dd className="tabular font-semibold">
                  {energy(calc.bmr)} {unit}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">With your activity level</dt>
                <dd className="tabular font-semibold">
                  {energy(calc.tdee)} {unit}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">For your weekly goal, at {fmt(weight ?? 0, 1)} kg</dt>
                <dd className="tabular font-bold text-primary">
                  {energy(calc.suggested)} {unit}
                </dd>
              </div>
            </dl>
            <Button variant="soft" size="sm" className="mt-3" onClick={() => change(draftWithEnergy(draft, Math.max(500, calc.suggested), unit))}>
              Use {energy(calc.suggested)} {unit}
            </Button>
          </Card>
        )}

        <Card className="p-4">
          <h2 className="mb-3 font-semibold">Daily targets</h2>
          <TargetFields draft={draft} onChange={change} unit={unit} />
          {main.error && <p className="mt-3 text-[14px] font-medium text-danger">{main.error}</p>}
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold">Different targets on some days</h2>
          <p className="text-[13px] text-muted">Optional. For example, a higher target on training days or weekends.</p>
          <div className="mt-2 divide-y divide-line">
            {WEEK_ORDER.map((key) => {
              const on = key in days;
              return (
                <div key={key} className="py-1">
                  <Toggle
                    checked={on}
                    label={WEEKDAY_NAMES[Number(key)]}
                    detail={on ? undefined : 'Uses the daily targets above'}
                    onChange={(value) => {
                      setConfirmLow(false);
                      setDays((prev) => {
                        const next = { ...prev };
                        if (value) next[key] = { ...draft, pct: { ...draft.pct }, grams: { ...draft.grams } };
                        else delete next[key];
                        return next;
                      });
                    }}
                  />
                  {on && (
                    <div className="pb-3">
                      <TargetFields
                        draft={days[key]}
                        unit={unit}
                        energyLabel={`${WEEKDAY_NAMES[Number(key)]} energy target`}
                        onChange={(d) => {
                          setConfirmLow(false);
                          setDays((prev) => ({ ...prev, [key]: d }));
                        }}
                      />
                      {dayReads[key]?.error && <p className="mt-2 text-[14px] font-medium text-danger">{dayReads[key].error}</p>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {isLow && lowest !== null && (
          <LowTargetWarning
            kcal={lowest}
            minimum={minimum}
            sex={p?.sex ?? 'female'}
            confirmed={confirmLow}
            onConfirm={setConfirmLow}
            onUseMinimum={main.targets && main.targets.kcal < minimum ? () => change(draftWithEnergy(draft, minimum, unit)) : undefined}
          />
        )}

        <p className="px-1 text-[13px] text-muted">
          New targets apply from today ({formatDMY(today)}). Earlier days in your diary keep the targets they had.
        </p>
      </div>
    </Page>
  );
}

// ---- meal names, water --------------------------------------------------------------------

function MealNamesPage() {
  const nav = useNav();
  const { boot } = useApp();
  const [names, setNames] = useState(boot.settings.meal_names);
  const [busy, setBusy] = useState(false);
  const valid = names.every((n) => n.trim() !== '');
  const save = async () => {
    setBusy(true);
    try {
      await putBoot('/settings', { meal_names: names.map((n) => n.trim()) });
      nav.pop();
      toast('Meal names saved');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title="Meal names"
      footer={
        <Button block busy={busy} disabled={!valid} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <Card className="space-y-4 p-4">
        {names.map((name, i) => (
          <Field key={i} label={`Meal ${i + 1}`} error={name.trim() === '' ? 'A name is needed.' : null}>
            <TextInput aria-label={`Meal ${i + 1} name`} value={name} maxLength={24} onChange={(e) => setNames(names.map((n, j) => (j === i ? e.target.value : n)))} />
          </Field>
        ))}
        <p className="text-[13px] text-muted">Renaming a meal keeps everything already logged in it.</p>
      </Card>
    </Page>
  );
}

function WaterPage() {
  const nav = useNav();
  const { boot } = useApp();
  const [glass, setGlass] = useState(numText(boot.settings.water_glass_ml, 0));
  const [goal, setGoal] = useState(numText(boot.settings.water_goal_ml, 0));
  const [busy, setBusy] = useState(false);
  const g = parseNum(glass);
  const t = parseNum(goal);
  const glassOk = g !== null && g >= 50 && g <= 2000;
  const goalOk = t !== null && t >= 250 && t <= 10000;
  const save = async () => {
    setBusy(true);
    try {
      await putBoot('/settings', { water_glass_ml: g, water_goal_ml: t });
      nav.pop();
      toast('Water settings saved');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Page
      title="Water"
      footer={
        <Button block busy={busy} disabled={!glassOk || !goalOk} onClick={() => void save()}>
          Save
        </Button>
      }
    >
      <Card className="space-y-4 p-4">
        <Field label="Glass size" error={!glassOk ? '50 to 2,000 mL' : null} hint="How much each tap of “Add a glass” adds.">
          <NumInput aria-label="Glass size" value={glass} onChange={setGlass} decimal={false} suffix="mL" />
        </Field>
        <Field label="Daily goal" error={!goalOk ? '250 to 10,000 mL' : null}>
          <NumInput aria-label="Daily water goal" value={goal} onChange={setGoal} decimal={false} suffix="mL" />
        </Field>
      </Card>
    </Page>
  );
}

// ---- PIN -----------------------------------------------------------------------------------

function PinPage() {
  const nav = useNav();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (next.length < 4) return setError('Use at least 4 characters for the new PIN.');
    if (next !== again) return setError('The two new entries do not match.');
    setBusy(true);
    setError(null);
    try {
      await post('/auth/change-pin', { current, next });
      nav.pop();
      toast('PIN changed. Other devices have been signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const input = (label: string, value: string, set: (v: string) => void, autoComplete: string) => (
    <Field label={label}>
      <TextInput type="password" aria-label={label} autoComplete={autoComplete} maxLength={72} value={value} onChange={(e) => set(e.target.value)} />
    </Field>
  );

  return (
    <Page
      title="Change PIN"
      footer={
        <Button block busy={busy} disabled={!current || !next || !again} onClick={() => void save()}>
          Change PIN
        </Button>
      }
    >
      <Card className="space-y-4 p-4">
        {input('Current PIN', current, setCurrent, 'current-password')}
        {input('New PIN or password', next, setNext, 'new-password')}
        {input('New PIN again', again, setAgain, 'new-password')}
        {error && (
          <p className="text-[14px] font-medium text-danger" role="alert">
            {error}
          </p>
        )}
      </Card>
    </Page>
  );
}

// ---- install ---------------------------------------------------------------------------------

function InstallPage() {
  const canInstall = useCanInstall();
  const kind = phoneKind();
  const step = (n: number, text: ReactNode) => (
    <li className="flex gap-3">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[14px] font-bold text-primary">{n}</span>
      <span className="pt-0.5">{text}</span>
    </li>
  );
  return (
    <Page title="Install on this phone">
      <div className="space-y-4">
        {isInstalled() && <Notice>The app is already installed on this device. You are using it from your home screen.</Notice>}
        {!isSecure() && (
          <Notice tone="warn">
            This page was opened over plain http ({window.location.host}). Installing to the home screen and the barcode camera both need
            the secure https address. See “Connecting your phone” in the README on your laptop.
          </Notice>
        )}
        {canInstall && (
          <Card className="p-4">
            <p className="mb-3 text-[15px]">Your browser can install the app directly.</p>
            <Button block onClick={() => void promptInstall()}>
              Install app
            </Button>
          </Card>
        )}
        {(kind === 'ios' || kind === 'other') && (
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">iPhone or iPad</h2>
            <ol className="space-y-3 text-[15px]">
              {step(1, <>Open this page in <b>Safari</b>.</>)}
              {step(2, <>Tap the <b>Share</b> button (the square with an arrow pointing up).</>)}
              {step(3, <>Scroll down and tap <b>Add to Home Screen</b>, then <b>Add</b>.</>)}
              {step(4, <>Open Tucker from the new icon. It runs full-screen like any other app.</>)}
            </ol>
          </Card>
        )}
        {(kind === 'android' || kind === 'other') && (
          <Card className="p-4">
            <h2 className="mb-3 font-semibold">Android</h2>
            <ol className="space-y-3 text-[15px]">
              {step(1, <>Open this page in <b>Chrome</b>.</>)}
              {step(2, <>Tap the <b>three dots</b> menu at the top right.</>)}
              {step(3, <>Tap <b>Add to Home screen</b> (or <b>Install app</b>), then <b>Install</b>.</>)}
              {step(4, <>Open Tucker from the new icon.</>)}
            </ol>
          </Card>
        )}
        <p className="px-1 text-[13px] text-muted">
          You are connected to <span className="break-all font-medium">{window.location.origin}</span>
          {isSecure() ? ' (secure).' : ' (not secure).'}
        </p>
      </div>
    </Page>
  );
}

// ---- data -------------------------------------------------------------------------------------

const LINK_BUTTON = 'flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-surface-2 px-5 font-semibold text-ink active:opacity-80';

function DataPage() {
  const nav = useNav();
  const backups = useBackups();
  const fileInput = useRef<HTMLInputElement>(null);
  const [backingUp, setBackingUp] = useState(false);

  const backUp = async () => {
    setBackingUp(true);
    try {
      await post('/backups');
      refresh('backups');
      toast('Backup saved on your laptop');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBackingUp(false);
    }
  };

  const chooseFile = async (file: File) => {
    try {
      const data = JSON.parse(await file.text());
      nav.push(<ImportSheet data={data} fileName={file.name} />);
    } catch {
      toastError('That file could not be read. Choose a file exported from this app.');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <Page title="Data and backups">
      <div className="space-y-4">
        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Export</h2>
          <p className="text-[13px] text-muted">The JSON file holds everything (except your PIN) and can be imported again. The CSV file is your diary for a spreadsheet.</p>
          <a className={LINK_BUTTON} href="/api/export/json" download>
            <Download size={18} aria-hidden /> Export all data (JSON)
          </a>
          <a className={LINK_BUTTON} href="/api/export/diary.csv" download>
            <Download size={18} aria-hidden /> Export diary (CSV)
          </a>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold">Import</h2>
          <p className="text-[13px] text-muted">Restores a JSON export. It replaces everything currently in the app.</p>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void chooseFile(file);
            }}
          />
          <Button variant="secondary" block onClick={() => fileInput.current?.click()}>
            <Upload size={18} aria-hidden /> Import from a JSON export
          </Button>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold">Backups on your laptop</h2>
          <p className="mt-1 text-[13px] text-muted">
            A backup of the database is made automatically once a day
            {backups.data ? `, and the newest ${backups.data.keep} of each kind are kept` : ''}.
          </p>
          <Button block className="mt-3" busy={backingUp} onClick={() => void backUp()}>
            Back up now
          </Button>
          <Loadable loading={backups.isPending} error={backups.isError ? backups.error : null} onRetry={() => backups.refetch()}>
            {backups.data && (
              <>
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                  {backups.data.backups.length === 0 && <li className="px-3 py-3 text-[14px] text-muted">No backups yet.</li>}
                  {backups.data.backups.map((b) => (
                    <li key={b.name} className="flex min-h-12 items-center gap-2 px-3 py-1.5">
                      <span className="min-w-0 flex-1">
                        <span className="block text-[14px] font-medium">
                          {b.kind === 'daily' ? 'Daily' : 'Manual'} · {new Date(b.created_at).toLocaleString('en-AU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="block truncate text-[12px] text-muted">
                          {b.name} · {fmtBytes(b.size)}
                        </span>
                      </span>
                      <a href={`/api/backups/${encodeURIComponent(b.name)}`} download className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-primary active:bg-surface-2" aria-label={`Download ${b.name}`}>
                        <Download size={20} />
                      </a>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 break-all text-[12px] text-muted">Folder: {backups.data.folder}</p>
              </>
            )}
          </Loadable>
        </Card>

        <Card className="space-y-3 p-4">
          <h2 className="font-semibold text-danger">Erase everything</h2>
          <p className="text-[13px] text-muted">Deletes your diary, foods, weights and settings from the laptop. Your PIN stays. Export first if you might want it back.</p>
          <Button variant="danger" block onClick={() => nav.push(<EraseSheet />)}>
            Erase all data…
          </Button>
        </Card>
      </div>
    </Page>
  );
}

function ImportSheet({ data, fileName }: { data: unknown; fileName: string }) {
  const nav = useNav();
  const [busy, setBusy] = useState(false);
  const tables = (data as { tables?: Record<string, unknown[]> } | null)?.tables;
  const count = (name: string) => (Array.isArray(tables?.[name]) ? (tables?.[name] as unknown[]).length : 0);
  const run = async () => {
    setBusy(true);
    try {
      await post('/import', { data, confirm: true });
      await queryClient.invalidateQueries();
      nav.reset();
      toast('Import finished. Your data has been restored.');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Import this file?"
      footer={
        <Button variant="danger" block busy={busy} onClick={() => void run()}>
          Replace my data with this file
        </Button>
      }
    >
      <div className="space-y-3 text-[15px]">
        <p className="break-all font-medium">{fileName}</p>
        <p className="text-muted">
          Contains {fmt(count('diary_entries'))} diary entries, {fmt(count('foods'))} foods, {fmt(count('weights'))} weigh-ins and{' '}
          {fmt(count('exercise_entries'))} exercise entries.
        </p>
        <Notice tone="warn">Everything currently in the app is replaced by this file. If the file is not valid, nothing is changed.</Notice>
      </div>
    </Sheet>
  );
}

function EraseSheet() {
  const nav = useNav();
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      await post('/wipe', { pin });
      nav.reset();
      await queryClient.invalidateQueries();
      toast('All data erased.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title="Erase all data?"
      footer={
        <Button variant="danger" block busy={busy} disabled={!pin} onClick={() => void run()}>
          Erase everything
        </Button>
      }
    >
      <div className="space-y-3">
        <p className="text-[15px] text-muted">This cannot be undone from inside the app. The daily backups on your laptop are not touched.</p>
        <Field label="Enter your PIN to confirm" error={error}>
          <TextInput type="password" aria-label="PIN" autoComplete="current-password" value={pin} maxLength={72} onChange={(e) => setPin(e.target.value)} />
        </Field>
      </div>
    </Sheet>
  );
}
