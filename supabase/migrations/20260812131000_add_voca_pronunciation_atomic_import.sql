begin;

grant execute on function private.vocab_pronunciation_selection_matches_v1(
  jsonb,
  text,
  text
) to service_role;

create function private.import_voca_pronunciation_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_package_version text;
  v_input_count integer;
  v_matched_count integer;
  v_playable_count integer;
  v_review_count integer;
begin
  if jsonb_typeof(p_package) <> 'object'
    or p_package ->> 'schema_version'
      <> 'ability-voca-webster-raw-audio-v1'
    or p_package ->> 'dataset_key'
      <> 'ability-voca-etymology-2025'
    or p_package ->> 'provider' <> 'merriam_webster'
    or p_package ->> 'selection_policy'
      <> 'first_exact_raw_variant_unreviewed_v1'
    or jsonb_typeof(p_package -> 'entries') <> 'array'
  then
    raise exception 'invalid_voca_pronunciation_package'
      using errcode = '22023';
  end if;

  v_package_version := p_package ->> 'package_version';
  if v_package_version !~ '^[0-9A-F]{64}$' then
    raise exception 'invalid_voca_pronunciation_package_version'
      using errcode = '22023';
  end if;

  select dataset.id
  into strict v_dataset_id
  from public.vocab_datasets as dataset
  where dataset.dataset_key = p_package ->> 'dataset_key';

  select count(*)::integer
  into v_input_count
  from jsonb_array_elements(p_package -> 'entries');
  if v_input_count <> 3001 then
    raise exception 'voca_pronunciation_row_count_mismatch'
      using errcode = '21000';
  end if;

  with input_rows as (
    select *
    from jsonb_to_recordset(p_package -> 'entries') as input(
      source_row integer,
      entry_row_sha256 text,
      headword text,
      normalized_headword text,
      status text,
      review_status text,
      needs_review boolean,
      listening_enabled boolean,
      selected_variant_id text,
      selected_audio_url text,
      selected_sound_audio text,
      selected_pos text,
      selected_mw_notation text,
      variants jsonb,
      raw_provenance jsonb,
      content_sha256 text
    )
  )
  select count(*)::integer
  into v_matched_count
  from input_rows as input
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
   and entry.source_row = input.source_row
   and upper(entry.row_sha256) = input.entry_row_sha256
   and entry.headword_normalized = input.normalized_headword;
  if v_matched_count <> v_input_count then
    raise exception 'voca_pronunciation_entry_binding_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(distinct input.source_row)
    from jsonb_to_recordset(p_package -> 'entries')
      as input(source_row integer)
  ) <> v_input_count then
    raise exception 'voca_pronunciation_duplicate_source_row'
      using errcode = '21000';
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
    entry.id,
    v_dataset_id,
    input.source_row,
    input.entry_row_sha256,
    input.normalized_headword,
    'merriam_webster',
    input.status,
    input.review_status,
    input.needs_review,
    input.listening_enabled,
    input.selected_variant_id,
    input.selected_audio_url,
    input.selected_sound_audio,
    input.selected_pos,
    input.selected_mw_notation,
    input.variants,
    input.raw_provenance,
    v_package_version,
    input.content_sha256,
    now()
  from jsonb_to_recordset(p_package -> 'entries') as input(
    source_row integer,
    entry_row_sha256 text,
    normalized_headword text,
    status text,
    review_status text,
    needs_review boolean,
    listening_enabled boolean,
    selected_variant_id text,
    selected_audio_url text,
    selected_sound_audio text,
    selected_pos text,
    selected_mw_notation text,
    variants jsonb,
    raw_provenance jsonb,
    content_sha256 text
  )
  join public.vocab_entries as entry
    on entry.dataset_id = v_dataset_id
   and entry.source_row = input.source_row
  on conflict (vocab_entry_id) do update set
    dataset_id = excluded.dataset_id,
    source_row = excluded.source_row,
    entry_row_sha256 = excluded.entry_row_sha256,
    headword_normalized = excluded.headword_normalized,
    provider = excluded.provider,
    status = excluded.status,
    review_status = excluded.review_status,
    needs_review = excluded.needs_review,
    listening_enabled = excluded.listening_enabled,
    selected_variant_id = excluded.selected_variant_id,
    selected_audio_url = excluded.selected_audio_url,
    selected_sound_audio = excluded.selected_sound_audio,
    selected_pos = excluded.selected_pos,
    selected_mw_notation = excluded.selected_mw_notation,
    variants = excluded.variants,
    raw_provenance = excluded.raw_provenance,
    source_package_version = excluded.source_package_version,
    content_sha256 = excluded.content_sha256,
    imported_at = excluded.imported_at;

  select
    count(*) filter (
      where pronunciation.status = 'raw_first_variant_unreviewed'
    )::integer,
    count(*) filter (where pronunciation.needs_review)::integer
  into v_playable_count, v_review_count
  from public.vocab_entry_pronunciations as pronunciation
  where pronunciation.dataset_id = v_dataset_id
    and pronunciation.source_package_version = v_package_version;

  if v_playable_count
      <> (p_package -> 'summary' ->> 'playable_rows')::integer
    or v_review_count
      <> (p_package -> 'summary' ->> 'needs_review_rows')::integer
  then
    raise exception 'voca_pronunciation_import_summary_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'dataset_id', v_dataset_id,
    'package_version', v_package_version,
    'total_rows', v_input_count,
    'playable_rows', v_playable_count,
    'needs_review_rows', v_review_count
  );
end;
$$;

create function public.import_voca_pronunciation_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_voca_pronunciation_package_v1(p_package);
$$;

revoke all on function private.import_voca_pronunciation_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_voca_pronunciation_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function private.import_voca_pronunciation_package_v1(jsonb)
  to service_role;
grant execute on function public.import_voca_pronunciation_package_v1(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
