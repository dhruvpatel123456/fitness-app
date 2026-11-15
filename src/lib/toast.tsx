// Short messages at the bottom of the screen, optionally with an action
// such as "Undo".

import { useSyncExternalStore } from 'react';
import { uuid } from './uuid';

export type Toast = {
  id: string;
  message: string;
  tone: 'info' | 'error';
  action?: { label: string; run: () => void };
};

let toasts: Toast[] = [];
const listeners = new Set<() => void>();
const timers = new Map<string, number>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function dismissToast(id: string) {
  const timer = timers.get(id);
  if (timer !== undefined) window.clearTimeout(timer);
  timers.delete(id);
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function toast(
  message: string,
  options: { tone?: 'info' | 'error'; action?: { label: string; run: () => void }; duration?: number } = {},
) {
  const id = uuid();
  const entry: Toast = { id, message, tone: options.tone ?? 'info', action: options.action };
  // Keep at most three on screen.
  toasts = [...toasts.slice(-2), entry];
  emit();
  const duration = options.duration ?? (options.action ? 6000 : options.tone === 'error' ? 5000 : 2600);
  timers.set(
    id,
    window.setTimeout(() => dismissToast(id), duration),
  );
  return id;
}

export const toastError = (message: string) => toast(message, { tone: 'error' });

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => toasts,
  );
}
