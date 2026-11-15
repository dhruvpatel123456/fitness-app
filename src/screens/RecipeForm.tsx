// Recipes: add ingredients with amounts, say how many servings it makes, and
// the nutrition per serving is worked out for you. A saved recipe can be
// logged like any other food.
//
// Saved meals (a group of foods logged together) are edited here too.

import { useState } from 'react';
import { NUTRIENT_INFO, entryNutrition, recipeNutrition, sumNutrition } from '../../shared/nutrition.js';
import { ItemList, draftFromItem, itemInput, withAmount, type DraftItem } from '../components/ItemList';
import { Button, Card, Field, Loadable, Notice, NumInput, Page, TextInput } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { fmt, fmtG, numText, parseNum } from '../lib/format';
import { useStableId } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { createSavedMeal, deleteFood, deleteSavedMeal, restoreFood, saveRecipe, updateSavedMeal, useFood } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { Food, NutrientKey, Nutrients, SavedMeal } from '../types';

function Tiles({ values, caption }: { values: Nutrients; caption: string }) {
  const { energy, unit } = useApp();
  const tile = (label: string, value: string, color: string) => (
    <div className="min-w-0 flex-1 rounded-xl bg-surface-2 px-2 py-2.5 text-center">
      <div className="tabular truncate text-[18px] font-bold leading-tight" style={{ color }}>
        {value}
      </div>
      <div className="text-[11px] font-medium uppercase tracking-wide text-muted">{label}</div>
    </div>
  );
  const g = (v: number | null) => (v === null ? '?' : fmtG(v));
  return (
    <div>
      <p className="mb-2 text-[13px] font-medium text-muted">{caption}</p>
      <div className="flex gap-2">
        {tile(unit, values.kcal === null ? '?' : energy(values.kcal), 'var(--primary)')}
        {tile('Protein g', g(values.protein), 'var(--protein)')}
        {tile('Carbs g', g(values.carbs), 'var(--carbs)')}
        {tile('Fat g', g(values.fat), 'var(--fat)')}
      </div>
    </div>
  );
}

// ---- recipes ------------------------------------------------------------------------

export function RecipeForm({ recipeId }: { recipeId?: string }) {
  const existing = useFood(recipeId ?? null);
  if (!recipeId) return <RecipeEditor />;
  return existing.data ? (
    <RecipeEditor recipe={existing.data} />
  ) : (
    <Page title="Edit recipe" backIcon="close">
      <Loadable loading={existing.isPending} error={existing.isError ? existing.error : null} onRetry={() => existing.refetch()}>
        {null}
      </Loadable>
    </Page>
  );
}

