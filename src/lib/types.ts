/**
 * Domain types. These mirror supabase/migrations/0001_init.sql so the local
 * demo backend and the Supabase backend can serve the same UI.
 */

export type OrderStatus = 'placed' | 'preparing' | 'ready' | 'collected' | 'cancelled'
export type PaymentMethod = 'cash' | 'transfer' | 'free'
export type PaymentStatus = 'unpaid' | 'paid' | 'free'
export type OrderSource = 'customer' | 'admin'
export type Unit = 'g' | 'ml' | 'pcs'

export interface Settings {
  event_name: string
  host_name: string
  orders_open: boolean
  free_mode: boolean
  max_cups_per_order: number
  max_cups_per_person: number | null
  max_active_orders_per_person: number
  max_cups_per_hour: number | null
  max_cups_per_day: number | null
  max_queue_cups: number | null
  per_person_cooldown_seconds: number
  auto_accept: boolean
  default_payment_method: PaymentMethod
  message_banner: string | null
  require_name: boolean
  currency: string
}

export interface Category {
  id: string
  name_en: string
  name_ms: string
  sort_order: number
  is_active: boolean
}

export interface Ingredient {
  id: string
  name: string
  unit: Unit
  stock_qty: number
  full_level: number
  low_stock_threshold: number
  is_active: boolean
}

export interface ModifierOption {
  id: string
  group_id: string
  name_en: string
  name_ms: string
  price_delta: number
  ingredient_id?: string
  ingredient_qty?: number
}

export interface ModifierGroup {
  id: string
  name_en: string
  name_ms: string
  min_select: number
  max_select: number
  options: ModifierOption[]
}

export interface RecipeLine {
  ingredient_id: string
  qty: number
}

export interface MenuItem {
  id: string
  category_id: string
  name_en: string
  name_ms: string
  description_en: string
  description_ms: string
  price: number
  image_url: string | null
  is_active: boolean
  is_sold_out_manual: boolean
  sort_order: number
  hourly_cap: number | null
  prep_seconds: number
  modifier_group_ids: string[]
  recipe: RecipeLine[]
}

/** A menu item joined with live availability, as the guest menu sees it. */
export interface MenuItemView extends MenuItem {
  /** null means "no recipe tracked", so treat as unlimited. */
  available_units: number | null
}

export interface OrderItemModifier {
  group_en: string
  group_ms: string
  option_en: string
  option_ms: string
  price_delta: number
}

export interface OrderItem {
  id: string
  menu_item_id: string
  name_en: string
  name_ms: string
  unit_price: number
  qty: number
  modifiers: OrderItemModifier[]
  line_total: number
}

export interface Order {
  id: string
  order_number: number
  display_number: string
  customer_id: string
  customer_name: string
  source: OrderSource
  status: OrderStatus
  payment_method: PaymentMethod
  payment_status: PaymentStatus
  total: number
  note: string | null
  items: OrderItem[]
  placed_at: string
  preparing_at: string | null
  ready_at: string | null
  collected_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  estimated_ready_at: string | null
  collected_confirmed_by_customer: boolean
  ring_count: number
  last_rung_at: string | null
}

export interface PublicStatus {
  event_name: string
  host_name: string
  orders_open: boolean
  banner: string | null
  queue_cups: number
  cups_this_hour: number
  max_cups_per_hour: number | null
  wait_minutes: number
  free_mode: boolean
  max_cups_per_order: number
  require_name: boolean
  currency: string
  /** Cups this device may still order in the current event, null = unlimited. */
  person_remaining: number | null
  cooldown_remaining_seconds: number
}

export interface PlaceOrderItemInput {
  menu_item_id: string
  qty: number
  modifier_option_ids: string[]
}

export interface PlaceOrderInput {
  customer_name: string
  items: PlaceOrderItemInput[]
  note?: string
  payment_method?: PaymentMethod
  /** Admin walk-ins may skip per-person limits. Stock is still enforced. */
  source?: OrderSource
  override?: boolean
}

export interface PlaceOrderResult {
  order_id: string
  display_number: string
  estimated_ready_at: string
}

export type OrderErrorCode =
  | 'ORDERS_CLOSED'
  | 'CART_EMPTY'
  | 'NAME_REQUIRED'
  | 'MAX_CUPS_PER_ORDER'
  | 'MAX_ACTIVE_ORDERS_PER_PERSON'
  | 'MAX_CUPS_PER_PERSON'
  | 'PER_PERSON_COOLDOWN'
  | 'MAX_CUPS_PER_HOUR'
  | 'MAX_CUPS_PER_DAY'
  | 'MAX_QUEUE_CUPS'
  | 'ITEM_HOURLY_CAP'
  | 'ITEM_UNAVAILABLE'
  | 'OUT_OF_STOCK'
  | 'ORDER_NOT_FOUND'
  | 'INVALID_TRANSITION'
  | 'NOT_ALLOWED'
  | 'NETWORK'

export class OrderError extends Error {
  code: OrderErrorCode
  retryAfterSeconds?: number
  detail?: string

  constructor(code: OrderErrorCode, message?: string, retryAfterSeconds?: number, detail?: string) {
    super(message ?? code)
    this.name = 'OrderError'
    this.code = code
    this.retryAfterSeconds = retryAfterSeconds
    this.detail = detail
  }
}

export interface Backend {
  readonly kind: 'local' | 'supabase'
  getMenu(): Promise<{ categories: Category[]; items: MenuItemView[]; groups: ModifierGroup[] }>
  getPublicStatus(): Promise<PublicStatus>
  placeOrder(input: PlaceOrderInput): Promise<PlaceOrderResult>
  getOrder(id: string): Promise<Order | null>
  getMyActiveOrders(): Promise<Order[]>
  getOrderByDisplayNumber(display: string): Promise<Order | null>
  listOrders(): Promise<Order[]>
  setOrderStatus(id: string, status: OrderStatus): Promise<void>
  cancelOrder(id: string, reason: string): Promise<void>
  customerConfirmCollected(id: string): Promise<void>
  customerCancelOrder(id: string): Promise<void>
  ringAgain(id: string): Promise<void>
  getSettings(): Promise<Settings>
  updateSettings(patch: Partial<Settings>): Promise<Settings>
  /**
   * Admin only. Deletes today's orders, puts their stock back and restarts
   * today's numbering, so the next order is A-001 again. `confirm` must be the
   * literal 'CLEAR'; anything else is refused rather than quietly obeyed.
   */
  clearTodayOrders(confirm: string): Promise<{ deleted: number }>
  getIngredients(): Promise<Ingredient[]>
  saveMenuItem(item: MenuItem): Promise<MenuItem>
  deleteMenuItem(id: string): Promise<void>
  uploadMenuImage(itemId: string, file: File): Promise<string>
  subscribe(listener: () => void): () => void
  signInAdmin(secret: string): Promise<boolean>
  signOutAdmin(): Promise<void>
  isAdmin(): Promise<boolean>
}
