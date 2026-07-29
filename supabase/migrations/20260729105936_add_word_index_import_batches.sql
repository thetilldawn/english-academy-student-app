create table word_index.import_run (
  build_id uuid primary key
    references word_index.index_build(build_id) on delete cascade,
  package_snapshot_sha256 text not null check (
    package_snapshot_sha256 ~ '^[0-9A-F]{64}$'
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
  constraint word_index_import_run_state_check check (
    (
      status = 'loading'
      and completed_at_utc is null
      and failure_detail is null
    )
    or (
      status = 'complete'
      and completed_at_utc is not null
      and failure_detail is null
    )
    or (
      status = 'failed'
      and completed_at_utc is not null
      and failure_detail is not null
    )
  )
);

create table word_index.import_batch (
  build_id uuid not null
    references word_index.import_run(build_id) on delete cascade,
  table_name text not null,
  batch_no integer not null check (batch_no > 0),
  payload_sha256 text not null check (
    payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  received_rows integer not null check (received_rows > 0),
  inserted_rows integer not null check (
    inserted_rows > 0 and inserted_rows = received_rows
  ),
  applied_at_utc timestamptz not null default now(),
  primary key (build_id, table_name, batch_no)
);

create index word_index_import_batch_table_idx
  on word_index.import_batch(build_id, table_name, batch_no);

alter table word_index.import_run enable row level security;
alter table word_index.import_batch enable row level security;
revoke all on table word_index.import_run
  from public, anon, authenticated;
revoke all on table word_index.import_batch
  from public, anon, authenticated;

create function private.begin_word_index_import(
  p_build_id uuid,
  p_schema_version text,
  p_builder_version text,
  p_source_root_label text,
  p_input_file_count integer,
  p_input_snapshot_sha256 text,
  p_source_started_at_utc timestamptz,
  p_source_completed_at_utc timestamptz,
  p_summary_json jsonb,
  p_package_snapshot_sha256 text,
  p_expected_counts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing_run word_index.import_run%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_build_id is null
    or nullif(trim(p_schema_version), '') is null
    or nullif(trim(p_builder_version), '') is null
    or nullif(trim(p_source_root_label), '') is null
    or p_input_file_count < 0
    or p_input_snapshot_sha256 !~ '^[0-9A-F]{64}$'
    or p_package_snapshot_sha256 !~ '^[0-9A-F]{64}$'
    or p_source_started_at_utc is null
    or p_source_completed_at_utc is null
    or p_source_completed_at_utc < p_source_started_at_utc
    or p_summary_json is null
    or jsonb_typeof(p_summary_json) <> 'object'
    or p_expected_counts is null
    or jsonb_typeof(p_expected_counts) <> 'object'
  then
    raise exception 'invalid_word_index_import_metadata'
      using errcode = '22023';
  end if;

  select *
  into existing_run
  from word_index.import_run
  where build_id = p_build_id;

  if found then
    if existing_run.package_snapshot_sha256
        <> p_package_snapshot_sha256
      or existing_run.expected_counts <> p_expected_counts
    then
      raise exception 'word_index_import_metadata_conflict'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'buildId', existing_run.build_id,
      'status', existing_run.status,
      'idempotent', true
    );
  end if;

  if exists (select 1 from word_index.lexeme)
    or exists (
      select 1
      from word_index.import_run
      where status in ('loading', 'complete')
    )
  then
    raise exception 'word_index_snapshot_already_present'
      using errcode = '55000';
  end if;

  insert into word_index.index_build (
    build_id,
    schema_version,
    builder_version,
    source_root_label,
    input_file_count,
    input_snapshot_sha256,
    started_at_utc,
    completed_at_utc,
    status,
    summary_json
  )
  values (
    p_build_id,
    trim(p_schema_version),
    trim(p_builder_version),
    trim(p_source_root_label),
    p_input_file_count,
    lower(p_input_snapshot_sha256),
    p_source_started_at_utc,
    p_source_completed_at_utc,
    'loading',
    p_summary_json
  );

  insert into word_index.import_run (
    build_id,
    package_snapshot_sha256,
    status,
    expected_counts
  )
  values (
    p_build_id,
    p_package_snapshot_sha256,
    'loading',
    p_expected_counts
  );

  return jsonb_build_object(
    'buildId', p_build_id,
    'status', 'loading',
    'idempotent', false
  );
end;
$$;

create function private.import_word_index_batch(
  p_build_id uuid,
  p_table_name text,
  p_batch_no integer,
  p_payload_sha256 text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  allowed_tables constant text[] := array[
    'schema_meta',
    'input_file_manifest',
    'lexeme',
    'sense',
    'etymology',
    'source',
    'occurrence',
    'relation',
    'relation_evidence',
    'example',
    'review',
    'raw_pointer',
    'level_mapping',
    'type_decision',
    'data_issue',
    'pipeline_rule',
    'legacy_freeze',
    'work_queue',
    'lexeme_tag',
    'lexeme_metric'
  ];
  received_count integer;
  inserted_count integer;
  existing_batch word_index.import_batch%rowtype;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not (p_table_name = any(allowed_tables))
    or p_batch_no is null
    or p_batch_no <= 0
    or p_payload_sha256 !~ '^[0-9A-F]{64}$'
    or p_rows is null
    or jsonb_typeof(p_rows) <> 'array'
  then
    raise exception 'invalid_word_index_batch'
      using errcode = '22023';
  end if;

  received_count := jsonb_array_length(p_rows);
  if received_count not between 1 and 500 then
    raise exception 'word_index_batch_size_out_of_range'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from word_index.import_run
    where build_id = p_build_id
      and status = 'loading'
  ) then
    raise exception 'word_index_import_not_loading'
      using errcode = '55000';
  end if;

  select *
  into existing_batch
  from word_index.import_batch
  where build_id = p_build_id
    and table_name = p_table_name
    and batch_no = p_batch_no;

  if found then
    if existing_batch.payload_sha256 <> p_payload_sha256
      or existing_batch.received_rows <> received_count
    then
      raise exception 'word_index_batch_conflict'
        using errcode = '23505';
    end if;

    return jsonb_build_object(
      'table', p_table_name,
      'batchNo', p_batch_no,
      'receivedRows', existing_batch.received_rows,
      'insertedRows', existing_batch.inserted_rows,
      'idempotent', true
    );
  end if;

  execute format(
    'insert into word_index.%I select * from jsonb_populate_recordset(null::word_index.%I, $1)',
    p_table_name,
    p_table_name
  )
  using p_rows;

  get diagnostics inserted_count = row_count;
  if inserted_count <> received_count then
    raise exception 'word_index_batch_insert_count_mismatch'
      using errcode = '21000';
  end if;

  insert into word_index.import_batch (
    build_id,
    table_name,
    batch_no,
    payload_sha256,
    received_rows,
    inserted_rows
  )
  values (
    p_build_id,
    p_table_name,
    p_batch_no,
    p_payload_sha256,
    received_count,
    inserted_count
  );

  return jsonb_build_object(
    'table', p_table_name,
    'batchNo', p_batch_no,
    'receivedRows', received_count,
    'insertedRows', inserted_count,
    'idempotent', false
  );
end;
$$;

create function private.get_word_index_import_status(
  p_build_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row word_index.import_run%rowtype;
  table_counts jsonb := '{}'::jsonb;
  table_name text;
  row_count_value bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select *
  into run_row
  from word_index.import_run
  where build_id = p_build_id;
  if not found then
    raise exception 'word_index_import_not_found'
      using errcode = 'P0002';
  end if;

  for table_name in
    select key
    from jsonb_each(run_row.expected_counts)
    where key <> 'v_readiness_ready'
    order by key
  loop
    execute format(
      'select count(*) from word_index.%I',
      table_name
    )
    into row_count_value;
    table_counts := table_counts || jsonb_build_object(
      table_name,
      row_count_value
    );
  end loop;

  return jsonb_build_object(
    'buildId', run_row.build_id,
    'status', run_row.status,
    'expectedCounts', run_row.expected_counts,
    'actualCounts', table_counts,
    'readyCount', (
      select count(*)
      from word_index.v_readiness
      where is_ready
    ),
    'batchCount', (
      select count(*)
      from word_index.import_batch
      where build_id = p_build_id
    ),
    'insertedRows', (
      select coalesce(sum(inserted_rows), 0)
      from word_index.import_batch
      where build_id = p_build_id
    )
  );
end;
$$;

create function private.finalize_word_index_import(
  p_build_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row word_index.import_run%rowtype;
  table_name text;
  expected_count bigint;
  actual_count bigint;
  expected_ready_count bigint;
  actual_ready_count bigint;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select *
  into run_row
  from word_index.import_run
  where build_id = p_build_id
  for update;
  if not found or run_row.status <> 'loading' then
    raise exception 'word_index_import_not_loading'
      using errcode = '55000';
  end if;

  for table_name, expected_count in
    select key, value::text::bigint
    from jsonb_each(run_row.expected_counts)
    where key <> 'v_readiness_ready'
  loop
    execute format(
      'select count(*) from word_index.%I',
      table_name
    )
    into actual_count;
    if actual_count <> expected_count then
      raise exception
        'word_index_count_mismatch: table %, expected %, actual %',
        table_name,
        expected_count,
        actual_count
        using errcode = '21000';
    end if;
  end loop;

  expected_ready_count := coalesce(
    (run_row.expected_counts ->> 'v_readiness_ready')::bigint,
    0
  );
  select count(*)
  into actual_ready_count
  from word_index.v_readiness
  where is_ready;
  if actual_ready_count <> expected_ready_count then
    raise exception
      'word_index_readiness_mismatch: expected %, actual %',
      expected_ready_count,
      actual_ready_count
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from word_index.input_file_manifest
    where build_id = p_build_id
  ) <> (
    select input_file_count
    from word_index.index_build
    where build_id = p_build_id
  ) then
    raise exception 'word_index_input_manifest_count_mismatch'
      using errcode = '21000';
  end if;

  update word_index.import_run
  set status = 'complete',
      completed_at_utc = now()
  where build_id = p_build_id;

  update word_index.index_build
  set status = 'complete'
  where build_id = p_build_id;

  return private.get_word_index_import_status(p_build_id);
end;
$$;

create function public.begin_word_index_import(
  p_build_id uuid,
  p_schema_version text,
  p_builder_version text,
  p_source_root_label text,
  p_input_file_count integer,
  p_input_snapshot_sha256 text,
  p_source_started_at_utc timestamptz,
  p_source_completed_at_utc timestamptz,
  p_summary_json jsonb,
  p_package_snapshot_sha256 text,
  p_expected_counts jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.begin_word_index_import(
    p_build_id,
    p_schema_version,
    p_builder_version,
    p_source_root_label,
    p_input_file_count,
    p_input_snapshot_sha256,
    p_source_started_at_utc,
    p_source_completed_at_utc,
    p_summary_json,
    p_package_snapshot_sha256,
    p_expected_counts
  );
$$;

create function public.import_word_index_batch(
  p_build_id uuid,
  p_table_name text,
  p_batch_no integer,
  p_payload_sha256 text,
  p_rows jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_word_index_batch(
    p_build_id,
    p_table_name,
    p_batch_no,
    p_payload_sha256,
    p_rows
  );
$$;

create function public.get_word_index_import_status(
  p_build_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.get_word_index_import_status(p_build_id);
$$;

create function public.finalize_word_index_import(
  p_build_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_word_index_import(p_build_id);
$$;

revoke all on function private.begin_word_index_import(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function private.import_word_index_batch(
  uuid,
  text,
  integer,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function private.get_word_index_import_status(uuid)
  from public, anon, authenticated;
revoke all on function private.finalize_word_index_import(uuid)
  from public, anon, authenticated;

revoke all on function public.begin_word_index_import(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.import_word_index_batch(
  uuid,
  text,
  integer,
  text,
  jsonb
) from public, anon, authenticated;
revoke all on function public.get_word_index_import_status(uuid)
  from public, anon, authenticated;
revoke all on function public.finalize_word_index_import(uuid)
  from public, anon, authenticated;

grant execute on function private.begin_word_index_import(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  jsonb
) to service_role;
grant execute on function private.import_word_index_batch(
  uuid,
  text,
  integer,
  text,
  jsonb
) to service_role;
grant execute on function private.get_word_index_import_status(uuid)
  to service_role;
grant execute on function private.finalize_word_index_import(uuid)
  to service_role;

grant execute on function public.begin_word_index_import(
  uuid,
  text,
  text,
  text,
  integer,
  text,
  timestamptz,
  timestamptz,
  jsonb,
  text,
  jsonb
) to service_role;
grant execute on function public.import_word_index_batch(
  uuid,
  text,
  integer,
  text,
  jsonb
) to service_role;
grant execute on function public.get_word_index_import_status(uuid)
  to service_role;
grant execute on function public.finalize_word_index_import(uuid)
  to service_role;
