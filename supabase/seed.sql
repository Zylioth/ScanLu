-- =============================================================================
-- MyPOS demo seed
-- =============================================================================
-- Reproduces src/lib/seed.ts on a real project: the same event settings, the
-- same three categories, nine ingredients, four modifier groups with their
-- options, and eleven menu items with their recipes and modifier groups.
--
-- Ids: the demo uses readable slugs ('item-latte', 'ing-beans'). The schema uses
-- uuid primary keys (the RPC payloads and every foreign key are uuid typed), so
-- each slug is mapped to a stable uuid with seed_demo_id(). The mapping is a pure
-- function of the slug, so re-running this file always targets the same rows.
-- Every slug from src/lib/seed.ts is used verbatim as the argument, in the same
-- place, which keeps the file diffable against the TypeScript source:
--
--   src/lib/seed.ts id    seed_demo_id() argument
--   event-1               'event-1'
--   cat-coffee            'cat-coffee'
--   ing-beans             'ing-beans'
--   grp-milk              'grp-milk'
--   opt-milk-oat          'opt-milk-oat'
--   item-latte            'item-latte'
--
-- To see a mapping, run: select public.seed_demo_id('item-latte');
--
-- Re-runnable. Reference data is updated in place. Live operational state (stock
-- levels, sold out flags, uploaded images) is deliberately left alone on a
-- re-run so seeding twice does not wipe the event you are running.
--
-- Admin: admins are rows in public.admins keyed to auth.users. Create the auth
-- user in the dashboard, then insert its id:
--   insert into public.admins (user_id) values ('<auth user uuid>')
--   on conflict (user_id) do nothing;
-- =============================================================================

begin;

-- Deterministic slug to uuid. Immutable and dependency free, so the seed can be
-- replayed on any project and still hit the same rows.
create or replace function public.seed_demo_id(p_slug text)
returns uuid
language sql
immutable
set search_path = public
as $fn$
  select (
    substr(h, 1, 8) || '-' ||
    substr(h, 9, 4) || '-' ||
    substr(h, 13, 4) || '-' ||
    substr(h, 17, 4) || '-' ||
    substr(h, 21, 12)
  )::uuid
  from (select md5('mypos:' || p_slug) as h) s;
$fn$;

comment on function public.seed_demo_id(text) is
  'Maps a src/lib/seed.ts slug to a stable uuid so the demo rows keep the same identity across deploys.';

-- -----------------------------------------------------------------------------
-- Event (values from seedSettings, active so the guest app has something to read)
-- -----------------------------------------------------------------------------
insert into public.events (
  id, event_name, host_name, is_active, orders_open, currency,
  free_mode, max_cups_per_order, max_cups_per_person, max_active_orders_per_person,
  max_cups_per_hour, max_cups_per_day, max_queue_cups, per_person_cooldown_seconds,
  auto_accept, default_payment_method, message_banner, require_name
) values (
  public.seed_demo_id('event-1'), 'ScanLu', 'Your name here', true, true, 'BND',
  false, 2, 4, 2,
  20, 150, 16, 120,
  -- The demo starts with auto accept off so the whole lifecycle is visible on the
  -- board (New, Making, Ready). Flip it in Admin > Settings.
  false, 'cash', null, true
)
on conflict (id) do update set
  event_name = excluded.event_name,
  host_name = excluded.host_name,
  is_active = excluded.is_active,
  orders_open = excluded.orders_open,
  currency = excluded.currency,
  free_mode = excluded.free_mode,
  max_cups_per_order = excluded.max_cups_per_order,
  max_cups_per_person = excluded.max_cups_per_person,
  max_active_orders_per_person = excluded.max_active_orders_per_person,
  max_cups_per_hour = excluded.max_cups_per_hour,
  max_cups_per_day = excluded.max_cups_per_day,
  max_queue_cups = excluded.max_queue_cups,
  per_person_cooldown_seconds = excluded.per_person_cooldown_seconds,
  auto_accept = excluded.auto_accept,
  default_payment_method = excluded.default_payment_method,
  message_banner = excluded.message_banner,
  require_name = excluded.require_name;

-- -----------------------------------------------------------------------------
-- Categories
-- -----------------------------------------------------------------------------
insert into public.categories (id, name_en, name_ms, sort_order, is_active) values
  (public.seed_demo_id('cat-coffee'), 'Coffee', 'Kopi', 1, true),
  (public.seed_demo_id('cat-iced'), 'Iced', 'Ais', 2, true),
  (public.seed_demo_id('cat-local'), 'Local favourites', 'Kegemaran tempatan', 3, true)
