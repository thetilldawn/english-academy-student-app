begin;

create function private.import_exam_webster_pronunciation_repair_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_key text;
  v_exam_package_version text;
  v_repair_package_version text;
  v_release_id uuid;
  v_entry_count integer;
  v_dictionary_count integer;
  v_occurrence_count integer;
  v_write_count integer;
  v_verified_count integer;
begin
  if jsonb_typeof(p_package) is distinct from 'object'
    or p_package ->> 'schema_version' is distinct from
      'exam-webster-same-pronunciation-repair-v1'
    or p_package ->> 'dataset_key' is distinct from
      'g12-long-reading-2025-exam-scope-v1'
    or p_package ->> 'provider' is distinct from 'merriam_webster'
    or p_package ->> 'decision_policy' is distinct from
      'cross_pos_reuse_only_when_standard_american_pronunciation_matches_v1'
    or p_package ->> 'status' is distinct from 'complete'
    or p_package -> 'app_release_allowed' is distinct from 'true'::jsonb
    or p_package ->> 'expected_dictionary_count' is distinct from '28'
    or p_package ->> 'expected_occurrence_count' is distinct from '29'
    or jsonb_typeof(p_package -> 'entries') is distinct from 'array'
    or coalesce(p_package ->> 'source_exam_package_version', '') !~
      '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'package_version', '') !~ '^[0-9A-F]{64}$'
  then
    raise exception 'invalid_exam_webster_pronunciation_repair_package'
      using errcode = '22023';
  end if;

  v_dataset_key := p_package ->> 'dataset_key';
  v_exam_package_version := p_package ->> 'source_exam_package_version';
  v_repair_package_version := p_package ->> 'package_version';

  select release.release_id
  into v_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_key = v_dataset_key
    and release.package_version = v_exam_package_version
    and release.status = 'active';

  if v_release_id is null then
    raise exception 'exam_webster_repair_active_release_not_found'
      using errcode = '23503';
  end if;

  select
    count(*),
    count(distinct input.dictionary_id),
    count(distinct input.occurrence_id)
  into v_entry_count, v_dictionary_count, v_occurrence_count
  from jsonb_to_recordset(p_package -> 'entries') as input(
    occurrence_id text,
    dictionary_id text
  );

  if v_entry_count <> 29
    or v_dictionary_count <> 28
    or v_occurrence_count <> 29
  then
    raise exception 'exam_webster_repair_count_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_package -> 'entries') as input(
      dictionary_id text
    )
    where input.dictionary_id = 'word:soil'
  ) <> 2 then
    raise exception 'exam_webster_repair_soil_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'entries') as input(
      occurrence_id text,
      dictionary_id text,
      source_row integer,
      entry_row_sha256 text,
      headword_normalized text,
      selected_variant_id text,
      selected_audio_url text,
      selected_sound_audio text,
      selected_pos text,
      selected_mw_notation text,
      variants jsonb,
      raw_provenance jsonb,
      content_sha256 text
    )
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = v_release_id
     and occurrence.occurrence_id = input.occurrence_id
     and occurrence.dictionary_id = input.dictionary_id
     and occurrence.source_row = input.source_row
     and occurrence.include_in_exam
    left join public.vocab_entries as entry
      on entry.id = occurrence.vocab_entry_id
     and entry.dataset_id = occurrence.dataset_id
     and entry.source_row = input.source_row
     and entry.row_sha256 = input.entry_row_sha256
     and entry.headword_normalized = input.headword_normalized
    where input.dictionary_id !~ '^word:'
       or input.entry_row_sha256 !~ '^[0-9A-F]{64}$'
       or input.content_sha256 !~ '^[0-9A-F]{64}$'
       or input.selected_audio_url !~
          '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
       or jsonb_typeof(input.variants) <> 'array'
       or jsonb_array_length(input.variants) < 1
       or jsonb_typeof(input.raw_provenance) <> 'array'
       or jsonb_array_length(input.raw_provenance) < 1
       or not private.vocab_pronunciation_selection_matches_v1(
         input.variants,
         input.selected_variant_id,
         input.selected_audio_url
       )
       or not exists (
         select 1
         from jsonb_to_recordset(input.variants) as variant(
           variant_id text,
           audio_url text,
           sound_audio text,
           pos text,
           mw_notation text
         )
         where variant.variant_id = input.selected_variant_id
           and variant.audio_url = input.selected_audio_url
           and variant.sound_audio = input.selected_sound_audio
           and variant.pos is not distinct from input.selected_pos
           and variant.mw_notation is not distinct from
             input.selected_mw_notation
       )
       or occurrence.occurrence_id is null
       or entry.id is null
  ) then
    raise exception 'exam_webster_repair_occurrence_binding_mismatch'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'entries') as input(
      occurrence_id text,
      source_row integer,
      entry_row_sha256 text,
      headword_normalized text,
      selected_variant_id text,
      selected_audio_url text,
      selected_sound_audio text,
      selected_pos text,
      selected_mw_notation text,
      variants jsonb,
      raw_provenance jsonb,
      content_sha256 text
    )
    join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = v_release_id
     and occurrence.occurrence_id = input.occurrence_id
    join public.vocab_entry_pronunciations as existing
      on existing.vocab_entry_id = occurrence.vocab_entry_id
    where existing.dataset_id is distinct from occurrence.dataset_id
       or existing.source_row is distinct from input.source_row
       or existing.entry_row_sha256 is distinct from input.entry_row_sha256
       or existing.headword_normalized is distinct from input.headword_normalized
       or existing.provider is distinct from 'merriam_webster'
       or existing.status is distinct from 'raw_first_variant_unreviewed'
       or existing.review_status is distinct from 'raw_unreviewed'
       or existing.needs_review is distinct from true
       or existing.listening_enabled is distinct from true
       or existing.selected_variant_id is distinct from input.selected_variant_id
       or existing.selected_audio_url is distinct from input.selected_audio_url
       or existing.selected_sound_audio is distinct from input.selected_sound_audio
       or existing.selected_pos is distinct from input.selected_pos
       or existing.selected_mw_notation is distinct from input.selected_mw_notation
       or existing.variants is distinct from input.variants
       or existing.raw_provenance is distinct from input.raw_provenance
       or existing.source_package_version is distinct from v_repair_package_version
       or existing.content_sha256 is distinct from input.content_sha256
  ) then
    raise exception 'exam_webster_repair_existing_row_conflict'
      using errcode = '23505';
  end if;

  insert into public.vocab_entry_pronunciations (
    vocab_entry_id,
    dataset_id,
    source_row,
    entry_row_sha256,
    headword_normalized,
    provider,
    status,
    review_status,
    needs_review,
    listening_enabled,
    selected_variant_id,
    selected_audio_url,
    selected_sound_audio,
    selected_pos,
    selected_mw_notation,
    variants,
    raw_provenance,
    source_package_version,
    content_sha256,
    imported_at
  )
  select
    occurrence.vocab_entry_id,
    occurrence.dataset_id,
    input.source_row,
    input.entry_row_sha256,
    input.headword_normalized,
    'merriam_webster',
    'raw_first_variant_unreviewed',
    'raw_unreviewed',
    true,
    true,
    input.selected_variant_id,
    input.selected_audio_url,
    input.selected_sound_audio,
    input.selected_pos,
    input.selected_mw_notation,
    input.variants,
    input.raw_provenance,
    v_repair_package_version,
    input.content_sha256,
    now()
  from jsonb_to_recordset(p_package -> 'entries') as input(
    occurrence_id text,
    source_row integer,
    entry_row_sha256 text,
    headword_normalized text,
    selected_variant_id text,
    selected_audio_url text,
    selected_sound_audio text,
    selected_pos text,
    selected_mw_notation text,
    variants jsonb,
    raw_provenance jsonb,
    content_sha256 text
  )
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = v_release_id
   and occurrence.occurrence_id = input.occurrence_id
  on conflict (vocab_entry_id) do update
  set imported_at = now();

  get diagnostics v_write_count = row_count;
  if v_write_count <> 29 then
    raise exception 'exam_webster_repair_write_count_mismatch'
      using errcode = '21000';
  end if;

  select count(*)
  into v_verified_count
  from jsonb_to_recordset(p_package -> 'entries') as input(
    occurrence_id text,
    selected_variant_id text,
    selected_audio_url text,
    content_sha256 text
  )
  join word_index.app_exam_use_occurrence as occurrence
    on occurrence.release_id = v_release_id
   and occurrence.occurrence_id = input.occurrence_id
  join public.vocab_entry_pronunciations as pronunciation
    on pronunciation.vocab_entry_id = occurrence.vocab_entry_id
   and pronunciation.selected_variant_id = input.selected_variant_id
   and pronunciation.selected_audio_url = input.selected_audio_url
   and pronunciation.content_sha256 = input.content_sha256
   and pronunciation.listening_enabled;

  if v_verified_count <> 29 then
    raise exception 'exam_webster_repair_readback_count_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'datasetKey', v_dataset_key,
    'sourceExamPackageVersion', v_exam_package_version,
    'repairPackageVersion', v_repair_package_version,
    'dictionaryCount', v_dictionary_count,
    'occurrenceCount', v_verified_count
  );
end;
$$;

create function public.import_exam_webster_pronunciation_repair_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_exam_webster_pronunciation_repair_v1(p_package);
$$;

revoke all on function
  private.import_exam_webster_pronunciation_repair_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_exam_webster_pronunciation_repair_v1(jsonb)
  from public, anon, authenticated;
grant execute on function
  private.import_exam_webster_pronunciation_repair_v1(jsonb)
  to service_role;
grant execute on function
  public.import_exam_webster_pronunciation_repair_v1(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
