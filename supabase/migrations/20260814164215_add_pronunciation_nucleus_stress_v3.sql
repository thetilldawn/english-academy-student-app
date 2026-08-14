begin;

-- Keep the previous releases readable while admitting the new, vowel-nucleus
-- stress generation as a separate immutable generation.
alter table public.vocab_pronunciation_identities_v2
  drop constraint vocab_pronunciation_identities_v2_identity_id_check,
  drop constraint vocab_pronunciation_identities_v2_display_source_check,
  drop constraint vocab_pronunciation_identities_v2_engine_version_check;

alter table public.vocab_pronunciation_identities_v2
  add constraint vocab_pronunciation_identities_v2_identity_id_check check (
    identity_id ~ '^pron:v[23]:[0-9a-f]{64}$'
  ),
  add constraint vocab_pronunciation_identities_v2_display_source_check check (
    display_source in (
      'user_approved_100_identity_v1',
      'deterministic_rule_v1',
      'user_approved_display_nucleus_projection_v2',
      'deterministic_nucleus_rule_v2'
    )
  ),
  add constraint vocab_pronunciation_identities_v2_engine_version_check check (
    engine_version in (
      'cmudict-arpabet-hangul-render-v1',
      'cmudict-arpabet-hangul-nucleus-render-v2'
    )
  ),
  add constraint vocab_pronunciation_identity_generation_v3 check (
    (
      identity_id ~ '^pron:v2:[0-9a-f]{64}$'
      and engine_version = 'cmudict-arpabet-hangul-render-v1'
      and display_source in (
        'user_approved_100_identity_v1',
        'deterministic_rule_v1'
      )
    )
    or (
      identity_id ~ '^pron:v3:[0-9a-f]{64}$'
      and engine_version = 'cmudict-arpabet-hangul-nucleus-render-v2'
      and display_source in (
        'user_approved_display_nucleus_projection_v2',
        'deterministic_nucleus_rule_v2'
      )
    )
  );

drop index public.vocab_pronunciation_identity_surface_variant_v2;
create unique index vocab_pronunciation_identity_surface_variant_v3
  on public.vocab_pronunciation_identities_v2(
    headword_normalized,
    pronunciation_variant_id,
    engine_version
  );

alter table public.vocab_pronunciation_releases_v2
  drop constraint vocab_pronunciation_releases_v2_engine_version_check;
alter table public.vocab_pronunciation_releases_v2
  add constraint vocab_pronunciation_releases_v2_engine_version_check check (
    engine_version in (
      'cmudict-arpabet-hangul-render-v1',
      'cmudict-arpabet-hangul-nucleus-render-v2'
    )
  );

alter table public.vocab_rule_derived_korean_pronunciations
  drop constraint vocab_rule_derived_korean_pronunciations_engine_version_check;
alter table public.vocab_rule_derived_korean_pronunciations
  add constraint vocab_rule_derived_korean_pronunciations_engine_version_check check (
    engine_version in (
      'cmudict-hangul-align-v2',
      'cmudict-hangul-nucleus-align-v3'
    )
  );

-- The user approved the anchor rule itself: highlight the Korean vowel nucleus,
-- not the whole English syllable approximation. Preserve spelling, audio ID,
-- source hash and approved status; revise only the three older segment spans.
do $$
declare
  v_row public.vocab_approved_korean_pronunciations%rowtype;
