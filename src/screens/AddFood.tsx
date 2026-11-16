// Add food: search (your own foods first, then online), plus tabs for
// Recent, Frequent, My Foods, Recipes and Saved Meals.
//
// The same screen is used to pick an ingredient for a recipe or a saved meal
// (mode "pick"): there it hands back the chosen food and amount instead of
// logging it.

import { ListChecks, ScanBarcode, Search, X, Zap } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { formatDMY, friendlyDate } from '../../shared/dates.js';
import { defaultServing, entryNutrition, sumNutrition } from '../../shared/nutrition.js';
import { FoodRow, Pill } from '../components/FoodRow';
import { Button, Card, Empty, IconButton, Notice, Page, SelectInput, Spinner, cx } from '../components/ui';
import { errorMessage } from '../lib/api';
import { isSecure, useApp } from '../lib/app';
import { useDebounced } from '../lib/hooks';
import { useNav } from '../lib/nav';
import {
  adoptFood,
  deleteEntry,
  logFood,
  logFoods,
  logSavedMeal,
  useFoods,
  useOnlineSearch,
  useSavedMeals,
} from '../lib/queries';
import { toast, toastError } from '../lib/toast';
import { uuid } from '../lib/uuid';
import type { Food, OnlineItem, Picked, SavedMeal, SourceStatus } from '../types';
import { QuickAddSheet } from './DiarySheets';
import { FoodDetail } from './FoodDetail';
import { FoodForm } from './FoodForm';
import { RecipeForm } from './RecipeForm';
import { Scanner } from './Scanner';

type Tab = 'search' | 'recent' | 'frequent' | 'mine' | 'recipes' | 'saved';

const TABS: { key: Tab; label: string }[] = [
  { key: 'search', label: 'Search' },
  { key: 'recent', label: 'Recent' },
  { key: 'frequent', label: 'Frequent' },
  { key: 'mine', label: 'My Foods' },
  { key: 'recipes', label: 'Recipes' },
  { key: 'saved', label: 'Saved Meals' },
];

const SOURCE_NAME = { off: 'Open Food Facts', usda: 'USDA' };

function sourceProblem(name: string, status: SourceStatus): string | null {
  switch (status) {
    case 'timeout':
      return `${name} took too long to answer.`;
    case 'offline':
      return `${name} could not be reached (is the laptop online?).`;
    case 'rate_limited':
      return `${name} search is paused for a moment (too many searches in a row).`;
    case 'error':
      return `${name} had a problem.`;
    default:
      return null;
  }
}

