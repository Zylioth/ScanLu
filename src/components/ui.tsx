import {
  useEffect,
  useId,
  useRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react'
import { Minus, Plus, X } from 'lucide-react'

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

/* -------------------------------------------------------------------------- */
/* Button                                                                      */
/* -------------------------------------------------------------------------- */

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'gold'
type ButtonSize = 'sm' | 'md' | 'lg'

const variantClass: Record<ButtonVariant, string> = {
  primary:
    'bg-brand-700 text-cream-50 shadow-[0_1px_0_rgba(255,255,255,0.12)_inset] hover:bg-brand-800 active:bg-brand-900',
  secondary:
    'border border-brand-700/60 text-brand-700 bg-transparent hover:bg-brand-700/8 active:bg-brand-700/14',
  gold: 'bg-gold-500 text-cocoa-900 hover:bg-gold-300 active:bg-gold-500',
  ghost: 'text-ink bg-transparent hover:bg-ink/6 active:bg-ink/10',
  danger: 'bg-danger text-white hover:brightness-95 active:brightness-90',
}

const sizeClass: Record<ButtonSize, string> = {
  sm: 'h-10 px-3.5 text-sm gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-12 px-5 text-base gap-2 rounded-[var(--radius-md)]',
  lg: 'h-14 px-6 text-lg gap-2.5 rounded-[var(--radius-md)]',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  children: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center font-medium transition-[background-color,transform,filter] duration-150',
        'active:scale-[0.98] disabled:opacity-45 disabled:active:scale-100',
        variantClass[variant],
        sizeClass[size],
        fullWidth && 'w-full',
        className,
      )}
    >
      {loading ? <Spinner className="size-4" /> : null}
      {children}
    </button>
  )
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cx(
        'inline-block animate-spin rounded-full border-2 border-current border-t-transparent',
        className ?? 'size-4',
      )}
    />
  )
}

/* -------------------------------------------------------------------------- */
/* Chips                                                                       */
/* -------------------------------------------------------------------------- */

type ChipTone = 'neutral' | 'gold' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const toneClass: Record<ChipTone, string> = {
  neutral: 'bg-ink/6 text-ink',
  gold: 'bg-gold-300/40 text-cocoa-900',
  success: 'bg-success/14 text-success-ink',
  warning: 'bg-warning/16 text-warning-ink',
  danger: 'bg-danger/12 text-danger',
  info: 'bg-info/12 text-info-ink',
  muted: 'bg-ink/8 text-ink-muted',
}

export function Chip({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: ChipTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.8125rem] font-medium whitespace-nowrap',
        toneClass[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

/* -------------------------------------------------------------------------- */
/* Stepper                                                                     */
/* -------------------------------------------------------------------------- */

export function Stepper({
  value,
  min = 1,
  max = 99,
  onChange,
  labelIncrease,
  labelDecrease,
  size = 'md',
}: {
  value: number
  min?: number
  max?: number
  onChange: (next: number) => void
  labelIncrease: string
  labelDecrease: string
  size?: 'sm' | 'md'
}) {
  const btn =
    size === 'sm'
      ? 'size-8 rounded-full'
      : 'size-11 rounded-full'
  return (
    <div className="inline-flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min}
        aria-label={labelDecrease}
        className={cx(
          'grid place-items-center border border-hairline text-ink transition-colors hover:bg-ink/5 active:bg-ink/10 disabled:opacity-35',
          btn,
        )}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span className="tnum min-w-6 text-center text-lg font-semibold" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        disabled={value >= max}
        aria-label={labelIncrease}
        className={cx(
          'grid place-items-center border border-hairline text-ink transition-colors hover:bg-ink/5 active:bg-ink/10 disabled:opacity-35',
          btn,
        )}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Skeletons                                                                   */
/* -------------------------------------------------------------------------- */

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('animate-pulse rounded-[var(--radius-sm)] bg-ink/8', className)} />
}

/* -------------------------------------------------------------------------- */
/* Banner                                                                      */
/* -------------------------------------------------------------------------- */

export function Banner({
  tone = 'gold',
  icon,
  children,
}: {
  tone?: 'gold' | 'danger' | 'info'
  icon?: ReactNode
  children: ReactNode
}) {
  const bg =
    tone === 'gold'
      ? 'bg-gold-300/45 text-cocoa-900'
      : tone === 'danger'
        ? 'bg-danger/12 text-danger'
        : 'bg-info/12 text-info-ink'
  return (
    <div className={cx('flex items-start gap-2 px-4 py-2.5 text-sm font-medium', bg)} role="status">
      {icon}
      <div className="min-w-0">{children}</div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Sheet                                                                       */
/* -------------------------------------------------------------------------- */

export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    panel?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panelRef.current) return
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = overflow
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-cocoa-900/45 backdrop-blur-[2px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative max-h-[92dvh] overflow-y-auto rounded-t-[var(--radius-lg)] bg-panel shadow-[var(--shadow-lift)] outline-none"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-hairline bg-panel/95 px-4 py-3 backdrop-blur">
          <div className="mx-auto h-1 w-10 rounded-full bg-ink/15 sm:hidden" aria-hidden="true" />
          <h2 id={titleId} className="text-xl">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid size-10 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-ink/6"
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>
        <div className="px-4 pt-4 pb-6">{children}</div>
        {footer ? (
          <div
            className="sticky bottom-0 border-t border-hairline bg-panel/95 px-4 py-3 backdrop-blur"
            style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------------------- */
/* Fields                                                                      */
/* -------------------------------------------------------------------------- */

export function Field({
  label,
  hint,
  error,
  id,
  containerClassName,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string
  hint?: string
  error?: string
  containerClassName?: string
}) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  return (
    <div className={cx('space-y-1.5', containerClassName)}>
      <label htmlFor={fieldId} className="block text-sm font-medium text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={fieldId}
        aria-describedby={hint || error ? `${fieldId}-hint` : undefined}
        aria-invalid={error ? true : undefined}
        className={cx(
          'h-13 w-full rounded-[var(--radius-md)] border bg-panel px-3.5 text-base text-ink',
          'placeholder:text-ink-muted/60 focus:outline-none focus-visible:border-brand-500',
          error ? 'border-danger' : 'border-hairline',
        )}
      />
      {hint && !error ? (
        <p id={`${fieldId}-hint`} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${fieldId}-hint`} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (next: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="flex gap-1 rounded-[var(--radius-md)] bg-ink/6 p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={cx(
              'flex-1 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-panel text-ink shadow-[var(--shadow-card)]' : 'text-ink-muted hover:text-ink',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
