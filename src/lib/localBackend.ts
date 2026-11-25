import {
  OrderError,
  type Backend,
  type Category,
  type Ingredient,
  type MenuItem,
  type MenuItemView,
  type ModifierGroup,
  type Order,
  type OrderItem,
  type OrderStatus,
  type PaymentMethod,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type PublicStatus,
  type Settings,
} from './types'
import {
  dayKey,
  displayNumberFor,
  secondsSince,
} from './format'
import {
  SEED_VERSION,
  seedCategories,
  seedIngredients,
  seedMenuItems,
  seedModifierGroups,
  seedOrders,
  seedSettings,
} from './seed'

/**
 * Local demo backend.
 *
 * Everything lives in localStorage and syncs across tabs of the same browser
 * through BroadcastChannel, which is enough to run the guest phone and the
 * admin iPad as two tabs on one machine. The business rules below are the same
 * rules supabase/migrations/0001_init.sql enforces in Postgres, so the UI can
 * be exercised tonight and pointed at Supabase later without changing.
 */

const DB_KEY = 'ohpos.db'
const CUSTOMER_KEY = 'ohpos.customer'
const ADMIN_KEY = 'ohpos.admin'
const LAST_ORDER_KEY = 'ohpos.lastOrder'
const CHANNEL = 'ohpos.sync'
const DEMO_PASSCODE = '1234'

interface Db {
  version: number
  settings: Settings
  categories: Category[]
  ingredients: Ingredient[]
  groups: ModifierGroup[]
  items: MenuItem[]
  orders: Order[]
  counters: Record<string, number>
}

function freshDb(): Db {
  const orders = seedOrders()
  const highest = orders.reduce((max, order) => Math.max(max, order.order_number), 0)
  return {
    version: SEED_VERSION,
    settings: { ...seedSettings },
    categories: structuredClone(seedCategories),
    ingredients: structuredClone(seedIngredients),
    groups: structuredClone(seedModifierGroups),
    items: structuredClone(seedMenuItems),
    orders,
    counters: highest > 0 ? { [dayKey()]: highest } : {},
  }
}

function readDb(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY)
    if (!raw) {
      const created = freshDb()
      localStorage.setItem(DB_KEY, JSON.stringify(created))
      return created
    }
    const parsed = JSON.parse(raw) as Db
    // A seed change during development should not leave half-old data behind.
    if (!parsed || parsed.version !== SEED_VERSION) {
      const created = freshDb()
      localStorage.setItem(DB_KEY, JSON.stringify(created))
      return created
    }
    return parsed
  } catch {
    const created = freshDb()
    try {
      localStorage.setItem(DB_KEY, JSON.stringify(created))
    } catch {
      /* storage full or blocked; work from memory this session */
    }
    return created
  }
}

let channel: BroadcastChannel | null = null
try {
  channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null
} catch {
  channel = null
}

const listeners = new Set<() => void>()

function announce() {
  for (const fn of listeners) fn()
  try {
    channel?.postMessage('changed')
  } catch {
    /* channel closed */
  }
}

function writeDb(db: Db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db))
  announce()
}

function customerId(): string {
  let id = localStorage.getItem(CUSTOMER_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(CUSTOMER_KEY, id)
  }
  return id
}

function isCancelled(o: Order) {
  return o.status === 'cancelled'
}

function cupsOf(o: Order) {
  return o.items.reduce((sum, line) => sum + line.qty, 0)
}

function activeOrders(orders: Order[]) {
  return orders.filter((o) => o.status === 'placed' || o.status === 'preparing' || o.status === 'ready')
}

function cupsInWindow(db: Db, fromMs: number, toMs: number) {
  return db.orders
    .filter((o) => !isCancelled(o))
    .filter((o) => {
      const t = new Date(o.placed_at).getTime()
      return t >= fromMs && t <= toMs
    })
    .reduce((sum, o) => sum + cupsOf(o), 0)
}

function avgPrepSeconds(db: Db) {
  const active = db.items.filter((i) => i.is_active)
  if (active.length === 0) return 120
  return Math.round(active.reduce((sum, i) => sum + i.prep_seconds, 0) / active.length)
}

