// Create or edit a food.
//
// Values can be typed per 100 g/mL or per serving (whichever the label
// shows). They are stored per 100 either way, unrounded.

import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { NUTRIENT_INFO, baseUnitLabel, nutritionProblems, per100FromServing } from '../../shared/nutrition.js';
import { Button, Card, Field, IconButton, Notice, NumInput, Page, Segmented, SelectInput, TextInput } from '../components/ui';
import { ApiError, errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { numText, parseNum } from '../lib/format';
import { useStableId } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { createFood, saveFood } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { BaseUnit, Food, NutrientKey } from '../types';

type ServingRow = { key: string; label: string; amount: string };
type Values = Record<NutrientKey, string>;

const FIELDS: { key: NutrientKey; label: string; optional?: boolean }[] = [
  { key: 'kcal', label: 'Energy' },
  { key: 'protein', label: 'Protein' },
  { key: 'carbs', label: 'Carbohydrate' },
  { key: 'fat', label: 'Fat' },
  { key: 'sat_fat', label: 'Saturated fat', optional: true },
  { key: 'sugar', label: 'Sugars', optional: true },
  { key: 'fibre', label: 'Fibre', optional: true },
  { key: 'sodium', label: 'Sodium', optional: true },
];

/** "1 slice (30 g)" -> "1 slice": the amount is shown in its own box. */
function stripAmount(label: string): string {
  return label.replace(/\s*\(\s*[\d.,]+\s*(g|ml)\s*\)\s*$/i, '').trim();
}

export function FoodForm({
  food,
  barcode,
  initialName = '',
  onSaved,
}: {
  /** The food being edited; leave out to create a new one. */
  food?: Food;
  /** Pre-filled barcode (after scanning something unknown). */
  barcode?: string;
  initialName?: string;
  onSaved?: (food: Food) => void;
}) {
  const nav = useNav();
  const { unit, energyValue, toKcal } = useApp();
  const newId = useStableId(uuid);
  const editing = Boolean(food);

  const [name, setName] = useState(food?.name ?? initialName);
  const [brand, setBrand] = useState(food?.brand ?? '');
  const [code, setCode] = useState(food?.barcode ?? barcode ?? '');
  const [baseUnit, setBaseUnit] = useState<BaseUnit>(food?.base_unit ?? 'g');
  const [rows, setRows] = useState<ServingRow[]>(() =>
    (food?.servings ?? []).map((s) => ({ key: uuid(), label: stripAmount(s.label), amount: numText(s.amount, 2) })),
  );
  // What the numbers below describe: "100" (per 100 g/mL) or the key of a serving row.
  const [basis, setBasis] = useState('100');
  const [values, setValues] = useState<Values>(() => {
    const v = {} as Values;
    for (const f of FIELDS) {
      const stored = food ? food[f.key] : null;
      v[f.key] = stored === null || stored === undefined ? '' : numText(f.key === 'kcal' ? energyValue(stored) : stored, f.key === 'kcal' || f.key === 'sodium' ? 0 : 2);
    }
    return v;
  });
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const u = baseUnitLabel(baseUnit);
  const requireEnergy = !food || food.source === 'custom';

  // ---- validation ------------------------------------------------------------------

  const errors: Record<string, string> = {};
  if (name.trim() === '') errors.name = 'Give the food a name.';
  const cleanBarcode = code.replace(/\s+/g, '');
  if (cleanBarcode !== '' && !/^\d{6,14}$/.test(cleanBarcode)) errors.barcode = 'A barcode is 6 to 14 digits.';

  const servings: { label: string; amount: number }[] = [];
  rows.forEach((r) => {
    const amount = parseNum(r.amount);
    if (amount === null || amount <= 0 || amount > 100000) {
      errors[`serving:${r.key}`] = `Enter the size in ${u}.`;
      return;
    }
    servings.push({ label: `${r.label.trim() || '1 serving'} (${numText(amount, 2)} ${u})`, amount });
  });

  const basisRow = rows.find((r) => r.key === basis);
  const basisAmount = basis === '100' ? 100 : parseNum(basisRow?.amount ?? '');

  const typed = {} as Record<NutrientKey, number | null>;
  for (const f of FIELDS) {
    const text = values[f.key].trim();
    if (text === '') {
      typed[f.key] = null;
      continue;
    }
    const n = parseNum(text);
    if (n === null || n < 0) {
      errors[f.key] = 'Enter a number, or leave it blank.';
      typed[f.key] = null;
    } else {
      typed[f.key] = f.key === 'kcal' ? toKcal(n) : n;
    }
  }
  if (requireEnergy && typed.kcal === null && !errors.kcal) errors.kcal = 'Energy is needed.';

  let per100 = typed;
  if (basisAmount !== null && basisAmount > 0) {
    per100 = (basis === '100' ? typed : per100FromServing(typed, basisAmount)) as Record<NutrientKey, number | null>;
    for (const problem of nutritionProblems(per100) as { field: NutrientKey; message: string }[]) {
      if (!errors[problem.field]) errors[problem.field] = problem.message;
    }
  }
  const hasErrors = Object.keys(errors).length > 0;

  // ---- save ---------------------------------------------------------------------------

  const save = async () => {
    setShowErrors(true);
    setServerError(null);
    if (hasErrors) {
      toastError('Some details need fixing first.');
      return;
    }
    const input = {
      name: name.trim(),
      brand: brand.trim() || null,
      barcode: cleanBarcode || null,
      base_unit: baseUnit,
      nutrition: per100,
      servings,
    };
    setBusy(true);
    try {
      const saved = food ? await saveFood(food.id, input) : await createFood(newId, input);
      if (onSaved) {
        onSaved(saved);
      } else {
        nav.pop();
        toast(editing ? 'Food updated' : 'Food created');
      }
    } catch (err) {
      setServerError(errorMessage(err));
      if (!(err instanceof ApiError)) toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const show = (key: string) => (showErrors ? (errors[key] ?? null) : null);

  const basisLabel = basis === '100' ? `100 ${u}` : `${basisRow?.label.trim() || '1 serving'}${basisAmount ? ` (${numText(basisAmount, 2)} ${u})` : ''}`;

  return (
    <Page
      title={editing ? 'Edit food' : 'Create a food'}
      backIcon="close"
      footer={
        <Button block busy={busy} onClick={() => void save()}>
          {editing ? 'Save changes' : 'Save food'}
        </Button>
      }
    >
      <div className="space-y-4">
        {barcode && !editing && (
          <Notice>
            Barcode {barcode} is not in the online database. Fill in the details from the pack once, and it will be found next time you
            scan it.
          </Notice>
        )}
        {serverError && <Notice tone="warn">{serverError}</Notice>}

        <Card className="space-y-4 p-4">
          <Field label="Name" error={show('name')}>
            <TextInput aria-label="Name" value={name} maxLength={120} autoFocus={!editing && !barcode} placeholder="e.g. Sourdough toast" onChange={(e) => setName(e.target.value)} />
          </Field>
          <Field label="Brand (optional)">
            <TextInput aria-label="Brand" value={brand} maxLength={80} onChange={(e) => setBrand(e.target.value)} />
          </Field>
          <Field label="Barcode (optional)" error={show('barcode')}>
            <TextInput aria-label="Barcode" inputMode="numeric" value={code} maxLength={16} onChange={(e) => setCode(e.target.value.replace(/[^\d\s]/g, ''))} />
          </Field>
          <Field label="Measured in">
            <Segmented
              label="Measured in"
              value={baseUnit}
              onChange={setBaseUnit}
              options={[
                { value: 'g', label: 'Grams (solid food)' },
                { value: 'ml', label: 'Millilitres (drinks)' },
              ]}
            />
          </Field>
        </Card>

        <Card className="p-4">
          <h2 className="font-semibold">Serving sizes</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            Optional. You can always log by weight ({u}) or per 100 {u}. Add sizes you use often, such as “1 slice” or “1 cup”.
          </p>
          <div className="mt-3 space-y-3">
            {rows.map((r) => (
              <div key={r.key} className="flex items-start gap-2">
                <Field className="min-w-0 flex-[3]" label="Name">
                  <TextInput
                    aria-label="Serving name"
                    value={r.label}
                    maxLength={40}
                    placeholder="1 serving"
                    onChange={(e) => setRows(rows.map((x) => (x.key === r.key ? { ...x, label: e.target.value } : x)))}
                  />
                </Field>
                <Field className="min-w-0 flex-[2]" label="Size" error={show(`serving:${r.key}`)}>
                  <NumInput
                    aria-label="Serving size"
                    value={r.amount}
                    suffix={u}
                    onChange={(amount) => setRows(rows.map((x) => (x.key === r.key ? { ...x, amount } : x)))}
                  />
                </Field>
                <IconButton
                  label="Remove this serving size"
                  className="mt-6 text-danger"
                  onClick={() => {
                    setRows(rows.filter((x) => x.key !== r.key));
                    if (basis === r.key) setBasis('100');
                  }}
                >
                  <Trash2 size={20} />
                </IconButton>
              </div>
            ))}
          </div>
          <Button variant="soft" size="sm" className="mt-3" onClick={() => setRows([...rows, { key: uuid(), label: '', amount: '' }])}>
            <Plus size={18} aria-hidden /> Add a serving size
          </Button>
        </Card>

        <Card className="space-y-4 p-4">
          <div>
            <h2 className="font-semibold">Nutrition</h2>
            <p className="mt-0.5 text-[13px] text-muted">Copy the numbers from the label. Leave a box blank if you do not know it.</p>
          </div>
          <Field label="These numbers are for">
            <SelectInput aria-label="These numbers are for" value={basis} onChange={(e) => setBasis(e.target.value)}>
              <option value="100">100 {u}</option>
              {rows.map((r) => {
                const amount = parseNum(r.amount);
                return (
                  <option key={r.key} value={r.key} disabled={amount === null || amount <= 0}>
                    {r.label.trim() || '1 serving'}
                    {amount ? ` (${numText(amount, 2)} ${u})` : ' (enter its size first)'}
                  </option>
                );
              })}
            </SelectInput>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <Field key={f.key} label={`${f.label}${f.optional ? ' (optional)' : ''}`} error={show(f.key)} className={errors[f.key] && showErrors ? 'col-span-2' : undefined}>
                <NumInput
                  aria-label={f.label}
                  value={values[f.key]}
                  decimal={f.key !== 'sodium'}
                  suffix={f.key === 'kcal' ? unit : NUTRIENT_INFO[f.key].unit}
                  invalid={Boolean(show(f.key))}
                  onChange={(text) => setValues({ ...values, [f.key]: text })}
                />
              </Field>
            ))}
          </div>
          <p className="text-[13px] text-muted">Per {basisLabel}. Stored per 100 {u}, so any serving size works later.</p>
        </Card>
      </div>
    </Page>
  );
}
