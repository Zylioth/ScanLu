import { useTranslation } from 'react-i18next'
import { BellRing, Coffee, PackageCheck, Receipt } from 'lucide-react'
import type { Order, OrderStatus } from '../lib/types'
import { formatMoney, minutesUntil } from '../lib/format'
import { cx } from './ui'

/** Deterministic bar widths from the order id, so the barcode is stable and unique. */
function barcodeWidths(seed: string, count = 32): number[] {
  let hash = 2166136261
  const out: number[] = []
  for (let i = 0; i < count; i++) {
    hash ^= seed.charCodeAt(i % Math.max(1, seed.length))
    hash = Math.imul(hash, 16777619)
    out.push(1 + (Math.abs(hash >> 8) % 3))
  }
  return out
}

function Barcode({ seed }: { seed: string }) {
  const widths = barcodeWidths(seed)
  return (
    <div className="ticket-barcode" aria-hidden="true">
      {widths.map((w, index) => (
        <span
          key={index}
          style={{ width: `${w}px`, opacity: index % 3 === 0 ? 0.9 : 0.6 }}
        />
      ))}
    </div>
  )
}

const STEPS: Array<{ status: Exclude<OrderStatus, 'cancelled'>; icon: typeof Receipt; key: string }> = [
  { status: 'placed', icon: Receipt, key: 'ticket.statusPlaced' },
  { status: 'preparing', icon: Coffee, key: 'ticket.statusPreparing' },
  { status: 'ready', icon: BellRing, key: 'ticket.statusReady' },
  { status: 'collected', icon: PackageCheck, key: 'ticket.statusCollected' },
]

const ORDER_OF: Record<Exclude<OrderStatus, 'cancelled'>, number> = {
  placed: 0,
  preparing: 1,
  ready: 2,
  collected: 3,
}