/** Units an item can still make, or null when it has no tracked recipe. */
function availableUnits(db: Db, item: MenuItem): number | null {
  if (item.is_sold_out_manual || !item.is_active) return 0
  if (item.recipe.length === 0) return null
  let min = Number.POSITIVE_INFINITY
  for (const line of item.recipe) {
    const ing = db.ingredients.find((i) => i.id === line.ingredient_id)
    if (!ing || !ing.is_active) return 0
    if (line.qty <= 0) continue
    min = Math.min(min, Math.floor(ing.stock_qty / line.qty))
  }
  return Number.isFinite(min) ? min : null
}

function publicStatus(db: Db, me: string): PublicStatus {
  const s = db.settings
  const now = Date.now()
  const hourAgo = now - 3600_000
  const queue = activeOrders(db.orders).reduce((sum, o) => sum + cupsOf(o), 0)
  const mine = db.orders.filter((o) => o.customer_id === me && !isCancelled(o))
  const myCups = mine.reduce((sum, o) => sum + cupsOf(o), 0)
  const lastMine = mine
    .slice()
    .sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())[0]
  const cooldownElapsed = lastMine ? secondsSince(lastMine.placed_at, now) : Number.POSITIVE_INFINITY
  const cooldownLeft = Math.max(0, s.per_person_cooldown_seconds - cooldownElapsed)
  return {
    event_name: s.event_name,
    host_name: s.host_name,
    orders_open: s.orders_open,
    banner: s.message_banner,
    queue_cups: queue,
    cups_this_hour: cupsInWindow(db, hourAgo, now),
    max_cups_per_hour: s.max_cups_per_hour,
    wait_minutes: Math.max(0, Math.ceil((queue * avgPrepSeconds(db)) / 60)),
    free_mode: s.free_mode,
    max_cups_per_order: s.max_cups_per_order,
    require_name: s.require_name,
    currency: s.currency,
    person_remaining:
      s.max_cups_per_person === null ? null : Math.max(0, s.max_cups_per_person - myCups),
    cooldown_remaining_seconds: Number.isFinite(cooldownLeft) ? cooldownLeft : 0,
  }
}

function nextOrderNumber(db: Db): number {
  const key = dayKey()
  const next = (db.counters[key] ?? 0) + 1
  db.counters[key] = next
  return next
}

