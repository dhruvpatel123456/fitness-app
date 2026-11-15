// Shown when a calorie target is under the usual minimum (1,500 kcal for men,
// 1,200 kcal for women). The target can only be saved after confirming.

import { TriangleAlert } from 'lucide-react';
import { useApp } from '../lib/app';
import type { Sex } from '../types';
import { Button } from './ui';

export function LowTargetWarning({
  kcal,
  minimum,
  sex,
  confirmed,
  onConfirm,
  onUseMinimum,
}: {
  kcal: number;
  minimum: number;
  sex: Sex;
  confirmed: boolean;
  onConfirm: (value: boolean) => void;
  onUseMinimum?: () => void;
}) {
  const { energy, unit } = useApp();
  return (
    <div className="rounded-2xl border border-danger/40 bg-danger-soft p-4" role="alert">
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 shrink-0 text-danger" size={22} aria-hidden />
        <div className="text-[15px] leading-snug">
          <p className="font-semibold">
            {energy(kcal)} {unit} a day is very low
          </p>
          <p className="mt-1">
            The usual minimum for {sex === 'female' ? 'women' : 'men'} is {energy(minimum)} {unit} a day. Eating less than that for
            long makes it hard to get enough nutrients, and is best done with advice from a doctor or dietitian.
          </p>
        </div>
      </div>
      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          className="h-6 w-6 shrink-0 accent-[var(--danger)]"
          checked={confirmed}
          onChange={(e) => onConfirm(e.target.checked)}
        />
        <span className="font-medium">I understand, and want to use this target anyway</span>
      </label>
      {onUseMinimum && (
        <Button variant="secondary" size="sm" className="mt-2 bg-surface" onClick={onUseMinimum}>
          Use {energy(minimum)} {unit} instead
        </Button>
      )}
    </div>
  );
}
