// One food: choose a serving and quantity (nutrition updates live), then add
// it to a meal. Also where a food is favourited, edited or deleted.

import { Ellipsis, Pencil, Star, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { formatDMY, friendlyDate } from '../../shared/dates.js';
import { baseUnitLabel, defaultServing } from '../../shared/nutrition.js';
import { MealSelect, NutritionSummary, ServingFields, useServing } from '../components/Serving';
import { ActionSheet, Button, Card, IconButton, Page, cx } from '../components/ui';
import { errorMessage } from '../lib/api';
import { useApp } from '../lib/app';
import { useStableId } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { deleteFood, logFood, restoreFood, setFavourite, useFood } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { Food, Picked } from '../types';
import { FoodForm } from './FoodForm';
import { RecipeForm } from './RecipeForm';

const SOURCE_LABEL: Record<Food['source'], string> = {
  custom: 'Created by you',
  off: 'From Open Food Facts',
  usda: 'From USDA FoodData Central',
  recipe: 'Your recipe',
};

export function FoodDetail({
  food: initial,
  date,
  meal: initialMeal,
  mode = 'log',
  onPick,
  popOnAdd = 1,
}: {
  food: Food;
  date: string;
  meal: number;
  mode?: 'log' | 'pick';
  onPick?: (picked: Picked) => void;
  /** How many screens to close after adding (this one, plus the search screen under it). */
  popOnAdd?: number;
}) {
  const nav = useNav();
  const { today, mealName, energy, unit } = useApp();
  // Start with the food as listed, then follow the laptop's copy (it changes if the food is edited).
  const fresh = useFood(initial.id);
  const food = fresh.data ?? initial;
  const serving = useServing(food, defaultServing(initial));
  const [meal, setMeal] = useState(initialMeal);
  const [busy, setBusy] = useState(false);
  const [favourite, setFav] = useState(initial.is_favourite);
  const entryId = useStableId(uuid);
  const u = baseUnitLabel(food.base_unit);

  const add = async () => {
    if (!serving.valid || serving.quantity === null) return;
    const unitChoice = { label: serving.unit.label, amount: serving.unit.amount };
    if (mode === 'pick') {
      onPick?.({ food, unit: unitChoice, quantity: serving.quantity });
      nav.pop(popOnAdd);
      return;
    }
    setBusy(true);
    try {
      await logFood({ id: entryId, date, meal, foodId: food.id, unit: unitChoice, quantity: serving.quantity });
      toast(`Added ${food.name} to ${mealName(meal)}`);
      nav.pop(popOnAdd);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleFavourite = async () => {
    const next = !favourite;
    setFav(next);
    try {
      await setFavourite(food.id, next);
    } catch (err) {
      setFav(!next);
      toastError(errorMessage(err));
    }
  };

  const remove = async () => {
    try {
      await deleteFood(food.id);
      nav.pop(2); // the menu and this screen
      toast(`Deleted ${food.name}`, {
        action: {
          label: 'Undo',
          run: () => {
            restoreFood(food.id).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    }
  };

  const openMenu = () =>
    nav.push(
      <ActionSheet
        title={food.name}
        actions={[
          {
            label: food.source === 'recipe' ? 'Edit recipe' : 'Edit food',
            icon: <Pencil size={20} />,
            run: () => nav.replace(food.source === 'recipe' ? <RecipeForm recipeId={food.id} /> : <FoodForm food={food} />),
          },
          { label: 'Delete', icon: <Trash2 size={20} />, danger: true, run: () => void remove() },
        ]}
      />,
    );

  return (
    <Page
      title={food.name}
      subtitle={food.brand ?? undefined}
      right={
        <>
          <IconButton label={favourite ? 'Remove from favourites' : 'Add to favourites'} aria-pressed={favourite} onClick={() => void toggleFavourite()}>
            <Star size={22} className={cx(favourite && 'fill-current text-carbs')} />
          </IconButton>
          <IconButton label="Food options" onClick={openMenu}>
            <Ellipsis size={22} />
          </IconButton>
        </>
      }
      footer={
        <Button block busy={busy} disabled={!serving.valid} onClick={() => void add()}>
          {mode === 'pick' ? 'Use this amount' : `Add to ${mealName(meal)}`}
        </Button>
      }
    >
      <div className="space-y-4">
        <Card className="space-y-4 p-4">
          <ServingFields serving={serving} />
          <NutritionSummary per100={food} amount={serving.amount} />
        </Card>

        {mode === 'log' && (
          <Card className="space-y-2 p-4">
            <MealSelect value={meal} onChange={setMeal} />
            <p className="text-[13px] text-muted">
              Adding to {friendlyDate(date, today).toLowerCase()}, {formatDMY(date)}.
            </p>
          </Card>
        )}

        <p className="px-1 text-[13px] leading-relaxed text-muted">
          {SOURCE_LABEL[food.source]}
          {food.barcode ? ` · barcode ${food.barcode}` : ''}
          <br />
          Per 100 {u}: {food.kcal === null ? 'energy unknown' : `${energy(food.kcal)} ${unit}`}
          {food.source === 'recipe' && food.recipe_servings ? ` · makes ${food.recipe_servings} serving${food.recipe_servings === 1 ? '' : 's'}` : ''}
          {food.use_count > 0 ? ` · logged ${food.use_count} time${food.use_count === 1 ? '' : 's'}` : ''}
        </p>
      </div>
    </Page>
  );
}
