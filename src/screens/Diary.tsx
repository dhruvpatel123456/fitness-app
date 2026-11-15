// The diary: one day at a time. Summary at the top, then meals, exercise,
// water and notes.

import { ChevronLeft, ChevronRight, Copy, Droplet, Dumbbell, Ellipsis, Flame, Minus, Plus, Save, Zap, CalendarDays } from 'lucide-react';
import { useEffect, useRef, useState, type TouchEvent } from 'react';
import { addDays, formatDMY, friendlyDate } from '../../shared/dates.js';
import { describeServing, entryNutrition, sumNutrition } from '../../shared/nutrition.js';
import { SwipeRow } from '../components/SwipeRow';
import { ActionSheet, Bar, Button, Card, DateField, IconButton, Loadable, TextArea, cx } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { fmt, fmtG, mlText } from '../lib/format';
import { useKeyedSaver } from '../lib/hooks';
import { useNav } from '../lib/nav';
import {
  copyDiary,
  deleteEntry,
  deleteExercise,
  queryClient,
  restoreEntry,
  saveExercise,
  setNote,
  setWater,
  useDiary,
  useStreak,
} from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { DayData, Entry, Exercise } from '../types';
import { AddFood } from './AddFood';
import { CopySheet, EntrySheet, QuickAddSheet, SaveMealSheet, WaterSheet } from './DiarySheets';
import { ExerciseSheet } from './ExerciseSheet';

