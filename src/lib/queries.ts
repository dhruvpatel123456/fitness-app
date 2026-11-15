// Loading data from the laptop (with caching and automatic re-loading), and
// the actions that change it.

import { QueryClient, useQuery } from '@tanstack/react-query';
import type {
  Backup,
  BarcodeResult,
  Bootstrap,
  DayData,
  DayStat,
  Entry,
  Exercise,
  Food,
  Measurement,
  OnlineItem,
  OnlineResult,
  SavedMeal,
  Serving,
  Weight,
} from '../types';
import { ApiError, OfflineError, del, get, patch, post, put } from './api';
import { uuid } from './uuid';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // "Online" here means "can reach the laptop", which the browser cannot
      // judge, so requests are always attempted.
      networkMode: 'always',
      staleTime: 5000,
      gcTime: 10 * 60 * 1000,
      refetchOnWindowFocus: true,
      retry: (failures, error) => {
        if (error instanceof OfflineError) return failures < 40;
        if (error instanceof ApiError) return false;
        return failures < 2;
      },
      retryDelay: (attempt) => Math.min(1000 * 1.5 ** attempt, 5000),
    },
    mutations: { networkMode: 'always' },
  },
});

/** Reload everything that depends on what was just changed. */
export function refresh(...keys: string[]) {
  for (const key of keys) void queryClient.invalidateQueries({ queryKey: [key] });
}

// ---- reads ----------------------------------------------------------------------

export function useBootstrap(enabled: boolean) {
  return useQuery({ queryKey: ['bootstrap'], queryFn: () => get<Bootstrap>('/bootstrap'), enabled, staleTime: 60000 });
}

export function useDiary(date: string) {
  return useQuery({ queryKey: ['diary', date], queryFn: () => get<DayData>(`/diary/${date}`) });
}

export type FoodTab = 'search' | 'recent' | 'frequent' | 'mine' | 'favourites' | 'recipes';

export function useFoods(tab: FoodTab, q = '', enabled = true) {
  return useQuery({
    queryKey: ['foods', tab, q],
    queryFn: async () => (await get<{ foods: Food[] }>(`/foods?tab=${tab}&q=${encodeURIComponent(q)}`)).foods,
    enabled,
    placeholderData: (previous) => previous,
  });
}

export function useFood(id: string | null) {
  return useQuery({
    queryKey: ['foods', 'one', id],
    queryFn: async () => (await get<{ food: Food }>(`/foods/${id}`)).food,
    enabled: Boolean(id),
  });
}

export function useOnlineSearch(q: string) {
  return useQuery({
    queryKey: ['online', q],
    queryFn: () => get<OnlineResult>(`/search/online?q=${encodeURIComponent(q)}`),
    enabled: q.length >= 3,
    staleTime: 10 * 60 * 1000,
    retry: false,
    refetchOnWindowFocus: false,
  });
}

export function useSavedMeals() {
  return useQuery({
    queryKey: ['saved-meals'],
    queryFn: async () => (await get<{ saved_meals: SavedMeal[] }>('/saved-meals')).saved_meals,
  });
}

export function useWeights() {
  return useQuery({ queryKey: ['weights'], queryFn: async () => (await get<{ weights: Weight[] }>('/weights')).weights });
}

export function useMeasurements() {
  return useQuery({
    queryKey: ['measurements'],
    queryFn: async () => (await get<{ measurements: Measurement[] }>('/measurements')).measurements,
  });
}

export function useDailyStats(from: string, to: string) {
  return useQuery({
    queryKey: ['stats', from, to],
    queryFn: async () => (await get<{ days: DayStat[] }>(`/stats/daily?from=${from}&to=${to}`)).days,
  });
}

export function useStreak(today: string) {
  return useQuery({
    queryKey: ['streak', today],
    queryFn: () => get<{ streak: number; loggedToday: boolean }>(`/stats/streak?today=${today}`),
  });
}

export function useBackups() {
  return useQuery({
    queryKey: ['backups'],
    queryFn: () => get<{ backups: Backup[]; keep: number; folder: string }>('/backups'),
  });
}

// ---- changes ----------------------------------------------------------------------
// Every create call sends an id made on the phone. Repeating a call is harmless.

const afterDiaryChange = () => refresh('diary', 'foods', 'stats', 'streak');

export async function logFood(args: { id?: string; date: string; meal: number; foodId: string; unit: Serving; quantity: number }) {
  const res = await post<{ entry: Entry }>('/diary/entries', {
    id: args.id ?? uuid(),
    date: args.date,
    meal: args.meal,
    food_id: args.foodId,
    unit: args.unit,
    quantity: args.quantity,
  });
  afterDiaryChange();
  return res.entry;
}

export async function logFoods(
  entries: { id: string; date: string; meal: number; food_id: string; unit: Serving; quantity: number }[],
) {
  await post('/diary/entries/batch', { entries });
  afterDiaryChange();
}

export type QuickValues = { name: string; kcal: number; protein: number | null; carbs: number | null; fat: number | null };

