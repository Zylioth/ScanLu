-- -----------------------------------------------------------------------------
-- 0002: admin actions that a table update cannot express
--
-- Run once in the Supabase SQL editor, after 0001_init.sql. Safe to run twice.
--
--   clear_today(text) -> delete today's orders, restore their stock, and
--                        restart today's display numbers
-- -----------------------------------------------------------------------------

create or replace function public.clear_today(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_event_id uuid;
  v_day      date := public.event_day(now());
  v_deleted  integer := 0;
  r          record;
begin
  if not public.is_admin() then
    raise exception 'NOT_ALLOWED';
  end if;

  -- The caller sends the word, so a mis-wired button cannot wipe a day's orders
  -- by accident.
  if p_confirm is distinct from 'CLEAR' then
    raise exception 'CONFIRM_REQUIRED';
  end if;

  select e.id into v_event_id
  from public.events e
  where e.is_active
  order by e.created_at desc
  limit 1;

  if v_event_id is null then
    return jsonb_build_object('deleted', 0);
  end if;

  -- Put the stock back before the rows disappear. The helper is idempotent, so
  -- orders that were already cancelled keep their single restore.
  for r in
    select o.id
    from public.orders o
    where o.event_id = v_event_id
      and public.event_day(o.placed_at) = v_day
  loop
    perform public._restore_order_stock(r.id);
    v_deleted := v_deleted + 1;
  end loop;

  delete from public.orders o
  where o.event_id = v_event_id
    and public.event_day(o.placed_at) = v_day;

  -- Drop today's counter, so the next order is A-001 again. Order numbers are
  -- protected by a unique index, which is why the rows have to go with it.
  delete from public.event_counters c
  where c.event_id = v_event_id and c.day = v_day;

  return jsonb_build_object('deleted', v_deleted);
end $fn$;

comment on function public.clear_today(text) is
  $c$Admin only. Deletes the active event's orders for today, restores their stock and restarts today's display numbers.$c$;

revoke all on function public.clear_today(text) from public;
grant execute on function public.clear_today(text) to authenticated;
