// First-run PIN setup, and the login screen.

import { Lock } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, Field, cx } from '../components/ui';
import { ApiError, errorMessage, post } from '../lib/api';

function remembersDigits(): boolean {
  try {
    return localStorage.getItem('tt-pin-kind') !== 'text';
  } catch {
    return true;
  }
}

function rememberKind(pin: string) {
  try {
    localStorage.setItem('tt-pin-kind', /^\d+$/.test(pin) ? 'digits' : 'text');
  } catch {
    // Not important.
  }
}

function PinInput({
  value,
  onChange,
  digits,
  autoFocus,
  autoComplete,
  label,
}: {
  value: string;
  onChange: (v: string) => void;
  digits: boolean;
  autoFocus?: boolean;
  autoComplete: string;
  label: string;
}) {
  return (
    <input
      type="password"
      aria-label={label}
      inputMode={digits ? 'numeric' : 'text'}
      autoComplete={autoComplete}
      autoFocus={autoFocus}
      maxLength={72}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={cx(
        'block h-14 w-full rounded-xl border border-line bg-surface px-4 text-center text-2xl tracking-[0.3em]',
        'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25',
      )}
    />
  );
}

function AuthLayout({ title, intro, children }: { title: string; intro: ReactNode; children: ReactNode }) {
  return (
    <div className="scroll-area pt-safe pb-safe px-safe h-full">
      <div className="mx-auto flex min-h-full w-full max-w-sm flex-col justify-center px-6 py-10">
        <div className="mb-6 flex flex-col items-center text-center">
          <img src="/icons/icon-192.png" alt="" width={72} height={72} className="rounded-2xl shadow-card" />
          <h1 className="mt-4 text-2xl font-bold">{title}</h1>
          <p className="mt-2 text-[15px] text-muted">{intro}</p>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SetupScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [again, setAgain] = useState('');
  const [digits, setDigits] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length < 4) return setError('Use at least 4 characters.');
    if (pin !== again) return setError('The two entries do not match.');
    setBusy(true);
    setError(null);
    try {
      await post('/auth/setup', { pin });
      rememberKind(pin);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'already_set_up') {
        // Someone (probably you, on another device) already chose the PIN.
        window.location.reload();
        return;
      }
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout
      title="Welcome to Tucker Tally"
      intro="Choose a PIN or password. You will need it to open the app on each device. Six digits or more is a good choice."
    >
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="PIN or password">
          <PinInput value={pin} onChange={setPin} digits={digits} autoFocus autoComplete="new-password" label="PIN or password" />
        </Field>
        <Field label="Type it again" error={error}>
          <PinInput value={again} onChange={setAgain} digits={digits} autoComplete="new-password" label="Type it again" />
        </Field>
        <Button type="submit" block busy={busy}>
          <Lock size={18} aria-hidden /> Set PIN and continue
        </Button>
        <button type="button" className="mx-auto block min-h-11 px-3 text-sm font-medium text-primary" onClick={() => setDigits((d) => !d)}>
          {digits ? 'Use letters as well' : 'Use the number pad'}
        </button>
      </form>
    </AuthLayout>
  );
}

export function LoginScreen({ onDone }: { onDone: () => void }) {
  const [pin, setPin] = useState('');
  const [digits, setDigits] = useState(remembersDigits);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!pin) return setError('Enter your PIN.');
    setBusy(true);
    setError(null);
    try {
      await post('/auth/login', { pin });
      rememberKind(pin);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'wrong_pin') {
        const left = Number(err.data.attempts_left ?? 0);
        setError(left > 0 ? `That PIN is not right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'That PIN is not right.');
        setPin('');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Tucker Tally" intro="Enter your PIN to open your diary.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field error={error}>
          <PinInput value={pin} onChange={setPin} digits={digits} autoFocus autoComplete="current-password" label="PIN" />
        </Field>
        <Button type="submit" block busy={busy}>
          Unlock
        </Button>
        <button type="button" className="mx-auto block min-h-11 px-3 text-sm font-medium text-primary" onClick={() => setDigits((d) => !d)}>
          {digits ? 'My PIN has letters' : 'Use the number pad'}
        </button>
      </form>
    </AuthLayout>
  );
}
