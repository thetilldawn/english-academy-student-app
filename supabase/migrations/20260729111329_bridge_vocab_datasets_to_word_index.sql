alter table public.vocab_entries
  add constraint vocab_entries_id_dataset_unique
  unique (id, dataset_id);

create index vocab_entries_unit_dataset_idx
  on public.vocab_entries(unit_id, dataset_id);

alter table public.vocab_entries
  add constraint vocab_entries_unit_dataset_fkey
  foreign key (unit_id, dataset_id)
  references public.vocab_units(id, dataset_id)
  on delete restrict
  not valid;

alter table public.vocab_entries
  validate constraint vocab_entries_unit_dataset_fkey;

alter table word_index.occurrence
  add constraint occurrence_id_source_lexeme_unique
  unique (occurrence_id, source_id, lexeme_id);

create table word_index.dataset_source (
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  source_id uuid not null
    references word_index.source(source_id) on delete restrict,
  build_id uuid not null
    references word_index.index_build(build_id) on delete restrict,
  source_role text not null,
  dataset_source_sha256 text not null check (
    dataset_source_sha256 ~ '^[0-9A-F]{64}$'
  ),
  linked_at_utc timestamptz not null default now(),
  primary key (dataset_id, source_id)
);

create table word_index.vocab_entry_link (
  vocab_entry_id bigint primary key,
  dataset_id uuid not null,
  entry_row_sha256 text not null check (
    entry_row_sha256 ~ '^[0-9A-F]{64}$'
  ),
  source_id uuid not null
    references word_index.source(source_id) on delete restrict,
  lexeme_id uuid
    references word_index.lexeme(lexeme_id) on delete restrict,
  occurrence_id uuid,
  mapping_status text not null check (
    mapping_status in (
      'exact_headword_unreviewed',
      'approved',
      'ambiguous',
      'unresolved',
      'rejected'
    )
  ),
  mapping_method text not null,
  mapping_rule_version text not null,
  canonical_content_hash text check (
    canonical_content_hash is null
    or canonical_content_hash ~ '^[0-9A-Fa-f]{64}$'
  ),
  candidate_count integer not null default 0 check (candidate_count >= 0),
  evidence jsonb not null default '{}'::jsonb check (
    jsonb_typeof(evidence) = 'object'
  ),
  mapped_at_utc timestamptz not null,
  reviewed_at_utc timestamptz,
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  foreign key (dataset_id, source_id)
    references word_index.dataset_source(dataset_id, source_id)
    on delete restrict,
  foreign key (occurrence_id, source_id, lexeme_id)
    references word_index.occurrence(
      occurrence_id,
      source_id,
      lexeme_id
    )
    on delete restrict,
  constraint vocab_entry_link_mapping_state_check check (
    (
      mapping_status in ('exact_headword_unreviewed', 'approved')
      and lexeme_id is not null
      and occurrence_id is not null
      and canonical_content_hash is not null
    )
    or (
      mapping_status in ('ambiguous', 'unresolved', 'rejected')
      and lexeme_id is null
      and occurrence_id is null
      and canonical_content_hash is null
    )
  ),
  constraint vocab_entry_link_ambiguous_candidates_check check (
    mapping_status <> 'ambiguous' or candidate_count >= 2
  ),
  constraint vocab_entry_link_review_state_check check (
    (
      mapping_status = 'approved'
      and reviewed_at_utc is not null
    )
    or mapping_status <> 'approved'
  ),
  constraint vocab_entry_link_review_time_check check (
    reviewed_at_utc is null or reviewed_at_utc >= mapped_at_utc
  )
);

create table word_index.vocab_entry_mapping_candidate (
  vocab_entry_id bigint not null
    references word_index.vocab_entry_link(vocab_entry_id)
    on delete cascade,
  candidate_lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete restrict,
  candidate_rank integer not null check (candidate_rank > 0),
  candidate_type text not null,
  reason_code text not null,
  score numeric(7,6) check (score is null or score between 0 and 1),
  primary key (vocab_entry_id, candidate_lexeme_id),
  unique (vocab_entry_id, candidate_rank)
);

create index word_index_dataset_source_source_idx
  on word_index.dataset_source(source_id);
create index word_index_dataset_source_build_idx
  on word_index.dataset_source(build_id);
create index word_index_vocab_entry_link_dataset_status_idx
  on word_index.vocab_entry_link(dataset_id, mapping_status);
create index word_index_vocab_entry_link_source_idx
  on word_index.vocab_entry_link(source_id);
create index word_index_vocab_entry_link_lexeme_idx
  on word_index.vocab_entry_link(lexeme_id)
  where lexeme_id is not null;
