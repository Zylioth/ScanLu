import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js'
import {
  OrderError,
  type Backend,
  type Category,
  type Ingredient,
  type MenuItem,
  type MenuItemView,
  type ModifierGroup,
  type Order,
  type OrderStatus,
  type PlaceOrderInput,
  type PlaceOrderResult,
  type PublicStatus,
  type Settings,
} from './types'

/**
 * Supabase backend (system.md §5 to §10).
 *
 * Written against supabase/migrations/0001_init.sql, so every call here maps to
 * a table, view or security-definer RPC defined in that file. The guest paths
 * (menu, guest session, place_order, cancel, realtime) are verified against the
 * live project. The admin RPCs and image upload are not yet: see DECISIONS.md.
 */

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

let client: SupabaseClient | null = null

/* ----------------------------------------------------------------- realtime */

// Every useQuery in the app calls subscribe(), and realtime-js returns an
// existing channel when the topic already matches. That made the second
// subscriber throw "cannot add postgres_changes callbacks after subscribe()"
// and cost the admin board its live updates. One shared channel that fans out
// to a listener set avoids the collision entirely.
const LIVE_TABLES = ['orders', 'order_items', 'menu_items', 'events', 'ingredients'] as const

let channel: RealtimeChannel | null = null
let closeTimer: number | undefined
let topicCount = 0
const listeners = new Set<() => void>()

function openChannel() {
  if (channel) return
  // A unique topic per channel means a channel that is still being removed can
  // never be handed back to a new subscriber.
  let next = sb().channel(`ohpos-${(topicCount += 1)}`)
  for (const table of LIVE_TABLES) {
    next = next.on('postgres_changes', { event: '*', schema: 'public', table }, () => {
      for (const listener of listeners) listener()
    })
  }
  channel = next.subscribe()
}

function closeChannel() {
  const current = channel
  channel = null
  if (current) void sb().removeChannel(current)
}

function sb(): SupabaseClient {
  if (!client) {
    if (!url || !anonKey) throw new OrderError('NETWORK', 'Supabase env vars are missing')
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  }
  return client
}

function rpcError(error: { message: string } | null): never {
  const raw = error?.message ?? ''
  // Postgres RPCs raise messages like 'MAX_CUPS_PER_HOUR:retry=720'.
  const [code, ...rest] = raw.split(':')
  const retryMatch = rest.join(':').match(/retry=(\d+)/)
  const known: string[] = [
    'ORDERS_CLOSED',
    'CART_EMPTY',
    'NAME_REQUIRED',
    'MAX_CUPS_PER_ORDER',
    'MAX_ACTIVE_ORDERS_PER_PERSON',
    'MAX_CUPS_PER_PERSON',
    'PER_PERSON_COOLDOWN',
    'MAX_CUPS_PER_HOUR',
    'MAX_CUPS_PER_DAY',
    'MAX_QUEUE_CUPS',
    'ITEM_HOURLY_CAP',
    'ITEM_UNAVAILABLE',
    'OUT_OF_STOCK',
    'ORDER_NOT_FOUND',
    'INVALID_TRANSITION',
    'NOT_ALLOWED',
  ]
  const match = known.find((k) => code.trim().startsWith(k))
  if (match) {
    const detail = rest.join(':').replace(/retry=\d+/, '').trim()
    throw new OrderError(
      match as OrderError['code'],
      raw,
      retryMatch ? Number(retryMatch[1]) : undefined,
      detail || undefined,
    )
  }
  throw new OrderError('NETWORK', raw)
}

async function ensureGuestSession() {
  const c = sb()
  const { data } = await c.auth.getSession()
  if (data.session) return
  const { error } = await c.auth.signInAnonymously()
  if (error) throw new OrderError('NETWORK', error.message)
}

