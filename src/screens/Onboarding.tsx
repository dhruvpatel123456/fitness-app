// First-run questions: about you, your goal, then your daily targets.

import { useRef, useState } from 'react';
import {
  ACTIVITY_LEVELS,
  DEFAULT_MACRO_SPLIT,
  WEEKLY_GOALS,
  calorieTarget,
  macroGrams,
  minimumKcal,
} from '../../shared/goals.js';
import { LowTargetWarning } from '../components/LowTargetWarning';
import { TargetFields, draftFromTargets, draftWithEnergy, readDraft, type TargetDraft } from '../components/TargetFields';
import { Button, Card, Field, Notice, NumInput, Segmented, cx } from '../components/ui';
import { ApiError, errorMessage, post, put } from '../lib/api';
import { useApp } from '../lib/app';
import { fmt, parseNum } from '../lib/format';
import { queryClient } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import type { Bootstrap, Sex } from '../types';

type Answers = {
  sex: Sex | '';
  age: string;
  height: string;
  weight: string;
  goalWeight: string;
  weeklyGoal: number | null;
  activity: string;
};

function between(text: string, min: number, max: number): number | null {
  const n = parseNum(text);
  return n !== null && n >= min && n <= max ? n : null;
}

export function Onboarding() {
  const { today, unit, energy } = useApp();
  const [step, setStep] = useState(0);
  const [a, setA] = useState<Answers>({ sex: '', age: '', height: '', weight: '', goalWeight: '', weeklyGoal: null, activity: '' });
  const [showErrors, setShowErrors] = useState(false);
  const [draft, setDraft] = useState<TargetDraft | null>(null);
  const [confirmLow, setConfirmLow] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const age = between(a.age, 13, 120);
  const height = between(a.height, 100, 250);
  const weight = between(a.weight, 25, 400);
  const goalWeight = between(a.goalWeight, 25, 400);
  const ageOk = age !== null && Number.isInteger(age);

  const stepValid = [
    a.sex !== '' && ageOk && height !== null && weight !== null,
    goalWeight !== null && a.weeklyGoal !== null && a.activity !== '',
    true,
  ];

  const calc =
    a.sex !== '' && ageOk && height !== null && weight !== null && a.weeklyGoal !== null && a.activity !== ''
      ? calorieTarget({ sex: a.sex, weightKg: weight, heightCm: height, age: age as number, activity: a.activity, weeklyGoalKg: a.weeklyGoal })
      : null;

  const next = () => {
    if (!stepValid[step]) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    if (step === 1 && calc) {
      const kcal = Math.max(500, calc.suggested);
      setDraft(draftFromTargets({ kcal, ...macroGrams(kcal, DEFAULT_MACRO_SPLIT) }, 'percent', unit));
      setConfirmLow(false);
    }
    setStep(step + 1);
  };

  const pickGoalWeight = (text: string) => {
    const gw = between(text, 25, 400);
    let weeklyGoal = a.weeklyGoal;
    // Suggest a direction the first time a goal weight is entered.
    if (weeklyGoal === null && gw !== null && weight !== null) {
      weeklyGoal = gw < weight - 0.5 ? -0.5 : gw > weight + 0.5 ? 0.25 : 0;
    }
    setA({ ...a, goalWeight: text, weeklyGoal });
  };

  const read = draft ? readDraft(draft, unit) : { targets: null, error: null };
  const minimum = a.sex ? minimumKcal(a.sex) : 1200;
  const isLow = read.targets !== null && read.targets.kcal < minimum;

  const finish = async () => {
    if (!read.targets || a.sex === '' || !ageOk || height === null || weight === null || goalWeight === null || a.weeklyGoal === null) {
      setShowErrors(true);
      return;
    }
    if (isLow && !confirmLow) {
      toastError('Tick the box to confirm the low target, or use the minimum.');
      return;
    }
    setBusy(true);
    try {
      const boot = await put<Bootstrap>('/onboarding', {
        today,
        profile: {
          sex: a.sex,
          age,
          height_cm: height,
          goal_weight_kg: goalWeight,
          activity: a.activity,
          weekly_goal_kg: a.weeklyGoal,
        },
        weight_kg: weight,
        targets: read.targets,
        confirm_low: isLow ? true : undefined,
      });
      queryClient.setQueryData(['bootstrap'], boot);
      void queryClient.invalidateQueries({ queryKey: ['weights'] });
      toast('All set. Welcome!');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const restore = async (file: File) => {
    setBusy(true);
    try {
      const data = JSON.parse(await file.text());
      await post('/import', { data, confirm: true });
      await queryClient.invalidateQueries();
      toast('Your data has been restored.');
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : 'That file could not be read as an export.');
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const err = (bad: boolean, message: string) => (showErrors && bad ? message : null);

  return (
    <div className="scroll-area pt-safe pb-safe px-safe h-full">
      <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-6">
        <div className="mb-5 flex items-center gap-2" aria-label={`Step ${step + 1} of 3`}>
          {[0, 1, 2].map((i) => (
            <span key={i} className={cx('h-1.5 flex-1 rounded-full', i <= step ? 'bg-primary' : 'bg-line')} />
          ))}
        </div>

        {step === 0 && (
          <>
            <h1 className="text-2xl font-bold">About you</h1>
            <p className="mb-5 mt-1 text-muted">This is used to work out how much energy your body uses in a day.</p>
            <Card className="space-y-4 p-4">
              <Field label="Sex (used in the energy formula)" error={err(a.sex === '', 'Choose one.')}>
                <Segmented
                  label="Sex"
                  value={a.sex}
                  onChange={(sex) => setA({ ...a, sex: sex as Sex })}
                  options={[
                    { value: 'male', label: 'Male' },
                    { value: 'female', label: 'Female' },
                  ]}
                />
              </Field>
              <Field label="Age" error={err(!ageOk, 'Enter your age in years (13 to 120).')}>
                <NumInput aria-label="Age" value={a.age} onChange={(age) => setA({ ...a, age })} decimal={false} suffix="years" />
              </Field>
              <Field label="Height" error={err(height === null, 'Enter your height in centimetres (100 to 250).')}>
                <NumInput aria-label="Height" value={a.height} onChange={(height) => setA({ ...a, height })} suffix="cm" />
              </Field>
              <Field label="Current weight" error={err(weight === null, 'Enter your weight in kilograms (25 to 400).')}>
                <NumInput aria-label="Current weight" value={a.weight} onChange={(weight) => setA({ ...a, weight })} suffix="kg" />
              </Field>
            </Card>
            <Button block className="mt-5" onClick={next}>
              Next
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void restore(file);
              }}
            />
            <Button variant="ghost" block className="mt-2" busy={busy} onClick={() => fileInput.current?.click()}>
              Restore from an export file instead
            </Button>
          </>
        )}

        {step === 1 && (
          <>
            <h1 className="text-2xl font-bold">Your goal</h1>
            <p className="mb-5 mt-1 text-muted">You can change any of this later in Settings.</p>
            <Card className="space-y-4 p-4">
              <Field label="Goal weight" error={err(goalWeight === null, 'Enter a goal weight in kilograms (25 to 400).')}>
                <NumInput aria-label="Goal weight" value={a.goalWeight} onChange={pickGoalWeight} suffix="kg" />
              </Field>
              <fieldset>
                <legend className="mb-1 text-[13px] font-medium text-muted">Weekly goal</legend>
                <div className="overflow-hidden rounded-xl border border-line">
                  {WEEKLY_GOALS.map((g) => (
                    <label key={g.kg} className={cx('flex min-h-12 cursor-pointer items-center gap-3 border-b border-line px-3 last:border-b-0', a.weeklyGoal === g.kg && 'bg-primary-soft')}>
                      <input type="radio" name="weekly" className="h-5 w-5 accent-[var(--primary)]" checked={a.weeklyGoal === g.kg} onChange={() => setA({ ...a, weeklyGoal: g.kg })} />
                      <span className="font-medium">{g.label}</span>
                    </label>
                  ))}
                </div>
                {err(a.weeklyGoal === null, 'x') && <p className="mt-1 text-[13px] font-medium text-danger">Choose a weekly goal.</p>}
              </fieldset>
              <fieldset>
                <legend className="mb-1 text-[13px] font-medium text-muted">How active is a normal day?</legend>
                <div className="overflow-hidden rounded-xl border border-line">
                  {ACTIVITY_LEVELS.map((level) => (
                    <label key={level.key} className={cx('flex min-h-14 cursor-pointer items-center gap-3 border-b border-line px-3 py-2 last:border-b-0', a.activity === level.key && 'bg-primary-soft')}>
                      <input type="radio" name="activity" className="h-5 w-5 shrink-0 accent-[var(--primary)]" checked={a.activity === level.key} onChange={() => setA({ ...a, activity: level.key })} />
                      <span>
                        <span className="block font-medium">{level.label}</span>
                        <span className="block text-[13px] text-muted">{level.detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
                {err(a.activity === '', 'x') && <p className="mt-1 text-[13px] font-medium text-danger">Choose an activity level.</p>}
              </fieldset>
            </Card>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setStep(0)}>
                Back
              </Button>
              <Button className="flex-[2]" onClick={next}>
                Next
              </Button>
            </div>
          </>
        )}

        {step === 2 && calc && draft && (
          <>
            <h1 className="text-2xl font-bold">Your daily targets</h1>
            <p className="mb-5 mt-1 text-muted">Worked out from your answers. Adjust anything you like.</p>
            <Card className="p-4">
              <dl className="space-y-2 text-[15px]">
                <div className="flex justify-between">
                  <dt className="text-muted">Energy your body uses at rest (BMR)</dt>
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
                  <dt className="text-muted">
                    {calc.delta === 0 ? 'To maintain your weight' : calc.delta < 0 ? `To lose ${fmt(Math.abs(a.weeklyGoal ?? 0), 2)} kg a week` : `To gain ${fmt(a.weeklyGoal ?? 0, 2)} kg a week`}
                  </dt>
                  <dd className="tabular font-semibold">
                    {calc.delta === 0 ? '±0' : `${calc.delta < 0 ? '−' : '+'}${energy(Math.abs(calc.delta))}`} {unit}
                  </dd>
                </div>
                <div className="flex justify-between border-t border-line pt-2 text-base">
                  <dt className="font-semibold">Suggested daily target</dt>
                  <dd className="tabular font-bold text-primary">
                    {energy(calc.suggested)} {unit}
                  </dd>
                </div>
              </dl>
            </Card>

            <Card className="mt-4 p-4">
              <TargetFields draft={draft} onChange={(d) => { setDraft(d); setConfirmLow(false); }} unit={unit} />
              {read.error && <p className="mt-3 text-[14px] font-medium text-danger">{read.error}</p>}
            </Card>

            {isLow && read.targets && (
              <div className="mt-4">
                <LowTargetWarning
                  kcal={read.targets.kcal}
                  minimum={minimum}
                  sex={a.sex as Sex}
                  confirmed={confirmLow}
                  onConfirm={setConfirmLow}
                  onUseMinimum={() => {
                    setDraft(draftWithEnergy(draft, minimum, unit));
                    setConfirmLow(false);
                  }}
                />
              </div>
            )}
            {!isLow && calc.belowMinimum && (
              <div className="mt-4">
                <Notice>Your chosen rate would mean eating very little, so the target here has been kept sensible. A slower weekly goal may be easier to stick to.</Notice>
              </div>
            )}

            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={() => setStep(1)}>
                Back
              </Button>
              <Button className="flex-[2]" busy={busy} disabled={!read.targets} onClick={finish}>
                Start tracking
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