begin
  select * into v_row
  from public.vocab_approved_korean_pronunciations
  where dictionary_id = 'word:loss'
    and pronunciation_variant_id = 'mw:165d945bf54ea03b7ba5';
  if found then
    if v_row.display_pronunciation_ko <> '로스'
      or v_row.review_status <> 'approved'
      or v_row.source_content_sha256 <>
        '87370a3ae789f8704c4ec2e7eafb7c46840fac786ad7aad38dab1c0faa7a1091'
      or v_row.source_review_run_id <>
        'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
      or v_row.segments not in (
        '[{"text":"로스","stress":"primary"}]'::jsonb,
        '[{"text":"로","stress":"primary"},{"text":"스","stress":"none"}]'::jsonb
      )
    then
      raise exception 'approved_nucleus_anchor_conflict_loss'
        using errcode = '23505';
    end if;
    update public.vocab_approved_korean_pronunciations
    set segments =
          '[{"text":"로","stress":"primary"},{"text":"스","stress":"none"}]'::jsonb
    where dictionary_id = v_row.dictionary_id
      and pronunciation_variant_id = v_row.pronunciation_variant_id;
  end if;

  select * into v_row
  from public.vocab_approved_korean_pronunciations
  where dictionary_id = 'word:inspire'
    and pronunciation_variant_id = 'mw:817aa8db8ea99d67d2dc';
  if found then
    if v_row.display_pronunciation_ko <> '인스파이어'
      or v_row.review_status <> 'approved'
      or v_row.source_content_sha256 <>
        '6da6f25382229a29c557fd960184421838afebae68149abcf2bb4607e4760816'
      or v_row.source_review_run_id <>
        'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
      or v_row.segments not in (
        '[{"text":"인","stress":"none"},{"text":"스파이","stress":"primary"},{"text":"어","stress":"none"}]'::jsonb,
        '[{"text":"인스","stress":"none"},{"text":"파이","stress":"primary"},{"text":"어","stress":"none"}]'::jsonb
      )
    then
      raise exception 'approved_nucleus_anchor_conflict_inspire'
        using errcode = '23505';
    end if;
    update public.vocab_approved_korean_pronunciations
    set segments =
          '[{"text":"인스","stress":"none"},{"text":"파이","stress":"primary"},{"text":"어","stress":"none"}]'::jsonb
    where dictionary_id = v_row.dictionary_id
      and pronunciation_variant_id = v_row.pronunciation_variant_id;
  end if;

  select * into v_row
  from public.vocab_approved_korean_pronunciations
  where dictionary_id = 'expression:emerge-from-4925a141'
    and pronunciation_variant_id =
      'synthetic:210af750c6450691a7973aab3fa0139ec4675051d32937ab6ac8b92e14118123';
  if found then
    if v_row.display_pronunciation_ko <> '이머지 프럼'
      or v_row.review_status <> 'approved'
      or v_row.source_content_sha256 <>
        'a05c48a1d90ec577ba8f14529121d290730eb7ec5e73610155f85929b589fce0'
      or v_row.source_review_run_id <>
        'expr-stress-b-20260813+expr-stress-c-20260813'
      or v_row.segments not in (
        '[{"text":"이","stress":"none"},{"text":"머지","stress":"primary"},{"text":" 프럼","stress":"none"}]'::jsonb,
        '[{"text":"이","stress":"none"},{"text":"머","stress":"primary"},{"text":"지 프럼","stress":"none"}]'::jsonb
      )
    then
      raise exception 'approved_nucleus_anchor_conflict_emerge_from'
        using errcode = '23505';
    end if;
    update public.vocab_approved_korean_pronunciations
    set segments =
          '[{"text":"이","stress":"none"},{"text":"머","stress":"primary"},{"text":"지 프럼","stress":"none"}]'::jsonb
    where dictionary_id = v_row.dictionary_id
      and pronunciation_variant_id = v_row.pronunciation_variant_id;
  end if;
end;
$$;

alter table public.vocab_approved_korean_pronunciations
  add constraint vocab_approved_korean_pronunciation_nucleus_anchor_v2 check (
    (
      dictionary_id <> 'word:loss'
      or pronunciation_variant_id <> 'mw:165d945bf54ea03b7ba5'
      or segments =
        '[{"text":"로","stress":"primary"},{"text":"스","stress":"none"}]'::jsonb
    )
    and (
      dictionary_id <> 'word:inspire'
      or pronunciation_variant_id <> 'mw:817aa8db8ea99d67d2dc'
      or segments =
        '[{"text":"인스","stress":"none"},{"text":"파이","stress":"primary"},{"text":"어","stress":"none"}]'::jsonb
    )
    and (
      dictionary_id <> 'expression:emerge-from-4925a141'
      or pronunciation_variant_id <>
        'synthetic:210af750c6450691a7973aab3fa0139ec4675051d32937ab6ac8b92e14118123'
      or segments =
        '[{"text":"이","stress":"none"},{"text":"머","stress":"primary"},{"text":"지 프럼","stress":"none"}]'::jsonb
    )
  );

