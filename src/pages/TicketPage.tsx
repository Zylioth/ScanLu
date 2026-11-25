import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Info, VolumeX, WifiOff } from 'lucide-react'
import { useOrder, usePublicStatus } from '../lib/hooks'
import { getBackend } from '../lib/backend'
import { isAudioUnlocked, playGuestChime, unlockAudio } from '../lib/audio'
import { releaseWakeLock, requestWakeLock } from '../lib/wakelock'
import { describeOrderError } from '../lib/errors'
import { Banner, Button, Chip, Sheet, Skeleton, cx } from '../components/ui'
import { Ticket } from '../components/Ticket'
import { ReadyAlert } from '../components/ReadyAlert'

export function TicketPage() {
  const { orderId } = useParams<{ orderId: string }>()
  const { t } = useTranslation()
  const navigate = useNavigate()
  const order = useOrder(orderId)
  const status = usePublicStatus()

  const [audioReady, setAudioReady] = useState(() => isAudioUnlocked())
  const [wakeReady, setWakeReady] = useState(false)
  const [offline, setOffline] = useState(() => (typeof navigator !== 'undefined' ? !navigator.onLine : false))
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [alertDismissed, setAlertDismissed] = useState(false)

  const current = order.data
  const awaiting = current?.status === 'placed' || current?.status === 'preparing' || current?.status === 'ready'

  useEffect(() => {
    const onOnline = () => setOffline(false)
    const onOffline = () => setOffline(true)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  // Keep the screen on while the guest is waiting for the drink.
  useEffect(() => {
    let cancelled = false
    if (awaiting) {
      void requestWakeLock().then((ok) => {
        if (!cancelled) setWakeReady(ok)
      })
    } else {
      void releaseWakeLock()
      setWakeReady(false)
    }
    return () => {
      cancelled = true
      void releaseWakeLock()
    }
  }, [awaiting])

  // A ready order that was already ready on load should still alert once.
  const wasReady = useRef<string | null>(null)
  useEffect(() => {
    if (!current) return
    if (current.status !== 'ready') {
      wasReady.current = null
      setAlertDismissed(false)
      return
    }
    if (wasReady.current !== current.id + (current.last_rung_at ?? '')) {
      wasReady.current = current.id + (current.last_rung_at ?? '')
      setAlertDismissed(false)
    }
  }, [current])

  const enableAudio = useCallback(async () => {
    const ok = await unlockAudio()
    setAudioReady(ok)
    if (ok) playGuestChime()
  }, [])

  const confirmCollected = useCallback(async () => {
    if (!orderId) return
    setBusy(true)
    setActionError(null)
    try {
      const backend = await getBackend()
      await backend.customerConfirmCollected(orderId)
      await releaseWakeLock()
      order.refresh()
    } catch (caught) {
      setActionError(describeOrderError(caught, t))
    } finally {
      setBusy(false)
    }
  }, [orderId, order, t])

  const cancelOrder = useCallback(async () => {
    if (!orderId) return
    setBusy(true)
    setActionError(null)
    try {
      const backend = await getBackend()
      await backend.customerCancelOrder(orderId)
      setConfirmCancel(false)
      order.refresh()
    } catch (caught) {
      setActionError(describeOrderError(caught, t))
    } finally {
      setBusy(false)
    }
  }, [orderId, order, t])

  if (order.loading && !current) {
    return (
      <div className="mx-auto max-w-md space-y-4 px-4 pt-8">
        <Skeleton className="mx-auto h-96 w-full max-w-[360px] rounded-[var(--radius-md)]" />
      </div>
    )
  }

  if (!current) {
    return (
      <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
        <h1 className="font-display text-2xl text-ink">{t('ticket.notFound')}</h1>
        <p className="text-sm text-ink-muted">{t('ticket.notFoundBody')}</p>
        <Button onClick={() => navigate('/menu')}>{t('cart.backToMenu')}</Button>
      </div>
    )
  }

  const showAlert = current.status === 'ready' && !alertDismissed
  const collected = current.status === 'collected'
  const cancelled = current.status === 'cancelled'
  const canCancel = current.status === 'placed'
  const remaining = status.data?.person_remaining ?? null
  const canOrderAgain = remaining === null || remaining > 0

  return (
    <div
      className={cx(
        'min-h-dvh pb-[calc(2rem+env(safe-area-inset-bottom))] transition-colors',
        showAlert ? 'bg-brand-900' : 'bg-canvas',
      )}
    >
      <header className="mx-auto flex w-full max-w-md items-center gap-2 px-3 pt-[calc(0.5rem+env(safe-area-inset-top))] pb-2">
        <Link
          to="/menu"
          aria-label={t('cart.backToMenu')}
          className={cx(
            'grid size-11 place-items-center rounded-full',
            showAlert ? 'text-cream-50 hover:bg-white/10' : 'text-ink hover:bg-ink/6',
          )}
        >
          <ArrowLeft className="size-5" aria-hidden="true" />
        </Link>
        <div className="flex flex-1 justify-end gap-2">
          {offline ? (
            <Chip tone="warning" icon={<WifiOff className="size-3.5" aria-hidden="true" />}>
              {t('menu.offline')}
            </Chip>
          ) : order.error ? (
            <Chip tone="warning" icon={<Info className="size-3.5" aria-hidden="true" />}>
              {t('ticket.reconnecting')}
            </Chip>
          ) : null}
        </div>
      </header>

      <main className="mx-auto w-full max-w-md px-4">
        <div className={cx(cancelled && 'opacity-70 grayscale')}>
          <Ticket
            order={current}
            eventName={status.data?.event_name ?? t('menu.title')}
            freeMode={status.data?.free_mode ?? false}
            className="ticket-enter"
          />
        </div>

        <div className="mt-4 space-y-3">
          {cancelled ? (
            <div className="rounded-[var(--radius-md)] border border-hairline bg-panel p-4 text-center">
              <p className="font-medium text-ink">{t('ticket.cancelled')}</p>
              <p className="mt-1 text-sm text-ink-muted">
                {current.cancel_reason || t('ticket.cancelledBody')}
              </p>
              <Button className="mt-3" onClick={() => navigate('/menu')}>
                {t('ticket.orderAnother')}
              </Button>
            </div>
          ) : null}

          {collected ? (
            <div className="rounded-[var(--radius-md)] border border-brand-500/25 bg-panel p-5 text-center shadow-[var(--shadow-card)]">
              <p className="stamp mx-auto inline-block rounded-[var(--radius-sm)] border-2 border-brand-500 px-3 py-1 font-display text-lg font-semibold text-brand-500">
                {t('ticket.collected')} ✓
              </p>
              <p className="mt-3 font-display text-xl text-ink">{t('ticket.thanks')}</p>
              <p className="mt-1 text-sm text-ink-muted">{t('ticket.happyRaya')} 🌙</p>
              {canOrderAgain ? (
                <Button className="mt-4" onClick={() => navigate('/menu')}>
                  {t('ticket.orderAnother')}
                </Button>
              ) : (
                <p className="mt-4 text-sm text-ink-muted">
                  {t('error.MAX_CUPS_PER_PERSON')}
                </p>
              )}
            </div>
          ) : null}

          {!collected && !cancelled ? (
            <>
              {!audioReady ? (
                <div className="rounded-[var(--radius-md)] border border-gold-500/40 bg-gold-300/25 p-3.5">
                  <p className="flex items-start gap-2 text-sm font-medium text-cocoa-900">
                    <VolumeX className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
                    {t('ticket.alertHint')}
                  </p>
                  <Button variant="gold" size="sm" className="mt-2" onClick={() => void enableAudio()}>
                    {t('ticket.enableAlerts')}
                  </Button>
                </div>
              ) : (
                <div className="space-y-1.5 text-center">
                  <p className="text-xs text-ink-muted">{t('ticket.keepOpen')}</p>
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    {wakeReady ? <Chip tone="success">{t('ticket.wakeLock')}</Chip> : null}
                    <button
                      type="button"
                      onClick={() => playGuestChime()}
                      className="rounded-full px-2.5 py-1 text-xs font-medium text-ink-muted underline underline-offset-4 hover:text-ink"
                    >
                      {t('ticket.soundTest')}
                    </button>
                  </div>
                </div>
              )}

              {canCancel ? (
                <button
                  type="button"
                  onClick={() => setConfirmCancel(true)}
                  className="mx-auto block rounded-full px-3 py-2 text-sm font-medium text-ink-muted underline underline-offset-4 hover:text-danger"
                >
                  {t('ticket.cancel')}
                </button>
              ) : null}
            </>
          ) : null}

          {actionError ? (
            <Banner tone="danger">{actionError}</Banner>
          ) : null}
        </div>
      </main>

      {showAlert ? (
        <ReadyAlert
          order={current}
          eventName={status.data?.event_name ?? t('menu.title')}
          freeMode={status.data?.free_mode ?? false}
          onCollected={() => void confirmCollected()}
          onDismiss={() => setAlertDismissed(true)}
          busy={busy}
        />
      ) : null}

      <Sheet
        open={confirmCancel}
        onClose={() => setConfirmCancel(false)}
        title={t('ticket.cancelConfirm')}
        footer={
          <div className="flex gap-2">
            <Button variant="secondary" fullWidth onClick={() => setConfirmCancel(false)}>
              {t('ticket.cancelNo')}
            </Button>
            <Button variant="danger" fullWidth loading={busy} onClick={() => void cancelOrder()}>
              {t('ticket.cancelYes')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-muted">{t('ticket.cancelledBody')}</p>
      </Sheet>
    </div>
  )
}