export function DiaryScreen() {
  const { date, setDate, today, boot, energy, unit, mealName } = useApp();
  const nav = useNav();
  const diary = useDiary(date);
  const streak = useStreak(today);
  const data = diary.data;
  const settings = boot.settings;

  // Swipe left / right on the header and summary to change day.
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };
  const onTouchEnd = (e: TouchEvent) => {
    const s = touch.current;
    touch.current = null;
    if (!s) return;
    const dx = e.changedTouches[0].clientX - s.x;
    const dy = e.changedTouches[0].clientY - s.y;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45) setDate(addDays(date, dx < 0 ? 1 : -1));
  };

  const openDayMenu = () =>
    nav.push(
      <ActionSheet
        title={formatDMY(date)}
        actions={[
          {
            label: 'Copy this day to another date…',
            icon: <Copy size={20} />,
            run: () => nav.replace(<CopySheet fromDate={date} fromMeal={null} />),
          },
          ...(date !== today
            ? [
                {
                  label: 'Go to today',
                  icon: <CalendarDays size={20} />,
                  run: () => {
                    setDate(today);
                    nav.pop();
                  },
                },
              ]
            : []),
        ]}
      />,
    );

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe px-safe shrink-0 border-b border-line bg-surface" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <div className="mx-auto flex min-h-14 max-w-xl items-center px-1">
          <IconButton label="Previous day" onClick={() => setDate(addDays(date, -1))}>
            <ChevronLeft size={26} />
          </IconButton>
          <DateField value={date} onChange={setDate} className="min-w-0 flex-1 justify-center" label="Choose a day">
            <span className="flex flex-col items-center leading-tight">
              <span className="text-[17px] font-semibold">{friendlyDate(date, today)}</span>
              <span className="tabular text-[12px] text-muted">{formatDMY(date)}</span>
            </span>
          </DateField>
          <IconButton label="Next day" onClick={() => setDate(addDays(date, 1))}>
            <ChevronRight size={26} />
          </IconButton>
          {streak.data && streak.data.streak > 0 && (
            <span
              className={cx(
                'tabular mr-1 flex h-8 items-center gap-1 rounded-full px-2.5 text-[13px] font-bold',
                streak.data.loggedToday ? 'bg-primary-soft text-primary' : 'bg-surface-2 text-muted',
              )}
              title={`${streak.data.streak}-day logging streak`}
              aria-label={`${streak.data.streak}-day logging streak`}
            >
              <Flame size={15} aria-hidden />
              {streak.data.streak}
            </span>
          )}
          <IconButton label="Day options" onClick={openDayMenu}>
            <Ellipsis size={22} />
          </IconButton>
        </div>
      </header>

      <div className="scroll-area px-safe min-h-0 flex-1">
        <div className="mx-auto w-full max-w-xl space-y-3 px-3 pb-10 pt-3">
          <Loadable loading={diary.isPending} error={diary.isError ? diary.error : null} onRetry={() => diary.refetch()}>
            {data && (
              <>
                <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                  <Summary data={data} />
                </div>
                {[0, 1, 2, 3].map((meal) => (
                  <MealCard key={meal} meal={meal} data={data} />
                ))}
                <ExerciseCard data={data} />
                <WaterCard data={data} glass={settings.water_glass_ml} goal={settings.water_goal_ml} />
                <NotesCard date={date} note={data.note} />
                {date !== today && (
                  <Button variant="ghost" block onClick={() => setDate(today)}>
                    Back to today
                  </Button>
                )}
              </>
            )}
          </Loadable>
        </div>
      </div>
    </div>
  );

  // ---- summary ---------------------------------------------------------------

  function Summary({ data }: { data: DayData }) {
    const { totals, unknown } = sumNutrition(data.entries.map(entryNutrition));
    const burned = data.exercise.reduce((a, e) => a + e.kcal, 0);
    const counted = settings.exercise_adds_back ? burned : 0;
    const t = data.targets;
    if (!t) return null;
    const remaining = t.kcal - totals.kcal + counted;
    const over = remaining < 0;
    const cell = (label: string, value: string, muted = false) => (
      <div className="min-w-0 flex-1 text-center">
        <div className={cx('tabular text-[19px] font-bold leading-tight', muted && 'text-muted')}>{value}</div>
        <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
      </div>
    );
    const sign = (s: string) => <div className="pb-4 text-lg font-semibold text-muted">{s}</div>;
    return (
      <Card className="p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">Energy ({unit})</h2>
          {t.weekday_override && <span className="rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-muted">Weekday target</span>}
        </div>
        <div className="flex items-end" aria-label={`Goal ${energy(t.kcal)}, food ${energy(totals.kcal)}, exercise ${energy(burned)}, remaining ${energy(remaining)} ${unit}`}>
          {cell('Goal', energy(t.kcal))}
          {sign('−')}
          {cell('Food', energy(totals.kcal))}
          {sign('+')}
          {cell(settings.exercise_adds_back ? 'Exercise' : 'Exercise*', energy(burned), !settings.exercise_adds_back)}
          {sign('=')}
          <div className="min-w-0 flex-1 text-center">
            <div className={cx('tabular text-[19px] font-bold leading-tight', over ? 'text-danger' : 'text-primary')}>
              {energy(Math.abs(remaining))}
            </div>
            <div className={cx('text-[11px] font-semibold uppercase tracking-wide', over ? 'text-danger' : 'text-muted')}>{over ? 'Over' : 'Remaining'}</div>
          </div>
        </div>
        <Bar className="mt-3" value={totals.kcal} max={t.kcal + counted} color="var(--primary)" />
        {!settings.exercise_adds_back && burned > 0 && <p className="mt-2 text-[12px] text-muted">* Exercise is shown but not added to your budget (see Settings).</p>}
        {unknown.kcal > 0 && (
          <p className="mt-2 text-[12px] text-muted">
            {unknown.kcal} item{unknown.kcal === 1 ? ' has' : 's have'} no energy value, so the total is incomplete.
          </p>
        )}
        <div className="mt-4 grid grid-cols-3 gap-3">
          {(
            [
              ['Protein', 'protein', t.protein_g, 'var(--protein)'],
              ['Carbs', 'carbs', t.carbs_g, 'var(--carbs)'],
              ['Fat', 'fat', t.fat_g, 'var(--fat)'],
            ] as const
          ).map(([label, key, goal, color]) => (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[13px] font-semibold">{label}</span>
                {unknown[key] > 0 && (
                  <span className="text-[11px] text-muted" title="Some items have no value for this">
                    +?
                  </span>
                )}
              </div>
              <Bar className="my-1.5" value={totals[key]} max={goal} color={color} />
              <div className="tabular text-[12px] text-muted">
                {fmt(totals[key], 0)} / {fmt(goal, 0)} g
              </div>
            </div>
          ))}
        </div>
      </Card>
    );
  }

  // ---- meals -------------------------------------------------------------------

  function MealCard({ meal, data }: { meal: number; data: DayData }) {
    const entries = data.entries.filter((e) => e.meal === meal);
    const { totals } = sumNutrition(entries.map(entryNutrition));
    const name = mealName(meal);

    const remove = async (entry: Entry) => {
      // Take it off the screen at once; put it back if the laptop says no.
      queryClient.setQueryData<DayData>(['diary', date], (old) => (old ? { ...old, entries: old.entries.filter((e) => e.id !== entry.id) } : old));
      try {
        await deleteEntry(entry.id);
        toast(`Removed ${entry.name}`, {
          action: {
            label: 'Undo',
            run: () => {
              restoreEntry(entry.id).catch((err) => toastError(errorMessage(err)));
            },
          },
        });
      } catch (err) {
        void queryClient.invalidateQueries({ queryKey: ['diary', date] });
        toastError(errorMessage(err));
      }
    };

    const copyFromYesterday = async () => {
      nav.pop();
      try {
        const res = await copyDiary({ op_id: uuid(), from_date: addDays(date, -1), to_date: date, from_meal: meal, to_meal: meal });
        toast(`Copied ${res.copied} item${res.copied === 1 ? '' : 's'} from yesterday`);
      } catch (err) {
        toastError(errorMessage(err));
      }
    };

    const openMenu = () =>
      nav.push(
        <ActionSheet
          title={name}
          actions={[
            { label: 'Quick add energy', icon: <Zap size={20} />, run: () => nav.replace(<QuickAddSheet date={date} meal={meal} />) },
            { label: 'Copy from yesterday', icon: <Copy size={20} />, run: () => void copyFromYesterday() },
            ...(entries.length
              ? [
                  { label: 'Copy to another day…', icon: <CalendarDays size={20} />, run: () => nav.replace(<CopySheet fromDate={date} fromMeal={meal} />) },
                  { label: 'Save as a saved meal…', icon: <Save size={20} />, run: () => nav.replace(<SaveMealSheet date={date} meal={meal} defaultName={name} />) },
                ]
              : []),
          ]}
        />,
      );

    return (
      <Card className="overflow-hidden">
        <div className="flex min-h-12 items-center gap-2 pl-4 pr-1">
          <h3 className="min-w-0 flex-1 truncate text-[16px] font-semibold">{name}</h3>
          {entries.length > 0 && (
            <span className="tabular text-[15px] font-semibold">
              {energy(totals.kcal)} <span className="text-[12px] font-medium text-muted">{unit}</span>
            </span>
          )}
          <IconButton label={`${name} options`} onClick={openMenu}>
            <Ellipsis size={20} />
          </IconButton>
        </div>
        {entries.length > 0 && (
          <ul className="border-t border-line">
            {entries.map((entry) => {
              const n = entryNutrition(entry);
              return (
                <li key={entry.id} className="border-b border-line last:border-b-0">
                  <SwipeRow onDelete={() => void remove(entry)}>
                    <button
                      type="button"
                      className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2"
                      onClick={() => nav.push(<EntrySheet entry={entry} />)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium">{entry.name}</span>
                        <span className="block truncate text-[13px] text-muted">
                          {entry.kind === 'quick'
                            ? 'Quick add'
                            : [entry.brand, describeServing(entry.unit_label, entry.unit_amount, entry.quantity, entry.base_unit)].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <span className="tabular shrink-0 text-right">
                        <span className="block text-[15px] font-semibold">{n.kcal === null ? '?' : energy(n.kcal)}</span>
                        <span className="block text-[11px] text-muted">
                          P {n.protein === null ? '?' : fmtG(n.protein)} · C {n.carbs === null ? '?' : fmtG(n.carbs)} · F {n.fat === null ? '?' : fmtG(n.fat)}
                        </span>
                      </span>
                    </button>
                  </SwipeRow>
                </li>
              );
            })}
          </ul>
        )}
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-2 border-t border-line px-4 text-[15px] font-semibold text-primary active:bg-surface-2"
          onClick={() => nav.push(<AddFood date={date} meal={meal} />)}
        >
          <Plus size={18} aria-hidden /> Add food
        </button>
      </Card>
    );
  }

  // ---- exercise ------------------------------------------------------------------

  function ExerciseCard({ data }: { data: DayData }) {
    const burned = data.exercise.reduce((a, e) => a + e.kcal, 0);
    const remove = async (entry: Exercise) => {
      queryClient.setQueryData<DayData>(['diary', date], (old) => (old ? { ...old, exercise: old.exercise.filter((e) => e.id !== entry.id) } : old));
      try {
        await deleteExercise(entry.id);
        toast(`Removed ${entry.name}`, {
          action: {
            label: 'Undo',
            run: () => {
              saveExercise(entry, true).catch((err) => toastError(errorMessage(err)));
            },
          },
        });
      } catch (err) {
        void queryClient.invalidateQueries({ queryKey: ['diary', date] });
        toastError(errorMessage(err));
      }
    };
    return (
      <Card className="overflow-hidden">
        <div className="flex min-h-12 items-center gap-2 px-4">
          <Dumbbell size={18} className="text-exercise" aria-hidden />
          <h3 className="min-w-0 flex-1 text-[16px] font-semibold">Exercise</h3>
          {data.exercise.length > 0 && (
            <span className="tabular text-[15px] font-semibold">
              {energy(burned)} <span className="text-[12px] font-medium text-muted">{unit}</span>
            </span>
          )}
        </div>
        {data.exercise.length > 0 && (
          <ul className="border-t border-line">
            {data.exercise.map((entry) => (
              <li key={entry.id} className="border-b border-line last:border-b-0">
                <SwipeRow onDelete={() => void remove(entry)}>
                  <button
                    type="button"
                    className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2"
                    onClick={() => nav.push(<ExerciseSheet date={date} existing={entry} />)}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{entry.name}</span>
                      <span className="block text-[13px] text-muted">{fmt(entry.minutes, 0)} min</span>
                    </span>
                    <span className="tabular text-[15px] font-semibold">{energy(entry.kcal)}</span>
                  </button>
                </SwipeRow>
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          className="flex min-h-12 w-full items-center gap-2 border-t border-line px-4 text-[15px] font-semibold text-primary active:bg-surface-2"
          onClick={() => nav.push(<ExerciseSheet date={date} />)}
        >
          <Plus size={18} aria-hidden /> Add exercise
        </button>
      </Card>
    );
  }
}

// ---- water -------------------------------------------------------------------------

function WaterCard({ data, glass, goal }: { data: DayData; glass: number; goal: number }) {
  const nav = useNav();
  const date = data.date;
  const saver = useKeyedSaver<number>((key, ml) => setWater(key, ml));

  const set = (ml: number) => {
    const next = Math.max(0, Math.min(20000, Math.round(ml)));
    // Show the new total at once; the saver sends it (and keeps trying if offline).
    queryClient.setQueryData<DayData>(['diary', date], (old) => (old ? { ...old, water_ml: next } : old));
    saver.push(date, next);
  };

  return (
    <Card className="p-4">
      <div className="flex items-center gap-2">
        <Droplet size={18} className="text-water" aria-hidden />
        <h3 className="min-w-0 flex-1 text-[16px] font-semibold">Water</h3>
        <button
          type="button"
          className="tabular min-h-11 rounded-lg px-2 text-[15px] font-semibold active:bg-surface-2"
          onClick={() => nav.push(<WaterSheet date={date} current={data.water_ml} onSet={set} />)}
          aria-label="Set water amount"
        >
          {mlText(data.water_ml)} <span className="font-medium text-muted">/ {mlText(goal)}</span>
        </button>
      </div>
      <Bar className="mt-2" value={data.water_ml} max={goal} color="var(--water)" />
      <div className="mt-3 flex gap-2">
        <Button variant="secondary" size="sm" aria-label={`Remove ${glass} mL`} disabled={data.water_ml <= 0} onClick={() => set(data.water_ml - glass)}>
          <Minus size={18} aria-hidden />
        </Button>
        <Button variant="soft" size="sm" className="flex-1" onClick={() => set(data.water_ml + glass)}>
          <Plus size={18} aria-hidden /> Add a glass ({fmt(glass)} mL)
        </Button>
      </div>
      {saver.failing && <p className="mt-2 text-[12px] text-muted">Not saved yet. Still trying…</p>}
    </Card>
  );
}

// ---- notes ---------------------------------------------------------------------------

function NotesCard({ date, note }: { date: string; note: string }) {
  const [text, setText] = useState(note);
  const [open, setOpen] = useState(note !== '');
  const dirty = useRef(false);
  const timer = useRef<number | undefined>(undefined);
  const latest = useRef({ date, text });
  latest.current = { date, text };
  const saver = useKeyedSaver<string>((key, value) => setNote(key, value));

  const flush = () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saver.push(latest.current.date, latest.current.text);
  };

  // A different day (or fresh data for this one): show its note, after saving any typing.
  const shownFor = useRef(date);
  useEffect(() => {
    if (shownFor.current !== date) {
      shownFor.current = date;
      setText(note);
      setOpen(note !== '');
    } else if (!dirty.current) {
      setText(note);
    }
  }, [date, note]);

  // Save whatever was typed before leaving this day or this screen.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => flushRef.current(), [date]);

  if (!open) {
    return (
      <Button variant="ghost" block onClick={() => setOpen(true)}>
        Add a note for this day
      </Button>
    );
  }
  return (
    <Card className="p-4">
      <label className="block">
        <span className="mb-2 block text-[16px] font-semibold">Notes</span>
        <TextArea
          value={text}
          maxLength={2000}
          placeholder="How did today go?"
          onChange={(e) => {
            setText(e.target.value);
            latest.current = { date, text: e.target.value };
            dirty.current = true;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(flush, 800);
          }}
          onBlur={flush}
        />
      </label>
      {saver.failing && <p className="mt-2 text-[12px] text-muted">Not saved yet. Your note is kept here and will be saved when your laptop is reachable.</p>}
    </Card>
  );
}