create function private.stage_vocab_pronunciation_release_v3(p_header jsonb)
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
    or p_header ->> 'schema_version' is distinct from
      'vocab-pronunciation-release-v2'
    or p_header ->> 'dataset_key' is distinct from
      'ability-voca-etymology-2025'
    or p_header ->> 'dataset_source_sha256' is distinct from
      '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133'
    or p_header ->> 'engine_version' is distinct from
      'cmudict-arpabet-hangul-nucleus-render-v2'
    or coalesce(p_header ->> 'release_id', '') !~
      '^voca-release:[0-9a-f]{64}$'
    or coalesce(p_header ->> 'package_version', '') !~ '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'source_plan_version', '') !~ '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'source_tts_manifest_sha256', '') !~
      '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'expected_entry_count', '') !~ '^[0-9]+$'
    or (p_header ->> 'expected_entry_count')::integer is distinct from 3001
    or coalesce(p_header ->> 'expected_identity_count', '') !~ '^[0-9]+$'
    or coalesce(p_header ->> 'expected_webster_binding_count', '') !~
      '^[0-9]+$'
    or coalesce(p_header ->> 'expected_tts_binding_count', '') !~ '^[0-9]+$'
    or coalesce(p_header ->> 'expected_tts_asset_count', '') !~ '^[0-9]+$'
  then
    raise exception 'invalid_vocab_pronunciation_release_header_v3'
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
        or existing.dataset_source_sha256 <>
          p_header ->> 'dataset_source_sha256'
        or existing.package_version <> p_header ->> 'package_version'
        or existing.source_plan_version <> p_header ->> 'source_plan_version'
        or existing.source_tts_manifest_sha256 <>
          p_header ->> 'source_tts_manifest_sha256'
        or existing.engine_version <> p_header ->> 'engine_version'
        or existing.expected_entry_count <>
          (p_header ->> 'expected_entry_count')::integer
        or existing.expected_identity_count <>
          (p_header ->> 'expected_identity_count')::integer
        or existing.expected_webster_binding_count <>
          (p_header ->> 'expected_webster_binding_count')::integer
        or existing.expected_tts_binding_count <>
          (p_header ->> 'expected_tts_binding_count')::integer
        or existing.expected_tts_asset_count <>
          (p_header ->> 'expected_tts_asset_count')::integer
      )
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v3'
      using errcode = '23505';
  end if;

  insert into public.vocab_pronunciation_releases_v2 (
    release_id, dataset_id, dataset_key, dataset_source_sha256,
    source_plan_version, source_tts_manifest_sha256, package_version,
    engine_version, status, expected_entry_count, expected_identity_count,
    expected_webster_binding_count, expected_tts_binding_count,
    expected_tts_asset_count
  ) values (
    v_release_id, v_dataset_id, p_header ->> 'dataset_key',
    p_header ->> 'dataset_source_sha256', p_header ->> 'source_plan_version',
    p_header ->> 'source_tts_manifest_sha256',
    p_header ->> 'package_version', p_header ->> 'engine_version', 'staged',
    (p_header ->> 'expected_entry_count')::integer,
    (p_header ->> 'expected_identity_count')::integer,
    (p_header ->> 'expected_webster_binding_count')::integer,
    (p_header ->> 'expected_tts_binding_count')::integer,
    (p_header ->> 'expected_tts_asset_count')::integer
  ) on conflict (release_id) do nothing;

  if not exists (
    select 1
    from public.vocab_pronunciation_releases_v2 as stored
    where stored.release_id = v_release_id
      and stored.dataset_id = v_dataset_id
      and stored.dataset_key = p_header ->> 'dataset_key'
      and stored.dataset_source_sha256 = p_header ->> 'dataset_source_sha256'
      and stored.source_plan_version = p_header ->> 'source_plan_version'
      and stored.source_tts_manifest_sha256 =
        p_header ->> 'source_tts_manifest_sha256'
      and stored.package_version = p_header ->> 'package_version'
      and stored.engine_version = p_header ->> 'engine_version'
      and stored.expected_entry_count =
        (p_header ->> 'expected_entry_count')::integer
      and stored.expected_identity_count =
        (p_header ->> 'expected_identity_count')::integer
      and stored.expected_webster_binding_count =
        (p_header ->> 'expected_webster_binding_count')::integer
      and stored.expected_tts_binding_count =
        (p_header ->> 'expected_tts_binding_count')::integer
      and stored.expected_tts_asset_count =
        (p_header ->> 'expected_tts_asset_count')::integer
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v3'
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

create function private.import_vocab_pronunciation_identity_batch_v3(
  p_release_id text,
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
  v_conflict_count integer;
begin
  if p_items is null or jsonb_typeof(p_items) is distinct from 'array' then
    raise exception 'invalid_vocab_pronunciation_identity_batch_v3'
      using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_items);
  if v_input_count < 1 or v_input_count > 250 then
    raise exception 'vocab_pronunciation_identity_batch_size_v3'
      using errcode = '22023';
  end if;
  select count(distinct item.identity_id)::integer
  into v_distinct_count
  from jsonb_to_recordset(p_items) as item(identity_id text);
  if v_distinct_count <> v_input_count then
    raise exception 'duplicate_vocab_pronunciation_identity_v3'
      using errcode = '21000';
  end if;
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
    and release.engine_version =
      'cmudict-arpabet-hangul-nucleus-render-v2'
  for key share;
  if not found then
    raise exception 'vocab_pronunciation_release_not_staged_v3'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_items) as item(
      identity_id text,
      engine_version text,
      display_source text
    )
    where item.identity_id !~ '^pron:v3:[0-9a-f]{64}$'
      or item.engine_version is distinct from
        'cmudict-arpabet-hangul-nucleus-render-v2'
      or item.display_source not in (
        'user_approved_display_nucleus_projection_v2',
        'deterministic_nucleus_rule_v2'
      )
  ) then
    raise exception 'vocab_pronunciation_identity_generation_mismatch_v3'
      using errcode = '22023';
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
    raise exception 'vocab_pronunciation_identity_content_conflict_v3'
      using errcode = '23505';
  end if;

  return jsonb_build_object('release_id', p_release_id, 'input_count', v_input_count);
end;
$$;

