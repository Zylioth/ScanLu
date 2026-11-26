import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Camera, ImageOff, Plus, Trash2 } from 'lucide-react'
import { getBackend } from '../../lib/backend'
import { useAllMenuItems, useMenu, useSettings } from '../../lib/hooks'
import type { MenuItem, MenuItemView } from '../../lib/types'
import { formatMoney } from '../../lib/format'
import { blobToDataUrl, processImage, validateImageFile } from '../../lib/image'
import { Button, Field, Sheet, Stepper } from '../../components/ui'
import { useToast } from '../../components/Toast'
import { CupArt } from '../../components/ItemSheet'

interface Draft {
  id: string
  category_id: string
  name_en: string
  name_ms: string
  description_en: string
  description_ms: string
  price: number
  image_url: string | null
  is_active: boolean
  is_sold_out_manual: boolean
  sort_order: number
  hourly_cap: number | null
  prep_seconds: number
  modifier_group_ids: string[]
  recipe: Array<{ ingredient_id: string; qty: number }>
}

function toDraft(item: MenuItem): Draft {
  return {
    id: item.id,
    category_id: item.category_id,
    name_en: item.name_en,
    name_ms: item.name_ms,
    description_en: item.description_en,
    description_ms: item.description_ms,
    price: item.price,
    image_url: item.image_url,
    is_active: item.is_active,
    is_sold_out_manual: item.is_sold_out_manual,
    sort_order: item.sort_order,
    hourly_cap: item.hourly_cap,
    prep_seconds: item.prep_seconds,
    modifier_group_ids: item.modifier_group_ids,
    recipe: item.recipe.map((line) => ({ ...line })),
  }
}

