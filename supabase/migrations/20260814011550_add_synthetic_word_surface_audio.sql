begin;

alter table public.vocab_synthetic_audio_assets
  drop constraint vocab_synthetic_audio_assets_dictionary_id_check,
  drop constraint vocab_synthetic_audio_assets_dictionary_id_profile_id_key,
  drop constraint vocab_synthetic_audio_assets_pronunciation_identity_type_check,
  drop constraint vocab_synthetic_audio_assets_pronunciation_mode_check;

drop index public.vocab_synthetic_audio_one_enabled_dictionary_idx;

alter table public.vocab_synthetic_audio_assets
  add column pronunciation_variant_id text,
  add column canonical_ipa text,
  add column google_tts_ipa text,
  add constraint vocab_synthetic_audio_assets_dictionary_id_check check (
    dictionary_id ~ '^(expression|word):[a-z0-9][a-z0-9._''’-]*$'
  ),
  add constraint vocab_synthetic_audio_assets_variant_id_check check (
    pronunciation_variant_id is null
    or pronunciation_variant_id ~ '^tts(word|occ):[a-z0-9][a-z0-9:._-]*$'
  ),
  add constraint vocab_synthetic_audio_assets_ipa_pair_check check (
    (canonical_ipa is null and google_tts_ipa is null)
    or (
      char_length(trim(canonical_ipa)) between 1 and 300
      and char_length(trim(google_tts_ipa)) between 1 and 300
      and canonical_ipa = trim(canonical_ipa)
      and google_tts_ipa = trim(google_tts_ipa)
    )
  ),
  add constraint vocab_synthetic_audio_assets_identity_mode_check check (
    (
      dictionary_id ~ '^expression:'
      and pronunciation_identity_type = 'dictionary_expression'
      and pronunciation_mode = 'provider_default_expression'
      and pronunciation_variant_id is null
      and canonical_ipa is null
      and google_tts_ipa is null
    )
    or (
      dictionary_id ~ '^word:'
      and pronunciation_identity_type in (
        'dictionary_word_surface',
        'occurrence_word_phrase'
      )
      and pronunciation_variant_id is not null
      and (
        (
          pronunciation_mode = 'provider_default_word_surface'
          and canonical_ipa is null
          and google_tts_ipa is null
        )
        or (
          pronunciation_mode = 'custom_ipa_word_surface'
          and canonical_ipa is not null
          and google_tts_ipa is not null
        )
      )
    )
  ),
  add constraint vocab_synthetic_audio_asset_surface_unique
    unique nulls not distinct (
      dictionary_id,
      speech_text,
      profile_id,
      pronunciation_variant_id
    );

create unique index vocab_synthetic_audio_one_enabled_surface_idx
  on public.vocab_synthetic_audio_assets(
    dictionary_id,
    speech_text,
    profile_id,
    pronunciation_variant_id
  )
  nulls not distinct
  where playback_enabled;

alter table public.vocab_synthetic_audio_bindings
  drop constraint vocab_synthetic_audio_bindings_dictionary_id_check;

alter table public.vocab_synthetic_audio_bindings
  add column release_id uuid,
  add column vocab_entry_id bigint,
  add constraint vocab_synthetic_audio_bindings_dictionary_id_check check (
    dictionary_id ~ '^(expression|word):[a-z0-9][a-z0-9._''’-]*$'
  );

create function private.resolve_vocab_synthetic_audio_binding_scope_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_release_id uuid;
  v_vocab_entry_id bigint;
begin
  select release.release_id, occurrence.vocab_entry_id
  into v_release_id, v_vocab_entry_id
  from word_index.app_exam_use_release as release
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = release.release_id
   and occurrence.occurrence_id = new.occurrence_id
   and occurrence.dictionary_id = new.dictionary_id
   and occurrence.include_in_exam
  join public.vocab_synthetic_audio_assets as asset
    on asset.asset_id = new.asset_id
   and asset.dictionary_id = new.dictionary_id
   and asset.profile_id = new.profile_id
   and asset.speech_text = occurrence.display_headword
  where release.dataset_key = new.dataset_key
    and release.package_version = new.source_exam_package_version
    and release.status = 'active';

  if v_release_id is null or v_vocab_entry_id is null then
    raise exception 'synthetic_audio_binding_scope_not_found'
      using errcode = '23503';
  end if;

  new.release_id := v_release_id;
  new.vocab_entry_id := v_vocab_entry_id;
  return new;
end;
$$;

create trigger resolve_vocab_synthetic_audio_binding_scope_v1
before insert or update on public.vocab_synthetic_audio_bindings
for each row execute function
  private.resolve_vocab_synthetic_audio_binding_scope_v1();

update public.vocab_synthetic_audio_bindings
set updated_at_utc = updated_at_utc;

alter table public.vocab_synthetic_audio_bindings
  alter column release_id set not null,
  alter column vocab_entry_id set not null,
  add constraint vocab_synthetic_audio_binding_release_fk
    foreign key (release_id)
    references word_index.app_exam_use_release(release_id)
    on delete restrict,
  add constraint vocab_synthetic_audio_binding_vocab_entry_fk
    foreign key (vocab_entry_id)
    references public.vocab_entries(id)
    on delete restrict,
  add constraint vocab_synthetic_audio_binding_release_vocab_entry_key
    unique (release_id, vocab_entry_id);

create index vocab_synthetic_audio_binding_vocab_entry_idx
  on public.vocab_synthetic_audio_bindings(vocab_entry_id, release_id);

