begin;

create table public.vocab_dataset_catalog (
  dataset_id uuid primary key
    references public.vocab_datasets(id) on delete cascade,
  display_name text not null check (
    char_length(trim(display_name)) between 1 and 200
  ),
  catalog_group text not null check (
    catalog_group in ('middle', 'high', 'high_mock', 'csat')
  ),
  material_kind text not null check (
    material_kind in (
      'textbook',
      'wordbook',
      'exam_collection',
      'exam_prep',
      'supplement'
    )
  ),
  grade_code text check (
    grade_code is null or char_length(trim(grade_code)) between 1 and 24
  ),
  publisher text check (
    publisher is null or char_length(trim(publisher)) between 1 and 120
  ),
  series_title text check (
    series_title is null or char_length(trim(series_title)) between 1 and 160
  ),
  academic_year smallint check (
    academic_year is null or academic_year between 2000 and 2100
  ),
  curriculum_revision text check (
    curriculum_revision is null
    or char_length(trim(curriculum_revision)) between 1 and 40
  ),
  edition_label text check (
    edition_label is null
    or char_length(trim(edition_label)) between 1 and 80
  ),
  is_assignable boolean not null default true,
  sort_index integer not null default 0 check (sort_index >= 0),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vocab_dataset_catalog_selection_idx
  on public.vocab_dataset_catalog (
    is_assignable,
    catalog_group,
    sort_index,
    display_name
  );

create trigger vocab_dataset_catalog_set_updated_at
before update on public.vocab_dataset_catalog
for each row execute function private.set_updated_at();

create table public.vocab_unit_catalog (
  unit_id uuid primary key
    references public.vocab_units(id) on delete cascade,
  catalog_group text not null check (
    catalog_group in ('middle', 'high', 'high_mock', 'csat')
  ),
  unit_type text not null check (
    unit_type in (
      'day',
      'lesson',
      'chapter',
      'exam_scope',
      'passage_type',
      'supplement'
    )
  ),
  display_name text not null check (
    char_length(trim(display_name)) between 1 and 200
  ),
  unit_code text check (
    unit_code is null or char_length(trim(unit_code)) between 1 and 120
  ),
  academic_year smallint check (
    academic_year is null or academic_year between 2000 and 2100
  ),
  exam_month smallint check (
    exam_month is null or exam_month between 1 and 12
  ),
  agency text check (
    agency is null or char_length(trim(agency)) between 1 and 120
  ),
  item_range text check (
    item_range is null or char_length(trim(item_range)) between 1 and 80
  ),
  sort_index integer not null default 0 check (sort_index >= 0),
  metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(metadata) = 'object'
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index vocab_unit_catalog_selection_idx
  on public.vocab_unit_catalog (
    catalog_group,
    sort_index,
    display_name
  );

create trigger vocab_unit_catalog_set_updated_at
before update on public.vocab_unit_catalog
for each row execute function private.set_updated_at();

alter table public.vocab_dataset_catalog enable row level security;
alter table public.vocab_unit_catalog enable row level security;

revoke all on table public.vocab_dataset_catalog
  from public, anon, authenticated;
revoke all on table public.vocab_unit_catalog
  from public, anon, authenticated;
grant select on table public.vocab_dataset_catalog to authenticated;
grant select on table public.vocab_unit_catalog to authenticated;
grant select, insert, update, delete
  on table public.vocab_dataset_catalog to service_role;
grant select, insert, update, delete
  on table public.vocab_unit_catalog to service_role;

create policy "active admins view vocabulary dataset catalog"
on public.vocab_dataset_catalog
for select
to authenticated
using ((select private.is_active_admin()));

create policy "active admins view vocabulary unit catalog"
on public.vocab_unit_catalog
for select
to authenticated
using ((select private.is_active_admin()));

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
select
  dataset.id,
  '고3 모의고사 · 장문독해',
  'high_mock',
  'exam_collection',
  'g12',
  'exam4you',
  '장문독해',
  2025,
  dataset.dataset_key = 'g12-long-reading-2025-exam-ready-v1',
  case dataset.dataset_key
    when 'g12-long-reading-2025-exam-ready-v1' then 10
    when 'g12-long-reading-2025-exam-scope-v1' then 20
    else 30
  end,
  jsonb_build_object(
    'backfill', '2025_long_reading',
    'reviewRequired',
      dataset.dataset_key <> 'g12-long-reading-2025-exam-ready-v1'
  )
from public.vocab_datasets as dataset
where dataset.dataset_key in (
  'g12-long-reading-2025-exam-ready-v1',
  'g12-long-reading-2025-exam-scope-v1',
  'g12-long-reading-2025-approved-pilot-4-v2'
)
on conflict (dataset_id) do nothing;

insert into public.vocab_unit_catalog (
  unit_id,
  catalog_group,
  unit_type,
  display_name,
  unit_code,
  academic_year,
  exam_month,
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
  case
    when unit.unit_label ~ '^2025-[0-9]{2} '
      then concat(
        cast(substring(unit.unit_label from 6 for 2) as integer),
        '월 ',
        substring(unit.unit_label from 9)
      )
    else unit.unit_label
  end,
  concat(dataset.dataset_key, ':', unit.sort_index),
  2025,
  case
    when unit.unit_label ~ '^2025-[0-9]{2} '
      then cast(substring(unit.unit_label from 6 for 2) as smallint)
    else null
  end,
  substring(unit.unit_label from '([0-9]+-[0-9]+)$'),
  unit.sort_index,
  jsonb_build_object('sourceUnitLabel', unit.unit_label)
from public.vocab_units as unit
join public.vocab_datasets as dataset
  on dataset.id = unit.dataset_id
where dataset.dataset_key in (
  'g12-long-reading-2025-exam-ready-v1',
  'g12-long-reading-2025-exam-scope-v1',
  'g12-long-reading-2025-approved-pilot-4-v2'
)
on conflict (unit_id) do nothing;

commit;