function mapOrder(row: Record<string, unknown>): Order {
  const items = (row.order_items as Record<string, unknown>[] | undefined) ?? []
  return {
    id: row.id as string,
    order_number: row.order_number as number,
    display_number: row.display_number as string,
    customer_id: (row.customer_id as string) ?? '',
    customer_name: (row.customer_name as string) ?? '',
    source: (row.source as Order['source']) ?? 'customer',
    status: row.status as OrderStatus,
    payment_method: (row.payment_method as Order['payment_method']) ?? 'cash',
    payment_status: (row.payment_status as Order['payment_status']) ?? 'unpaid',
    total: Number(row.total ?? 0),
    note: (row.note as string) ?? null,
    placed_at: row.placed_at as string,
    preparing_at: (row.preparing_at as string) ?? null,
    ready_at: (row.ready_at as string) ?? null,
    collected_at: (row.collected_at as string) ?? null,
    cancelled_at: (row.cancelled_at as string) ?? null,
    cancel_reason: (row.cancel_reason as string) ?? null,
    estimated_ready_at: (row.estimated_ready_at as string) ?? null,
    collected_confirmed_by_customer: Boolean(row.collected_confirmed_by_customer),
    ring_count: Number(row.ring_count ?? 0),
    last_rung_at: (row.last_rung_at as string) ?? null,
    items: items.map((line) => ({
      id: line.id as string,
      menu_item_id: line.menu_item_id as string,
      name_en: line.name_snapshot as string,
      name_ms: (line.name_snapshot_ms as string) ?? (line.name_snapshot as string),
      unit_price: Number(line.unit_price_snapshot ?? 0),
      qty: Number(line.qty ?? 1),
      modifiers: (line.modifiers as Order['items'][number]['modifiers']) ?? [],
      line_total: Number(line.line_total ?? 0),
    })),
  }
}

const ORDER_SELECT = '*, order_items(*)'

