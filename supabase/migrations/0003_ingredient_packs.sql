-- -----------------------------------------------------------------------------
-- 0003: ingredients counted in packs
--
-- Run once in the Supabase SQL editor, after 0001 and 0002. Safe to run twice.
--
-- Stock is still stored in the base unit (g, ml, pcs), because recipes do maths
-- in millilitres and grams. These two columns just let the screen speak packs:
-- a one litre box of milk, a 250 g bag of beans, a 100 piece sleeve of straws.
--
-- Both are nullable on purpose. An ingredient with no pack size keeps working
-- exactly as before and is counted in its base unit.
-- -----------------------------------------------------------------------------

alter table public.ingredients
  add column if not exists pack_size numeric(12,3)
    check (pack_size is null or pack_size > 0),
  add column if not exists pack_name text;

comment on column public.ingredients.pack_size is
  $c$How much one pack holds, in the ingredient's own unit. Null means this ingredient is counted in its base unit.$c$;

comment on column public.ingredients.pack_name is
  $c$What one pack is called: box, bag, pack, sleeve. Only meaningful when pack_size is set.$c$;
