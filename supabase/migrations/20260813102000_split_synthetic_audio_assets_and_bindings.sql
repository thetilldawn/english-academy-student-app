begin;

drop function if exists public.import_vocab_synthetic_audio_package_v1(jsonb);
drop function if exists private.import_vocab_synthetic_audio_package_v1(jsonb);

create table public.vocab_synthetic_audio_bindings (
  dataset_key text not null check (
    char_length(trim(dataset_key)) between 3 and 200
  ),
  source_exam_package_version text not null check (
    source_exam_package_version ~ '^[0-9a-f]{64}$'
  ),
  occurrence_id text not null check (
    occurrence_id ~ '^occ:[a-z0-9][a-z0-9._-]*$'
  ),
  dictionary_id text not null check (
    dictionary_id ~ '^expression:[a-z0-9][a-z0-9._''’-]*$'
  ),
  profile_id text not null check (
    profile_id ~ '^profile:[0-9a-f]{16}$'
  ),
  asset_id text not null,
  source_queue_item_sha256 text not null check (
    source_queue_item_sha256 ~ '^[0-9a-f]{64}$'
  ),
  created_at_utc timestamptz not null default now(),
  updated_at_utc timestamptz not null default now(),
  primary key (
    dataset_key,
    source_exam_package_version,
    occurrence_id,
    profile_id
  ),
  unique (
    dataset_key,
    source_exam_package_version,
    dictionary_id,
    occurrence_id,
    profile_id
  )
);

alter table public.vocab_synthetic_audio_assets
  add constraint vocab_synthetic_audio_asset_identity_unique
  unique (asset_id, dictionary_id, profile_id);

insert into public.vocab_synthetic_audio_bindings (
  dataset_key,
  source_exam_package_version,
  occurrence_id,
  dictionary_id,
  profile_id,
  asset_id,
  source_queue_item_sha256,
  created_at_utc,
  updated_at_utc
)
select
  asset.dataset_key,
  asset.source_exam_package_version,
  occurrence.occurrence_id,
  asset.dictionary_id,
  asset.profile_id,
  asset.asset_id,
  asset.source_queue_item_sha256,
  asset.created_at_utc,
  asset.updated_at_utc
from public.vocab_synthetic_audio_assets as asset
cross join lateral jsonb_array_elements_text(asset.occurrence_ids)
  as occurrence(occurrence_id);

alter table public.vocab_synthetic_audio_bindings
  add constraint vocab_synthetic_audio_binding_asset_fk
  foreign key (asset_id, dictionary_id, profile_id)
  references public.vocab_synthetic_audio_assets (
    asset_id,
    dictionary_id,
    profile_id
  )
  on delete restrict;

alter table public.vocab_synthetic_audio_assets
  drop column dataset_key,
  drop column source_exam_package_version,
  drop column occurrence_ids,
  drop column occurrence_count,
  drop column source_queue_item_sha256;

alter table public.vocab_synthetic_audio_bindings enable row level security;

revoke all on table public.vocab_synthetic_audio_bindings
  from public, anon, authenticated;
grant select, insert, update, delete
  on table public.vocab_synthetic_audio_bindings
  to service_role;

create function private.import_vocab_synthetic_audio_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_key text;
  v_package_version text;
  v_profile_id text;
  v_expected_assets integer;
  v_expected_occurrences integer;
  v_asset_count integer;
  v_occurrence_count integer;
  v_asset_write_count integer;
  v_binding_write_count integer;
