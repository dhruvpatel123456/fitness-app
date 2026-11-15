// The Foods tab: your own foods, favourites, recipes and saved meals, with
// search, create, edit and delete.

import { Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { entryNutrition, sumNutrition } from '../../shared/nutrition.js';
import { FoodRow, Pill } from '../components/FoodRow';
import { Button, Card, Empty, Segmented, Spinner } from '../components/ui';
import { errorMessage } from '../lib/api';
import { meal_for_now, useApp } from '../lib/app';
import { useDebounced } from '../lib/hooks';
import { useNav } from '../lib/nav';
import { deleteEntry, logFood, useFoods, useSavedMeals } from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { defaultServing } from '../../shared/nutrition.js';
import type { Food } from '../types';
import { FoodDetail } from './FoodDetail';
import { FoodForm } from './FoodForm';
import { RecipeForm, SavedMealForm } from './RecipeForm';

type Section = 'mine' | 'favourites' | 'recipes' | 'saved';

export function FoodsScreen() {
  const nav = useNav();
  const { date, energy, unit, mealName } = useApp();
  const [section, setSection] = useState<Section>('mine');
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 150);
  const [busyId, setBusyId] = useState<string | null>(null);

  const foods = useFoods(section === 'saved' ? 'mine' : section, query, section !== 'saved');
  const saved = useSavedMeals();

  const quick = async (food: Food) => {
    const d = defaultServing(food);
    const meal = meal_for_now();
    setBusyId(food.id);
    try {
      const entry = await logFood({ date, meal, foodId: food.id, unit: { label: d.label, amount: d.amount }, quantity: d.quantity });
      toast(`Added ${food.name} to ${mealName(meal)}`, {
        action: {
          label: 'Undo',
          run: () => {
            deleteEntry(entry.id).catch((err) => toastError(errorMessage(err)));
          },
        },
      });
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const create = () => {
    if (section === 'recipes') nav.push(<RecipeForm />);
    else if (section === 'saved') nav.push(<SavedMealForm />);
    else nav.push(<FoodForm />);
  };

  const createLabel = section === 'recipes' ? 'New recipe' : section === 'saved' ? 'New saved meal' : 'Create a food';
  const savedMeals = (saved.data ?? []).filter((m) => query === '' || m.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="flex h-full flex-col">
      <header className="pt-safe px-safe shrink-0 border-b border-line bg-surface">
        <div className="mx-auto max-w-xl px-4 pb-3 pt-3">
          <div className="flex items-center justify-between">
            <h1 className="text-[22px] font-bold">Foods</h1>
            <Button size="sm" onClick={create}>
              <Plus size={18} aria-hidden /> {createLabel}
            </Button>
          </div>
          <Segmented
            className="mt-3"
            label="Food lists"
            value={section}
            onChange={setSection}
            options={[
              { value: 'mine', label: 'My foods' },
              { value: 'favourites', label: 'Favourites' },
              { value: 'recipes', label: 'Recipes' },
              { value: 'saved', label: 'Meals' },
            ]}
          />
          <label className="relative mt-3 block">
            <span className="sr-only">Filter this list</span>
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              autoComplete="off"
              placeholder="Filter this list"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className="h-11 w-full rounded-xl border border-line bg-bg pl-10 pr-3 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </label>
        </div>
      </header>

      <div className="scroll-area px-safe min-h-0 flex-1">
        <div className="mx-auto w-full max-w-xl px-4 pb-10 pt-4">
          {section !== 'saved' &&
            (foods.isPending ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : foods.isError ? (
              <Empty title="Could not load your foods">{errorMessage(foods.error)}</Empty>
            ) : (foods.data ?? []).length === 0 ? (
              <Empty title={query ? 'No matches' : section === 'mine' ? 'No foods of your own yet' : section === 'favourites' ? 'No favourites yet' : 'No recipes yet'}>
                {query
                  ? 'Try a different word.'
                  : section === 'mine'
                    ? 'Create a food for anything that is not in the online databases, such as a local bakery item.'
                    : section === 'favourites'
                      ? 'Open any food and tap the star to keep it here.'
                      : 'A recipe adds up its ingredients and works out the nutrition per serving.'}
              </Empty>
            ) : (
              <Card className="overflow-hidden">
                <ul>
                  {(foods.data ?? []).map((food) => (
                    <li key={food.id} className="border-b border-line last:border-b-0">
                      <FoodRow
                        food={food}
                        tag={food.source === 'recipe' && section !== 'recipes' ? <Pill>Recipe</Pill> : undefined}
                        busy={busyId === food.id}
                        onOpen={() => nav.push(<FoodDetail food={food} date={date} meal={meal_for_now()} />)}
                        onQuick={() => void quick(food)}
                        quickLabel={`Add ${food.name} to the diary`}
                      />
                    </li>
                  ))}
                </ul>
              </Card>
            ))}

          {section === 'saved' &&
            (saved.isPending ? (
              <div className="flex justify-center py-10">
                <Spinner />
              </div>
            ) : savedMeals.length === 0 ? (
              <Empty title={query ? 'No matches' : 'No saved meals yet'}>
                {query ? 'Try a different word.' : 'Save a meal from the diary (the three dots next to a meal), or build one here.'}
              </Empty>
            ) : (
              <Card className="overflow-hidden">
                <ul>
                  {savedMeals.map((m) => {
                    const { totals } = sumNutrition(m.items.map(entryNutrition));
                    return (
                      <li key={m.id} className="border-b border-line last:border-b-0">
                        <button type="button" onClick={() => nav.push(<SavedMealForm meal={m} />)} className="flex min-h-15 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2">
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[15px] font-medium">{m.name}</span>
                            <span className="block truncate text-[13px] text-muted">
                              {m.items.length} item{m.items.length === 1 ? '' : 's'} · {m.items.map((i) => i.name).join(', ')}
                            </span>
                          </span>
                          <span className="tabular shrink-0 text-[14px] font-semibold">
                            {energy(totals.kcal)} <span className="text-[11px] font-medium text-muted">{unit}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </Card>
            ))}
        </div>
      </div>
    </div>
  );
}