on conflict (id) do update set
  name_en = excluded.name_en,
  name_ms = excluded.name_ms,
  sort_order = excluded.sort_order,
  is_active = excluded.is_active;

-- -----------------------------------------------------------------------------
-- Ingredients
-- -----------------------------------------------------------------------------
-- stock_qty is only set on first insert. A re-run keeps the live count so
-- re-seeding mid event does not refill the fridge on paper.
insert into public.ingredients (
  id, name, unit, stock_qty, full_level, low_stock_threshold, is_active
) values
  (public.seed_demo_id('ing-beans'), 'Espresso beans', 'g', 1000, 1000, 200, true),
  (public.seed_demo_id('ing-milk'), 'Fresh milk', 'ml', 4000, 6000, 800, true),
  (public.seed_demo_id('ing-oat'), 'Oat milk', 'ml', 1000, 2000, 300, true),
  (public.seed_demo_id('ing-cond'), 'Condensed milk', 'ml', 800, 1000, 200, true),
  (public.seed_demo_id('ing-tea'), 'Tea leaves', 'g', 250, 500, 50, true),
  (public.seed_demo_id('ing-milo'), 'Milo powder', 'g', 500, 800, 100, true),
  (public.seed_demo_id('ing-rose'), 'Rose syrup', 'ml', 500, 700, 100, true),
  (public.seed_demo_id('ing-ice'), 'Ice', 'pcs', 300, 400, 60, true),
  (public.seed_demo_id('ing-cup'), 'Cups', 'pcs', 200, 300, 40, true)
on conflict (id) do update set
  name = excluded.name,
  unit = excluded.unit,
  full_level = excluded.full_level,
  low_stock_threshold = excluded.low_stock_threshold,
  is_active = excluded.is_active;

-- -----------------------------------------------------------------------------
-- Modifier groups
-- -----------------------------------------------------------------------------
insert into public.modifier_groups (id, name_en, name_ms, min_select, max_select) values
  (public.seed_demo_id('grp-ice'), 'Ice', 'Ais', 1, 1),
  (public.seed_demo_id('grp-sugar'), 'Sugar', 'Gula', 1, 1),
  (public.seed_demo_id('grp-milk'), 'Milk', 'Susu', 1, 1),
  (public.seed_demo_id('grp-shot'), 'Extra shot', 'Shot tambahan', 0, 1)
on conflict (id) do update set
  name_en = excluded.name_en,
  name_ms = excluded.name_ms,
  min_select = excluded.min_select,
  max_select = excluded.max_select;

-- -----------------------------------------------------------------------------
-- Modifier options
-- -----------------------------------------------------------------------------
-- Only two options carry stock: oat milk and the extra shot. The rest are free
-- text choices with no ingredient attached.
insert into public.modifier_options (
  id, group_id, name_en, name_ms, price_delta, ingredient_id, ingredient_qty
) values
  (public.seed_demo_id('opt-ice-normal'), public.seed_demo_id('grp-ice'),
   'Normal ice', 'Ais biasa', 0, null, null),
  (public.seed_demo_id('opt-ice-less'), public.seed_demo_id('grp-ice'),
   'Less ice', 'Ais kurang', 0, null, null),
  (public.seed_demo_id('opt-ice-none'), public.seed_demo_id('grp-ice'),
   'No ice', 'Tanpa ais', 0, null, null),

  (public.seed_demo_id('opt-sugar-normal'), public.seed_demo_id('grp-sugar'),
   'Normal sugar', 'Gula biasa', 0, null, null),
  (public.seed_demo_id('opt-sugar-less'), public.seed_demo_id('grp-sugar'),
   'Less sweet', 'Kurang manis', 0, null, null),
  (public.seed_demo_id('opt-sugar-none'), public.seed_demo_id('grp-sugar'),
   'No sugar', 'Tanpa gula', 0, null, null),

  (public.seed_demo_id('opt-milk-fresh'), public.seed_demo_id('grp-milk'),
   'Fresh milk', 'Susu segar', 0, null, null),
  (public.seed_demo_id('opt-milk-oat'), public.seed_demo_id('grp-milk'),
   'Oat milk', 'Susu oat', 1, public.seed_demo_id('ing-oat'), 180),
  (public.seed_demo_id('opt-milk-evap'), public.seed_demo_id('grp-milk'),
   'Evaporated', 'Susu sejat', 0, null, null),

  (public.seed_demo_id('opt-shot-extra'), public.seed_demo_id('grp-shot'),
   'Add a shot', 'Tambah shot', 1, public.seed_demo_id('ing-beans'), 8)
