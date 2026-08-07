begin;

-- Preview-only projection of a canonical dictionary manifest. The Obsidian
-- Markdown/YAML records remain the source of truth. This projection stores
-- text dictionary IDs and occurrence-specific display data; it never creates
-- a replacement UUID lexeme and never promotes a candidate dictionary record.
create table word_index.app_exam_use_release (
  release_id uuid primary key default extensions.gen_random_uuid(),
  release_key text not null unique
    check (char_length(trim(release_key)) between 1 and 240),
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  dataset_key text not null
    check (char_length(trim(dataset_key)) between 1 and 200),
  schema_version text not null check (schema_version = '1.0'),
  package_version text not null unique
    check (package_version ~ '^[0-9A-Fa-f]{64}$'),
  source_sha256 text not null
    check (source_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  candidate_dictionary_version text not null
    check (candidate_dictionary_version ~ '^[0-9A-Fa-f]{64}$'),
  manifest_content_hash text not null
    check (manifest_content_hash ~ '^[0-9A-Fa-f]{64}$'),
  exam_review_ledger_sha256 text not null
    check (exam_review_ledger_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  wordbook_id text not null
    check (char_length(trim(wordbook_id)) between 1 and 200),
  title text not null
    check (char_length(trim(title)) between 1 and 300),
  target_environment text not null check (target_environment = 'preview'),
  common_dictionary_release_allowed boolean not null
    check (not common_dictionary_release_allowed),
  exam_use_import_allowed boolean not null
    check (exam_use_import_allowed),
  expected_occurrence_count integer not null check (
    expected_occurrence_count > 0
  ),
  expected_dictionary_count integer not null check (
    expected_dictionary_count > 0
    and expected_dictionary_count <= expected_occurrence_count
  ),
  expected_included_count integer not null check (
    expected_included_count > 0
    and expected_included_count <= expected_occurrence_count
  ),
  status text not null default 'loading' check (
    status in ('loading', 'active', 'retired', 'failed')
  ),
  package_json jsonb not null check (jsonb_typeof(package_json) = 'object'),
  created_at_utc timestamptz not null default now(),
  activated_at_utc timestamptz,
  retired_at_utc timestamptz,
  failure_detail text,
  unique (release_id, dataset_id)
);

create unique index word_index_one_active_exam_use_release_idx
  on word_index.app_exam_use_release(dataset_id)
  where status = 'active';

create index word_index_exam_use_release_dataset_idx
  on word_index.app_exam_use_release(dataset_id, created_at_utc desc);

create table word_index.app_exam_use_occurrence (
  release_id uuid not null
    references word_index.app_exam_use_release(release_id)
    on delete cascade,
  dataset_id uuid not null,
  source_row integer not null check (source_row > 0),
  vocab_entry_id bigint,
  unit_id uuid not null,
  position_in_unit integer not null check (position_in_unit > 0),
  dictionary_id text not null check (
    dictionary_id ~ '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  legacy_ids jsonb not null default '[]'::jsonb
    check (jsonb_typeof(legacy_ids) = 'array'),
  sense_id text,
  pronunciation_variant_id text,
  display_headword text not null check (
    char_length(trim(display_headword)) between 1 and 160
  ),
  display_gloss_ko text not null check (
    char_length(trim(display_gloss_ko)) between 1 and 500
  ),
  display_pronunciation_ko text check (
    display_pronunciation_ko is null
    or char_length(trim(display_pronunciation_ko)) between 1 and 160
  ),
  display_pronunciation_review_status text not null check (
    display_pronunciation_review_status in ('candidate', 'approved')
  ),
  audio_status text not null check (
    audio_status in ('raw_attached', 'disabled')
  ),
  audio_url text check (
    audio_url is null
    or audio_url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
  ),
  sound_audio text,
  raw_response_sha256 text check (
    raw_response_sha256 is null
    or raw_response_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  listening_enabled boolean not null default false,
  occurrence_id text not null
    check (occurrence_id ~ '^occ:[a-z0-9][a-z0-9._-]*$'),
  occurrence_content_hash text not null
    check (occurrence_content_hash ~ '^[0-9A-Fa-f]{64}$'),
  package_entry_content_hash text not null
    check (package_entry_content_hash ~ '^[0-9A-Fa-f]{64}$'),
  exam_review_id text not null
    check (exam_review_id ~ '^exam-review:[a-z0-9][a-z0-9._-]*$'),
  exam_input_hash text not null
    check (exam_input_hash ~ '^[0-9A-Fa-f]{64}$'),
  exam_use_status text not null check (
    exam_use_status in ('reviewed_for_preview', 'review_required', 'excluded')
  ),
  context_evidence_status text not null check (
    context_evidence_status in (
      'source_entry_context',
      'manual_context_correction',
      'manual_context_invalidation',
      'problem_pdf_unique_match',
      'problem_pdf_multiple_matches',
      'locator_only'
    )
  ),
  context_evidence jsonb not null
    check (jsonb_typeof(context_evidence) = 'object'),
  source_projection_row_sha256 text not null
    check (source_projection_row_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  source_entry_id text not null
    check (char_length(trim(source_entry_id)) between 1 and 200),
  source_entry_sha256 text not null
    check (source_entry_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  include_in_exam boolean not null,
  manual_review_flags jsonb not null default '[]'::jsonb
    check (jsonb_typeof(manual_review_flags) = 'array'),
  audio_json jsonb not null check (jsonb_typeof(audio_json) = 'object'),
  package_entry_json jsonb not null
    check (jsonb_typeof(package_entry_json) = 'object'),
  primary key (release_id, source_row),
  unique (release_id, vocab_entry_id),
  unique (release_id, occurrence_id),
  unique (release_id, unit_id, position_in_unit),
  unique (
    release_id,
    dataset_id,
    vocab_entry_id,
    dictionary_id,
    occurrence_id
  ),
  foreign key (release_id, dataset_id)
    references word_index.app_exam_use_release(release_id, dataset_id)
    on delete cascade,
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  foreign key (unit_id, dataset_id)
    references public.vocab_units(id, dataset_id)
    on delete restrict,
  constraint app_exam_use_listening_contract check (
    (
      listening_enabled
      and audio_status = 'raw_attached'
      and pronunciation_variant_id is not null
      and audio_url is not null
      and sound_audio is not null
      and raw_response_sha256 is not null
    )
    or (
      not listening_enabled
      and audio_status = 'disabled'
      and audio_url is null
    )
  ),
  constraint app_exam_use_included_review_check check (
    (
      include_in_exam
      and exam_use_status = 'reviewed_for_preview'
      and vocab_entry_id is not null
      and context_evidence_status not in (
        'manual_context_invalidation',
        'locator_only'
      )
    )
    or (
      not include_in_exam
      and exam_use_status in ('review_required', 'excluded')
      and vocab_entry_id is null
    )
  )
);

create index word_index_exam_use_occurrence_dictionary_idx
  on word_index.app_exam_use_occurrence(release_id, dictionary_id);

create index word_index_exam_use_occurrence_vocab_idx
  on word_index.app_exam_use_occurrence(vocab_entry_id, release_id);

alter table word_index.app_exam_use_release enable row level security;
alter table word_index.app_exam_use_occurrence enable row level security;

revoke all on table word_index.app_exam_use_release
  from public, anon, authenticated;
revoke all on table word_index.app_exam_use_occurrence
  from public, anon, authenticated;

-- A reviewed Preview question is projected into a service-only sidecar. The
-- existing assignment tables, UUID lexeme bridge, and their constraints are
-- deliberately untouched.
create table public.assignment_question_exam_use_snapshot (
  assignment_question_id uuid primary key,
  assignment_id uuid not null,
  dataset_id uuid not null,
  vocab_entry_id bigint not null,
  release_id uuid not null,
  dictionary_id text not null check (
    dictionary_id ~ '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  occurrence_id text not null check (
    occurrence_id ~ '^occ:[a-z0-9][a-z0-9._-]*$'
  ),
  sense_id text,
  pronunciation_variant_id text,
  exam_review_id text not null check (
    exam_review_id ~ '^exam-review:[a-z0-9][a-z0-9._-]*$'
  ),
  headword_snapshot text not null check (
    char_length(trim(headword_snapshot)) between 1 and 160
  ),
  primary_meaning_snapshot text not null check (
    char_length(trim(primary_meaning_snapshot)) between 1 and 500
  ),
  display_pronunciation_ko_snapshot text check (
    display_pronunciation_ko_snapshot is null
    or char_length(trim(display_pronunciation_ko_snapshot)) between 1 and 160
  ),
  pronunciation_snapshot jsonb not null check (
    jsonb_typeof(pronunciation_snapshot) = 'object'
  ),
  choice_dictionary_snapshots jsonb not null check (
    jsonb_typeof(choice_dictionary_snapshots) = 'array'
    and jsonb_array_length(choice_dictionary_snapshots) = 4
  ),
  occurrence_content_hash text not null check (
    occurrence_content_hash ~ '^[0-9A-Fa-f]{64}$'
  ),
  question_content_sha256 text not null check (
    question_content_sha256 ~ '^[0-9A-F]{64}$'
  ),
  provenance_status text not null check (
    provenance_status = 'reviewed_for_preview_v1'
  ),
  created_at_utc timestamptz not null default now(),
  unique (assignment_id, dictionary_id),
  constraint assignment_question_exam_use_snapshot_question_fkey
    foreign key (assignment_question_id, vocab_entry_id)
    references public.assignment_questions(id, vocab_entry_id)
    on delete cascade,
  constraint assignment_question_exam_use_snapshot_assignment_entry_fkey
    foreign key (assignment_id, vocab_entry_id)
    references public.assignment_questions(assignment_id, vocab_entry_id)
    on delete cascade,
  constraint assignment_question_exam_use_snapshot_occurrence_fkey
    foreign key (
    release_id,
    dataset_id,
    vocab_entry_id,
    dictionary_id,
    occurrence_id
  )
    references word_index.app_exam_use_occurrence(
      release_id,
      dataset_id,
      vocab_entry_id,
      dictionary_id,
      occurrence_id
    )
    on delete restrict
);

create index assignment_question_exam_use_release_idx
  on public.assignment_question_exam_use_snapshot(release_id);

create function private.assert_exam_use_snapshot_question_link_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.assignment_questions as question
    where question.id = new.assignment_question_id
      and question.assignment_id = new.assignment_id
      and question.vocab_entry_id = new.vocab_entry_id
  ) then
    raise exception 'exam_use_snapshot_question_link_mismatch'
      using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger assignment_question_exam_use_snapshot_link_guard
before insert or update
on public.assignment_question_exam_use_snapshot
for each row
execute function private.assert_exam_use_snapshot_question_link_v1();

alter table public.assignment_question_exam_use_snapshot
  enable row level security;
revoke all on table public.assignment_question_exam_use_snapshot
  from public, anon, authenticated;
grant select on table public.assignment_question_exam_use_snapshot
  to service_role;

create table word_index.assignment_exam_use_release_snapshot (
  assignment_id uuid primary key
    references public.assignments(id) on delete cascade,
  dataset_id uuid not null,
  release_id uuid not null,
  package_version text not null
    check (package_version ~ '^[0-9A-Fa-f]{64}$'),
  candidate_dictionary_version text not null
    check (candidate_dictionary_version ~ '^[0-9A-Fa-f]{64}$'),
  manifest_content_hash text not null
    check (manifest_content_hash ~ '^[0-9A-Fa-f]{64}$'),
  exam_review_ledger_sha256 text not null
    check (exam_review_ledger_sha256 ~ '^[0-9A-Fa-f]{64}$'),
  created_at_utc timestamptz not null default now(),
  foreign key (assignment_id, dataset_id)
    references public.assignments(id, dataset_id)
    on delete cascade,
  foreign key (release_id, dataset_id)
    references word_index.app_exam_use_release(release_id, dataset_id)
    on delete restrict
);

alter table word_index.assignment_exam_use_release_snapshot
  enable row level security;
revoke all on table word_index.assignment_exam_use_release_snapshot
  from public, anon, authenticated;

create function private.import_app_exam_use_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_dataset_id uuid;
  created_release_id uuid;
  existing_release word_index.app_exam_use_release%rowtype;
  v_entry_count integer;
  v_dictionary_count integer;
  v_included_count integer;
  v_inserted_count integer;
  v_package_version text;
  v_dataset_key text;
  v_source_sha256 text;
  v_candidate_dictionary_version text;
  v_manifest_content_hash text;
  v_exam_review_ledger_sha256 text;
begin
  if p_package is null
    or jsonb_typeof(p_package) <> 'object'
    or p_package ->> 'schema_version' <> '1.0'
    or p_package ->> 'package_type' <> 'student-app-exam-use-wordbook'
    or p_package ->> 'target_environment' <> 'preview'
    or coalesce((p_package ->> 'common_dictionary_release_allowed')::boolean, true)
    or not coalesce((p_package ->> 'exam_use_import_allowed')::boolean, false)
    or jsonb_typeof(p_package -> 'entries') <> 'array'
  then
    raise exception 'invalid_exam_use_package'
      using errcode = '22023';
  end if;

  v_package_version := lower(p_package ->> 'package_version');
  v_dataset_key := trim(p_package ->> 'dataset_key');
  v_source_sha256 := upper(p_package ->> 'source_sha256');
  v_candidate_dictionary_version :=
    lower(p_package ->> 'candidate_dictionary_version');
  v_manifest_content_hash :=
    lower(p_package ->> 'manifest_content_hash');
  v_exam_review_ledger_sha256 :=
    lower(p_package ->> 'exam_review_ledger_sha256');

  if v_package_version !~ '^[0-9a-f]{64}$'
    or v_dataset_key !~ '^[a-z0-9][a-z0-9-]{2,79}$'
    or v_source_sha256 !~ '^[A-F0-9]{64}$'
    or v_candidate_dictionary_version !~ '^[0-9a-f]{64}$'
    or v_manifest_content_hash !~ '^[0-9a-f]{64}$'
    or v_exam_review_ledger_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_exam_use_package_hash_or_key'
      using errcode = '22023';
  end if;

  select *
  into existing_release
  from word_index.app_exam_use_release
  where app_exam_use_release.package_version = v_package_version;

  if found then
    if existing_release.status <> 'active'
      or existing_release.dataset_key <> v_dataset_key
      or existing_release.source_sha256 <> lower(v_source_sha256)
      or existing_release.candidate_dictionary_version <>
        v_candidate_dictionary_version
      or existing_release.manifest_content_hash <>
        v_manifest_content_hash
      or existing_release.exam_review_ledger_sha256 <>
        v_exam_review_ledger_sha256
      or existing_release.package_json <> p_package
    then
      raise exception 'exam_use_package_identity_conflict'
        using errcode = '23505';
    end if;
    return jsonb_build_object(
      'datasetId', existing_release.dataset_id,
      'releaseId', existing_release.release_id,
      'status', existing_release.status,
      'idempotent', true,
      'occurrenceCount', existing_release.expected_occurrence_count,
      'includedCount', existing_release.expected_included_count,
      'dictionaryCount', existing_release.expected_dictionary_count
    );
  end if;

  select
    jsonb_array_length(p_package -> 'entries'),
    count(distinct entry.dictionary_id),
    count(*) filter (where entry.include_in_exam)
  into v_entry_count, v_dictionary_count, v_included_count
  from jsonb_to_recordset(p_package -> 'entries') as entry(
    dictionary_id text,
    include_in_exam boolean
  );

  if v_entry_count < 1
    or v_dictionary_count < 1
    or v_included_count < 4
    or v_included_count > v_entry_count
  then
    raise exception 'invalid_exam_use_package_counts'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.vocab_datasets
    where vocab_datasets.dataset_key = v_dataset_key
  ) then
    raise exception 'exam_use_dataset_key_already_exists'
      using errcode = '23505';
  end if;

  insert into public.vocab_datasets (
    dataset_key,
    title,
    edition,
    source_label,
    source_sha256,
    row_count,
    status,
    is_active,
    metadata
  )
  values (
    v_dataset_key,
    trim(p_package ->> 'title'),
    'exam-scope-v1',
    trim(p_package ->> 'wordbook_id'),
    v_source_sha256,
    v_included_count,
    'ready',
    true,
    jsonb_build_object(
      'projectionProfile', 'exam_scope_candidate_v1',
      'targetEnvironment', 'preview',
      'packageVersion', v_package_version,
      'manifestContentHash', v_manifest_content_hash,
      'candidateDictionaryVersion', v_candidate_dictionary_version,
      'totalOccurrenceCount', v_entry_count,
      'includedOccurrenceCount', v_included_count
    )
  )
  returning id into created_dataset_id;

  with parsed as (
    select *
    from jsonb_to_recordset(p_package -> 'entries') as entry(
      source_row integer,
      unit text,
      include_in_exam boolean
    )
  ),
  grouped as (
    select
      unit,
      min(source_row) as first_source_row,
      count(*) filter (where include_in_exam) as included_count
    from parsed
    group by unit
  ),
  ranked as (
    select
      unit,
      included_count,
      row_number() over (
        order by first_source_row, unit
      )::integer as sort_index
    from grouped
  )
  insert into public.vocab_units (
    dataset_id,
    unit_label,
    normalized_label,
    unit_kind,
    unit_number,
    sort_index,
    entry_count
  )
  select
    created_dataset_id,
    trim(unit),
    lower(normalize(trim(unit), NFKC)),
    'supplement'::public.vocab_unit_kind,
    null,
    sort_index,
    included_count
  from ranked;

  insert into public.vocab_entries (
    dataset_id,
    source_row,
    headword,
    headword_normalized,
    pronunciation_ko,
    meanings,
    primary_meaning,
    source_ref,
    row_sha256,
    unit_id,
    position_in_unit,
    entry_type
  )
  select
    created_dataset_id,
    entry.source_row,
    trim(entry.display_headword),
    lower(normalize(
      trim(replace(entry.display_headword, '*', '')),
      NFKC
    )),
    nullif(trim(entry.display_pronunciation_ko), ''),
    array[trim(entry.display_gloss_ko)],
    trim(entry.display_gloss_ko),
    trim(entry.unit) || ' · ' || split_part(entry.dictionary_id, ':', 1),
    upper(entry.entry_row_sha256),
    unit.id,
    entry.position_in_unit,
    split_part(entry.dictionary_id, ':', 1)
  from jsonb_to_recordset(p_package -> 'entries') as entry(
    source_row integer,
    unit text,
    position_in_unit integer,
    dictionary_id text,
    display_headword text,
    display_gloss_ko text,
    display_pronunciation_ko text,
    entry_row_sha256 text,
    include_in_exam boolean
  )
  join public.vocab_units as unit
    on unit.dataset_id = created_dataset_id
    and unit.normalized_label = lower(normalize(trim(entry.unit), NFKC))
  where entry.include_in_exam;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_included_count then
    raise exception 'exam_use_vocab_entry_count_mismatch'
      using errcode = '21000';
  end if;

  insert into word_index.app_exam_use_release (
    release_key,
    dataset_id,
    dataset_key,
    schema_version,
    package_version,
    source_sha256,
    candidate_dictionary_version,
    manifest_content_hash,
    exam_review_ledger_sha256,
    wordbook_id,
    title,
    target_environment,
    common_dictionary_release_allowed,
    exam_use_import_allowed,
    expected_occurrence_count,
    expected_dictionary_count,
    expected_included_count,
    status,
    package_json
  )
  values (
    v_dataset_key || ':' || v_package_version,
    created_dataset_id,
    v_dataset_key,
    '1.0',
    v_package_version,
    lower(v_source_sha256),
    v_candidate_dictionary_version,
    v_manifest_content_hash,
    v_exam_review_ledger_sha256,
    trim(p_package ->> 'wordbook_id'),
    trim(p_package ->> 'title'),
    'preview',
    false,
    true,
    v_entry_count,
    v_dictionary_count,
    v_included_count,
    'loading',
    p_package
  )
  returning release_id into created_release_id;

  insert into word_index.app_exam_use_occurrence (
    release_id,
    dataset_id,
    source_row,
    vocab_entry_id,
    unit_id,
    position_in_unit,
    dictionary_id,
    legacy_ids,
    sense_id,
    pronunciation_variant_id,
    display_headword,
    display_gloss_ko,
    display_pronunciation_ko,
    display_pronunciation_review_status,
    audio_status,
    audio_url,
    sound_audio,
    raw_response_sha256,
    listening_enabled,
    occurrence_id,
    occurrence_content_hash,
    package_entry_content_hash,
    exam_review_id,
    exam_input_hash,
    exam_use_status,
    context_evidence_status,
    context_evidence,
    source_projection_row_sha256,
    source_entry_id,
    source_entry_sha256,
    include_in_exam,
    manual_review_flags,
    audio_json,
    package_entry_json
  )
  select
    created_release_id,
    created_dataset_id,
    entry.source_row,
    vocab_entry.id,
    unit.id,
    entry.position_in_unit,
    entry.dictionary_id,
    entry.legacy_ids,
    entry.sense_id,
    entry.pronunciation_variant_id,
    trim(entry.display_headword),
    trim(entry.display_gloss_ko),
    nullif(trim(entry.display_pronunciation_ko), ''),
    entry.display_pronunciation_review_status,
    entry.audio ->> 'status',
    entry.audio ->> 'audio_url',
    entry.audio ->> 'sound_audio',
    entry.audio ->> 'raw_response_sha256',
    entry.audio ->> 'status' = 'raw_attached',
    entry.occurrence_id,
    entry.occurrence_content_hash,
    entry.content_hash,
    entry.exam_review_id,
    entry.exam_input_hash,
    entry.exam_use_status,
    entry.context_evidence_status,
    entry.context_evidence,
    entry.entry_row_sha256,
    entry.source_entry_id,
    entry.source_entry_sha256,
    entry.include_in_exam,
    entry.manual_review_flags,
    entry.audio,
    entry.package_entry_json
  from (
    select
      value as package_entry_json,
      parsed.*
    from jsonb_array_elements(p_package -> 'entries') as raw(value)
    cross join lateral jsonb_to_record(raw.value) as parsed(
      source_row integer,
      unit text,
      position_in_unit integer,
      dictionary_id text,
      legacy_ids jsonb,
      sense_id text,
      pronunciation_variant_id text,
      display_headword text,
      display_gloss_ko text,
      display_pronunciation_ko text,
      display_pronunciation_review_status text,
      audio jsonb,
      occurrence_id text,
      occurrence_content_hash text,
      content_hash text,
      exam_review_id text,
      exam_input_hash text,
      exam_use_status text,
      context_evidence_status text,
      context_evidence jsonb,
      entry_row_sha256 text,
      source_entry_id text,
      source_entry_sha256 text,
      include_in_exam boolean,
      manual_review_flags jsonb
    )
  ) as entry
  join public.vocab_units as unit
    on unit.dataset_id = created_dataset_id
    and unit.normalized_label = lower(normalize(trim(entry.unit), NFKC))
  left join public.vocab_entries as vocab_entry
    on vocab_entry.dataset_id = created_dataset_id
    and vocab_entry.source_row = entry.source_row;

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_entry_count then
    raise exception 'exam_use_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  update word_index.app_exam_use_release
  set status = 'active',
      activated_at_utc = now()
  where release_id = created_release_id;

  return jsonb_build_object(
    'datasetId', created_dataset_id,
    'releaseId', created_release_id,
    'status', 'active',
    'idempotent', false,
    'occurrenceCount', v_entry_count,
    'includedCount', v_included_count,
    'dictionaryCount', v_dictionary_count
  );
end;
$$;

create function public.import_app_exam_use_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.import_app_exam_use_package_v1(p_package);
$$;

revoke all on function private.import_app_exam_use_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_app_exam_use_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function private.import_app_exam_use_package_v1(jsonb)
  to service_role;
grant execute on function public.import_app_exam_use_package_v1(jsonb)
  to service_role;

-- Regular assignment candidate loading gets a separate admin-only projection.
-- Mixed and wrong-answer assignment services continue to use the legacy UUID
-- eligibility tables until their own compatibility task is implemented.
create function public.list_active_exam_use_eligibility_v1(
  p_dataset_id uuid
)
returns table (
  vocab_entry_id bigint,
  quiz_mode text,
  canonical_lexeme_id uuid,
  canonical_dictionary_id text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
  select
    occurrence.vocab_entry_id,
    mode.quiz_mode,
    null::uuid,
    occurrence.dictionary_id
  from word_index.app_exam_use_release as release
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = release.release_id
   and occurrence.dataset_id = release.dataset_id
  cross join (
    values
      ('book_meaning_en_to_ko'::text),
      ('book_meaning_ko_to_en'::text)
  ) as mode(quiz_mode)
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
    and release.target_environment = 'preview'
    and release.exam_use_import_allowed
    and not release.common_dictionary_release_allowed
    and occurrence.include_in_exam
    and occurrence.exam_use_status = 'reviewed_for_preview'
  order by occurrence.vocab_entry_id, mode.quiz_mode;
end;
$$;

revoke all on function public.list_active_exam_use_eligibility_v1(uuid)
  from public, anon;
grant execute on function public.list_active_exam_use_eligibility_v1(uuid)
  to authenticated, service_role;

-- The browser only supplies stable row IDs, order, direction, and the four
-- candidate row IDs. Every visible string and every pronunciation snapshot is
-- rebuilt from the active projection inside this transaction.
create function private.create_assignment_with_exam_use_question_bank_v1(
  p_release_id uuid,
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_row word_index.app_exam_use_release%rowtype;
  dataset_row public.vocab_datasets%rowtype;
  created_assignment_id uuid;
  trusted_questions jsonb;
  plan_invalid boolean;
  expected_english_count integer;
  expected_korean_count integer;
  updated_question_count integer;
  calculated_bank_sha256 text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_release_id is null
    or p_dataset_id is null
    or p_question_count is null
    or p_question_count not between 4 and 500
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not between 0 and 100
    or p_unit_ids is null
    or cardinality(p_unit_ids) = 0
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
  then
    raise exception 'invalid_exam_use_question_settings'
      using errcode = '22023';
  end if;

  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_must_be_future'
      using errcode = '22023';
  end if;

  select *
  into release_row
  from word_index.app_exam_use_release as release
  where release.release_id = p_release_id
    and release.dataset_id = p_dataset_id
    and release.status = 'active'
    and release.target_environment = 'preview'
    and release.exam_use_import_allowed
    and not release.common_dictionary_release_allowed
  for share;
  if not found then
    raise exception 'active_exam_use_release_not_found'
      using errcode = '55000';
  end if;

  select *
  into dataset_row
  from public.vocab_datasets as dataset
  where dataset.id = p_dataset_id
    and dataset.status = 'ready'
    and dataset.is_active
    and dataset.dataset_key = release_row.dataset_key
    and dataset.metadata ->> 'projectionProfile' =
      'exam_scope_candidate_v1'
    and dataset.metadata ->> 'packageVersion' =
      release_row.package_version
  for share;
  if not found then
    raise exception 'exam_use_dataset_snapshot_mismatch'
      using errcode = '55000';
  end if;

  expected_english_count := round(
    p_question_count
      * (p_english_to_korean_ratio::numeric / 100)
  );
  expected_korean_count := p_question_count - expected_english_count;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'invalid_exam_use_question_plan'
      using errcode = '22023';
  end if;

  if (
    select
      count(*) <> p_question_count
      or count(distinct question.base_order_index) <> p_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> p_question_count
      or count(distinct question.vocab_entry_id) <> p_question_count
      or count(*) filter (
        where question.direction = 'english_to_korean'
      ) <> expected_english_count
      or count(*) filter (
        where question.direction = 'korean_to_english'
      ) <> expected_korean_count
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  ) then
    raise exception 'invalid_exam_use_question_plan'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    where question.vocab_entry_id is null
      or question.base_order_index is null
      or question.direction not in (
        'english_to_korean',
        'korean_to_english'
      )
      or question.choice_vocab_entry_ids is null
      or cardinality(question.choice_vocab_entry_ids) <> 4
      or (
        select count(distinct choice_entry_id)
        from unnest(question.choice_vocab_entry_ids)
          as choice(choice_entry_id)
      ) <> 4
      or (
        select count(*)
        from unnest(question.choice_vocab_entry_ids)
          as choice(choice_entry_id)
        where choice.choice_entry_id = question.vocab_entry_id
      ) <> 1
  ) into plan_invalid;
  if plan_invalid then
    raise exception 'invalid_exam_use_question_choices'
      using errcode = '22023';
  end if;

  -- Targets must be included occurrences in the active release and selected
  -- unit range. The same dictionary ID cannot appear twice in one exam.
  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = p_release_id
     and occurrence.dataset_id = p_dataset_id
     and occurrence.vocab_entry_id = question.vocab_entry_id
    where occurrence.vocab_entry_id is null
      or occurrence.unit_id <> all(p_unit_ids)
      or not occurrence.include_in_exam
      or occurrence.exam_use_status <> 'reviewed_for_preview'
      or occurrence.source_projection_row_sha256 is null
  ) then
    raise exception 'exam_use_question_not_eligible_for_direction'
      using errcode = '22023';
  end if;

  if (
    select count(distinct occurrence.dictionary_id)
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint
    )
    join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = p_release_id
     and occurrence.vocab_entry_id = question.vocab_entry_id
  ) <> p_question_count then
    raise exception 'duplicate_exam_use_dictionary_target'
      using errcode = '22023';
  end if;

  -- Choice membership, selected range, dictionary identity, and display text
  -- are all revalidated independently of the target row.
  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral unnest(question.choice_vocab_entry_ids)
      as selected_choice(vocab_entry_id)
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = p_release_id
     and occurrence.dataset_id = p_dataset_id
     and occurrence.vocab_entry_id = selected_choice.vocab_entry_id
    where occurrence.vocab_entry_id is null
      or occurrence.unit_id <> all(p_unit_ids)
      or not occurrence.include_in_exam
      or occurrence.exam_use_status <> 'reviewed_for_preview'
  ) then
    raise exception 'exam_use_choice_not_eligible_for_direction'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral (
      select
        count(*) as choice_count,
        count(distinct occurrence.dictionary_id)
          as distinct_dictionary_count,
        count(distinct lower(normalize(
          trim(case question.direction
            when 'english_to_korean'
              then entry.primary_meaning
            else entry.headword
          end),
          NFKC
        ))) as distinct_display_count,
        count(*) filter (
          where trim(case question.direction
            when 'english_to_korean'
              then entry.primary_meaning
            else entry.headword
          end) = ''
        ) as blank_display_count
      from unnest(question.choice_vocab_entry_ids)
        as selected_choice(vocab_entry_id)
      join public.vocab_entries as entry
        on entry.id = selected_choice.vocab_entry_id
       and entry.dataset_id = p_dataset_id
      join word_index.app_exam_use_occurrence as occurrence
        on occurrence.release_id = p_release_id
       and occurrence.vocab_entry_id = entry.id
    ) as choice_check
    where choice_check.choice_count <> 4
      or choice_check.distinct_dictionary_count <> 4
      or choice_check.distinct_display_count <> 4
      or choice_check.blank_display_count <> 0
  ) then
    raise exception 'exam_use_choice_values_not_distinct'
      using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'vocab_entry_id', question.vocab_entry_id,
      'base_order_index', question.base_order_index,
      'direction', question.direction,
      'prompt', case question.direction
        when 'english_to_korean' then target_entry.headword
        else target_entry.primary_meaning
      end,
      'choices', choice_values.choices,
      'correct_choice_index',
        array_position(
          question.choice_vocab_entry_ids,
          question.vocab_entry_id
        ) - 1
    )
    order by question.base_order_index
  )
  into trusted_questions
  from jsonb_to_recordset(p_questions) as question(
    vocab_entry_id bigint,
    base_order_index integer,
    direction text,
    choice_vocab_entry_ids bigint[]
  )
  join public.vocab_entries as target_entry
    on target_entry.id = question.vocab_entry_id
   and target_entry.dataset_id = p_dataset_id
  cross join lateral (
    select jsonb_agg(
      case question.direction
        when 'english_to_korean' then choice_entry.primary_meaning
        else choice_entry.headword
      end
      order by selected_choice.position
    ) as choices
    from unnest(question.choice_vocab_entry_ids)
      with ordinality
      as selected_choice(vocab_entry_id, position)
    join public.vocab_entries as choice_entry
      on choice_entry.id = selected_choice.vocab_entry_id
     and choice_entry.dataset_id = p_dataset_id
  ) as choice_values;

  if trusted_questions is null
    or jsonb_array_length(trusted_questions) <> p_question_count
  then
    raise exception 'exam_use_trusted_question_build_mismatch'
      using errcode = '21000';
  end if;

  created_assignment_id := private.create_assignment_with_question_bank(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_student_ids,
    trusted_questions
  );

  with question_plan as (
    select *
    from jsonb_to_recordset(p_questions) as plan(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  )
  update public.assignment_questions as question
  set dataset_id = p_dataset_id,
      entry_row_sha256_snapshot = entry.row_sha256,
      eligibility_quiz_mode = case question_plan.direction
        when 'english_to_korean' then 'book_meaning_en_to_ko'
        else 'book_meaning_ko_to_en'
      end,
      eligibility_input_hash_snapshot =
        upper(occurrence.source_projection_row_sha256),
      canonical_lexeme_id_snapshot = null,
      canonical_content_hash_snapshot =
        upper(occurrence.package_entry_content_hash),
      content_review_id_snapshot = null,
      headword_snapshot = entry.headword,
      headword_normalized_snapshot = entry.headword_normalized,
      primary_meaning_snapshot = entry.primary_meaning,
      choice_vocab_entry_ids = question_plan.choice_vocab_entry_ids,
      correct_answer_snapshot =
        question.choices ->> question.correct_choice_index,
      content_origin = 'book_occurrence',
      eligibility_rule_version_snapshot = 'exam-use-preview-v1',
      generator_version_snapshot = 'dictionary-exam-use-v1',
      question_content_sha256 = upper(encode(
        extensions.digest(
          convert_to(
            jsonb_build_array(
              p_release_id,
              release_row.package_version,
              p_dataset_id,
              entry.id,
              question.base_order_index,
              occurrence.dictionary_id,
              occurrence.occurrence_content_hash,
              case question_plan.direction
                when 'english_to_korean' then 'book_meaning_en_to_ko'
                else 'book_meaning_ko_to_en'
              end,
              question.direction,
              question.prompt,
              question.choices,
              question_plan.choice_vocab_entry_ids,
              question.correct_choice_index,
              question.choices ->> question.correct_choice_index,
              entry.row_sha256,
              'dictionary-exam-use-v1'
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )),
      provenance = jsonb_build_object(
        'projectionProfile', 'exam_scope_candidate_v1',
        'releaseId', p_release_id,
        'packageVersion', release_row.package_version,
        'candidateDictionaryVersion',
          release_row.candidate_dictionary_version,
        'manifestContentHash', release_row.manifest_content_hash,
        'examReviewLedgerSha256',
          release_row.exam_review_ledger_sha256,
        'dictionaryId', occurrence.dictionary_id,
        'occurrenceId', occurrence.occurrence_id,
        'sourceRow', occurrence.source_row,
        'unitId', occurrence.unit_id,
        'choiceVocabEntryIds',
          to_jsonb(question_plan.choice_vocab_entry_ids),
        'sidecar', 'assignment_question_exam_use_snapshot'
      )
  from question_plan
  join public.vocab_entries as entry
    on entry.id = question_plan.vocab_entry_id
   and entry.dataset_id = p_dataset_id
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = p_release_id
   and occurrence.vocab_entry_id = entry.id
  where question.assignment_id = created_assignment_id
    and question.base_order_index = question_plan.base_order_index
    and question.vocab_entry_id = entry.id;

  get diagnostics updated_question_count = row_count;
  if updated_question_count <> p_question_count then
    raise exception 'exam_use_question_snapshot_count_mismatch'
      using errcode = '21000';
  end if;

  with question_plan as (
    select
      plan.*,
      (
        select jsonb_agg(
          jsonb_build_object(
            'choiceIndex', selected_choice.position - 1,
            'vocabEntryId', choice_entry.id,
            'dictionaryId', choice_occurrence.dictionary_id,
            'senseId', choice_occurrence.sense_id,
            'pronunciationVariantId',
              choice_occurrence.pronunciation_variant_id,
            'displayHeadword', choice_occurrence.display_headword,
            'displayGlossKo', choice_occurrence.display_gloss_ko,
            'displayPronunciationKo',
              choice_occurrence.display_pronunciation_ko,
            'audioStatus', choice_occurrence.audio_status,
            'audioUrl', choice_occurrence.audio_url,
            'soundAudio', choice_occurrence.sound_audio,
            'rawResponseSha256', choice_occurrence.raw_response_sha256,
            'listeningEnabled', choice_occurrence.listening_enabled,
            'reviewStatus',
              choice_occurrence.display_pronunciation_review_status,
            'occurrenceContentHash',
              choice_occurrence.occurrence_content_hash
          )
          order by selected_choice.position
        )
        from unnest(plan.choice_vocab_entry_ids)
          with ordinality
          as selected_choice(vocab_entry_id, position)
        join public.vocab_entries as choice_entry
          on choice_entry.id = selected_choice.vocab_entry_id
         and choice_entry.dataset_id = p_dataset_id
        join word_index.app_exam_use_occurrence as choice_occurrence
          on choice_occurrence.release_id = p_release_id
         and choice_occurrence.vocab_entry_id = choice_entry.id
      ) as choice_snapshots
    from jsonb_to_recordset(p_questions) as plan(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  )
  insert into public.assignment_question_exam_use_snapshot (
    assignment_question_id,
    assignment_id,
    dataset_id,
    vocab_entry_id,
    release_id,
    dictionary_id,
    occurrence_id,
    sense_id,
    pronunciation_variant_id,
    exam_review_id,
    headword_snapshot,
    primary_meaning_snapshot,
    display_pronunciation_ko_snapshot,
    pronunciation_snapshot,
    choice_dictionary_snapshots,
    occurrence_content_hash,
    question_content_sha256,
    provenance_status
  )
  select
    question.id,
    created_assignment_id,
    p_dataset_id,
    entry.id,
    p_release_id,
    occurrence.dictionary_id,
    occurrence.occurrence_id,
    occurrence.sense_id,
    occurrence.pronunciation_variant_id,
    occurrence.exam_review_id,
    occurrence.display_headword,
    occurrence.display_gloss_ko,
    occurrence.display_pronunciation_ko,
    jsonb_build_object(
      'dictionaryId', occurrence.dictionary_id,
      'displayHeadword', occurrence.display_headword,
      'displayGlossKo', occurrence.display_gloss_ko,
      'displayPronunciationKo', occurrence.display_pronunciation_ko,
      'pronunciationVariantId', occurrence.pronunciation_variant_id,
      'audioStatus', occurrence.audio_status,
      'audioUrl', occurrence.audio_url,
      'soundAudio', occurrence.sound_audio,
      'rawResponseSha256', occurrence.raw_response_sha256,
      'listeningEnabled', occurrence.listening_enabled,
      'reviewStatus', occurrence.display_pronunciation_review_status
    ),
    question_plan.choice_snapshots,
    upper(occurrence.occurrence_content_hash),
    question.question_content_sha256,
    'reviewed_for_preview_v1'
  from question_plan
  join public.assignment_questions as question
    on question.assignment_id = created_assignment_id
   and question.base_order_index = question_plan.base_order_index
   and question.vocab_entry_id = question_plan.vocab_entry_id
  join public.vocab_entries as entry
    on entry.id = question_plan.vocab_entry_id
   and entry.dataset_id = p_dataset_id
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = p_release_id
   and occurrence.dataset_id = p_dataset_id
   and occurrence.vocab_entry_id = entry.id;

  get diagnostics updated_question_count = row_count;
  if updated_question_count <> p_question_count then
    raise exception 'exam_use_sidecar_snapshot_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from public.assignment_question_exam_use_snapshot as snapshot
    where snapshot.assignment_id = created_assignment_id
      and (
        snapshot.provenance_status <> 'reviewed_for_preview_v1'
        or jsonb_array_length(snapshot.choice_dictionary_snapshots) <> 4
        or (
          select count(distinct item.value ->> 'dictionaryId')
          from jsonb_array_elements(
            snapshot.choice_dictionary_snapshots
          ) as item(value)
        ) <> 4
      )
  ) then
    raise exception 'exam_use_sidecar_snapshot_invalid'
      using errcode = '21000';
  end if;

  insert into word_index.assignment_exam_use_release_snapshot (
    assignment_id,
    dataset_id,
    release_id,
    package_version,
    candidate_dictionary_version,
    manifest_content_hash,
    exam_review_ledger_sha256
  )
  values (
    created_assignment_id,
    p_dataset_id,
    p_release_id,
    release_row.package_version,
    release_row.candidate_dictionary_version,
    release_row.manifest_content_hash,
    release_row.exam_review_ledger_sha256
  );

  calculated_bank_sha256 := (
    select upper(encode(
      extensions.digest(
        convert_to(
          string_agg(
            question.question_content_sha256,
            '|' order by question.base_order_index
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ))
    from public.assignment_questions as question
    where question.assignment_id = created_assignment_id
  );
  if calculated_bank_sha256 is null then
    raise exception 'exam_use_question_bank_hash_missing'
      using errcode = '21000';
  end if;

  update public.assignments
  set dataset_source_sha256_snapshot = upper(dataset_row.source_sha256),
      canonical_snapshot_sha256_snapshot =
        upper(release_row.candidate_dictionary_version),
      link_package_snapshot_sha256 = upper(release_row.package_version),
      eligibility_rule_version_snapshot = 'exam-use-preview-v1',
      generator_version = 'dictionary-exam-use-v1',
      question_bank_sha256 = calculated_bank_sha256,
      available_until = p_available_until
  where id = created_assignment_id;

  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_elapsed_during_creation'
      using errcode = '22023';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.dictionary_exam_use_v1_preview_reviewed',
    (select auth.uid()),
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', p_release_id,
      'questionCount', p_question_count,
      'questionBankSha256', calculated_bank_sha256
    )
  );

  return created_assignment_id;
end;
$$;

revoke all on function private.create_assignment_with_exam_use_question_bank_v1(
  uuid, text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;

-- Version 5 is a compatibility dispatcher. Datasets that have never had an
-- exam-use release keep the proven v4 path; a dataset with an inactive release
-- fails closed instead of silently reverting to UUID content.
create function private.create_assignment_with_delivery_v5(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
  created_assignment_id uuid;
  locked_student_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  for share;

  if active_release_id is null then
    if exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    ) then
      raise exception 'exam_use_release_inactive'
        using errcode = '55000';
    end if;

    return private.create_assignment_with_delivery_v4(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_timing_mode,
      p_question_time_limit_seconds,
      p_questions
    );
  end if;

  if p_student_ids is null or cardinality(p_student_ids) <> 1 then
    raise exception 'exam_use_single_student_assignment_only'
      using errcode = '0A000';
  end if;

  if p_student_ids is null
    or cardinality(p_student_ids) < 1
    or cardinality(p_student_ids) <> (
      select count(distinct student_id)
      from unnest(p_student_ids) as input(student_id)
      where student_id is not null
    )
  then
    raise exception 'invalid_assignment_students'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active'
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(p_student_ids)
    and student.status = 'active';
  if locked_student_count <> cardinality(p_student_ids) then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v1(
    p_student_ids,
    p_dataset_id,
    p_questions
  );

  created_assignment_id :=
    private.create_assignment_with_exam_use_question_bank_v1(
      active_release_id,
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );

  perform private.configure_assignment_delivery_v1(
    created_assignment_id,
    p_timing_mode,
    p_question_time_limit_seconds
  );
  perform private.link_pending_review_targets_v1(
    created_assignment_id,
    p_student_ids
  );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.regular_v5_created',
    (select auth.uid()),
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'datasetId', p_dataset_id,
      'releaseId', active_release_id,
      'studentIds', to_jsonb(p_student_ids),
      'timingMode', p_timing_mode
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_assignment_with_delivery_v5(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_assignment_with_delivery_v5(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
$$;

revoke all on function private.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon;
grant execute on function public.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
