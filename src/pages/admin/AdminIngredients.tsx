import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { getBackend } from '../../lib/backend'
import { useIngredients } from '../../lib/hooks'
import type { Ingredient, Unit } from '../../lib/types'
import { Button, Chip, Field, Sheet, Skeleton, cx } from '../../components/ui'
import { useToast } from '../../components/Toast'

const UNITS: Unit[] = ['g', 'ml', 'pcs']

function round(value: number): number {
  return Math.round(value * 1000) / 1000
}

export function AdminIngredients() {
  const { t } = useTranslation()
  const ingredients = useIngredients()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<Ingredient | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Ingredient | null>(null)
  const [restockTarget, setRestockTarget] = useState<Ingredient | null>(null)
  const [restockAmount, setRestockAmount] = useState('1')
  const [busy, setBusy] = useState(false)

  const list = ingredients.data ?? []
  const unitLabel = (unit: Unit) =>
    unit === 'g' ? t('ingredients.unitG') : unit === 'ml' ? t('ingredients.unitMl') : t('ingredients.unitPcs')

  // A pack size turns grams into something the host actually buys.
  const packSize = (ingredient: Ingredient) =>
    ingredient.pack_size && ingredient.pack_size > 0 ? ingredient.pack_size : null
  const packName = (ingredient: Ingredient) =>
    ingredient.pack_name?.trim() || t('ingredients.packFallback')

  const save = async () => {
    if (!draft || !draft.name.trim()) return
    setBusy(true)
    try {
      const backend = await getBackend()
      await backend.saveIngredient({
        ...draft,
        name: draft.name.trim(),
        stock_qty: round(draft.stock_qty),
        full_level: round(draft.full_level),
        low_stock_threshold: round(draft.low_stock_threshold),
      })
      ingredients.refresh()
      setDraft(null)
      showToast({ message: t('ingredients.saved'), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const openRestock = (ingredient: Ingredient) => {
    setRestockTarget(ingredient)
    setRestockAmount('1')
  }

  const restockBase = (): number => {
    if (!restockTarget) return 0
    const qty = Number(restockAmount) || 0
    const size = packSize(restockTarget)
    return size ? round(qty * size) : round(qty)
  }

  const addStock = async () => {
    if (!restockTarget) return
    const amount = restockBase()
    if (amount <= 0) return
    setBusy(true)
    try {
      const backend = await getBackend()
      await backend.addIngredientStock(restockTarget.id, amount, 'restock')
      ingredients.refresh()
      setRestockTarget(null)
      showToast({ message: t('ingredients.added', { name: restockTarget.name }), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const fillToFull = () => {
    if (!restockTarget) return
    const missing = Math.max(0, round(restockTarget.full_level - restockTarget.stock_qty))
    const size = packSize(restockTarget)
    // Part packs are allowed, so do not round up to whole boxes.
    setRestockAmount(String(size ? round(missing / size) : missing))
  }

  const remove = async () => {
    if (!deleteTarget) return
    setBusy(true)
    try {
      const backend = await getBackend()
      await backend.deleteIngredient(deleteTarget.id)
      ingredients.refresh()
      setDeleteTarget(null)
      showToast({ message: t('ingredients.deleted'), tone: 'neutral' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-muted">{t('ingredients.hint')}</p>
        <Button
          onClick={() =>
            setDraft({
              id: crypto.randomUUID(),
              name: '',
              unit: 'g',
              stock_qty: 0,
              full_level: 1000,
              low_stock_threshold: 200,
              is_active: true,
            })
          }
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('ingredients.new')}
        </Button>
      </div>

      {ingredients.loading ? <Skeleton className="h-40 w-full" /> : null}

      {!ingredients.loading && list.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-hairline px-4 py-10 text-center text-sm text-ink-muted">
          {t('ingredients.empty')}
        </p>
      ) : null}

      {list.length > 0 ? (
        <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-panel">
          {list.map((ingredient) => {
            const out = ingredient.stock_qty <= 0
            const low = !out && ingredient.stock_qty <= ingredient.low_stock_threshold
            const pct =
              ingredient.full_level > 0
                ? Math.max(0, Math.min(100, (ingredient.stock_qty / ingredient.full_level) * 100))
                : 0
            return (
              <li key={ingredient.id} className="p-3">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 truncate text-sm font-medium text-ink">
                      {ingredient.name}
                      {!ingredient.is_active ? (
                        <span className="text-xs font-normal text-ink-muted">({t('ingredients.inactive')})</span>
                      ) : null}
                    </p>
                    <p className="tnum text-xs text-ink-muted">
                      {ingredient.stock_qty} / {ingredient.full_level} {unitLabel(ingredient.unit)}
                    </p>
                    {packSize(ingredient) ? (
                      <p className="tnum text-xs text-ink-muted">
                        {t('ingredients.packSizeLine', {
                          pack: packName(ingredient),
                          size: packSize(ingredient),
                          unit: unitLabel(ingredient.unit),
                        })}
                      </p>
                    ) : null}
                  </div>

                  {out ? (
                    <Chip tone="danger">{t('ingredients.outChip')}</Chip>
                  ) : low ? (
                    <Chip tone="warning">{t('ingredients.lowChip')}</Chip>
                  ) : null}

                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => openRestock(ingredient)}
                    disabled={busy}
                  >
                    {t('ingredients.restock')}
                  </Button>
                  <button
                    type="button"
                    onClick={() => setDraft({ ...ingredient })}
                    className="min-h-9 rounded-full border border-hairline px-3 text-sm font-medium text-ink hover:bg-ink/5"
                  >
                    {t('ingredients.edit')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('ingredients.deleteNamed', { name: ingredient.name })}
                    onClick={() => setDeleteTarget(ingredient)}
                    className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </div>

                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-hidden="true">
                  <div
                    className={cx(
                      'h-full rounded-full',
                      out ? 'bg-danger' : low ? 'bg-warning' : 'bg-brand-500',
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </li>
            )
          })}
        </ul>
      ) : null}

      {/* ------------------------------------------------------------- edit */}
      <Sheet
        open={Boolean(draft)}
        onClose={() => setDraft(null)}
        title={draft && list.some((i) => i.id === draft.id) ? t('ingredients.editTitle') : t('ingredients.new')}
        footer={
          <Button fullWidth size="lg" loading={busy} onClick={() => void save()} disabled={!draft?.name.trim()}>
            {t('ingredients.save')}
          </Button>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <Field
              label={t('ingredients.name')}
              value={draft.name}
              maxLength={40}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
            <div className="space-y-1.5">
              <label htmlFor="unit" className="block text-sm font-medium text-ink">
                {t('ingredients.unit')}
              </label>
              <select
                id="unit"
                value={draft.unit}
                onChange={(event) => setDraft({ ...draft, unit: event.target.value as Unit })}
                className="h-13 w-full rounded-[var(--radius-md)] border border-hairline bg-panel px-3.5 text-base text-ink"
              >
                {UNITS.map((unit) => (
                  <option key={unit} value={unit}>
                    {unitLabel(unit)} ({unit})
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('ingredients.stock')}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={String(draft.stock_qty)}
                onChange={(event) => setDraft({ ...draft, stock_qty: Number(event.target.value) || 0 })}
              />
              <Field
                label={t('ingredients.full')}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={String(draft.full_level)}
                onChange={(event) => setDraft({ ...draft, full_level: Number(event.target.value) || 0 })}
              />
            </div>
            <Field
              label={t('ingredients.low')}
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={String(draft.low_stock_threshold)}
              onChange={(event) => setDraft({ ...draft, low_stock_threshold: Number(event.target.value) || 0 })}
            />
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('ingredients.packSize')}
                type="number"
                min={0}
                step="any"
                inputMode="decimal"
                value={draft.pack_size === null || draft.pack_size === undefined ? '' : String(draft.pack_size)}
                onChange={(event) =>
                  setDraft({ ...draft, pack_size: event.target.value === '' ? null : Number(event.target.value) })
                }
              />
              <Field
                label={t('ingredients.packName')}
                value={draft.pack_name ?? ''}
                maxLength={16}
                placeholder={t('ingredients.packFallback')}
                onChange={(event) => setDraft({ ...draft, pack_name: event.target.value })}
              />
            </div>
            <p className="text-xs text-ink-muted">{t('ingredients.packHint')}</p>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
                className="mt-0.5 size-5 accent-[var(--color-brand-700)]"
              />
              <span>
                <span className="block text-sm font-medium text-ink">{t('ingredients.active')}</span>
                <span className="block text-xs text-ink-muted">{t('ingredients.activeHint')}</span>
              </span>
            </label>
          </div>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------------ restock */}
      <Sheet
        open={Boolean(restockTarget)}
        onClose={() => setRestockTarget(null)}
        title={t('ingredients.addStockTitle')}
        footer={
          <Button fullWidth size="lg" loading={busy} onClick={() => void addStock()} disabled={restockBase() <= 0}>
            {t('ingredients.addStockAction')}
          </Button>
        }
      >
        {restockTarget ? (
          <div className="space-y-4">
            <p className="tnum text-sm text-ink">
              {restockTarget.name} · {restockTarget.stock_qty} {unitLabel(restockTarget.unit)}
            </p>
            <Field
              label={
                packSize(restockTarget)
                  ? t('ingredients.addStockPacks')
                  : t('ingredients.addStockUnits', { unit: unitLabel(restockTarget.unit) })
              }
              hint={
                packSize(restockTarget)
                  ? t('ingredients.packSizeLine', {
                      pack: packName(restockTarget),
                      size: packSize(restockTarget),
                      unit: unitLabel(restockTarget.unit),
                    })
                  : undefined
              }
              type="number"
              min={0}
              step="any"
              inputMode="decimal"
              value={restockAmount}
              onChange={(event) => setRestockAmount(event.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button size="sm" variant="secondary" onClick={fillToFull}>
                {t('ingredients.fillToFull')}
              </Button>
              <p className="tnum text-sm text-ink-muted">
                {t('ingredients.addStockPreview', {
                  before: restockTarget.stock_qty,
                  after: round(restockTarget.stock_qty + restockBase()),
                  unit: unitLabel(restockTarget.unit),
                })}
              </p>
            </div>
          </div>
        ) : null}
      </Sheet>

      {/* ----------------------------------------------------------- delete */}
      <Sheet open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title={t('ingredients.deleteTitle')}>
        <p className="text-sm text-ink-muted">
          {deleteTarget ? t('ingredients.deleteConfirm', { name: deleteTarget.name }) : null}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="danger" size="lg" fullWidth loading={busy} onClick={() => void remove()}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('ingredients.deleteYes')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setDeleteTarget(null)}>
            {t('ingredients.deleteNo')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
