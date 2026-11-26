import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BellRing, ChevronDown, ChevronRight, Clock, Coffee, Hand, Receipt, Trash2, Undo2 } from 'lucide-react'
import { getBackend } from '../../lib/backend'
import { useAdminOrders, useNow, useSettings } from '../../lib/hooks'
import { isAudioUnlocked, playAdminChime } from '../../lib/audio'
import type { Order, OrderStatus } from '../../lib/types'
import { ageTimer, formatMoney, minutesSince, relativeTime } from '../../lib/format'
import { Button, Chip, Skeleton, cx } from '../../components/ui'
import { useToast } from '../../components/Toast'

type ColumnStatus = Extract<OrderStatus, 'placed' | 'preparing' | 'ready'>

const COLUMNS: Array<{
  status: ColumnStatus
  titleKey: string
  actionKey: string
  next: OrderStatus
  variant: 'primary' | 'gold'
  Icon: typeof Receipt
}> = [
  { status: 'placed', titleKey: 'admin.new', actionKey: 'admin.start', next: 'preparing', variant: 'primary', Icon: Receipt },
  { status: 'preparing', titleKey: 'admin.preparing', actionKey: 'admin.markReady', next: 'ready', variant: 'primary', Icon: Coffee },
  { status: 'ready', titleKey: 'admin.ready', actionKey: 'admin.markCollected', next: 'collected', variant: 'gold', Icon: BellRing },
]

