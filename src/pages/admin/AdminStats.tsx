import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAdminOrders, useSettings } from '../../lib/hooks'
import { dayKey, formatMoney } from '../../lib/format'
import { Skeleton, cx } from '../../components/ui'
import type { Order } from '../../lib/types'

const TZ = 'Asia/Brunei'

function hourInBrunei(iso: string): number {
  const label = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    hour12: false,
  }).format(new Date(iso))
  return Number(label) % 24
}

/** "21 Nov". Anchored at noon UTC so the Brunei calendar day can never slip. */
function shortDay(key: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: 'numeric',
    month: 'short',
  }).format(new Date(`${key}T12:00:00Z`))
}

interface Stats {
  orders: number
  cups: number
  revenue: number
  cancelled: number
  byDrink: Array<{ name: string; cups: number }>
  byHour: Array<{ hour: number; orders: number; cups: number }>
}

function summarise(orders: Order[]): Stats {
  const live = orders.filter((order) => order.status !== 'cancelled')
  const drinks = new Map<string, number>()
  const hours = new Map<number, { orders: number; cups: number }>()
  let cups = 0
  let revenue = 0

  for (const order of live) {
    let orderCups = 0
    for (const line of order.items) {
      orderCups += line.qty
      drinks.set(line.name_en, (drinks.get(line.name_en) ?? 0) + line.qty)
    }
    cups += orderCups
    if (order.payment_status !== 'free') revenue += order.total

    const hour = hourInBrunei(order.placed_at)
    const bucket = hours.get(hour) ?? { orders: 0, cups: 0 }
    bucket.orders += 1
    bucket.cups += orderCups
    hours.set(hour, bucket)
  }

  const byDrink = [...drinks.entries()]
    .map(([name, count]) => ({ name, cups: count }))
    .sort((a, b) => b.cups - a.cups || a.name.localeCompare(b.name))

  const byHour = [...hours.entries()]
    .map(([hour, value]) => ({ hour, ...value }))
    .sort((a, b) => a.hour - b.hour)

  return {
    orders: live.length,
    cups,
    revenue,
    cancelled: orders.length - live.length,
    byDrink,
    byHour,
  }
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="tnum mt-0.5 text-2xl font-semibold text-ink">{value}</p>
    </div>
  )
}

export function AdminStats() {
  const { t } = useTranslation()
  const orders = useAdminOrders()
  const settings = useSettings()

  const today = dayKey()
  const [pickedDay, setPickedDay] = useState(today)

  if (orders.loading && !orders.data) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const all = orders.data ?? []
  // Today always offers itself, and so does whatever is selected, so the row can
  // never lose the day whose numbers are on screen.
  const days = [...new Set([...all.map((order) => dayKey(new Date(order.placed_at))), today, pickedDay])]
    .sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

  const dayOrders = all.filter((order) => dayKey(new Date(order.placed_at)) === pickedDay)
  const dayStats = summarise(dayOrders)
  const eventStats = summarise(all)
  const freeMode = settings.data?.free_mode ?? false
  const topCups = dayStats.byDrink[0]?.cups ?? 0
  const busiest = Math.max(1, ...dayStats.byHour.map((hour) => hour.cups))

  return (
    <div className="mx-auto max-w-2xl space-y-6 p-4 pb-16">
      <div className="space-y-2.5">
        <div
          role="group"
          aria-label={t('stats.pickDay')}
          className="scrollbar-none flex gap-2 overflow-x-auto pb-1"
        >
          {days.map((day) => {
            const active = day === pickedDay
            return (
              <button
                key={day}
                type="button"
                aria-pressed={active}
                onClick={() => setPickedDay(day)}
                className={cx(
                  // 44px tall: the same thumb-sized target as the guest menu chips.
                  'min-h-11 shrink-0 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'bg-brand-700 text-cream-50'
                    : 'bg-panel text-ink-muted ring-1 ring-hairline hover:text-ink',
                )}
              >
                {day === today ? t('stats.dayToday') : shortDay(day)}
              </button>
            )
          })}
        </div>
        <p className="text-sm text-ink-muted">{t('stats.hint')}</p>
      </div>

      {dayOrders.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-hairline px-4 py-10 text-center text-sm text-ink-muted">
          {pickedDay === today ? t('stats.empty') : t('stats.emptyDay')}
        </p>
      ) : (
        <>
          {/* ------------------------------------------------------- figures */}
          <section className="flex flex-wrap gap-x-8 gap-y-4">
            <Figure label={t('stats.orders')} value={String(dayStats.orders)} />
            <Figure label={t('stats.cups')} value={String(dayStats.cups)} />
            {freeMode ? null : <Figure label={t('stats.taken')} value={formatMoney(dayStats.revenue)} />}
            <Figure label={t('stats.cancelled')} value={String(dayStats.cancelled)} />
          </section>

          {/* --------------------------------------------------------- drinks */}
          <section>
            <h2 className="text-sm font-semibold text-ink">{t('stats.topDrinks')}</h2>
            <ul className="mt-2 space-y-2">
              {dayStats.byDrink.map((drink) => (
                <li key={drink.name}>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-sm text-ink">{drink.name}</span>
                    <span className="tnum text-sm text-ink-muted">
                      {t('stats.cupsCount', { count: drink.cups })}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                    <div
                      className="h-full rounded-full bg-brand-500"
                      style={{ width: `${topCups > 0 ? (drink.cups / topCups) * 100 : 0}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>

          {/* ----------------------------------------------------------- hours */}
          <section>
            <h2 className="text-sm font-semibold text-ink">{t('stats.byHour')}</h2>
            <div className="mt-2 flex items-end gap-1" aria-hidden="true">
              {dayStats.byHour.map((hour) => (
                // Capped width, because a quiet day has one or two hours and a
                // full-width slab reads as a chart with no shape.
                <div key={hour.hour} className="flex min-w-0 max-w-14 flex-1 flex-col items-center gap-1">
                  <span className="tnum text-[0.65rem] text-ink-muted">{hour.cups}</span>
                  <div
                    className="w-full rounded-t-[3px] bg-brand-500/80"
                    style={{ height: `${Math.max(6, (hour.cups / busiest) * 72)}px` }}
                  />
                  <span className="tnum text-[0.65rem] text-ink-muted">{String(hour.hour).padStart(2, '0')}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-muted">{t('stats.byHourHint')}</p>
          </section>
        </>
      )}

      {/* The whole event, not only the picked day. Different question, so it is separate. */}
      <section className="border-t border-hairline pt-4">
        <h2 className="text-sm font-semibold text-ink">{t('stats.eventTitle')}</h2>
        <p className="tnum mt-1 text-sm text-ink-muted">
          {t('stats.eventOrders', { count: eventStats.orders })}
          {' · '}
          {t('stats.eventCups', { count: eventStats.cups })}
          {freeMode ? '' : ` · ${formatMoney(eventStats.revenue)}`}
        </p>
      </section>
    </div>
  )
}
