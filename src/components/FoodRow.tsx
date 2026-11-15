// One food in a list: name, brand, the default serving and its energy, and
// a one-tap "+" (or a tick box in multi-add mode).

import { Check, Plus, Star } from 'lucide-react';
import type { ReactNode } from 'react';
import { defaultServing, describeServing, scaleNutrition } from '../../shared/nutrition.js';
import { useApp } from '../lib/app';
import type { BaseUnit, Nutrients, Serving } from '../types';
import { Spinner, cx } from './ui';

export type RowFood = Nutrients & {
  name: string;
  brand: string | null;
  base_unit: BaseUnit;
  servings: Serving[];
  last?: { label: string; amount: number; quantity: number } | null;
  is_favourite?: boolean;
};

export function FoodRow({
  food,
  tag,
  onOpen,
  onQuick,
  quickLabel,
  busy,
  selectable,
  selected,
}: {
  food: RowFood;
  tag?: ReactNode;
  onOpen: () => void;
  /** One-tap add with the default serving. */
  onQuick?: () => void;
  quickLabel?: string;
  busy?: boolean;
  /** Multi-add mode: the row shows a tick box and tapping it selects. */
  selectable?: boolean;
  selected?: boolean;
}) {
  const { energy, unit } = useApp();
  const d = defaultServing(food);
  const kcal = scaleNutrition(food, d.amount * d.quantity).kcal;
  const detail = [food.brand, describeServing(d.label, d.amount, d.quantity, food.base_unit)].filter(Boolean).join(' · ');

  return (
    <div className="flex min-h-15 items-stretch">
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-3 py-2 pl-4 pr-2 text-left active:bg-surface-2">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            {food.is_favourite && <Star size={14} className="shrink-0 fill-current text-carbs" aria-label="Favourite" />}
            <span className="truncate text-[15px] font-medium">{food.name}</span>
            {tag}
          </span>
          <span className="block truncate text-[13px] text-muted">{detail}</span>
        </span>
        <span className="tabular shrink-0 text-right text-[14px] font-semibold">
          {kcal === null ? '?' : energy(kcal)}
          <span className="ml-1 text-[11px] font-medium text-muted">{unit}</span>
        </span>
      </button>
      {selectable ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={Boolean(selected)}
          aria-label={`Select ${food.name}`}
          onClick={onOpen}
          className="flex w-14 shrink-0 items-center justify-center"
        >
          <span
            className={cx(
              'flex h-7 w-7 items-center justify-center rounded-lg border-2',
              selected ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
            )}
          >
            {busy ? <Spinner size={16} /> : selected && <Check size={18} strokeWidth={3} />}
          </span>
        </button>
      ) : (
        onQuick && (
          <button
            type="button"
            aria-label={quickLabel ?? `Add ${food.name}`}
            disabled={busy}
            onClick={onQuick}
            className="flex w-14 shrink-0 items-center justify-center disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-soft text-primary active:opacity-70">
              {busy ? <Spinner size={18} className="text-primary" /> : <Plus size={22} strokeWidth={2.4} />}
            </span>
          </button>
        )
      )}
    </div>
  );
}

export function Pill({ children }: { children: ReactNode }) {
  return <span className="shrink-0 rounded-md bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-muted">{children}</span>;
}
