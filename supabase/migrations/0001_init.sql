-- =============================================================================
-- MyPOS guest ordering schema (Supabase / Postgres 15+)
-- =============================================================================
-- Mirrors src/lib/types.ts (camelCase there, snake_case here) and the tables,
-- views and RPCs that src/lib/supabaseBackend.ts calls. Every rule enforced in
-- src/lib/localBackend.ts is enforced again here so the demo and a real deploy
-- behave the same.
--
-- Re-runnable: enums are created inside DO blocks that skip when they exist,
-- tables use IF NOT EXISTS, functions use CREATE OR REPLACE, policies are
-- dropped before they are recreated, and the storage bucket is inserted with
-- ON CONFLICT.
--
-- RPC contract (names and argument names are load bearing, the client calls
-- them by name and parses the error prefix):
--   place_order(payload jsonb)                     -> jsonb
--   set_order_status(p_order_id uuid, p_status order_status) -> void
--   cancel_order(p_order_id uuid, p_reason text)   -> void
--   customer_confirm_collected(p_order_id uuid)    -> void
--   customer_cancel_order(p_order_id uuid)         -> void
--   ring_again(p_order_id uuid)                    -> void
--   get_public_status()                            -> jsonb
--   is_admin()                                     -> boolean
-- =============================================================================

-- The admin table references auth.users, so this file only makes sense on a
-- Supabase project (or a database that has a local auth schema stub).
do $guard$ begin
  if to_regclass('auth.users') is null then
    raise exception 'auth.users is missing. Run this migration on a Supabase project.';
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon')
     or not exists (select 1 from pg_roles where rolname = 'authenticated') then
    raise exception 'The anon and authenticated roles are missing. Run this on a Supabase project.';
  end if;
end $guard$;

grant usage on schema public to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
-- Postgres has no CREATE TYPE IF NOT EXISTS, so each type is created only when
-- pg_type has no row for it yet.
do $types$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'order_status'
  ) then
    create type public.order_status as enum ('placed', 'preparing', 'ready', 'collected', 'cancelled');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_method'
  ) then
    create type public.payment_method as enum ('cash', 'transfer', 'free');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'payment_status'
  ) then
    create type public.payment_status as enum ('unpaid', 'paid', 'free');
  end if;

  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'order_source'
  ) then
    create type public.order_source as enum ('customer', 'admin');
  end if;
end $types$;

-- -----------------------------------------------------------------------------
-- Small time helper, defined before the tables because orders.order_day defaults
-- to it. The event runs on Brunei wall clock time (UTC+8, no daylight saving).
-- -----------------------------------------------------------------------------
create or replace function public.event_day(p_at timestamptz default now())
returns date
language sql
stable
set search_path = public
as $fn$
  select (p_at at time zone 'Asia/Brunei')::date;
$fn$;

comment on function public.event_day(timestamptz) is
  'Calendar day of an instant in Asia/Brunei, used for daily counters and per-day limits.';

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

-- Who may see stock, limits, the admin board and other guests' orders.
-- The first row is inserted with the service role or from the SQL editor.
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per open house. The app reads event_name and host_name straight off
-- this row (getSettings) so both must be real columns.
create table if not exists public.events (
  id                          uuid primary key default gen_random_uuid(),
  event_name                  text not null default 'Open House Drinks',
  -- `name` is kept as a generated mirror of event_name for older clients and for
  -- anyone reading the table by eye. event_name is the column the app reads.
  name                        text generated always as (event_name) stored,
  host_name                   text not null default 'Your name here',
  is_active                   boolean not null default true,
  orders_open                 boolean not null default true,
  starts_at                   timestamptz,
  ends_at                     timestamptz,
  currency                    text not null default 'BND',
  created_at                  timestamptz not null default now(),
  free_mode                   boolean not null default false,
  max_cups_per_order          integer not null default 2 check (max_cups_per_order >= 0),
  max_cups_per_person         integer check (max_cups_per_person is null or max_cups_per_person >= 0),
  max_active_orders_per_person integer not null default 2 check (max_active_orders_per_person >= 0),
  max_cups_per_hour           integer check (max_cups_per_hour is null or max_cups_per_hour >= 0),
  max_cups_per_day            integer check (max_cups_per_day is null or max_cups_per_day >= 0),
  max_queue_cups              integer check (max_queue_cups is null or max_queue_cups >= 0),
  per_person_cooldown_seconds integer not null default 0
    check (per_person_cooldown_seconds >= 0),
  auto_accept                 boolean not null default true,
  default_payment_method      public.payment_method not null default 'cash',
  message_banner              text,
  require_name                boolean not null default true
);

comment on column public.events.name is
  'Generated mirror of event_name. Write event_name; name follows automatically.';

