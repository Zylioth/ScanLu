import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Save, Trash2 } from 'lucide-react'
import { getBackend } from '../../lib/backend'
import { useAdminOrders, useSettings } from '../../lib/hooks'
import { dayKey } from '../../lib/format'
import { OrderError } from '../../lib/types'
import { Button, Field, Sheet, Skeleton } from '../../components/ui'
import { useToast } from '../../components/Toast'

interface Form {
  event_name: string
  host_name: string
  message_banner: string
  require_name: boolean
  auto_accept: boolean
  free_mode: boolean
  // Numbers are held as text so an empty field can mean "no limit" instead of 0.
  max_cups_per_order: string
  max_cups_per_person: string
  max_active_orders_per_person: string
  max_cups_per_hour: string
  max_cups_per_day: string
  max_queue_cups: string
  per_person_cooldown_seconds: string
}

/** Empty means unlimited, which the database holds as null. */
function limit(value: string): number | null {
  if (value.trim() === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function text(value: number | null): string {
  return value === null || value === undefined ? '' : String(value)
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string
  hint?: string
  checked: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-[var(--radius-sm)] bg-panel-2 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {hint ? <span className="block text-xs text-ink-muted">{hint}</span> : null}
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-5 shrink-0 accent-[var(--color-brand-700)]"
      />
    </label>
  )
}

export function AdminSettings() {
  const { t } = useTranslation()
  const settings = useSettings()
  const orders = useAdminOrders()
  const { showToast } = useToast()

  const [form, setForm] = useState<Form | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [clearing, setClearing] = useState(false)

  // Fill the form once, when the settings land. Re-filling on every background
  // refresh would fight whoever is typing.
  useEffect(() => {
    if (!settings.data) return
    const s = settings.data
    setForm((prev) =>
      prev ?? {
        event_name: s.event_name,
        host_name: s.host_name,
        message_banner: s.message_banner ?? '',
        require_name: s.require_name,
        auto_accept: s.auto_accept,
        free_mode: s.free_mode,
        max_cups_per_order: text(s.max_cups_per_order),
        max_cups_per_person: text(s.max_cups_per_person),
        max_active_orders_per_person: text(s.max_active_orders_per_person),
        max_cups_per_hour: text(s.max_cups_per_hour),
        max_cups_per_day: text(s.max_cups_per_day),
        max_queue_cups: text(s.max_queue_cups),
        per_person_cooldown_seconds: text(s.per_person_cooldown_seconds),
      },
    )
  }, [settings.data])

  const today = dayKey()
  const todayCount = (orders.data ?? []).filter((o) => dayKey(new Date(o.placed_at)) === today).length

  const save = async () => {
    if (!form || saving) return
    if (!form.event_name.trim()) return
    setSaving(true)
    try {
      const backend = await getBackend()
      const s = settings.data
      await backend.updateSettings({
        event_name: form.event_name.trim(),
        host_name: form.host_name.trim(),
        message_banner: form.message_banner.trim() || null,
        require_name: form.require_name,
        auto_accept: form.auto_accept,
        free_mode: form.free_mode,
        // The database columns for these are not nullable, so fall back to what is
        // already stored rather than inventing a number.
        max_cups_per_order: limit(form.max_cups_per_order) ?? s?.max_cups_per_order ?? 2,
        max_active_orders_per_person:
          limit(form.max_active_orders_per_person) ?? s?.max_active_orders_per_person ?? 2,
        per_person_cooldown_seconds: limit(form.per_person_cooldown_seconds) ?? 0,
        max_cups_per_person: limit(form.max_cups_per_person),
        max_cups_per_hour: limit(form.max_cups_per_hour),
        max_cups_per_day: limit(form.max_cups_per_day),
        max_queue_cups: limit(form.max_queue_cups),
      })
      settings.refresh()
      showToast({ message: t('settingsPanel.saved'), tone: 'success' })
    } catch {
      showToast({ message: t('error.generic'), tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const clear = async () => {
    setClearing(true)
    try {
      const backend = await getBackend()
      const result = await backend.clearTodayOrders('CLEAR')
      orders.refresh()
      settings.refresh()
      setConfirmClear(false)
      showToast({
        message:
          result.deleted === 0
            ? t('settingsPanel.clearNothing')
            : t('settingsPanel.cleared', { count: result.deleted }),
        tone: 'success',
      })
    } catch (error) {
      const needsMigration = error instanceof OrderError && error.detail === 'MIGRATION_MISSING'
      showToast({
        message: t(needsMigration ? 'settingsPanel.migrationMissing' : 'error.generic'),
        tone: 'danger',
      })
    } finally {
      setClearing(false)
    }
  }

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <Skeleton className="h-8 w-1/3" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4 pb-16">
      {/* ------------------------------------------------------------ their view */}
      <section className="rounded-[var(--radius-lg)] border border-hairline bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">{t('settingsPanel.title')}</h2>
        <div className="mt-3 space-y-3">
          <Field
            label={t('settingsPanel.eventName')}
            value={form.event_name}
            maxLength={48}
            onChange={(event) => setForm({ ...form, event_name: event.target.value })}
          />
          <Field
            label={t('settingsPanel.hostName')}
            value={form.host_name}
            maxLength={48}
            onChange={(event) => setForm({ ...form, host_name: event.target.value })}
          />
          <Field
            label={t('settingsPanel.banner')}
            hint={t('settingsPanel.bannerHint')}
            value={form.message_banner}
            maxLength={90}
            onChange={(event) => setForm({ ...form, message_banner: event.target.value })}
          />
        </div>

        <div className="mt-4 rounded-[var(--radius-md)] border border-hairline bg-panel-2 px-3 py-2.5">
          <p className="text-[0.7rem] font-medium tracking-wide text-ink-muted uppercase">
            {t('settingsPanel.preview')}
          </p>
          <p className="mt-1 font-display text-lg leading-tight font-semibold text-ink">
            {form.event_name.trim() || t('menu.title')}
          </p>
          {form.message_banner.trim() ? (
            <p className="mt-1 text-sm text-ink-muted">{form.message_banner.trim()}</p>
          ) : null}
        </div>

        <Button className="mt-4" onClick={() => void save()} loading={saving} disabled={!form.event_name.trim()}>
          <Save className="size-4" aria-hidden="true" />
          {t('settingsPanel.save')}
        </Button>
      </section>

      {/* -------------------------------------------------------------- limits */}
      <section className="rounded-[var(--radius-lg)] border border-hairline bg-panel p-4">
        <h2 className="text-sm font-semibold text-ink">{t('settingsPanel.limitsTitle')}</h2>
        <p className="mt-1 text-xs text-ink-muted">{t('settingsPanel.limitsHint')}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field
            label={t('settingsPanel.maxPerOrder')}
            type="number"
            min={1}
            inputMode="numeric"
            value={form.max_cups_per_order}
            onChange={(event) => setForm({ ...form, max_cups_per_order: event.target.value })}
          />
          <Field
            label={t('settingsPanel.maxPerPerson')}
            hint={t('settingsPanel.unlimitedHint')}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.max_cups_per_person}
            onChange={(event) => setForm({ ...form, max_cups_per_person: event.target.value })}
          />
          <Field
            label={t('settingsPanel.maxActive')}
            type="number"
            min={1}
            inputMode="numeric"
            value={form.max_active_orders_per_person}
            onChange={(event) => setForm({ ...form, max_active_orders_per_person: event.target.value })}
          />
          <Field
            label={t('settingsPanel.cooldown')}
            hint={t('settingsPanel.unlimitedHint')}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.per_person_cooldown_seconds}
            onChange={(event) => setForm({ ...form, per_person_cooldown_seconds: event.target.value })}
          />
          <Field
            label={t('settingsPanel.maxHour')}
            hint={t('settingsPanel.unlimitedHint')}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.max_cups_per_hour}
            onChange={(event) => setForm({ ...form, max_cups_per_hour: event.target.value })}
          />
          <Field
            label={t('settingsPanel.maxDay')}
            hint={t('settingsPanel.unlimitedHint')}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.max_cups_per_day}
            onChange={(event) => setForm({ ...form, max_cups_per_day: event.target.value })}
          />
          <Field
            label={t('settingsPanel.maxQueue')}
            hint={t('settingsPanel.unlimitedHint')}
            type="number"
            min={0}
            inputMode="numeric"
            value={form.max_queue_cups}
            onChange={(event) => setForm({ ...form, max_queue_cups: event.target.value })}
          />
        </div>

        <div className="mt-4 space-y-2">
          <Toggle
            label={t('settingsPanel.requireName')}
            checked={form.require_name}
            onChange={(next) => setForm({ ...form, require_name: next })}
          />
          <Toggle
            label={t('settingsPanel.autoAccept')}
            checked={form.auto_accept}
            onChange={(next) => setForm({ ...form, auto_accept: next })}
          />
          <Toggle
            label={t('settingsPanel.freeMode')}
            hint={t('settingsPanel.freeModeHint')}
            checked={form.free_mode}
            onChange={(next) => setForm({ ...form, free_mode: next })}
          />
        </div>

        <Button className="mt-4" onClick={() => void save()} loading={saving} disabled={!form.event_name.trim()}>
          <Save className="size-4" aria-hidden="true" />
          {t('settingsPanel.save')}
        </Button>
      </section>

      {/* --------------------------------------------------------------- danger */}
      <section className="rounded-[var(--radius-lg)] border border-danger/35 bg-panel p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
          <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
          {t('settingsPanel.dangerTitle')}
        </h2>
        <p className="mt-2 text-sm text-ink-muted">{t('settingsPanel.clearTodayHint')}</p>
        {/* Never print "0 orders today" while the list is still loading: it reads
            as a fact and disables the button for no visible reason. */}
        {orders.loading ? (
          <Skeleton className="mt-2 h-5 w-36" />
        ) : (
          <p className="tnum mt-2 text-sm font-medium text-ink">
            {t('settingsPanel.clearTodayCount', { count: todayCount })}
          </p>
        )}
        <Button
          className="mt-3"
          variant="danger"
          onClick={() => setConfirmClear(true)}
          disabled={orders.loading || todayCount === 0}
        >
          <Trash2 className="size-4" aria-hidden="true" />
          {t('settingsPanel.clearToday')}
        </Button>
      </section>

      <Sheet open={confirmClear} onClose={() => setConfirmClear(false)} title={t('settingsPanel.clearConfirmTitle')}>
        <p className="text-sm text-ink-muted">{t('settingsPanel.clearConfirmBody', { count: todayCount })}</p>
        <div className="mt-5 flex flex-col gap-2">
          <Button variant="danger" size="lg" fullWidth loading={clearing} onClick={() => void clear()}>
            <Trash2 className="size-4" aria-hidden="true" />
            {t('settingsPanel.clearConfirmYes')}
          </Button>
          <Button variant="ghost" fullWidth onClick={() => setConfirmClear(false)}>
            {t('settingsPanel.clearConfirmNo')}
          </Button>
        </div>
      </Sheet>
    </div>
  )
}