create function private.import_vocab_synthetic_word_audio_package_v1(
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
  v_distinct_occurrence_count integer;
  v_asset_write_count integer;
  v_binding_write_count integer;
begin
  if jsonb_typeof(p_package) is distinct from 'object'
    or p_package ->> 'schema_version' is distinct from
      'google-chirp-synthetic-word-audio-batch-v1'
    or p_package ->> 'batch_id' is distinct from
      'g12-long-reading-2025-word-surfaces-v1'
    or p_package ->> 'status' is distinct from 'complete'
    or p_package ->> 'dataset_key' is distinct from
      'g12-long-reading-2025-exam-scope-v1'
    or p_package ->> 'profile_id' is distinct from
      'profile:75ca7f418d66e6ab'
    or p_package -> 'app_release_allowed' is distinct from 'true'::jsonb
    or p_package ->> 'release_scope' is distinct from
      'word_surface_synthetic_assistive_audio_only'
    or p_package -> 'canonical_pronunciation_approval_implied'
      is distinct from 'false'::jsonb
    or coalesce(p_package ->> 'source_exam_package_version', '') !~
      '^[0-9a-f]{64}$'
    or jsonb_typeof(p_package -> 'items') is distinct from 'array'
  then
    raise exception 'invalid_synthetic_word_audio_package'
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

  select count(distinct occurrence.occurrence_id)
  into v_distinct_occurrence_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    occurrence_ids jsonb
  )
  cross join lateral jsonb_array_elements_text(item.occurrence_ids)
    as occurrence(occurrence_id);

  if v_asset_count <> v_expected_assets
    or v_occurrence_count <> v_expected_occurrences
    or v_distinct_occurrence_count <> v_expected_occurrences
    or v_asset_count <> 28
    or v_occurrence_count <> 29
  then
    raise exception 'synthetic_word_audio_package_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      speech_text text,
      profile_id text,
      occurrence_count integer,
      occurrence_ids jsonb,
      pronunciation_variant_id text,
      pronunciation_identity_type text,
      pronunciation_mode text,
      canonical_ipa text,
      google_tts_ipa text
    )
    where item.dictionary_id !~ '^word:'
       or item.profile_id <> v_profile_id
       or jsonb_typeof(item.occurrence_ids) <> 'array'
       or jsonb_array_length(item.occurrence_ids) <> item.occurrence_count
       or item.pronunciation_variant_id is null
       or item.pronunciation_identity_type not in (
         'dictionary_word_surface',
         'occurrence_word_phrase'
       )
       or (
         item.pronunciation_identity_type = 'occurrence_word_phrase'
         and item.pronunciation_mode is distinct from
           'provider_default_word_surface'
       )
       or (
         item.pronunciation_mode = 'provider_default_word_surface'
         and (item.canonical_ipa is not null or item.google_tts_ipa is not null)
       )
       or (
         item.pronunciation_mode = 'custom_ipa_word_surface'
         and (item.canonical_ipa is null or item.google_tts_ipa is null)
       )
       or item.pronunciation_mode not in (
         'provider_default_word_surface',
         'custom_ipa_word_surface'
       )
  ) then
    raise exception 'synthetic_word_audio_item_contract_mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      speech_text text,
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
     and exam_occurrence.display_headword = item.speech_text
     and exam_occurrence.include_in_exam
     and not coalesce(exam_occurrence.listening_enabled, false)
     and exam_occurrence.audio_url is null
    where exam_occurrence.occurrence_id is null
  ) then
    raise exception 'synthetic_word_audio_occurrence_binding_mismatch'
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
      pronunciation_variant_id text,
      pronunciation_identity_type text,
      pronunciation_mode text,
      canonical_ipa text,
      google_tts_ipa text,
      review_status text,
      canonical_pronunciation_unchanged boolean
    )
    join public.vocab_synthetic_audio_assets as existing
      on existing.asset_id = item.asset_id
      or (
        existing.dictionary_id = item.dictionary_id
        and existing.speech_text = item.speech_text
        and existing.profile_id = item.profile_id
        and existing.pronunciation_variant_id is not distinct from
          item.pronunciation_variant_id
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
       or existing.pronunciation_variant_id is distinct from
          item.pronunciation_variant_id
       or existing.pronunciation_identity_type is distinct from
          item.pronunciation_identity_type
       or existing.pronunciation_mode is distinct from item.pronunciation_mode
       or existing.canonical_ipa is distinct from item.canonical_ipa
       or existing.google_tts_ipa is distinct from item.google_tts_ipa
       or existing.review_status is distinct from item.review_status
       or existing.canonical_pronunciation_unchanged is distinct from
          item.canonical_pronunciation_unchanged
  ) then
    raise exception 'synthetic_word_audio_asset_identity_mismatch'
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
    pronunciation_variant_id,
    pronunciation_identity_type,
    pronunciation_mode,
    canonical_ipa,
    google_tts_ipa,
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
    item.pronunciation_variant_id,
    item.pronunciation_identity_type,
    item.pronunciation_mode,
    item.canonical_ipa,
    item.google_tts_ipa,
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
    pronunciation_variant_id text,
    pronunciation_identity_type text,
    pronunciation_mode text,
    canonical_ipa text,
    google_tts_ipa text,
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
    raise exception 'synthetic_word_audio_import_count_mismatch'
      using errcode = '21000';
  end if;

  delete from public.vocab_synthetic_audio_bindings
  where dataset_key = v_dataset_key
    and source_exam_package_version = v_package_version
    and profile_id = v_profile_id
    and dictionary_id ~ '^word:';

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
    raise exception 'synthetic_word_audio_binding_import_count_mismatch'
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

create function public.import_vocab_synthetic_word_audio_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_vocab_synthetic_word_audio_package_v1(p_package);
$$;

revoke all on function
  private.resolve_vocab_synthetic_audio_binding_scope_v1()
  from public, anon, authenticated;
revoke all on function
  private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function
  private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;
grant execute on function
  public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