export const supabaseBackend: Backend = {
  kind: 'supabase',

  async getMenu() {
    await ensureGuestSession()
    const c = sb()
    const [cats, items, groups, options, availability] = await Promise.all([
      c.from('categories').select('*').eq('is_active', true).order('sort_order'),
      // menu_items_full adds the recipe jsonb array the UI expects.
      c.from('menu_items_full').select('*').eq('is_active', true).order('sort_order'),
      c.from('modifier_groups').select('*').order('created_at'),
      c.from('modifier_options').select('*').order('created_at'),
      c.from('menu_availability').select('*'),
    ])
    if (items.error) rpcError(items.error)
    const availById = new Map<string, number | null>(
      ((availability.data as { menu_item_id: string; available_units: number | null }[]) ?? []).map(
        (row) => [row.menu_item_id, row.available_units],
      ),
    )
    const groupList: ModifierGroup[] = ((groups.data as ModifierGroup[]) ?? []).map((g) => ({
      ...g,
      options: ((options.data as ModifierGroup['options']) ?? []).filter((o) => o.group_id === g.id),
    }))

    return {
      categories: (cats.data as Category[]) ?? [],
      items: ((items.data as MenuItem[]) ?? []).map(
        (i): MenuItemView => ({
          ...i,
          available_units: availById.has(i.id) ? (availById.get(i.id) as number | null) : null,
        }),
      ),
      groups: groupList,
    }
  },

  async getPublicStatus() {
    await ensureGuestSession()
    const { data, error } = await sb().rpc('get_public_status')
    if (error) rpcError(error)
    return data as PublicStatus
  },

  async placeOrder(input: PlaceOrderInput) {
    await ensureGuestSession()
    const { data, error } = await sb().rpc('place_order', {
      payload: {
        customer_name: input.customer_name,
        items: input.items,
        note: input.note ?? null,
        payment_method: input.payment_method ?? null,
        source: input.source ?? 'customer',
        override: input.override ?? false,
      },
    })
    if (error) rpcError(error)
    const row = data as { order_id: string; display_number: string; estimated_ready_at: string }
    return row satisfies PlaceOrderResult
  },

  async getOrder(id) {
    await ensureGuestSession()
    const { data, error } = await sb().from('orders').select(ORDER_SELECT).eq('id', id).maybeSingle()
    if (error) rpcError(error)
    return data ? mapOrder(data as Record<string, unknown>) : null
  },

  async getMyActiveOrders() {
    await ensureGuestSession()
    const { data: auth } = await sb().auth.getUser()
    if (!auth.user) return []
    const { data, error } = await sb()
      .from('orders')
      .select(ORDER_SELECT)
      .eq('customer_id', auth.user.id)
      .not('status', 'in', '(collected,cancelled)')
      .order('placed_at', { ascending: false })
    if (error) rpcError(error)
    return ((data as Record<string, unknown>[]) ?? []).map(mapOrder)
  },

  async getOrderByDisplayNumber(display) {
    const { data, error } = await sb()
      .from('orders')
      .select(ORDER_SELECT)
      .eq('display_number', display.toUpperCase())
      .maybeSingle()
    if (error) rpcError(error)
    return data ? mapOrder(data as Record<string, unknown>) : null
  },

  async listOrders() {
    const { data, error } = await sb()
      .from('orders')
      .select(ORDER_SELECT)
      .order('placed_at', { ascending: false })
      .limit(300)
    if (error) rpcError(error)
    return ((data as Record<string, unknown>[]) ?? []).map(mapOrder)
  },

  async setOrderStatus(id, status) {
    const { error } = await sb().rpc('set_order_status', { p_order_id: id, p_status: status })
    if (error) rpcError(error)
  },

  async cancelOrder(id, reason) {
    const { error } = await sb().rpc('cancel_order', { p_order_id: id, p_reason: reason })
    if (error) rpcError(error)
  },

  async customerConfirmCollected(id) {
    const { error } = await sb().rpc('customer_confirm_collected', { p_order_id: id })
    if (error) rpcError(error)
  },

  async customerCancelOrder(id) {
    const { error } = await sb().rpc('customer_cancel_order', { p_order_id: id })
    if (error) rpcError(error)
  },

  async ringAgain(id) {
    const { error } = await sb().rpc('ring_again', { p_order_id: id })
    if (error) rpcError(error)
  },

  async getSettings() {
    const { data, error } = await sb().from('events').select('*').eq('is_active', true).single()
    if (error) rpcError(error)
    return data as Settings
  },

  async updateSettings(patch) {
    const { data: active, error: readError } = await sb()
      .from('events')
      .select('id')
      .eq('is_active', true)
      .single()
    if (readError) rpcError(readError)
    const { data, error } = await sb()
      .from('events')
      .update(patch)
      .eq('id', (active as { id: string }).id)
      .select()
      .single()
    if (error) rpcError(error)
    return data as Settings
  },

  async clearTodayOrders(confirm) {
    if (confirm !== 'CLEAR') throw new OrderError('NOT_ALLOWED')
    const { data, error } = await sb().rpc('clear_today', { p_confirm: confirm })
    if (error) {
      // PostgREST answers with this before RLS gets a say when the migration has
      // not been run, and a bare "network error" would send you hunting.
      if (error.code === 'PGRST202' || /could not find the function/i.test(error.message)) {
        throw new OrderError('NETWORK', error.message, undefined, 'MIGRATION_MISSING')
      }
      rpcError(error)
    }
    const row = data as { deleted?: number } | null
    return { deleted: Number(row?.deleted ?? 0) }
  },

  async getIngredients() {
    const { data, error } = await sb().from('ingredients').select('*').order('name')
    if (error) rpcError(error)
    return (data as Ingredient[]) ?? []
  },

  async saveModifierGroup(group) {
    const { error } = await sb()
      .from('modifier_groups')
      .upsert({
        id: group.id,
        name_en: group.name_en,
        name_ms: group.name_ms,
        min_select: group.min_select,
        max_select: group.max_select,
      })
    if (error) rpcError(error)
  },

  async deleteModifierGroup(id) {
    const c = sb()
    // Drinks point at groups by id, so the ids have to come out of them too.
    const { data: affected } = await c
      .from('menu_items')
      .select('id, modifier_group_ids')
      .contains('modifier_group_ids', [id])
    const { error } = await c.from('modifier_groups').delete().eq('id', id)
    if (error) rpcError(error)
    for (const row of (affected ?? []) as { id: string; modifier_group_ids: string[] }[]) {
      const { error: updateError } = await c
        .from('menu_items')
        .update({ modifier_group_ids: row.modifier_group_ids.filter((g) => g !== id) })
        .eq('id', row.id)
      if (updateError) rpcError(updateError)
    }
  },

  async saveModifierOption(option) {
    const { error } = await sb()
      .from('modifier_options')
      .upsert({
        id: option.id,
        group_id: option.group_id,
        name_en: option.name_en,
        name_ms: option.name_ms,
        // The admin screen does not expose an upcharge, but it is carried
        // through so an existing one is not wiped by an unrelated edit.
        price_delta: option.price_delta,
        ingredient_id: option.ingredient_id,
        ingredient_qty: option.ingredient_qty,
      })
    if (error) rpcError(error)
  },

  async deleteModifierOption(id) {
    const { error } = await sb().from('modifier_options').delete().eq('id', id)
    if (error) rpcError(error)
  },

  async saveIngredient(ingredient) {
    const c = sb()
    // A corrected stock level is still a stock movement. Read the old value
    // first so the difference can be logged instead of teleporting the number.
    const { data: before } = await c
      .from('ingredients')
      .select('stock_qty')
      .eq('id', ingredient.id)
      .maybeSingle()
    const { error } = await c.from('ingredients').upsert({
      id: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      stock_qty: ingredient.stock_qty,
      full_level: ingredient.full_level,
      low_stock_threshold: ingredient.low_stock_threshold,
      is_active: ingredient.is_active,
    })
    if (error) rpcError(error)
    const previous = before ? Number((before as { stock_qty: number }).stock_qty) : 0
    const delta = Math.round((ingredient.stock_qty - previous) * 1000) / 1000
    if (delta !== 0) {
      const { error: moveError } = await c
        .from('inventory_movements')
        .insert({ ingredient_id: ingredient.id, delta, reason: 'adjustment' })
      if (moveError) rpcError(moveError)
    }
  },

  async deleteIngredient(id) {
    const { error } = await sb().from('ingredients').delete().eq('id', id)
    if (error) rpcError(error)
  },

  async restockIngredient(id) {
    const c = sb()
    const { data, error } = await c
      .from('ingredients')
      .select('stock_qty, full_level')
      .eq('id', id)
      .single()
    if (error) rpcError(error)
    const row = data as { stock_qty: number; full_level: number }
    const delta = Math.round((Number(row.full_level) - Number(row.stock_qty)) * 1000) / 1000
    const { error: updateError } = await c
      .from('ingredients')
      .update({ stock_qty: row.full_level })
      .eq('id', id)
    if (updateError) rpcError(updateError)
    if (delta !== 0) {
      const { error: moveError } = await c
        .from('inventory_movements')
        .insert({ ingredient_id: id, delta, reason: 'restock' })
      if (moveError) rpcError(moveError)
    }
  },

  async saveMenuItem(item) {
    // Recipe lines live in their own table, so they are stripped from the row
    // and rewritten separately.
    const recipe = item.recipe ?? []
    const row: Record<string, unknown> = { ...item }
    delete row.recipe
    delete row.available_units

    const { data, error } = await sb().from('menu_items').upsert(row).select().single()
    if (error) rpcError(error)

    const { error: deleteError } = await sb().from('recipes').delete().eq('menu_item_id', item.id)
    if (deleteError) rpcError(deleteError)
    if (recipe.length > 0) {
      const { error: insertError } = await sb()
        .from('recipes')
        .insert(recipe.map((line) => ({ menu_item_id: item.id, ingredient_id: line.ingredient_id, qty: line.qty })))
      if (insertError) rpcError(insertError)
    }

    return { ...(data as MenuItem), recipe }
  },

  async deleteMenuItem(id) {
    const { error } = await sb().from('menu_items').delete().eq('id', id)
    if (error) rpcError(error)
  },

  async uploadMenuImage(itemId, file) {
    const { processImage } = await import('./image')
    const blob = await processImage(file, { maxWidth: 1200, maxHeight: 900, quality: 0.8 })
    const path = `${itemId}/${Date.now()}.webp`
    const c = sb()
    const { error } = await c.storage.from('menu-images').upload(path, blob, {
      contentType: 'image/webp',
      upsert: true,
    })
    if (error) rpcError(error)
    const { data } = c.storage.from('menu-images').getPublicUrl(path)
    await c.from('menu_items').update({ image_path: path, image_updated_at: new Date().toISOString() }).eq('id', itemId)
    return data.publicUrl
  },

  subscribe(listener) {
    listeners.add(listener)
    if (closeTimer !== undefined) {
      window.clearTimeout(closeTimer)
      closeTimer = undefined
    }
    openChannel()
    return () => {
      listeners.delete(listener)
      // Several query hooks unmount and remount together, and StrictMode does it
      // twice in development. Wait before dropping the channel, so a remount
      // cancels the close instead of racing it.
      if (listeners.size > 0) return
      closeTimer = window.setTimeout(() => {
        closeTimer = undefined
        if (listeners.size === 0) closeChannel()
      }, 1000)
    }
  },

  async signInAdmin(secret) {
    // In Supabase the secret is the admin's password, paired with their email.
    const email = import.meta.env.VITE_ADMIN_EMAIL as string | undefined
    if (!email) return false
    const { error } = await sb().auth.signInWithPassword({ email, password: secret })
    return !error
  },

  async signOutAdmin() {
    await sb().auth.signOut()
  },

  async isAdmin() {
    const { data } = await sb().rpc('is_admin')
    return Boolean(data)
  },
}
