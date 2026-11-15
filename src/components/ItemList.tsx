// An editable list of foods with amounts. Used for recipe ingredients and
// for the contents of a saved meal.

import { Plus } from 'lucide-react';
import { describeServing, pickNutrition, scaleNutrition } from '../../shared/nutrition.js';
import { useApp } from '../lib/app';
import { fmtG } from '../lib/format';
import { useNav } from '../lib/nav';
import { uuid } from '../lib/uuid';
import { AddFood } from '../screens/AddFood';
import type { BaseUnit, Item, Nutrients, Picked, Serving } from '../types';
import { NutritionSummary, ServingFields, useServing } from './Serving';
import { Button, Card, Sheet } from './ui';

export type DraftItem = {
  id: string;
  food_id: string | null;
  kind: 'food' | 'quick';
  name: string;
  brand: string | null;
  base_unit: BaseUnit;
  servings: Serving[];
  per100: Nutrients;
  unit: Serving;
  quantity: number;
};

export function draftFromPicked(p: Picked): DraftItem {
  return {
    id: uuid(),
    food_id: p.food.id,
    kind: 'food',
    name: p.food.name,
    brand: p.food.brand,
    base_unit: p.food.base_unit,
    servings: p.food.servings,
    per100: pickNutrition(p.food) as Nutrients,
    unit: p.unit,
    quantity: p.quantity,
  };
}

export function draftFromItem(item: Item): DraftItem {
  return {
    id: item.id,
    food_id: item.food_id,
    kind: item.kind,
    name: item.name,
    brand: item.brand,
    base_unit: item.base_unit,
    servings: item.servings,
    per100: pickNutrition(item) as Nutrients,
    unit: { label: item.unit_label, amount: item.unit_amount },
    quantity: item.quantity,
  };
}

/** What the server needs to store an item. */
export function itemInput(d: DraftItem) {
  return { id: d.id, food_id: d.food_id, unit: d.unit, quantity: d.quantity };
}

/** Per-100 values plus the amount, as the nutrition maths expects. */
export function withAmount(d: DraftItem) {
  return { ...d.per100, amount: d.unit.amount * d.quantity };
}

function EditItemSheet({ item, onSave, onRemove }: { item: DraftItem; onSave: (unit: Serving, quantity: number) => void; onRemove: () => void }) {
  const nav = useNav();
  const serving = useServing(item, { label: item.unit.label, amount: item.unit.amount, quantity: item.quantity });
  return (
    <Sheet
      title={item.name}
      footer={
        <div className="flex gap-3">
          <Button
            variant="secondary"
            className="text-danger"
            onClick={() => {
              onRemove();
              nav.pop();
            }}
          >
            Remove
          </Button>
          <Button
            className="flex-1"
            disabled={!serving.valid || item.kind === 'quick'}
            onClick={() => {
              if (serving.quantity === null) return;
              onSave({ label: serving.unit.label, amount: serving.unit.amount }, serving.quantity);
              nav.pop();
            }}
          >
            Done
          </Button>
        </div>
      }
    >
      <div className="space-y-4">
        {item.kind === 'quick' ? (
          <p className="text-[15px] text-muted">This is a quick-add amount. It can be removed, but not resized.</p>
        ) : (
          <ServingFields serving={serving} />
        )}
        <NutritionSummary per100={item.per100} amount={item.kind === 'quick' ? item.unit.amount * item.quantity : serving.amount} />
      </div>
    </Sheet>
  );
}

export function ItemList({
  items,
  onChange,
  addLabel,
  pickerTitle,
  excludeId,
  emptyText,
}: {
  items: DraftItem[];
  onChange: (update: (items: DraftItem[]) => DraftItem[]) => void;
  addLabel: string;
  pickerTitle: string;
  excludeId?: string;
  emptyText: string;
}) {
  const nav = useNav();
  const { energy, unit, today } = useApp();

  const add = () =>
    nav.push(
      <AddFood
        date={today}
        meal={0}
        mode="pick"
        title={pickerTitle}
        excludeId={excludeId}
        onPick={(picked) => onChange((list) => [...list, draftFromPicked(picked)])}
      />,
    );

  const edit = (item: DraftItem) =>
    nav.push(
      <EditItemSheet
        item={item}
        onSave={(u, quantity) => onChange((list) => list.map((x) => (x.id === item.id ? { ...x, unit: u, quantity } : x)))}
        onRemove={() => onChange((list) => list.filter((x) => x.id !== item.id))}
      />,
    );

  return (
    <Card className="overflow-hidden">
      {items.length === 0 ? (
        <p className="px-4 py-5 text-center text-[14px] text-muted">{emptyText}</p>
      ) : (
        <ul>
          {items.map((item) => {
            const n = scaleNutrition(item.per100, item.unit.amount * item.quantity) as Nutrients;
            return (
              <li key={item.id} className="border-b border-line">
                <button type="button" onClick={() => edit(item)} className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left active:bg-surface-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{item.name}</span>
                    <span className="block truncate text-[13px] text-muted">
                      {item.kind === 'quick' ? 'Quick add' : describeServing(item.unit.label, item.unit.amount, item.quantity, item.base_unit)}
                    </span>
                  </span>
                  <span className="tabular shrink-0 text-right">
                    <span className="block text-[15px] font-semibold">
                      {n.kcal === null ? '?' : energy(n.kcal)} <span className="text-[11px] font-medium text-muted">{unit}</span>
                    </span>
                    <span className="block text-[11px] text-muted">
                      P {n.protein === null ? '?' : fmtG(n.protein)} · C {n.carbs === null ? '?' : fmtG(n.carbs)} · F {n.fat === null ? '?' : fmtG(n.fat)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <button type="button" onClick={add} className="flex min-h-12 w-full items-center gap-2 px-4 text-[15px] font-semibold text-primary active:bg-surface-2">
        <Plus size={18} aria-hidden /> {addLabel}
      </button>
    </Card>
  );
}