create table if not exists public.categories (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ms    text not null,
  sort_order integer not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.ingredients (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  unit               text not null check (unit in ('g', 'ml', 'pcs')),
  stock_qty          numeric(12,3) not null default 0,
  full_level         numeric(12,3) not null default 0,
  low_stock_threshold numeric(12,3) not null default 0,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

create table if not exists public.menu_items (
  id                  uuid primary key default gen_random_uuid(),
  category_id         uuid references public.categories (id),
  name_en             text not null,
  name_ms             text not null,
  description_en      text not null default '',
  description_ms      text not null default '',
  price               numeric(8,2) not null default 0 check (price >= 0),
  image_url           text,
  image_path          text,
  image_updated_at    timestamptz,
  is_active           boolean not null default true,
  is_sold_out_manual  boolean not null default false,
  sort_order          integer not null default 0,
  hourly_cap          integer check (hourly_cap is null or hourly_cap >= 0),
  prep_seconds        integer not null default 120 check (prep_seconds >= 0),
  modifier_group_ids  uuid[] not null default '{}'::uuid[],
  created_at          timestamptz not null default now()
);

create table if not exists public.modifier_groups (
  id         uuid primary key default gen_random_uuid(),
  name_en    text not null,
  name_ms    text not null,
  min_select integer not null default 1 check (min_select >= 0),
  max_select integer not null default 1 check (max_select >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.modifier_options (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.modifier_groups (id) on delete cascade,
  name_en        text not null,
  name_ms        text not null,
  price_delta    numeric(8,2) not null default 0,
  ingredient_id  uuid references public.ingredients (id) on delete set null,
  ingredient_qty numeric(12,3) check (ingredient_qty is null or ingredient_qty >= 0),
  created_at     timestamptz not null default now()
);

-- Recipe lines are relational so stock math stays exact. The guest menu reads
-- them through the menu_items_full view below.
--
-- Note for the admin save path: a MenuItem object from src/lib/types.ts carries a
-- `recipe` array, so a blind upsert of that object into menu_items fails with an
-- unknown column. Write the item and its recipe rows separately (upsert into
-- menu_items, then delete and re-insert the rows in recipes).
create table if not exists public.recipes (
  menu_item_id  uuid not null references public.menu_items (id) on delete cascade,
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  qty           numeric(12,3) not null check (qty >= 0),
  primary key (menu_item_id, ingredient_id)
);

create table if not exists public.orders (
  id                            uuid primary key default gen_random_uuid(),
  event_id                      uuid not null references public.events (id) on delete cascade,
  -- Counter numbers reset per event per day, so uniqueness has to include the
  -- day. order_day is written by place_order and by the default below.
  order_day                     date not null default public.event_day(),
  order_number                  integer not null check (order_number > 0),
  display_number                text not null,
  customer_id                   uuid,
  customer_name                 text not null default '',
  source                        public.order_source not null default 'customer',
  status                        public.order_status not null default 'placed',
  payment_method                public.payment_method not null default 'cash',
  payment_status                public.payment_status not null default 'unpaid',
  total                         numeric(10,2) not null default 0,
  note                          text,
  placed_at                     timestamptz not null default now(),
  preparing_at                  timestamptz,
  ready_at                      timestamptz,
  collected_at                  timestamptz,
  cancelled_at                  timestamptz,
  cancel_reason                 text,
  estimated_ready_at            timestamptz,
  collected_confirmed_by_customer boolean not null default false,
  ring_count                    integer not null default 0 check (ring_count >= 0),
  last_rung_at                  timestamptz
);

comment on column public.orders.customer_id is
  'auth.uid() of the guest who placed the order. No FK to auth.users so deleting an account does not erase event history.';
comment on column public.orders.order_day is
  'Brunei calendar day of placed_at. The display counter restarts each day, so (event_id, order_day, order_number) is the stable slot.';

create table if not exists public.order_items (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null references public.orders (id) on delete cascade,
  menu_item_id       uuid references public.menu_items (id) on delete set null,
  name_snapshot      text not null,
  name_snapshot_ms   text,
  unit_price_snapshot numeric(8,2) not null default 0,
  qty                integer not null check (qty > 0),
  modifiers          jsonb not null default '[]'::jsonb
    check (jsonb_typeof(modifiers) = 'array'),
  line_total         numeric(10,2) not null default 0,
  created_at         timestamptz not null default now()
);

create table if not exists public.inventory_movements (
  id            uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references public.ingredients (id) on delete cascade,
  delta         numeric(12,3) not null,
  reason        text not null
    check (reason in ('order', 'order_cancel', 'restock', 'adjustment', 'waste')),
  order_id      uuid references public.orders (id) on delete set null,
  note          text,
  created_by    uuid,
  created_at    timestamptz not null default now()
);

create table if not exists public.event_counters (
  event_id    uuid not null references public.events (id) on delete cascade,
  day         date not null,
  last_number integer not null default 0 check (last_number >= 0),
  primary key (event_id, day)
);

-- -----------------------------------------------------------------------------
-- Indexes
-- -----------------------------------------------------------------------------
create index if not exists orders_event_status_idx
  on public.orders (event_id, status);
create index if not exists orders_customer_event_idx
  on public.orders (customer_id, event_id);
create index if not exists orders_event_placed_at_idx
  on public.orders (event_id, placed_at);
create index if not exists order_items_order_idx
  on public.order_items (order_id);
create index if not exists inventory_movements_ingredient_created_idx
  on public.inventory_movements (ingredient_id, created_at);
create index if not exists menu_items_category_idx
  on public.menu_items (category_id);
create index if not exists recipes_ingredient_idx
  on public.recipes (ingredient_id);
create index if not exists orders_display_number_idx
  on public.orders (display_number);
-- One numbering slot per event, day and number. The counter row is the source of
-- truth, this index makes a duplicate number impossible.
create unique index if not exists orders_event_day_number_key
  on public.orders (event_id, order_day, order_number);
-- At most one event can be active. The partial unique index over the constant
-- is_active value lets a second active row exist only after the first is closed.
create unique index if not exists events_single_active_idx
  on public.events ((is_active)) where is_active;

-- -----------------------------------------------------------------------------
-- Helper functions
-- -----------------------------------------------------------------------------

-- SECURITY DEFINER so a policy can ask the question without granting every
-- caller SELECT on admins. STABLE, the answer cannot change inside one query.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $fn$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$fn$;

comment on function public.is_admin() is
  'True when the calling JWT belongs to a row in public.admins.';

-- Same reason: the public needs the active event id but may not read events.
create or replace function public.active_event_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $fn$
  select e.id from public.events e where e.is_active order by e.created_at limit 1;
$fn$;

-- -----------------------------------------------------------------------------
-- Views
-- -----------------------------------------------------------------------------

-- Units a menu item can still make from current stock.
--   null = the item has no tracked recipe, so treat it as unlimited
--   0    = sold out manually, inactive, or an ingredient on its recipe is off
-- The min() runs over recipe lines that actually consume stock (qty > 0).
-- Security: the view is owned by the migration role, so it can read ingredients
-- and recipes while those tables stay admin only, and it exposes only the
-- resulting number.
create or replace view public.menu_availability as
select
  mi.id as menu_item_id,
  case
    when mi.is_sold_out_manual or not mi.is_active then 0
    when avail.min_units is null then null
    when exists (
      select 1
      from public.recipes r
      join public.ingredients i on i.id = r.ingredient_id
      where r.menu_item_id = mi.id and not i.is_active
    ) then 0
    else greatest(0, avail.min_units)::int
  end as available_units
from public.menu_items mi
left join lateral (
  select floor(min(i.stock_qty / r.qty))::int as min_units
  from public.recipes r
  join public.ingredients i on i.id = r.ingredient_id
  where r.menu_item_id = mi.id and r.qty > 0
) avail on true;

comment on view public.menu_availability is
  'available_units per menu item: null when the item has no recipe, 0 when it cannot be made.';

-- The guest menu: menu_items plus the recipe array the TypeScript MenuItem type
-- expects. supabaseBackend.getMenu() should read this view instead of the table
-- (that adapter change is being made separately).
--
-- Nothing is hidden here on purpose: the guest UI needs the recipe lines, so the
-- view is a deliberate, read only widening of the admin only recipes table. If
-- you ever need to hide ingredient quantities, drop the recipe column from this
-- view and read the table as admin.
create or replace view public.menu_items_full as
select
  mi.*,
  coalesce((
    select jsonb_agg(
             jsonb_build_object('ingredient_id', r.ingredient_id, 'qty', r.qty)
             order by r.ingredient_id
           )
    from public.recipes r
    where r.menu_item_id = mi.id
  ), '[]'::jsonb) as recipe
from public.menu_items mi;

comment on view public.menu_items_full is
  'menu_items plus recipe jsonb [{ingredient_id, qty}]. The stable order lets the client diff recipes.';

-- Safe public columns of the active event. No limits internals, no counters, no
-- admin switches. The view is owned by the migration role so it can read the
-- admin only events table while guests cannot.
create or replace view public.public_event as
select
  e.id,
  e.event_name,
  e.host_name,
  e.orders_open,
  e.free_mode,
  e.currency,
  e.message_banner,
  e.starts_at,
  e.ends_at,
  e.created_at
from public.events e
where e.is_active;

comment on view public.public_event is
  'Public slice of the single active event. Direct events access is admin only.';

-- -----------------------------------------------------------------------------
-- Stock restore helper (internal)
-- -----------------------------------------------------------------------------
-- Restores exactly what the order took by replaying its own inventory_movements
-- rows, so a recipe edited after the order was placed cannot inflate the refund.
-- The order_cancel row doubles as the "already restored" marker, which makes a
-- double cancel harmless. Not callable by clients.
create or replace function public._restore_order_stock(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_move record;
begin
  if exists (
    select 1 from public.inventory_movements m
    where m.order_id = p_order_id and m.reason = 'order_cancel'
  ) then
    return;
  end if;

  -- Deterministic ingredient order keeps two concurrent restores from
  -- deadlocking on the same pair of rows.
  for v_move in
    select m.ingredient_id, round(sum(-m.delta), 3) as qty
    from public.inventory_movements m
    where m.order_id = p_order_id and m.reason = 'order'
    group by m.ingredient_id
    order by m.ingredient_id
  loop
    update public.ingredients i
       set stock_qty = round(i.stock_qty + v_move.qty, 3)
     where i.id = v_move.ingredient_id;

    insert into public.inventory_movements (ingredient_id, delta, reason, order_id, created_by)
    values (v_move.ingredient_id, v_move.qty, 'order_cancel', p_order_id, auth.uid());
  end loop;
end $fn$;

revoke all on function public._restore_order_stock(uuid) from public;

-- -----------------------------------------------------------------------------
-- place_order
-- -----------------------------------------------------------------------------
-- One transaction. The advisory lock is keyed on the event, so two phones that
-- press Pay at the same instant are serialised and the second one sees the stock
-- the first one left behind instead of overselling the last cup.
--
-- Error messages are a contract with src/lib/supabaseBackend.ts: it splits on
-- the first colon, matches the prefix against a known code and reads retry=<n>.
-- Keep the exact spellings.
create or replace function public.place_order(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_now          timestamptz := clock_timestamp();
  v_uid          uuid := auth.uid();
  v_event_id     uuid;
  v_event        public.events%rowtype;
  v_item         public.menu_items%rowtype;
  v_ing          public.ingredients%rowtype;
  v_mod          record;
  v_recipe       record;
  v_stock        record;
  v_line         jsonb;
  v_opt          jsonb;
  v_items        jsonb;
  v_lines        jsonb := '[]'::jsonb;
  v_mods         jsonb;
  v_needs        jsonb := '{}'::jsonb;
  v_source       public.order_source;
  v_override     boolean;
  v_name         text;
  v_day          date;
  v_cups         int := 0;
  v_qty          int;
  v_option_id    uuid;
  v_unit_price   numeric(10,2);
  v_line_total   numeric(10,2);
  v_total        numeric(10,2) := 0;
  v_need         numeric(12,3);
  v_short        text[] := '{}';
  v_order_number int;
  v_display      text;
  v_status       public.order_status;
  v_pay_method   public.payment_method;
  v_pay_status   public.payment_status;
  v_order_id     uuid;
  v_queue        int := 0;
  v_used_hour    int := 0;
  v_used_day     int := 0;
  v_used_item    int;
  v_my_cups      int := 0;
  v_my_active    int := 0;
  v_overflow     int;
  v_retry        int;
  v_last         timestamptz;
  v_cart_prep    int := 0;
  v_prep         int;
  v_ready_at     timestamptz;
begin
  -- 1. Resolve the active event, then lock the event before reading anything
  --    that depends on it. Reading the row after the lock means a concurrent
  --    "close orders" cannot slip in between the check and the insert.
  v_event_id := public.active_event_id();
  if v_event_id is null then
    raise exception 'ORDERS_CLOSED';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_event_id::text)::bigint);

  select * into v_event from public.events e where e.id = v_event_id;
  if not found then
    raise exception 'ORDERS_CLOSED';
  end if;
  if not v_event.orders_open then
    raise exception 'ORDERS_CLOSED';
  end if;

  -- 2. Who is ordering. source='admin' and override=true skip per-person limits,
  --    which is exactly why they may only be used by a real admin.
  v_source := case
    when lower(coalesce(payload ->> 'source', 'customer')) = 'admin'
      then 'admin'::public.order_source
    else 'customer'::public.order_source
  end;
  v_override := coalesce((payload ->> 'override')::boolean, false);

  if (v_source = 'admin' or v_override) and not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;
  -- A guest order without a session cannot be counted against a person, so the
  -- per-person limits would silently disappear. Anonymous sign-in (what the
  -- adapter does on first use) always provides one.
  if v_source = 'customer' and v_uid is null then
    raise exception 'NOT_ALLOWED';
  end if;

  -- 3. Name. Matches the demo: trimmed, capped at 20 characters, and a walk-in
  --    default when the host turned the name requirement off.
  v_name := left(btrim(coalesce(payload ->> 'customer_name', '')), 20);
  if v_event.require_name and v_name = '' then
    raise exception 'NAME_REQUIRED';
  end if;
  if v_name = '' then
    v_name := 'Walk-in';
  end if;

  -- 4. Cart shape and the per-order cup cap.
  v_items := payload -> 'items';
  if v_items is null
     or jsonb_typeof(v_items) <> 'array'
     or jsonb_array_length(v_items) = 0 then
    raise exception 'CART_EMPTY';
  end if;

  for v_line in select value from jsonb_array_elements(v_items) loop
    v_qty := coalesce((v_line ->> 'qty')::int, 0);
    if v_qty < 1 then
      raise exception 'CART_EMPTY';
    end if;
    v_cups := v_cups + v_qty;
  end loop;

  if v_event.max_cups_per_order is not null and v_cups > v_event.max_cups_per_order then
    raise exception 'MAX_CUPS_PER_ORDER';
  end if;

  v_day := public.event_day(v_now);

  -- Cups sitting in the queue right now (placed, preparing or ready). Needed by
  -- the queue limit and by the wait estimate, so it is read once, before insert.
  select coalesce(sum(oi.qty), 0) into v_queue
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.event_id = v_event.id
    and o.status in ('placed', 'preparing', 'ready');

  -- 5. Event wide limits. override=true skips these (the host is pouring by hand
  --    at the counter and knows about the rush); source='admin' alone does not.
  if not v_override then
    -- Rolling 60 minute window over every non cancelled order of this event.
    if v_event.max_cups_per_hour is not null then
      select coalesce(sum(oi.qty), 0) into v_used_hour
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.event_id = v_event.id
        and o.status <> 'cancelled'
        and o.placed_at >= v_now - interval '1 hour';

      if v_used_hour + v_cups > v_event.max_cups_per_hour then
        v_overflow := v_used_hour + v_cups - v_event.max_cups_per_hour;
        v_retry := 3600;
        -- Retry when enough of the oldest cups have aged out of the window: walk
        -- the window oldest first and stop at the order whose cumulative cups
        -- cover the overflow, then report how long until that order expires.
        select (greatest(1, ceil(extract(epoch from (cum.placed_at + interval '1 hour' - v_now)))))::int
          into v_retry
        from (
          select per_order.placed_at,
                 sum(per_order.cups) over (
                   order by per_order.placed_at, per_order.id
                   rows between unbounded preceding and current row
                 ) as running
          from (
            select o.id, o.placed_at, sum(oi.qty)::int as cups
            from public.orders o
            join public.order_items oi on oi.order_id = o.id
            where o.event_id = v_event.id
              and o.status <> 'cancelled'
              and o.placed_at >= v_now - interval '1 hour'
            group by o.id, o.placed_at
          ) per_order
        ) cum
        where cum.running >= v_overflow
        order by cum.running
        limit 1;

        raise exception 'MAX_CUPS_PER_HOUR:retry=%', coalesce(v_retry, 3600);
      end if;
    end if;

    -- Cups since Brunei midnight. Retry is until the next Brunei midnight.
    if v_event.max_cups_per_day is not null then
      select coalesce(sum(oi.qty), 0) into v_used_day
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.event_id = v_event.id
        and o.status <> 'cancelled'
        and o.placed_at >= (v_day::timestamp at time zone 'Asia/Brunei')
        and o.placed_at <  ((v_day + 1)::timestamp at time zone 'Asia/Brunei');

      if v_used_day + v_cups > v_event.max_cups_per_day then
        v_retry := (greatest(1, ceil(extract(epoch from (
          ((v_day + 1)::timestamp at time zone 'Asia/Brunei') - v_now
        )))))::int;
        raise exception 'MAX_CUPS_PER_DAY:retry=%', v_retry;
      end if;
    end if;

    if v_event.max_queue_cups is not null and v_queue + v_cups > v_event.max_queue_cups then
      raise exception 'MAX_QUEUE_CUPS:retry=300';
    end if;
  end if;

  -- 6. Per-person limits. Guests only: the host behind the counter is not the
  --    person the queue belongs to.
  if v_source = 'customer' and not v_override then
    select count(*) into v_my_active
    from public.orders o
    where o.event_id = v_event.id
      and o.customer_id = v_uid
      and o.status in ('placed', 'preparing', 'ready');

    if v_event.max_active_orders_per_person is not null
       and v_my_active >= v_event.max_active_orders_per_person then
      raise exception 'MAX_ACTIVE_ORDERS_PER_PERSON:retry=120';
    end if;

    select coalesce(sum(oi.qty), 0) into v_my_cups
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.event_id = v_event.id
      and o.customer_id = v_uid
      and o.status <> 'cancelled';

    if v_event.max_cups_per_person is not null
       and v_my_cups + v_cups > v_event.max_cups_per_person then
      raise exception 'MAX_CUPS_PER_PERSON';
    end if;

    if coalesce(v_event.per_person_cooldown_seconds, 0) > 0 then
      select max(o.placed_at) into v_last
      from public.orders o
      where o.event_id = v_event.id
        and o.customer_id = v_uid
        and o.status <> 'cancelled';

      if v_last is not null then
        v_retry := (ceil(extract(epoch from (
          v_last + make_interval(secs => v_event.per_person_cooldown_seconds) - v_now
        ))))::int;
        if v_retry > 0 then
          raise exception 'PER_PERSON_COOLDOWN:retry=%', v_retry;
        end if;
      end if;
    end if;
  end if;

  -- 7. Resolve every line: availability, item hourly cap, modifier snapshots,
  --    price and the ingredient needs. Nothing is written yet.
  for v_line in select value from jsonb_array_elements(v_items) loop
    select * into v_item
    from public.menu_items mi
    where mi.id = (v_line ->> 'menu_item_id')::uuid;

    if not found or not v_item.is_active or v_item.is_sold_out_manual then
      raise exception 'ITEM_UNAVAILABLE';
    end if;

    v_qty := (v_line ->> 'qty')::int;

    -- Per item rolling hour cap (the tray of 20 croissants problem).
    if v_item.hourly_cap is not null and not v_override then
      select coalesce(sum(oi.qty), 0) into v_used_item
      from public.orders o
      join public.order_items oi on oi.order_id = o.id
      where o.event_id = v_event.id
        and o.status <> 'cancelled'
        and o.placed_at >= v_now - interval '1 hour'
        and oi.menu_item_id = v_item.id;

      if v_used_item + v_qty > v_item.hourly_cap then
        raise exception 'ITEM_HOURLY_CAP:retry=1200';
      end if;
    end if;

    v_unit_price := v_item.price;
    v_mods := '[]'::jsonb;

    if v_line ? 'modifier_option_ids'
       and jsonb_typeof(v_line -> 'modifier_option_ids') = 'array' then
      for v_opt in
        select value from jsonb_array_elements(v_line -> 'modifier_option_ids')
      loop
        -- Unknown or malformed option ids are ignored, exactly like the demo.
        if jsonb_typeof(v_opt) <> 'string' then
          continue;
        end if;
        v_option_id := (v_opt #>> '{}')::uuid;

        select mo.id, mo.name_en, mo.name_ms, mo.price_delta,
               mo.ingredient_id, mo.ingredient_qty,
               mg.name_en as group_en, mg.name_ms as group_ms
          into v_mod
        from public.modifier_options mo
        join public.modifier_groups mg on mg.id = mo.group_id
        where mo.id = v_option_id;

        if not found then
          continue;
        end if;

        v_unit_price := v_unit_price + v_mod.price_delta;
        v_mods := v_mods || jsonb_build_object(
          'group_en', v_mod.group_en,
          'group_ms', v_mod.group_ms,
          'option_en', v_mod.name_en,
          'option_ms', v_mod.name_ms,
          'price_delta', v_mod.price_delta
        );

        if v_mod.ingredient_id is not null and coalesce(v_mod.ingredient_qty, 0) > 0 then
          v_need := round(v_mod.ingredient_qty * v_qty, 3);
          v_needs := jsonb_set(
            v_needs,
            array[v_mod.ingredient_id::text],
            to_jsonb(coalesce((v_needs ->> (v_mod.ingredient_id::text))::numeric, 0) + v_need)
          );
        end if;
      end loop;
    end if;

    for v_recipe in
      select r.ingredient_id, r.qty from public.recipes r where r.menu_item_id = v_item.id
    loop
      v_need := round(v_recipe.qty * v_qty, 3);
      v_needs := jsonb_set(
        v_needs,
        array[v_recipe.ingredient_id::text],
        to_jsonb(coalesce((v_needs ->> (v_recipe.ingredient_id::text))::numeric, 0) + v_need)
      );
    end loop;

    v_unit_price := round(v_unit_price, 2);
    v_line_total := round(v_unit_price * v_qty, 2);
    v_total := v_total + v_line_total;
    v_cart_prep := greatest(v_cart_prep, coalesce(v_item.prep_seconds, 120));

    v_lines := v_lines || jsonb_build_object(
      'menu_item_id', v_item.id,
      'name_en', v_item.name_en,
      'name_ms', v_item.name_ms,
      'unit_price', v_unit_price,
      'qty', v_qty,
      'modifiers', v_mods,
      'line_total', v_line_total
    );
  end loop;

  -- 8. Lock the ingredient rows and refuse before writing anything. Locking in
  --    ingredient id order means two carts with the same two ingredients always
  --    take the locks in the same order and cannot deadlock.
  for v_stock in
    select (e.key)::uuid as ingredient_id, (e.value)::numeric as need
    from jsonb_each_text(v_needs) as e
    order by (e.key)::uuid
  loop
    select * into v_ing
    from public.ingredients i
    where i.id = v_stock.ingredient_id
    for update;

    if not found then
      continue;
    end if;

    if v_ing.stock_qty < v_stock.need then
      if not (v_ing.name = any (v_short)) then
        v_short := v_short || v_ing.name;
      end if;
    end if;
  end loop;

  if coalesce(array_length(v_short, 1), 0) > 0 then
    -- The client shows everything after the colon to the guest.
    raise exception 'OUT_OF_STOCK:%', array_to_string(v_short, ', ');
  end if;

  -- 9. Payment, status, number and wait estimate.
  if v_event.free_mode then
    v_pay_method := 'free';
    v_pay_status := 'free';
  else
    v_pay_method := case
      when payload ->> 'payment_method' in ('cash', 'transfer', 'free')
        then (payload ->> 'payment_method')::public.payment_method
      else v_event.default_payment_method
    end;
    v_pay_status := 'unpaid';
  end if;

  v_status := case
    when v_event.auto_accept then 'preparing'::public.order_status
    else 'placed'::public.order_status
  end;

  -- Counter allocation. The advisory lock held above makes this insert the only
  -- writer for (event, day), so no row can be lost to a race.
  insert into public.event_counters as ec (event_id, day, last_number)
  values (v_event.id, v_day, 1)
  on conflict (event_id, day) do update set last_number = ec.last_number + 1
  returning ec.last_number into v_order_number;

  -- A-001 .. A-999, then B-001. Same rule as displayNumberFor() in format.ts.
  v_display := chr(65 + ((v_order_number - 1) / 999))
               || '-' || lpad((((v_order_number - 1) % 999) + 1)::text, 3, '0');

  -- Wait estimate: cups queued ahead plus this cart, times the slowest drink in
  -- the cart. Rough by design, the host can always call it by hand.
  v_prep := case when v_cart_prep > 0 then v_cart_prep else 120 end;
  v_ready_at := v_now + make_interval(secs => ((v_queue + v_cups) * v_prep)::double precision);

  insert into public.orders (
    event_id, order_day, order_number, display_number, customer_id, customer_name,
    source, status, payment_method, payment_status, total, note,
    placed_at, preparing_at, estimated_ready_at
  ) values (
    v_event.id, v_day, v_order_number, v_display, v_uid, v_name,
    v_source, v_status, v_pay_method, v_pay_status, round(v_total, 2),
    left(nullif(btrim(coalesce(payload ->> 'note', '')), ''), 140),
    v_now,
    case when v_status = 'preparing' then v_now else null end,
    v_ready_at
  )
  returning id into v_order_id;

  insert into public.order_items (
    order_id, menu_item_id, name_snapshot, name_snapshot_ms,
    unit_price_snapshot, qty, modifiers, line_total
  )
  select
    v_order_id,
    (l ->> 'menu_item_id')::uuid,
    l ->> 'name_en',
    l ->> 'name_ms',
    (l ->> 'unit_price')::numeric,
    (l ->> 'qty')::int,
    coalesce(l -> 'modifiers', '[]'::jsonb),
    (l ->> 'line_total')::numeric
  from jsonb_array_elements(v_lines) as l;

  -- 10. Deduct stock and leave an audit row per ingredient. The rows are already
  --     locked by step 8, so this is a plain update.
  for v_stock in
    select (e.key)::uuid as ingredient_id, (e.value)::numeric as need
    from jsonb_each_text(v_needs) as e
    order by (e.key)::uuid
  loop
    update public.ingredients i
       set stock_qty = round(i.stock_qty - v_stock.need, 3)
     where i.id = v_stock.ingredient_id;

    if found then
      insert into public.inventory_movements (ingredient_id, delta, reason, order_id, created_by)
      values (v_stock.ingredient_id, -v_stock.need, 'order', v_order_id, v_uid);
    end if;
  end loop;

  return jsonb_build_object(
    'order_id', v_order_id,
    'display_number', v_display,
    'estimated_ready_at', v_ready_at
  );
end $fn$;

-- -----------------------------------------------------------------------------
-- set_order_status (admin)
-- -----------------------------------------------------------------------------
create or replace function public.set_order_status(
  p_order_id uuid,
  p_status public.order_status
)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order public.orders%rowtype;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- A cancelled order is final. Reopening it would need the stock back and there
  -- is no such thing as a second collection.
  if v_order.status = 'cancelled' and p_status <> 'cancelled' then
    raise exception 'INVALID_TRANSITION';
  end if;

  if v_order.status = p_status then
    return;
  end if;

  if p_status = 'cancelled' then
    perform public._restore_order_stock(p_order_id);
  end if;

  -- COALESCE keeps the first time an order reached a state.
  update public.orders o set
    status = p_status,
    preparing_at = case when p_status = 'preparing'
                        then coalesce(o.preparing_at, clock_timestamp())
                        else o.preparing_at end,
    ready_at = case when p_status = 'ready'
                    then coalesce(o.ready_at, clock_timestamp())
                    else o.ready_at end,
    collected_at = case when p_status = 'collected'
                        then coalesce(o.collected_at, clock_timestamp())
                        else o.collected_at end,
    cancelled_at = case when p_status = 'cancelled'
                        then coalesce(o.cancelled_at, clock_timestamp())
                        else o.cancelled_at end,
    cancel_reason = case when p_status = 'cancelled'
                         then coalesce(o.cancel_reason, 'Cancelled by host')
                         else o.cancel_reason end
  where o.id = p_order_id;
end $fn$;

-- -----------------------------------------------------------------------------
-- cancel_order (admin)
-- -----------------------------------------------------------------------------
create or replace function public.cancel_order(p_order_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order  public.orders%rowtype;
  v_reason text;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_order.status = 'cancelled' then
    return;
  end if;

  perform public._restore_order_stock(p_order_id);

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');

  update public.orders o set
    status = 'cancelled',
    cancelled_at = coalesce(o.cancelled_at, clock_timestamp()),
    cancel_reason = coalesce(v_reason, o.cancel_reason, 'Cancelled by host')
  where o.id = p_order_id;
end $fn$;

-- -----------------------------------------------------------------------------
-- customer_confirm_collected
-- -----------------------------------------------------------------------------
create or replace function public.customer_confirm_collected(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order public.orders%rowtype;
  v_uid   uuid := auth.uid();
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_uid is null or v_order.customer_id is distinct from v_uid then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Only from the counter, only once the host said it is ready.
  if v_order.status <> 'ready' then
    raise exception 'INVALID_TRANSITION';
  end if;

  update public.orders o set
    collected_confirmed_by_customer = true,
    status = 'collected',
    collected_at = coalesce(o.collected_at, clock_timestamp())
  where o.id = p_order_id;
end $fn$;

-- -----------------------------------------------------------------------------
-- customer_cancel_order
-- -----------------------------------------------------------------------------
create or replace function public.customer_cancel_order(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_order public.orders%rowtype;
  v_uid   uuid := auth.uid();
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  if v_uid is null or v_order.customer_id is distinct from v_uid then
    raise exception 'NOT_ALLOWED';
  end if;

  -- Once the host starts making it, cancelling is a conversation, not a button.
  if v_order.status <> 'placed' then
    raise exception 'INVALID_TRANSITION';
  end if;

  perform public._restore_order_stock(p_order_id);

  update public.orders o set
    status = 'cancelled',
    cancelled_at = coalesce(o.cancelled_at, clock_timestamp()),
    cancel_reason = coalesce(o.cancel_reason, 'Cancelled by guest')
  where o.id = p_order_id;
end $fn$;

-- -----------------------------------------------------------------------------
-- ring_again (admin)
-- -----------------------------------------------------------------------------
create or replace function public.ring_again(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_id uuid;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  update public.orders o
     set ring_count = o.ring_count + 1,
         last_rung_at = clock_timestamp()
   where o.id = p_order_id
   returning o.id into v_id;

  if v_id is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
end $fn$;

-- -----------------------------------------------------------------------------
-- get_public_status
-- -----------------------------------------------------------------------------
-- Everything the guest home screen needs in one round trip. Keys match the
-- PublicStatus interface exactly.
create or replace function public.get_public_status()
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event            public.events%rowtype;
  v_uid              uuid := auth.uid();
  v_now              timestamptz := clock_timestamp();
  v_queue            int := 0;
  v_hour             int := 0;
  v_my_cups          int := 0;
  v_person_remaining int;
  v_cooldown         int := 0;
  v_last             timestamptz;
  v_avg_prep         int := 120;
begin
  select * into v_event
  from public.events e
  where e.is_active
  order by e.created_at
  limit 1;

  -- No active event yet. Answer with a closed shop instead of an error so the
  -- guest page can render something sensible during setup.
  if not found then
    return jsonb_build_object(
      'event_name', '', 'host_name', '', 'orders_open', false, 'banner', null,
      'queue_cups', 0, 'cups_this_hour', 0, 'max_cups_per_hour', null,
      'wait_minutes', 0, 'free_mode', false, 'max_cups_per_order', 2,
      'require_name', true, 'currency', 'BND',
      'person_remaining', null, 'cooldown_remaining_seconds', 0
    );
  end if;

  select coalesce(sum(oi.qty), 0) into v_queue
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.event_id = v_event.id
    and o.status in ('placed', 'preparing', 'ready');

  select coalesce(sum(oi.qty), 0) into v_hour
  from public.orders o
  join public.order_items oi on oi.order_id = o.id
  where o.event_id = v_event.id
    and o.status <> 'cancelled'
    and o.placed_at >= v_now - interval '1 hour';

  -- Average prep time of the live menu drives the rough wait estimate.
  select coalesce(round(avg(mi.prep_seconds)), 120)::int into v_avg_prep
  from public.menu_items mi
  where mi.is_active;

  if v_uid is not null then
    select coalesce(sum(oi.qty), 0) into v_my_cups
    from public.orders o
    join public.order_items oi on oi.order_id = o.id
    where o.event_id = v_event.id
      and o.customer_id = v_uid
      and o.status <> 'cancelled';

    if coalesce(v_event.per_person_cooldown_seconds, 0) > 0 then
      select max(o.placed_at) into v_last
      from public.orders o
      where o.event_id = v_event.id
        and o.customer_id = v_uid
        and o.status <> 'cancelled';

      if v_last is not null then
        v_cooldown := (greatest(0, ceil(extract(epoch from (
          v_last + make_interval(secs => v_event.per_person_cooldown_seconds) - v_now
        )))))::int;
      end if;
    end if;
  end if;

  v_person_remaining := case
    when v_event.max_cups_per_person is null then null
    else greatest(0, v_event.max_cups_per_person - v_my_cups)
  end;

  return jsonb_build_object(
    'event_name', v_event.event_name,
    'host_name', v_event.host_name,
    'orders_open', v_event.orders_open,
    'banner', v_event.message_banner,
    'queue_cups', v_queue,
    'cups_this_hour', v_hour,
    'max_cups_per_hour', v_event.max_cups_per_hour,
    'wait_minutes', (greatest(0, ceil((v_queue * v_avg_prep)::numeric / 60)))::int,
    'free_mode', v_event.free_mode,
    'max_cups_per_order', v_event.max_cups_per_order,
    'require_name', v_event.require_name,
    'currency', v_event.currency,
    'person_remaining', v_person_remaining,
    'cooldown_remaining_seconds', v_cooldown
  );
end $fn$;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.admins              enable row level security;
alter table public.events              enable row level security;
alter table public.categories          enable row level security;
alter table public.ingredients         enable row level security;
alter table public.menu_items          enable row level security;
alter table public.modifier_groups     enable row level security;
alter table public.modifier_options    enable row level security;
alter table public.recipes             enable row level security;
alter table public.orders              enable row level security;
alter table public.order_items         enable row level security;
alter table public.inventory_movements enable row level security;
alter table public.event_counters      enable row level security;

-- admins: admin only. The first row is inserted with the service role or from
-- the SQL editor, there is no self service promotion path.
drop policy if exists admins_admin_all on public.admins;
create policy admins_admin_all on public.admins
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- events: admin only directly. Guests read public_event (view) instead, which
-- is exactly why the view exists.
drop policy if exists events_admin_all on public.events;
create policy events_admin_all on public.events
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Menu reference data: public read, admin write.
drop policy if exists categories_public_read on public.categories;
create policy categories_public_read on public.categories
  for select to anon, authenticated
  using (true);

drop policy if exists categories_admin_write on public.categories;
create policy categories_admin_write on public.categories
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists menu_items_public_read on public.menu_items;
create policy menu_items_public_read on public.menu_items
  for select to anon, authenticated
  using (true);

drop policy if exists menu_items_admin_write on public.menu_items;
create policy menu_items_admin_write on public.menu_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists modifier_groups_public_read on public.modifier_groups;
create policy modifier_groups_public_read on public.modifier_groups
  for select to anon, authenticated
  using (true);

drop policy if exists modifier_groups_admin_write on public.modifier_groups;
create policy modifier_groups_admin_write on public.modifier_groups
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists modifier_options_public_read on public.modifier_options;
create policy modifier_options_public_read on public.modifier_options
  for select to anon, authenticated
  using (true);

drop policy if exists modifier_options_admin_write on public.modifier_options;
create policy modifier_options_admin_write on public.modifier_options
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Stock and cost data: admin only. Guests see menu_availability instead.
drop policy if exists ingredients_admin_all on public.ingredients;
create policy ingredients_admin_all on public.ingredients
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists recipes_admin_all on public.recipes;
create policy recipes_admin_all on public.recipes
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists inventory_movements_admin_all on public.inventory_movements;
create policy inventory_movements_admin_all on public.inventory_movements
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists event_counters_admin_all on public.event_counters;
create policy event_counters_admin_all on public.event_counters
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Orders: a guest sees only their own rows, an admin sees everything. There is
-- deliberately no INSERT, UPDATE or DELETE policy: writes go through the RPCs,
-- which are SECURITY DEFINER and check auth.uid() themselves.
drop policy if exists orders_read_own_or_admin on public.orders;
create policy orders_read_own_or_admin on public.orders
  for select to anon, authenticated
  using (customer_id = auth.uid() or public.is_admin());

-- Order lines follow their order. The subquery is itself filtered by the orders
-- policy above, so a guest only ever matches their own order ids.
drop policy if exists order_items_read_own_or_admin on public.order_items;
create policy order_items_read_own_or_admin on public.order_items
  for select to anon, authenticated
  using (
    exists (
      select 1
      from public.orders o
      where o.id = order_id
        and (o.customer_id = auth.uid() or public.is_admin())
    )
  );

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Supabase adds default privileges that hand anon and authenticated ALL on every
-- new table in public. Start from nothing here, so this file (and not a platform
-- default) decides which verbs a client has. RLS still decides which rows.
revoke all on
  public.admins, public.events, public.categories, public.ingredients,
  public.menu_items, public.modifier_groups, public.modifier_options,
  public.recipes, public.orders, public.order_items,
  public.inventory_movements, public.event_counters
  from anon, authenticated;

revoke all on
  public.menu_availability, public.menu_items_full, public.public_event
  from anon, authenticated;

-- Public read: the guest menu and the safe event slice.
grant select on public.categories, public.menu_items, public.modifier_groups,
  public.modifier_options, public.menu_availability, public.menu_items_full,
  public.public_event
  to anon, authenticated;

-- Admin data. SELECT is granted so PostgREST and Realtime can authorise a
-- request at all; the admin only RLS policies above are what make a guest see
-- zero rows. Writes are granted for the admin screens and gated the same way.
grant select on public.events, public.ingredients, public.recipes,
  public.inventory_movements, public.event_counters, public.admins
  to authenticated;

grant insert, update, delete on public.events, public.categories,
  public.menu_items, public.modifier_groups, public.modifier_options,
  public.ingredients, public.recipes, public.inventory_movements,
  public.event_counters
  to authenticated;

-- Orders are read through RLS (own rows, or everything for an admin) and written
-- only through the RPCs below. No client gets INSERT, UPDATE or DELETE at all,
-- so a stray PostgREST call cannot change a status or a line item.
grant select on public.orders, public.order_items to anon, authenticated;

revoke all on function public.place_order(jsonb) from public;
grant execute on function public.place_order(jsonb) to anon, authenticated;

revoke all on function public.get_public_status() from public;
grant execute on function public.get_public_status() to anon, authenticated;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated;

revoke all on function public.active_event_id() from public;
grant execute on function public.active_event_id() to anon, authenticated;

revoke all on function public.customer_confirm_collected(uuid) from public;
grant execute on function public.customer_confirm_collected(uuid) to anon, authenticated;

revoke all on function public.customer_cancel_order(uuid) from public;
grant execute on function public.customer_cancel_order(uuid) to anon, authenticated;

revoke all on function public.set_order_status(uuid, public.order_status) from public;
grant execute on function public.set_order_status(uuid, public.order_status) to authenticated;

revoke all on function public.cancel_order(uuid, text) from public;
grant execute on function public.cancel_order(uuid, text) to authenticated;

revoke all on function public.ring_again(uuid) from public;
grant execute on function public.ring_again(uuid) to authenticated;

-- Revoking from PUBLIC also dropped service_role, which is what admin scripts and
-- Edge Functions use. Give the RPC surface back to it when the role exists.
do $service$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function
      public.place_order(jsonb),
      public.get_public_status(),
      public.is_admin(),
      public.active_event_id(),
      public.customer_confirm_collected(uuid),
      public.customer_cancel_order(uuid),
      public.set_order_status(uuid, public.order_status),
      public.cancel_order(uuid, text),
      public.ring_again(uuid)
      to service_role;
  end if;
end $service$;

-- -----------------------------------------------------------------------------
-- Storage: menu images
-- -----------------------------------------------------------------------------
-- Public read so <img src> works with the plain public URL, admin only writes.
-- Guarded because storage.objects is a Supabase managed table.
do $storage$
begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets (id, name, public)
    values ('menu-images', 'menu-images', true)
    on conflict (id) do update set public = true;
  else
    raise notice 'storage.buckets is missing, skipping the menu-images bucket';
  end if;

  if to_regclass('storage.objects') is not null then
    execute 'drop policy if exists menu_images_public_read on storage.objects';
    execute $p$
      create policy menu_images_public_read on storage.objects
        for select to anon, authenticated
        using (bucket_id = 'menu-images')
    $p$;

    execute 'drop policy if exists menu_images_admin_write on storage.objects';
    execute $p$
      create policy menu_images_admin_write on storage.objects
        for all to authenticated
        using (bucket_id = 'menu-images' and public.is_admin())
        with check (bucket_id = 'menu-images' and public.is_admin())
    $p$;
  else
    raise notice 'storage.objects is missing, skipping the menu-images policies';
  end if;
exception
  when insufficient_privilege then
    raise notice 'storage setup skipped: %', sqlerrm;
end $storage$;

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
-- supabaseBackend.subscribe() listens to postgres_changes on these tables, which
-- only fires when they are part of the realtime publication. Guarded so the file
-- also runs on a plain Postgres without the publication.
do $realtime$
declare
  v_table text;
begin
  if not exists (select 1 from pg_publication p where p.pubname = 'supabase_realtime') then
    raise notice 'supabase_realtime publication is missing, skipping realtime setup';
  else
    foreach v_table in array array['orders', 'order_items', 'menu_items', 'events', 'ingredients']
    loop
      if not exists (
        select 1 from pg_publication_tables pt
        where pt.pubname = 'supabase_realtime'
          and pt.schemaname = 'public'
          and pt.tablename = v_table
      ) then
        execute format('alter publication supabase_realtime add table public.%I', v_table);
      end if;
    end loop;
  end if;
exception
  when insufficient_privilege then
    raise notice 'realtime setup skipped: %', sqlerrm;
end $realtime$;
