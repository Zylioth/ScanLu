import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { MenuItemView, ModifierGroup } from '../lib/types'
import { formatMoney } from '../lib/format'
import { Button, Sheet, Stepper, cx } from './ui'

function groupLabel(group: ModifierGroup, language: string): string {
  return language === 'ms' ? group.name_ms : group.name_en
}

function optionLabel(group: ModifierGroup, optionId: string, language: string): string {
  const option = group.options.find((o) => o.id === optionId)
  if (!option) return ''
  return language === 'ms' ? option.name_ms : option.name_en
}

/** Illustrated fallback so a drink without a photo still reads as a drink. */
export function CupArt({ className, tint }: { className?: string; tint: string }) {
  return (
    <svg viewBox="0 0 120 90" className={className} role="img" aria-label="">
      <rect width="120" height="90" fill={tint} opacity="0.14" />
      <path d="M38 30h40v22a20 20 0 0 1-40 0z" fill={tint} opacity="0.85" />
      <path d="M78 35h6a8 8 0 0 1 0 16h-6" fill="none" stroke={tint} strokeWidth="3.4" />
      <path d="M48 22c0-4 3-5 3-9M60 22c0-4 3-5 3-9M72 22c0-4 3-5 3-9" stroke={tint} strokeWidth="2.6" strokeLinecap="round" opacity="0.55" fill="none" />
      <ellipse cx="60" cy="76" rx="30" ry="3.4" fill={tint} opacity="0.25" />
    </svg>
  )
}

export function ItemSheet({
  item,
  groups,
  open,
  onClose,
  onAdd,
  freeMode,
  maxQty,
  remainingCups,
}: {
  item: MenuItemView | null
  groups: ModifierGroup[]
  open: boolean
  onClose: () => void
  onAdd: (payload: { qty: number; optionIds: string[]; unitPrice: number }) => void
  freeMode: boolean
  maxQty: number
  remainingCups: number | null
}) {
  const { t, i18n } = useTranslation()
  const language = i18n.language

  const relevantGroups = useMemo(
    () => (item ? groups.filter((g) => item.modifier_group_ids.includes(g.id)) : []),
    [item, groups],
  )

  const [selected, setSelected] = useState<Record<string, string[]>>({})
  const [qty, setQty] = useState(1)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (!open || !item) return
    const initial: Record<string, string[]> = {}
    for (const group of relevantGroups) {
      initial[group.id] = group.min_select > 0 ? [group.options[0].id] : []
    }
    setSelected(initial)
    setQty(1)
    setTouched(false)
  }, [open, item, relevantGroups])

  if (!item) return null

  const limit = Math.max(1, Math.min(maxQty, remainingCups ?? maxQty))
  const cappedByStock = item.available_units !== null ? item.available_units : Number.POSITIVE_INFINITY
  const effectiveLimit = Math.max(1, Math.min(limit, cappedByStock))

  const optionIds = Object.values(selected).flat()
  const unitPrice = optionIds.reduce((price, optionId) => {
    for (const group of relevantGroups) {
      const option = group.options.find((o) => o.id === optionId)
      if (option) return price + option.price_delta
    }
    return price
  }, item.price)

  const missingRequired = relevantGroups.filter(
    (group) => group.min_select > 0 && (selected[group.id]?.length ?? 0) < group.min_select,
  )

  const toggleOption = (group: ModifierGroup, optionId: string) => {
    setSelected((prev) => {
      const current = prev[group.id] ?? []
      const isChosen = current.includes(optionId)
      if (group.max_select === 1) {
        if (isChosen && group.min_select === 1) return prev
        return { ...prev, [group.id]: isChosen ? [] : [optionId] }
      }
      if (isChosen) {
        return { ...prev, [group.id]: current.filter((id) => id !== optionId) }
      }
      if (current.length >= group.max_select) return prev
      return { ...prev, [group.id]: [...current, optionId] }
    })
  }

  const submit = () => {
    setTouched(true)
    if (missingRequired.length > 0) return
    onAdd({ qty, optionIds, unitPrice })
    onClose()
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={language === 'ms' ? item.name_ms : item.name_en}
      footer={
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Stepper
              value={qty}
              min={1}
              max={effectiveLimit}
              onChange={setQty}
              labelIncrease={t('cart.increase')}
              labelDecrease={t('cart.decrease')}
            />
            {!freeMode ? (
              <span className="tnum text-xl font-semibold">{formatMoney(unitPrice * qty)}</span>
            ) : null}
          </div>
          <Button size="lg" fullWidth onClick={submit} disabled={effectiveLimit < 1}>
            {freeMode
              ? t('item.addToOrder')
              : t('item.addToOrderPrice', { price: formatMoney(unitPrice * qty) })}
          </Button>
          {effectiveLimit <= 1 && item.available_units !== null ? (
            <p className="text-center text-xs text-warning-ink">{t('menu.onlyLeft', { count: item.available_units })}</p>
          ) : null}
        </div>
      }
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-[var(--radius-md)] bg-panel-2">
          {item.image_url ? (
            <img
              src={item.image_url}
              alt=""
              width={1200}
              height={900}
              className="aspect-4/3 w-full object-cover"
            />
          ) : (
            <CupArt className="aspect-4/3 w-full" tint="#12664A" />
          )}
        </div>

        <p className="text-sm text-ink-muted">
          {language === 'ms' ? item.description_ms : item.description_en}
        </p>

        {relevantGroups.map((group) => {
          const chosen = selected[group.id] ?? []
          const invalid = touched && group.min_select > 0 && chosen.length < group.min_select
          return (
            <fieldset key={group.id} className="space-y-2">
              <legend className="flex w-full items-baseline justify-between gap-2 text-sm font-semibold text-ink">
                <span>{groupLabel(group, language)}</span>
                <span className={cx('text-xs font-normal', invalid ? 'text-danger' : 'text-ink-muted')}>
                  {group.min_select > 0 ? t('item.choose') : t('item.optional')}
                </span>
              </legend>
              <div className="flex flex-wrap gap-2">
                {group.options.map((option) => {
                  const active = chosen.includes(option.id)
                  return (
                    <button
                      key={option.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleOption(group, option.id)}
                      className={cx(
                        'inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 text-sm font-medium transition-colors',
                        active
                          ? 'border-brand-700 bg-brand-700 text-cream-50'
                          : 'border-hairline bg-panel text-ink hover:border-brand-500/60',
                      )}
                    >
                      {optionLabel(group, option.id, language)}
                      {option.price_delta > 0 ? (
                        <span className={cx('text-xs', active ? 'text-gold-300' : 'text-ink-muted')}>
                          +{formatMoney(option.price_delta)}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
              </div>
              {invalid ? <p className="text-xs font-medium text-danger">{t('item.required')}</p> : null}
            </fieldset>
          )
        })}
      </div>
    </Sheet>
  )
}
