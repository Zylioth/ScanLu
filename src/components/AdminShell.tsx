import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom'
import {
  BellRing,
  BellOff,
  BookOpen,
  ExternalLink,
  LayoutGrid,
  LogOut,
  Moon,
  QrCode,
  Sun,
  WifiOff,
} from 'lucide-react'
import { getBackend, isDemoMode } from '../lib/backend'
import { useAdminOrders, useNow, useSettings } from '../lib/hooks'
import { isAudioUnlocked, playAdminChime, unlockAudio } from '../lib/audio'
import { useTheme } from '../lib/theme'
import { Chip, Skeleton, cx } from '../components/ui'

const NAV = [
  { to: '/admin', labelKey: 'admin.board', Icon: LayoutGrid },
  { to: '/admin/menu', labelKey: 'admin.menu', Icon: BookOpen },
  { to: '/admin/qr', labelKey: 'admin.qr', Icon: QrCode },
]

export function AdminGate() {
  const [state, setState] = useState<'checking' | 'allowed' | 'denied'>('checking')
  const location = useLocation()

  useEffect(() => {
    let alive = true
    void (async () => {
      const backend = await getBackend()
      const admin = await backend.isAdmin()
      if (alive) setState(admin ? 'allowed' : 'denied')
    })()
    return () => {
      alive = false
    }
  }, [location.pathname])

  if (state === 'checking') {
    return (
      <div className="mx-auto max-w-md space-y-3 p-6">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }
  if (state === 'denied') {
    return <Navigate to="/admin/login" replace state={{ from: location.pathname }} />
  }
  return <Outlet />
}

function cupsIn(orders: { items: { qty: number }[]; status: string; placed_at: string }[], from: number) {
  return orders
    .filter((o) => o.status !== 'cancelled' && new Date(o.placed_at).getTime() >= from)
    .reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.qty, 0), 0)
}

