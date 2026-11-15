// Log exercise: pick an activity (calories are estimated from its MET value,
// your weight and the time) or type your own.

import { useMemo, useState } from 'react';
import { ACTIVITIES, exerciseKcal, findActivity } from '../../shared/activities.js';
import { Button, Field, NumInput, SelectInput, Sheet, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { fmt, numText, parseNum } from '../lib/format';
import { useStableId } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { deleteExercise, saveExercise } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { Exercise } from '../types';

const CUSTOM = 'custom';

export function ExerciseSheet({ date, existing }: { date: string; existing?: Exercise }) {
  const nav = useNav();
  const { boot, unit, energyValue, toKcal } = useApp();
  const newId = useStableId(uuid);
  const weightKg = boot.latest_weight?.kg ?? 70;

  const [activity, setActivity] = useState(existing ? (findActivity(existing.activity_key ?? '') ? (existing.activity_key as string) : CUSTOM) : 'walk');
  const [name, setName] = useState(existing && !findActivity(existing.activity_key ?? '') ? existing.name : '');
  const [minutes, setMinutes] = useState(existing ? numText(existing.minutes, 0) : '30');
  // Empty means "use the estimate"; typing a number overrides it.
  const [energyText, setEnergyText] = useState(existing ? numText(energyValue(existing.kcal), 0) : '');
  const [overridden, setOverridden] = useState(Boolean(existing));
  const [busy, setBusy] = useState(false);

  const chosen = activity === CUSTOM ? null : findActivity(activity);
  const mins = parseNum(minutes);
  const estimate = useMemo(
    () => (chosen && mins !== null && mins > 0 ? exerciseKcal(chosen.met, weightKg, mins) : null),
    [chosen, mins, weightKg],
  );

  const typed = parseNum(energyText);
  const kcal = overridden || estimate === null ? (typed === null ? null : toKcal(typed)) : estimate;
  const minutesOk = mins !== null && mins > 0 && mins <= 1440;
  const nameOk = chosen !== null || name.trim() !== '';
  const kcalOk = kcal !== null && kcal >= 0 && kcal <= 20000;
  const valid = minutesOk && nameOk && kcalOk;

  const save = async () => {
    if (!valid || mins === null || kcal === null) return;
    setBusy(true);
    try {
      await saveExercise(
        {
          id: existing?.id ?? newId,
          date,
          name: chosen ? chosen.name : name.trim(),
          activity_key: chosen ? chosen.key : null,
          minutes: mins,
          kcal,
        },
        !existing,
      );
      nav.pop();
      if (!existing) toast('Exercise added');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!existing) return;
    try {
      await deleteExercise(existing.id);
      nav.pop();
      toast(`Removed ${existing.name}`, {
        action: {
          label: 'Undo',
          run: () => {
            saveExercise(existing, true).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  return (
    <Sheet
      title={existing ? 'Edit exercise' : 'Add exercise'}
      footer={
        <div className="flex gap-3">
          {existing && (
            <Button variant="secondary" className="text-danger" onClick={() => void remove()}>
              Delete
            </Button>
          )}
          <Button className="flex-1" busy={busy} disabled={!valid} onClick={() => void save()}>
            {existing ? 'Save' : 'Add to diary'}
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        <Field label="Activity">
          <SelectInput
            aria-label="Activity"
            value={activity}
            onChange={(e) => {
              setActivity(e.target.value);
              // A new activity means a new estimate, unless a number was typed.
              if (!existing) {
                setOverridden(false);
                setEnergyText('');
              }
            }}
          >
            {ACTIVITIES.map((a: { key: string; name: string }) => (
              <option key={a.key} value={a.key}>
                {a.name}
              </option>
            ))}
            <option value={CUSTOM}>Something else…</option>
          </SelectInput>
        </Field>
        {activity === CUSTOM && (
          <Field label="What did you do?">
            <TextInput aria-label="Exercise name" value={name} maxLength={80} placeholder="e.g. Reformer class" onChange={(e) => setName(e.target.value)} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time" error={minutes !== '' && !minutesOk ? '1 to 1,440 min' : null}>
            <NumInput aria-label="Minutes" value={minutes} onChange={setMinutes} decimal={false} suffix="min" />
          </Field>
          <Field label={`Energy burned (${unit})`}>
            <NumInput
              aria-label="Energy burned"
              value={overridden || estimate === null ? energyText : numText(energyValue(estimate), 0)}
              onChange={(text) => {
                setOverridden(true);
                setEnergyText(text);
              }}
              decimal={false}
              suffix={unit}
            />
          </Field>
        </div>
        {chosen && (
          <div className="rounded-xl bg-surface-2 px-3 py-2.5 text-[13px] leading-snug text-muted">
            {estimate !== null && (
              <>
                Estimate: {fmt(energyValue(estimate))} {unit} for {fmt(mins ?? 0)} min at {fmt(weightKg, 1)} kg (MET {chosen.met}).{' '}
              </>
            )}
            {overridden && estimate !== null ? (
              <button
                type="button"
                className="font-semibold text-primary underline underline-offset-2"
                onClick={() => {
                  setOverridden(false);
                  setEnergyText('');
                }}
              >
                Use the estimate
              </button>
            ) : (
              'Type over the number if your watch or machine gave a different figure.'
            )}
          </div>
        )}
        {!boot.settings.exercise_adds_back && (
          <p className="text-[13px] text-muted">Exercise is recorded but not added back to your daily budget. You can change that in Settings.</p>
        )}
      </div>
    </Sheet>
  );
}
