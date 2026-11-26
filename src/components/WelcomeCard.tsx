import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui'

const KEY = 'ohpos.welcome.seen'

/**
 * A single card on the guest's first visit, saying what to expect. Shown once per
 * device, and dismissible in one tap, because the point is to make the next tap
 * obvious rather than to be a tour.
 */
export function WelcomeCard() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(KEY) !== 'true'
    } catch {
      // Private mode: do not nag on every navigation.
      return false
    }
  })

  const close = () => {
    try {
      localStorage.setItem(KEY, 'true')
    } catch {
      /* it will show again next visit, which is harmless */
    }
    setOpen(false)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 grid place-items-end bg-cocoa-900/60 p-4 sm:place-items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        className="w-full max-w-sm rounded-[var(--radius-lg)] bg-panel p-5 shadow-[var(--shadow-lift)]"
      >
        <h2 id="welcome-title" className="font-display text-xl font-semibold text-ink">
          {t('welcome.title')}
        </h2>
        <ol className="mt-3.5 space-y-3">
          {[1, 2, 3].map((step) => (
            <li key={step} className="flex gap-3">
              <span className="tnum grid size-7 shrink-0 place-items-center rounded-full bg-brand-700 text-xs font-semibold text-cream-50">
                {step}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-ink">{t(`welcome.step${step}`)}</span>
                <span className="block text-xs text-ink-muted">{t(`welcome.step${step}Body`)}</span>
              </span>
            </li>
          ))}
        </ol>
        <Button autoFocus fullWidth size="lg" className="mt-5" onClick={close}>
          {t('welcome.gotIt')}
        </Button>
      </div>
    </div>
  )
}
