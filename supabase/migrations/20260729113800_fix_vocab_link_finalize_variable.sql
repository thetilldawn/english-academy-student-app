create or replace function private.finalize_vocab_link_import(
  p_dataset_id uuid,
  p_capabilities jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  run_row word_index.vocab_link_import_run%rowtype;
  expected_count bigint;
  actual_count bigint;
  expected_capability_count bigint;
  dataset_entry_count bigint;
  expected_canonical_snapshot_sha256 text;
  calculated_capabilities_sha256 text;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_capabilities is null
    or jsonb_typeof(p_capabilities) <> 'array'
  then
    raise exception 'invalid_vocab_capabilities'
      using errcode = '22023';
  end if;

  calculated_capabilities_sha256 := upper(encode(
    extensions.digest(
      convert_to(p_capabilities::text, 'UTF8'),
      'sha256'
    ),
    'hex'
  ));

  select *
  into run_row
  from word_index.vocab_link_import_run
  where dataset_id = p_dataset_id
  for update;
  if not found then
    raise exception 'vocab_link_import_not_found'
      using errcode = 'P0002';
  end if;
  if run_row.status = 'complete' then
    if run_row.capabilities_payload_sha256
      <> calculated_capabilities_sha256
    then
      raise exception 'vocab_link_capability_payload_conflict'
        using errcode = '23505';
    end if;
    return private.get_vocab_link_import_status(p_dataset_id);
  end if;
  if run_row.status <> 'loading' then
    raise exception 'vocab_link_import_not_loading'
      using errcode = '55000';
  end if;

  expected_count := (
    run_row.expected_counts ->> 'occurrence'
  )::bigint;
  select count(*) into actual_count
  from word_index.occurrence
  where source_id = run_row.source_id;
  if actual_count <> expected_count then
    raise exception 'vocab_link_occurrence_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts ->> 'vocab_entry_link'
  )::bigint;
  select count(*) into actual_count
  from word_index.vocab_entry_link
  where dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_entry_link_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts
      ->> 'vocab_entry_mapping_candidate'
  )::bigint;
  select count(*) into actual_count
  from word_index.vocab_entry_mapping_candidate as candidate
  join word_index.vocab_entry_link as link
    on link.vocab_entry_id = candidate.vocab_entry_id
  where link.dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_mapping_candidate_count_mismatch'
      using errcode = '21000';
  end if;

  expected_count := (
    run_row.expected_counts
      ->> 'vocab_entry_quiz_eligibility'
  )::bigint;
  select count(*) into actual_count
  from public.vocab_entry_quiz_eligibility
  where dataset_id = p_dataset_id;
  if actual_count <> expected_count then
    raise exception 'vocab_entry_eligibility_count_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from public.vocab_entries
    where dataset_id = p_dataset_id
  ) <> (
    select count(*)
    from word_index.vocab_entry_link
    where dataset_id = p_dataset_id
  ) then
    raise exception 'vocab_dataset_entry_link_coverage_mismatch'
      using errcode = '21000';
  end if;

  if (
    select count(*)
    from word_index.vocab_entry_link
    where dataset_id = p_dataset_id
      and mapping_status in (
        'exact_headword_unreviewed',
        'approved'
      )
  ) <> (
    select count(*)
    from word_index.occurrence
    where source_id = run_row.source_id
  ) then
    raise exception 'vocab_occurrence_exact_link_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    where link.dataset_id = p_dataset_id
      and (
        link.entry_row_sha256 <> (
          select entry.row_sha256
          from public.vocab_entries as entry
          where entry.id = link.vocab_entry_id
            and entry.dataset_id = link.dataset_id
        )
        or (
          link.mapping_status = 'exact_headword_unreviewed'
          and link.occurrence_id is null
        )
        or (
          link.lexeme_id is not null
          and not exists (
            select 1
            from word_index.lexeme as lexeme
            where lexeme.lexeme_id = link.lexeme_id
              and lower(lexeme.content_hash) =
                lower(link.canonical_content_hash)
          )
        )
      )
  ) then
    raise exception 'vocab_entry_link_integrity_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.occurrence
    where source_id = run_row.source_id
      and sense_id is not null
  ) then
    raise exception 'book_meaning_must_not_overwrite_canonical_sense'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.occurrence as occurrence
    left join word_index.vocab_entry_link as link
      on link.occurrence_id = occurrence.occurrence_id
     and link.dataset_id = p_dataset_id
    where occurrence.source_id = run_row.source_id
      and link.vocab_entry_id is null
  ) then
    raise exception 'vocab_occurrence_without_entry_link'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    join word_index.occurrence as occurrence
      on occurrence.occurrence_id = link.occurrence_id
    join public.vocab_entries as entry
      on entry.id = link.vocab_entry_id
     and entry.dataset_id = link.dataset_id
    join public.vocab_units as unit
      on unit.id = entry.unit_id
     and unit.dataset_id = entry.dataset_id
    where link.dataset_id = p_dataset_id
      and (
        occurrence.surface_form is distinct from entry.headword
        or occurrence.source_meaning_ko
          is distinct from entry.primary_meaning
        or occurrence.day_no is distinct from unit.unit_number
        or occurrence.unit_label is distinct from unit.unit_label
        or occurrence.sequence_no is distinct from entry.source_row
        or occurrence.item_label is distinct from
          ('source_row:' || entry.source_row::text)
      )
  ) then
    raise exception 'vocab_occurrence_public_entry_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from word_index.vocab_entry_link as link
    where link.dataset_id = p_dataset_id
      and link.candidate_count <> (
        select count(*)
        from word_index.vocab_entry_mapping_candidate as candidate
        where candidate.vocab_entry_id = link.vocab_entry_id
      )
  ) then
    raise exception 'vocab_mapping_candidate_per_entry_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from public.vocab_entry_quiz_eligibility as eligibility
    join public.vocab_entries as entry
      on entry.id = eligibility.vocab_entry_id
     and entry.dataset_id = eligibility.dataset_id
    join word_index.vocab_entry_link as link
      on link.vocab_entry_id = eligibility.vocab_entry_id
     and link.dataset_id = eligibility.dataset_id
    left join word_index.review as review
      on review.review_id = eligibility.content_review_id
    where eligibility.dataset_id = p_dataset_id
      and (
        eligibility.input_content_hash <> entry.row_sha256
        or eligibility.canonical_lexeme_id
          is distinct from link.lexeme_id
        or lower(eligibility.canonical_content_hash)
          is distinct from lower(link.canonical_content_hash)
        or (
          eligibility.content_review_id is not null
          and (
            review.review_id is null
            or review.lexeme_id is distinct from
              eligibility.canonical_lexeme_id
            or lower(review.input_content_hash)
              is distinct from
                lower(eligibility.canonical_content_hash)
          )
        )
      )
  ) then
    raise exception 'vocab_entry_eligibility_integrity_mismatch'
      using errcode = '21000';
  end if;

  expected_capability_count := (
    run_row.expected_counts
      ->> 'vocab_dataset_capabilities'
  )::bigint;
  if jsonb_array_length(p_capabilities) <> expected_capability_count
    or exists (
      select 1
      from jsonb_array_elements(p_capabilities) as capability(value)
      where capability.value ->> 'dataset_id'
        is distinct from p_dataset_id::text
    )
  then
    raise exception 'vocab_dataset_capability_scope_mismatch'
      using errcode = '22023';
  end if;

  insert into public.vocab_dataset_capabilities
  select *
  from jsonb_populate_recordset(
    null::public.vocab_dataset_capabilities,
    p_capabilities
  );

  select count(*) into actual_count
  from public.vocab_dataset_capabilities
  where dataset_id = p_dataset_id;
  if actual_count <> expected_capability_count then
    raise exception 'vocab_dataset_capability_count_mismatch'
      using errcode = '21000';
  end if;

  select count(*)
  into dataset_entry_count
  from public.vocab_entries
  where dataset_id = p_dataset_id;

  select upper(build.input_snapshot_sha256)
  into expected_canonical_snapshot_sha256
  from word_index.index_build as build
  where build.build_id = run_row.build_id;

  if exists (
    select 1
    from public.vocab_dataset_capabilities as capability
    join public.vocab_datasets as dataset
      on dataset.id = capability.dataset_id
    where capability.dataset_id = p_dataset_id
      and (
        capability.eligible_entry_count
          + capability.excluded_entry_count
          <> dataset_entry_count
        or capability.dataset_source_sha256
          <> dataset.source_sha256
        or capability.canonical_snapshot_sha256
          is distinct from expected_canonical_snapshot_sha256
        or (
          capability.quiz_mode in (
            'canonical_definition_to_headword',
            'canonical_example_to_headword',
            'school_context_to_headword',
            'mock_exam_context_to_headword'
          )
          and (
            capability.status <> 'blocked'
            or capability.eligible_entry_count <> 0
          )
        )
        or (
          capability.quiz_mode in (
            'book_meaning_en_to_ko',
            'book_meaning_ko_to_en'
          )
          and (
            capability.eligible_entry_count <> (
              select count(*)
              from public.vocab_entry_quiz_eligibility
                as eligibility
              where eligibility.dataset_id = p_dataset_id
                and eligibility.quiz_mode =
                  capability.quiz_mode
                and eligibility.status = 'eligible'
            )
            or capability.excluded_entry_count <> (
              select count(*)
              from public.vocab_entry_quiz_eligibility
                as eligibility
              where eligibility.dataset_id = p_dataset_id
                and eligibility.quiz_mode =
                  capability.quiz_mode
                and eligibility.status <> 'eligible'
            )
          )
        )
      )
  ) then
    raise exception 'vocab_dataset_capability_integrity_mismatch'
      using errcode = '21000';
  end if;

  update word_index.vocab_link_import_run
  set status = 'complete',
      completed_at_utc = now(),
      capabilities_payload_sha256 =
        calculated_capabilities_sha256
  where dataset_id = p_dataset_id;

  return private.get_vocab_link_import_status(p_dataset_id);
end;
$$;

notify pgrst, 'reload schema';
