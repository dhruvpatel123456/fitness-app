// Sheets opened from the diary: edit an entry, quick add, copy, save a meal,
// set water.

import { useState } from 'react';
import { addDays, formatDMY } from '../../shared/dates.js';
import { MealSelect, NutritionSummary, ServingFields, useServing } from '../components/Serving';
import { Button, DateField, Field, NumInput, SelectInput, Sheet, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { numText, parseNum } from '../lib/format';
import { useStableId } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { copyDiary, createSavedMeal, deleteEntry, quickAdd, restoreEntry, updateEntry } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { Entry } from '../types';

function optional(text: string, max: number): number | null | 'bad' {
  if (text.trim() === '') return null;
  const n = parseNum(text);
  return n === null || n < 0 || n > max ? 'bad' : n;
}

// ---- edit a logged food ------------------------------------------------------------

export function EntrySheet({ entry }: { entry: Entry }) {
  return entry.kind === 'quick' ? <QuickEntrySheet entry={entry} /> : <FoodEntrySheet entry={entry} />;
}

function useDelete(entry: Entry) {
  const nav = useNav();
  return async () => {
    try {
      await deleteEntry(entry.id);
      nav.pop();
      toast(`Removed ${entry.name}`, {
        action: {
          label: 'Undo',
          run: () => {
            restoreEntry(entry.id).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    }
  };
}

function FoodEntrySheet({ entry }: { entry: Entry }) {
  const nav = useNav();
  const serving = useServing(entry, { label: entry.unit_label, amount: entry.unit_amount, quantity: entry.quantity });
  const [meal, setMeal] = useState(entry.meal);
  const [busy, setBusy] = useState(false);
  const remove = useDelete(entry);

  const save = async () => {
    if (!serving.valid || serving.quantity === null) return;
    setBusy(true);
    try {
      await updateEntry(entry.id, {
        unit: { label: serving.unit.label, amount: serving.unit.amount },
        quantity: serving.quantity,
        meal,
      });
      nav.pop();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={entry.name}
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="text-danger" onClick={() => void remove()}>
            Delete
          </Button>
          <Button className="flex-1" busy={busy} disabled={!serving.valid} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {entry.brand && <p className="-mt-2 text-[14px] text-muted">{entry.brand}</p>}
        <ServingFields serving={serving} />
        <NutritionSummary per100={entry} amount={serving.amount} />
        <MealSelect value={meal} onChange={setMeal} />
        <p className="text-[13px] text-muted">
          This entry keeps the values the food had when you logged it on {formatDMY(entry.date)}.
        </p>
      </div>
    </Sheet>
  );
}

// ---- quick add (energy only, optional macros) ------------------------------------------

type QuickForm = { name: string; energy: string; protein: string; carbs: string; fat: string };

function QuickFields({ form, setForm, showErrors }: { form: QuickForm; setForm: (f: QuickForm) => void; showErrors: boolean }) {
  const { unit } = useApp();
  const energyBad = form.energy.trim() === '' || parseNum(form.energy) === null;
  return (
    <>
      <Field label={`Energy (${unit})`} error={showErrors && energyBad ? 'Enter the energy' : null}>
        <NumInput aria-label="Energy" value={form.energy} onChange={(energy) => setForm({ ...form, energy })} suffix={unit} autoFocus />
      </Field>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Protein">
          <NumInput aria-label="Protein" value={form.protein} onChange={(protein) => setForm({ ...form, protein })} suffix="g" />
        </Field>
        <Field label="Carbs">
          <NumInput aria-label="Carbs" value={form.carbs} onChange={(carbs) => setForm({ ...form, carbs })} suffix="g" />
        </Field>
        <Field label="Fat">
          <NumInput aria-label="Fat" value={form.fat} onChange={(fat) => setForm({ ...form, fat })} suffix="g" />
        </Field>
      </div>
      <Field label="Name (optional)" hint="Macros are optional. Leave them blank if you do not know them.">
        <TextInput aria-label="Name" value={form.name} maxLength={80} placeholder="e.g. Coffee at the cafe" onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
    </>
  );
}

/** Read the form. Returns null (after the caller shows errors) when something is not valid. */
function readQuick(form: QuickForm, toKcal: (v: number) => number) {
  const energy = parseNum(form.energy);
  const protein = optional(form.protein, 2000);
  const carbs = optional(form.carbs, 2000);
  const fat = optional(form.fat, 2000);
  if (energy === null || energy < 0 || protein === 'bad' || carbs === 'bad' || fat === 'bad') return null;
  const kcal = toKcal(energy);
  if (kcal > 20000) return null;
  return { name: form.name.trim(), kcal, protein, carbs, fat };
}

export function QuickAddSheet({ date, meal: initialMeal }: { date: string; meal: number }) {
  const nav = useNav();
  const { toKcal } = useApp();
  const id = useStableId(uuid);
  const [form, setForm] = useState<QuickForm>({ name: '', energy: '', protein: '', carbs: '', fat: '' });
  const [meal, setMeal] = useState(initialMeal);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const quick = readQuick(form, toKcal);
    if (!quick) {
      setShowErrors(true);
      toastError('Check the numbers and try again.');
      return;
    }
    setBusy(true);
    try {
      await quickAdd({ id, date, meal, quick });
      nav.pop();
      toast('Added');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Quick add"
      footer={
        <Button block busy={busy} onClick={() => void submit()}>
          Add to diary
        </Button>
      }
    >
      <div className="space-y-4">
        <QuickFields form={form} setForm={setForm} showErrors={showErrors} />
        <MealSelect value={meal} onChange={setMeal} />
      </div>
    </Sheet>
  );
}

function QuickEntrySheet({ entry }: { entry: Entry }) {
  const nav = useNav();
  const { toKcal, energyValue } = useApp();
  const total = (v: number | null) => (v === null ? '' : numText((v * entry.amount) / 100, 1));
  const [form, setForm] = useState<QuickForm>({
    name: entry.name === 'Quick add' ? '' : entry.name,
    energy: entry.kcal === null ? '' : numText(energyValue((entry.kcal * entry.amount) / 100), 0),
    protein: total(entry.protein),
    carbs: total(entry.carbs),
    fat: total(entry.fat),
  });
  const [meal, setMeal] = useState(entry.meal);
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = useDelete(entry);

  const save = async () => {
    const quick = readQuick(form, toKcal);
    if (!quick) {
      setShowErrors(true);
      toastError('Check the numbers and try again.');
      return;
    }
    setBusy(true);
    try {
      await updateEntry(entry.id, { quick, meal });
      nav.pop();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Quick add"
      footer={
        <div className="flex gap-3">
          <Button variant="secondary" className="text-danger" onClick={() => void remove()}>
            Delete
          </Button>
          <Button className="flex-1" busy={busy} onClick={() => void save()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <QuickFields form={form} setForm={setForm} showErrors={showErrors} />
        <MealSelect value={meal} onChange={setMeal} />
      </div>
    </Sheet>
  );
}

// ---- copy a meal or a whole day ------------------------------------------------------------

export function CopySheet({ fromDate, fromMeal }: { fromDate: string; fromMeal: number | null }) {
  const nav = useNav();
  const { today, mealName, boot } = useApp();
  const opId = useStableId(uuid);
  const [toDate, setToDate] = useState(fromDate === today ? addDays(today, 1) : today);
  const [toMeal, setToMeal] = useState<number>(fromMeal ?? 0);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const res = await copyDiary({
        op_id: opId,
        from_date: fromDate,
        to_date: toDate,
        from_meal: fromMeal,
        to_meal: fromMeal === null ? null : toMeal,
      });
      nav.pop();
      toast(`Copied ${res.total} item${res.total === 1 ? '' : 's'} to ${formatDMY(toDate)}`);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title={fromMeal === null ? 'Copy this day' : `Copy ${mealName(fromMeal)}`}
      footer={
        <Button block busy={busy} onClick={() => void submit()}>
          Copy
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-[15px] text-muted">
          {fromMeal === null ? 'Everything logged' : `Everything in ${mealName(fromMeal)}`} on {formatDMY(fromDate)} is added to the
          day you choose. Nothing is removed.
        </p>
        <Field label="Copy to">
          <DateField value={toDate} onChange={setToDate} className="w-full" label="Copy to date" />
        </Field>
        {fromMeal !== null && (
          <Field label="Into">
            <SelectInput aria-label="Into meal" value={toMeal} onChange={(e) => setToMeal(Number(e.target.value))}>
              {boot.settings.meal_names.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </SelectInput>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

// ---- save a diary meal for re-use ------------------------------------------------------------

export function SaveMealSheet({ date, meal, defaultName }: { date: string; meal: number; defaultName: string }) {
  const nav = useNav();
  const id = useStableId(uuid);
  const [name, setName] = useState(`My ${defaultName.toLowerCase()}`);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createSavedMeal({ id, name: name.trim(), from_diary: { date, meal } });
      nav.pop();
      toast('Saved. Find it under Saved Meals when adding food.');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      title="Save as a saved meal"
      footer={
        <Button block busy={busy} disabled={!name.trim()} onClick={() => void submit()}>
          Save meal
        </Button>
      }
    >
      <Field label="Name" hint="A saved meal adds all of these foods to your diary in one tap.">
        <TextInput aria-label="Saved meal name" value={name} maxLength={80} autoFocus onChange={(e) => setName(e.target.value)} />
      </Field>
    </Sheet>
  );
}

// ---- water -------------------------------------------------------------------------------------

export function WaterSheet({ date, current, onSet }: { date: string; current: number; onSet: (ml: number) => void }) {
  const nav = useNav();
  const [text, setText] = useState(numText(current, 0));
  const value = parseNum(text);
  const valid = value !== null && value >= 0 && value <= 20000;
  return (
    <Sheet
      title="Water"
      footer={
        <Button
          block
          disabled={!valid}
          onClick={() => {
            if (value === null) return;
            onSet(value);
            nav.pop();
          }}
        >
          Save
        </Button>
      }
    >
      <Field label={`Total for ${formatDMY(date)}`} error={text !== '' && !valid ? 'Enter 0 to 20,000 mL' : null}>
        <NumInput aria-label="Water in millilitres" value={text} onChange={setText} decimal={false} suffix="mL" autoFocus />
      </Field>
    </Sheet>
  );
}
