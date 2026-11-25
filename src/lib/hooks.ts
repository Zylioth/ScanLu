import { useCallback, useEffect, useRef, useState } from 'react'
import { getBackend } from './backend'
import type {
  Backend,
  Category,
  Ingredient,
  MenuItemView,
  ModifierGroup,
  Order,
  PublicStatus,
  Settings,
} from './types'

interface QueryState<T> {
  data: T | null
  loading: boolean
  error: Error | null
}

const POLL_MS = 8000

/**
 * Shared query engine: load once, refresh on every backend change notification,
 * and poll slowly as the fallback when realtime is unavailable (system.md §9).
 */
function useBackendQuery<T>(
  load: (backend: Backend) => Promise<T>,
  deps: unknown[],
  poll = true,
): QueryState<T> & { refresh: () => void } {
  const [state, setState] = useState<QueryState<T>>({ data: null, loading: true, error: null })
  const loadRef = useRef(load)
  loadRef.current = load
  const [tick, setTick] = useState(0)

  const run = useCallback(async () => {
    try {
      const backend = await getBackend()
      const data = await loadRef.current(backend)
      setState((prev) => ({ ...prev, data, loading: false, error: null }))
    } catch (error) {
      setState((prev) => ({ ...prev, loading: false, error: error as Error }))
    }
  }, [])

  useEffect(() => {
    let alive = true
    const safeRun = async () => {
      if (!alive) return
      await run()
    }
    void safeRun()

    let unsubscribe: (() => void) | undefined
    void (async () => {
      const backend = await getBackend()
      if (!alive) return
      unsubscribe = backend.subscribe(() => {
        void safeRun()
      })
    })()

    const interval = poll ? window.setInterval(() => void safeRun(), POLL_MS) : undefined
    const onVisible = () => {
      if (document.visibilityState === 'visible') void safeRun()
    }
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      alive = false
      unsubscribe?.()
      if (interval) window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick])

  return { ...state, refresh: () => setTick((t) => t + 1) }
}

export function useMenu() {
  return useBackendQuery<{
    categories: Category[]
    items: MenuItemView[]
    groups: ModifierGroup[]
  }>(async (backend) => backend.getMenu(), [])
}

export function usePublicStatus() {
  return useBackendQuery<PublicStatus>(async (backend) => backend.getPublicStatus(), [])
}

export function useOrder(id: string | undefined) {
  return useBackendQuery<Order | null>(
    async (backend) => (id ? backend.getOrder(id) : null),
    [id],
  )
}

export function useMyActiveOrders() {
  return useBackendQuery<Order[]>(async (backend) => backend.getMyActiveOrders(), [])
}

export function useAdminOrders() {
  return useBackendQuery<Order[]>(async (backend) => backend.listOrders(), [])
}

export function useSettings() {
  return useBackendQuery<Settings>(async (backend) => backend.getSettings(), [])
}

export function useIngredients() {
  return useBackendQuery<Ingredient[]>(async (backend) => backend.getIngredients(), [])
}

/** Admin menu editor: every item, including ones switched off. */
export function useAllMenuItems() {
  return useBackendQuery<MenuItemView[]>(async (backend) => backend.listAllMenuItems(), [])
}

/** Re-render on an interval so relative timers (age, ETA) stay honest. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(id)
  }, [intervalMs])
  return now
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false,
  )
  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])
  return matches
}
