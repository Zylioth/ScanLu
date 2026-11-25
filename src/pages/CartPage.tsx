import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, Trash2 } from 'lucide-react'
import { useMenu, usePublicStatus } from '../lib/hooks'
import { cartCupCount, useCart } from '../lib/store'
import { getBackend } from '../lib/backend'
import { describeOrderError } from '../lib/errors'
import { unlockAudio } from '../lib/audio'
import { formatMoney } from '../lib/format'
import { Banner, Button, Field, Stepper, cx } from '../components/ui'
import { CupArt } from '../components/ItemSheet'

export function CartPage() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const menu = useMenu()
  const status = usePublicStatus()
  const cart = useCart()

  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)

  const cups = cartCupCount(cart.lines)
  const maxPerOrder = status.data?.max_cups_per_order ?? 2
  const freeMode = status.data?.free_mode ?? false
  const ordersOpen = status.data?.orders_open ?? true

  const rows = useMemo(() => {
    const items = menu.data?.items ?? []
    const groups = menu.data?.groups ?? []
    return cart.lines.map((line) => {
      const item = items.find((i) => i.id === line.menuItemId)
      const modifiers = line.optionIds
        .map((optionId) => {
          for (const group of groups) {
            const option = group.options.find((o) => o.id === optionId)
            if (option) {
              return {
                group: i18n.language === 'ms' ? group.name_ms : group.name_en,
                label: i18n.language === 'ms' ? option.name_ms : option.name_en,
              }
            }
          }
          return null
        })
        .filter((value): value is { group: string; label: string } => value !== null)
      return {
        line,
        name: item ? (i18n.language === 'ms' ? item.name_ms : item.name_en) : 'Drink',
        image: item?.image_url ?? null,
        modifiers,
      }
    })
  }, [cart.lines, menu.data, i18n.language])

  const total = cart.lines.reduce((sum, line) => sum + line.unitPrice * line.qty, 0)

  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [])

  const placeOrder = async () => {
    setError(null)
    setNameError(null)

    if (status.data?.require_name && cart.customerName.trim().length === 0) {
      setNameError(t('error.NAME_REQUIRED'))
      return
    }

    // Silent audio unlock, timed to the user gesture (system.md §9.1).
    void unlockAudio()

    setSubmitting(true)
    try {
      const backend = await getBackend()
      const result = await backend.placeOrder({
        customer_name: cart.customerName.trim(),
        note: cart.note.trim() || undefined,
        items: cart.lines.map((line) => ({
          menu_item_id: line.menuItemId,
          qty: line.qty,
          modifier_option_ids: line.optionIds,
        })),
      })
      cart.clear()
      navigate(`/ticket/${result.order_id}`, { replace: true })
    } catch (caught) {
      setError(describeOrderError(caught, t, { maxCupsPerOrder: maxPerOrder }))
    } finally {
      setSubmitting(false)
    }
  }

  if (!menu.loading && cart.lines.length === 0) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
        <CupArt className="w-40 opacity-70" tint="#12664A" />
        <div>
          <h1 className="font-display text-2xl text-ink">{t('cart.empty')}</h1>
          <p className="mt-1 text-sm text-ink-muted">{t('cart.emptyBody')}</p>
        </div>
        <Button onClick={() => navigate('/menu')}>{t('cart.backToMenu')}</Button>
      </div>
    )
  }

  return (
    <div className="min-h-dvh bg-canvas pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-hairline bg-canvas/92 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2 backdrop-blur-md">
        <Link
          to="/menu"
          aria-label={t('cart.backToMenu')}
          className="grid size-11 place-items-center rounded-full text-ink hover:bg-ink/6"
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <h1 className="font-display text-lg font-semibold text-ink">{t('cart.title')}</h1>
      </header>

      <main className="mx-auto w-full max-w-md space-y-5 px-4 pt-4">
        {!ordersOpen ? (
          <Banner tone="danger">{status.data?.banner || t('menu.pausedBody')}</Banner>
        ) : null}

        <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-panel">
          {rows.map(({ line, name, image, modifiers }) => (
            <li key={line.key} className="flex gap-3 p-3">
              <div className="size-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-panel-2">
                {image ? (
                  <img src={image} alt="" width={1200} height={900} className="size-full object-cover" />
                ) : (
                  <CupArt className="size-full" tint="#12664A" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-medium text-ink">{name}</p>
                  {!freeMode ? (
                    <span className="tnum shrink-0 text-sm text-ink-muted">
                      {formatMoney(line.unitPrice * line.qty)}
                    </span>
                  ) : null}
                </div>
                {modifiers.length > 0 ? (
                  <p className="mt-0.5 text-xs leading-snug text-ink-muted">
                    {modifiers.map((m) => m.label).join(', ')}
                  </p>
                ) : null}
                <div className="mt-2 flex items-center justify-between">
                  <Stepper
                    size="sm"
                    value={line.qty}
                    min={1}
                    max={maxPerOrder}
                    onChange={(next) => cart.setQty(line.key, next)}
                    labelIncrease={t('cart.increase')}
                    labelDecrease={t('cart.decrease')}
                  />
                  <button
                    type="button"
                    onClick={() => cart.removeLine(line.key)}
                    aria-label={t('cart.removeNamed', { name })}
                    className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>

        <Field
          label={t('cart.name')}
          hint={t('cart.nameHint')}
          placeholder={t('cart.namePlaceholder')}
          value={cart.customerName}
          onChange={(event) => cart.setCustomerName(event.target.value.slice(0, 20))}
          maxLength={20}
          autoComplete="given-name"
          error={nameError ?? undefined}
        />

        <Field
          label={t('cart.note')}
          placeholder={t('cart.notePlaceholder')}
          value={cart.note}
          onChange={(event) => cart.setNote(event.target.value.slice(0, 140))}
          maxLength={140}
        />

        <div className="space-y-1.5 rounded-[var(--radius-md)] bg-panel-2 px-3.5 py-3 text-sm">
          <p className="font-medium text-ink">
            {freeMode ? t('cart.free') : t('cart.payAtCounter')}
          </p>
          <p className="text-xs text-ink-muted">{t('cart.limitPerOrder', { count: maxPerOrder })}</p>
          {status.data?.person_remaining !== null && status.data?.person_remaining !== undefined ? (
            <p className="text-xs text-ink-muted">
              {t('cart.limitLeft', { count: Math.max(0, status.data.person_remaining - cups) })}
            </p>
          ) : null}
          {cups > maxPerOrder ? (
            <p className="text-xs font-medium text-danger">
              {t('cart.limitPerOrder', { count: maxPerOrder })}
            </p>
          ) : null}
        </div>

        {error ? (
          <div role="alert" className="rounded-[var(--radius-md)] border border-danger/30 bg-danger/8 px-3.5 py-3 text-sm text-danger">
            {error}
          </div>
        ) : null}
      </main>

      <div
        className="fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t border-hairline bg-canvas/95 px-4 pt-3 backdrop-blur-md"
        style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
      >
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-sm text-ink-muted">{t('cart.total')}</span>
          <span className={cx('tnum font-display text-xl font-semibold text-ink', freeMode && 'text-base text-ink-muted')}>
            {freeMode ? t('menu.free') : formatMoney(total)}
          </span>
        </div>
        <Button
          size="lg"
          fullWidth
          loading={submitting}
          disabled={!ordersOpen || cups === 0}
          onClick={() => void placeOrder()}
        >
          {submitting ? t('cart.placing') : t('cart.placeOrder')}
        </Button>
      </div>
    </div>
  )
}
