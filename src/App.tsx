// The top of the app: decides between first-run setup, login, onboarding and
// the main screens, and hosts the things that sit above every screen (the
// offline banner and toasts).

import { useQuery } from '@tanstack/react-query';
import { BookOpen, ChartLine, Plus, Settings as SettingsIcon, Utensils, WifiOff } from 'lucide-react';
import { Suspense, lazy, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button, Spinner, cx } from './components/ui';
import { connection, errorMessage, get, onUnauthorized } from './lib/api';
import { AppProvider, meal_for_now, useApp, useThemeSync } from './lib/app';
import { NavProvider, useNav } from './lib/nav';
import { queryClient, useBootstrap } from './lib/queries';
import { dismissToast, useToasts } from './lib/toast';
import { AddFood } from './screens/AddFood';
import { LoginScreen, SetupScreen } from './screens/Auth';
import { DiaryScreen } from './screens/Diary';
import { FoodsScreen } from './screens/Foods';
import { Onboarding } from './screens/Onboarding';
import { openScanner } from './screens/Scanner';
import { SettingsScreen } from './screens/Settings';

const ProgressScreen = lazy(() => import('./screens/Progress'));

type AuthStatus = { setup: boolean; authed: boolean };

export function App() {
  const status = useQuery({
    queryKey: ['auth'],
    queryFn: () => get<AuthStatus>('/auth/status'),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.setQueryData<AuthStatus>(['auth'], (s) => (s ? { ...s, authed: false } : s));
      }),
    [],
  );

  const setAuthed = () => {
    queryClient.setQueryData<AuthStatus>(['auth'], { setup: true, authed: true });
    void queryClient.invalidateQueries({ queryKey: ['bootstrap'] });
  };

  let body: ReactNode;
  // While the first attempts keep failing, say so right away instead of showing a spinner for minutes
  // (the query keeps retrying in the background and the screen goes away by itself once it works).
  if (status.isPending && status.failureCount > 0) body = <Unreachable error={status.failureReason} onRetry={() => status.refetch()} />;
  else if (status.isPending) body = <Splash />;
  else if (status.isError) body = <Unreachable error={status.error} onRetry={() => status.refetch()} />;
  else if (!status.data.setup) body = <SetupScreen onDone={setAuthed} />;
  else if (!status.data.authed) body = <LoginScreen onDone={setAuthed} />;
  else body = <SignedIn />;

  return (
    <>
      {body}
      <OfflineBanner />
      <Toasts />
    </>
  );
}

function SignedIn() {
  const boot = useBootstrap(true);
  useThemeSync(boot.data?.settings.theme ?? 'system');
  if (boot.isPending && boot.failureCount > 0) return <Unreachable error={boot.failureReason} onRetry={() => boot.refetch()} />;
  if (boot.isPending) return <Splash />;
  if (boot.isError) return <Unreachable error={boot.error} onRetry={() => boot.refetch()} />;
  return (
    <AppProvider boot={boot.data}>
      <NavProvider>{boot.data.onboarded ? <Shell /> : <Onboarding />}</NavProvider>
    </AppProvider>
  );
}

function Splash() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4">
      <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl" />
      <Spinner />
    </div>
  );
}

function Unreachable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className="pt-safe flex h-full flex-col items-center justify-center px-8 text-center">
      <WifiOff size={40} className="text-muted" aria-hidden />
      <h1 className="mt-4 text-xl font-semibold">Can't reach your laptop</h1>
      <p className="mt-2 text-muted">{errorMessage(error)}</p>
      <p className="mt-2 text-sm text-muted">Keep the laptop's app window open. This page keeps trying on its own.</p>
      <Button className="mt-6" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

// ---- main screens with the bottom tab bar ----------------------------------------

type Tab = 'diary' | 'progress' | 'foods' | 'settings';