create index word_index_vocab_entry_link_occurrence_idx
  on word_index.vocab_entry_link(occurrence_id)
  where occurrence_id is not null;
create index word_index_vocab_entry_link_occurrence_source_lexeme_idx
  on word_index.vocab_entry_link(
    occurrence_id,
    source_id,
    lexeme_id
  )
  where occurrence_id is not null;
create unique index word_index_vocab_entry_link_occurrence_unique
  on word_index.vocab_entry_link(occurrence_id)
  where occurrence_id is not null;
create index word_index_vocab_entry_candidate_lexeme_idx
  on word_index.vocab_entry_mapping_candidate(candidate_lexeme_id);

alter table word_index.dataset_source enable row level security;
alter table word_index.vocab_entry_link enable row level security;
alter table word_index.vocab_entry_mapping_candidate
  enable row level security;
revoke all on table word_index.dataset_source
  from public, anon, authenticated;
revoke all on table word_index.vocab_entry_link
  from public, anon, authenticated;
revoke all on table word_index.vocab_entry_mapping_candidate
  from public, anon, authenticated;

create table public.vocab_dataset_capabilities (
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  quiz_mode text not null check (
    quiz_mode in (
      'book_meaning_en_to_ko',
      'book_meaning_ko_to_en',
      'canonical_definition_to_headword',
      'canonical_example_to_headword',
      'school_context_to_headword',
      'mock_exam_context_to_headword'
    )
  ),
  status text not null check (
    status in ('ready', 'limited', 'blocked')
  ),
  eligible_entry_count integer not null check (
    eligible_entry_count >= 0
  ),
  excluded_entry_count integer not null check (
    excluded_entry_count >= 0
  ),
  reason_code text not null check (char_length(trim(reason_code)) > 0),
  dataset_source_sha256 text not null check (
    dataset_source_sha256 ~ '^[0-9A-F]{64}$'
  ),
  canonical_snapshot_sha256 text check (
    canonical_snapshot_sha256 is null
    or canonical_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  rule_version text not null check (char_length(trim(rule_version)) > 0),
  evaluated_at_utc timestamptz not null,
  details jsonb not null default '{}'::jsonb check (
    jsonb_typeof(details) = 'object'
  ),
  primary key (dataset_id, quiz_mode),
  constraint vocab_dataset_capability_count_check check (
    (
      status = 'ready'
      and eligible_entry_count > 0
      and excluded_entry_count = 0
    )
    or (
      status = 'limited'
      and eligible_entry_count > 0
      and excluded_entry_count > 0
    )
    or (
      status = 'blocked'
      and eligible_entry_count = 0
      and excluded_entry_count > 0
    )
  )
);

create table public.vocab_entry_quiz_eligibility (
  vocab_entry_id bigint not null,
  dataset_id uuid not null,
  quiz_mode text not null check (
    quiz_mode in (
      'book_meaning_en_to_ko',
      'book_meaning_ko_to_en'
    )
  ),
  status text not null check (
    status in ('eligible', 'review_required', 'excluded')
  ),
  reason_codes text[] not null default '{}',
  input_content_hash text not null check (
    input_content_hash ~ '^[0-9A-F]{64}$'
  ),
  canonical_lexeme_id uuid
    references word_index.lexeme(lexeme_id) on delete restrict,
  canonical_content_hash text check (
    canonical_content_hash is null
    or canonical_content_hash ~ '^[0-9A-Fa-f]{64}$'
  ),
  content_review_id uuid
    references word_index.review(review_id) on delete restrict,
  rule_version text not null check (char_length(trim(rule_version)) > 0),
  evaluated_at_utc timestamptz not null,
  primary key (vocab_entry_id, quiz_mode),
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  constraint vocab_entry_quiz_eligibility_reason_check check (
    (
      status = 'eligible'
      and cardinality(reason_codes) = 0
    )
    or (
      status <> 'eligible'
      and cardinality(reason_codes) > 0
    )
  )
);

create index vocab_dataset_capabilities_status_idx
  on public.vocab_dataset_capabilities(dataset_id, status, quiz_mode);
create index vocab_entry_quiz_eligibility_lookup_idx
  on public.vocab_entry_quiz_eligibility(
    dataset_id,
    quiz_mode,
    status,
    vocab_entry_id
  );
create index vocab_entry_quiz_eligibility_lexeme_idx
  on public.vocab_entry_quiz_eligibility(canonical_lexeme_id)
  where canonical_lexeme_id is not null;
create index vocab_entry_quiz_eligibility_review_idx
  on public.vocab_entry_quiz_eligibility(content_review_id)
  where content_review_id is not null;

alter table public.vocab_dataset_capabilities enable row level security;
alter table public.vocab_entry_quiz_eligibility enable row level security;

create policy "active admins can read vocabulary capabilities"
on public.vocab_dataset_capabilities
for select
to authenticated
using ((select private.is_active_admin()));

create policy "active admins can read vocabulary entry eligibility"
on public.vocab_entry_quiz_eligibility
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.vocab_dataset_capabilities
  from public, anon, authenticated;
revoke all on table public.vocab_entry_quiz_eligibility
  from public, anon, authenticated;
grant select on table public.vocab_dataset_capabilities
  to authenticated;
grant select on table public.vocab_entry_quiz_eligibility
  to authenticated;
grant all on table public.vocab_dataset_capabilities
  to service_role;
grant all on table public.vocab_entry_quiz_eligibility
  to service_role;

create table word_index.vocab_link_import_run (
  dataset_id uuid primary key
    references public.vocab_datasets(id) on delete restrict,
  source_id uuid not null
    references word_index.source(source_id) on delete restrict,
  build_id uuid not null
    references word_index.index_build(build_id) on delete restrict,
  package_snapshot_sha256 text not null check (
    package_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  source_payload_sha256 text not null check (
    source_payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  capabilities_payload_sha256 text check (
    capabilities_payload_sha256 is null
    or capabilities_payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  status text not null check (
    status in ('loading', 'complete', 'failed')
  ),
  expected_counts jsonb not null check (
    jsonb_typeof(expected_counts) = 'object'
  ),
  started_at_utc timestamptz not null default now(),
  completed_at_utc timestamptz,
  failure_detail text,
  constraint vocab_link_import_run_state_check check (
    (
      status = 'loading'
      and completed_at_utc is null
      and failure_detail is null
      and capabilities_payload_sha256 is null
    )
    or (
      status = 'complete'
      and completed_at_utc is not null
      and failure_detail is null
      and capabilities_payload_sha256 is not null
    )
    or (
      status = 'failed'
      and completed_at_utc is not null
      and failure_detail is not null
      and capabilities_payload_sha256 is null
    )
  )
);

create table word_index.vocab_link_import_batch (
  dataset_id uuid not null
    references word_index.vocab_link_import_run(dataset_id)
    on delete cascade,
  table_name text not null,
  batch_no integer not null check (batch_no > 0),
  payload_sha256 text not null check (
    payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  received_rows integer not null check (received_rows > 0),
  inserted_rows integer not null check (
    inserted_rows = received_rows and inserted_rows > 0
  ),
  applied_at_utc timestamptz not null default now(),
  primary key (dataset_id, table_name, batch_no)
);

alter table word_index.vocab_link_import_run enable row level security;
alter table word_index.vocab_link_import_batch enable row level security;
create index word_index_vocab_link_import_run_source_idx
  on word_index.vocab_link_import_run(source_id);
create index word_index_vocab_link_import_run_build_idx
  on word_index.vocab_link_import_run(build_id);
revoke all on table word_index.vocab_link_import_run
  from public, anon, authenticated;
revoke all on table word_index.vocab_link_import_batch
  from public, anon, authenticated;

create function private.begin_vocab_link_import(
  p_dataset_key text,
  p_build_id uuid,
  p_package_snapshot_sha256 text,
  p_source jsonb,
  p_expected_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_dataset public.vocab_datasets%rowtype;
  source_row word_index.source%rowtype;
  existing_source word_index.source%rowtype;
  existing_run word_index.vocab_link_import_run%rowtype;
  source_match_count integer;
  source_payload_sha256 text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if nullif(trim(p_dataset_key), '') is null
    or p_build_id is null
    or p_package_snapshot_sha256 !~ '^[0-9A-F]{64}$'
    or p_source is null
    or jsonb_typeof(p_source) <> 'object'
    or p_expected_counts is null
    or jsonb_typeof(p_expected_counts) <> 'object'
  then
    raise exception 'invalid_vocab_link_import_metadata'
      using errcode = '22023';
  end if;

  if not (
    p_expected_counts ?& array[
      'occurrence',
      'vocab_entry_link',
      'vocab_entry_mapping_candidate',
      'vocab_entry_quiz_eligibility',
      'vocab_dataset_capabilities'
    ]
  )
    or exists (
      select 1
      from jsonb_each(p_expected_counts) as expected(key, value)
      where expected.key not in (
        'occurrence',
        'vocab_entry_link',
        'vocab_entry_mapping_candidate',
        'vocab_entry_quiz_eligibility',
        'vocab_dataset_capabilities'
      )
        or jsonb_typeof(expected.value) <> 'number'
        or expected.value::text !~ '^[0-9]+$'
    )
  then
    raise exception 'invalid_vocab_link_expected_counts'
      using errcode = '22023';
  end if;

  select *
  into selected_dataset
  from public.vocab_datasets
  where dataset_key = p_dataset_key
    and is_active;
  if not found then
    raise exception 'active_vocab_dataset_not_found'
      using errcode = 'P0002';
  end if;

  if upper(selected_dataset.source_sha256)
      <> upper(p_source ->> 'source_sha256')
  then
    raise exception 'vocab_dataset_source_sha_mismatch'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from word_index.import_run
    where build_id = p_build_id
      and status = 'complete'
  ) then
    raise exception 'canonical_word_index_not_complete'
      using errcode = '55000';
  end if;

  select *
  into source_row
  from jsonb_populate_record(null::word_index.source, p_source);

  if source_row.source_id is null
    or nullif(trim(source_row.source_key), '') is null
    or nullif(trim(source_row.source_type), '') is null
    or nullif(trim(source_row.title), '') is null
    or nullif(trim(source_row.status), '') is null
    or source_row.source_sha256 is null
    or upper(source_row.source_sha256) is distinct from
      upper(selected_dataset.source_sha256)
  then
    raise exception 'invalid_vocab_link_source'
      using errcode = '22023';
  end if;

  source_payload_sha256 := upper(encode(
    extensions.digest(
      convert_to(to_jsonb(source_row)::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ));

  select *
  into existing_run
  from word_index.vocab_link_import_run
  where dataset_id = selected_dataset.id;
  if found then
    if existing_run.build_id <> p_build_id
      or existing_run.package_snapshot_sha256
        <> p_package_snapshot_sha256
      or existing_run.expected_counts <> p_expected_counts
      or existing_run.source_payload_sha256
        <> source_payload_sha256
    then
      raise exception 'vocab_link_import_metadata_conflict'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'datasetId', existing_run.dataset_id,
      'sourceId', existing_run.source_id,
      'status', existing_run.status,
      'idempotent', true
    );
  end if;

  select count(*)
  into source_match_count
  from word_index.source
  where source_id = source_row.source_id
    or source_key = source_row.source_key;

  if source_match_count > 1 then
    raise exception 'vocab_link_source_identity_conflict'
      using errcode = '23505';
  elsif source_match_count = 1 then
    select *
    into existing_source
    from word_index.source
    where source_id = source_row.source_id
      or source_key = source_row.source_key;
    if to_jsonb(existing_source) <> to_jsonb(source_row) then
      raise exception 'vocab_link_source_content_conflict'
        using errcode = '23505';
    end if;
  else
    insert into word_index.source (
      source_id,
      source_key,
      source_type,
      title,
      publisher,
      edition,
      curriculum_revision,
      volume,
      school_name,
      grade_code,
      academic_year,
      semester,
      source_relative_path,
      source_sha256,
      status
    )
    values (
      source_row.source_id,
      source_row.source_key,
      source_row.source_type,
      source_row.title,
      source_row.publisher,
      source_row.edition,
      source_row.curriculum_revision,
      source_row.volume,
      source_row.school_name,
      source_row.grade_code,
      source_row.academic_year,
      source_row.semester,
      source_row.source_relative_path,
      source_row.source_sha256,
      source_row.status
    );
  end if;

  insert into word_index.dataset_source (
    dataset_id,
    source_id,
    build_id,
    source_role,
    dataset_source_sha256
  )
  values (
    selected_dataset.id,
    source_row.source_id,
    p_build_id,
    'wordbook_revision',
    upper(selected_dataset.source_sha256)
  );

  insert into word_index.vocab_link_import_run (
    dataset_id,
    source_id,
    build_id,
    package_snapshot_sha256,
    source_payload_sha256,
    status,
    expected_counts
  )
  values (
    selected_dataset.id,
    source_row.source_id,
    p_build_id,
    p_package_snapshot_sha256,
    source_payload_sha256,
    'loading',
    p_expected_counts
  );

  return jsonb_build_object(
    'datasetId', selected_dataset.id,
    'sourceId', source_row.source_id,
    'status', 'loading',
    'idempotent', false
  );
end;
$$;

create function private.import_vocab_link_batch(
  p_dataset_id uuid,
  p_table_name text,
  p_batch_no integer,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  received_count integer;
  inserted_count integer;
  existing_batch word_index.vocab_link_import_batch%rowtype;
  run_row word_index.vocab_link_import_run%rowtype;
  target_table text;
  calculated_payload_sha256 text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  target_table := case p_table_name
    when 'occurrence' then 'word_index.occurrence'
    when 'vocab_entry_link' then 'word_index.vocab_entry_link'
    when 'vocab_entry_mapping_candidate'
      then 'word_index.vocab_entry_mapping_candidate'
    when 'vocab_entry_quiz_eligibility'
      then 'public.vocab_entry_quiz_eligibility'
    else null
  end;

  if target_table is null
    or p_batch_no is null
    or p_batch_no <= 0
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'invalid_vocab_link_batch'
      using errcode = '22023';
  end if;

  received_count := jsonb_array_length(p_rows);
  if received_count not between 1 and 500 then
    raise exception 'vocab_link_batch_size_out_of_range'
      using errcode = '22023';
  end if;

  calculated_payload_sha256 := upper(encode(
    extensions.digest(
      convert_to(p_rows::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ));

  select *
  into run_row
  from word_index.vocab_link_import_run
  where dataset_id = p_dataset_id
  for share;
  if not found then
    raise exception 'vocab_link_import_not_found'
      using errcode = 'P0002';
  end if;

  select *
  into existing_batch
  from word_index.vocab_link_import_batch
  where dataset_id = p_dataset_id
    and table_name = p_table_name
    and batch_no = p_batch_no;
  if found then
    if existing_batch.payload_sha256 <> calculated_payload_sha256
      or existing_batch.received_rows <> received_count
    then
      raise exception 'vocab_link_batch_conflict'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'table', p_table_name,
      'batchNo', p_batch_no,
      'receivedRows', existing_batch.received_rows,
      'insertedRows', existing_batch.inserted_rows,
      'payloadSha256', existing_batch.payload_sha256,
      'idempotent', true
    );
  end if;

  if run_row.status <> 'loading' then
    raise exception 'vocab_link_import_not_loading'
      using errcode = '55000';
  end if;

  if p_table_name = 'occurrence'
    and exists (
      select 1
      from jsonb_array_elements(p_rows) as item(value)
      where item.value ->> 'source_id'
        is distinct from run_row.source_id::text
        or nullif(item.value ->> 'sense_id', '') is not null
    )
  then
    raise exception 'vocab_link_occurrence_scope_mismatch'
      using errcode = '22023';
  end if;

  if p_table_name = 'vocab_entry_link'
    and exists (
      select 1
      from jsonb_array_elements(p_rows) as item(value)
      where item.value ->> 'dataset_id'
        is distinct from p_dataset_id::text
        or item.value ->> 'source_id'
          is distinct from run_row.source_id::text
    )
  then
    raise exception 'vocab_entry_link_scope_mismatch'
      using errcode = '22023';
  end if;

  if p_table_name = 'vocab_entry_quiz_eligibility'
    and exists (
      select 1
      from jsonb_array_elements(p_rows) as item(value)
      where item.value ->> 'dataset_id'
        is distinct from p_dataset_id::text
    )
  then
    raise exception 'vocab_entry_eligibility_scope_mismatch'
      using errcode = '22023';
  end if;

  if p_table_name = 'vocab_entry_mapping_candidate'
    and exists (
      select 1
      from jsonb_to_recordset(p_rows)
        as candidate(vocab_entry_id bigint)
      left join word_index.vocab_entry_link as link
        on link.vocab_entry_id = candidate.vocab_entry_id
      where link.vocab_entry_id is null
        or link.dataset_id <> p_dataset_id
    )
  then
    raise exception 'vocab_mapping_candidate_scope_mismatch'
      using errcode = '22023';
  end if;

  execute format(
    'insert into %s select * from jsonb_populate_recordset(null::%s, $1)',
    target_table,
    target_table
  )
  using p_rows;
  get diagnostics inserted_count = row_count;
  if inserted_count <> received_count then
    raise exception 'vocab_link_batch_insert_count_mismatch'
      using errcode = '21000';
  end if;

  insert into word_index.vocab_link_import_batch (
    dataset_id,
    table_name,
    batch_no,
    payload_sha256,
    received_rows,
    inserted_rows
  )
  values (
    p_dataset_id,
    p_table_name,
    p_batch_no,
    calculated_payload_sha256,
    received_count,
    inserted_count
  );

  return jsonb_build_object(
    'table', p_table_name,
    'batchNo', p_batch_no,
    'receivedRows', received_count,
    'insertedRows', inserted_count,
    'payloadSha256', calculated_payload_sha256,
    'idempotent', false
  );
end;
$$;

create function private.get_vocab_link_import_status(
  p_dataset_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row word_index.vocab_link_import_run%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select *
  into run_row
  from word_index.vocab_link_import_run
  where dataset_id = p_dataset_id;
  if not found then
    raise exception 'vocab_link_import_not_found'
      using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'datasetId', run_row.dataset_id,
    'sourceId', run_row.source_id,
    'status', run_row.status,
    'expectedCounts', run_row.expected_counts,
    'actualCounts', jsonb_build_object(
      'occurrence', (
        select count(*)
        from word_index.occurrence
        where source_id = run_row.source_id
      ),
      'vocab_entry_link', (
        select count(*)
        from word_index.vocab_entry_link
        where dataset_id = run_row.dataset_id
      ),
      'vocab_entry_mapping_candidate', (
        select count(*)
        from word_index.vocab_entry_mapping_candidate as candidate
        join word_index.vocab_entry_link as link
          on link.vocab_entry_id = candidate.vocab_entry_id
        where link.dataset_id = run_row.dataset_id
      ),
      'vocab_entry_quiz_eligibility', (
        select count(*)
        from public.vocab_entry_quiz_eligibility
        where dataset_id = run_row.dataset_id
      ),
      'vocab_dataset_capabilities', (
        select count(*)
        from public.vocab_dataset_capabilities
        where dataset_id = run_row.dataset_id
      )
    ),
    'mappingCounts', (
      select coalesce(
        jsonb_object_agg(mapping_status, status_count),
        '{}'::jsonb
      )
      from (
        select mapping_status, count(*) as status_count
        from word_index.vocab_entry_link
        where dataset_id = run_row.dataset_id
        group by mapping_status
      ) as grouped
    ),
    'canonicalSenseAutoLinks', (
      select count(*)
      from word_index.occurrence
      where source_id = run_row.source_id
        and sense_id is not null
    ),
    'batchCount', (
      select count(*)
      from word_index.vocab_link_import_batch
      where dataset_id = run_row.dataset_id
    )
  );
end;
$$;

create function private.finalize_vocab_link_import(
  p_dataset_id uuid,
  p_capabilities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row word_index.vocab_link_import_run%rowtype;
  expected_count bigint;
  actual_count bigint;
  expected_capability_count bigint;
  dataset_entry_count bigint;
  expected_canonical_snapshot_sha256 text;
  calculated_capabilities_sha256 text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_capabilities is null
    or jsonb_typeof(p_capabilities) <> 'array'
  then
    raise exception 'invalid_vocab_capabilities'
      using errcode = '22023';
  end if;

  calculated_capabilities_sha256 := upper(encode(
    extensions.digest(
      convert_to(p_capabilities::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ));

  select *
  into run_row
  from word_index.vocab_link_import_run
  where dataset_id = p_dataset_id
  for update;
  if not found then
    raise exception 'vocab_link_import_not_found'
      using errcode = 'P0002';
  end if;
  if run_row.status = 'complete' then
    if run_row.capabilities_payload_sha256
      <> calculated_capabilities_sha256
    then
      raise exception 'vocab_link_capability_payload_conflict'
        using errcode = '23505';
    end if;
    return private.get_vocab_link_import_status(p_dataset_id);
  end if;
  if run_row.status <> 'loading' then
    raise exception 'vocab_link_import_not_loading'
      using errcode = '55000';
  end if;

  expected_count := (
    run_row.expected_counts ->> 'occurrence'
  )::bigint;
  select count(*) into actual_count
  from word_index.occurrence
  where source_id = run_row.source_id;
  if actual_count <> expected_count then
    raise exception 'vocab_link_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts ->> 'vocab_entry_link'
  )::bigint;
  select count(*) into actual_count
  from word_index.vocab_entry_link
  where dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_entry_link_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts
      ->> 'vocab_entry_mapping_candidate'
  )::bigint;
  select count(*) into actual_count
  from word_index.vocab_entry_mapping_candidate as candidate
  join word_index.vocab_entry_link as link
    on link.vocab_entry_id = candidate.vocab_entry_id
  where link.dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_mapping_candidate_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts
      ->> 'vocab_entry_quiz_eligibility'
  )::bigint;
  select count(*) into actual_count
  from public.vocab_entry_quiz_eligibility
  where dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_entry_eligibility_count_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from public.vocab_entries
    where dataset_id = p_dataset_id
  ) <> (
    select count(*)
    from word_index.vocab_entry_link
    where dataset_id = p_dataset_id
  ) then
    raise exception 'vocab_dataset_entry_link_coverage_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from word_index.vocab_entry_link
    where dataset_id = p_dataset_id
      and mapping_status in (
        'exact_headword_unreviewed',
        'approved'
      )
  ) <> (
    select count(*)
    from word_index.occurrence
    where source_id = run_row.source_id
  ) then
    raise exception 'vocab_occurrence_exact_link_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    where link.dataset_id = p_dataset_id
      and (
        link.entry_row_sha256 <> (
          select entry.row_sha256
          from public.vocab_entries as entry
          where entry.id = link.vocab_entry_id
            and entry.dataset_id = link.dataset_id
        )
        or (
          link.mapping_status = 'exact_headword_unreviewed'
          and link.occurrence_id is null
        )
        or (
          link.lexeme_id is not null
          and not exists (
            select 1
            from word_index.lexeme as lexeme
            where lexeme.lexeme_id = link.lexeme_id
              and lower(lexeme.content_hash) =
                lower(link.canonical_content_hash)
          )
        )
      )
  ) then
    raise exception 'vocab_entry_link_integrity_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.occurrence
    where source_id = run_row.source_id
      and sense_id is not null
  ) then
    raise exception 'book_meaning_must_not_overwrite_canonical_sense'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.occurrence as occurrence
    left join word_index.vocab_entry_link as link
      on link.occurrence_id = occurrence.occurrence_id
     and link.dataset_id = p_dataset_id
    where occurrence.source_id = run_row.source_id
      and link.vocab_entry_id is null
  ) then
    raise exception 'vocab_occurrence_without_entry_link'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    join word_index.occurrence as occurrence
      on occurrence.occurrence_id = link.occurrence_id
    join public.vocab_entries as entry
      on entry.id = link.vocab_entry_id
     and entry.dataset_id = link.dataset_id
    join public.vocab_units as unit
      on unit.id = entry.unit_id
     and unit.dataset_id = entry.dataset_id
    where link.dataset_id = p_dataset_id
      and (
        occurrence.surface_form is distinct from entry.headword
        or occurrence.source_meaning_ko
          is distinct from entry.primary_meaning
        or occurrence.day_no is distinct from unit.unit_number
        or occurrence.unit_label is distinct from unit.unit_label
        or occurrence.sequence_no is distinct from entry.source_row
        or occurrence.item_label is distinct from
          ('source_row:' || entry.source_row::text)
      )
  ) then
    raise exception 'vocab_occurrence_public_entry_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    where link.dataset_id = p_dataset_id
      and link.candidate_count <> (
        select count(*)
        from word_index.vocab_entry_mapping_candidate as candidate
        where candidate.vocab_entry_id = link.vocab_entry_id
      )
  ) then
    raise exception 'vocab_mapping_candidate_per_entry_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from public.vocab_entry_quiz_eligibility as eligibility
    join public.vocab_entries as entry
      on entry.id = eligibility.vocab_entry_id
     and entry.dataset_id = eligibility.dataset_id
    join word_index.vocab_entry_link as link
      on link.vocab_entry_id = eligibility.vocab_entry_id
     and link.dataset_id = eligibility.dataset_id
    left join word_index.review as review
      on review.review_id = eligibility.content_review_id
    where eligibility.dataset_id = p_dataset_id
      and (
        eligibility.input_content_hash <> entry.row_sha256
        or eligibility.canonical_lexeme_id
          is distinct from link.lexeme_id
        or lower(eligibility.canonical_content_hash)
          is distinct from lower(link.canonical_content_hash)
        or (
          eligibility.content_review_id is not null
          and (
            review.review_id is null
            or review.lexeme_id is distinct from
              eligibility.canonical_lexeme_id
            or lower(review.input_content_hash)
              is distinct from
                lower(eligibility.canonical_content_hash)
          )
        )
      )
  ) then
    raise exception 'vocab_entry_eligibility_integrity_mismatch'
      using errcode = '21000';
  end if;

  expected_capability_count := (
    run_row.expected_counts
      ->> 'vocab_dataset_capabilities'
  )::bigint;
  if jsonb_array_length(p_capabilities) <> expected_capability_count
    or exists (
      select 1
      from jsonb_array_elements(p_capabilities) as capability(value)
      where capability.value ->> 'dataset_id'
        is distinct from p_dataset_id::text
    )
  then
    raise exception 'vocab_dataset_capability_scope_mismatch'
      using errcode = '22023';
  end if;

  insert into public.vocab_dataset_capabilities
  select *
  from jsonb_populate_recordset(
    null::public.vocab_dataset_capabilities,
    p_capabilities
  );

  select count(*) into actual_count
  from public.vocab_dataset_capabilities
  where dataset_id = p_dataset_id;
  if actual_count <> expected_capability_count then
    raise exception 'vocab_dataset_capability_count_mismatch'
      using errcode = '21000';
  end if;

  select count(*)
  into dataset_entry_count
  from public.vocab_entries
  where dataset_id = p_dataset_id;

  select upper(build.input_snapshot_sha256)
  into expected_canonical_snapshot_sha256
  from word_index.index_build as build
  where build.build_id = run_row.build_id;

  if exists (
    select 1
    from public.vocab_dataset_capabilities as capability
    join public.vocab_datasets as dataset
      on dataset.id = capability.dataset_id
    where capability.dataset_id = p_dataset_id
      and (
        capability.eligible_entry_count
          + capability.excluded_entry_count
          <> dataset_entry_count
        or capability.dataset_source_sha256
          <> dataset.source_sha256
        or capability.canonical_snapshot_sha256
          is distinct from expected_canonical_snapshot_sha256
        or (
          capability.quiz_mode in (
            'canonical_definition_to_headword',
            'canonical_example_to_headword',
            'school_context_to_headword',
            'mock_exam_context_to_headword'
          )
          and (
            capability.status <> 'blocked'
            or capability.eligible_entry_count <> 0
          )
        )
        or (
          capability.quiz_mode in (
            'book_meaning_en_to_ko',
            'book_meaning_ko_to_en'
          )
          and (
            capability.eligible_entry_count <> (
              select count(*)
              from public.vocab_entry_quiz_eligibility
                as eligibility
              where eligibility.dataset_id = p_dataset_id
                and eligibility.quiz_mode =
                  capability.quiz_mode
                and eligibility.status = 'eligible'
            )
            or capability.excluded_entry_count <> (
              select count(*)
              from public.vocab_entry_quiz_eligibility
                as eligibility
              where eligibility.dataset_id = p_dataset_id
                and eligibility.quiz_mode =
                  capability.quiz_mode
                and eligibility.status <> 'eligible'
            )
          )
        )
      )
  ) then
    raise exception 'vocab_dataset_capability_integrity_mismatch'
      using errcode = '21000';
  end if;

  update word_index.vocab_link_import_run
  set status = 'complete',
      completed_at_utc = now(),
      capabilities_payload_sha256 =
        calculated_capabilities_sha256
  where dataset_id = p_dataset_id;

  return private.get_vocab_link_import_status(p_dataset_id);
