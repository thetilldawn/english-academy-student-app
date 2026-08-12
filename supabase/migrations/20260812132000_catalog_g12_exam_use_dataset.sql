begin;

create function private.catalog_g12_exam_use_dataset_v1(
  p_dataset_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.vocab_datasets as dataset
    where dataset.id = p_dataset_id
      and dataset.dataset_key = 'g12-long-reading-2025-exam-scope-v1'
  ) then
    return;
  end if;

  insert into public.vocab_dataset_catalog (
    dataset_id,
    display_name,
    catalog_group,
    material_kind,
    grade_code,
    publisher,
    series_title,
    academic_year,
    is_assignable,
    sort_index,
    metadata
  )
  values (
    p_dataset_id,
    '고3 모의고사 장문독해',
    'high_mock',
    'exam_collection',
    'g12',
    'exam4you',
    '장문독해',
    2025,
    true,
    20,
    jsonb_build_object(
      'source', 'g12-long-reading-2025-exam-scope-v1',
      'reviewRequired', false
    )
  )
  on conflict (dataset_id) do update set
    display_name = excluded.display_name,
    catalog_group = excluded.catalog_group,
    material_kind = excluded.material_kind,
    grade_code = excluded.grade_code,
    publisher = excluded.publisher,
    series_title = excluded.series_title,
    academic_year = excluded.academic_year,
    is_assignable = excluded.is_assignable,
    sort_index = excluded.sort_index,
    metadata = excluded.metadata;

  insert into public.vocab_unit_catalog (
    unit_id,
    catalog_group,
    unit_type,
    display_name,
    unit_code,
    academic_year,
    exam_month,
    agency,
    item_range,
    sort_index,
    metadata
  )
  select
    unit.id,
    case
      when unit.unit_label like '%대수능%' then 'csat'
      else 'high_mock'
    end,
    'exam_scope',
    concat(
      '[2025] ',
      cast(substring(unit.unit_label from 6 for 2) as integer),
      '월 ',
      case
        when unit.unit_label like '%대수능%' then '수능'
        else '모의고사'
      end,
      ' 장문 <',
      replace(substring(unit.unit_label from '([0-9]+-[0-9]+)$'), '-', ','),
      '>'
    ),
    concat('g12-long-reading-2025-exam-scope-v1:', unit.sort_index),
    2025,
    cast(substring(unit.unit_label from 6 for 2) as smallint),
    substring(unit.unit_label from '^2025-[0-9]{2} (.+) [0-9]+-[0-9]+$'),
    substring(unit.unit_label from '([0-9]+-[0-9]+)$'),
    unit.sort_index,
    jsonb_build_object('sourceUnitLabel', unit.unit_label)
  from public.vocab_units as unit
  where unit.dataset_id = p_dataset_id
    and unit.unit_label ~ '^2025-[0-9]{2} .+ [0-9]+-[0-9]+$'
  on conflict (unit_id) do update set
    catalog_group = excluded.catalog_group,
    unit_type = excluded.unit_type,
    display_name = excluded.display_name,
    unit_code = excluded.unit_code,
    academic_year = excluded.academic_year,
    exam_month = excluded.exam_month,
    agency = excluded.agency,
    item_range = excluded.item_range,
    sort_index = excluded.sort_index,
    metadata = excluded.metadata;
end;
$$;

create function private.catalog_g12_exam_use_release_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'active' then
    perform private.catalog_g12_exam_use_dataset_v1(new.dataset_id);
  end if;
  return new;
end;
$$;

create trigger app_exam_use_release_catalog_g12_v1
after insert or update on word_index.app_exam_use_release
for each row execute function private.catalog_g12_exam_use_release_trigger_v1();

do $$
declare
  release_row record;
begin
  for release_row in
    select distinct release.dataset_id
    from word_index.app_exam_use_release as release
    where release.dataset_key = 'g12-long-reading-2025-exam-scope-v1'
      and release.status = 'active'
  loop
    perform private.catalog_g12_exam_use_dataset_v1(release_row.dataset_id);
  end loop;
end;
$$;

revoke all on function private.catalog_g12_exam_use_dataset_v1(uuid)
  from public, anon, authenticated;
revoke all on function private.catalog_g12_exam_use_release_trigger_v1()
  from public, anon, authenticated;

commit;