create function private.import_vocab_pronunciation_binding_batch_v3(
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
    raise exception 'invalid_vocab_pronunciation_binding_batch_v3'
      using errcode = '22023';
  end if;
  v_input_count := jsonb_array_length(p_items);
  if v_input_count < 1 or v_input_count > 400 then
    raise exception 'vocab_pronunciation_binding_batch_size_v3'
      using errcode = '22023';
  end if;
  select count(distinct item.source_row)::integer
  into v_distinct_count
  from jsonb_to_recordset(p_items) as item(source_row integer);
  if v_distinct_count <> v_input_count then
    raise exception 'duplicate_vocab_pronunciation_binding_v3'
      using errcode = '21000';
  end if;

  select release.dataset_id
  into strict v_dataset_id
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
    and release.engine_version =
      'cmudict-arpabet-hangul-nucleus-render-v2'
  for key share;

  with input as (
    select *
    from jsonb_to_recordset(p_items) as item(
      source_row integer, entry_row_sha256 text, headword text,
      headword_normalized text, identity_id text, lexical_pos text,
      is_entry_default boolean, is_pos_default boolean,
      selection_rank integer, selection_basis text,
      selection_confidence text, binding_content_sha256 text
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
    and identity.identity_id ~ '^pron:v3:[0-9a-f]{64}$'
    and identity.engine_version =
      'cmudict-arpabet-hangul-nucleus-render-v2'
    and identity.headword = input.headword
    and identity.headword_normalized = input.headword_normalized
    and identity.lexical_pos is not distinct from input.lexical_pos;
  if v_matched_count <> v_input_count then
    raise exception 'vocab_pronunciation_binding_scope_mismatch_v3'
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
    is_entry_default boolean, is_pos_default boolean,
    selection_rank integer, selection_basis text,
    selection_confidence text, binding_content_sha256 text
  )
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
    and entry.source_row = item.source_row
    and upper(entry.row_sha256) = item.entry_row_sha256
    and entry.headword = item.headword
    and entry.headword_normalized = item.headword_normalized
  join public.vocab_pronunciation_identities_v2 as identity
    on identity.identity_id = item.identity_id
    and identity.identity_id ~ '^pron:v3:[0-9a-f]{64}$'
    and identity.engine_version =
      'cmudict-arpabet-hangul-nucleus-render-v2'
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
    raise exception 'vocab_pronunciation_binding_content_conflict_v3'
      using errcode = '23505';
  end if;

  return jsonb_build_object('release_id', p_release_id, 'input_count', v_input_count);
end;
$$;

create function private.verify_vocab_pronunciation_release_v3(p_release_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_verification jsonb;
begin
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.engine_version =
      'cmudict-arpabet-hangul-nucleus-render-v2';
  if not found then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v3'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from public.vocab_entry_pronunciation_bindings_v2 as binding
    join public.vocab_pronunciation_identities_v2 as identity
      on identity.identity_id = binding.identity_id
    where binding.release_id = p_release_id
      and (
        identity.engine_version <>
          'cmudict-arpabet-hangul-nucleus-render-v2'
        or identity.identity_id !~ '^pron:v3:[0-9a-f]{64}$'
      )
  ) then
    raise exception 'vocab_pronunciation_release_mixed_generation_v3'
      using errcode = '21000';
  end if;

  v_verification := private.verify_vocab_pronunciation_release_v2(p_release_id);
  return v_verification || jsonb_build_object(
    'engine_version', 'cmudict-arpabet-hangul-nucleus-render-v2'
  );
end;
$$;

create function private.activate_vocab_pronunciation_release_v3(p_release_id text)
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
    and engine_version = 'cmudict-arpabet-hangul-nucleus-render-v2'
  for update;

  perform 1
  from public.vocab_datasets
  where id = v_dataset_id
  for update;

  v_verification := private.verify_vocab_pronunciation_release_v3(p_release_id);

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

create function private.import_rule_derived_korean_pronunciation_package_v2(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_key text;
  v_source_package_version text;
  v_item_count integer;
  v_occurrence_count integer;
  v_distinct_occurrence_count integer;
  v_target_count integer;
  v_existing_count integer;
  v_inserted_count integer := 0;
  v_updated_count integer;
  v_verified_count integer;
begin
  if p_package is null
    or jsonb_typeof(p_package) is distinct from 'object'
    or p_package ->> 'schema_version' is distinct from
      'rule-derived-korean-pronunciation-batch-v1'
    or p_package ->> 'package_id' is distinct from
      'g12-long-reading-2025-rule-derived-stress-v3'
    or p_package ->> 'dataset_key' is distinct from
      'g12-long-reading-2025-exam-scope-v1'
    or p_package ->> 'status' is distinct from 'complete'
    or p_package ->> 'target_environment' is distinct from 'staging'
    or p_package ->> 'derivation_method' is distinct from
      'cmudict_arpabet_to_hangul_nucleus_alignment'
    or p_package ->> 'engine_version' is distinct from
      'cmudict-hangul-nucleus-align-v3'
    or p_package ->> 'confidence_scope' is distinct from
      'hangul_alignment_only'
    or p_package ->> 'display_semantics' is distinct from
      'lexical_stress_not_tts_acoustic_prosody'
    or coalesce(p_package ->> 'source_exam_package_version', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_exam_package_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_cmudict_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_cmudict_commit', '') !~
      '^[0-9a-f]{40}$'
    or coalesce(p_package ->> 'source_corrections_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_expression_manifest_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_word_manifest_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_webster_repair_sha256', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'package_version', '') !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'identity_count', '') <> '582'
    or coalesce(p_package ->> 'expected_occurrence_count', '') <> '601'
    or coalesce(p_package ->> 'covered_occurrence_count', '') <> '601'
    or coalesce(p_package ->> 'held_occurrence_count', '') <> '0'
    or jsonb_typeof(p_package -> 'items') is distinct from 'array'
  then
    raise exception 'invalid_rule_derived_korean_pronunciation_package_v3'
      using errcode = '22023';
  end if;

  v_dataset_key := p_package ->> 'dataset_key';
  v_source_package_version := p_package ->> 'source_exam_package_version';

  select count(*) into v_item_count
  from jsonb_array_elements(p_package -> 'items');
  if v_item_count <> 582 then
    raise exception 'rule_derived_korean_pronunciation_item_count_mismatch_v3'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text, headword text, pronunciation_identity_type text,
      pronunciation_variant_id text, display_pronunciation_ko text,
      segments jsonb, derivation_status text, engine_version text,
      confidence text, confidence_scope text, stress_evidence text,
      alignment_cost numeric, alignment_margin numeric,
      source_audio_sha256 text, content_sha256 text, occurrence_ids jsonb,
      cmudict_sources jsonb, cmudict_stress_shape jsonb,
      raw_cmudict_stress_shape jsonb
    )
    where item.dictionary_id !~
        '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
      or char_length(trim(coalesce(item.headword, ''))) not between 1 and 160
      or item.pronunciation_identity_type not in (
        'webster_selected', 'webster_repair', 'synthetic_expression',
        'synthetic_word_surface'
      )
      or item.pronunciation_variant_id !~
        '^(mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$'
      or char_length(trim(coalesce(item.display_pronunciation_ko, '')))
        not between 1 and 160
      or item.derivation_status is distinct from 'rule_derived'
      or item.engine_version is distinct from
        'cmudict-hangul-nucleus-align-v3'
      or item.confidence not in ('high', 'medium', 'low')
      or item.confidence_scope is distinct from 'hangul_alignment_only'
      or item.stress_evidence not in (
        'selected_webster_lexical_stress',
        'cmudict_lexical_stress_phrase_rule',
        'cmudict_lexical_stress'
      )
      or item.alignment_cost is null
      or item.alignment_cost < 0
      or item.alignment_cost > 10
      or item.alignment_margin < 0
      or coalesce(item.source_audio_sha256, '') !~ '^[0-9a-f]{64}$'
      or coalesce(item.content_sha256, '') !~ '^[0-9a-f]{64}$'
      or jsonb_typeof(item.occurrence_ids) is distinct from 'array'
      or jsonb_array_length(item.occurrence_ids) < 1
      or jsonb_typeof(item.cmudict_sources) is distinct from 'array'
      or jsonb_array_length(item.cmudict_sources) < 1
      or jsonb_typeof(item.cmudict_stress_shape) is distinct from 'object'
      or jsonb_typeof(item.raw_cmudict_stress_shape) is distinct from 'object'
      or private.valid_rule_derived_korean_pronunciation_segments_v1(
        item.display_pronunciation_ko,
        item.segments
      ) is not true
  ) then
    raise exception 'invalid_rule_derived_korean_pronunciation_item_v3'
      using errcode = '22023';
  end if;

  if (
    select count(*)
    from (
      select distinct item.dictionary_id, item.pronunciation_variant_id
      from jsonb_to_recordset(p_package -> 'items') as item(
        dictionary_id text,
        pronunciation_variant_id text
      )
    ) as identity
  ) <> 582 then
    raise exception 'duplicate_rule_derived_korean_pronunciation_identity_v3'
      using errcode = '23505';
  end if;

  select count(*), count(distinct occurrence.value)
  into v_occurrence_count, v_distinct_occurrence_count
  from jsonb_to_recordset(p_package -> 'items') as item(occurrence_ids jsonb)
  cross join lateral jsonb_array_elements_text(item.occurrence_ids)
    as occurrence(value);
  if v_occurrence_count <> 601 or v_distinct_occurrence_count <> 601 then
    raise exception 'rule_derived_korean_pronunciation_occurrence_count_mismatch_v3'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text, headword text, pronunciation_variant_id text,
      source_audio_sha256 text, occurrence_ids jsonb
    )
    cross join lateral jsonb_array_elements_text(item.occurrence_ids)
      as item_occurrence(occurrence_id)
    left join word_index.app_exam_use_release as release
      on release.dataset_key = v_dataset_key
      and lower(release.package_version) = v_source_package_version
      and release.status = 'active'
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = release.release_id
      and occurrence.occurrence_id = item_occurrence.occurrence_id
      and occurrence.dictionary_id = item.dictionary_id
      and occurrence.display_headword = item.headword
      and occurrence.include_in_exam
    left join public.vocab_entry_pronunciations as repair
      on repair.vocab_entry_id = occurrence.vocab_entry_id
      and repair.provider = 'merriam_webster'
      and repair.status = 'raw_first_variant_unreviewed'
      and repair.review_status = 'raw_unreviewed'
      and repair.listening_enabled
      and repair.selected_variant_id ~ '^mw:[0-9a-f]{20}$'
      and repair.selected_audio_url ~
        '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
      and jsonb_typeof(repair.variants) = 'array'
      and exists (
        select 1
        from jsonb_to_recordset(repair.variants) as repair_variant(
          variant_id text, audio_url text
        )
        where repair_variant.variant_id = repair.selected_variant_id
          and repair_variant.audio_url = repair.selected_audio_url
      )
      and jsonb_typeof(repair.raw_provenance) = 'array'
      and jsonb_array_length(repair.raw_provenance) > 0
      and coalesce(
        repair.raw_provenance -> 0 ->> 'raw_response_sha256', ''
      ) ~ '^[0-9a-fA-F]{64}$'
    left join public.vocab_synthetic_audio_bindings as binding
      on binding.release_id = release.release_id
      and binding.vocab_entry_id = occurrence.vocab_entry_id
      and binding.dictionary_id = occurrence.dictionary_id
    left join public.vocab_synthetic_audio_assets as asset
      on asset.asset_id = binding.asset_id
      and asset.dictionary_id = occurrence.dictionary_id
      and asset.storage_verified
      and asset.playback_enabled
    where occurrence.occurrence_id is null
      or item.pronunciation_variant_id is distinct from case
        when occurrence.listening_enabled then occurrence.pronunciation_variant_id
        when repair.listening_enabled then repair.selected_variant_id
        else asset.asset_id
      end
      or item.source_audio_sha256 is distinct from case
        when occurrence.listening_enabled then lower(occurrence.raw_response_sha256)
        when repair.listening_enabled then lower(
          repair.raw_provenance -> 0 ->> 'raw_response_sha256'
        )
        else lower(asset.audio_sha256)
      end
  ) then
    raise exception 'rule_derived_korean_pronunciation_audio_identity_mismatch_v3'
      using errcode = '23503';
  end if;

  select count(*) into v_target_count
  from public.vocab_rule_derived_korean_pronunciations as existing
  where existing.dataset_key = v_dataset_key
    and existing.source_exam_package_version = v_source_package_version;

  if v_target_count not in (0, 582) then
    raise exception 'rule_derived_korean_pronunciation_partial_scope_v3'
      using errcode = '21000';
  end if;

  if v_target_count = 582 and not (
    (
      select count(*)
      from public.vocab_rule_derived_korean_pronunciations as existing
      where existing.dataset_key = v_dataset_key
        and existing.source_exam_package_version = v_source_package_version
        and existing.engine_version = 'cmudict-hangul-align-v2'
        and existing.package_version =
          'de916a6cc7979c8e455efbfd63874c74ab8e55015b5b75ad9ebb6986916dcd25'
    ) = 582
    or (
      select count(*)
      from public.vocab_rule_derived_korean_pronunciations as existing
      where existing.dataset_key = v_dataset_key
        and existing.source_exam_package_version = v_source_package_version
        and existing.engine_version = 'cmudict-hangul-nucleus-align-v3'
        and existing.package_version = p_package ->> 'package_version'
    ) = 582
  ) then
    raise exception 'rule_derived_korean_pronunciation_mixed_generation_v3'
      using errcode = '23505';
  end if;

  if v_target_count = 582 then
    select count(*) into v_existing_count
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text, headword text, pronunciation_identity_type text,
      pronunciation_variant_id text, display_pronunciation_ko text,
      derivation_status text, confidence_scope text, stress_evidence text,
      source_audio_sha256 text, occurrence_ids jsonb, correction_id text,
      cmudict_sources jsonb, cmudict_stress_shape jsonb,
      raw_cmudict_stress_shape jsonb, webster_mw_notation text,
      webster_cmu_primary_match boolean,
      selected_webster_stress_applied boolean
    )
    join public.vocab_rule_derived_korean_pronunciations as existing
      on existing.dictionary_id = item.dictionary_id
      and existing.pronunciation_variant_id = item.pronunciation_variant_id
      and existing.headword = item.headword
      and existing.pronunciation_identity_type = item.pronunciation_identity_type
      and existing.display_pronunciation_ko = item.display_pronunciation_ko
      and existing.derivation_status = item.derivation_status
      and existing.confidence_scope = item.confidence_scope
      and existing.stress_evidence = item.stress_evidence
      and existing.source_audio_sha256 = item.source_audio_sha256
      and existing.occurrence_ids = item.occurrence_ids
      and existing.correction_id is not distinct from item.correction_id
      and existing.derivation_metadata = jsonb_build_object(
        'cmudictSources', item.cmudict_sources,
        'cmudictStressShape', item.cmudict_stress_shape,
        'rawCmudictStressShape', item.raw_cmudict_stress_shape,
        'websterMwNotation', item.webster_mw_notation,
        'websterCmuPrimaryMatch', item.webster_cmu_primary_match,
        'selectedWebsterStressApplied', item.selected_webster_stress_applied
      )
      and existing.dataset_key = v_dataset_key
      and existing.source_exam_package_version = v_source_package_version
      and existing.source_exam_package_sha256 =
        p_package ->> 'source_exam_package_sha256'
      and existing.source_cmudict_sha256 = p_package ->> 'source_cmudict_sha256'
      and existing.source_cmudict_commit = p_package ->> 'source_cmudict_commit'
      and existing.source_corrections_sha256 =
        p_package ->> 'source_corrections_sha256'
      and existing.source_expression_manifest_sha256 =
        p_package ->> 'source_expression_manifest_sha256'
      and existing.source_word_manifest_sha256 =
        p_package ->> 'source_word_manifest_sha256'
      and existing.source_webster_repair_sha256 =
        p_package ->> 'source_webster_repair_sha256'
      and existing.display_enabled;

    if v_existing_count <> 582 then
      raise exception 'rule_derived_korean_pronunciation_stable_identity_conflict_v3'
        using errcode = '23505';
    end if;

    update public.vocab_rule_derived_korean_pronunciations as existing
    set segments = item.segments,
        engine_version = item.engine_version,
        confidence = item.confidence,
        alignment_cost = item.alignment_cost,
        alignment_margin = item.alignment_margin,
        content_sha256 = item.content_sha256,
        package_version = p_package ->> 'package_version',
        imported_at = now()
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text, pronunciation_variant_id text, segments jsonb,
      engine_version text, confidence text, alignment_cost numeric,
      alignment_margin numeric, content_sha256 text
    )
    where existing.dictionary_id = item.dictionary_id
      and existing.pronunciation_variant_id = item.pronunciation_variant_id
      and (
        existing.segments,
        existing.engine_version,
        existing.confidence,
        existing.alignment_cost,
        existing.alignment_margin,
        existing.content_sha256,
        existing.package_version
      ) is distinct from (
        item.segments,
        item.engine_version,
        item.confidence,
        item.alignment_cost,
        item.alignment_margin,
        item.content_sha256,
        p_package ->> 'package_version'
      );
    get diagnostics v_updated_count = row_count;
  else
    insert into public.vocab_rule_derived_korean_pronunciations (
      dictionary_id, pronunciation_variant_id, headword,
      pronunciation_identity_type, display_pronunciation_ko, segments,
      derivation_status, engine_version, confidence, confidence_scope,
      stress_evidence, alignment_cost, alignment_margin, source_audio_sha256,
      content_sha256, occurrence_ids, correction_id, derivation_metadata,
      dataset_key, source_exam_package_version, source_exam_package_sha256,
      source_cmudict_sha256, source_cmudict_commit,
      source_corrections_sha256, source_expression_manifest_sha256,
      source_word_manifest_sha256, source_webster_repair_sha256,
      package_version
    )
    select
      item.dictionary_id, item.pronunciation_variant_id, item.headword,
      item.pronunciation_identity_type, item.display_pronunciation_ko,
      item.segments, item.derivation_status, item.engine_version,
      item.confidence, item.confidence_scope, item.stress_evidence,
      item.alignment_cost, item.alignment_margin, item.source_audio_sha256,
      item.content_sha256, item.occurrence_ids, item.correction_id,
      jsonb_build_object(
        'cmudictSources', item.cmudict_sources,
        'cmudictStressShape', item.cmudict_stress_shape,
        'rawCmudictStressShape', item.raw_cmudict_stress_shape,
        'websterMwNotation', item.webster_mw_notation,
        'websterCmuPrimaryMatch', item.webster_cmu_primary_match,
        'selectedWebsterStressApplied', item.selected_webster_stress_applied
      ),
      v_dataset_key, v_source_package_version,
      p_package ->> 'source_exam_package_sha256',
      p_package ->> 'source_cmudict_sha256',
      p_package ->> 'source_cmudict_commit',
      p_package ->> 'source_corrections_sha256',
      p_package ->> 'source_expression_manifest_sha256',
      p_package ->> 'source_word_manifest_sha256',
      p_package ->> 'source_webster_repair_sha256',
      p_package ->> 'package_version'
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text, headword text, pronunciation_identity_type text,
      pronunciation_variant_id text, display_pronunciation_ko text,
      segments jsonb, derivation_status text, engine_version text,
      confidence text, confidence_scope text, stress_evidence text,
      alignment_cost numeric, alignment_margin numeric,
      source_audio_sha256 text, content_sha256 text, occurrence_ids jsonb,
      correction_id text, cmudict_sources jsonb, cmudict_stress_shape jsonb,
      raw_cmudict_stress_shape jsonb, webster_mw_notation text,
      webster_cmu_primary_match boolean,
      selected_webster_stress_applied boolean
    );
    get diagnostics v_inserted_count = row_count;
    v_updated_count := 0;
  end if;

  select count(*) into v_verified_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    dictionary_id text, headword text, pronunciation_identity_type text,
    pronunciation_variant_id text, display_pronunciation_ko text,
    segments jsonb, derivation_status text, engine_version text,
    confidence text, confidence_scope text, stress_evidence text,
    alignment_cost numeric, alignment_margin numeric,
    source_audio_sha256 text, content_sha256 text, occurrence_ids jsonb,
    correction_id text, cmudict_sources jsonb, cmudict_stress_shape jsonb,
    raw_cmudict_stress_shape jsonb, webster_mw_notation text,
    webster_cmu_primary_match boolean,
    selected_webster_stress_applied boolean
  )
  join public.vocab_rule_derived_korean_pronunciations as derived
    on derived.dictionary_id = item.dictionary_id
    and derived.pronunciation_variant_id = item.pronunciation_variant_id
    and derived.headword = item.headword
    and derived.pronunciation_identity_type = item.pronunciation_identity_type
    and derived.display_pronunciation_ko = item.display_pronunciation_ko
    and derived.segments = item.segments
    and derived.derivation_status = item.derivation_status
    and derived.engine_version = item.engine_version
    and derived.confidence = item.confidence
    and derived.confidence_scope = item.confidence_scope
    and derived.stress_evidence = item.stress_evidence
    and derived.alignment_cost = item.alignment_cost
    and derived.alignment_margin is not distinct from item.alignment_margin
    and derived.source_audio_sha256 = item.source_audio_sha256
    and derived.content_sha256 = item.content_sha256
    and derived.occurrence_ids = item.occurrence_ids
    and derived.correction_id is not distinct from item.correction_id
    and derived.derivation_metadata = jsonb_build_object(
      'cmudictSources', item.cmudict_sources,
      'cmudictStressShape', item.cmudict_stress_shape,
      'rawCmudictStressShape', item.raw_cmudict_stress_shape,
      'websterMwNotation', item.webster_mw_notation,
      'websterCmuPrimaryMatch', item.webster_cmu_primary_match,
      'selectedWebsterStressApplied', item.selected_webster_stress_applied
    )
    and derived.dataset_key = v_dataset_key
    and derived.source_exam_package_version = v_source_package_version
    and derived.source_exam_package_sha256 =
      p_package ->> 'source_exam_package_sha256'
    and derived.source_cmudict_sha256 = p_package ->> 'source_cmudict_sha256'
    and derived.source_cmudict_commit = p_package ->> 'source_cmudict_commit'
    and derived.source_corrections_sha256 =
      p_package ->> 'source_corrections_sha256'
    and derived.source_expression_manifest_sha256 =
      p_package ->> 'source_expression_manifest_sha256'
    and derived.source_word_manifest_sha256 =
      p_package ->> 'source_word_manifest_sha256'
    and derived.source_webster_repair_sha256 =
      p_package ->> 'source_webster_repair_sha256'
    and derived.package_version = p_package ->> 'package_version'
    and derived.display_enabled;

  if v_verified_count <> 582 then
    raise exception 'rule_derived_korean_pronunciation_import_count_mismatch_v3'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'packageId', p_package ->> 'package_id',
    'packageVersion', p_package ->> 'package_version',
    'identityCount', 582,
    'occurrenceCount', 601,
    'insertedCount', v_inserted_count,
    'updatedCount', v_updated_count,
    'verifiedCount', v_verified_count
  );
