// Building blocks used on every screen. Tap targets are at least 44 px.

import { ChevronLeft, LoaderCircle, X } from 'lucide-react';
import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { formatDMY } from '../../shared/dates.js';
import { errorMessage } from '../lib/api';
import { useLayer, useNav } from '../lib/nav';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

// ---- buttons -------------------------------------------------------------------

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger';
  size?: 'md' | 'sm';
  block?: boolean;
  busy?: boolean;
};

const BUTTON_VARIANTS = {
  primary: 'bg-primary text-primary-ink active:opacity-85',
  secondary: 'bg-surface-2 text-ink active:opacity-80',
  soft: 'bg-primary-soft text-primary active:opacity-80',
  ghost: 'bg-transparent text-primary active:bg-primary-soft',
  danger: 'bg-danger text-white active:opacity-85 dark:text-black',
};

export function Button({ variant = 'primary', size = 'md', block, busy, className, children, disabled, type, ...rest }: ButtonProps) {
  return (
    <button
      type={type ?? 'button'}
      disabled={disabled || busy}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-xl font-semibold transition-opacity',
        'disabled:opacity-50',
        size === 'md' ? 'min-h-12 px-5' : 'min-h-11 px-4 text-[15px]',
        block && 'w-full',
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...rest}
    >
      {busy && <LoaderCircle size={18} className="anim-spin" aria-hidden />}
      {children}
    </button>
  );
}

export function IconButton({
  label,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex h-11 w-11 shrink-0 select-none items-center justify-center rounded-full text-ink',
        'active:bg-surface-2 disabled:opacity-40',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 22, className }: { size?: number; className?: string }) {
  return <LoaderCircle size={size} className={cx('anim-spin text-muted', className)} aria-label="Loading" />;
}

// ---- layout ----------------------------------------------------------------------

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cx('rounded-2xl bg-surface shadow-card', className)}>{children}</section>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 mt-5 flex items-end justify-between px-1">
      <h2 className="text-[13px] font-semibold uppercase tracking-wide text-muted">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="px-6 py-10 text-center">
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-sm text-muted">{children}</div>}
    </div>
  );
}

/** Loading spinner, or an error with a retry button, or the content. */
export function Loadable({
  loading,
  error,
  onRetry,
  children,
}: {
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  children: ReactNode;
}) {
  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner />
      </div>
    );
  }
  if (error) {
    return (
      <div className="px-6 py-10 text-center">
        <p className="font-semibold">Could not load this</p>
        <p className="mt-1 text-sm text-muted">{errorMessage(error)}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" className="mt-4" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }
  return <>{children}</>;
}

/**
 * A full-screen page that sits on top of the main tabs, with a back button.
 */
export function Page({
  title,
  subtitle,
  right,
  footer,
  children,
  onBack,
  backIcon = 'back',
  padded = true,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  onBack?: () => void;
  backIcon?: 'back' | 'close';
  padded?: boolean;
}) {
  const nav = useNav();
  const { index } = useLayer();
  return (
    <div
      className="anim-page fixed inset-0 flex flex-col bg-bg"
      style={{ zIndex: 30 + index }}
      role="dialog"
      aria-modal="true"
    >
      <header className="pt-safe px-safe shrink-0 border-b border-line bg-surface">
        <div className="flex min-h-14 items-center gap-1 px-1">
          <IconButton label={backIcon === 'close' ? 'Close' : 'Back'} onClick={onBack ?? (() => nav.pop())}>
            {backIcon === 'close' ? <X size={24} /> : <ChevronLeft size={26} />}
          </IconButton>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[17px] font-semibold leading-tight">{title}</h1>
            {subtitle && <div className="truncate text-[13px] text-muted">{subtitle}</div>}
          </div>
          {right}
        </div>
      </header>
      <div className={cx('scroll-area px-safe min-h-0 flex-1', padded && 'pb-6')}>
        <div className={cx('mx-auto w-full max-w-xl', padded && 'px-4 pt-4')}>{children}</div>
      </div>
      {footer && (
        <footer className="pb-safe px-safe shrink-0 border-t border-line bg-surface">
          <div className="mx-auto w-full max-w-xl px-4 py-3">{footer}</div>
        </footer>
      )}
    </div>
  );
}

/** A sheet that slides up from the bottom. Tapping outside closes it. */
export function Sheet({
  title,
  children,
  footer,
  onClose,
}: {
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  onClose?: () => void;
}) {
  const nav = useNav();
  const { index } = useLayer();
  const close = onClose ?? (() => nav.pop());
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div className="fixed inset-0 flex flex-col justify-end" style={{ zIndex: 30 + index }} role="dialog" aria-modal="true">
      <button
        type="button"
        aria-label="Close"
        tabIndex={-1}
        className="anim-fade absolute inset-0 cursor-default bg-black/45"
        onClick={close}
      />
      <div
        ref={panel}
        tabIndex={-1}
        className="anim-sheet relative mx-auto flex max-h-[92dvh] w-full max-w-xl flex-col rounded-t-3xl bg-surface shadow-card outline-none"
      >
        <div className="flex min-h-14 shrink-0 items-center gap-2 pl-5 pr-2 pt-1">
          <h2 className="min-w-0 flex-1 truncate text-[17px] font-semibold">{title}</h2>
          <IconButton label="Close" onClick={close}>
            <X size={22} />
          </IconButton>
        </div>
        <div className="scroll-area px-safe min-h-0 flex-1 px-5 pb-4">{children}</div>
        {footer ? (
          <div className="pb-safe shrink-0 border-t border-line">
            <div className="px-5 py-3">{footer}</div>
          </div>
        ) : (
          <div className="pb-safe" />
        )}
      </div>
    </div>
  );
}

