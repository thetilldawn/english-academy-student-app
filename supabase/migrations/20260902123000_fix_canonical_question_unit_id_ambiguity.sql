create or replace function public.list_active_canonical_question_preview_v1(
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_quiz_mode text
)
returns table (
  release_id uuid,
  package_sha256 text,
  question_item_id text,
  question_item_sha256 text,
  vocab_entry_id bigint,
  unit_id uuid,
  source_row integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
    or not (select private.is_active_admin())
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_dataset_id is null
    or p_unit_ids is null
    or cardinality(p_unit_ids) < 1
    or cardinality(p_unit_ids) <> (
      select count(distinct selected.unit_id)
      from unnest(p_unit_ids) as selected(unit_id)
      where selected.unit_id is not null
    )
    or p_quiz_mode not in (
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
  then
    raise exception 'invalid_canonical_question_preview_selection'
      using errcode = '22023';
  end if;
  return query
  with ranked as (
    select release.release_id, release.package_file_sha256,
      item.question_item_id, item.question_item_sha256,
      item.vocab_entry_id, item.unit_id, item.source_row,
      row_number() over (
        partition by item.question_item_id
        order by item.source_row, item.vocab_entry_id
      ) as item_rank
    from word_index.app_canonical_question_preview_release as release
    join word_index.app_exam_use_release as exam_release
      on exam_release.release_id = release.exam_use_release_id
     and exam_release.dataset_id = release.dataset_id
     and exam_release.status = 'active'
     and exam_release.target_environment = 'preview'
     and exam_release.exam_use_import_allowed
    join word_index.app_canonical_question_preview_item as item
      on item.release_id = release.release_id
     and item.dataset_id = release.dataset_id
     and item.exam_use_release_id = exam_release.release_id
    where release.dataset_id = p_dataset_id
      and release.status = 'active'
      and release.target_environment = 'preview'
      and release.preview_apply_allowed
      and not release.production_apply_allowed
      and item.quiz_mode = p_quiz_mode
      and item.unit_id = any(p_unit_ids)
  )
  select ranked.release_id, ranked.package_file_sha256,
    ranked.question_item_id, ranked.question_item_sha256,
    ranked.vocab_entry_id, ranked.unit_id, ranked.source_row
  from ranked
  where ranked.item_rank = 1
  order by ranked.source_row, ranked.question_item_id;
end;
$$;

revoke all on function public.list_active_canonical_question_preview_v1(
  uuid, uuid[], text
) from public, anon, authenticated, service_role;
grant execute on function public.list_active_canonical_question_preview_v1(
  uuid, uuid[], text
) to authenticated;