on conflict (id) do update set
  group_id = excluded.group_id,
  name_en = excluded.name_en,
  name_ms = excluded.name_ms,
  price_delta = excluded.price_delta,
  ingredient_id = excluded.ingredient_id,
  ingredient_qty = excluded.ingredient_qty;

-- -----------------------------------------------------------------------------
-- Menu items
-- -----------------------------------------------------------------------------
-- image_url, image_path and image_updated_at are not in the update list on
-- purpose: uploads belong to the live event. is_sold_out_manual is also left
-- alone so a manual sell out survives a re-seed.
insert into public.menu_items (
  id, category_id, name_en, name_ms, description_en, description_ms,
  price, image_url, is_active, is_sold_out_manual, sort_order, hourly_cap,
  prep_seconds, modifier_group_ids
) values
  (public.seed_demo_id('item-espresso'), public.seed_demo_id('cat-coffee'),
   'Espresso', 'Espreso', 'One short, honest shot.', 'Satu shot pendek.',
   2, null, true, false, 1, null, 60, '{}'::uuid[]),

  (public.seed_demo_id('item-americano'), public.seed_demo_id('cat-coffee'),
   'Americano', 'Amerikano', 'Espresso, hot water, nothing to hide.', 'Espreso dengan air panas.',
   2.5, null, true, false, 2, null, 90,
   array[public.seed_demo_id('grp-sugar')]::uuid[]),

  (public.seed_demo_id('item-latte'), public.seed_demo_id('cat-coffee'),
   'Latte', 'Latte', 'Silky milk, one shot, easy to drink.', 'Susu lembut dengan satu shot.',
   3.5, null, true, false, 3, null, 150,
   array[
     public.seed_demo_id('grp-milk'),
     public.seed_demo_id('grp-sugar'),
     public.seed_demo_id('grp-shot')
   ]::uuid[]),

  (public.seed_demo_id('item-cappuccino'), public.seed_demo_id('cat-coffee'),
   'Cappuccino', 'Kapucino', 'Thicker foam than the latte.', 'Busa lebih tebal daripada latte.',
   3.5, null, true, false, 4, null, 150,
   array[
     public.seed_demo_id('grp-milk'),
     public.seed_demo_id('grp-sugar'),
     public.seed_demo_id('grp-shot')
   ]::uuid[]),

  (public.seed_demo_id('item-iced-latte'), public.seed_demo_id('cat-iced'),
   'Iced latte', 'Latte ais', 'The one everyone orders. Cold milk, one shot, ice.',
   'Pilihan ramai. Susu sejuk, satu shot, ais.',
   4, null, true, false, 1, null, 180,
   array[
     public.seed_demo_id('grp-ice'),
     public.seed_demo_id('grp-milk'),
     public.seed_demo_id('grp-sugar'),
     public.seed_demo_id('grp-shot')
   ]::uuid[]),

  (public.seed_demo_id('item-iced-americano'), public.seed_demo_id('cat-iced'),
   'Iced americano', 'Amerikano ais', 'Sharp and cold. Good in the afternoon heat.',
   'Tajam dan sejuk. Sedap waktu panas.',
   3.5, null, true, false, 2, null, 120,
   array[
     public.seed_demo_id('grp-ice'),
     public.seed_demo_id('grp-sugar')
   ]::uuid[]),

  (public.seed_demo_id('item-teh-tarik'), public.seed_demo_id('cat-local'),
   'Teh tarik', 'Teh tarik', 'Pulled until it froths. Sweet, hot.', 'Ditarik sampai berbuih. Manis, panas.',
   2.5, null, true, false, 1, null, 120,
   array[public.seed_demo_id('grp-sugar')]::uuid[]),

  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('cat-local'),
   'Teh tarik ais', 'Teh tarik ais', 'Same pull, over ice.', 'Tarik yang sama, dengan ais.',
   3, null, true, false, 2, null, 150,
   array[public.seed_demo_id('grp-ice')]::uuid[]),

  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('cat-local'),
   'Milo ais', 'Milo ais', 'For the people who do not drink coffee.', 'Untuk yang tak minum kopi.',
   3, null, true, false, 3, null, 150,
   array[public.seed_demo_id('grp-ice')]::uuid[]),

  (public.seed_demo_id('item-sirap-bandung'), public.seed_demo_id('cat-local'),
   'Sirap bandung', 'Sirap bandung', 'Rose syrup and milk. Pink, cold, festive.',
   'Sirap ros dengan susu. Merah jambu, sejuk.',
   3, null, true, false, 4, null, 120,
   array[public.seed_demo_id('grp-ice')]::uuid[]),

  (public.seed_demo_id('item-milo-panas'), public.seed_demo_id('cat-local'),
   'Milo panas', 'Milo panas', 'Hot Milo. The default answer to everything.',
   'Milo panas. Jawapan kepada semua.',
   2.5, null, true, false, 5, null, 120, '{}'::uuid[])
