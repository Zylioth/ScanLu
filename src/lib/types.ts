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
  /** How much one pack holds, in the base unit. Null means counted in base units. */
  pack_size?: number | null
  /** What one pack is called: box, bag, pack, sleeve. */
  pack_name?: string | null
}

export interface ModifierOption {
  id: string
  group_id: string
  name_en: string
  name_ms: string
  price_delta: number
  /** Null when the option does not consume stock. The column is nullable. */
  ingredient_id?: string | null
  ingredient_qty?: number | null
}

export interface ModifierGroup {
  id: string
  name_en: string
  name_ms: string
  min_select: number
  max_select: number
  options: ModifierOption[]
}

/** What the admin editor writes. Options are saved as their own rows. */
export interface ModifierGroupInput {
  id: string
  name_en: string
  name_ms: string
  min_select: number
  max_select: number
}

export interface ModifierOptionInput {
  id: string
  group_id: string
  name_en: string
  name_ms: string
  /**
   * Not editable from the admin screen yet, but carried through on save so an
   * existing upcharge such as oat milk's is never silently dropped.
   */
  price_delta: number
  /** Optional: choosing this option then uses up an ingredient. */
  ingredient_id: string | null
  ingredient_qty: number | null
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
  /**
   * Admin only. Upserts an ingredient. A changed stock level is logged as an
   * adjustment movement, so the movement log still explains every gram.
   */
  saveIngredient(ingredient: Ingredient): Promise<void>
  deleteIngredient(id: string): Promise<void>
  /**
   * Admin only. Adds (or subtracts) stock in base units and logs a movement with
   * the given reason, so the count always has an explanation behind it.
   */
  addIngredientStock(id: string, amount: number, reason: 'restock' | 'adjustment' | 'waste'): Promise<void>
  saveMenuItem(item: MenuItem): Promise<MenuItem>
  deleteMenuItem(id: string): Promise<void>
  /** Admin only. Every item, including the ones switched off, for the menu editor. */
  listAllMenuItems(): Promise<MenuItemView[]>
  /**
   * Stores an already cropped and resized WebP blob and points the item at it.
   * The screen does the cropping, so the zoom the host chose is what gets kept.
   */
  uploadMenuImage(itemId: string, image: Blob): Promise<string>
  /** Admin only. Detaches the photo and deletes the stored file. */
  removeMenuImage(itemId: string): Promise<void>
  /**
   * Admin only. Modifier groups are edited one row at a time rather than saved
   * as a whole, so an option that a guest is already looking at keeps its id.
   */
  saveModifierGroup(group: ModifierGroupInput): Promise<void>
  deleteModifierGroup(id: string): Promise<void>
  saveModifierOption(option: ModifierOptionInput): Promise<void>
  deleteModifierOption(id: string): Promise<void>
  subscribe(listener: () => void): () => void
  /** Demo mode takes the passcode as the password and ignores the email. */
  signInAdmin(email: string, password: string): Promise<boolean>
  signOutAdmin(): Promise<void>
  isAdmin(): Promise<boolean>
}