end;
$$;

create function public.stage_vocab_pronunciation_release_v3(p_header jsonb)
returns jsonb language sql security definer set search_path = ''
as $$ select private.stage_vocab_pronunciation_release_v3(p_header); $$;

create function public.import_vocab_pronunciation_identity_batch_v3(
  p_release_id text,
  p_items jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.import_vocab_pronunciation_identity_batch_v3(
    p_release_id,
    p_items
  );
$$;

create function public.import_vocab_pronunciation_binding_batch_v3(
  p_release_id text,
  p_items jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.import_vocab_pronunciation_binding_batch_v3(
    p_release_id,
    p_items
  );
$$;

create function public.verify_vocab_pronunciation_release_v3(p_release_id text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.verify_vocab_pronunciation_release_v3(p_release_id); $$;

create function public.activate_vocab_pronunciation_release_v3(p_release_id text)
returns jsonb language sql security definer set search_path = ''
as $$ select private.activate_vocab_pronunciation_release_v3(p_release_id); $$;

create function public.import_rule_derived_korean_pronunciation_package_v2(
  p_package jsonb
)
returns jsonb language sql security definer set search_path = ''
as $$
  select private.import_rule_derived_korean_pronunciation_package_v2(
    p_package
  );
$$;

revoke all on function private.stage_vocab_pronunciation_release_v3(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_vocab_pronunciation_identity_batch_v3(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_vocab_pronunciation_binding_batch_v3(text, jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.verify_vocab_pronunciation_release_v3(text)
  from public, anon, authenticated, service_role;
revoke all on function private.activate_vocab_pronunciation_release_v3(text)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated, service_role;

revoke all on function public.stage_vocab_pronunciation_release_v3(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_vocab_pronunciation_identity_batch_v3(text, jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_vocab_pronunciation_binding_batch_v3(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.verify_vocab_pronunciation_release_v3(text)
  from public, anon, authenticated;
revoke all on function public.activate_vocab_pronunciation_release_v3(text)
  from public, anon, authenticated;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;

grant execute on function public.stage_vocab_pronunciation_release_v3(jsonb)
  to service_role;
grant execute on function
  public.import_vocab_pronunciation_identity_batch_v3(text, jsonb)
  to service_role;
grant execute on function
  public.import_vocab_pronunciation_binding_batch_v3(text, jsonb)
  to service_role;
grant execute on function public.verify_vocab_pronunciation_release_v3(text)
  to service_role;
grant execute on function public.activate_vocab_pronunciation_release_v3(text)
  to service_role;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
