begin;

create function private.normalize_g12_unit_catalog_display_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  range_start integer;
  range_end integer;
  item_list text;
begin
  if new.unit_code like 'g12-long-reading-2025-exam-scope-v1:%'
    and new.item_range ~ '^[0-9]+-[0-9]+$'
  then
    range_start := split_part(new.item_range, '-', 1)::integer;
    range_end := split_part(new.item_range, '-', 2)::integer;
    select string_agg(item_number::text, ',' order by item_number)
    into item_list
    from generate_series(range_start, range_end) as item_number;
    new.display_name := regexp_replace(
      new.display_name,
      '<[^>]+>$',
      concat('<', item_list, '>')
    );
  end if;
  return new;
end;
$$;

create trigger vocab_unit_catalog_normalize_g12_display_v1
before insert or update on public.vocab_unit_catalog
for each row execute function private.normalize_g12_unit_catalog_display_v1();

update public.vocab_unit_catalog as catalog
set display_name = catalog.display_name
where catalog.unit_code like 'g12-long-reading-2025-exam-scope-v1:%';

revoke all on function private.normalize_g12_unit_catalog_display_v1()
  from public, anon, authenticated;

commit;