/** A list of choices in a sheet (used for the "..." menus). */
export function ActionSheet({
  title,
  actions,
}: {
  title?: ReactNode;
  actions: { label: string; icon?: ReactNode; danger?: boolean; run: () => void }[];
}) {
  return (
    <Sheet title={title}>
      <ul className="-mx-2">
        {actions.map((a) => (
          <li key={a.label}>
            <button
              type="button"
              onClick={a.run}
              className={cx(
                'flex min-h-13 w-full items-center gap-3 rounded-xl px-3 py-3 text-left active:bg-surface-2',
                a.danger && 'text-danger',
              )}
            >
              <span className="flex w-6 justify-center text-muted">{a.icon}</span>
              <span className="font-medium">{a.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}

// ---- form fields -------------------------------------------------------------------

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cx('block', className)}>
      {label && <span className="mb-1 block text-[13px] font-medium text-muted">{label}</span>}
      {children}
      {error ? (
        <span className="mt-1 block text-[13px] font-medium text-danger" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="mt-1 block text-[13px] text-muted">{hint}</span>
      )}
    </label>
  );
}

const INPUT_CLASS =
  'block h-12 w-full min-w-0 rounded-xl border border-line bg-surface px-3 text-ink placeholder:text-muted/70 ' +
  'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25 disabled:opacity-60';

export function TextInput({ className, invalid, ...rest }: InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }) {
  return <input type="text" className={cx(INPUT_CLASS, invalid && 'border-danger', className)} {...rest} />;
}

/**
 * A number field. It brings up the numeric keypad, and keeps what was typed
 * as text so that half-typed values such as "1." are not disturbed.
 */
export function NumInput({
  value,
  onChange,
  decimal = true,
  suffix,
  className,
  invalid,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (text: string) => void;
  decimal?: boolean;
  suffix?: ReactNode;
  invalid?: boolean;
}) {
  const input = (
    <input
      type="text"
      inputMode={decimal ? 'decimal' : 'numeric'}
      autoComplete="off"
      enterKeyHint="done"
      value={value}
      onChange={(e) => {
        const text = e.target.value.replace(',', '.');
        if (decimal ? /^\d*\.?\d*$/.test(text) : /^\d*$/.test(text)) onChange(text);
      }}
      onFocus={(e) => e.target.select()}
      className={cx(INPUT_CLASS, 'tabular', suffix != null && 'pr-14', invalid && 'border-danger', className)}
      {...rest}
    />
  );
  if (suffix == null) return input;
  return (
    <span className="relative block">
      {input}
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted">{suffix}</span>
    </span>
  );
}

export function SelectInput({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(INPUT_CLASS, 'appearance-auto pr-2', className)} {...rest}>
      {children}
    </select>
  );
}