export async function quickAdd(args: { id: string; date: string; meal: number; quick: QuickValues }) {
  await post('/diary/entries', args);
  afterDiaryChange();
}

export async function updateEntry(id: string, changes: Record<string, unknown>) {
  await patch(`/diary/entries/${id}`, changes);
  afterDiaryChange();
}

export async function deleteEntry(id: string) {
  await del(`/diary/entries/${id}`);
  afterDiaryChange();
}

export async function restoreEntry(id: string) {
  await post(`/diary/entries/${id}/restore`);
  afterDiaryChange();
}

export async function copyDiary(args: {
  op_id: string;
  from_date: string;
  to_date: string;
  from_meal: number | null;
  to_meal: number | null;
}) {
  const res = await post<{ copied: number; total: number }>('/diary/copy', args);
  afterDiaryChange();
  return res;
}

export async function setWater(date: string, ml: number) {
  await put(`/days/${date}/water`, { ml });
  refresh('diary');
}

export async function setNote(date: string, note: string) {
  await put(`/days/${date}/note`, { note });
  refresh('diary');
}

/** Save an online search result locally (first use) and return the local food. */
export async function adoptFood(item: OnlineItem): Promise<Food> {
  const res = await post<{ food: Food }>('/foods/adopt', { id: uuid(), source: item.source, source_id: item.source_id });
  refresh('foods', 'online');
  return res.food;
}

export async function lookupBarcode(code: string) {
  const res = await get<BarcodeResult>(`/barcode/${encodeURIComponent(code)}`);
  if (res.status === 'found') refresh('foods');
  return res;
}

export type FoodInput = {
  name: string;
  brand: string | null;
  barcode: string | null;
  base_unit: 'g' | 'ml';
  nutrition: Record<string, number | null>;
  servings: Serving[];
};

export async function createFood(id: string, food: FoodInput) {
  const res = await post<{ food: Food }>('/foods', { id, ...food });
  refresh('foods');
  return res.food;
}

export async function saveFood(id: string, food: FoodInput) {
  const res = await put<{ food: Food }>(`/foods/${id}`, food);
  refresh('foods');
  return res.food;
}

export async function deleteFood(id: string) {
  await del(`/foods/${id}`);
  refresh('foods');
}

export async function restoreFood(id: string) {
  await post(`/foods/${id}/restore`);
  refresh('foods');
}

export async function setFavourite(id: string, value: boolean) {
  await put(`/foods/${id}/favourite`, { value });
  refresh('foods');
}

export type ItemInput = { id: string; food_id: string | null; unit: Serving; quantity: number };

export async function saveRecipe(
  id: string,
  isNew: boolean,
  body: { name: string; servings: number; cooked_weight: number | null; ingredients: ItemInput[] },
) {
  const res = isNew
    ? await post<{ food: Food }>('/recipes', { id, ...body })
    : await put<{ food: Food }>(`/recipes/${id}`, body);
  refresh('foods');
  return res.food;
}

export async function createSavedMeal(body: {
  id: string;
  name: string;
  from_diary?: { date: string; meal: number };
  items?: ItemInput[];
}) {
  const res = await post<{ saved_meal: SavedMeal }>('/saved-meals', body);
  refresh('saved-meals');
  return res.saved_meal;
}

export async function updateSavedMeal(id: string, body: { name: string; items: ItemInput[] }) {
  await put(`/saved-meals/${id}`, body);
  refresh('saved-meals');
}

export async function deleteSavedMeal(id: string) {
  await del(`/saved-meals/${id}`);
  refresh('saved-meals');
}

export async function logSavedMeal(id: string, args: { op_id: string; date: string; meal: number }) {
  const res = await post<{ added: number; total: number }>(`/saved-meals/${id}/log`, args);
  refresh('saved-meals');
  afterDiaryChange();
  return res;
}

export async function saveExercise(entry: Exercise, isNew: boolean) {
  if (isNew) await post('/exercise', entry);
  else await put(`/exercise/${entry.id}`, entry);
  refresh('diary', 'stats');
}

export async function deleteExercise(id: string) {
  await del(`/exercise/${id}`);
  refresh('diary', 'stats');
}

export async function saveWeight(date: string, kg: number) {
  await put(`/weights/${date}`, { kg });
  refresh('weights', 'bootstrap');
}

export async function deleteWeight(date: string) {
  await del(`/weights/${date}`);
  refresh('weights', 'bootstrap');
}

export async function saveMeasurement(m: { id: string; date: string; kind: string; value: number }) {
  await put('/measurements', m);
  refresh('measurements');
}

export async function deleteMeasurement(id: string) {
  await del(`/measurements/${id}`);
  refresh('measurements');
}

/** Save settings/profile/targets; the server answers with the fresh app state. */
export async function saveAndReload(method: 'PUT', path: string, body: unknown) {
  const boot = await put<Bootstrap>(path, body);
  queryClient.setQueryData(['bootstrap'], boot);
  refresh('diary', 'stats');
  return boot;
}