on conflict (id) do update set
  category_id = excluded.category_id,
  name_en = excluded.name_en,
  name_ms = excluded.name_ms,
  description_en = excluded.description_en,
  description_ms = excluded.description_ms,
  price = excluded.price,
  is_active = excluded.is_active,
  sort_order = excluded.sort_order,
  hourly_cap = excluded.hourly_cap,
  prep_seconds = excluded.prep_seconds,
  modifier_group_ids = excluded.modifier_group_ids;

-- -----------------------------------------------------------------------------
-- Recipes
-- -----------------------------------------------------------------------------
insert into public.recipes (menu_item_id, ingredient_id, qty) values
  -- Espresso: beans 18g, cup 1
  (public.seed_demo_id('item-espresso'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-espresso'), public.seed_demo_id('ing-cup'), 1),

  -- Americano
  (public.seed_demo_id('item-americano'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-americano'), public.seed_demo_id('ing-cup'), 1),

  -- Latte
  (public.seed_demo_id('item-latte'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-latte'), public.seed_demo_id('ing-milk'), 200),
  (public.seed_demo_id('item-latte'), public.seed_demo_id('ing-cup'), 1),

  -- Cappuccino
  (public.seed_demo_id('item-cappuccino'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-cappuccino'), public.seed_demo_id('ing-milk'), 140),
  (public.seed_demo_id('item-cappuccino'), public.seed_demo_id('ing-cup'), 1),

  -- Iced latte
  (public.seed_demo_id('item-iced-latte'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-iced-latte'), public.seed_demo_id('ing-milk'), 180),
  (public.seed_demo_id('item-iced-latte'), public.seed_demo_id('ing-ice'), 5),
  (public.seed_demo_id('item-iced-latte'), public.seed_demo_id('ing-cup'), 1),

  -- Iced americano
  (public.seed_demo_id('item-iced-americano'), public.seed_demo_id('ing-beans'), 18),
  (public.seed_demo_id('item-iced-americano'), public.seed_demo_id('ing-ice'), 6),
  (public.seed_demo_id('item-iced-americano'), public.seed_demo_id('ing-cup'), 1),

  -- Teh tarik
  (public.seed_demo_id('item-teh-tarik'), public.seed_demo_id('ing-tea'), 8),
  (public.seed_demo_id('item-teh-tarik'), public.seed_demo_id('ing-cond'), 30),
  (public.seed_demo_id('item-teh-tarik'), public.seed_demo_id('ing-milk'), 60),
  (public.seed_demo_id('item-teh-tarik'), public.seed_demo_id('ing-cup'), 1),

  -- Teh tarik ais
  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('ing-tea'), 8),
  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('ing-cond'), 30),
  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('ing-milk'), 60),
  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('ing-ice'), 5),
  (public.seed_demo_id('item-teh-tarik-ais'), public.seed_demo_id('ing-cup'), 1),

  -- Milo ais
  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('ing-milo'), 30),
  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('ing-cond'), 20),
  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('ing-milk'), 40),
  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('ing-ice'), 6),
  (public.seed_demo_id('item-milo-ais'), public.seed_demo_id('ing-cup'), 1),

  -- Sirap bandung
  (public.seed_demo_id('item-sirap-bandung'), public.seed_demo_id('ing-rose'), 40),
  (public.seed_demo_id('item-sirap-bandung'), public.seed_demo_id('ing-milk'), 80),
  (public.seed_demo_id('item-sirap-bandung'), public.seed_demo_id('ing-ice'), 6),
  (public.seed_demo_id('item-sirap-bandung'), public.seed_demo_id('ing-cup'), 1),

  -- Milo panas
  (public.seed_demo_id('item-milo-panas'), public.seed_demo_id('ing-milo'), 30),
  (public.seed_demo_id('item-milo-panas'), public.seed_demo_id('ing-milk'), 60),
  (public.seed_demo_id('item-milo-panas'), public.seed_demo_id('ing-cup'), 1)
on conflict (menu_item_id, ingredient_id) do update set
  qty = excluded.qty;

commit;
