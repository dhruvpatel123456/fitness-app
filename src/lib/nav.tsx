// Screen navigation.
//
// Screens and sheets that open on top of the main tabs are kept in a stack.
// Each one also gets a browser history entry, so the phone's Back button (or
// the iPhone back swipe) closes the top screen instead of leaving the app.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { uuid } from './uuid';

type StackEntry = { key: string; node: ReactNode };

type Nav = {
  /** Open a screen or sheet on top. */
  push: (node: ReactNode) => void;
  /** Close the top `count` screens. */
  pop: (count?: number) => void;
  /** Swap the top screen for another one (no extra Back step). */
  replace: (node: ReactNode) => void;
  /** Close everything above the main tabs. */
  reset: () => void;
  depth: number;
};

const NavContext = createContext<Nav | null>(null);
const LayerContext = createContext<{ index: number; isTop: boolean }>({ index: -1, isTop: true });

export function useNav(): Nav {
  const nav = useContext(NavContext);
  if (!nav) throw new Error('useNav must be used inside NavProvider');
  return nav;
}

/** Position of the current screen in the stack (-1 for the main tabs). */
export function useLayer() {
  return useContext(LayerContext);
}

export function NavProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<StackEntry[]>([]);
  const ref = useRef<StackEntry[]>([]);

  const apply = useCallback((next: StackEntry[]) => {
    ref.current = next;
    setStack(next);
  }, []);

  useEffect(() => {
    // Start from a clean slate: whatever was open before a reload is gone.
    window.history.replaceState({ depth: 0 }, '');
    const onPop = (event: PopStateEvent) => {
      const depth = typeof event.state?.depth === 'number' ? (event.state.depth as number) : 0;
      const current = ref.current;
      if (depth > current.length) {
        // "Forward" into a screen that no longer exists: step back to where we are.
        window.history.go(current.length - depth);
        return;
      }
      if (depth < current.length) apply(current.slice(0, depth));
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [apply]);

  const nav = useMemo<Nav>(
    () => ({
      push(node) {
        const next = [...ref.current, { key: uuid(), node }];
        window.history.pushState({ depth: next.length }, '');
        apply(next);
      },
      pop(count = 1) {
        const n = Math.min(count, ref.current.length);
        if (n > 0) window.history.go(-n);
      },
      replace(node) {
        if (ref.current.length === 0) {
          const next = [{ key: uuid(), node }];
          window.history.pushState({ depth: 1 }, '');
          apply(next);
          return;
        }
        apply([...ref.current.slice(0, -1), { key: uuid(), node }]);
      },
      reset() {
        if (ref.current.length > 0) window.history.go(-ref.current.length);
      },
      depth: stack.length,
    }),
    [apply, stack.length],
  );

  return (
    <NavContext.Provider value={nav}>
      <LayerContext.Provider value={{ index: -1, isTop: stack.length === 0 }}>{children}</LayerContext.Provider>
      {stack.map((entry, index) => (
        <LayerContext.Provider key={entry.key} value={{ index, isTop: index === stack.length - 1 }}>
          {entry.node}
        </LayerContext.Provider>
      ))}
    </NavContext.Provider>
  );
}