begin
  if jsonb_typeof(p_package) <> 'object'
    or p_package ->> 'schema_version' <> 'google-chirp-synthetic-audio-batch-v1'
    or p_package ->> 'status' <> 'complete'
    or p_package ->> 'profile_id' <> 'profile:5b6efb0ecc8f4702'
    or (p_package ->> 'app_release_allowed')::boolean is not true
    or p_package ->> 'release_scope' <>
      'expression_synthetic_assistive_audio_only'
    or (p_package ->> 'canonical_pronunciation_approval_implied')::boolean
      is not false
    or jsonb_typeof(p_package -> 'items') <> 'array'
  then
    raise exception 'invalid_synthetic_audio_package'
      using errcode = '22023';
  end if;

  v_dataset_key := p_package ->> 'dataset_key';
  v_package_version := p_package ->> 'source_exam_package_version';
  v_profile_id := p_package ->> 'profile_id';
  v_expected_assets := (p_package ->> 'expected_asset_count')::integer;
  v_expected_occurrences :=
    (p_package ->> 'expected_occurrence_count')::integer;

  select count(*), coalesce(sum(item.occurrence_count), 0)
  into v_asset_count, v_occurrence_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    occurrence_count integer
  );

  if v_asset_count <> v_expected_assets
    or v_occurrence_count <> v_expected_occurrences
    or v_asset_count < 1
  then
    raise exception 'synthetic_audio_package_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      occurrence_count integer,
      occurrence_ids jsonb
    )
    where jsonb_typeof(item.occurrence_ids) <> 'array'
       or jsonb_array_length(item.occurrence_ids) <> item.occurrence_count
  ) or (
    select count(*)
    from jsonb_to_recordset(p_package -> 'items') as item(
      occurrence_ids jsonb
    )
    cross join lateral jsonb_array_elements_text(item.occurrence_ids)
  ) <> v_expected_occurrences then
    raise exception 'synthetic_audio_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      occurrence_ids jsonb
    )
    cross join lateral jsonb_array_elements_text(item.occurrence_ids)
      as occurrence(occurrence_id)
    left join word_index.app_exam_use_release as release
      on release.dataset_key = v_dataset_key
     and release.package_version = v_package_version
     and release.status = 'active'
    left join word_index.app_exam_use_occurrence as exam_occurrence
      on exam_occurrence.release_id = release.release_id
     and exam_occurrence.occurrence_id = occurrence.occurrence_id
     and exam_occurrence.dictionary_id = item.dictionary_id
     and exam_occurrence.include_in_exam
    where item.dictionary_id !~ '^expression:'
       or exam_occurrence.occurrence_id is null
  ) then
    raise exception 'synthetic_audio_occurrence_binding_mismatch'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      asset_id text,
      dictionary_id text,
      profile_id text,
      speech_text text,
      provider text,
      model text,
      voice text,
      language_code text,
      audio_encoding text,
      speaking_rate numeric,
      volume_gain_db numeric,
      request_sha256 text,
      audio_sha256 text,
      byte_count integer,
      storage_bucket text,
      storage_object_key text,
      pronunciation_identity_type text,
      pronunciation_mode text,
      review_status text,
      canonical_pronunciation_unchanged boolean
    )
    join public.vocab_synthetic_audio_assets as existing
      on existing.asset_id = item.asset_id
      or (
        existing.dictionary_id = item.dictionary_id
        and existing.profile_id = item.profile_id
      )
    where existing.asset_id is distinct from item.asset_id
       or existing.dictionary_id is distinct from item.dictionary_id
       or existing.profile_id is distinct from item.profile_id
       or existing.speech_text is distinct from item.speech_text
       or existing.provider is distinct from item.provider
       or existing.model is distinct from item.model
       or existing.voice is distinct from item.voice
       or existing.language_code is distinct from item.language_code
       or existing.audio_encoding is distinct from item.audio_encoding
       or existing.speaking_rate is distinct from item.speaking_rate
       or existing.volume_gain_db is distinct from item.volume_gain_db
       or existing.request_sha256 is distinct from item.request_sha256
       or existing.audio_sha256 is distinct from item.audio_sha256
       or existing.byte_count is distinct from item.byte_count
       or existing.storage_bucket is distinct from item.storage_bucket
       or existing.storage_object_key is distinct from item.storage_object_key
       or existing.pronunciation_identity_type is distinct from
          item.pronunciation_identity_type
       or existing.pronunciation_mode is distinct from item.pronunciation_mode
       or existing.review_status is distinct from item.review_status
       or existing.canonical_pronunciation_unchanged is distinct from
          item.canonical_pronunciation_unchanged
  ) then
    raise exception 'synthetic_audio_asset_identity_mismatch'
      using errcode = '23505';
  end if;

  insert into public.vocab_synthetic_audio_assets (
    asset_id,
    dictionary_id,
    profile_id,
    speech_text,
    provider,
    model,
    voice,
    language_code,
    audio_encoding,
    speaking_rate,
    volume_gain_db,
    request_sha256,
    audio_sha256,
    byte_count,
    storage_bucket,
    storage_object_key,
    pronunciation_identity_type,
    pronunciation_mode,
    generation_status,
    review_status,
    canonical_pronunciation_unchanged,
    canonical_pronunciation_approval_implied,
    storage_verified,
    playback_enabled,
    updated_at_utc
  )
  select
    item.asset_id,
    item.dictionary_id,
    item.profile_id,
    item.speech_text,
    item.provider,
    item.model,
    item.voice,
    item.language_code,
    item.audio_encoding,
    item.speaking_rate,
    item.volume_gain_db,
    item.request_sha256,
    item.audio_sha256,
    item.byte_count,
    item.storage_bucket,
    item.storage_object_key,
    item.pronunciation_identity_type,
    item.pronunciation_mode,
    item.generation_status,
    item.review_status,
    item.canonical_pronunciation_unchanged,
    false,
    true,
    true,
    now()
  from jsonb_to_recordset(p_package -> 'items') as item(
    asset_id text,
    dictionary_id text,
    profile_id text,
    speech_text text,
    provider text,
    model text,
    voice text,
    language_code text,
    audio_encoding text,
    speaking_rate numeric,
    volume_gain_db numeric,
    request_sha256 text,
    audio_sha256 text,
    byte_count integer,
    storage_bucket text,
    storage_object_key text,
    pronunciation_identity_type text,
    pronunciation_mode text,
    generation_status text,
    review_status text,
    canonical_pronunciation_unchanged boolean
  )
  on conflict (asset_id) do update
  set generation_status = excluded.generation_status,
      storage_verified = true,
      playback_enabled = true,
      updated_at_utc = now();

  get diagnostics v_asset_write_count = row_count;
  if v_asset_write_count <> v_expected_assets then
    raise exception 'synthetic_audio_import_count_mismatch'
      using errcode = '21000';
  end if;

  delete from public.vocab_synthetic_audio_bindings
  where dataset_key = v_dataset_key
    and source_exam_package_version = v_package_version
    and profile_id = v_profile_id;

  insert into public.vocab_synthetic_audio_bindings (
    dataset_key,
    source_exam_package_version,
    occurrence_id,
    dictionary_id,
    profile_id,
    asset_id,
    source_queue_item_sha256,
    updated_at_utc
  )
  select
    v_dataset_key,
    v_package_version,
    occurrence.occurrence_id,
    item.dictionary_id,
    item.profile_id,
    item.asset_id,
    item.source_queue_item_sha256,
    now()
  from jsonb_to_recordset(p_package -> 'items') as item(
    asset_id text,
    dictionary_id text,
    profile_id text,
    occurrence_ids jsonb,
    source_queue_item_sha256 text
  )
  cross join lateral jsonb_array_elements_text(item.occurrence_ids)
    as occurrence(occurrence_id);

  get diagnostics v_binding_write_count = row_count;
  if v_binding_write_count <> v_expected_occurrences then
    raise exception 'synthetic_audio_binding_import_count_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'datasetKey', v_dataset_key,
    'packageVersion', v_package_version,
    'profileId', v_profile_id,
    'assetCount', v_asset_count,
    'occurrenceCount', v_occurrence_count
  );
end;
$$;

create function public.import_vocab_synthetic_audio_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_vocab_synthetic_audio_package_v1(p_package);
$$;

revoke all on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;
grant execute on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;

commit;
