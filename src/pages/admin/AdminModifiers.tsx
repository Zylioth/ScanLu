import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { getBackend } from '../../lib/backend'
import { useMenu } from '../../lib/hooks'
import type { ModifierGroup, ModifierGroupInput, ModifierOption, ModifierOptionInput } from '../../lib/types'
import { Button, Field, Sheet, Stepper } from '../../components/ui'
import { useToast } from '../../components/Toast'

interface Ingredient {
  id: string
  name: string
  unit: string
}

type Confirm =
  | { kind: 'group'; group: ModifierGroup; usedBy: number }
  | { kind: 'option'; option: ModifierOption; group: ModifierGroup }
  | null

function groupToDraft(group: ModifierGroup): ModifierGroupInput {
  return {
    id: group.id,
    name_en: group.name_en,
    name_ms: group.name_ms,
    min_select: group.min_select,
    max_select: group.max_select,
  }
}

export function AdminModifiers() {
  const { t, i18n } = useTranslation()
  const menu = useMenu()
  const { showToast } = useToast()

  const [ingredients, setIngredients] = useState<Ingredient[]>([])
  const [groupDraft, setGroupDraft] = useState<ModifierGroupInput | null>(null)
  const [optionDraft, setOptionDraft] = useState<ModifierOptionInput | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const backend = await getBackend()
      const list = await backend.getIngredients()
      setIngredients(list.map((i) => ({ id: i.id, name: i.name, unit: i.unit })))
    })()
  }, [])

  const groups = menu.data?.groups ?? []
  const items = menu.data?.items ?? []
  const label = (group: { name_en: string; name_ms: string }) =>
    i18n.language === 'ms' ? group.name_ms : group.name_en
  const usedBy = (groupId: string) => items.filter((i) => i.modifier_group_ids.includes(groupId)).length

  const saveGroup = async () => {
    if (!groupDraft || !groupDraft.name_en.trim()) return
    setBusy(true)
    try {
      const backend = await getBackend()
      await backend.saveModifierGroup({
        ...groupDraft,
        name_en: groupDraft.name_en.trim(),
        name_ms: groupDraft.name_ms.trim() || groupDraft.name_en.trim(),
        max_select: Math.max(groupDraft.min_select, groupDraft.max_select),
      })
      menu.refresh()
      setGroupDraft(null)
      showToast({ message: t('modifiers.saved'), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const saveOption = async () => {
    if (!optionDraft || !optionDraft.name_en.trim()) return
    setBusy(true)
    try {
      const backend = await getBackend()
      await backend.saveModifierOption({
        ...optionDraft,
        name_en: optionDraft.name_en.trim(),
        name_ms: optionDraft.name_ms.trim() || optionDraft.name_en.trim(),
        ingredient_qty: optionDraft.ingredient_id ? (optionDraft.ingredient_qty ?? 0) : null,
      })
      menu.refresh()
      setOptionDraft(null)
      showToast({ message: t('modifiers.saved'), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirm) return
    setBusy(true)
    try {
      const backend = await getBackend()
      if (confirm.kind === 'group') await backend.deleteModifierGroup(confirm.group.id)
      else await backend.deleteModifierOption(confirm.option.id)
      menu.refresh()
      setConfirm(null)
      showToast({ message: t('modifiers.deleted'), tone: 'neutral' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4 pb-16">
      <div className="flex flex-wrap items-center gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink-muted">{t('modifiers.hint')}</p>
        <Button
          onClick={() => setGroupDraft({ id: crypto.randomUUID(), name_en: '', name_ms: '', min_select: 1, max_select: 1 })}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t('modifiers.newGroup')}
        </Button>
      </div>

      {groups.length === 0 ? (
        <p className="rounded-[var(--radius-md)] border border-dashed border-hairline px-4 py-10 text-center text-sm text-ink-muted">
          {t('modifiers.empty')}
        </p>
      ) : null}

      {groups.map((group) => {
        const count = usedBy(group.id)
        return (
          <section key={group.id} className="overflow-hidden rounded-[var(--radius-lg)] border border-hairline bg-panel">
            <header className="flex items-center gap-2 border-b border-hairline px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <h2 className="truncate font-medium text-ink">{label(group)}</h2>
                <p className="text-xs text-ink-muted">
                  {group.min_select === group.max_select
                    ? t('modifiers.pickExactly', { count: group.max_select })
                    : t('modifiers.pickRange', { min: group.min_select, max: group.max_select })}
                  {' · '}
                  {count === 0 ? t('modifiers.usedByNobody') : t('modifiers.usedBy', { count })}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setGroupDraft(groupToDraft(group))}
                className="min-h-9 rounded-full border border-hairline px-3 text-sm font-medium text-ink hover:bg-ink/5"
              >
                {t('menuAdmin.edit')}
              </button>
              <button
                type="button"
                aria-label={t('modifiers.deleteGroupNamed', { name: label(group) })}
                onClick={() => setConfirm({ kind: 'group', group, usedBy: count })}
                className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 className="size-4" aria-hidden="true" />
              </button>
            </header>

            <ul className="divide-y divide-hairline">
              {group.options.map((option) => {
                const linked = option.ingredient_id
                  ? ingredients.find((i) => i.id === option.ingredient_id)
                  : null
                return (
                  <li key={option.id} className="flex items-center gap-2 px-3 py-2">
                    <button
                      type="button"
                      onClick={() =>
                        setOptionDraft({
                          id: option.id,
                          group_id: group.id,
                          name_en: option.name_en,
                          name_ms: option.name_ms,
                          price_delta: option.price_delta,
                          ingredient_id: option.ingredient_id ?? null,
                          ingredient_qty: option.ingredient_qty ?? null,
                        })
                      }
                      className="min-w-0 flex-1 text-left"
                    >
                      <span className="block truncate text-sm text-ink">{label(option)}</span>
                      {linked ? (
                        <span className="block text-xs text-ink-muted">
                          {t('modifiers.usesIngredient', { name: linked.name, qty: option.ingredient_qty, unit: linked.unit })}
                        </span>
                      ) : null}
                    </button>
                    <button
                      type="button"
                      aria-label={t('modifiers.deleteOptionNamed', { name: label(option) })}
                      onClick={() => setConfirm({ kind: 'option', option, group })}
                      className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
              <li className="px-3 py-2">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() =>
                    setOptionDraft({
                      id: crypto.randomUUID(),
                      group_id: group.id,
                      name_en: '',
                      name_ms: '',
                      price_delta: 0,
                      ingredient_id: null,
                      ingredient_qty: null,
                    })
                  }
                >
                  <Plus className="size-4" aria-hidden="true" />
                  {t('modifiers.newOption')}
                </Button>
              </li>
            </ul>
          </section>
        )
      })}

      {/* -------------------------------------------------------- group form */}
      <Sheet
        open={Boolean(groupDraft)}
        onClose={() => setGroupDraft(null)}
        title={groupDraft && groups.some((g) => g.id === groupDraft.id) ? t('modifiers.editGroup') : t('modifiers.newGroup')}
        footer={
          <Button fullWidth size="lg" loading={busy} onClick={() => void saveGroup()} disabled={!groupDraft?.name_en.trim()}>
            {t('modifiers.save')}
          </Button>
        }
      >
        {groupDraft ? (
          <div className="space-y-4">
            <Field
              label={t('modifiers.nameEn')}
              value={groupDraft.name_en}
              maxLength={40}
              onChange={(event) => setGroupDraft({ ...groupDraft, name_en: event.target.value })}
            />
            <Field
              label={t('modifiers.nameMs')}
              value={groupDraft.name_ms}
              maxLength={40}
              onChange={(event) => setGroupDraft({ ...groupDraft, name_ms: event.target.value })}
            />
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{t('modifiers.minSelect')}</span>
                <Stepper
                  value={groupDraft.min_select}
                  min={0}
                  max={9}
                  onChange={(next) =>
                    setGroupDraft({
                      ...groupDraft,
                      min_select: next,
                      max_select: Math.max(groupDraft.max_select, next),
                    })
                  }
                  labelIncrease={t('cart.increase')}
                  labelDecrease={t('cart.decrease')}
                />
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium text-ink">{t('modifiers.maxSelect')}</span>
                <Stepper
                  value={groupDraft.max_select}
                  min={groupDraft.min_select}
                  max={9}
                  onChange={(next) => setGroupDraft({ ...groupDraft, max_select: next })}
                  labelIncrease={t('cart.increase')}
                  labelDecrease={t('cart.decrease')}
                />
              </div>
              <p className="text-xs text-ink-muted">{t('modifiers.minZeroHint')}</p>
            </div>
          </div>
        ) : null}
      </Sheet>

      {/* ------------------------------------------------------- option form */}
      <Sheet
        open={Boolean(optionDraft)}
        onClose={() => setOptionDraft(null)}
        title={
          optionDraft && (menu.data?.groups ?? []).some((g) => g.options.some((o) => o.id === optionDraft.id))
            ? t('modifiers.editOption')
            : t('modifiers.newOption')
        }
        footer={
          <Button fullWidth size="lg" loading={busy} onClick={() => void saveOption()} disabled={!optionDraft?.name_en.trim()}>
            {t('modifiers.save')}
          </Button>
        }
      >
        {optionDraft ? (
          <div className="space-y-4">
            <Field
              label={t('modifiers.nameEn')}
              value={optionDraft.name_en}
              maxLength={40}
              onChange={(event) => setOptionDraft({ ...optionDraft, name_en: event.target.value })}
            />
            <Field
              label={t('modifiers.nameMs')}
              value={optionDraft.name_ms}
              maxLength={40}
              onChange={(event) => setOptionDraft({ ...optionDraft, name_ms: event.target.value })}
            />
            <div className="space-y-1.5">
              <label htmlFor="option-ingredient" className="block text-sm font-medium text-ink">
                {t('modifiers.ingredient')}
              </label>
              <select
                id="option-ingredient"
                value={optionDraft.ingredient_id ?? ''}
                onChange={(event) =>
                  setOptionDraft({
                    ...optionDraft,
                    ingredient_id: event.target.value || null,
                    ingredient_qty: event.target.value ? (optionDraft.ingredient_qty ?? 1) : null,
                  })
                }
                className="h-13 w-full rounded-[var(--radius-md)] border border-hairline bg-panel px-3.5 text-base text-ink"
              >
                <option value="">{t('modifiers.noIngredient')}</option>
                {ingredients.map((ingredient) => (
                  <option key={ingredient.id} value={ingredient.id}>
                    {ingredient.name}
                  </option>
                ))}
              </select>
              <p className="text-xs text-ink-muted">{t('modifiers.ingredientHint')}</p>
            </div>
            {optionDraft.ingredient_id ? (
              <Field
                label={t('modifiers.ingredientQty')}
                type="number"
                min={0}
                step={1}
                inputMode="decimal"
                value={String(optionDraft.ingredient_qty ?? 0)}
                onChange={(event) =>
                  setOptionDraft({ ...optionDraft, ingredient_qty: Number(event.target.value) || 0 })
                }
              />
            ) : null}
          </div>
        ) : null}
      </Sheet>

      {/* ----------------------------------------------------------- confirm */}
      <Sheet open={Boolean(confirm)} onClose={() => setConfirm(null)} title={t('modifiers.deleteTitle')}>
        <p className="text-sm text-ink-muted">
          {confirm?.kind === 'group'
            ? t('modifiers.deleteGroupConfirm', { name: label(confirm.group), count: confirm.usedBy })
            : confirm?.kind === 'option'
              ? t('modifiers.deleteOptionConfirm', { name: label(confirm.option) })
              : null}
        </p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="danger" size="lg" fullWidth loading={busy} onClick={() => void remove()}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('modifiers.deleteYes')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setConfirm(null)}>
            {t('modifiers.deleteNo')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
