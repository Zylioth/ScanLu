import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { MenuPage } from './pages/MenuPage'
import { CartPage } from './pages/CartPage'
import { TicketPage } from './pages/TicketPage'
import { ToastProvider } from './components/Toast'
import { Button, Spinner } from './components/ui'

// The guest menu must stay small; the whole admin surface is a separate chunk.
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin').then((m) => ({ default: m.AdminLogin })))
const AdminShell = lazy(() =>
  import('./components/AdminShell').then((m) => ({ default: m.AdminShell })),
)
const AdminGate = lazy(() => import('./components/AdminShell').then((m) => ({ default: m.AdminGate })))
const AdminBoard = lazy(() => import('./pages/admin/AdminBoard').then((m) => ({ default: m.AdminBoard })))
const AdminMenuPage = lazy(() => import('./pages/admin/AdminMenu').then((m) => ({ default: m.AdminMenu })))
const AdminQrPage = lazy(() => import('./pages/admin/AdminQR').then((m) => ({ default: m.AdminQR })))
const AdminSettingsPage = lazy(() =>
  import('./pages/admin/AdminSettings').then((m) => ({ default: m.AdminSettings })),
)
const AdminModifiersPage = lazy(() =>
  import('./pages/admin/AdminModifiers').then((m) => ({ default: m.AdminModifiers })),
)
const AdminIngredientsPage = lazy(() =>
  import('./pages/admin/AdminIngredients').then((m) => ({ default: m.AdminIngredients })),
)

function ScrollToTop() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
  }, [pathname])
  return null
}

function PageFallback() {
  return (
    <div className="grid min-h-dvh place-items-center">
      <Spinner className="size-6 text-brand-700" />
    </div>
  )
}

function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-3 px-6 text-center">
      <h1 className="font-display text-2xl text-ink">This page does not exist</h1>
      <p className="text-sm text-ink-muted">The link may be old, or typed slightly wrong.</p>
      <Link to="/menu">
        <Button>Go to the menu</Button>
      </Link>
    </div>
  )
}

export default function App() {
  // BASE_URL is '/' locally and '/ScanLu/' on GitHub Pages, so the router has
  // to match routes below that prefix instead of from the domain root.
  const basename = import.meta.env.BASE_URL.replace(/\/$/, '') || '/'

  return (
    <BrowserRouter basename={basename}>
      <ToastProvider position="bottom">
        <ScrollToTop />
        <Suspense fallback={<PageFallback />}>
          <Routes>
            <Route path="/" element={<Navigate to="/menu" replace />} />
            <Route path="/menu" element={<MenuPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/ticket/:orderId" element={<TicketPage />} />

            <Route path="/admin/login" element={<AdminLogin />} />
            <Route path="/admin" element={<AdminGate />}>
              <Route element={<AdminShell />}>
                <Route index element={<AdminBoard />} />
                <Route path="menu" element={<AdminMenuPage />} />
                <Route path="qr" element={<AdminQrPage />} />
                <Route path="settings" element={<AdminSettingsPage />} />
                <Route path="modifiers" element={<AdminModifiersPage />} />
                <Route path="ingredients" element={<AdminIngredientsPage />} />
              </Route>
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </ToastProvider>
    </BrowserRouter>
  )
}