function RecipeEditor({ recipe }: { recipe?: Food }) {
  const nav = useNav();
  const newId = useStableId(uuid);
  const id = recipe?.id ?? newId;
  const [name, setName] = useState(recipe?.name ?? '');
  const [servingsText, setServingsText] = useState(recipe?.recipe_servings ? numText(recipe.recipe_servings, 2) : '1');
  const [cookedText, setCookedText] = useState(recipe?.recipe_cooked_weight ? numText(recipe.recipe_cooked_weight, 0) : '');
  const [items, setItems] = useState<DraftItem[]>(() => (recipe?.ingredients ?? []).map(draftFromItem));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);

  const servings = parseNum(servingsText);
  const cooked = cookedText.trim() === '' ? null : parseNum(cookedText);
  const servingsOk = servings !== null && servings > 0 && servings <= 1000;
  const cookedOk = cookedText.trim() === '' || (cooked !== null && cooked > 0 && cooked <= 100000);
  const valid = name.trim() !== '' && servingsOk && cookedOk && items.length > 0;

  const calc = recipeNutrition(items.map(withAmount), servingsOk ? (servings as number) : 1, cookedOk ? cooked : null);
  const main: NutrientKey[] = ['kcal', 'protein', 'carbs', 'fat'];
  const lacking = items.filter((i) => main.some((k) => i.per100[k] === null));
  const missingExtra = (calc.missing as NutrientKey[]).filter((k) => !main.includes(k));

  const save = async () => {
    setShowErrors(true);
    if (!valid) {
      toastError(items.length === 0 ? 'Add at least one ingredient.' : 'Some details need fixing first.');
      return;
    }
    setBusy(true);
    try {
      await saveRecipe(id, !recipe, {
        name: name.trim(),
        servings: servings as number,
        cooked_weight: cooked,
        ingredients: items.map(itemInput),
      });
      nav.pop();
      toast(recipe ? 'Recipe updated' : 'Recipe saved. Find it under Recipes when adding food.');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!recipe) return;
    try {
      await deleteFood(recipe.id);
      nav.pop();
      toast(`Deleted ${recipe.name}`, {
        action: {
          label: 'Undo',
          run: () => {
            restoreFood(recipe.id).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  return (
    <Page
      title={recipe ? 'Edit recipe' : 'New recipe'}
      backIcon="close"
      footer={
        <Button block busy={busy} onClick={() => void save()}>
          {recipe ? 'Save changes' : 'Save recipe'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <Field label="Recipe name" error={showErrors && name.trim() === '' ? 'Give the recipe a name.' : null}>
            <TextInput aria-label="Recipe name" value={name} maxLength={120} autoFocus={!recipe} placeholder="e.g. Chicken curry" onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Servings it makes" error={showErrors && !servingsOk ? 'Enter a number above 0.' : null}>
              <NumInput aria-label="Servings" value={servingsText} onChange={setServingsText} />
            </Field>
            <Field label="Cooked weight (optional)" error={!cookedOk ? 'Enter grams, or leave blank.' : null}>
              <NumInput aria-label="Cooked weight" value={cookedText} onChange={setCookedText} suffix="g" />
            </Field>
          </div>
          <p className="text-[13px] text-muted">
            Weigh the finished dish if you want to log it by weight. Otherwise the raw ingredients' total ({fmt(calc.rawWeight)} g) is used.
          </p>
        </Card>

        <div>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Ingredients</h2>
          <ItemList
            items={items}
            onChange={setItems}
            addLabel="Add ingredient"
            pickerTitle="Add ingredient"
            excludeId={id}
            emptyText="No ingredients yet. Add the foods that go into this recipe."
          />
        </div>

        {items.length > 0 && (
          <Card className="space-y-3 p-4">
            <Tiles values={calc.perServing as Nutrients} caption={`Per serving (1 of ${servingsOk ? numText(servings as number, 2) : '?'}, about ${fmt(calc.servingWeight)} g)`} />
            <Tiles values={calc.total as Nutrients} caption="Whole recipe" />
            {lacking.length > 0 && (
              <Notice tone="warn">
                {lacking.map((i) => i.name).join(', ')} {lacking.length === 1 ? 'has' : 'have'} values missing, so those totals show “?”.
                Edit the food to fill them in.
              </Notice>
            )}
            {lacking.length === 0 && missingExtra.length > 0 && (
              <p className="text-[13px] text-muted">
                Not known for every ingredient, so left blank for this recipe:{' '}
                {missingExtra.map((k) => NUTRIENT_INFO[k].label.toLowerCase()).join(', ')}.
              </p>
            )}
          </Card>
        )}

        {recipe && (
          <Button variant="ghost" block className="text-danger" onClick={() => void remove()}>
            Delete this recipe
          </Button>
        )}
      </div>
    </Page>
  );
}

// ---- saved meals ------------------------------------------------------------------------

export function SavedMealForm({ meal }: { meal?: SavedMeal }) {
  const nav = useNav();
  const newId = useStableId(uuid);
  const [name, setName] = useState(meal?.name ?? '');
  const [items, setItems] = useState<DraftItem[]>(() => (meal?.items ?? []).map(draftFromItem));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const valid = name.trim() !== '' && items.length > 0;

  const { totals, unknown } = sumNutrition(items.map((i) => entryNutrition(withAmount(i))));
  const shown = {} as Nutrients;
  for (const k of Object.keys(totals) as NutrientKey[]) shown[k] = unknown[k] > 0 && totals[k] === 0 ? null : totals[k];

  const save = async () => {
    setShowErrors(true);
    if (!valid) {
      toastError(items.length === 0 ? 'Add at least one food.' : 'Give the meal a name.');
      return;
    }
    setBusy(true);
    try {
      if (meal) await updateSavedMeal(meal.id, { name: name.trim(), items: items.map(itemInput) });
      else await createSavedMeal({ id: newId, name: name.trim(), items: items.map(itemInput) });
      nav.pop();
      toast(meal ? 'Saved meal updated' : 'Saved meal created');
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!meal) return;
    try {
      await deleteSavedMeal(meal.id);
      nav.pop();
      toast(`Deleted ${meal.name}`);
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  return (
    <Page
      title={meal ? 'Edit saved meal' : 'New saved meal'}
      backIcon="close"
      footer={
        <Button block busy={busy} onClick={() => void save()}>
          {meal ? 'Save changes' : 'Save meal'}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="p-4">
          <Field label="Name" error={showErrors && name.trim() === '' ? 'Give the meal a name.' : null}>
            <TextInput aria-label="Saved meal name" value={name} maxLength={80} autoFocus={!meal} placeholder="e.g. Usual breakfast" onChange={(e) => setName(e.target.value)} />
          </Field>
        </Card>
        <div>
          <h2 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-muted">Foods in this meal</h2>
          <ItemList items={items} onChange={setItems} addLabel="Add a food" pickerTitle="Add to saved meal" emptyText="Nothing in this meal yet." />
        </div>
        {items.length > 0 && (
          <Card className="p-4">
            <Tiles values={shown} caption="Whole meal" />
          </Card>
        )}
        {meal && (
          <Button variant="ghost" block className="text-danger" onClick={() => void remove()}>
            Delete this saved meal
          </Button>
        )}
      </div>
    </Page>
  );
}