export function AdminShell() {
  const { t } = useTranslation()
  const location = useLocation()
  const orders = useAdminOrders()
  const settings = useSettings()
  const now = useNow(5000)
  const [theme, setTheme] = useTheme()
  const [audioOn, setAudioOn] = useState(() => isAudioUnlocked())
  const [online, setOnline] = useState(() => (typeof navigator !== 'undefined' ? navigator.onLine : true))

  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])

  const all = orders.data ?? []
  const active = all.filter((o) => o.status === 'placed' || o.status === 'preparing' || o.status === 'ready')
  const queueCups = active.reduce((sum, o) => sum + o.items.reduce((n, i) => n + i.qty, 0), 0)
  const thisHour = cupsIn(all, now - 3600_000)
  const cap = settings.data?.max_cups_per_hour ?? null
  const paused = settings.data ? !settings.data.orders_open : false
  const title =
    location.pathname === '/admin'
      ? t('admin.title')
      : location.pathname.startsWith('/admin/menu')
        ? t('admin.menu')
        : location.pathname.startsWith('/admin/qr')
          ? t('admin.qr')
          : t('admin.title')

  const togglePause = async () => {
    const backend = await getBackend()
    await backend.updateSettings({ orders_open: paused })
    settings.refresh()
  }

  return (
    <div className="flex min-h-dvh bg-canvas">
      <aside className="no-print sticky top-0 flex h-dvh w-20 shrink-0 flex-col items-center gap-1 border-r border-hairline bg-panel py-3">
        <div className="mb-2 grid size-11 place-items-center rounded-[var(--radius-sm)] bg-brand-900 text-gold-300" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="size-6" fill="none">
            <path d="M5 8h11v6a5.5 5.5 0 0 1-11 0z" fill="currentColor" />
            <path d="M16 9.5h2a2.5 2.5 0 0 1 0 5h-2" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </div>
        <nav aria-label={t('admin.title')} className="flex w-full flex-col items-center gap-1">
          {NAV.map(({ to, labelKey, Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/admin'}
              className={({ isActive }) =>
                cx(
                  'group relative flex w-full flex-col items-center gap-1 px-1 py-2.5 text-[0.65rem] font-medium',
                  isActive ? 'text-brand-700' : 'text-ink-muted hover:text-ink',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cx(
                      'absolute left-0 top-1/2 h-8 w-[3px] -translate-y-1/2 rounded-r-full transition-colors',
                      isActive ? 'bg-gold-500' : 'bg-transparent',
                    )}
                    aria-hidden="true"
                  />
                  <Icon className="size-5" aria-hidden="true" />
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex flex-col items-center gap-1">
          <Link
            to="/menu"
            target="_blank"
            rel="noreferrer"
            className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[0.65rem] font-medium text-ink-muted hover:text-ink"
          >
            <ExternalLink className="size-4" aria-hidden="true" />
            {t('admin.guestView')}
          </Link>
          <button
            type="button"
            onClick={() => {
              const next = theme === 'dark' ? 'light' : 'dark'
              setTheme(next)
            }}
            aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
            className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[0.65rem] font-medium text-ink-muted hover:text-ink"
          >
            {theme === 'dark' ? <Sun className="size-4" aria-hidden="true" /> : <Moon className="size-4" aria-hidden="true" />}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <button
            type="button"
            onClick={() => {
              void (async () => {
                const backend = await getBackend()
                await backend.signOutAdmin()
                window.location.assign('/admin/login')
              })()
            }}
            aria-label={t('admin.signOut')}
            className="flex w-full flex-col items-center gap-1 px-1 py-2 text-[0.65rem] font-medium text-ink-muted hover:text-danger"
          >
            <LogOut className="size-4" aria-hidden="true" />
            {t('admin.signOut')}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-30 border-b border-hairline bg-canvas/92 backdrop-blur-md">
          <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
            <h1 className="mr-auto font-display text-xl font-semibold text-ink">{title}</h1>

            {!online ? (
              <Chip tone="danger" icon={<WifiOff className="size-3.5" aria-hidden="true" />}>
                {t('admin.disconnected')}
              </Chip>
            ) : null}

            <Chip tone="neutral" className="tnum">
              {t('admin.queue', { count: queueCups })}
            </Chip>
            <Chip tone="neutral" className="tnum">
              {cap === null
                ? t('admin.today', { used: thisHour })
                : t('admin.thisHour', { used: thisHour, cap })}
            </Chip>

            {!audioOn ? (
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    const ok = await unlockAudio()
                    setAudioOn(ok)
                    if (ok) playAdminChime()
                  })()
                }}
                className="min-h-9 rounded-full bg-gold-300 px-3 text-xs font-semibold text-cocoa-900 hover:bg-gold-500"
              >
                {t('admin.enableSound')}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  void unlockAudio().then((ok) => {
                    setAudioOn(ok)
                    if (ok) playAdminChime()
                  })
                }}
                aria-label={t('admin.soundOn')}
                className="grid size-9 place-items-center rounded-full text-brand-700 hover:bg-ink/6"
              >
                <BellRing className="size-5" aria-hidden="true" />
              </button>
            )}

            <button
              type="button"
              onClick={() => void togglePause()}
              aria-pressed={paused}
              className={cx(
                'min-h-10 rounded-full px-4 text-sm font-semibold transition-colors',
                paused
                  ? 'bg-danger text-white hover:brightness-95'
                  : 'bg-brand-700 text-cream-50 hover:bg-brand-800',
              )}
            >
              {paused ? t('admin.resume') : t('admin.pause')}
            </button>
          </div>
          {isDemoMode ? (
            <p className="border-t border-hairline bg-panel-2 px-4 py-1 text-[0.7rem] text-ink-muted">
              {t('admin.demoBadge')}
            </p>
          ) : null}
        </header>

        {paused ? (
          <div className="no-print flex items-center gap-2 bg-danger/12 px-4 py-2 text-sm font-medium text-danger">
            <BellOff className="size-4" aria-hidden="true" />
            {t('admin.paused')}
          </div>
        ) : null}

        <main className="min-h-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