export function AdminMenu() {
  const { t, i18n } = useTranslation()
  const menu = useMenu()
  const allItems = useAllMenuItems()
  const settings = useSettings()
  const { showToast } = useToast()

  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [photoBusy, setPhotoBusy] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const [zoom, setZoom] = useState(1)
  const [deleteTarget, setDeleteTarget] = useState<MenuItemView | null>(null)
  // The processed photo waiting to be uploaded, and whether the saved one
  // should be removed. Neither is applied until Save.
  const [photoBlob, setPhotoBlob] = useState<Blob | null>(null)
  const [photoCleared, setPhotoCleared] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [ingredientError, setIngredientError] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastFile = useRef<File | null>(null)

  const categories = menu.data?.categories ?? []
  // Every item, including the ones switched off: the guest query filters them
  // out, which used to make an inactive drink impossible to switch back on.
  const items = allItems.data ?? []
  const freeMode = settings.data?.free_mode ?? false

  const grouped = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: items.filter((item) => item.category_id === category.id),
      })),
    [categories, items],
  )

  const [ingredientList, setIngredientList] = useState<Array<{ id: string; name: string; unit: string }>>([])
  useEffect(() => {
    void (async () => {
      try {
        const backend = await getBackend()
        const list = await backend.getIngredients()
        setIngredientList(list.map((i) => ({ id: i.id, name: i.name, unit: i.unit })))
      } catch {
        // Previously this failed silently and the recipe control just looked empty.
        setIngredientError(true)
      }
    })()
  }, [])

  const groups = menu.data?.groups ?? []

  const openNew = () => {
    const firstCategory = categories[0]?.id ?? ''
    setDraft({
      id: crypto.randomUUID(),
      category_id: firstCategory,
      name_en: '',
      name_ms: '',
      description_en: '',
      description_ms: '',
      price: 0,
      image_url: null,
      is_active: true,
      is_sold_out_manual: false,
      sort_order: (items.at(-1)?.sort_order ?? 0) + 1,
      hourly_cap: null,
      prep_seconds: 120,
      modifier_group_ids: [],
      recipe: [],
    })
    setZoom(1)
    setPhotoError(null)
    setPhotoBlob(null)
    setPhotoCleared(false)
    setPickerOpen(false)
  }

  const applyFile = async (file: File, zoomValue: number) => {
    setPhotoError(null)
    const invalid = validateImageFile(file)
    if (invalid) {
      setPhotoError(invalid === 'too_large' ? t('menuAdmin.photoTooLarge') : t('menuAdmin.notAnImage'))
      return
    }
    setPhotoBusy(true)
    try {
      const blob = await processImage(file, { maxWidth: 1200, maxHeight: 900, quality: 0.8, zoom: zoomValue })
      const dataUrl = await blobToDataUrl(blob)
      // Keep the processed blob itself: it is what gets uploaded, so the zoom
      // chosen here is exactly what the guest sees.
      setPhotoBlob(blob)
      setPhotoCleared(false)
      setDraft((prev) => (prev ? { ...prev, image_url: dataUrl } : prev))
    } catch {
      setPhotoError(t('menuAdmin.processing'))
    } finally {
      setPhotoBusy(false)
    }
  }

  const save = async () => {
    if (!draft) return
    if (!draft.name_en.trim()) return
    setSaving(true)
    try {
      const backend = await getBackend()
      const pending = photoBlob
      const cleared = photoCleared
      // A freshly picked photo is only a preview here. Sending it would store
      // base64 in the row instead of a file, which is what bloated the menu.
      const saved = await backend.saveMenuItem({
        ...draft,
        name_ms: draft.name_ms.trim() || draft.name_en.trim(),
        description_ms: draft.description_ms.trim() || draft.description_en.trim(),
        image_url: pending || cleared ? null : draft.image_url,
      })
      if (pending) await backend.uploadMenuImage(saved.id, pending)
      else if (cleared) await backend.removeMenuImage(saved.id)

      setPhotoBlob(null)
      setPhotoCleared(false)
      allItems.refresh()
      menu.refresh()
      setDraft(null)
      showToast({ message: t('menuAdmin.saved'), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const removeItem = async () => {
    if (!deleteTarget) return
    const backend = await getBackend()
    await backend.deleteMenuItem(deleteTarget.id)
    allItems.refresh()
    menu.refresh()
    setDeleteTarget(null)
    showToast({ message: t('menuAdmin.remove'), tone: 'neutral' })
  }

  return (
    <div className="p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-ink-muted">{t('menuAdmin.title')}</p>
        <Button onClick={openNew}>
          <Plus className="size-4" aria-hidden="true" />
          {t('menuAdmin.newItem')}
        </Button>
      </div>

      <div className="space-y-5">
        {grouped.map(({ category, items: categoryItems }) => (
          <section key={category.id}>
            <h2 className="mb-2 text-sm font-semibold text-ink">
              {i18n.language === 'ms' ? category.name_ms : category.name_en}
            </h2>
            <ul className="divide-y divide-hairline overflow-hidden rounded-[var(--radius-md)] border border-hairline bg-panel">
              {categoryItems.length === 0 ? (
                <li className="px-3 py-4 text-sm text-ink-muted">{t('admin.emptyColumn')}</li>
              ) : null}
              {categoryItems.map((item) => (
                <li key={item.id} className="flex items-center gap-3 p-3">
                  <div className="size-12 shrink-0 overflow-hidden rounded-[var(--radius-sm)] bg-panel-2">
                    {item.image_url ? (
                      <img src={item.image_url} alt="" width={1200} height={900} className="size-full object-cover" />
                    ) : (
                      <CupArt className="size-full" tint="#12664A" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-ink">
                      {i18n.language === 'ms' ? item.name_ms : item.name_en}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {freeMode ? t('admin.free') : formatMoney(item.price)}
                      {item.available_units !== null ? ` · ${item.available_units} left` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(toDraft(item))
                      setZoom(1)
                      setPhotoError(null)
                      setPhotoBlob(null)
                      setPhotoCleared(false)
                      setPickerOpen(false)
                    }}
                    className="min-h-10 rounded-full border border-hairline px-3 text-sm font-medium text-ink hover:bg-ink/5"
                  >
                    {t('menuAdmin.edit')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteTarget(item)}
                    aria-label={t('menuAdmin.deleteItem')}
                    className="grid size-10 place-items-center rounded-full text-ink-muted hover:bg-danger/10 hover:text-danger"
                  >
                    <Trash2 className="size-4" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <Sheet
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft && items.some((i) => i.id === draft.id) ? t('menuAdmin.edit') : t('menuAdmin.newItem')}
        footer={
          <Button size="lg" fullWidth loading={saving} onClick={() => void save()} disabled={!draft?.name_en.trim()}>
            {t('menuAdmin.save')}
          </Button>
        }
      >
        {draft ? (
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-sm font-medium text-ink">{t('menuAdmin.photo')}</p>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  lastFile.current = file
                  setZoom(1)
                  void applyFile(file, 1)
                  event.target.value = ''
                }}
              />
              {draft.image_url ? (
                <div className="space-y-2">
                  <div className="overflow-hidden rounded-[var(--radius-md)] border border-hairline">
                    <img
                      src={draft.image_url}
                      alt=""
                      width={1200}
                      height={900}
                      className="aspect-4/3 w-full object-cover"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="secondary" onClick={() => fileRef.current?.click()}>
                      <Camera className="size-4" aria-hidden="true" />
                      {t('menuAdmin.replace')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setPhotoBlob(null)
                        setPhotoCleared(true)
                        lastFile.current = null
                        setDraft({ ...draft, image_url: null })
                      }}
                    >
                      <ImageOff className="size-4" aria-hidden="true" />
                      {t('menuAdmin.remove')}
                    </Button>
                  </div>
                  <label className="block text-xs font-medium text-ink-muted">
                    {t('menuAdmin.zoom')}
                    <input
                      type="range"
                      min={1}
                      max={2}
                      step={0.05}
                      value={zoom}
                      onChange={(event) => setZoom(Number(event.target.value))}
                      onPointerUp={() => {
                        if (lastFile.current) void applyFile(lastFile.current, zoom)
                      }}
                      onKeyUp={() => {
                        if (lastFile.current) void applyFile(lastFile.current, zoom)
                      }}
                      className="mt-1 w-full accent-[var(--color-brand-700)]"
                    />
                  </label>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  className="grid w-full place-items-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-hairline bg-panel-2 px-4 py-7 text-sm text-ink-muted hover:border-brand-500/60"
                >
                  <Camera className="size-6" aria-hidden="true" />
                  {photoBusy ? t('menuAdmin.processing') : t('menuAdmin.addPhoto')}
                  <span className="text-xs">{t('menuAdmin.usageHint')}</span>
                </button>
              )}
              {photoError ? <p className="mt-1 text-xs font-medium text-danger">{photoError}</p> : null}
            </div>

            <Field
              label={`Name (EN)`}
              value={draft.name_en}
              onChange={(event) => setDraft({ ...draft, name_en: event.target.value.slice(0, 48) })}
              maxLength={48}
            />
            <Field
              label={`Name (BM)`}
              value={draft.name_ms}
              onChange={(event) => setDraft({ ...draft, name_ms: event.target.value.slice(0, 48) })}
              maxLength={48}
            />
            <Field
              label={`Description (EN)`}
              value={draft.description_en}
              onChange={(event) => setDraft({ ...draft, description_en: event.target.value.slice(0, 120) })}
              maxLength={120}
            />
            <Field
              label={`Description (BM)`}
              value={draft.description_ms}
              onChange={(event) => setDraft({ ...draft, description_ms: event.target.value.slice(0, 120) })}
              maxLength={120}
            />

            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('menuAdmin.price')}
                type="number"
                min={0}
                step={0.5}
                value={draft.price}
                onChange={(event) => setDraft({ ...draft, price: Number(event.target.value) || 0 })}
              />
              <div>
                <p className="mb-1.5 text-sm font-medium text-ink">{t('menuAdmin.title')}</p>
                <select
                  value={draft.category_id}
                  onChange={(event) => setDraft({ ...draft, category_id: event.target.value })}
                  aria-label={t('menuAdmin.title')}
                  className="h-13 w-full rounded-[var(--radius-md)] border border-hairline bg-panel px-3 text-base text-ink"
                >
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {i18n.language === 'ms' ? category.name_ms : category.name_en}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-2 rounded-[var(--radius-md)] bg-panel-2 p-3">
              <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
                {t('menuAdmin.soldOutToggle')}
                <input
                  type="checkbox"
                  checked={draft.is_sold_out_manual}
                  onChange={(event) => setDraft({ ...draft, is_sold_out_manual: event.target.checked })}
                  className="size-5 accent-[var(--color-danger)]"
                />
              </label>
              <label className="flex items-center justify-between gap-3 text-sm font-medium text-ink">
                {t('menuAdmin.available')}
                <input
                  type="checkbox"
                  checked={draft.is_active}
                  onChange={(event) => setDraft({ ...draft, is_active: event.target.checked })}
                  className="size-5 accent-[var(--color-brand-700)]"
                />
              </label>
            </div>

            {/* Which option groups this drink offers. Without this the Options
                screen had no way to reach a drink at all. */}
            <div>
              <p className="text-sm font-medium text-ink">{t('menuAdmin.options')}</p>
              <p className="mb-2 text-xs text-ink-muted">{t('menuAdmin.optionsHint')}</p>
              {groups.length === 0 ? (
                <p className="rounded-[var(--radius-sm)] border border-dashed border-hairline px-3 py-4 text-center text-sm text-ink-muted">
                  {t('menuAdmin.noGroups')}
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {groups.map((group) => {
                    const checked = draft.modifier_group_ids.includes(group.id)
                    const summary = group.options.map((option) => option.name_en).join(', ')
                    return (
                      <li key={group.id}>
                        <label className="flex items-center justify-between gap-3 rounded-[var(--radius-sm)] bg-panel-2 px-3 py-2 text-ink">
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">{group.name_en}</span>
                            <span className="block truncate text-xs text-ink-muted">
                              {summary || t('menuAdmin.noOptions')}
                            </span>
                          </span>
                          <input
                            type="checkbox"
                            aria-label={group.name_en}
                            checked={checked}
                            onChange={(event) =>
                              setDraft({
                                ...draft,
                                modifier_group_ids: event.target.checked
                                  ? [...draft.modifier_group_ids, group.id]
                                  : draft.modifier_group_ids.filter((id) => id !== group.id),
                              })
                            }
                            className="size-5 shrink-0 accent-[var(--color-brand-700)]"
                          />
                        </label>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>

            <div>
              <p className="text-sm font-medium text-ink">{t('menuAdmin.recipe')}</p>
              <p className="mb-2 text-xs text-ink-muted">{t('menuAdmin.recipeHint')}</p>
              <ul className="space-y-2">
                {draft.recipe.map((line, index) => {
                  const ingredient = ingredientList.find((i) => i.id === line.ingredient_id)
                  return (
                    <li key={`${line.ingredient_id}-${index}`} className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm text-ink">
                        {ingredient?.name ?? line.ingredient_id}
                      </span>
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={line.qty}
                        aria-label={`${ingredient?.name ?? 'ingredient'} ${t('menuAdmin.qty')}`}
                        onChange={(event) => {
                          const qty = Number(event.target.value) || 0
                          setDraft({
                            ...draft,
                            recipe: draft.recipe.map((l, i) => (i === index ? { ...l, qty } : l)),
                          })
                        }}
                        className="tnum h-10 w-20 rounded-[var(--radius-sm)] border border-hairline bg-panel px-2 text-sm text-ink"
                      />
                      <span className="w-8 text-xs text-ink-muted">{ingredient?.unit ?? ''}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, recipe: draft.recipe.filter((_, i) => i !== index) })
                        }
                        aria-label={t('cart.remove')}
                        className="grid size-9 place-items-center rounded-full text-ink-muted hover:text-danger"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </li>
                  )
                })}
              </ul>

              <Button
                size="sm"
                variant="secondary"
                className="mt-2"
                aria-expanded={pickerOpen}
                onClick={() => setPickerOpen((open) => !open)}
                disabled={ingredientError || ingredientList.length === 0}
              >
                <Plus className="size-4" aria-hidden="true" />
                {t('menuAdmin.addIngredient')}
              </Button>

              {/* A flat dropdown here was invisible when the list failed to load. */}
              {ingredientError ? (
                <p className="mt-1 text-xs font-medium text-danger">{t('menuAdmin.recipeLoadFailed')}</p>
              ) : null}

              {pickerOpen ? (
                <ul className="mt-2 max-h-56 overflow-y-auto rounded-[var(--radius-sm)] border border-hairline">
                  {draft.recipe.length >= ingredientList.length ? (
                    <li className="px-3 py-3 text-sm text-ink-muted">{t('menuAdmin.recipeEmpty')}</li>
                  ) : null}
                  {ingredientList
                    .filter((ingredient) => !draft.recipe.some((line) => line.ingredient_id === ingredient.id))
                    .map((ingredient) => (
                      <li key={ingredient.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setDraft({
                              ...draft,
                              recipe: [...draft.recipe, { ingredient_id: ingredient.id, qty: 1 }],
                            })
                            setPickerOpen(false)
                          }}
                          className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left text-sm text-ink hover:bg-ink/5"
                        >
                          <span className="truncate">{ingredient.name}</span>
                          <span className="text-xs text-ink-muted">{ingredient.unit}</span>
                        </button>
                      </li>
                    ))}
                </ul>
              ) : null}
            </div>

            <div className="flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-ink">{t('item.quantity')}</span>
              <Stepper
                value={draft.prep_seconds / 30}
                min={1}
                max={20}
                onChange={(next) => setDraft({ ...draft, prep_seconds: next * 30 })}
                labelIncrease={t('cart.increase')}
                labelDecrease={t('cart.decrease')}
              />
            </div>
          </div>
        ) : null}
      </Sheet>

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-cocoa-900/50 p-4">
          <div role="dialog" aria-modal="true" className="w-full max-w-sm rounded-[var(--radius-lg)] bg-panel p-5 shadow-[var(--shadow-lift)]">
            <h2 className="font-display text-lg font-semibold text-ink">
              {t('menuAdmin.deleteConfirm', { name: deleteTarget.name_en })}
            </h2>
            <div className="mt-4 flex gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeleteTarget(null)}>
                {t('ticket.cancelNo')}
              </Button>
              <Button variant="danger" fullWidth onClick={() => void removeItem()}>
                {t('menuAdmin.deleteItem')}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
