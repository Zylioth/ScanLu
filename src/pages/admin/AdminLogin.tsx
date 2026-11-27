import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Coffee, Lock } from 'lucide-react'
import { getBackend, isDemoMode } from '../../lib/backend'
import { APP_NAME } from '../../lib/brand'
import { DEMO_PASSCODE_HINT } from '../../lib/localBackend'
import { Button, Field } from '../../components/ui'
import { LanguageToggle } from '../../components/LanguageToggle'

// Typed once per device, then filled in for the next shift. It is only an
// address for a convenient form, never a credential.
const EMAIL_KEY = 'ohpos.admin.email'

function rememberedEmail(): string {
  try {
    return localStorage.getItem(EMAIL_KEY) ?? ''
  } catch {
    return ''
  }
}

function rememberEmail(email: string): void {
  try {
    localStorage.setItem(EMAIL_KEY, email)
  } catch {
    /* private mode: the field just stays empty next time */
  }
}

export function AdminLogin() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [email, setEmail] = useState(rememberedEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const knownEmail = isDemoMode ? '' : email.trim()
  const focusPasswordFirst = knownEmail.length > 0

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const backend = await getBackend()
      const ok = await backend.signInAdmin(isDemoMode ? '' : email, password)
      if (!ok) {
        setError(isDemoMode ? t('admin.wrongPasscode') : t('admin.wrongCredentials'))
        return
      }
      // Signing in proves the account exists. Being on the admin list is a
      // separate question, and the answer has to be a sentence, not a redirect
      // loop back to this screen.
      if (!(await backend.isAdmin())) {
        await backend.signOutAdmin()
        setError(t('admin.notAdmin'))
        return
      }
      if (!isDemoMode) rememberEmail(email.trim())
      navigate('/admin', { replace: true })
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

          {isDemoMode ? null : (
            <Field
              label={t('admin.email')}
              type="email"
              inputMode="email"
              autoComplete="username"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoFocus={!focusPasswordFirst}
            />
          )}

          <Field
            label={isDemoMode ? t('admin.passcode') : t('admin.password')}
            type="password"
            // Demo mode takes a numeric passcode, but a live install takes a real
            // password, and a number pad makes that impossible.
            inputMode={isDemoMode ? 'numeric' : 'text'}
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoFocus={isDemoMode || focusPasswordFirst}
            placeholder={isDemoMode ? '••••' : undefined}
          />

          {error ? (
            <p
              role="alert"
              className="rounded-[var(--radius-sm)] border border-danger/30 bg-danger/8 px-3 py-2 text-sm font-medium text-danger"
            >
              {error}
            </p>
          ) : null}

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
