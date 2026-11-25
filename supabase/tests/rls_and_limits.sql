-- =============================================================================
-- MyPOS: RLS and limit tests
-- =============================================================================
-- Plain SQL, meant to be run against a project that already has
-- supabase/migrations/0001_init.sql applied:
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/rls_and_limits.sql
--
-- It also runs in the Supabase SQL editor, because it avoids psql meta-commands.
--
-- Everything runs inside one transaction that ends with ROLLBACK, so the
-- fixtures never survive the run. Run it as the migration owner (postgres on
-- Supabase), which owns the tables and can therefore set up fixtures and switch
-- into the anon and authenticated roles.
--
-- What this proves:
--   1. a guest can read their own order and cannot read another guest order
--   2. a guest cannot UPDATE order status, directly or through the admin RPC
--   3. anon cannot read ingredients or events, but can read the public menu
--   4. the last unit of stock cannot be sold twice, and stock never goes negative
--
-- On 4 and concurrency: place_order takes pg_advisory_xact_lock(hashtext(event))
-- before it reads stock, and then locks the ingredient rows FOR UPDATE. Two
-- simultaneous calls for the same event are therefore serialised: the second
-- one cannot read the old stock, because it waits for the first one to commit
-- and then sees the reduced value. A single psql session cannot open two
-- concurrent transactions, so the serial form of the same invariant is asserted
-- here: the first order takes the last unit, the identical second order from a
-- different guest fails with OUT_OF_STOCK, and stock lands exactly on zero.
-- =============================================================================


begin;

do $pre$ begin
  if to_regprocedure('public.place_order(jsonb)') is null then
    raise exception 'Apply supabase/migrations/0001_init.sql before running this test.';
  end if;
end $pre$;

-- -----------------------------------------------------------------------------
-- Assertion helpers
-- -----------------------------------------------------------------------------
create schema if not exists tests;

-- Fails the script when the condition is not literally true. Written as "is not
-- true" so a NULL result fails too instead of silently passing.
create or replace function tests.assert_true(p_condition boolean, p_message text)
returns void
language plpgsql
as $fn$
begin
  if p_condition is not true then
    raise exception 'ASSERT FAILED: %', p_message;
  end if;
end $fn$;

-- Runs p_sql and fails unless it raises an error whose message contains
-- p_expected. The inner block makes the error a savepoint, so a caught failure
-- does not poison the surrounding transaction.
create or replace function tests.assert_raises(p_sql text, p_expected text, p_message text)
returns void
language plpgsql
as $fn$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_expected in sqlerrm) > 0 then
      return;
    end if;
    raise exception 'ASSERT FAILED (%): expected an error mentioning "%", got "%"',
      p_message, p_expected, sqlerrm;
  end;
  raise exception 'ASSERT FAILED (%): expected an error mentioning "%", but the statement succeeded',
    p_message, p_expected;
end $fn$;

-- The tests run as anon and authenticated, so those roles need to reach the
-- helpers. Functions are executable by PUBLIC by default, the schema is not.
grant usage on schema tests to anon, authenticated;

-- auth.uid() exists on Supabase. This stub only matters on a plain Postgres that
-- has an auth schema stub, and it is rolled back with everything else.
do $stub$
begin
  if to_regprocedure('auth.uid()') is null then
    create schema if not exists auth;
    execute $fn$
      create function auth.uid() returns uuid
      language sql
      stable
      as $body$
        select ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub')::uuid
      $body$;
    $fn$;
  end if;
exception
  when insufficient_privilege then
    raise exception 'This script needs auth.uid(). Run it on a Supabase project.';
end $stub$;

-- SET ROLE authenticated is how the policies get exercised. Fails with a clear
-- message instead of a confusing "permission denied to set role".
do $roles$ begin
  if not pg_has_role(current_user, 'authenticated', 'member')
     or not pg_has_role(current_user, 'anon', 'member') then
    raise exception 'Run this script as a role that can SET ROLE to anon and authenticated (postgres on Supabase).';
  end if;
end $roles$;

-- -----------------------------------------------------------------------------
-- Fixtures (table owner, so RLS does not apply to these statements)
-- -----------------------------------------------------------------------------
-- Park the seeded event, then own event for this test only.
update public.events set is_active = false;