function placeOrderLocal(input: PlaceOrderInput): PlaceOrderResult {
  const db = readDb()
  const s = db.settings
  const now = Date.now()
  const me = customerId()
  const source = input.source ?? 'customer'
  const override = input.override === true

  if (!s.orders_open) throw new OrderError('ORDERS_CLOSED')

  const name = (input.customer_name ?? '').trim().slice(0, 20)
  if (s.require_name && name.length === 0) throw new OrderError('NAME_REQUIRED')
  if (input.items.length === 0) throw new OrderError('CART_EMPTY')

  const cups = input.items.reduce((sum, line) => sum + line.qty, 0)
  if (cups > s.max_cups_per_order) throw new OrderError('MAX_CUPS_PER_ORDER')

  if (!override) {
    if (s.max_cups_per_hour !== null) {
      const used = cupsInWindow(db, now - 3600_000, now)
      if (used + cups > s.max_cups_per_hour) {
        const overflow = used + cups - s.max_cups_per_hour
        const inHour = db.orders
          .filter((o) => !isCancelled(o))
          .filter((o) => new Date(o.placed_at).getTime() >= now - 3600_000)
          .sort((a, b) => new Date(a.placed_at).getTime() - new Date(b.placed_at).getTime())
        let released = 0
        let retry = 3600
        for (const o of inHour) {
          released += cupsOf(o)
          if (released >= overflow) {
            retry = Math.max(1, Math.ceil((new Date(o.placed_at).getTime() + 3600_000 - now) / 1000))
            break
          }
        }
        throw new OrderError('MAX_CUPS_PER_HOUR', undefined, retry)
      }
    }

    if (s.max_cups_per_day !== null) {
      const startOfDay = new Date(now)
      startOfDay.setHours(0, 0, 0, 0)
      // Rolling from local midnight is close enough for a home event.
      const usedToday = cupsInWindow(db, startOfDay.getTime(), now)
      if (usedToday + cups > s.max_cups_per_day) {
        const tomorrow = new Date(startOfDay)
        tomorrow.setDate(tomorrow.getDate() + 1)
        throw new OrderError(
          'MAX_CUPS_PER_DAY',
          undefined,
          Math.max(1, Math.ceil((tomorrow.getTime() - now) / 1000)),
        )
      }
    }

    if (s.max_queue_cups !== null) {
      const queue = activeOrders(db.orders).reduce((sum, o) => sum + cupsOf(o), 0)
      if (queue + cups > s.max_queue_cups) {
        throw new OrderError('MAX_QUEUE_CUPS', undefined, 300)
      }
    }

    if (source === 'customer') {
      const mine = db.orders.filter((o) => o.customer_id === me && !isCancelled(o))
      const activeCount = activeOrders(mine).length
      if (activeCount >= s.max_active_orders_per_person) {
        throw new OrderError('MAX_ACTIVE_ORDERS_PER_PERSON', undefined, 120)
      }
      if (s.max_cups_per_person !== null) {
        const myCups = mine.reduce((sum, o) => sum + cupsOf(o), 0)
        if (myCups + cups > s.max_cups_per_person) throw new OrderError('MAX_CUPS_PER_PERSON')
      }
      if (s.per_person_cooldown_seconds > 0) {
        const last = mine
          .slice()
          .sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())[0]
        if (last) {
          const elapsed = secondsSince(last.placed_at, now)
          if (elapsed < s.per_person_cooldown_seconds) {
            throw new OrderError(
              'PER_PERSON_COOLDOWN',
              undefined,
              s.per_person_cooldown_seconds - elapsed,
            )
          }
        }
      }
    }
  }

  // Resolve lines, prices and modifier snapshots before touching stock.
  const resolved: OrderItem[] = []
  const needs = new Map<string, number>()

  for (const line of input.items) {
    const item = db.items.find((i) => i.id === line.menu_item_id)
    if (!item || !item.is_active) throw new OrderError('ITEM_UNAVAILABLE')
    if (item.is_sold_out_manual) throw new OrderError('ITEM_UNAVAILABLE')
    if (line.qty < 1) throw new OrderError('CART_EMPTY')

    if (item.hourly_cap !== null && !override) {
      const usedItem = db.orders
        .filter((o) => !isCancelled(o))
        .filter((o) => new Date(o.placed_at).getTime() >= now - 3600_000)
        .reduce(
          (sum, o) =>
            sum + o.items.filter((it) => it.menu_item_id === item.id).reduce((n, it) => n + it.qty, 0),
          0,
        )
      if (usedItem + line.qty > item.hourly_cap) {
        throw new OrderError('ITEM_HOURLY_CAP', undefined, 1200, item.name_en)
      }
    }

    let unitPrice = item.price
    const snapshots: OrderItem['modifiers'] = []

    for (const optId of line.modifier_option_ids) {
      const group = db.groups.find((g) => g.options.some((o) => o.id === optId))
      const opt = group?.options.find((o) => o.id === optId)
      if (!group || !opt) continue
      unitPrice += opt.price_delta
      snapshots.push({
        group_en: group.name_en,
        group_ms: group.name_ms,
        option_en: opt.name_en,
        option_ms: opt.name_ms,
        price_delta: opt.price_delta,
      })
      if (opt.ingredient_id && opt.ingredient_qty) {
        needs.set(opt.ingredient_id, (needs.get(opt.ingredient_id) ?? 0) + opt.ingredient_qty * line.qty)
      }
    }

    for (const r of item.recipe) {
      needs.set(r.ingredient_id, (needs.get(r.ingredient_id) ?? 0) + r.qty * line.qty)
    }

    resolved.push({
      id: crypto.randomUUID(),
      menu_item_id: item.id,
      name_en: item.name_en,
      name_ms: item.name_ms,
      unit_price: Math.round(unitPrice * 100) / 100,
      qty: line.qty,
      modifiers: snapshots,
      line_total: Math.round(unitPrice * line.qty * 100) / 100,
    })
  }

  // Stock is reserved at placement and restored on cancel.
  const short: string[] = []
  for (const [ingId, need] of needs) {
    const ing = db.ingredients.find((i) => i.id === ingId)
    if (!ing) continue
    if (ing.stock_qty < need) short.push(ing.name)
  }
  if (short.length > 0) {
    throw new OrderError('OUT_OF_STOCK', undefined, undefined, [...new Set(short)].join(', '))
  }

  for (const [ingId, need] of needs) {
    const ing = db.ingredients.find((i) => i.id === ingId)
    if (ing) ing.stock_qty = Math.round((ing.stock_qty - need) * 1000) / 1000
  }

  const total = Math.round(resolved.reduce((sum, r) => sum + r.line_total, 0) * 100) / 100
  const orderNumber = nextOrderNumber(db)
  const queueAhead = activeOrders(db.orders).reduce((sum, o) => sum + cupsOf(o), 0)
  const ownPrep = resolved.reduce((max, r) => {
    const item = db.items.find((i) => i.id === r.menu_item_id)
    return Math.max(max, item?.prep_seconds ?? 120)
  }, 0)

  const payment: PaymentMethod = s.free_mode
    ? 'free'
    : (input.payment_method ?? s.default_payment_method)

  const order: Order = {
    id: crypto.randomUUID(),
    order_number: orderNumber,
    display_number: displayNumberFor(orderNumber),
    customer_id: me,
    customer_name: name.length > 0 ? name : 'Walk-in',
    source,
    status: s.auto_accept ? 'preparing' : 'placed',
    payment_method: payment,
    payment_status: s.free_mode ? 'free' : 'unpaid',
    total,
    note: input.note?.trim() ? input.note.trim().slice(0, 140) : null,
    items: resolved,
    placed_at: new Date(now).toISOString(),
    preparing_at: s.auto_accept ? new Date(now).toISOString() : null,
    ready_at: null,
    collected_at: null,
    cancelled_at: null,
    cancel_reason: null,
    estimated_ready_at: new Date(now + (queueAhead + ownPrep) * 1000).toISOString(),
    collected_confirmed_by_customer: false,
    ring_count: 0,
    last_rung_at: null,
  }

  db.orders.push(order)
  writeDb(db)
  try {
    localStorage.setItem(LAST_ORDER_KEY, order.id)
  } catch {
    /* ignore */
  }

  return {
    order_id: order.id,
    display_number: order.display_number,
    estimated_ready_at: order.estimated_ready_at ?? new Date(now).toISOString(),
  }
}

