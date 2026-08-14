begin;

create function private.valid_vocab_pronunciation_segments_v2(
  p_display text,
  p_segments jsonb
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case
    when p_display is null
      or char_length(p_display) not between 1 and 240
      or jsonb_typeof(p_segments) is distinct from 'array'
    then false
    else coalesce(
      jsonb_array_length(p_segments) between 1 and 32
      and (
        select string_agg(segment.value ->> 'text', '' order by segment.ordinality)
        from jsonb_array_elements(p_segments)
          with ordinality as segment(value, ordinality)
      ) = p_display
      and (
        select count(*)
        from jsonb_array_elements(p_segments) as segment(value)
        where segment.value ->> 'stress' = 'primary'
      ) = 1
      and not exists (
        select 1
        from jsonb_array_elements(p_segments) as segment(value)
        where jsonb_typeof(segment.value) is distinct from 'object'
          or jsonb_typeof(segment.value -> 'text') is distinct from 'string'
          or nullif(segment.value ->> 'text', '') is null
          or jsonb_typeof(segment.value -> 'stress') is distinct from 'string'
          or segment.value ->> 'stress' not in ('none', 'secondary', 'primary')
          or case
            when jsonb_typeof(segment.value) = 'object' then
              (select count(*) from jsonb_object_keys(segment.value)) <> 2
            else true
          end
      ),
      false
    )
  end;
$$;

create table public.vocab_pronunciation_tts_assets_v2 (
  request_sha256 text primary key check (request_sha256 ~ '^[0-9a-f]{64}$'),
  audio_sha256 text not null check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count >= 128),
  storage_bucket text not null check (
    storage_bucket = 'vocab-pronunciation-audio'
  ),
  storage_object_key text not null check (
    storage_object_key =
      'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/'
      || request_sha256 || '.mp3'
  ),
  profile_id text not null check (profile_id = 'profile:75ca7f418d66e6ab'),
  model text not null check (model = 'chirp3-hd'),
  voice text not null check (voice = 'en-US-Chirp3-HD-Despina'),
  storage_verified boolean not null check (storage_verified),
  verified_at timestamptz not null default now()
);

