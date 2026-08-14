begin;

-- The first importer only considered the immutable exam snapshot and synthetic
-- audio registries. The runtime also prefers a Webster repair in
-- vocab_entry_pronunciations before synthetic audio, so mirror that same final
-- audio order here: snapshot -> Webster repair -> synthetic.
create or replace function private.import_rule_derived_korean_pronunciation_package_v1(
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
  v_expected_identity_count integer;
  v_expected_occurrence_count integer;
  v_item_count integer;
  v_occurrence_count integer;
  v_distinct_occurrence_count integer;
  v_inserted_count integer;
  v_verified_count integer;
begin
  if p_package is null
    or jsonb_typeof(p_package) <> 'object'
    or p_package ->> 'schema_version' is distinct from
      'rule-derived-korean-pronunciation-batch-v1'
    or p_package ->> 'status' is distinct from 'complete'
    or p_package ->> 'target_environment' is distinct from 'staging'
    or p_package ->> 'derivation_method' is distinct from
      'cmudict_arpabet_to_hangul_dynamic_alignment'
    or p_package ->> 'engine_version' is distinct from
      'cmudict-hangul-align-v2'
    or p_package ->> 'confidence_scope' is distinct from
      'hangul_alignment_only'
    or p_package ->> 'display_semantics' is distinct from
      'lexical_stress_not_tts_acoustic_prosody'
    or char_length(trim(coalesce(p_package ->> 'package_id', '')))
      not between 3 and 160
    or char_length(trim(coalesce(p_package ->> 'dataset_key', '')))
      not between 3 and 200
    or coalesce(p_package ->> 'source_exam_package_version', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_exam_package_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_cmudict_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_cmudict_commit', '')
      !~ '^[0-9a-f]{40}$'
    or coalesce(p_package ->> 'source_corrections_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_expression_manifest_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_word_manifest_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'source_webster_repair_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'package_version', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'identity_count', '') !~ '^[1-9][0-9]*$'
    or coalesce(p_package ->> 'expected_occurrence_count', '')
      !~ '^[1-9][0-9]*$'
    or coalesce(p_package ->> 'covered_occurrence_count', '')
      !~ '^[1-9][0-9]*$'
    or coalesce(p_package ->> 'held_occurrence_count', '') !~ '^[0-9]+$'
    or jsonb_typeof(p_package -> 'items') is distinct from 'array'
  then
    raise exception 'invalid_rule_derived_korean_pronunciation_package'
      using errcode = '22023';
  end if;

  v_dataset_key := p_package ->> 'dataset_key';
  v_source_package_version := p_package ->> 'source_exam_package_version';
  v_expected_identity_count := (p_package ->> 'identity_count')::integer;
  v_expected_occurrence_count :=
    (p_package ->> 'expected_occurrence_count')::integer;

  if v_expected_identity_count > 1000
    or v_expected_occurrence_count > 2000
    or (p_package ->> 'covered_occurrence_count')::integer <>
      v_expected_occurrence_count
    or (p_package ->> 'held_occurrence_count')::integer <> 0
  then
    raise exception 'rule_derived_korean_pronunciation_coverage_mismatch'
      using errcode = '21000';
  end if;

  select count(*)
  into v_item_count
  from jsonb_array_elements(p_package -> 'items');

  if v_item_count <> v_expected_identity_count or v_item_count < 1 then
    raise exception 'rule_derived_korean_pronunciation_item_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      headword text,
      pronunciation_identity_type text,
      pronunciation_variant_id text,
      display_pronunciation_ko text,
      segments jsonb,
      derivation_status text,
      engine_version text,
      confidence text,
      confidence_scope text,
      stress_evidence text,
      alignment_cost numeric,
      alignment_margin numeric,
      source_audio_sha256 text,
      content_sha256 text,
      occurrence_ids jsonb,
      cmudict_sources jsonb,
      cmudict_stress_shape jsonb,
      raw_cmudict_stress_shape jsonb
    )
    where item.dictionary_id !~
        '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
       or char_length(trim(coalesce(item.headword, ''))) not between 1 and 160
       or item.pronunciation_identity_type not in (
         'webster_selected',
         'webster_repair',
         'synthetic_expression',
         'synthetic_word_surface'
       )
       or item.pronunciation_variant_id !~
         '^(mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$'
       or char_length(trim(coalesce(item.display_pronunciation_ko, '')))
         not between 1 and 160
       or item.derivation_status is distinct from 'rule_derived'
       or item.engine_version is distinct from p_package ->> 'engine_version'
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
    raise exception 'invalid_rule_derived_korean_pronunciation_item'
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
  ) <> v_expected_identity_count then
    raise exception 'duplicate_rule_derived_korean_pronunciation_identity'
      using errcode = '23505';
  end if;

  select count(*), count(distinct occurrence.value)
  into v_occurrence_count, v_distinct_occurrence_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    occurrence_ids jsonb
  )
  cross join lateral jsonb_array_elements_text(item.occurrence_ids)
    as occurrence(value);

  if v_occurrence_count <> v_expected_occurrence_count
    or v_distinct_occurrence_count <> v_expected_occurrence_count
  then
    raise exception 'rule_derived_korean_pronunciation_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      headword text,
      pronunciation_variant_id text,
      source_audio_sha256 text,
      occurrence_ids jsonb
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
         variant_id text,
         audio_url text
       )
       where repair_variant.variant_id = repair.selected_variant_id
         and repair_variant.audio_url = repair.selected_audio_url
     )
     and jsonb_typeof(repair.raw_provenance) = 'array'
     and jsonb_array_length(repair.raw_provenance) > 0
     and coalesce(
       repair.raw_provenance -> 0 ->> 'raw_response_sha256',
       ''
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
         when occurrence.listening_enabled
           then occurrence.pronunciation_variant_id
         when repair.listening_enabled
           then repair.selected_variant_id
         else asset.asset_id
       end
       or item.source_audio_sha256 is distinct from case
         when occurrence.listening_enabled
           then lower(occurrence.raw_response_sha256)
         when repair.listening_enabled
           then lower(
             repair.raw_provenance -> 0 ->> 'raw_response_sha256'
           )
         else lower(asset.audio_sha256)
       end
  ) then
    raise exception 'rule_derived_korean_pronunciation_audio_identity_mismatch'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      headword text,
      pronunciation_identity_type text,
      pronunciation_variant_id text,
      display_pronunciation_ko text,
      segments jsonb,
      derivation_status text,
      engine_version text,
      confidence text,
      confidence_scope text,
      stress_evidence text,
      alignment_cost numeric,
      alignment_margin numeric,
      source_audio_sha256 text,
      content_sha256 text,
      occurrence_ids jsonb,
      correction_id text
    )
    join public.vocab_rule_derived_korean_pronunciations as existing
      on existing.dictionary_id = item.dictionary_id
     and existing.pronunciation_variant_id = item.pronunciation_variant_id
    where existing.headword is distinct from item.headword
       or existing.pronunciation_identity_type is distinct from
         item.pronunciation_identity_type
       or existing.display_pronunciation_ko is distinct from
         item.display_pronunciation_ko
       or existing.segments is distinct from item.segments
       or existing.derivation_status is distinct from item.derivation_status
       or existing.engine_version is distinct from item.engine_version
       or existing.confidence is distinct from item.confidence
       or existing.confidence_scope is distinct from item.confidence_scope
       or existing.stress_evidence is distinct from item.stress_evidence
       or existing.alignment_cost is distinct from item.alignment_cost
       or existing.alignment_margin is distinct from item.alignment_margin
       or existing.source_audio_sha256 is distinct from item.source_audio_sha256
       or existing.content_sha256 is distinct from item.content_sha256
       or existing.occurrence_ids is distinct from item.occurrence_ids
       or existing.correction_id is distinct from item.correction_id
       or existing.dataset_key is distinct from v_dataset_key
       or existing.source_exam_package_version is distinct from
         v_source_package_version
       or existing.source_exam_package_sha256 is distinct from
         p_package ->> 'source_exam_package_sha256'
       or existing.source_cmudict_sha256 is distinct from
         p_package ->> 'source_cmudict_sha256'
       or existing.source_cmudict_commit is distinct from
         p_package ->> 'source_cmudict_commit'
       or existing.source_corrections_sha256 is distinct from
         p_package ->> 'source_corrections_sha256'
       or existing.source_expression_manifest_sha256 is distinct from
         p_package ->> 'source_expression_manifest_sha256'
       or existing.source_word_manifest_sha256 is distinct from
         p_package ->> 'source_word_manifest_sha256'
       or existing.source_webster_repair_sha256 is distinct from
         p_package ->> 'source_webster_repair_sha256'
       or existing.package_version is distinct from
         p_package ->> 'package_version'
  ) then
    raise exception 'rule_derived_korean_pronunciation_identity_conflict'
      using errcode = '23505';
  end if;

  insert into public.vocab_rule_derived_korean_pronunciations (
    dictionary_id,
    pronunciation_variant_id,
    headword,
    pronunciation_identity_type,
    display_pronunciation_ko,
    segments,
    derivation_status,
    engine_version,
    confidence,
    confidence_scope,
    stress_evidence,
    alignment_cost,
    alignment_margin,
    source_audio_sha256,
    content_sha256,
    occurrence_ids,
    correction_id,
    derivation_metadata,
    dataset_key,
    source_exam_package_version,
    source_exam_package_sha256,
    source_cmudict_sha256,
    source_cmudict_commit,
    source_corrections_sha256,
    source_expression_manifest_sha256,
    source_word_manifest_sha256,
    source_webster_repair_sha256,
    package_version
  )
  select
    item.dictionary_id,
    item.pronunciation_variant_id,
    item.headword,
    item.pronunciation_identity_type,
    item.display_pronunciation_ko,
    item.segments,
    item.derivation_status,
    item.engine_version,
    item.confidence,
    item.confidence_scope,
    item.stress_evidence,
    item.alignment_cost,
    item.alignment_margin,
    item.source_audio_sha256,
    item.content_sha256,
    item.occurrence_ids,
    item.correction_id,
    jsonb_build_object(
      'cmudictSources', item.cmudict_sources,
      'cmudictStressShape', item.cmudict_stress_shape,
      'rawCmudictStressShape', item.raw_cmudict_stress_shape,
      'websterMwNotation', item.webster_mw_notation,
      'websterCmuPrimaryMatch', item.webster_cmu_primary_match,
      'selectedWebsterStressApplied',
        item.selected_webster_stress_applied
    ),
    v_dataset_key,
    v_source_package_version,
    p_package ->> 'source_exam_package_sha256',
    p_package ->> 'source_cmudict_sha256',
    p_package ->> 'source_cmudict_commit',
    p_package ->> 'source_corrections_sha256',
    p_package ->> 'source_expression_manifest_sha256',
    p_package ->> 'source_word_manifest_sha256',
    p_package ->> 'source_webster_repair_sha256',
    p_package ->> 'package_version'
  from jsonb_to_recordset(p_package -> 'items') as item(
    dictionary_id text,
    headword text,
    pronunciation_identity_type text,
    pronunciation_variant_id text,
    display_pronunciation_ko text,
    segments jsonb,
    derivation_status text,
    engine_version text,
    confidence text,
    confidence_scope text,
    stress_evidence text,
    alignment_cost numeric,
    alignment_margin numeric,
    source_audio_sha256 text,
    content_sha256 text,
    occurrence_ids jsonb,
    correction_id text,
    cmudict_sources jsonb,
    cmudict_stress_shape jsonb,
    raw_cmudict_stress_shape jsonb,
    webster_mw_notation text,
    webster_cmu_primary_match boolean,
    selected_webster_stress_applied boolean
  )
  on conflict (dictionary_id, pronunciation_variant_id) do nothing;

  get diagnostics v_inserted_count = row_count;

  select count(*)
  into v_verified_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    dictionary_id text,
    pronunciation_variant_id text,
    content_sha256 text
  )
  join public.vocab_rule_derived_korean_pronunciations as derived
    on derived.dictionary_id = item.dictionary_id
   and derived.pronunciation_variant_id = item.pronunciation_variant_id
   and derived.content_sha256 = item.content_sha256
   and derived.display_enabled;

  if v_verified_count <> v_expected_identity_count then
    raise exception 'rule_derived_korean_pronunciation_import_count_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'packageId', p_package ->> 'package_id',
    'packageVersion', p_package ->> 'package_version',
    'identityCount', v_expected_identity_count,
    'occurrenceCount', v_expected_occurrence_count,
    'insertedCount', v_inserted_count,
    'verifiedCount', v_verified_count
  );
end;
$$;

notify pgrst, 'reload schema';

commit;