export function StatusStepper({ status }: { status: OrderStatus }) {
  const { t } = useTranslation()
  const activeIndex = status === 'cancelled' ? -1 : ORDER_OF[status]
  return (
    <ol className="flex items-start justify-between gap-1" aria-label={t('ticket.yourNumber')}>
      {STEPS.map((step, index) => {
        const Icon = step.icon
        const isDone = activeIndex > index
        const isCurrent = activeIndex === index
        return (
          <li key={step.status} className="flex flex-1 flex-col items-center gap-1.5 text-center">
            <span
              className={cx(
                'grid size-9 place-items-center rounded-full border-2 transition-colors',
                isDone && 'border-brand-500 bg-brand-500 text-cream-50',
                isCurrent && 'border-gold-500 bg-gold-300/40 text-cocoa-900',
                !isDone && !isCurrent && 'border-hairline text-ink-muted/60',
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
            </span>
            <span
              className={cx(
                'text-[0.7rem] leading-tight font-medium',
                isCurrent ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {t(step.key)}
            </span>
            {isCurrent && status !== 'collected' ? (
              <span className="sr-only">{t('ticket.etaSoon')}</span>
            ) : null}
          </li>
        )
      })}
    </ol>
  )
}

function CupMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} role="img" aria-label="Cup">
      <path
        d="M7 11h15v7a7.5 7.5 0 0 1-15 0z"
        fill="currentColor"
        opacity="0.92"
      />
      <path d="M22 13h2.5a3.5 3.5 0 0 1 0 7H22" fill="none" stroke="currentColor" strokeWidth="1.8" />
      <path d="M11 7.5c0-1.4 1-2 1-3.2M15.5 7.5c0-1.4 1-2 1-3.2M20 7.5c0-1.4 1-2 1-3.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.8" />
    </svg>
  )
}

/**
 * The paper ticket. `split` renders only one half so the ready animation can
 * tear the real component apart instead of a hand-drawn lookalike.
 */
export function Ticket({
  order,
  eventName,
  freeMode,
  split,
  className,
}: {
  order: Order
  eventName: string
  freeMode: boolean
  split?: 'top' | 'bottom'
  className?: string
}) {
  const { t } = useTranslation()
  const cups = order.items.reduce((sum, line) => sum + line.qty, 0)
  const eta = minutesUntil(order.estimated_ready_at)
  const cancelled = order.status === 'cancelled'

  const header = (
    <div className="ticket-head">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-display text-lg leading-tight font-semibold">{eventName}</p>
          <p className="mt-0.5 text-[0.7rem] tracking-wide text-gold-300 uppercase">
            {t('ticket.happyRaya')}
          </p>
        </div>
        <CupMark className="size-8 shrink-0 text-gold-300" />
      </div>
    </div>
  )

  const numberBlock = (
    <div className="pt-4">
      <p className="text-[0.7rem] font-semibold tracking-[0.14em] text-ink-muted uppercase">
        {t('ticket.yourNumber')}
      </p>
      <p className="ticket-number mt-1 text-brand-900">{order.display_number}</p>
      <p className="mt-1.5 text-sm text-ink-muted">
        {t('ticket.hello', { name: order.customer_name })}
      </p>
    </div>
  )

  if (split === 'top') {
    return (
      <div className={cx('ticket overflow-hidden', className)}>
        {header}
        <div className="ticket-body pb-4">{numberBlock}</div>
      </div>
    )
  }

  const itemsBlock = (
    <>
      <div className="ticket-perf" aria-hidden="true">
        <span className="notch notch-left" />
        <span className="notch notch-right" />
      </div>
      <ul className="space-y-2.5">
        {order.items.map((line) => (
          <li key={line.id} className="text-sm">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-medium text-ink">
                <span className="tnum">{line.qty}</span>
                {'× '}
                {line.name_en}
              </span>
              {!freeMode ? (
                <span className="tnum shrink-0 text-ink-muted">{formatMoney(line.line_total)}</span>
              ) : null}
            </div>
            {line.modifiers.length > 0 ? (
              <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                {line.modifiers.map((m) => m.option_en).join(', ')}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {order.note ? (
        <p className="mt-3 rounded-[var(--radius-sm)] bg-gold-300/25 px-2.5 py-1.5 text-xs text-cocoa-900">
          <span className="font-semibold">{t('admin.note')}: </span>
          {order.note}
        </p>
      ) : null}
      <div className="ticket-perf" aria-hidden="true">
        <span className="notch notch-left" />
        <span className="notch notch-right" />
      </div>
    </>
  )

  const statusBlock = (
    <div className="space-y-3">
      {cancelled ? (
        <p className="text-sm font-medium text-danger">{t('ticket.cancelled')}</p>
      ) : (
        <>
          <StatusStepper status={order.status} />
          {order.status === 'preparing' ? (
            <p className="text-center text-sm text-ink-muted">
              {eta > 1 ? t('ticket.eta', { count: eta }) : t('ticket.etaSoon')}
            </p>
          ) : null}
        </>
      )}
      <Barcode seed={order.id} />
      <div className="flex items-center justify-between text-[0.7rem] text-ink-muted">
        <span>
          <span className="tnum">{cups}</span> {cups === 1 ? 'drink' : 'drinks'}
        </span>
        {!freeMode ? <span className="tnum font-medium">{formatMoney(order.total)}</span> : null}
      </div>
    </div>
  )

  if (split === 'bottom') {
    return (
      <div className={cx('ticket overflow-hidden', className)}>
        <div className="ticket-body">{itemsBlock}{statusBlock}</div>
      </div>
    )
  }

  return (
    <article
      className={cx(
        'ticket is-preparing-holder',
        order.status === 'preparing' && 'is-preparing',
        className,
      )}
      aria-label={`${t('ticket.yourNumber')} ${order.display_number}`}
    >
      {header}
      <div className="ticket-body">
        {numberBlock}
        {itemsBlock}
        {statusBlock}
      </div>
    </article>
  )
}