create table public.vocab_pronunciation_identities_v2 (
  identity_id text primary key check (
    identity_id ~ '^pron:v2:[0-9a-f]{64}$'
  ),
  headword text not null check (char_length(trim(headword)) between 1 and 160),
  headword_normalized text not null check (
    char_length(trim(headword_normalized)) between 1 and 160
  ),
  lexical_pos text,
  pronunciation_variant_id text not null check (
    pronunciation_variant_id ~ '^(mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$'
  ),
  audio_provider text not null check (
    audio_provider in ('merriam_webster', 'google_cloud_text_to_speech')
  ),
  official_audio_url text,
  sound_audio text,
  mw_notation text,
  storage_bucket text,
  storage_object_key text,
  audio_sha256 text check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer check (byte_count is null or byte_count >= 128),
  profile_id text,
  request_sha256 text references public.vocab_pronunciation_tts_assets_v2(
    request_sha256
  ) on delete restrict check (
    request_sha256 is null or request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  model text,
  voice text,
  display_pronunciation_ko text not null,
  segments jsonb not null,
  display_source text not null check (
    display_source in ('user_approved_100_identity_v1', 'deterministic_rule_v1')
  ),
  engine_version text not null check (
    engine_version = 'cmudict-arpabet-hangul-render-v1'
  ),
  stress_evidence text not null check (
    stress_evidence in ('selected_webster_lexical_stress', 'cmudict_lexical_stress')
  ),
  arpabet_phones jsonb not null check (
    jsonb_typeof(arpabet_phones) = 'array'
    and jsonb_array_length(arpabet_phones) > 0
  ),
  cmudict_sources jsonb not null check (jsonb_typeof(cmudict_sources) = 'array'),
  cmudict_stress_shape jsonb not null check (
    jsonb_typeof(cmudict_stress_shape) = 'object'
  ),
  playback_enabled boolean not null check (playback_enabled),
  display_enabled boolean not null check (display_enabled),
  approval_evidence jsonb not null check (jsonb_typeof(approval_evidence) = 'object'),
  identity_content_sha256 text not null check (
    identity_content_sha256 ~ '^[0-9A-F]{64}$'
  ),
  imported_at timestamptz not null default now(),
  constraint vocab_pronunciation_identity_segments_v2 check (
    private.valid_vocab_pronunciation_segments_v2(
      display_pronunciation_ko,
      segments
    )
  ),
  constraint vocab_pronunciation_identity_audio_v2 check (
    coalesce((
      audio_provider = 'merriam_webster'
      and pronunciation_variant_id ~ '^mw:[0-9a-f]{20}$'
      and official_audio_url is not null
      and official_audio_url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
      and sound_audio is not null
      and storage_bucket is null
      and storage_object_key is null
      and audio_sha256 is null
      and byte_count is null
      and profile_id is null
      and request_sha256 is null
      and model is null
      and voice is null
    )
    or (
      audio_provider = 'google_cloud_text_to_speech'
      and request_sha256 is not null
      and pronunciation_variant_id = 'synthetic:' || request_sha256
      and official_audio_url is null
      and sound_audio is null
      and mw_notation is null
      and storage_bucket is not null
      and storage_bucket = 'vocab-pronunciation-audio'
      and storage_object_key is not null
      and storage_object_key =
        'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/'
        || request_sha256 || '.mp3'
      and audio_sha256 is not null
      and byte_count is not null
      and profile_id is not null
      and profile_id = 'profile:75ca7f418d66e6ab'
      and model is not null
      and model = 'chirp3-hd'
      and voice is not null
      and voice = 'en-US-Chirp3-HD-Despina'
    )
    , false)
  )
);

create unique index vocab_pronunciation_identity_surface_variant_v2
  on public.vocab_pronunciation_identities_v2(
    headword_normalized,
    pronunciation_variant_id
  );

create table public.vocab_pronunciation_releases_v2 (
  release_id text primary key check (
    release_id ~ '^voca-release:[0-9a-f]{64}$'
  ),
  dataset_id uuid not null references public.vocab_datasets(id) on delete cascade,
  dataset_key text not null check (dataset_key = 'ability-voca-etymology-2025'),
  dataset_source_sha256 text not null check (
    dataset_source_sha256 ~ '^[0-9A-F]{64}$'
  ),
  source_plan_version text not null check (source_plan_version ~ '^[0-9A-F]{64}$'),
  source_tts_manifest_sha256 text not null check (
    source_tts_manifest_sha256 ~ '^[0-9A-F]{64}$'
  ),
  package_version text not null unique check (package_version ~ '^[0-9A-F]{64}$'),
  engine_version text not null check (
    engine_version = 'cmudict-arpabet-hangul-render-v1'
  ),
  status text not null check (status in ('staged', 'active', 'retired')),
  expected_entry_count integer not null check (expected_entry_count = 3001),
  expected_identity_count integer not null check (
    expected_identity_count between 1 and 3001
  ),
  expected_webster_binding_count integer not null check (
    expected_webster_binding_count between 0 and 3001
  ),
  expected_tts_binding_count integer not null check (
    expected_tts_binding_count between 0 and 3001
  ),
  expected_tts_asset_count integer not null check (
    expected_tts_asset_count between 0 and 3001
  ),
  imported_at timestamptz not null default now(),
  activated_at timestamptz,
  retired_at timestamptz,
  unique (release_id, dataset_id),
  constraint vocab_pronunciation_release_status_times_v2 check (
    (status = 'staged' and activated_at is null and retired_at is null)
    or (status = 'active' and activated_at is not null and retired_at is null)
    or (status = 'retired' and activated_at is not null and retired_at is not null)
  ),
  constraint vocab_pronunciation_release_id_matches_package_v2 check (
    release_id = 'voca-release:' || lower(package_version)
  )
);

create unique index vocab_pronunciation_one_active_release_v2
  on public.vocab_pronunciation_releases_v2(dataset_id)
  where status = 'active';

create table public.vocab_entry_pronunciation_bindings_v2 (
  release_id text not null references public.vocab_pronunciation_releases_v2(release_id)
    on delete cascade,
  vocab_entry_id bigint not null,
  dataset_id uuid not null,
  source_row integer not null check (source_row > 0),
  entry_row_sha256 text not null check (entry_row_sha256 ~ '^[0-9A-F]{64}$'),
  headword text not null check (char_length(trim(headword)) between 1 and 160),
  headword_normalized text not null check (
    char_length(trim(headword_normalized)) between 1 and 160
  ),
  identity_id text not null references public.vocab_pronunciation_identities_v2(identity_id),
  lexical_pos text,
  is_entry_default boolean not null,
  is_pos_default boolean not null,
  selection_rank integer not null check (selection_rank between 1 and 100),
  selection_basis text not null,
  selection_confidence text not null check (
    selection_confidence in ('approved', 'rule_selected')
  ),
  binding_content_sha256 text not null check (
    binding_content_sha256 ~ '^[0-9A-F]{64}$'
  ),
  imported_at timestamptz not null default now(),
  primary key (release_id, vocab_entry_id, identity_id),
  unique (release_id, source_row, identity_id),
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete cascade,
  foreign key (release_id, dataset_id)
    references public.vocab_pronunciation_releases_v2(release_id, dataset_id)
    on delete cascade
);

create unique index vocab_entry_pronunciation_one_default_v2
  on public.vocab_entry_pronunciation_bindings_v2(release_id, vocab_entry_id)
  where is_entry_default;

create unique index vocab_entry_pronunciation_one_pos_default_v2
  on public.vocab_entry_pronunciation_bindings_v2(
    release_id,
    vocab_entry_id,
    coalesce(lexical_pos, '')
  )
  where is_pos_default;

create index vocab_entry_pronunciation_runtime_v2
  on public.vocab_entry_pronunciation_bindings_v2(vocab_entry_id, release_id)
  where is_entry_default;

create index vocab_entry_pronunciation_identity_fk_v2
  on public.vocab_entry_pronunciation_bindings_v2(identity_id);

create index vocab_entry_pronunciation_entry_dataset_fk_v2
  on public.vocab_entry_pronunciation_bindings_v2(vocab_entry_id, dataset_id);

alter table public.vocab_pronunciation_tts_assets_v2 enable row level security;
alter table public.vocab_pronunciation_identities_v2 enable row level security;
alter table public.vocab_pronunciation_releases_v2 enable row level security;
alter table public.vocab_entry_pronunciation_bindings_v2 enable row level security;

revoke all on table public.vocab_pronunciation_tts_assets_v2
  from public, anon, authenticated;
revoke all on table public.vocab_pronunciation_tts_assets_v2 from service_role;
revoke all on table public.vocab_pronunciation_identities_v2
  from public, anon, authenticated;
revoke all on table public.vocab_pronunciation_identities_v2 from service_role;
revoke all on table public.vocab_pronunciation_releases_v2
  from public, anon, authenticated;
revoke all on table public.vocab_pronunciation_releases_v2 from service_role;
revoke all on table public.vocab_entry_pronunciation_bindings_v2
  from public, anon, authenticated;
revoke all on table public.vocab_entry_pronunciation_bindings_v2 from service_role;
grant select on table public.vocab_pronunciation_tts_assets_v2 to service_role;
grant select on table public.vocab_pronunciation_identities_v2 to service_role;
grant select on table public.vocab_pronunciation_releases_v2 to service_role;
grant select on table public.vocab_entry_pronunciation_bindings_v2 to service_role;

create function private.register_vocab_pronunciation_tts_asset_batch_v2(
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_input_count integer;
  v_distinct_count integer;
  v_bad_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_vocab_pronunciation_tts_asset_batch_v2'
      using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_items);
  if v_input_count < 1 or v_input_count > 200 then
    raise exception 'vocab_pronunciation_tts_asset_batch_size_v2'
      using errcode = '22023';
  end if;
  select count(distinct item.request_sha256)::integer
  into v_distinct_count
  from jsonb_to_recordset(p_items) as item(request_sha256 text);
  if v_distinct_count <> v_input_count then
    raise exception 'duplicate_vocab_pronunciation_tts_asset_v2'
      using errcode = '21000';
  end if;

  insert into public.vocab_pronunciation_tts_assets_v2 (
    request_sha256, audio_sha256, byte_count, storage_bucket,
    storage_object_key, profile_id, model, voice, storage_verified
  )
  select
    item.request_sha256, item.audio_sha256, item.byte_count,
    item.storage_bucket, item.storage_object_key, item.profile_id,
    item.model, item.voice, item.storage_verified
  from jsonb_to_recordset(p_items) as item(
    request_sha256 text, audio_sha256 text, byte_count integer,
    storage_bucket text, storage_object_key text, profile_id text,
    model text, voice text, storage_verified boolean
  )
  where true
  on conflict (request_sha256) do nothing;

  with input as (
    select element.value as payload
    from jsonb_array_elements(p_items) as element(value)
  )
  select count(*)::integer
  into v_bad_count
  from input
  left join public.vocab_pronunciation_tts_assets_v2 as existing
    on existing.request_sha256 = input.payload ->> 'request_sha256'
  where existing.request_sha256 is null
    or (to_jsonb(existing) - 'verified_at') is distinct from input.payload;
  if v_bad_count <> 0 then
    raise exception 'vocab_pronunciation_tts_asset_content_conflict_v2'
      using errcode = '23505';
  end if;

  return jsonb_build_object('input_count', v_input_count);
end;
$$;

create function private.stage_vocab_pronunciation_release_v2(p_header jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_release_id text;
begin
  if p_header is null
    or jsonb_typeof(p_header) is distinct from 'object'
    or p_header ->> 'schema_version' is distinct from 'vocab-pronunciation-release-v2'
    or p_header ->> 'dataset_key' is distinct from 'ability-voca-etymology-2025'
    or p_header ->> 'dataset_source_sha256'
      is distinct from '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133'
    or p_header ->> 'engine_version' is distinct from 'cmudict-arpabet-hangul-render-v1'
    or (p_header ->> 'expected_entry_count')::integer is distinct from 3001
  then
    raise exception 'invalid_vocab_pronunciation_release_header_v2'
      using errcode = '22023';
  end if;
  v_release_id := p_header ->> 'release_id';
  select dataset.id
  into strict v_dataset_id
  from public.vocab_datasets as dataset
  where dataset.dataset_key = p_header ->> 'dataset_key'
    and upper(dataset.source_sha256) = p_header ->> 'dataset_source_sha256'
    and dataset.row_count = 3001
    and (
      select count(*)
      from public.vocab_entries as entry
      where entry.dataset_id = dataset.id
    ) = 3001;

  if exists (
    select 1
    from public.vocab_pronunciation_releases_v2 as existing
    where existing.release_id = v_release_id
      and (
        existing.dataset_id <> v_dataset_id
        or existing.dataset_key <> p_header ->> 'dataset_key'
        or existing.dataset_source_sha256 <> p_header ->> 'dataset_source_sha256'
        or existing.package_version <> p_header ->> 'package_version'
        or existing.source_plan_version <> p_header ->> 'source_plan_version'
        or existing.source_tts_manifest_sha256
          <> p_header ->> 'source_tts_manifest_sha256'
        or existing.engine_version <> p_header ->> 'engine_version'
        or existing.expected_entry_count
          <> (p_header ->> 'expected_entry_count')::integer
        or existing.expected_identity_count
          <> (p_header ->> 'expected_identity_count')::integer
        or existing.expected_webster_binding_count
          <> (p_header ->> 'expected_webster_binding_count')::integer
        or existing.expected_tts_binding_count
          <> (p_header ->> 'expected_tts_binding_count')::integer
        or existing.expected_tts_asset_count
          <> (p_header ->> 'expected_tts_asset_count')::integer
      )
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v2'
      using errcode = '23505';
  end if;

  insert into public.vocab_pronunciation_releases_v2 (
    release_id,
    dataset_id,
    dataset_key,
    dataset_source_sha256,
    source_plan_version,
    source_tts_manifest_sha256,
    package_version,
    engine_version,
    status,
    expected_entry_count,
    expected_identity_count,
    expected_webster_binding_count,
    expected_tts_binding_count,
    expected_tts_asset_count
  ) values (
    v_release_id,
    v_dataset_id,
    p_header ->> 'dataset_key',
    p_header ->> 'dataset_source_sha256',
    p_header ->> 'source_plan_version',
    p_header ->> 'source_tts_manifest_sha256',
    p_header ->> 'package_version',
    p_header ->> 'engine_version',
    'staged',
    (p_header ->> 'expected_entry_count')::integer,
    (p_header ->> 'expected_identity_count')::integer,
    (p_header ->> 'expected_webster_binding_count')::integer,
    (p_header ->> 'expected_tts_binding_count')::integer,
    (p_header ->> 'expected_tts_asset_count')::integer
  )
  on conflict (release_id) do nothing;

  if not exists (
    select 1
    from public.vocab_pronunciation_releases_v2 as stored
    where stored.release_id = v_release_id
      and stored.dataset_id = v_dataset_id
      and stored.dataset_key = p_header ->> 'dataset_key'
      and stored.dataset_source_sha256 = p_header ->> 'dataset_source_sha256'
      and stored.source_plan_version = p_header ->> 'source_plan_version'
      and stored.source_tts_manifest_sha256 = p_header ->> 'source_tts_manifest_sha256'
      and stored.package_version = p_header ->> 'package_version'
      and stored.engine_version = p_header ->> 'engine_version'
      and stored.expected_entry_count = (p_header ->> 'expected_entry_count')::integer
      and stored.expected_identity_count = (p_header ->> 'expected_identity_count')::integer
      and stored.expected_webster_binding_count =
        (p_header ->> 'expected_webster_binding_count')::integer
      and stored.expected_tts_binding_count =
        (p_header ->> 'expected_tts_binding_count')::integer
      and stored.expected_tts_asset_count =
        (p_header ->> 'expected_tts_asset_count')::integer
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v2'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'release_id', v_release_id,
    'dataset_id', v_dataset_id,
    'status', (
      select release.status
      from public.vocab_pronunciation_releases_v2 as release
      where release.release_id = v_release_id
    )
  );
end;
$$;

create function private.import_vocab_pronunciation_identity_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_input_count integer;
  v_distinct_count integer;
  v_conflict_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_vocab_pronunciation_identity_batch_v2'
      using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_items);
  if v_input_count < 1 or v_input_count > 250 then
    raise exception 'vocab_pronunciation_identity_batch_size_v2'
      using errcode = '22023';
  end if;
  select count(distinct item.identity_id)::integer
  into v_distinct_count
  from jsonb_to_recordset(p_items) as item(identity_id text);
  if v_distinct_count <> v_input_count then
    raise exception 'duplicate_vocab_pronunciation_identity_v2'
      using errcode = '21000';
  end if;
  select release.dataset_id
  into v_dataset_id
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
  for key share;
  if not found then
    raise exception 'vocab_pronunciation_release_not_staged_v2'
      using errcode = '55000';
  end if;

  insert into public.vocab_pronunciation_identities_v2 (
    identity_id, headword, headword_normalized, lexical_pos,
    pronunciation_variant_id, audio_provider, official_audio_url,
    sound_audio, mw_notation, storage_bucket, storage_object_key,
    audio_sha256, byte_count, profile_id, request_sha256, model, voice,
    display_pronunciation_ko, segments, display_source, engine_version,
    stress_evidence, arpabet_phones, cmudict_sources, cmudict_stress_shape,
    playback_enabled, display_enabled, approval_evidence,
    identity_content_sha256
  )
  select
    item.identity_id, item.headword, item.headword_normalized, item.lexical_pos,
    item.pronunciation_variant_id, item.audio_provider, item.official_audio_url,
    item.sound_audio, item.mw_notation, item.storage_bucket,
    item.storage_object_key, item.audio_sha256, item.byte_count, item.profile_id,
    item.request_sha256, item.model, item.voice,
    item.display_pronunciation_ko, item.segments, item.display_source,
    item.engine_version, item.stress_evidence, item.arpabet_phones,
    item.cmudict_sources, item.cmudict_stress_shape, item.playback_enabled,
    item.display_enabled, item.approval_evidence,
    item.identity_content_sha256
  from jsonb_to_recordset(p_items) as item(
    identity_id text, headword text, headword_normalized text, lexical_pos text,
    pronunciation_variant_id text, audio_provider text, official_audio_url text,
    sound_audio text, mw_notation text, storage_bucket text,
    storage_object_key text, audio_sha256 text, byte_count integer,
    profile_id text, request_sha256 text, model text, voice text,
    display_pronunciation_ko text, segments jsonb, display_source text,
    engine_version text, stress_evidence text, arpabet_phones jsonb,
    cmudict_sources jsonb, cmudict_stress_shape jsonb,
    playback_enabled boolean, display_enabled boolean, approval_evidence jsonb,
    identity_content_sha256 text
  )
  where true
  on conflict (identity_id) do nothing;

  with input as (
    select element.value as payload
    from jsonb_array_elements(p_items) as element(value)
  )
  select count(*)::integer
  into v_conflict_count
  from input
  left join public.vocab_pronunciation_identities_v2 as existing
    on existing.identity_id = input.payload ->> 'identity_id'
  where existing.identity_id is null
    or (to_jsonb(existing) - 'imported_at') is distinct from input.payload;
  if v_conflict_count > 0 then
    raise exception 'vocab_pronunciation_identity_content_conflict_v2'
      using errcode = '23505';
  end if;

  return jsonb_build_object('release_id', p_release_id, 'input_count', v_input_count);
end;
$$;

create function private.import_vocab_pronunciation_binding_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_input_count integer;
  v_distinct_count integer;
  v_matched_count integer;
  v_conflict_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_vocab_pronunciation_binding_batch_v2'
      using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_items);
  if v_input_count < 1 or v_input_count > 400 then
    raise exception 'vocab_pronunciation_binding_batch_size_v2'
      using errcode = '22023';
  end if;
  select count(distinct item.source_row)::integer
  into v_distinct_count
  from jsonb_to_recordset(p_items) as item(source_row integer);
  if v_distinct_count <> v_input_count then
    raise exception 'duplicate_vocab_pronunciation_binding_v2'
      using errcode = '21000';
  end if;
  select release.dataset_id
  into strict v_dataset_id
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
  for key share;

  with input as (
    select *
    from jsonb_to_recordset(p_items) as item(
      source_row integer,
      entry_row_sha256 text,
      headword text,
      headword_normalized text,
      identity_id text,
      lexical_pos text,
      is_entry_default boolean,
      is_pos_default boolean,
      selection_rank integer,
      selection_basis text,
      selection_confidence text,
      binding_content_sha256 text
    )
  )
  select count(*)::integer
  into v_matched_count
  from input
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
   and entry.source_row = input.source_row
   and upper(entry.row_sha256) = input.entry_row_sha256
   and entry.headword = input.headword
   and entry.headword_normalized = input.headword_normalized
  join public.vocab_pronunciation_identities_v2 as identity
    on identity.identity_id = input.identity_id
   and identity.headword = input.headword
   and identity.headword_normalized = input.headword_normalized
   and identity.lexical_pos is not distinct from input.lexical_pos;
  if v_matched_count <> v_input_count then
    raise exception 'vocab_pronunciation_binding_scope_mismatch_v2'
      using errcode = '21000';
  end if;

  insert into public.vocab_entry_pronunciation_bindings_v2 (
    release_id, vocab_entry_id, dataset_id, source_row, entry_row_sha256,
    headword, headword_normalized, identity_id, lexical_pos,
    is_entry_default, is_pos_default, selection_rank, selection_basis,
    selection_confidence, binding_content_sha256
  )
  select
    p_release_id, entry.id, v_dataset_id, item.source_row,
    item.entry_row_sha256, item.headword, item.headword_normalized,
    item.identity_id, item.lexical_pos, item.is_entry_default,
    item.is_pos_default, item.selection_rank, item.selection_basis,
    item.selection_confidence, item.binding_content_sha256
  from jsonb_to_recordset(p_items) as item(
    source_row integer, entry_row_sha256 text, headword text,
    headword_normalized text, identity_id text, lexical_pos text,
    is_entry_default boolean, is_pos_default boolean, selection_rank integer,
    selection_basis text, selection_confidence text,
    binding_content_sha256 text
  )
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
   and entry.source_row = item.source_row
   and upper(entry.row_sha256) = item.entry_row_sha256
   and entry.headword = item.headword
   and entry.headword_normalized = item.headword_normalized
  join public.vocab_pronunciation_identities_v2 as identity
    on identity.identity_id = item.identity_id
   and identity.headword = item.headword
   and identity.headword_normalized = item.headword_normalized
   and identity.lexical_pos is not distinct from item.lexical_pos
  where true
  on conflict (release_id, vocab_entry_id, identity_id) do nothing;

  with input as (
    select element.value as payload
    from jsonb_array_elements(p_items) as element(value)
  )
  select count(*)::integer
  into v_conflict_count
  from input
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
   and entry.source_row = (input.payload ->> 'source_row')::integer
  left join public.vocab_entry_pronunciation_bindings_v2 as existing
    on existing.release_id = p_release_id
   and existing.vocab_entry_id = entry.id
   and existing.identity_id = input.payload ->> 'identity_id'
  where existing.release_id is null
    or (
      to_jsonb(existing)
        - 'release_id' - 'vocab_entry_id' - 'dataset_id' - 'imported_at'
    ) is distinct from input.payload;
  if v_conflict_count > 0 then
    raise exception 'vocab_pronunciation_binding_content_conflict_v2'
      using errcode = '23505';
  end if;

  return jsonb_build_object('release_id', p_release_id, 'input_count', v_input_count);
end;
$$;

create function private.verify_vocab_pronunciation_release_v2(p_release_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release public.vocab_pronunciation_releases_v2%rowtype;
  v_binding_count integer;
  v_identity_count integer;
  v_webster_count integer;
  v_tts_count integer;
  v_tts_assets integer;
  v_bad_count integer;
  v_dataset_entry_count integer;
  v_unbound_entry_count integer;
begin
  select * into strict v_release
  from public.vocab_pronunciation_releases_v2
  where release_id = p_release_id
  for key share;

  select count(*)::integer
  into v_dataset_entry_count
  from public.vocab_entries
  where dataset_id = v_release.dataset_id;

  select count(*)::integer
  into v_unbound_entry_count
  from public.vocab_entries as entry
  where entry.dataset_id = v_release.dataset_id
    and not exists (
      select 1
      from public.vocab_entry_pronunciation_bindings_v2 as binding
      where binding.release_id = p_release_id
        and binding.vocab_entry_id = entry.id
        and binding.is_entry_default
    );

  select
    count(*)::integer,
    count(distinct binding.identity_id)::integer,
    count(*) filter (where identity.audio_provider = 'merriam_webster')::integer,
    count(*) filter (where identity.audio_provider = 'google_cloud_text_to_speech')::integer,
    count(distinct identity.request_sha256) filter (
      where identity.audio_provider = 'google_cloud_text_to_speech'
    )::integer
  into v_binding_count, v_identity_count, v_webster_count, v_tts_count, v_tts_assets
  from public.vocab_entry_pronunciation_bindings_v2 as binding
  join public.vocab_pronunciation_identities_v2 as identity
    on identity.identity_id = binding.identity_id
  left join public.vocab_pronunciation_tts_assets_v2 as tts_asset
    on tts_asset.request_sha256 = identity.request_sha256
  where binding.release_id = p_release_id
    and binding.is_entry_default;

  select count(*)::integer into v_bad_count
  from public.vocab_entry_pronunciation_bindings_v2 as binding
  join public.vocab_entries as entry on entry.id = binding.vocab_entry_id
  join public.vocab_pronunciation_identities_v2 as identity
    on identity.identity_id = binding.identity_id
  left join public.vocab_pronunciation_tts_assets_v2 as tts_asset
    on tts_asset.request_sha256 = identity.request_sha256
  where binding.release_id = p_release_id
    and (
      binding.dataset_id <> v_release.dataset_id
      or entry.dataset_id <> v_release.dataset_id
      or entry.source_row <> binding.source_row
      or upper(entry.row_sha256) <> binding.entry_row_sha256
      or entry.headword <> binding.headword
      or entry.headword_normalized <> binding.headword_normalized
      or identity.headword <> binding.headword
      or identity.headword_normalized <> binding.headword_normalized
      or identity.lexical_pos is distinct from binding.lexical_pos
      or not binding.is_entry_default
      or not binding.is_pos_default
      or binding.selection_rank <> 1
      or not identity.playback_enabled
      or not identity.display_enabled
      or (
        identity.audio_provider = 'google_cloud_text_to_speech'
        and (
          tts_asset.request_sha256 is null
          or not tts_asset.storage_verified
          or tts_asset.audio_sha256 <> identity.audio_sha256
          or tts_asset.byte_count <> identity.byte_count
          or tts_asset.storage_bucket <> identity.storage_bucket
          or tts_asset.storage_object_key <> identity.storage_object_key
          or tts_asset.profile_id <> identity.profile_id
          or tts_asset.model <> identity.model
          or tts_asset.voice <> identity.voice
        )
      )
      or not private.valid_vocab_pronunciation_segments_v2(
        identity.display_pronunciation_ko,
        identity.segments
      )
    );

  if v_dataset_entry_count <> v_release.expected_entry_count
    or v_unbound_entry_count <> 0
    or v_binding_count <> v_release.expected_entry_count
    or v_identity_count <> v_release.expected_identity_count
    or v_webster_count <> v_release.expected_webster_binding_count
    or v_tts_count <> v_release.expected_tts_binding_count
    or v_tts_assets <> v_release.expected_tts_asset_count
    or v_bad_count <> 0
  then
    raise exception 'vocab_pronunciation_release_verification_failed_v2'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'release_id', p_release_id,
    'status', v_release.status,
    'binding_count', v_binding_count,
    'identity_count', v_identity_count,
    'webster_binding_count', v_webster_count,
    'tts_binding_count', v_tts_count,
    'tts_asset_count', v_tts_assets,
    'bad_count', v_bad_count,
    'dataset_entry_count', v_dataset_entry_count,
    'unbound_entry_count', v_unbound_entry_count
  );
end;
$$;

create function private.activate_vocab_pronunciation_release_v2(p_release_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_verification jsonb;
begin
  select dataset_id into strict v_dataset_id
  from public.vocab_pronunciation_releases_v2
  where release_id = p_release_id
  for update;

  perform 1
  from public.vocab_datasets
  where id = v_dataset_id
  for update;

  v_verification := private.verify_vocab_pronunciation_release_v2(p_release_id);

  update public.vocab_pronunciation_releases_v2
  set status = 'retired', retired_at = now()
  where dataset_id = v_dataset_id
    and status = 'active'
    and release_id <> p_release_id;

  update public.vocab_pronunciation_releases_v2
  set status = 'active',
      activated_at = coalesce(activated_at, now()),
      retired_at = null
  where release_id = p_release_id;

  return v_verification || jsonb_build_object('status', 'active');
end;
$$;

create function public.register_vocab_pronunciation_tts_asset_batch_v2(
  p_items jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$ select private.register_vocab_pronunciation_tts_asset_batch_v2(p_items); $$;

create function public.stage_vocab_pronunciation_release_v2(p_header jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.stage_vocab_pronunciation_release_v2(p_header); $$;

create function public.import_vocab_pronunciation_identity_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$ select private.import_vocab_pronunciation_identity_batch_v2(p_release_id, p_items); $$;

create function public.import_vocab_pronunciation_binding_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$ select private.import_vocab_pronunciation_binding_batch_v2(p_release_id, p_items); $$;

create function public.verify_vocab_pronunciation_release_v2(p_release_id text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.verify_vocab_pronunciation_release_v2(p_release_id); $$;

create function public.activate_vocab_pronunciation_release_v2(p_release_id text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.activate_vocab_pronunciation_release_v2(p_release_id); $$;

revoke all on function private.valid_vocab_pronunciation_segments_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function private.valid_vocab_pronunciation_segments_v2(text, jsonb)
  from service_role;
revoke all on function private.register_vocab_pronunciation_tts_asset_batch_v2(jsonb)
  from public, anon, authenticated;
revoke all on function private.register_vocab_pronunciation_tts_asset_batch_v2(jsonb)
  from service_role;
revoke all on function private.stage_vocab_pronunciation_release_v2(jsonb)
  from public, anon, authenticated;
revoke all on function private.stage_vocab_pronunciation_release_v2(jsonb)
  from service_role;
revoke all on function private.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function private.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  from service_role;
revoke all on function private.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function private.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  from service_role;
revoke all on function private.verify_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;
revoke all on function private.verify_vocab_pronunciation_release_v2(text)
  from service_role;
revoke all on function private.activate_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;
revoke all on function private.activate_vocab_pronunciation_release_v2(text)
  from service_role;
revoke all on function public.stage_vocab_pronunciation_release_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.register_vocab_pronunciation_tts_asset_batch_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.verify_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;
revoke all on function public.activate_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;

grant execute on function public.register_vocab_pronunciation_tts_asset_batch_v2(jsonb)
  to service_role;
grant execute on function public.stage_vocab_pronunciation_release_v2(jsonb)
  to service_role;
grant execute on function public.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  to service_role;
grant execute on function public.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  to service_role;
grant execute on function public.verify_vocab_pronunciation_release_v2(text)
  to service_role;
grant execute on function public.activate_vocab_pronunciation_release_v2(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
