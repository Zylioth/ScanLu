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
    setForm((prev) =>
      prev ?? {
        event_name: settings.data!.event_name,
        host_name: settings.data!.host_name,
        message_banner: settings.data!.message_banner ?? '',
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
      await backend.updateSettings({
        event_name: form.event_name.trim(),
        host_name: form.host_name.trim(),
        message_banner: form.message_banner.trim() || null,
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