export function TextArea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(INPUT_CLASS, 'h-auto min-h-24 py-3', className)} {...rest} />;
}

/** A date shown as DD/MM/YYYY, opening the phone's own date picker when tapped. */
export function DateField({
  value,
  onChange,
  max,
  className,
  children,
  label = 'Choose a date',
}: {
  value: string;
  onChange: (date: string) => void;
  max?: string;
  className?: string;
  children?: ReactNode;
  label?: string;
}) {
  return (
    <span className={cx('relative inline-flex min-h-11 items-center', className)}>
      {children ?? <span className={cx(INPUT_CLASS, 'tabular flex items-center')}>{formatDMY(value)}</span>}
      <input
        type="date"
        aria-label={label}
        value={value}
        max={max}
        onChange={(e) => {
          if (e.target.value) onChange(e.target.value);
        }}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker?.();
          } catch {
            // Some browsers only allow the picker from their own control; tapping still works there.
          }
        }}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
      />
    </span>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  className,
  label,
}: {
  options: { value: T; label: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
  label?: string;
}) {
  return (
    <div role="tablist" aria-label={label} className={cx('flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          role="tab"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cx(
            'min-h-10 min-w-0 flex-1 rounded-lg px-2 text-[14px] font-semibold transition-colors',
            o.value === value ? 'bg-surface text-ink shadow-card' : 'text-muted',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  detail,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: ReactNode;
  detail?: ReactNode;
}) {
  const id = useId();
  return (
    <label htmlFor={id} className="flex min-h-13 cursor-pointer items-center gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block font-medium">{label}</span>
        {detail && <span className="block text-[13px] text-muted">{detail}</span>}
      </span>
      <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span
        aria-hidden
        className={cx(
          'relative h-8 w-13 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
          checked ? 'bg-primary' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'absolute top-1 h-6 w-6 rounded-full bg-white shadow transition-all',
            checked ? 'left-6' : 'left-1',
          )}
        />
      </span>
    </label>
  );
}

// ---- small displays ------------------------------------------------------------------

export function Bar({ value, max, color, className }: { value: number; max: number; color: string; className?: string }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const over = max > 0 && value > max * 1.001;
  return (
    <div
      className={cx('h-2 overflow-hidden rounded-full bg-surface-2', className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="h-full rounded-full transition-[width] duration-300" style={{ width: `${pct}%`, background: over ? 'var(--danger)' : color }} />
    </div>
  );
}

export function Notice({ tone = 'info', children }: { tone?: 'info' | 'warn'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-xl px-3 py-2.5 text-[14px] leading-snug',
        tone === 'warn' ? 'bg-danger-soft text-ink' : 'bg-primary-soft text-ink',
      )}
      role={tone === 'warn' ? 'alert' : 'status'}
    >
      {children}
    </div>
  );
}

export function Row({
  title,
  detail,
  right,
  onClick,
  icon,
}: {
  title: ReactNode;
  detail?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  icon?: ReactNode;
}) {
  const inner = (
    <>
      {icon && <span className="flex w-6 shrink-0 justify-center text-muted">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">{title}</span>
        {detail && <span className="block truncate text-[13px] text-muted">{detail}</span>}
      </span>
      {right}
    </>
  );
  const cls = 'flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left';
  return onClick ? (
    <button type="button" onClick={onClick} className={cx(cls, 'active:bg-surface-2')}>
      {inner}
    </button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
