// Editing a calorie target and its macro split, as percentages or grams.

import { KCAL_PER_GRAM, macroGrams, macroSplitFromGrams } from '../../shared/goals.js';
import { energyValue, fmt, numText, parseNum, toKcal } from '../lib/format';
import type { EnergyUnit, TargetSet } from '../types';
import { Field, NumInput, Segmented, cx } from './ui';

type Three = { protein: string; carbs: string; fat: string };

export type TargetDraft = {
  /** Energy as typed, in the user's unit (kcal or kJ). */
  energy: string;
  mode: 'percent' | 'grams';
  pct: Three;
  grams: Three;
};

const MACROS = [
  { key: 'protein', label: 'Protein', color: 'var(--protein)' },
  { key: 'carbs', label: 'Carbs', color: 'var(--carbs)' },
  { key: 'fat', label: 'Fat', color: 'var(--fat)' },
] as const;

/** Whole-number percentages that add up to exactly 100. */
function roundSplit(split: { protein: number; carbs: number; fat: number }) {
  const out = { protein: Math.round(split.protein), carbs: Math.round(split.carbs), fat: Math.round(split.fat) };
  const diff = 100 - (out.protein + out.carbs + out.fat);
  if (diff !== 0 && out.protein + out.carbs + out.fat > 0) {
    const largest = (Object.keys(out) as (keyof typeof out)[]).sort((a, b) => out[b] - out[a])[0];
    out[largest] += diff;
  }
  return out;
}

export function draftFromTargets(t: TargetSet, mode: 'percent' | 'grams', unit: EnergyUnit): TargetDraft {
  const split = roundSplit(macroSplitFromGrams(t.kcal, t));
  return {
    energy: numText(energyValue(t.kcal, unit), 0),
    mode,
    pct: { protein: String(split.protein), carbs: String(split.carbs), fat: String(split.fat) },
    grams: { protein: numText(t.protein_g, 1), carbs: numText(t.carbs_g, 1), fat: numText(t.fat_g, 1) },
  };
}

/** A draft with a new energy value and the same percentage split. */
export function draftWithEnergy(draft: TargetDraft, kcal: number, unit: EnergyUnit): TargetDraft {
  return syncGrams({ ...draft, energy: numText(energyValue(kcal, unit), 0) }, unit);
}

/** In percent mode the gram fields follow the percentages. */
function syncGrams(draft: TargetDraft, unit: EnergyUnit): TargetDraft {
  if (draft.mode !== 'percent') return draft;
  const energy = parseNum(draft.energy);
  const p = parseNum(draft.pct.protein);
  const c = parseNum(draft.pct.carbs);
  const f = parseNum(draft.pct.fat);
  if (energy === null || p === null || c === null || f === null) return draft;
  const g = macroGrams(toKcal(energy, unit), { protein: p, carbs: c, fat: f });
  return { ...draft, grams: { protein: numText(g.protein_g, 1), carbs: numText(g.carbs_g, 1), fat: numText(g.fat_g, 1) } };
}

/** Read a draft. Gives the targets, or the reason they are not valid yet. */
export function readDraft(draft: TargetDraft, unit: EnergyUnit): { targets: TargetSet | null; error: string | null } {
  const energy = parseNum(draft.energy);
  if (energy === null || energy <= 0) return { targets: null, error: 'Enter a daily energy target.' };
  const kcal = toKcal(energy, unit);
  if (kcal < 500) return { targets: null, error: `The target must be at least ${fmt(energyValue(500, unit))} ${unit}.` };
  if (kcal > 15000) return { targets: null, error: 'That target is too high.' };

  if (draft.mode === 'percent') {
    const p = parseNum(draft.pct.protein);
    const c = parseNum(draft.pct.carbs);
    const f = parseNum(draft.pct.fat);
    if (p === null || c === null || f === null) return { targets: null, error: 'Enter a percentage for each macro.' };
    const total = p + c + f;
    if (Math.abs(total - 100) > 0.01) {
      return { targets: null, error: `The percentages add up to ${fmt(total, 1)}%. They need to add up to 100%.` };
    }
    // Stored unrounded: grams follow exactly from the target and the split.
    return { targets: { kcal, ...macroGrams(kcal, { protein: p, carbs: c, fat: f }) }, error: null };
  }
  const p = parseNum(draft.grams.protein);
  const c = parseNum(draft.grams.carbs);
  const f = parseNum(draft.grams.fat);
  if (p === null || c === null || f === null) return { targets: null, error: 'Enter grams for each macro.' };
  if (p > 2000 || c > 2000 || f > 2000) return { targets: null, error: 'Those gram targets are too high.' };
  return { targets: { kcal, protein_g: p, carbs_g: c, fat_g: f }, error: null };
}

