import { Loader2 } from 'lucide-react';

/** Tiny class joiner; keeps conditional Tailwind readable. */
export function cx(...values) {
  return values.filter(Boolean).join(' ');
}

const VARIANTS = {
  primary:
    'bg-brand-600 text-white shadow-sm hover:bg-brand-700 active:bg-brand-800 disabled:bg-brand-300',
  secondary:
    'bg-white text-slate-700 border border-slate-300 shadow-sm hover:bg-slate-50 active:bg-slate-100 disabled:text-slate-400',
  ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:text-slate-300',
  danger:
    'bg-white text-rose-600 border border-rose-200 shadow-sm hover:bg-rose-50 active:bg-rose-100 disabled:text-rose-300',
};

const SIZES = {
  sm: 'h-8 px-3 text-sm gap-1.5',
  md: 'h-9 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-[15px] gap-2',
  icon: 'h-9 w-9 justify-center',
};

export function Button({
  as: Tag = 'button',
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled = false,
  className,
  children,
  ...rest
}) {
  return (
    <Tag
      className={cx(
        'inline-flex select-none items-center justify-center rounded-lg font-medium transition-colors',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      disabled={Tag === 'button' ? disabled || loading : undefined}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </Tag>
  );
}

export function Spinner({ className = 'h-5 w-5', label }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-500">
      <Loader2 className={cx('animate-spin', className)} aria-hidden="true" />
      {label && <span className="text-sm">{label}</span>}
      <span className="sr-only">Loading</span>
    </span>
  );
}

export function Card({ className, children, ...rest }) {
  return (
    <section className={cx('surface', className)} {...rest}>
      {children}
    </section>
  );
}

export function CardHeader({ title, description, actions, className }) {
  return (
    <div
      className={cx(
        'flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Status colours carry meaning, so they are defined once here rather than being
 * re-derived at each call site.
 */
const STATUS_STYLES = {
  SCHEDULED: 'bg-slate-100 text-slate-700 ring-slate-200',
  PROCESSING: 'bg-blue-50 text-blue-700 ring-blue-200',
  RATE_LIMITED: 'bg-amber-50 text-amber-700 ring-amber-200',
  SENT: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  FAILED: 'bg-rose-50 text-rose-700 ring-rose-200',
  CANCELLED: 'bg-slate-100 text-slate-500 ring-slate-200',
  RUNNING: 'bg-blue-50 text-blue-700 ring-blue-200',
  COMPLETED: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};

const STATUS_LABELS = {
  SCHEDULED: 'Scheduled',
  PROCESSING: 'Sending',
  RATE_LIMITED: 'Rate limited',
  SENT: 'Sent',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  RUNNING: 'Running',
  COMPLETED: 'Completed',
};

export function StatusBadge({ status, className }) {
  return (
    <span
      className={cx(
        'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        STATUS_STYLES[status] ?? STATUS_STYLES.SCHEDULED,
        className
      )}
    >
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className }) {
  return (
    <div className={cx('flex flex-col items-center px-6 py-16 text-center', className)}>
      {Icon && (
        <div className="mb-4 rounded-full bg-slate-100 p-3">
          <Icon className="h-6 w-6 text-slate-400" aria-hidden="true" />
        </div>
      )}
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      {description && (
        <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, error, htmlFor, required, children, className }) {
  return (
    <div className={cx('space-y-1.5', className)}>
      {label && (
        <label htmlFor={htmlFor} className="field-label">
          {label}
          {required && (
            <span className="ml-0.5 text-rose-500" aria-hidden="true">
              *
            </span>
          )}
        </label>
      )}
      {children}
      {error ? (
        <p className="mt-1.5 text-xs text-rose-600" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="field-hint">{hint}</p>
      )}
    </div>
  );
}

export function Alert({ tone = 'info', title, children, className }) {
  const tones = {
    info: 'border-brand-200 bg-brand-50 text-brand-900',
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
  };

  return (
    <div className={cx('rounded-lg border px-3.5 py-3 text-sm', tones[tone], className)} role="alert">
      {title && <p className="font-medium">{title}</p>}
      {children && <div className={cx('leading-relaxed', title && 'mt-1 opacity-90')}>{children}</div>}
    </div>
  );
}