end;
$$;

create function public.begin_vocab_link_import(
  p_dataset_key text,
  p_build_id uuid,
  p_package_snapshot_sha256 text,
  p_source jsonb,
  p_expected_counts jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.begin_vocab_link_import(
    p_dataset_key,
    p_build_id,
    p_package_snapshot_sha256,
    p_source,
    p_expected_counts
  );
$$;

create function public.import_vocab_link_batch(
  p_dataset_id uuid,
  p_table_name text,
  p_batch_no integer,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_vocab_link_batch(
    p_dataset_id,
    p_table_name,
    p_batch_no,
    p_rows
  );
$$;

create function public.get_vocab_link_import_status(
  p_dataset_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_vocab_link_import_status(p_dataset_id);
$$;

create function public.finalize_vocab_link_import(
  p_dataset_id uuid,
  p_capabilities jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_vocab_link_import(
    p_dataset_id,
    p_capabilities
  );
$$;

revoke all on function private.begin_vocab_link_import(
  text,
  uuid,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function private.import_vocab_link_batch(
  uuid,
  text,
  integer,
  jsonb
) from public, anon, authenticated;
revoke all on function private.get_vocab_link_import_status(uuid)
  from public, anon, authenticated;
revoke all on function private.finalize_vocab_link_import(uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.begin_vocab_link_import(
  text,
  uuid,
  text,
  jsonb,
  jsonb
) from public, anon, authenticated;
revoke all on function public.import_vocab_link_batch(
  uuid,
  text,
  integer,
  jsonb
) from public, anon, authenticated;
revoke all on function public.get_vocab_link_import_status(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_vocab_link_import(uuid, jsonb)
  from public, anon, authenticated;

grant execute on function private.begin_vocab_link_import(
  text,
  uuid,
  text,
  jsonb,
  jsonb
) to service_role;
grant execute on function private.import_vocab_link_batch(
  uuid,
  text,
  integer,
  jsonb
) to service_role;
grant execute on function private.get_vocab_link_import_status(uuid)
  to service_role;
grant execute on function private.finalize_vocab_link_import(uuid, jsonb)
  to service_role;
grant execute on function public.begin_vocab_link_import(
  text,
  uuid,
  text,
  jsonb,
  jsonb
) to service_role;
grant execute on function public.import_vocab_link_batch(
  uuid,
  text,
  integer,
  jsonb
) to service_role;
grant execute on function public.get_vocab_link_import_status(uuid)
  to service_role;
grant execute on function public.finalize_vocab_link_import(uuid, jsonb)
  to service_role;

notify pgrst, 'reload schema';
