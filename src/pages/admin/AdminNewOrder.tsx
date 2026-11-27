import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { useMenu, useSettings } from '../../lib/hooks'
import { getBackend } from '../../lib/backend'
import { describeOrderError } from '../../lib/errors'
import { formatMoney } from '../../lib/format'
import type { MenuItemView, PaymentMethod, PlaceOrderResult } from '../../lib/types'
import { Button, Chip, Field, Segmented, Sheet, Stepper, cx } from '../../components/ui'
import { CupArt, ItemSheet } from '../../components/ItemSheet'

interface TrayLine {
  key: string
  menuItemId: string
  qty: number
  optionIds: string[]
  unitPrice: number
}

function signature(line: Omit<TrayLine, 'key'>): string {
  return `${line.menuItemId}|${[...line.optionIds].sort().join(',')}`
}

export function AdminNewOrder() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const menu = useMenu()
  const settings = useSettings()

  const [lines, setLines] = useState<TrayLine[]>([])
  const [picker, setPicker] = useState<MenuItemView | null>(null)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')
  const [paymentChoice, setPaymentChoice] = useState<PaymentMethod | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [placed, setPlaced] = useState<PlaceOrderResult | null>(null)

  // The menu object is replaced on every refetch, so these fallbacks have to be
  // memoised or every keystroke in the review sheet rebuilds the tray rows.
  const items = useMemo(() => menu.data?.items ?? [], [menu.data])
  const categories = useMemo(() => menu.data?.categories ?? [], [menu.data])
  const groups = useMemo(() => menu.data?.groups ?? [], [menu.data])
  const freeMode = settings.data?.free_mode ?? false
  const maxPerOrder = settings.data?.max_cups_per_order ?? 2
  const payment: PaymentMethod = freeMode
    ? 'free'
    : (paymentChoice ?? settings.data?.default_payment_method ?? 'cash')

  const cups = lines.reduce((sum, line) => sum + line.qty, 0)
  const total = lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)
  const overCap = cups > maxPerOrder

  const qtyInTray = useMemo(() => {
    const map = new Map<string, number>()
    for (const line of lines) map.set(line.menuItemId, (map.get(line.menuItemId) ?? 0) + line.qty)
    return map
  }, [lines])

  const rows = useMemo(
    () =>
      lines.map((line) => {
        const item = items.find((i) => i.id === line.menuItemId)
        const modifiers = line.optionIds
          .map((optionId) => {
            for (const group of groups) {
              const option = group.options.find((o) => o.id === optionId)
              if (option) return i18n.language === 'ms' ? option.name_ms : option.name_en
            }
            return null
          })
          .filter((label): label is string => label !== null)
        return {
          line,
          name: item ? (i18n.language === 'ms' ? item.name_ms : item.name_en) : t('manual.drink'),
          image: item?.image_url ?? null,
          modifiers,
        }
      }),
    [lines, items, groups, i18n.language, t],
  )

  const addToTray = (incoming: Omit<TrayLine, 'key'>) => {
    setLines((prev) => {
      const sig = signature(incoming)
      const existing = prev.find((line) => signature(line) === sig)
      if (existing) {
        return prev.map((line) =>
          line.key === existing.key ? { ...line, qty: line.qty + incoming.qty } : line,
        )
      }
      return [...prev, { ...incoming, key: crypto.randomUUID() }]
    })
  }

  const setLineQty = (key: string, qty: number) => {
    setLines((prev) =>
      qty <= 0
        ? prev.filter((line) => line.key !== key)
        : prev.map((line) => (line.key === key ? { ...line, qty } : line)),
    )
  }

  const reset = () => {
    setLines([])
    setName('')
    setNote('')
    setPaymentChoice(null)
    setError(null)
    setPlaced(null)
  }

  const place = async () => {
    setError(null)
    setSubmitting(true)
    try {
      const backend = await getBackend()
      const result = await backend.placeOrder({
        // A walk-in without a name is the normal case here, and the backend keeps
        // requiring one only when the host asked guests for it.
        customer_name: name.trim() || t('admin.walkIn'),
        note: note.trim() || undefined,
        payment_method: payment,
        items: lines.map((line) => ({
          menu_item_id: line.menuItemId,
          qty: line.qty,
          modifier_option_ids: line.optionIds,
        })),
        source: 'admin',
        // The host is standing in front of the guest, so the per-person and
        // per-hour guards are noise. Stock is still enforced by the backend.
        override: true,
      })
      setPlaced(result)
      setReviewOpen(false)
      setLines([])
      setName('')
      setNote('')
    } catch (caught) {
      setError(describeOrderError(caught, t, { maxCupsPerOrder: maxPerOrder }))
    } finally {
      setSubmitting(false)
    }
  }

  if (placed) {
    return (
      <div className="mx-auto max-w-md p-4">
        <div className="rounded-[var(--radius-lg)] border border-hairline bg-panel p-6 text-center">
          <CheckCircle2 className="mx-auto size-10 text-brand-700" aria-hidden="true" />
          <h2 className="mt-3 font-display text-xl font-semibold text-ink">{t('manual.done')}</h2>
          <p className="tnum mt-1 font-display text-4xl font-bold text-ink">{placed.display_number}</p>
          <p className="mt-2 text-sm text-ink-muted">{t('manual.doneBody')}</p>
          <div className="mt-5 space-y-2">
            <Button fullWidth onClick={reset}>
              {t('manual.another')}
            </Button>
            <Button variant="secondary" fullWidth onClick={() => navigate('/admin')}>
              {t('manual.openBoard')}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className="mx-auto max-w-3xl space-y-5 p-4">
        <p className="text-sm text-ink-muted">{t('manual.hint')}</p>

        {lines.length > 0 ? (
          <section className="overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-panel">
            <h2 className="border-b border-hairline px-3.5 py-2 text-sm font-semibold text-ink">
              {t('manual.tray')}
            </h2>
            <ul className="divide-y divide-hairline">
              {rows.map(({ line, name: label, modifiers }) => (
                <li key={line.key} className="flex items-center gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{label}</p>
                    {modifiers.length > 0 ? (
                      <p className="truncate text-xs text-ink-muted">{modifiers.join(', ')}</p>
                    ) : null}
                  </div>
                  <Stepper
                    size="sm"
                    value={line.qty}
                    min={1}
                    max={maxPerOrder}
                    onChange={(next) => setLineQty(line.key, next)}
                    labelIncrease={t('cart.increase')}
                    labelDecrease={t('cart.decrease')}
                  />
                  <button
                    type="button"
                    onClick={() => setLineQty(line.key, 0)}
                    aria-label={t('cart.removeNamed', { name: label })}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {menu.loading && !menu.data ? (
          <p className="py-10 text-center text-sm text-ink-muted">{t('manual.loading')}</p>
        ) : items.length === 0 ? (
          <p className="rounded-[var(--radius-md)] border border-dashed border-hairline px-4 py-10 text-center text-sm text-ink-muted">
            {t('manual.noMenu')}
          </p>
        ) : (
          <div className="space-y-5">
            {categories.map((category) => {
              const categoryItems = items.filter((item) => item.category_id === category.id)
              if (categoryItems.length === 0) return null
              return (
                <section key={category.id}>
                  <h2 className="mb-2 text-sm font-semibold text-ink">
                    {i18n.language === 'ms' ? category.name_ms : category.name_en}
                  </h2>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {categoryItems.map((item) => {
                      const soldOut = item.available_units !== null && item.available_units <= 0
                      const inTray = qtyInTray.get(item.id) ?? 0
                      return (
                        <button
                          key={item.id}
                          type="button"
                          disabled={soldOut}
                          onClick={() => setPicker(item)}
                          className={cx(
                            'flex items-center gap-3 rounded-[var(--radius-md)] border p-2.5 text-left transition-colors',
                            soldOut
                              ? 'border-dashed border-hairline opacity-60'
                              : 'border-hairline bg-panel hover:border-brand-500/50 hover:bg-panel-2/50',
                          )}
                        >
                          <div className="size-11 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-panel-2">
                            {item.image_url ? (
                              <img
                                src={item.image_url}
                                alt=""
                                width={1200}
                                height={900}
                                loading="lazy"
                                className="size-full object-cover"
                              />
                            ) : (
                              <CupArt className="size-full" tint="#12664A" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium text-ink">
                              {i18n.language === 'ms' ? item.name_ms : item.name_en}
                            </p>
                            <p className="tnum text-xs text-ink-muted">
                              {freeMode ? t('menu.free') : formatMoney(item.price)}
                            </p>
                          </div>
                          {soldOut ? (
                            <Chip tone="muted">{t('menu.soldOut')}</Chip>
                          ) : inTray > 0 ? (
                            <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-brand-700 text-sm font-bold text-cream-50">
                              {inTray}
                            </span>
                          ) : (
                            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-ink/6 text-ink-muted">
                              <Plus className="size-4" aria-hidden="true" />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </div>

      <div className="sticky bottom-0 border-t border-hairline bg-canvas/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <p className="tnum text-sm font-medium text-ink">
              {t('manual.cupCount', { count: cups })}
              {freeMode ? '' : ` · ${formatMoney(total)}`}
            </p>
            {overCap ? (
              <p className="text-xs font-medium text-danger">
                {t('manual.cupLimit', { count: maxPerOrder })}
              </p>
            ) : null}
          </div>
          <Button size="lg" disabled={lines.length === 0} onClick={() => setReviewOpen(true)}>
            {t('manual.review')}
          </Button>
        </div>
      </div>

      <ItemSheet
        item={picker}
        groups={groups}
        open={picker !== null}
        onClose={() => setPicker(null)}
        freeMode={freeMode}
        maxQty={maxPerOrder}
        remainingCups={null}
        onAdd={({ qty, optionIds }) => {
          if (!picker) return
          addToTray({
            menuItemId: picker.id,
            qty,
            optionIds,
            unitPrice:
              picker.price +
              optionIds.reduce((sum, optionId) => {
                for (const group of groups) {
                  const option = group.options.find((o) => o.id === optionId)
                  if (option) return sum + option.price_delta
                }
                return sum
              }, 0),
          })
        }}
      />

      <Sheet
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        title={t('manual.reviewTitle')}
        footer={
          <div className="space-y-3">
            {!freeMode ? (
              <div className="flex items-baseline justify-between">
                <span className="text-sm text-ink-muted">{t('cart.total')}</span>
                <span className="tnum font-display text-xl font-semibold text-ink">
                  {formatMoney(total)}
                </span>
              </div>
            ) : null}
            <Button
              size="lg"
              fullWidth
              loading={submitting}
              disabled={lines.length === 0 || overCap}
              onClick={() => void place()}
            >
              {submitting ? t('manual.placing') : t('manual.place')}
            </Button>
          </div>
        }
      >
        <div className="space-y-5">
          <Field
            label={t('manual.name')}
            placeholder={t('admin.walkIn')}
            hint={t('manual.nameHint')}
            value={name}
            onChange={(event) => setName(event.target.value.slice(0, 20))}
            maxLength={20}
            autoComplete="off"
          />

          <Field
            label={t('cart.note')}
            placeholder={t('cart.notePlaceholder')}
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, 140))}
            maxLength={140}
          />

          {freeMode ? (
            <p className="rounded-[var(--radius-md)] bg-panel-2 px-3.5 py-3 text-sm text-ink-muted">
              {t('manual.freeModeNote')}
            </p>
          ) : (
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-ink">{t('manual.payment')}</p>
              <Segmented<PaymentMethod>
                label={t('manual.payment')}
                value={payment}
                onChange={(next) => setPaymentChoice(next)}
                options={[
                  { value: 'cash', label: t('admin.cash') },
                  { value: 'transfer', label: t('admin.transfer') },
                ]}
              />
            </div>
          )}

          {overCap ? (
            <p className="text-sm font-medium text-danger">
              {t('manual.cupLimit', { count: maxPerOrder })}
            </p>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-3.5 py-3 text-sm text-danger"
            >
              {error}
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  )
}
