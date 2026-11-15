// The shapes of the data the server sends.

export type NutrientKey = 'kcal' | 'protein' | 'carbs' | 'fat' | 'fibre' | 'sugar' | 'sat_fat' | 'sodium';

/** Per-100 values (or totals). `null` means unknown, which is not the same as 0. */
export type Nutrients = Record<NutrientKey, number | null>;

export type BaseUnit = 'g' | 'ml';

export type Serving = { label: string; amount: number };

export type Food = Nutrients & {
  id: string;
  source: 'custom' | 'off' | 'usda' | 'recipe';
  source_id: string | null;
  name: string;
  brand: string | null;
  barcode: string | null;
  base_unit: BaseUnit;
  servings: Serving[];
  last: { label: string; amount: number; quantity: number } | null;
  is_favourite: boolean;
  use_count: number;
  last_used_at: string | null;
  recipe_servings: number | null;
  recipe_cooked_weight: number | null;
  ingredients?: Item[];
};

/** A search result from an online source that is not saved locally yet. */
export type OnlineItem = Nutrients & {
  key: string;
  source: 'off' | 'usda';
  source_id: string;
  name: string;
  brand: string | null;
  barcode: string | null;
  base_unit: BaseUnit;
  servings: Serving[];
  au: boolean;
  local_id: string | null;
};

export type SourceStatus = 'ok' | 'timeout' | 'offline' | 'rate_limited' | 'error' | 'disabled' | 'skipped';

export type OnlineResult = { sources: { off: SourceStatus; usda: SourceStatus }; items: OnlineItem[] };

/** A logged amount of a food, carrying its own copy of the food's values. */
export type Item = Nutrients & {
  id: string;
  food_id: string | null;
  kind: 'food' | 'quick';
  name: string;
  brand: string | null;
  base_unit: BaseUnit;
  unit_label: string;
  unit_amount: number;
  quantity: number;
  amount: number;
  servings: Serving[];
};

export type Entry = Item & { date: string; meal: number; created_at: string };

export type Exercise = {
  id: string;
  date: string;
  name: string;
  activity_key: string | null;
  minutes: number;
  kcal: number;
};

export type TargetSet = { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
export type Targets = TargetSet & { weekdays?: Record<string, TargetSet> };
export type ResolvedTargets = TargetSet & { effective_from: string; weekday_override: boolean };

export type DayData = {
  date: string;
  entries: Entry[];
  exercise: Exercise[];
  water_ml: number;
  note: string;
  targets: ResolvedTargets | null;
};

export type Sex = 'male' | 'female';

export type Profile = {
  sex: Sex;
  age: number;
  age_as_of: string;
  height_cm: number;
  goal_weight_kg: number;
  activity: string;
  weekly_goal_kg: number;
};

export type EnergyUnit = 'kcal' | 'kJ';
export type ThemeChoice = 'system' | 'light' | 'dark';

export type Settings = {
  energy_unit: EnergyUnit;
  meal_names: string[];
  water_glass_ml: number;
  water_goal_ml: number;
  exercise_adds_back: boolean;
  theme: ThemeChoice;
  macro_mode: 'percent' | 'grams';
};

export type Bootstrap = {
  app: { name: string; version: string };
  settings: Settings;
  profile: Profile | null;
  onboarded: boolean;
  targets: { effective_from: string; targets: Targets } | null;
  latest_weight: { date: string; kg: number } | null;
  usda_enabled: boolean;
};

export type SavedMeal = {
  id: string;
  name: string;
  use_count: number;
  last_used_at: string | null;
  items: Item[];
};

export type DayStat = {
  date: string;
  entries: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
  exercise_kcal: number;
  target: TargetSet | null;
};

export type Weight = { date: string; kg: number };
export type Measurement = { id: string; date: string; kind: string; value: number };
export type Backup = { name: string; kind: 'daily' | 'manual'; size: number; created_at: string };

export type BarcodeResult =
  | { status: 'found'; origin: 'local' | 'online'; food: Food }
  | { status: 'not_found'; barcode: string }
  | { status: 'unavailable'; reason: string; barcode: string };

/** What a "pick a food and an amount" screen hands back. */
export type Picked = { food: Food; unit: Serving; quantity: number };
