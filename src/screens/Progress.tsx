// Progress: weight (with trend and goal), calories against goal, macro
// breakdown, logging streak and body measurements.

import { Flame } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { addDays, diffDays, formatDM, formatDMY } from '../../shared/dates.js';
import { MEASUREMENT_KINDS, findMeasurementKind } from '../../shared/measures.js';
import { macroPercentages } from '../../shared/nutrition.js';
import { weeklyAverages, weightTrend } from '../../shared/trend.js';
import { Button, Card, DateField, Empty, Field, Loadable, NumInput, Segmented, SelectInput, Sheet } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { fmt, numText, parseNum } from '../lib/format';
import { useNav } from '../lib/nav';
import {
  deleteMeasurement,
  deleteWeight,
  saveMeasurement,
  saveWeight,
  useDailyStats,
  useMeasurements,
  useStreak,
  useWeights,
} from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { DayStat, Measurement, Weight } from '../types';

type Section = 'weight' | 'energy' | 'macros' | 'body';

const EPOCH = '2000-01-01';
const dayIndex = (date: string) => diffDays(EPOCH, date);
const fromIndex = (x: number) => addDays(EPOCH, x);

const AXIS_TICK = { fontSize: 11, fill: 'var(--muted)' };
const TOOLTIP_STYLE = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 12,
  color: 'var(--ink)',
  fontSize: 13,
  boxShadow: 'var(--shadow)',
};

export default function ProgressScreen() {
  const { today } = useApp();
  const [section, setSection] = useState<Section>('weight');
  const streak = useStreak(today);

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe px-safe shrink-0 border-b border-line bg-surface">
        <div className="mx-auto max-w-xl px-4 pb-3 pt-3">
          <div className="flex items-center justify-between">
            <h1 className="text-[22px] font-bold">Progress</h1>
            {streak.data && (
              <span className="tabular flex h-9 items-center gap-1.5 rounded-full bg-primary-soft px-3 text-[14px] font-bold text-primary" aria-label={`${streak.data.streak}-day logging streak`}>
                <Flame size={16} aria-hidden />
                {streak.data.streak}-day streak
              </span>
            )}
          </div>
          <Segmented
            className="mt-3"
            label="Progress sections"
            value={section}
            onChange={setSection}
            options={[
              { value: 'weight', label: 'Weight' },
              { value: 'energy', label: 'Calories' },
              { value: 'macros', label: 'Macros' },
              { value: 'body', label: 'Body' },
            ]}
          />
        </div>
      </header>
      <div className="scroll-area px-safe min-h-0 flex-1">
        <div className="mx-auto w-full max-w-xl space-y-4 px-4 pb-10 pt-4">
          {streak.data && streak.data.streak > 0 && !streak.data.loggedToday && section === 'weight' && (
            <p className="rounded-xl bg-surface-2 px-3 py-2 text-[14px] text-muted">Log something today to keep your {streak.data.streak}-day streak going.</p>
          )}
          {section === 'weight' && <WeightSection />}
          {section === 'energy' && <EnergySection />}
          {section === 'macros' && <MacroSection />}
          {section === 'body' && <BodySection />}
        </div>
      </div>
    </div>
  );
}

// ---- weight --------------------------------------------------------------------------

const RANGES = [
  { value: '7', label: '1W' },
  { value: '30', label: '1M' },
  { value: '91', label: '3M' },
  { value: '365', label: '1Y' },
  { value: 'all', label: 'All' },
];