function Shell() {
  const [tab, setTab] = useState<Tab>('diary');
  const nav = useNav();
  const { date, today, setDate } = useApp();

  const openAdd = () => nav.push(<AddFood date={date} meal={meal_for_now()} />);

  // Home-screen shortcuts: "/?action=add" and "/?action=scan".
  useEffect(() => {
    const action = new URLSearchParams(window.location.search).get('action');
    if (!action) return;
    window.history.replaceState(window.history.state, '', '/');
    if (action === 'add') nav.push(<AddFood date={today} meal={meal_for_now()} />);
    if (action === 'scan') openScanner(nav, { date: today, meal: meal_for_now() });
    // Run once when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tabs: { key: Tab; label: string; icon: ReactNode }[] = [
    { key: 'diary', label: 'Diary', icon: <BookOpen size={23} /> },
    { key: 'progress', label: 'Progress', icon: <ChartLine size={23} /> },
    { key: 'foods', label: 'Foods', icon: <Utensils size={23} /> },
    { key: 'settings', label: 'Settings', icon: <SettingsIcon size={23} /> },
  ];

  const tabButton = (t: (typeof tabs)[number]) => (
    <button
      key={t.key}
      type="button"
      role="tab"
      aria-selected={tab === t.key}
      onClick={() => {
        if (t.key === 'diary' && tab === 'diary') setDate(today);
        setTab(t.key);
      }}
      className={cx(
        'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold',
        tab === t.key ? 'text-primary' : 'text-muted',
      )}
    >
      {t.icon}
      {t.label}
    </button>
  );

  return (
    <div className="flex h-full flex-col">
      <main className="relative min-h-0 flex-1">
        {tab === 'diary' && <DiaryScreen />}
        {tab === 'progress' && (
          <Suspense
            fallback={
              <div className="flex h-full items-center justify-center">
                <Spinner />
              </div>
            }
          >
            <ProgressScreen />
          </Suspense>
        )}
        {tab === 'foods' && <FoodsScreen />}
        {tab === 'settings' && <SettingsScreen />}
      </main>
      <nav className="pb-safe px-safe shrink-0 border-t border-line bg-surface" aria-label="Main">
        <div className="mx-auto flex max-w-xl items-stretch" role="tablist">
          {tabs.slice(0, 2).map(tabButton)}
          <div className="flex flex-1 items-center justify-center">
            <button
              type="button"
              aria-label="Add food"
              onClick={openAdd}
              className="-mt-5 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-ink shadow-lg active:opacity-85"
            >
              <Plus size={30} strokeWidth={2.4} />
            </button>
          </div>
          {tabs.slice(2).map(tabButton)}
        </div>
      </nav>
    </div>
  );
}

// ---- above everything ---------------------------------------------------------------

function OfflineBanner() {
  const online = useSyncExternalStore(connection.subscribe, connection.isOnline);
  const [wasOffline, setWasOffline] = useState(false);
  useEffect(() => {
    if (!online) setWasOffline(true);
    else if (wasOffline) {
      // Back in touch with the laptop: reload whatever is on screen.
      setWasOffline(false);
      void queryClient.invalidateQueries();
    }
  }, [online, wasOffline]);
  if (online) return null;
  return (
    <div className="pt-safe pointer-events-none fixed inset-x-0 top-0 z-[90] flex justify-center px-3" role="status" aria-live="polite">
      <div className="mt-2 flex items-center gap-2 rounded-full bg-ink px-4 py-2 text-sm font-medium text-bg shadow-lg">
        <WifiOff size={16} aria-hidden />
        Offline: can't reach your laptop. Retrying…
      </div>
    </div>
  );
}

function Toasts() {
  const toasts = useToasts();
  if (toasts.length === 0) return null;
  return (
    <div
      className="pb-safe pointer-events-none fixed inset-x-0 bottom-0 z-[80] flex flex-col items-center gap-2 px-3"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className={cx(
            'anim-sheet pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-2xl px-4 py-2.5 text-[15px] shadow-lg',
            t.tone === 'error' ? 'bg-danger text-white dark:text-black' : 'bg-ink text-bg',
          )}
        >
          <span className="min-w-0 flex-1 py-1">{t.message}</span>
          {t.action && (
            <button
              type="button"
              className="min-h-11 shrink-0 rounded-lg px-3 font-bold underline underline-offset-2"
              onClick={() => {
                t.action?.run();
                dismissToast(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
        </div>
      ))}
      <div className="h-20" />
    </div>
  );
}