insert into public.events (
  id, event_name, host_name, is_active, orders_open, currency,
  free_mode, max_cups_per_order, max_cups_per_person, max_active_orders_per_person,
  max_cups_per_hour, max_cups_per_day, max_queue_cups, per_person_cooldown_seconds,
  auto_accept, default_payment_method, require_name
) values (
  '11111111-1111-4111-8111-111111111111', 'RLS test event', 'Test host', true, true, 'BND',
  false, 4, 20, 5,
  80, 400, 40, 0,
  true, 'cash', true
);

insert into public.categories (id, name_en, name_ms, sort_order, is_active) values
  ('44444444-4444-4444-8444-444444444444', 'Test', 'Ujian', 1, true);

-- Two ingredients: one with plenty of stock, one with exactly one unit, so the
-- oversell test has an obvious "last cup".
insert into public.ingredients (id, name, unit, stock_qty, full_level, low_stock_threshold) values
  ('33333333-3333-4333-8333-333333333301', 'Test cups', 'pcs', 100, 100, 10),
  ('33333333-3333-4333-8333-333333333302', 'Test beans', 'g', 1, 100, 1);

insert into public.menu_items (
  id, category_id, name_en, name_ms, price, prep_seconds, sort_order
) values
  ('22222222-2222-4222-8222-222222222201',
   '44444444-4444-4444-8444-444444444444', 'Test coffee', 'Kopi ujian', 2, 60, 1),
  ('22222222-2222-4222-8222-222222222202',
   '44444444-4444-4444-8444-444444444444', 'Test last cup', 'Cawan akhir', 2, 60, 2);

insert into public.recipes (menu_item_id, ingredient_id, qty) values
  ('22222222-2222-4222-8222-222222222201', '33333333-3333-4333-8333-333333333301', 1),
  ('22222222-2222-4222-8222-222222222202', '33333333-3333-4333-8333-333333333302', 1);

-- -----------------------------------------------------------------------------
-- 1. A guest cannot read another guest's order
-- -----------------------------------------------------------------------------
set local role authenticated;

-- Alice signs in (anonymous auth on a real project, a JWT sub here).
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}',
  true
);

do $place$
begin
  perform set_config('tests.alice_order', (public.place_order(
    '{"customer_name":"Alice","items":[{"menu_item_id":"22222222-2222-4222-8222-222222222201","qty":1,"modifier_option_ids":[]}]}'::jsonb
  ) ->> 'order_id'), true);
end $place$;

select tests.assert_true(
  (select count(*) from public.orders
   where id = current_setting('tests.alice_order')::uuid) = 1,
  'a guest can read the order they just placed');

select tests.assert_true(
  (select count(*) from public.order_items
   where order_id = current_setting('tests.alice_order')::uuid) = 1,
  'a guest can read the lines of their own order');

select tests.assert_true(public.is_admin() is false, 'a guest is not an admin');

-- Bob is a different guest with a different sub. Same UUID, no rows.
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}',
  true
);

select tests.assert_true(
  (select count(*) from public.orders
   where id = current_setting('tests.alice_order')::uuid) = 0,
  'a guest cannot read another guest order even with the exact uuid');

select tests.assert_true(
  (select count(*) from public.order_items
   where order_id = current_setting('tests.alice_order')::uuid) = 0,
  'a guest cannot read another guest order lines');

-- -----------------------------------------------------------------------------
-- 2. A guest cannot UPDATE order status
-- -----------------------------------------------------------------------------
-- Back to Alice, who owns the order: even the owner cannot write the status
-- column directly, because orders has a SELECT policy only and no write grant.
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}',
  true
);

select tests.assert_raises(
  format('update public.orders set status = %L where id = %L',
         'ready', current_setting('tests.alice_order')),
  'permission denied',
  'a guest cannot update order status');

select tests.assert_raises(
  format('update public.orders set status = %L where id = %L',
         'cancelled', current_setting('tests.alice_order')),
  'permission denied',
  'a guest cannot cancel an order by writing the table');

-- The RPC is reachable but refuses: is_admin() is false for a guest.
select tests.assert_raises(
  format('select public.set_order_status(%L::uuid, %L::public.order_status)',
         current_setting('tests.alice_order'), 'ready'),
  'NOT_ALLOWED',
  'a guest cannot move an order through the status RPC');

select tests.assert_raises(
  'insert into public.orders (event_id, order_number, display_number) values '
  '(''11111111-1111-4111-8111-111111111111'', 999, ''Z-999'')',
  'permission denied',
  'a guest cannot insert an order directly, RPCs only');

