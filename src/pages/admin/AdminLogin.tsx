import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Coffee, Lock } from 'lucide-react'
import { getBackend, isDemoMode } from '../../lib/backend'
import { APP_NAME } from '../../lib/brand'
import { DEMO_PASSCODE_HINT } from '../../lib/localBackend'
import { Button, Field } from '../../components/ui'
import { LanguageToggle } from '../../components/LanguageToggle'

export function AdminLogin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [secret, setSecret] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const backend = await getBackend()
      const ok = await backend.signInAdmin(secret)
      if (ok) navigate('/admin', { replace: true })
      else setError(t('admin.wrongPasscode'))
    } catch {
      setError(t('error.NETWORK'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-[env(safe-area-inset-top)]">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="grid size-11 place-items-center rounded-[var(--radius-sm)] bg-brand-900 text-gold-300">
              <Coffee className="size-6" aria-hidden="true" />
            </span>
            <div>
              <p className="font-display text-xl leading-tight font-semibold text-ink">{APP_NAME}</p>
              <p className="text-xs text-ink-muted">{t('admin.login')}</p>
            </div>
          </div>
          <LanguageToggle />
        </div>

        <form
          onSubmit={(event) => void submit(event)}
          className="space-y-4 rounded-[var(--radius-lg)] border border-hairline bg-panel p-5 shadow-[var(--shadow-card)]"
        >
          <p className="text-xs text-ink-muted">{t('admin.loginHint')}</p>
          <Field
            label={t('admin.passcode')}
            type="password"
            // Demo mode takes a numeric passcode, but a live install takes the
            // admin's real password, and a number pad makes that impossible.
            inputMode={isDemoMode ? 'numeric' : 'text'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            error={error ?? undefined}
            autoFocus
            placeholder="••••"
          />
          <Button type="submit" size="lg" fullWidth loading={busy}>
            <Lock className="size-4" aria-hidden="true" />
            {t('admin.signIn')}
          </Button>
          {isDemoMode ? (
            <p className="text-center text-xs text-ink-muted">
              {t('admin.demoHint', { code: DEMO_PASSCODE_HINT })}
            </p>
          ) : null}
        </form>
      </div>
    </div>
  )
}