export function TargetFields({
  draft,
  onChange,
  unit,
  energyLabel = 'Daily energy target',
}: {
  draft: TargetDraft;
  onChange: (draft: TargetDraft) => void;
  unit: EnergyUnit;
  energyLabel?: string;
}) {
  const energy = parseNum(draft.energy);
  const kcal = energy === null ? null : toKcal(energy, unit);
  const grams = {
    protein: parseNum(draft.grams.protein),
    carbs: parseNum(draft.grams.carbs),
    fat: parseNum(draft.grams.fat),
  };
  const pctTotal = (parseNum(draft.pct.protein) ?? 0) + (parseNum(draft.pct.carbs) ?? 0) + (parseNum(draft.pct.fat) ?? 0);
  const macroKcal =
    (grams.protein ?? 0) * KCAL_PER_GRAM.protein + (grams.carbs ?? 0) * KCAL_PER_GRAM.carbs + (grams.fat ?? 0) * KCAL_PER_GRAM.fat;

  const setMode = (mode: 'percent' | 'grams') => {
    if (mode === draft.mode) return;
    if (mode === 'percent' && kcal && grams.protein !== null && grams.carbs !== null && grams.fat !== null) {
      const split = roundSplit(macroSplitFromGrams(kcal, { protein_g: grams.protein, carbs_g: grams.carbs, fat_g: grams.fat }));
      onChange(
        syncGrams(
          { ...draft, mode, pct: { protein: String(split.protein), carbs: String(split.carbs), fat: String(split.fat) } },
          unit,
        ),
      );
      return;
    }
    onChange(syncGrams({ ...draft, mode }, unit));
  };

  return (
    <div className="space-y-4">
      <Field label={energyLabel}>
        <NumInput
          aria-label={energyLabel}
          value={draft.energy}
          decimal={false}
          suffix={unit}
          onChange={(text) => onChange(syncGrams({ ...draft, energy: text }, unit))}
        />
      </Field>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[13px] font-medium text-muted">Macros</span>
          <Segmented
            className="w-44"
            label="Set macros as"
            value={draft.mode}
            onChange={setMode}
            options={[
              { value: 'percent', label: '%' },
              { value: 'grams', label: 'grams' },
            ]}
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MACROS.map((m) => {
            const g = grams[m.key];
            const share = kcal && g !== null ? ((g * KCAL_PER_GRAM[m.key]) / kcal) * 100 : null;
            return (
              <div key={m.key}>
                <div className="mb-1 flex items-center gap-1.5 text-[13px] font-medium">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: m.color }} aria-hidden />
                  {m.label}
                </div>
                {draft.mode === 'percent' ? (
                  <NumInput
                    aria-label={`${m.label} percent`}
                    value={draft.pct[m.key]}
                    decimal={false}
                    suffix="%"
                    onChange={(text) => onChange(syncGrams({ ...draft, pct: { ...draft.pct, [m.key]: text } }, unit))}
                  />
                ) : (
                  <NumInput
                    aria-label={`${m.label} grams`}
                    value={draft.grams[m.key]}
                    suffix="g"
                    onChange={(text) => onChange({ ...draft, grams: { ...draft.grams, [m.key]: text } })}
                  />
                )}
                <div className="mt-1 text-[12px] text-muted tabular">
                  {draft.mode === 'percent' ? (g !== null ? `${fmt(g, 0)} g` : ' ') : share !== null ? `${fmt(share, 0)}%` : ' '}
                </div>
              </div>
            );
          })}
        </div>
        {draft.mode === 'percent' ? (
          <p className={cx('mt-1 text-[13px]', Math.abs(pctTotal - 100) > 0.01 ? 'font-medium text-danger' : 'text-muted')}>
            Total {fmt(pctTotal, 1)}%{Math.abs(pctTotal - 100) > 0.01 ? ' (needs to be 100%)' : ''}
          </p>
        ) : (
          kcal !== null && (
            <p className="mt-1 text-[13px] text-muted">
              These macros add up to {fmt(energyValue(macroKcal, unit))} {unit}
              {Math.abs(macroKcal - kcal) > 25 ? `, which is ${macroKcal > kcal ? 'above' : 'below'} your energy target.` : '.'}
            </p>
          )
        )}
      </div>
    </div>
  );
}