function OrderCard({
  order,
  highlighted,
  onAdvance,
  onCancel,
  onRing,
  busy,
}: {
  order: Order
  highlighted: boolean
  onAdvance: () => void
  onCancel: () => void
  onRing: () => void
  busy: boolean
}) {
  const { t } = useTranslation()
  const now = useNow(1000)
  const age = minutesSince(order.placed_at, now)
  const ageTone = age > 10 ? 'text-danger' : age > 5 ? 'text-warning-ink' : 'text-ink-muted'
  const readyFor = order.ready_at ? minutesSince(order.ready_at, now) : 0
  const column = COLUMNS.find((c) => c.status === order.status)
  const isReady = order.status === 'ready'
  const cups = order.items.reduce((sum, line) => sum + line.qty, 0)

  return (
    <article
      className={cx(
        'rounded-[var(--radius-md)] border bg-panel p-3 shadow-[var(--shadow-card)]',
        highlighted ? 'order-card-new border-gold-500/60' : 'border-hairline',
        isReady && 'border-brand-500/40',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="tnum font-display text-[2.5rem] leading-none font-bold text-ink">
          {order.display_number}
        </p>
        <div className="text-right">
          <p className={cx('tnum flex items-center justify-end gap-1 text-sm font-semibold', ageTone)}>
            <Clock className="size-3.5" aria-hidden="true" />
            {ageTimer(order.placed_at, now)}
          </p>
          <p className="text-[0.7rem] text-ink-muted">
            {isReady && order.ready_at
              ? `${readyFor} min ready`
              : relativeTime(order.placed_at, now)}
          </p>
        </div>
      </div>

      <div className="mt-1.5 flex items-center gap-1.5">
        <span className="truncate font-medium text-ink">{order.customer_name}</span>
        {order.source === 'admin' ? (
          <span
            className="inline-flex shrink-0 items-center gap-1 rounded-full bg-ink/6 px-1.5 py-0.5 text-[0.65rem] font-medium text-ink-muted"
            title={t('admin.walkIn')}
          >
            <Hand className="size-3" aria-hidden="true" />
            {t('admin.walkIn')}
          </span>
        ) : null}
        {order.payment_method === 'free' ? (
          <Chip tone="gold">{t('admin.free')}</Chip>
        ) : (
          <Chip tone={order.payment_status === 'paid' ? 'success' : 'neutral'}>
            {order.payment_method === 'cash' ? t('admin.cash') : t('admin.transfer')}
            {order.payment_status === 'paid' ? ` · ${t('admin.paid')}` : ''}
          </Chip>
        )}
      </div>

      <ul className="mt-2 space-y-1">
        {order.items.map((line) => (
          <li key={line.id} className="text-sm">
            <span className="font-medium text-ink">
              <span className="tnum">{line.qty}</span>
              {'× '}
              {line.name_en}
            </span>
            {line.modifiers.length > 0 ? (
              <span className="block text-xs leading-snug text-ink-muted">
                {line.modifiers.map((m) => m.option_en).join(', ')}
              </span>
            ) : null}
          </li>
        ))}
      </ul>

      {order.note ? (
        <p className="mt-2 rounded-[var(--radius-sm)] bg-gold-300/35 px-2 py-1 text-xs font-medium text-cocoa-900">
          {order.note}
        </p>
      ) : null}

      <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
        <span className="tnum">
          {cups} {cups === 1 ? 'cup' : 'cups'}
        </span>
        {order.payment_method !== 'free' ? (
          <span className="tnum font-medium">{formatMoney(order.total)}</span>
        ) : null}
      </div>

      <div className="mt-2.5 flex gap-2">
        <Button
          size="lg"
          fullWidth
          variant={isReady ? 'gold' : column?.variant === 'gold' ? 'gold' : 'primary'}
          loading={busy}
          onClick={onAdvance}
        >
          {t(column?.actionKey ?? 'admin.markCollected')}
        </Button>
        {isReady ? (
          <Button
            size="lg"
            variant="secondary"
            onClick={onRing}
            aria-label={t('admin.ringAgain')}
            className="w-16 shrink-0 px-0"
          >
            <BellRing className="size-5" aria-hidden="true" />
          </Button>
        ) : null}
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('admin.cancelOrder')}
          className="grid w-12 shrink-0 place-items-center rounded-[var(--radius-md)] border border-hairline text-ink-muted hover:border-danger/40 hover:text-danger"
        >
          <Trash2 className="size-5" aria-hidden="true" />
        </button>
      </div>
    </article>
  )
}

export function AdminBoard() {
  const { t } = useTranslation()
  const orders = useAdminOrders()
  const settings = useSettings()
  const { showToast } = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)
  const [highlight, setHighlight] = useState<Set<string>>(new Set())
  const [cancelTarget, setCancelTarget] = useState<Order | null>(null)
  const [recentOpen, setRecentOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const seen = useRef<Set<string> | null>(null)

  // Chime + glow when a new order lands (design.md §6.2).
  useEffect(() => {
    const list = orders.data
    if (!list) return
    if (seen.current === null) {
      seen.current = new Set(list.map((o) => o.id))
      return
    }
    const fresh = list.filter(
      (o) => !seen.current?.has(o.id) && (o.status === 'placed' || o.status === 'preparing'),
    )
    if (fresh.length > 0) {
      if (isAudioUnlocked()) playAdminChime()
      setHighlight(new Set(fresh.map((o) => o.id)))
      const id = window.setTimeout(() => setHighlight(new Set()), 3200)
      seen.current = new Set(list.map((o) => o.id))
      return () => window.clearTimeout(id)
    }
    seen.current = new Set(list.map((o) => o.id))
  }, [orders.data])

  const changeStatus = useCallback(
    async (order: Order, next: OrderStatus, undoTo?: OrderStatus) => {
      setBusyId(order.id)
      try {
        const backend = await getBackend()
        await backend.setOrderStatus(order.id, next)
        orders.refresh()
        showToast({
          message: t('admin.statusChanged', { number: order.display_number, status: t(`status.${next}`) }),
          tone: 'success',
          action: {
            label: t('admin.undo'),
            onAction: () => {
              void (async () => {
                const b = await getBackend()
                await b.setOrderStatus(order.id, undoTo ?? order.status)
                orders.refresh()
              })()
            },
          },
        })
      } catch {
        showToast({ message: t('error.generic'), tone: 'danger' })
      } finally {
        setBusyId(null)
      }
    },
    [orders, showToast, t],
  )

  const ringAgain = useCallback(
    async (order: Order) => {
      const backend = await getBackend()
      await backend.ringAgain(order.id)
      showToast({ message: t('admin.ringSent'), tone: 'success' })
      orders.refresh()
    },
    [orders, showToast, t],
  )

  const confirmCancel = useCallback(async () => {
    if (!cancelTarget) return
    setBusyId(cancelTarget.id)
    try {
      const backend = await getBackend()
      await backend.cancelOrder(cancelTarget.id, cancelReason.trim() || t('admin.cancelOrder'))
      orders.refresh()
      showToast({
        message: t('admin.statusChanged', { number: cancelTarget.display_number, status: t('status.cancelled') }),
        tone: 'neutral',
      })
      setCancelTarget(null)
      setCancelReason('')
    } finally {
      setBusyId(null)
    }
  }, [cancelReason, cancelTarget, orders, showToast, t])

  const all = orders.data ?? []
  const recent = all
    .filter((o) => o.status === 'collected' || o.status === 'cancelled')
    .sort(
      (a, b) =>
        new Date(b.collected_at ?? b.cancelled_at ?? b.placed_at).getTime() -
        new Date(a.collected_at ?? a.cancelled_at ?? a.placed_at).getTime(),
    )
    .slice(0, 5)

  return (
    <div className="p-3">
      {orders.loading && !orders.data ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-72 w-full" />
          ))}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {COLUMNS.map((column) => {
            const columnOrders = all
              .filter((o) => o.status === column.status)
              .sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime())
            const Icon = column.Icon
            return (
              <section key={column.status} className="board-column lg:max-h-[calc(100dvh-9rem)]">
                <header className="flex items-center gap-2 border-b border-hairline px-3 py-2">
                  <Icon className="size-4 text-ink-muted" aria-hidden="true" />
                  <h2 className="text-sm font-semibold text-ink">{t(column.titleKey)}</h2>
                  <span className="tnum ml-auto rounded-full bg-ink/8 px-2 py-0.5 text-xs font-semibold text-ink">
                    {columnOrders.length}
                  </span>
                </header>
                <div className="board-column-body board-scroll">
                  {columnOrders.length === 0 ? (
                    <div className="grid flex-1 place-items-center rounded-[var(--radius-md)] border border-dashed border-hairline px-4 py-10 text-center">
                      <p className="text-sm text-ink-muted">{t('admin.emptyColumn')}</p>
                      {column.status === 'placed' && settings.data?.auto_accept ? (
                        <p className="mt-1 text-xs text-ink-muted">{t('settingsPanel.autoAccept')}</p>
                      ) : null}
                    </div>
                  ) : (
                    columnOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        highlighted={highlight.has(order.id)}
                        busy={busyId === order.id}
                        onAdvance={() => void changeStatus(order, column.next)}
                        onCancel={() => {
                          setCancelTarget(order)
                          setCancelReason('')
                        }}
                        onRing={() => void ringAgain(order)}
                      />
                    ))
                  )}
                </div>
              </section>
            )
          })}
        </div>
      )}

      {all.length === 0 && !orders.loading ? (
        <p className="mt-6 text-center text-sm text-ink-muted">{t('admin.emptyBoard')}</p>
      ) : null}

      {recent.length > 0 ? (
        <section className="mt-6">
          {/* Closed by default: after a busy hour the pile of collected orders
              buries the board, and the count on the toggle keeps it honest. */}
          <button
            type="button"
            onClick={() => setRecentOpen((open) => !open)}
            aria-expanded={recentOpen}
            className="mb-2 flex items-center gap-2 rounded-full px-1 py-1 text-sm font-semibold text-ink-muted hover:text-ink"
          >
            {recentOpen ? (
              <ChevronDown className="size-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="size-4" aria-hidden="true" />
            )}
            {t('admin.recent')}
            <span className="tnum rounded-full bg-ink/8 px-2 py-0.5 text-xs font-semibold text-ink">
              {recent.length}
            </span>
          </button>
          {recentOpen ? (
            <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-panel">
              {recent.slice(0, 10).map((order) => (
                <li key={order.id} className="flex items-center gap-3 px-3 py-2">
                  <span className="tnum font-display text-base font-semibold text-ink-muted">
                    {order.display_number}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink-muted">
                    {order.customer_name} · {order.items.map((i) => i.name_en).join(', ')}
                  </span>
                  <span className="text-xs text-ink-muted">{t(`status.${order.status}`)}</span>
                  {order.status === 'collected' ? (
                    <button
                      type="button"
                      onClick={() => void changeStatus(order, 'ready', 'ready')}
                      className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-brand-700 hover:bg-brand-700/10"
                    >
                      <Undo2 className="size-3.5" aria-hidden="true" />
                      {t('admin.undo')}
                    </button>
                  ) : (
                    <Clock className="size-3.5 text-ink-muted" aria-hidden="true" />
                  )}
                </li>
              ))}
            </ul>
          ) : null}
          {recentOpen && recent.length > 10 ? (
            <p className="mt-1.5 text-xs text-ink-muted">{t('admin.recentTruncated', { count: recent.length })}</p>
          ) : null}
        </section>
      ) : null}

      {cancelTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-cocoa-900/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-[var(--radius-lg)] bg-panel p-5 shadow-[var(--shadow-lift)]">
            <h2 className="font-display text-lg font-semibold text-ink">
              {t('admin.cancelConfirm', { number: cancelTarget.display_number })}
            </h2>
            <label htmlFor="cancel-reason" className="mt-3 block text-sm font-medium text-ink">
              {t('admin.cancelReason')}
            </label>
            <input
              id="cancel-reason"
              value={cancelReason}
              onChange={(event) => setCancelReason(event.target.value.slice(0, 80))}
              className="mt-1.5 h-12 w-full rounded-[var(--radius-md)] border border-hairline bg-panel px-3 text-base text-ink"
              placeholder={t('admin.cancelReason')}
            />
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setCancelTarget(null)}>
                {t('admin.cancelNo')}
              </Button>
              <Button variant="danger" fullWidth loading={busyId === cancelTarget.id} onClick={() => void confirmCancel()}>
                {t('admin.cancelYes')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
