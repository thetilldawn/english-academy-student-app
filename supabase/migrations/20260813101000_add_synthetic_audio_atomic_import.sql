begin;

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
  v_expected_assets integer;
  v_expected_occurrences integer;
  v_asset_count integer;
  v_occurrence_count integer;
  v_inserted_count integer;
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

  if (
    select count(*)
    from jsonb_to_recordset(p_package -> 'items') as item(
      occurrence_ids jsonb
    )
    cross join lateral jsonb_array_elements_text(item.occurrence_ids)
  ) <> v_expected_occurrences then
    raise exception 'synthetic_audio_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  insert into public.vocab_synthetic_audio_assets (
    asset_id,
    dictionary_id,
    profile_id,
    dataset_key,
    source_exam_package_version,
    speech_text,
    occurrence_ids,
    occurrence_count,
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
    source_queue_item_sha256,
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
    v_dataset_key,
    v_package_version,
    item.speech_text,
    item.occurrence_ids,
    item.occurrence_count,
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
    item.source_queue_item_sha256,
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
    occurrence_ids jsonb,
    occurrence_count integer,
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
    source_queue_item_sha256 text,
    pronunciation_identity_type text,
    pronunciation_mode text,
    generation_status text,
    review_status text,
    canonical_pronunciation_unchanged boolean
  )
  on conflict (dictionary_id, profile_id) do update
  set asset_id = excluded.asset_id,
      source_exam_package_version = excluded.source_exam_package_version,
      speech_text = excluded.speech_text,
      occurrence_ids = excluded.occurrence_ids,
      occurrence_count = excluded.occurrence_count,
      request_sha256 = excluded.request_sha256,
      audio_sha256 = excluded.audio_sha256,
      byte_count = excluded.byte_count,
      storage_bucket = excluded.storage_bucket,
      storage_object_key = excluded.storage_object_key,
      source_queue_item_sha256 = excluded.source_queue_item_sha256,
      generation_status = excluded.generation_status,
      storage_verified = true,
      playback_enabled = true,
      updated_at_utc = now();

  get diagnostics v_inserted_count = row_count;
  if v_inserted_count <> v_expected_assets then
    raise exception 'synthetic_audio_import_count_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'datasetKey', v_dataset_key,
    'profileId', p_package ->> 'profile_id',
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