-- -----------------------------------------------------------------------------
-- 3. anon cannot read ingredients
-- -----------------------------------------------------------------------------
-- First the normal guest session (anonymous sign-in gives role authenticated,
-- not anon). The table grant exists so PostgREST and Realtime can authorise the
-- request, but the admin only policy returns zero rows.
select tests.assert_true(
  (select count(*) from public.ingredients) = 0,
  'a signed in guest reads zero ingredient rows');

select tests.assert_true(
  (select count(*) from public.events) = 0,
  'a signed in guest reads zero event rows');

-- Now the pre sign in role: no grant at all, so the read is refused outright.
-- Back to the session role first: SET ROLE checks membership against the current
-- user, and authenticated is not a member of anon.
reset role;

set local role anon;

select set_config('request.jwt.claims', '{"role":"anon"}', true);

select tests.assert_raises(
  'select count(*) from public.ingredients',
  'permission denied',
  'anon cannot read ingredients (no grant at all)');

select tests.assert_raises(
  'select count(*) from public.events',
  'permission denied',
  'anon cannot read the events table directly');

-- Positive controls: the public menu still works for anon.
select tests.assert_true(
  (select count(*) from public.menu_items) >= 2,
  'anon can read the public menu');

select tests.assert_true(
  (select count(*) from public.menu_items_full) >= 2,
  'anon can read menu_items_full (menu plus recipes)');

select tests.assert_true(
  (select count(*) from public.menu_availability) >= 2,
  'anon can read availability without touching the stock tables');

select tests.assert_true(
  (select count(*) from public.public_event) = 1,
  'anon can read the safe slice of the active event');

select tests.assert_true(
  (select available_units from public.menu_availability
   where menu_item_id = '22222222-2222-4222-8222-222222222202') = 1,
  'availability reports the single remaining unit for the last cup item');

-- -----------------------------------------------------------------------------
-- 4. The last unit cannot be sold twice
-- -----------------------------------------------------------------------------
-- Stock is set to exactly one unit, then two different guests order the same
-- item. See the header for why the concurrent version of this is safe: the
-- advisory lock serialises the calls, so the loser always reads zero stock.
reset role;

update public.ingredients
   set stock_qty = 1
 where id = '33333333-3333-4333-8333-333333333302';

set local role authenticated;

-- Alice takes the last unit.
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1","role":"authenticated"}',
  true
);

do $place$
begin
  perform set_config('tests.last_cup_order', (public.place_order(
    '{"customer_name":"Alice","items":[{"menu_item_id":"22222222-2222-4222-8222-222222222202","qty":1,"modifier_option_ids":[]}]}'::jsonb
  ) ->> 'order_id'), true);
end $place$;

-- Bob orders the same thing. There is nothing left.
select set_config(
  'request.jwt.claims',
  '{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2","role":"authenticated"}',
  true
);

select tests.assert_raises(
  format('select public.place_order(%L::jsonb)',
    '{"customer_name":"Bob","items":[{"menu_item_id":"22222222-2222-4222-8222-222222222202","qty":1,"modifier_option_ids":[]}]}'),
  'OUT_OF_STOCK',
  'the last unit cannot be sold twice');

reset role;

select tests.assert_true(
  (select stock_qty from public.ingredients
   where id = '33333333-3333-4333-8333-333333333302') = 0,
  'stock stopped at zero, the rejected order deducted nothing');

select tests.assert_true(
  (select count(*) from public.inventory_movements
   where order_id = current_setting('tests.last_cup_order')::uuid and reason = 'order') = 1,
  'the winning order wrote exactly one deduction movement');

select tests.assert_true(
  (select delta from public.inventory_movements
   where order_id = current_setting('tests.last_cup_order')::uuid and reason = 'order') = -1,
  'the deduction movement is minus one unit');

select tests.assert_true(
  (select count(*) from public.orders
   where event_id = '11111111-1111-4111-8111-111111111111') = 2,
  'the rejected order left no row behind');

-- Numbering sanity: the two accepted orders are A-001 and A-002, and the failed
-- attempt did not consume a number.
select tests.assert_true(
  (select display_number from public.orders
   where id = current_setting('tests.alice_order')::uuid) ~ '^[A-Z]-[0-9]{3}$',
  'display numbers look like A-001');

select tests.assert_true(
  (select count(distinct order_number) from public.orders
   where event_id = '11111111-1111-4111-8111-111111111111') = 2,
  'each accepted order got its own number');

-- Nothing above should persist.
rollback;

select 'rls_and_limits.sql: all assertions passed' as result;
