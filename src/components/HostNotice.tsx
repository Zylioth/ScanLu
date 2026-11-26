import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ShieldAlert } from 'lucide-react'
import { getBackend } from '../lib/backend'

/**
 * A guest page on a device that is still signed in as the host. Both areas share
 * one browser session, so orders placed here belong to the admin account and the
 * host's other devices can see them. That looked like a privacy leak, so say what
 * is happening and offer the way out.
 */
export function HostNotice() {
  const { t } = useTranslation()
  const [isHost, setIsHost] = useState(false)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const backend = await getBackend()
        const admin = await backend.isAdmin()
        if (alive) setIsHost(admin)
      } catch {
        /* not important enough to surface */
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  if (!isHost) return null

  const signOut = async () => {
    setLeaving(true)
    const backend = await getBackend()
    await backend.signOutAdmin()
    // Reload so the browser picks up a fresh guest session.
    window.location.reload()
  }

  return (
    <div className="mx-4 mt-3 flex items-start gap-2.5 rounded-[var(--radius-md)] border border-warning/40 bg-warning/12 px-3 py-2.5">
      <ShieldAlert className="mt-0.5 size-4 shrink-0 text-warning-ink" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-warning-ink">{t('hostNotice.title')}</p>
        <button
          type="button"
          onClick={() => void signOut()}
          disabled={leaving}
          className="mt-1 text-xs font-semibold text-warning-ink underline underline-offset-2 disabled:opacity-60"
        >
          {leaving ? t('hostNotice.leaving') : t('hostNotice.action')}
        </button>
      </div>
    </div>
  )
}
