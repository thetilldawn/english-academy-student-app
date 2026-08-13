begin;

create function private.import_approved_korean_pronunciation_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_expected_count integer;
  v_item_count integer;
  v_inserted_count integer;
  v_verified_count integer;
begin
  if p_package is null
    or jsonb_typeof(p_package) <> 'object'
    or p_package ->> 'schema_version' is distinct from
      'approved-korean-pronunciation-batch-v1'
    or p_package ->> 'status' is distinct from 'approved'
    or p_package ->> 'review_method' is distinct from
      'independent_double_review_exact_audio'
    or p_package ->> 'normalization_rule' is distinct from
      'korean_display_segment_v1'
    or p_package ->> 'source_audio_profile_id' is distinct from
      'profile:5b6efb0ecc8f4702'
    or char_length(trim(coalesce(p_package ->> 'package_id', '')))
      not between 3 and 160
    or coalesce(p_package ->> 'source_audio_manifest_sha256', '')
      !~ '^[0-9a-f]{64}$'
    or coalesce(p_package ->> 'expected_item_count', '') !~ '^[1-9][0-9]*$'
    or jsonb_typeof(p_package -> 'items') is distinct from 'array'
  then
    raise exception 'invalid_approved_korean_pronunciation_package'
      using errcode = '22023';
  end if;

  v_expected_count := (p_package ->> 'expected_item_count')::integer;
  if v_expected_count > 500 then
    raise exception 'approved_korean_pronunciation_package_too_large'
      using errcode = '54000';
  end if;
  select count(*)
  into v_item_count
  from jsonb_array_elements(p_package -> 'items');

  if v_item_count <> v_expected_count or v_item_count < 1 then
    raise exception 'approved_korean_pronunciation_package_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      pronunciation_identity_type text,
      pronunciation_variant_id text,
      display_pronunciation_ko text,
      segments jsonb,
      review_status text,
      source_content_sha256 text,
      source_review_run_ids jsonb,
      source_review_run_id text
    )
    where item.dictionary_id !~
        '^expression:[a-z0-9][a-z0-9._''’-]*$'
       or item.pronunciation_identity_type is distinct from 'synthetic_asset'
       or item.pronunciation_variant_id !~ '^synthetic:[0-9a-f]{64}$'
       or char_length(trim(coalesce(item.display_pronunciation_ko, '')))
          not between 1 and 160
       or item.review_status is distinct from 'approved'
       or coalesce(item.source_content_sha256, '') !~ '^[0-9a-f]{64}$'
       or char_length(trim(coalesce(item.source_review_run_id, '')))
          not between 3 and 200
       or private.valid_korean_pronunciation_segments_v1(
            item.display_pronunciation_ko,
            item.segments
          ) is not true
       or case
            when jsonb_typeof(item.source_review_run_ids) = 'array' then
              jsonb_array_length(item.source_review_run_ids) <> 2
              or (
                select count(distinct review.value) <> 2
                  or bool_or(
                    review.value !~
                      '^[A-Za-z0-9][A-Za-z0-9._:-]{0,79}$'
                  )
                from jsonb_array_elements_text(item.source_review_run_ids)
                  as review(value)
              )
              or item.source_review_run_id <> (
                select string_agg(review.value, '+' order by review.ordinality)
                from jsonb_array_elements_text(item.source_review_run_ids)
                  with ordinality as review(value, ordinality)
              )
            else true
          end
  ) then
    raise exception 'invalid_approved_korean_pronunciation_item'
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
    ) as unique_item
  ) <> v_expected_count then
    raise exception 'duplicate_approved_korean_pronunciation_identity'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      headword text,
      pronunciation_variant_id text,
      source_content_sha256 text
    )
    left join public.vocab_synthetic_audio_assets as asset
      on asset.asset_id = item.pronunciation_variant_id
     and asset.dictionary_id = item.dictionary_id
     and asset.profile_id = p_package ->> 'source_audio_profile_id'
    where asset.asset_id is null
       or asset.speech_text is distinct from item.headword
       or asset.audio_sha256 is distinct from item.source_content_sha256
       or asset.storage_verified is not true
       or asset.playback_enabled is not true
       or asset.canonical_pronunciation_approval_implied is not false
  ) then
    raise exception 'approved_korean_pronunciation_audio_identity_mismatch'
      using errcode = '23503';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_package -> 'items') as item(
      dictionary_id text,
      pronunciation_variant_id text,
      display_pronunciation_ko text,
      segments jsonb,
      source_content_sha256 text,
      source_review_run_id text
    )
    join public.vocab_approved_korean_pronunciations as existing
      on existing.dictionary_id = item.dictionary_id
     and existing.pronunciation_variant_id = item.pronunciation_variant_id
    where existing.display_pronunciation_ko is distinct from
          item.display_pronunciation_ko
       or existing.segments is distinct from item.segments
       or existing.review_status is distinct from 'approved'
       or existing.source_content_sha256 is distinct from
          item.source_content_sha256
       or existing.source_review_run_id is distinct from
          item.source_review_run_id
  ) then
    raise exception 'approved_korean_pronunciation_identity_mismatch'
      using errcode = '23505';
  end if;

  insert into public.vocab_approved_korean_pronunciations (
    dictionary_id,
    pronunciation_variant_id,
    display_pronunciation_ko,
    segments,
    review_status,
    source_content_sha256,
    source_review_run_id
  )
  select
    item.dictionary_id,
    item.pronunciation_variant_id,
    item.display_pronunciation_ko,
    item.segments,
    'approved',
    item.source_content_sha256,
    item.source_review_run_id
  from jsonb_to_recordset(p_package -> 'items') as item(
    dictionary_id text,
    pronunciation_variant_id text,
    display_pronunciation_ko text,
    segments jsonb,
    source_content_sha256 text,
    source_review_run_id text
  )
  on conflict (dictionary_id, pronunciation_variant_id) do nothing;

  get diagnostics v_inserted_count = row_count;

  select count(*)
  into v_verified_count
  from jsonb_to_recordset(p_package -> 'items') as item(
    dictionary_id text,
    pronunciation_variant_id text,
    display_pronunciation_ko text,
    segments jsonb,
    source_content_sha256 text,
    source_review_run_id text
  )
  join public.vocab_approved_korean_pronunciations as approved
    on approved.dictionary_id = item.dictionary_id
   and approved.pronunciation_variant_id = item.pronunciation_variant_id
   and approved.display_pronunciation_ko = item.display_pronunciation_ko
   and approved.segments = item.segments
   and approved.review_status = 'approved'
   and approved.source_content_sha256 = item.source_content_sha256
   and approved.source_review_run_id = item.source_review_run_id;

  if v_verified_count <> v_expected_count then
    raise exception 'approved_korean_pronunciation_import_count_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'ok',
    'packageId', p_package ->> 'package_id',
    'itemCount', v_expected_count,
    'insertedCount', v_inserted_count,
    'verifiedCount', v_verified_count
  );
end;
$$;

create function public.import_approved_korean_pronunciation_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_approved_korean_pronunciation_package_v1(p_package);
$$;

revoke all on function
  private.import_approved_korean_pronunciation_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_approved_korean_pronunciation_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function
  private.import_approved_korean_pronunciation_package_v1(jsonb)
  to service_role;
grant execute on function
  public.import_approved_korean_pronunciation_package_v1(jsonb)
  to service_role;

commit;