export function AddFood({
  date,
  meal: initialMeal,
  mode = 'log',
  onPick,
  excludeId,
  title,
}: {
  date: string;
  meal: number;
  mode?: 'log' | 'pick';
  onPick?: (picked: Picked) => void;
  /** A food to leave out of the lists (a recipe cannot contain itself). */
  excludeId?: string;
  title?: string;
}) {
  const nav = useNav();
  const { today, boot, mealName } = useApp();
  const [meal, setMeal] = useState(initialMeal);
  const [tab, setTab] = useState<Tab>('search');
  const [q, setQ] = useState('');
  const query = q.trim();
  const localQuery = useDebounced(query, 150);
  const onlineQuery = useDebounced(query, 700);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Multi-add: ticked foods, each with the diary entry id it will get.
  const [multi, setMulti] = useState(false);
  const [selected, setSelected] = useState<Map<string, { food: Food; entryId: string }>>(new Map());
  const [adding, setAdding] = useState(false);

  const picking = mode === 'pick';
  const keep = (foods: Food[] | undefined) => (foods ?? []).filter((f) => f.id !== excludeId);

  const recent = useFoods('recent', '', tab === 'recent' || (tab === 'search' && query === ''));
  const frequent = useFoods('frequent', '', tab === 'frequent');
  const favourites = useFoods('favourites', '', tab === 'mine');
  const mine = useFoods('mine', '', tab === 'mine');
  const recipes = useFoods('recipes', '', tab === 'recipes');
  const local = useFoods('search', localQuery, tab === 'search' && localQuery !== '');
  const online = useOnlineSearch(tab === 'search' ? onlineQuery : '');
  const savedMeals = useSavedMeals();

  // ---- actions ----------------------------------------------------------------

  const openDetail = (food: Food) =>
    nav.push(<FoodDetail food={food} date={date} meal={meal} mode={mode} onPick={onPick} popOnAdd={2} />);

  const toggle = (food: Food) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(food.id)) next.delete(food.id);
      else next.set(food.id, { food, entryId: uuid() });
      return next;
    });
  };

  const quick = async (food: Food, key: string) => {
    const d = defaultServing(food);
    if (picking) {
      onPick?.({ food, unit: { label: d.label, amount: d.amount }, quantity: d.quantity });
      nav.pop();
      return;
    }
    setBusyKey(key);
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
      setBusyKey(null);
    }
  };

  /** An online result is saved to the laptop the first time it is used. */
  const withAdopted = async (item: OnlineItem, then: (food: Food) => void | Promise<void>) => {
    setBusyKey(item.key);
    try {
      const food = await adoptFood(item);
      await then(food);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusyKey(null);
    }
  };

  const addSelected = async () => {
    if (selected.size === 0) return;
    setAdding(true);
    try {
      await logFoods(
        [...selected.values()].map(({ food, entryId }) => {
          const d = defaultServing(food);
          return { id: entryId, date, meal, food_id: food.id, unit: { label: d.label, amount: d.amount }, quantity: d.quantity };
        }),
      );
      toast(`Added ${selected.size} food${selected.size === 1 ? '' : 's'} to ${mealName(meal)}`);
      nav.pop();
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setAdding(false);
    }
  };

  const openScanner = () =>
    nav.push(
      <Scanner
        onFound={(food) => nav.replace(<FoodDetail food={food} date={date} meal={meal} mode={mode} onPick={onPick} popOnAdd={2} />)}
        onCreate={(barcode) =>
          nav.replace(
            <FoodForm
              barcode={barcode}
              onSaved={(food) => nav.replace(<FoodDetail food={food} date={date} meal={meal} mode={mode} onPick={onPick} popOnAdd={2} />)}
            />,
          )
        }
      />,
    );

  const createFood = (name = '') =>
    nav.push(
      <FoodForm
        initialName={name}
        onSaved={(food) => nav.replace(<FoodDetail food={food} date={date} meal={meal} mode={mode} onPick={onPick} popOnAdd={2} />)}
      />,
    );

  // ---- rows -------------------------------------------------------------------

  const row = (food: Food, tag?: ReactNode) => (
    <li key={food.id} className="border-b border-line last:border-b-0">
      <FoodRow
        food={food}
        tag={tag}
        busy={busyKey === food.id}
        selectable={multi}
        selected={selected.has(food.id)}
        onOpen={() => (multi ? toggle(food) : openDetail(food))}
        onQuick={() => void quick(food, food.id)}
        quickLabel={picking ? `Use ${food.name}` : `Add ${food.name} to ${mealName(meal)}`}
      />
    </li>
  );

  const list = (foods: Food[], empty: ReactNode) =>
    foods.length ? (
      <Card className="overflow-hidden">
        <ul>{foods.map((f) => row(f, f.source === 'recipe' ? <Pill>Recipe</Pill> : undefined))}</ul>
      </Card>
    ) : (
      <>{empty}</>
    );

  const loading = (
    <div className="flex justify-center py-8">
      <Spinner />
    </div>
  );

  const heading = (text: string, right?: ReactNode) => (
    <div className="mb-2 mt-4 flex min-h-6 items-center justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{text}</h2>
      {right}
    </div>
  );

  // ---- search tab -----------------------------------------------------------------

  const renderSearch = () => {
    if (query === '') {
      const foods = keep(recent.data).slice(0, 12);
      return (
        <>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="soft" size="sm" onClick={openScanner}>
              <ScanBarcode size={18} aria-hidden /> Scan barcode
            </Button>
            {picking ? (
              <Button variant="soft" size="sm" onClick={() => createFood()}>
                Create a food
              </Button>
            ) : (
              <Button variant="soft" size="sm" onClick={() => nav.push(<QuickAddSheet date={date} meal={meal} />)}>
                <Zap size={18} aria-hidden /> Quick add
              </Button>
            )}
          </div>
          {heading('Recent')}
          {recent.isPending
            ? loading
            : list(
                foods,
                <Empty title="Nothing logged yet">Search for a food above, scan a barcode, or create your own. Foods you log show up here.</Empty>,
              )}
          {!picking && (
            <Button variant="ghost" block className="mt-2" onClick={() => createFood()}>
              Create a food
            </Button>
          )}
        </>
      );
    }

    const localFoods = keep(local.data);
    const localIds = new Set(localFoods.map((f) => f.id));
    const items = (online.data?.items ?? []).filter((i) => !(i.local_id && localIds.has(i.local_id)) && i.local_id !== excludeId);
    const usda = items.filter((i) => i.source === 'usda');
    const off = items.filter((i) => i.source === 'off');
    const problems = online.data
      ? [sourceProblem(SOURCE_NAME.off, online.data.sources.off), sourceProblem(SOURCE_NAME.usda, online.data.sources.usda)].filter(
          (p): p is string => p !== null,
        )
      : [];
    const waitingToType = query !== onlineQuery || query !== localQuery;

    const onlineRow = (item: OnlineItem) => {
      const known = item.local_id !== null;
      return (
        <li key={item.key} className="border-b border-line last:border-b-0">
          <FoodRow
            food={item}
            tag={item.au ? <Pill>AU</Pill> : undefined}
            busy={busyKey === item.key}
            selectable={multi}
            selected={known && selected.has(item.local_id as string)}
            onOpen={() => void withAdopted(item, (food) => (multi ? toggle(food) : openDetail(food)))}
            onQuick={() => void withAdopted(item, (food) => quick(food, item.key))}
            quickLabel={picking ? `Use ${item.name}` : `Add ${item.name} to ${mealName(meal)}`}
          />
        </li>
      );
    };

    return (
      <>
        {heading('Your foods')}
        {local.isPending && localQuery !== '' ? loading : list(localFoods, <p className="px-1 text-[14px] text-muted">No matches in your own foods yet.</p>)}

        {heading('Online', online.isFetching || waitingToType ? <Spinner size={16} /> : undefined)}
        {query.length < 3 ? (
          <p className="px-1 text-[14px] text-muted">Type at least 3 letters to search online.</p>
        ) : online.isError ? (
          <Notice tone="warn">
            Online search is unavailable right now ({errorMessage(online.error)}) Your own foods above still work.{' '}
            <button type="button" className="font-semibold underline" onClick={() => online.refetch()}>
              Try again
            </button>
          </Notice>
        ) : !online.data ? (
          <p className="px-1 text-[14px] text-muted">Searching online…</p>
        ) : (
          <>
            {problems.length > 0 && (
              <div className="mb-2">
                <Notice tone="warn">
                  {problems.join(' ')} Showing what could be found.{' '}
                  <button type="button" className="font-semibold underline" onClick={() => online.refetch()}>
                    Try again
                  </button>
                </Notice>
              </div>
            )}
            {usda.length > 0 && (
              <>
                <p className="mb-1 px-1 text-[12px] font-medium text-muted">Generic foods (USDA)</p>
                <Card className="mb-3 overflow-hidden">
                  <ul>{usda.map(onlineRow)}</ul>
                </Card>
              </>
            )}
            {off.length > 0 && (
              <>
                <p className="mb-1 px-1 text-[12px] font-medium text-muted">Packaged foods (Open Food Facts)</p>
                <Card className="overflow-hidden">
                  <ul>{off.map(onlineRow)}</ul>
                </Card>
              </>
            )}
            {items.length === 0 && problems.length === 0 && (
              <p className="px-1 text-[14px] text-muted">Nothing found online for “{query}”.</p>
            )}
            {!boot.usda_enabled && items.length > 0 && (
              <p className="mt-2 px-1 text-[12px] text-muted">
                Tip: add a free USDA key (see README) to also search generic foods such as fruit, meat and vegetables.
              </p>
            )}
          </>
        )}
        <Button variant="ghost" block className="mt-3" onClick={() => createFood(query)}>
          Create “{query.length > 24 ? `${query.slice(0, 24)}…` : query}” as a new food
        </Button>
      </>
    );
  };

  // ---- saved meals tab ---------------------------------------------------------------

  const renderSaved = () => {
    if (savedMeals.isPending) return loading;
    const meals = savedMeals.data ?? [];
    if (meals.length === 0) {
      return <Empty title="No saved meals yet">In the diary, open a meal's menu (the three dots) and choose “Save as a saved meal”.</Empty>;
    }
    return (
      <Card className="mt-3 overflow-hidden">
        <ul>
          {meals.map((m) => (
            <li key={m.id} className="border-b border-line last:border-b-0">
              <SavedMealRow meal={m} date={date} toMeal={meal} />
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  const tabs = picking ? TABS.filter((t) => t.key !== 'saved') : TABS;

  return (
    <Page
      title={title ?? 'Add food'}
      subtitle={picking ? undefined : `${friendlyDate(date, today)} · ${formatDMY(date)}`}
      padded={false}
      right={
        !picking && (
          <IconButton
            label={multi ? 'Stop selecting several' : 'Select several foods'}
            aria-pressed={multi}
            className={cx(multi && 'bg-primary-soft text-primary')}
            onClick={() => {
              setMulti((m) => !m);
              setSelected(new Map());
            }}
          >
            <ListChecks size={22} />
          </IconButton>
        )
      }
      footer={
        multi ? (
          <Button block busy={adding} disabled={selected.size === 0} onClick={() => void addSelected()}>
            {selected.size === 0 ? 'Tick the foods to add' : `Add ${selected.size} food${selected.size === 1 ? '' : 's'} to ${mealName(meal)}`}
          </Button>
        ) : undefined
      }
    >
      <div className="sticky top-0 z-10 border-b border-line bg-bg px-4 pb-2 pt-3">
        <div className="flex gap-2">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">Search for a food</span>
            <Search size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
            <input
              type="search"
              enterKeyHint="search"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Search foods"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                if (tab !== 'search') setTab('search');
              }}
              className="h-12 w-full rounded-xl border border-line bg-surface pl-10 pr-10 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
            {q !== '' && (
              <button type="button" aria-label="Clear search" onClick={() => setQ('')} className="absolute right-0 top-0 flex h-12 w-11 items-center justify-center text-muted">
                <X size={18} />
              </button>
            )}
          </label>
          <IconButton label="Scan a barcode" className="h-12 w-12 rounded-xl bg-primary text-primary-ink active:bg-primary" onClick={openScanner}>
            <ScanBarcode size={24} />
          </IconButton>
        </div>
        {!picking && (
          <div className="mt-2 flex items-center gap-2 text-[14px]">
            <span className="shrink-0 text-muted">Add to</span>
            <SelectInput aria-label="Meal" className="h-11 flex-1 py-0" value={meal} onChange={(e) => setMeal(Number(e.target.value))}>
              {boot.settings.meal_names.map((name, i) => (
                <option key={i} value={i}>
                  {name}
                </option>
              ))}
            </SelectInput>
          </div>
        )}
        <div className="no-scrollbar -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" role="tablist" aria-label="Food lists">
          {tabs.map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cx(
                'min-h-11 shrink-0 rounded-full px-3.5 text-[14px] font-semibold',
                tab === t.key ? 'bg-primary text-primary-ink' : 'bg-surface text-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-xl px-4 pb-8">
        {!isSecure() && tab === 'search' && query === '' && (
          <div className="mt-3">
            <Notice>The camera scanner needs a secure (https) address. You can still type a barcode by hand.</Notice>
          </div>
        )}
        {tab === 'search' && renderSearch()}
        {tab === 'recent' && (
          <div className="mt-3">
            {recent.isPending ? loading : list(keep(recent.data), <Empty title="Nothing logged yet">Foods you log show up here, newest first.</Empty>)}
          </div>
        )}
        {tab === 'frequent' && (
          <div className="mt-3">
            {frequent.isPending ? loading : list(keep(frequent.data), <Empty title="Nothing logged yet">The foods you log most often show up here.</Empty>)}
          </div>
        )}
        {tab === 'mine' && (
          <>
            {keep(favourites.data).length > 0 && (
              <>
                {heading('Favourites')}
                {list(keep(favourites.data), null)}
              </>
            )}
            {heading('Foods I created')}
            {mine.isPending ? loading : list(keep(mine.data), <Empty title="No foods of your own yet">Create a food for anything you eat that is not in the online databases.</Empty>)}
            <Button variant="soft" block className="mt-3" onClick={() => createFood()}>
              Create a food
            </Button>
          </>
        )}
        {tab === 'recipes' && (
          <div className="mt-3">
            {recipes.isPending ? loading : list(keep(recipes.data), <Empty title="No recipes yet">A recipe adds up its ingredients and works out the nutrition per serving.</Empty>)}
            <Button variant="soft" block className="mt-3" onClick={() => nav.push(<RecipeForm />)}>
              New recipe
            </Button>
          </div>
        )}
        {tab === 'saved' && renderSaved()}
      </div>
    </Page>
  );
}

function SavedMealRow({ meal, date, toMeal }: { meal: SavedMeal; date: string; toMeal: number }) {
  const { energy, unit, mealName } = useApp();
  const [busy, setBusy] = useState(false);
  // One id per press, so pressing twice by accident adds the meal once.
  const [opId, setOpId] = useState(uuid);
  const { totals } = sumNutrition(meal.items.map(entryNutrition));

  const add = async () => {
    setBusy(true);
    try {
      const res = await logSavedMeal(meal.id, { op_id: opId, date, meal: toMeal });
      setOpId(uuid());
      toast(`Added ${res.total} item${res.total === 1 ? '' : 's'} to ${mealName(toMeal)}`);
    } catch (err) {
      toastError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-15 items-center gap-3 py-2 pl-4 pr-3">
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-medium">{meal.name}</div>
        <div className="truncate text-[13px] text-muted">
          {meal.items.length} item{meal.items.length === 1 ? '' : 's'} · {energy(totals.kcal)} {unit} · {meal.items.map((i) => i.name).join(', ')}
        </div>
      </div>
      <Button size="sm" variant="soft" busy={busy} onClick={() => void add()} aria-label={`Add ${meal.name} to ${mealName(toMeal)}`}>
        Add
      </Button>
    </div>
  );
}