function WeightSection() {
  const nav = useNav();
  const { today, boot } = useApp();
  const weights = useWeights();
  const [range, setRange] = useState('91');
  const [date, setDate] = useState(today);
  const [kgText, setKgText] = useState('');
  const [busy, setBusy] = useState(false);
  const goal = boot.profile?.goal_weight_kg ?? null;

  const all = useMemo(() => weights.data ?? [], [weights.data]);
  const existing = all.find((w) => w.date === date);
  const kg = parseNum(kgText);
  const kgOk = kg !== null && kg >= 25 && kg <= 400;

  const points = useMemo(() => {
    const trend = weightTrend(all) as { date: string; kg: number; trend: number }[];
    const from = range === 'all' ? null : addDays(today, -Number(range));
    return trend.filter((p) => from === null || p.date >= from).map((p) => ({ ...p, x: dayIndex(p.date) }));
  }, [all, range, today]);

  const save = async () => {
    if (!kgOk || kg === null) return;
    setBusy(true);
    try {
      await saveWeight(date, kg);
      setKgText('');
      toast(existing ? 'Weight updated' : 'Weight saved');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const latest = all[all.length - 1];
  const first = points[0];
  const last = points[points.length - 1];
  const values = points.flatMap((p) => [p.kg, p.trend]);
  let lo = values.length ? Math.min(...values) : 0;
  let hi = values.length ? Math.max(...values) : 1;
  // Show the goal line when it is near enough not to flatten the chart.
  const showGoal = goal !== null && values.length > 0 && goal >= lo - Math.max(6, hi - lo) && goal <= hi + Math.max(6, hi - lo);
  if (showGoal && goal !== null) {
    lo = Math.min(lo, goal);
    hi = Math.max(hi, goal);
  }
  const pad = Math.max(0.5, (hi - lo) * 0.12);

  return (
    <>
      <Card className="p-4">
        <h2 className="font-semibold">Log your weight</h2>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Date">
            <DateField value={date} onChange={setDate} max={today} className="w-full" label="Weigh-in date" />
          </Field>
          <Field label="Weight" error={kgText !== '' && !kgOk ? '25 to 400 kg' : null}>
            <NumInput aria-label="Weight in kilograms" value={kgText} onChange={setKgText} suffix="kg" placeholder={existing ? numText(existing.kg, 1) : latest ? numText(latest.kg, 1) : ''} />
          </Field>
        </div>
        <Button block className="mt-3" busy={busy} disabled={!kgOk} onClick={() => void save()}>
          {existing ? `Replace ${formatDMY(date)} (${fmt(existing.kg, 1)} kg)` : 'Save weight'}
        </Button>
      </Card>

      <Loadable loading={weights.isPending} error={weights.isError ? weights.error : null} onRetry={() => weights.refetch()}>
        <Card className="p-4">
          <Segmented label="Time range" value={range} onChange={setRange} options={RANGES} />
          {points.length === 0 ? (
            <Empty title="No weigh-ins in this period">Log your weight above to start the chart.</Empty>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Stat label="Latest" value={`${fmt(last.kg, 1)} kg`} />
                <Stat label="Change" value={`${last.kg - first.kg > 0 ? '+' : ''}${fmt(last.kg - first.kg, 1)} kg`} />
                <Stat label="To goal" value={goal === null ? '–' : `${fmt(Math.abs(last.kg - goal), 1)} kg`} />
              </div>
              <div className="mt-3 h-56" role="img" aria-label={`Weight chart: latest ${fmt(last.kg, 1)} kilograms`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={points} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis
                      dataKey="x"
                      type="number"
                      domain={points.length > 1 ? ['dataMin', 'dataMax'] : [points[0].x - 1, points[0].x + 1]}
                      tickFormatter={(x: number) => formatDM(fromIndex(Math.round(x)))}
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      tickCount={5}
                      allowDecimals={false}
                    />
                    <YAxis domain={[lo - pad, hi + pad]} tick={AXIS_TICK} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmt(v, 1)} width={52} />
                    <Tooltip
                      contentStyle={TOOLTIP_STYLE}
                      labelFormatter={(x) => formatDMY(fromIndex(Math.round(Number(x))))}
                      formatter={(value, name) => [`${fmt(Number(value), 1)} kg`, name === 'trend' ? 'Trend' : 'Weight']}
                    />
                    {showGoal && goal !== null && (
                      <ReferenceLine y={goal} stroke="var(--carbs)" strokeDasharray="5 4" label={{ value: `Goal ${fmt(goal, 1)}`, position: 'insideTopRight', fill: 'var(--carbs)', fontSize: 11 }} />
                    )}
                    <Line dataKey="kg" stroke="var(--muted)" strokeWidth={1} dot={{ r: 3, fill: 'var(--muted)', strokeWidth: 0 }} activeDot={{ r: 5 }} isAnimationActive={false} />
                    <Line dataKey="trend" stroke="var(--primary)" strokeWidth={2.5} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-2 text-[12px] text-muted">
                Dots are weigh-ins. The green line is the trend, which smooths out day-to-day swings.
                {goal !== null && !showGoal ? ` Your goal is ${fmt(goal, 1)} kg.` : ''}
              </p>
            </>
          )}
        </Card>

        {all.length > 0 && (
          <Card className="overflow-hidden">
            <h2 className="px-4 pb-1 pt-3 font-semibold">Weigh-ins</h2>
            <ul>
              {[...all]
                .reverse()
                .slice(0, 60)
                .map((w) => (
                  <li key={w.date} className="border-t border-line">
                    <button type="button" onClick={() => nav.push(<WeightSheet weight={w} />)} className="flex min-h-12 w-full items-center justify-between px-4 text-left active:bg-surface-2">
                      <span className="tabular text-[15px]">{formatDMY(w.date)}</span>
                      <span className="tabular text-[15px] font-semibold">{fmt(w.kg, 1)} kg</span>
                    </button>
                  </li>
                ))}
            </ul>
          </Card>
        )}
      </Loadable>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-2 py-2">
      <div className="tabular text-[16px] font-bold">{value}</div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
}

function WeightSheet({ weight }: { weight: Weight }) {
  const nav = useNav();
  const [text, setText] = useState(numText(weight.kg, 2));
  const [busy, setBusy] = useState(false);
  const kg = parseNum(text);
  const ok = kg !== null && kg >= 25 && kg <= 400;
  const run = async (action: () => Promise<void>, done: string) => {
    setBusy(true);
    try {
      await action();
      nav.pop();
      toast(done);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet
      title={`Weight on ${formatDMY(weight.date)}`}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="text-danger" disabled={busy} onClick={() => void run(() => deleteWeight(weight.date), 'Weigh-in deleted')}>
            Delete
          </Button>
          <Button className="flex-1" busy={busy} disabled={!ok} onClick={() => void run(() => saveWeight(weight.date, kg as number), 'Weight updated')}>
            Save
          </Button>
        </div>
      }
    >
      <Field label="Weight" error={text !== '' && !ok ? '25 to 400 kg' : null}>
        <NumInput aria-label="Weight in kilograms" value={text} onChange={setText} suffix="kg" autoFocus />
      </Field>
    </Sheet>
  );
}

// ---- calories ---------------------------------------------------------------------------

function useRangeStats(days: number) {
  const { today } = useApp();
  return useDailyStats(addDays(today, -(days - 1)), today);
}

function EnergySection() {
  const { energyValue, energy, unit } = useApp();
  const [days, setDays] = useState('7');
  const stats = useRangeStats(Number(days));
  const data = useMemo(
    () =>
      (stats.data ?? []).map((d) => ({
        date: d.date,
        intake: Math.round(energyValue(d.kcal)),
        goal: d.target ? Math.round(energyValue(d.target.kcal)) : null,
        over: d.target !== null && d.kcal > d.target.kcal,
        entries: d.entries,
      })),
    [stats.data, energyValue],
  );
  const logged = (stats.data ?? []).filter((d) => d.entries > 0);
  const average = logged.length ? logged.reduce((a, d) => a + d.kcal, 0) / logged.length : null;
  const onTarget = logged.filter((d) => d.target && d.kcal <= d.target.kcal).length;
  const weeks = weeklyAverages(stats.data ?? []) as { week_start: string; days_logged: number; kcal: number }[];

  return (
    <Loadable loading={stats.isPending} error={stats.isError ? stats.error : null} onRetry={() => stats.refetch()}>
      <Card className="p-4">
        <Segmented
          label="Time range"
          value={days}
          onChange={setDays}
          options={[
            { value: '7', label: '7 days' },
            { value: '30', label: '30 days' },
            { value: '90', label: '90 days' },
          ]}
        />
        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
          <Stat label={`Daily average`} value={average === null ? '–' : energy(average)} />
          <Stat label="Days logged" value={`${logged.length} / ${days}`} />
          <Stat label="At or under goal" value={`${onTarget}`} />
        </div>
        <div className="mt-3 h-56" role="img" aria-label={`Daily energy intake against goal for the last ${days} days`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 8, right: 6, bottom: 0, left: -14 }} barCategoryGap={Number(days) > 30 ? 1 : '18%'}>
              <CartesianGrid stroke="var(--line)" vertical={false} />
              <XAxis dataKey="date" tickFormatter={(d: string) => formatDM(d)} tick={AXIS_TICK} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
              <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmt(v)} />
              <Tooltip
                cursor={{ fill: 'var(--surface-2)' }}
                contentStyle={TOOLTIP_STYLE}
                labelFormatter={(d) => formatDMY(String(d))}
                formatter={(value, name) => [`${fmt(Number(value))} ${unit}`, name === 'goal' ? 'Goal' : 'Eaten']}
              />
              <Bar dataKey="intake" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {data.map((d) => (
                  <Cell key={d.date} fill={d.over ? 'var(--danger)' : 'var(--primary)'} />
                ))}
              </Bar>
              <Line dataKey="goal" type="step" stroke="var(--carbs)" strokeWidth={2} strokeDasharray="5 4" dot={false} isAnimationActive={false} connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-[12px] text-muted">
          Bars show what you ate ({unit}); red bars are over the goal. The dashed line is your goal for each day.
        </p>
      </Card>

      <Card className="overflow-hidden">
        <h2 className="px-4 pb-1 pt-3 font-semibold">Weekly averages</h2>
        <p className="px-4 pb-2 text-[13px] text-muted">Average per logged day, for weeks starting on Monday.</p>
        <ul>
          {[...weeks].reverse().map((w) => (
            <li key={w.week_start} className="flex min-h-12 items-center justify-between border-t border-line px-4">
              <span className="text-[15px]">
                Week of <span className="tabular">{formatDM(w.week_start)}</span>
                <span className="ml-2 text-[13px] text-muted">
                  {w.days_logged} day{w.days_logged === 1 ? '' : 's'} logged
                </span>
              </span>
              <span className="tabular text-[15px] font-semibold">
                {w.days_logged ? energy(w.kcal) : '–'} <span className="text-[11px] font-medium text-muted">{unit}</span>
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Loadable>
  );
}

// ---- macros -------------------------------------------------------------------------------

function MacroBreakdown({ title, note, grams, target }: { title: string; note: string; grams: { protein: number; carbs: number; fat: number } | null; target: DayStat['target'] }) {
  const rows = [
    { key: 'protein', label: 'Protein', color: 'var(--protein)', goal: target?.protein_g },
    { key: 'carbs', label: 'Carbs', color: 'var(--carbs)', goal: target?.carbs_g },
    { key: 'fat', label: 'Fat', color: 'var(--fat)', goal: target?.fat_g },
  ] as const;
  const pct = grams ? macroPercentages(grams.protein, grams.carbs, grams.fat) : null;
  return (
    <Card className="p-4">
      <h2 className="font-semibold">{title}</h2>
      <p className="text-[13px] text-muted">{note}</p>
      {!grams || !pct ? (
        <Empty title="Nothing logged">Log some food to see the split.</Empty>
      ) : (
        <>
          <div className="mt-3 flex h-4 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`Protein ${fmt(pct.protein)} percent, carbs ${fmt(pct.carbs)} percent, fat ${fmt(pct.fat)} percent of energy`}>
            {rows.map((r) => (
              <div key={r.key} style={{ width: `${pct[r.key]}%`, background: r.color }} />
            ))}
          </div>
          <table className="mt-3 w-full text-[15px]">
            <thead>
              <tr className="text-left text-[12px] font-medium uppercase tracking-wide text-muted">
                <th className="py-1 font-medium">Macro</th>
                <th className="py-1 text-right font-medium">Grams</th>
                <th className="py-1 text-right font-medium">Goal</th>
                <th className="py-1 text-right font-medium">% of energy</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="py-2">
                    <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full" style={{ background: r.color }} aria-hidden />
                    {r.label}
                  </td>
                  <td className="tabular py-2 text-right font-semibold">{fmt(grams[r.key], 0)} g</td>
                  <td className="tabular py-2 text-right text-muted">{r.goal === undefined ? '–' : `${fmt(r.goal, 0)} g`}</td>
                  <td className="tabular py-2 text-right font-semibold">{fmt(pct[r.key], 0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}

function MacroSection() {
  const { date, today } = useApp();
  const stats = useRangeStats(7);
  const days = stats.data ?? [];
  const shown = date <= today && date >= addDays(today, -6) ? date : today;
  const day = days.find((d) => d.date === shown);
  const logged = days.filter((d) => d.entries > 0);
  const n = logged.length;
  const average = n
    ? {
        protein: logged.reduce((a, d) => a + d.protein, 0) / n,
        carbs: logged.reduce((a, d) => a + d.carbs, 0) / n,
        fat: logged.reduce((a, d) => a + d.fat, 0) / n,
      }
    : null;
  return (
    <Loadable loading={stats.isPending} error={stats.isError ? stats.error : null} onRetry={() => stats.refetch()}>
      <MacroBreakdown
        title={shown === today ? 'Today' : formatDMY(shown)}
        note="What you have logged for the day."
        grams={day && day.entries > 0 ? { protein: day.protein, carbs: day.carbs, fat: day.fat } : null}
        target={day?.target ?? null}
      />
      <MacroBreakdown
        title="Weekly average"
        note={`Average of the ${n} logged day${n === 1 ? '' : 's'} in the last 7.`}
        grams={average}
        target={days[days.length - 1]?.target ?? null}
      />
    </Loadable>
  );
}

// ---- body measurements ----------------------------------------------------------------------

function BodySection() {
  const { today } = useApp();
  const measurements = useMeasurements();
  const [kind, setKind] = useState('waist');
  const [date, setDate] = useState(today);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveId, setSaveId] = useState(uuid);
  const info = findMeasurementKind(kind) ?? MEASUREMENT_KINDS[0];
  const value = parseNum(text);
  const ok = value !== null && value >= info.min && value <= info.max;

  const mine = useMemo(
    () => (measurements.data ?? []).filter((m) => m.kind === kind).sort((a, b) => (a.date < b.date ? -1 : 1)),
    [measurements.data, kind],
  );
  const points = mine.map((m) => ({ x: dayIndex(m.date), value: m.value, date: m.date }));
  const values = points.map((p) => p.value);
  const lo = values.length ? Math.min(...values) : 0;
  const hi = values.length ? Math.max(...values) : 1;
  const pad = Math.max(0.5, (hi - lo) * 0.15);

  const save = async () => {
    if (!ok || value === null) return;
    setBusy(true);
    try {
      await saveMeasurement({ id: saveId, date, kind, value });
      setSaveId(uuid());
      setText('');
      toast('Measurement saved');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (m: Measurement) => {
    try {
      await deleteMeasurement(m.id);
      toast('Measurement deleted', {
        action: {
          label: 'Undo',
          run: () => {
            saveMeasurement({ id: m.id, date: m.date, kind: m.kind, value: m.value }).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  return (
    <>
      <Card className="p-4">
        <h2 className="font-semibold">Body measurements</h2>
        <p className="text-[13px] text-muted">Optional. Useful when the scales are slow to move.</p>
        <div className="mt-3 space-y-3">
          <Field label="Measurement">
            <SelectInput aria-label="Measurement" value={kind} onChange={(e) => setKind(e.target.value)}>
              {MEASUREMENT_KINDS.map((k: { key: string; label: string; unit: string }) => (
                <option key={k.key} value={k.key}>
                  {k.label} ({k.unit})
                </option>
              ))}
            </SelectInput>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date">
              <DateField value={date} onChange={setDate} max={today} className="w-full" label="Measurement date" />
            </Field>
            <Field label={info.label} error={text !== '' && !ok ? `${info.min} to ${info.max} ${info.unit}` : null}>
              <NumInput aria-label={`${info.label} in ${info.unit}`} value={text} onChange={setText} suffix={info.unit} />
            </Field>
          </div>
          <Button block busy={busy} disabled={!ok} onClick={() => void save()}>
            Save measurement
          </Button>
        </div>
      </Card>

      <Loadable loading={measurements.isPending} error={measurements.isError ? measurements.error : null} onRetry={() => measurements.refetch()}>
        <Card className="overflow-hidden">
          <h2 className="px-4 pb-1 pt-3 font-semibold">{info.label}</h2>
          {mine.length === 0 ? (
            <Empty title="Nothing recorded yet">Add a measurement above.</Empty>
          ) : (
            <>
              {points.length > 1 && (
                <div className="h-44 px-2" role="img" aria-label={`${info.label} chart`}>
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={points} margin={{ top: 8, right: 10, bottom: 0, left: -18 }}>
                      <CartesianGrid stroke="var(--line)" vertical={false} />
                      <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(x: number) => formatDM(fromIndex(Math.round(x)))} tick={AXIS_TICK} tickLine={false} axisLine={false} tickCount={5} allowDecimals={false} />
                      <YAxis domain={[lo - pad, hi + pad]} tick={AXIS_TICK} tickLine={false} axisLine={false} width={52} tickFormatter={(v: number) => fmt(v, 1)} />
                      <Tooltip contentStyle={TOOLTIP_STYLE} labelFormatter={(x) => formatDMY(fromIndex(Math.round(Number(x))))} formatter={(v) => [`${fmt(Number(v), 1)} ${info.unit}`, info.label]} />
                      <Line dataKey="value" stroke="var(--primary)" strokeWidth={2.5} dot={{ r: 3, fill: 'var(--primary)', strokeWidth: 0 }} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              <ul>
                {[...mine].reverse().map((m) => (
                  <li key={m.id} className="flex min-h-12 items-center justify-between border-t border-line pl-4 pr-2">
                    <span className="tabular text-[15px]">{formatDMY(m.date)}</span>
                    <span className="flex items-center gap-1">
                      <span className="tabular text-[15px] font-semibold">
                        {fmt(m.value, 1)} {info.unit}
                      </span>
                      <Button variant="ghost" size="sm" className="text-danger" onClick={() => void remove(m)} aria-label={`Delete ${formatDMY(m.date)}`}>
                        Delete
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
      </Loadable>
    </>
  );
}