function stamp(order: Order, status: OrderStatus) {
  const now = new Date().toISOString()
  order.status = status
  if (status === 'preparing' && !order.preparing_at) order.preparing_at = now
  if (status === 'ready' && !order.ready_at) order.ready_at = now
  if (status === 'collected' && !order.collected_at) order.collected_at = now
  if (status === 'cancelled' && !order.cancelled_at) order.cancelled_at = now
}

export const localBackend: Backend = {
  kind: 'local',

  async getMenu() {
    const db = readDb()
    const categories = db.categories
      .filter((c) => c.is_active)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
    const items: MenuItemView[] = db.items
      .filter((i) => i.is_active)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((i) => ({ ...i, available_units: availableUnits(db, i) }))
    return { categories, items, groups: db.groups }
  },

  async getPublicStatus() {
    return publicStatus(readDb(), customerId())
  },

  async placeOrder(input) {
    return placeOrderLocal(input)
  },

  async getOrder(id) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id) ?? null
    if (!order) return null
    const admin = localStorage.getItem(ADMIN_KEY) === 'true'
    if (!admin && order.customer_id !== customerId()) return null
    return order
  },

  async getMyActiveOrders() {
    const db = readDb()
    const me = customerId()
    return db.orders.filter((o) => o.customer_id === me && !isCancelled(o))
  },

  async getOrderByDisplayNumber(display) {
    const db = readDb()
    return db.orders.find((o) => o.display_number === display.toUpperCase()) ?? null
  },

  async listOrders() {
    const db = readDb()
    return db.orders.slice().sort((a, b) => new Date(b.placed_at).getTime() - new Date(a.placed_at).getTime())
  },

  async setOrderStatus(id, status) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id)
    if (!order) throw new OrderError('ORDER_NOT_FOUND')
    if (order.status === status) return
    if (order.status === 'cancelled' && status !== 'cancelled') throw new OrderError('INVALID_TRANSITION')
    if (status === 'cancelled') {
      restoreStock(db, order)
      order.cancel_reason = order.cancel_reason ?? 'Cancelled by host'
    }
    stamp(order, status)
    writeDb(db)
  },

  async cancelOrder(id, reason) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id)
    if (!order) throw new OrderError('ORDER_NOT_FOUND')
    if (order.status === 'cancelled') return
    restoreStock(db, order)
    order.cancel_reason = reason || 'Cancelled by host'
    stamp(order, 'cancelled')
    writeDb(db)
  },

  async customerConfirmCollected(id) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id)
    if (!order) throw new OrderError('ORDER_NOT_FOUND')
    if (order.customer_id !== customerId()) throw new OrderError('NOT_ALLOWED')
    if (order.status !== 'ready') throw new OrderError('INVALID_TRANSITION')
    order.collected_confirmed_by_customer = true
    stamp(order, 'collected')
    writeDb(db)
  },

  async customerCancelOrder(id) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id)
    if (!order) throw new OrderError('ORDER_NOT_FOUND')
    if (order.customer_id !== customerId()) throw new OrderError('NOT_ALLOWED')
    if (order.status !== 'placed') throw new OrderError('INVALID_TRANSITION')
    restoreStock(db, order)
    order.cancel_reason = 'Cancelled by guest'
    stamp(order, 'cancelled')
    writeDb(db)
  },

  async ringAgain(id) {
    const db = readDb()
    const order = db.orders.find((o) => o.id === id)
    if (!order) throw new OrderError('ORDER_NOT_FOUND')
    order.ring_count += 1
    order.last_rung_at = new Date().toISOString()
    writeDb(db)
  },

  async getSettings() {
    return readDb().settings
  },

  async updateSettings(patch) {
    const db = readDb()
    db.settings = { ...db.settings, ...patch }
    writeDb(db)
    return db.settings
  },

  async getIngredients() {
    return readDb().ingredients
  },

  async saveMenuItem(item) {    const db = readDb()
    const idx = db.items.findIndex((i) => i.id === item.id)
    if (idx >= 0) db.items[idx] = item
    else db.items.push(item)
    writeDb(db)
    return item
  },

  async deleteMenuItem(id) {
    const db = readDb()
    db.items = db.items.filter((i) => i.id !== id)
    writeDb(db)
  },

  async uploadMenuImage(itemId, file) {
    const { processImageToDataUrl } = await import('./image')
    const url = await processImageToDataUrl(file, { maxWidth: 900, maxHeight: 675, quality: 0.72 })
    const db = readDb()
    const item = db.items.find((i) => i.id === itemId)
    if (item) {
      item.image_url = url
      writeDb(db)
    }
    return url
  },

  subscribe(listener) {
    listeners.add(listener)
    const onStorage = (e: StorageEvent) => {
      if (e.key === DB_KEY) listener()
    }
    const onMessage = () => listener()
    window.addEventListener('storage', onStorage)
    channel?.addEventListener('message', onMessage)
    return () => {
      listeners.delete(listener)
      window.removeEventListener('storage', onStorage)
      channel?.removeEventListener('message', onMessage)
    }
  },

  async signInAdmin(secret) {
    const ok = secret.trim() === DEMO_PASSCODE
    if (ok) localStorage.setItem(ADMIN_KEY, 'true')
    return ok
  },

  async signOutAdmin() {
    localStorage.removeItem(ADMIN_KEY)
  },

  async isAdmin() {
    return localStorage.getItem(ADMIN_KEY) === 'true'
  },
}

function restoreStock(db: Db, order: Order) {
  for (const line of order.items) {
    const item = db.items.find((i) => i.id === line.menu_item_id)
    if (!item) continue
    for (const r of item.recipe) {
      const ing = db.ingredients.find((i) => i.id === r.ingredient_id)
      if (ing) ing.stock_qty = Math.round((ing.stock_qty + r.qty * line.qty) * 1000) / 1000
    }
    for (const mod of line.modifiers) {
      const group = db.groups.find((g) => g.name_en === mod.group_en)
      const opt = group?.options.find((o) => o.name_en === mod.option_en)
      if (opt?.ingredient_id && opt.ingredient_qty) {
        const ing = db.ingredients.find((i) => i.id === opt.ingredient_id)
        if (ing) ing.stock_qty = Math.round((ing.stock_qty + opt.ingredient_qty * line.qty) * 1000) / 1000
      }
    }
  }
}

export const DEMO_PASSCODE_HINT = DEMO_PASSCODE
