import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { X } from 'lucide-react'
import { cx } from './ui'

interface ToastAction {
  label: string
  onAction: () => void
}

interface ToastInput {
  message: string
  tone?: 'neutral' | 'success' | 'danger'
  action?: ToastAction
  durationMs?: number
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<{ showToast: (input: ToastInput) => void } | null>(null)

export function ToastProvider({
  children,
  position = 'top',
}: {
  children: ReactNode
  position?: 'top' | 'bottom'
}) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const dismiss = useCallback((id: number) => {
    setItems((prev) => prev.filter((item) => item.id !== id))
  }, [])

  const showToast = useCallback((input: ToastInput) => {
    counter.current += 1
    const id = counter.current
    setItems((prev) => [...prev.slice(-2), { ...input, id }])
  }, [])

  const value = useMemo(() => ({ showToast }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className={cx(
          'pointer-events-none fixed inset-x-0 z-[60] flex flex-col gap-2',
          position === 'top'
            ? 'top-3 items-center px-4'
            : // Clear of the admin rail (80px) so toasts never cover navigation.
              'bottom-3 items-end pl-24 pr-4 sm:items-start',
        )}
        style={position === 'top' ? { top: 'calc(0.75rem + env(safe-area-inset-top))' } : undefined}
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  )
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const duration = item.durationMs ?? (item.action ? 10000 : 4000)
    const id = window.setTimeout(onDismiss, duration)
    return () => window.clearTimeout(id)
  }, [item, onDismiss])

  const tone =
    item.tone === 'success'
      ? 'bg-brand-700 text-cream-50'
      : item.tone === 'danger'
        ? 'bg-danger text-white'
        : 'bg-cocoa-900 text-cream-50'

  return (
    <div
      className={cx(
        'pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-[var(--radius-md)] px-4 py-3 text-sm shadow-[var(--shadow-lift)]',
        tone,
      )}
    >
      <span className="flex-1">{item.message}</span>
      {item.action ? (
        <button
          type="button"
          onClick={() => {
            item.action?.onAction()
            onDismiss()
          }}
          className="rounded-[var(--radius-sm)] bg-white/18 px-2.5 py-1 text-sm font-semibold hover:bg-white/28"
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="grid size-7 shrink-0 place-items-center rounded-full hover:bg-white/18"
      >
        <X className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
