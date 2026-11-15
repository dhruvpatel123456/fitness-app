// Choosing how much of a food: a serving unit and a quantity, with the
// nutrition updating as you type.

import { useMemo, useState } from 'react';
import { NUTRIENT_INFO, baseUnitLabel, scaleNutrition, unitOptions } from '../../shared/nutrition.js';
import { useApp } from '../lib/app';
import { fmt, fmtG, numText, parseNum } from '../lib/format';
import type { BaseUnit, NutrientKey, Nutrients, Serving } from '../types';
import { Field, NumInput, SelectInput, cx } from './ui';

type UnitOption = { key: string; label: string; amount: number };

export type ServingChoice = {
  options: UnitOption[];
  unit: UnitOption;
  quantityText: string;
  /** The quantity as a number, or null while it is empty or not valid. */
  quantity: number | null;
  /** Total grams / mL, or null while not valid. */
  amount: number | null;
  valid: boolean;
  setUnit: (key: string) => void;
  setQuantity: (text: string) => void;
  baseUnit: BaseUnit;
};

/**
 * State for a serving picker. `initial` is the serving to start on (for
 * example the one used last time).
 */
export function useServing(
  food: { base_unit: BaseUnit; servings: Serving[] },
  initial: { label: string; amount: number; quantity: number },
): ServingChoice {
  const options = useMemo(() => {
    const list: UnitOption[] = unitOptions(food);
    // The starting unit may no longer be one of the food's servings; keep it available.
    if (!list.some((o) => o.label === initial.label && o.amount === initial.amount)) {
      list.splice(1, 0, { key: `x:${initial.label}:${initial.amount}`, label: initial.label, amount: initial.amount });
    }
    return list;
    // The options depend only on the food and the starting unit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [food.base_unit, JSON.stringify(food.servings), initial.label, initial.amount]);

  const [unitKey, setUnitKey] = useState(
    () => options.find((o) => o.label === initial.label && o.amount === initial.amount)?.key ?? options[0].key,
  );
  const [quantityText, setQuantityText] = useState(() => numText(initial.quantity, 2));

  const unit = options.find((o) => o.key === unitKey) ?? options[0];
  const quantity = parseNum(quantityText);
  const valid = quantity !== null && quantity > 0 && quantity <= 10000 && unit.amount * quantity <= 100000;

  const setUnit = (key: string) => {
    const next = options.find((o) => o.key === key);
    if (!next || next.key === unit.key) return;
    // Switching to grams (or per 100 g) keeps the same total; switching to a named serving starts at 1.
    const total = quantity !== null && quantity > 0 ? unit.amount * quantity : null;
    if (next.key === 'base1' && total !== null) setQuantityText(numText(total, 1));
    else if (next.key === 'base100' && total !== null) setQuantityText(numText(total / 100, 2));
    else setQuantityText('1');
    setUnitKey(key);
  };

  return {
    options,
    unit,
    quantityText,
    quantity,
    amount: valid && quantity !== null ? unit.amount * quantity : null,
    valid,
    setUnit,
    setQuantity: setQuantityText,
    baseUnit: food.base_unit,
  };
}

export function ServingFields({ serving, autoFocus }: { serving: ServingChoice; autoFocus?: boolean }) {
  const u = baseUnitLabel(serving.baseUnit);
  const isBase = serving.unit.key === 'base1';
  return (
    <div className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-3">
      <Field label={isBase ? `Amount (${u})` : 'How many'} error={serving.quantityText !== '' && !serving.valid ? 'Enter an amount above 0' : null}>
        <NumInput
          aria-label={isBase ? `Amount in ${u}` : 'Number of servings'}
          value={serving.quantityText}
          onChange={serving.setQuantity}
          autoFocus={autoFocus}
          invalid={serving.quantityText !== '' && !serving.valid}
        />
      </Field>
      <Field label="Serving size">
        <SelectInput aria-label="Serving size" value={serving.unit.key} onChange={(e) => serving.setUnit(e.target.value)}>
          {serving.options.map((o) => (
            <option key={o.key} value={o.key}>
              {o.key === 'base1' ? `${u} (type the amount)` : o.label}
            </option>
          ))}
        </SelectInput>
      </Field>
    </div>
  );
}

const EXTRA: NutrientKey[] = ['fibre', 'sugar', 'sat_fat', 'sodium'];

/** Energy and macros for an amount, then the other nutrients. Unknown values are labelled. */
export function NutritionSummary({ per100, amount, className }: { per100: Nutrients; amount: number | null; className?: string }) {
  const { energy, unit } = useApp();
  const n = amount === null ? null : (scaleNutrition(per100, amount) as Nutrients);
  const tile = (label: string, value: string, color?: string) => (
    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-2 py-2.5 text-center">
      <div className="tabular truncate text-[18px] font-bold leading-tight" style={color ? { color } : undefined}>
        {value}
      </div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
  const show = (key: NutrientKey) => {
    if (!n) return '–';
    const v = n[key];
    if (v === null) return '?';
    return key === 'kcal' ? energy(v) : key === 'sodium' ? fmt(v, 0) : fmtG(v);
  };
  const unknownMain = (['kcal', 'protein', 'carbs', 'fat'] as NutrientKey[]).filter((k) => per100[k] === null);
  return (
    <div className={className}>
      <div className="flex gap-2">
        {tile(unit, show('kcal'), 'var(--primary)')}
        {tile('Protein g', show('protein'), 'var(--protein)')}
        {tile('Carbs g', show('carbs'), 'var(--carbs)')}
        {tile('Fat g', show('fat'), 'var(--fat)')}
      </div>
      {unknownMain.length > 0 && (
        <p className="mt-2 text-[13px] text-muted">
          ? = not known for this food ({unknownMain.map((k) => NUTRIENT_INFO[k].label.toLowerCase()).join(', ')}). It is left out of
          your totals rather than counted as zero. You can add it by editing the food.
        </p>
      )}
      <dl className="mt-3 divide-y divide-line rounded-xl border border-line text-[15px]">
        {EXTRA.map((key) => (
          <div key={key} className="flex items-center justify-between px-3 py-2">
            <dt className="text-muted">{NUTRIENT_INFO[key].label}</dt>
            <dd className={cx('tabular font-medium', per100[key] === null && 'text-muted')}>
              {per100[key] === null ? 'unknown' : `${show(key)} ${NUTRIENT_INFO[key].unit}`}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function MealSelect({ value, onChange, label = 'Meal' }: { value: number; onChange: (meal: number) => void; label?: string }) {
  const { boot } = useApp();
  return (
    <Field label={label}>
      <SelectInput aria-label={label} value={value} onChange={(e) => onChange(Number(e.target.value))}>
        {boot.settings.meal_names.map((name, i) => (
          <option key={i} value={i}>
            {name}
          </option>
        ))}
      </SelectInput>
    </Field>
  );
}
