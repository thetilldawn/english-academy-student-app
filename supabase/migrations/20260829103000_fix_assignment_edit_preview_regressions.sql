begin;

-- Exact-review creation already has a dedicated 1..500 question exam-use
-- writer. Replacement still reached the shared regular writer through the
-- draft-compatible persistence path, which kept the regular 4-question
-- floor and rejected valid one-to-three-word review edits. Clone the latest
-- shared persistence contract and replace only that writer dispatch.
do $clone_exact_replacement_persist$
declare
  source_function regprocedure :=
    'private.persist_review_assignment_exam_use_v6_compat(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)'::regprocedure;
  function_definition text;
  source_name constant text :=
    'private.persist_review_assignment_exam_use_v6_compat(';
  target_name constant text :=
    'private.persist_exact_review_assignment_exam_use_v7_compat(';
  source_dispatch constant text :=
    'private.create_assignment_with_question_bank_exam_use_dispatch_v1(';
  target_dispatch constant text :=
    'private.create_exact_review_question_bank_exam_use_dispatch_v1(';
begin
  select replace(pg_get_functiondef(source_function), chr(13), '')
  into function_definition;

  if (
    length(function_definition)
    - length(replace(function_definition, source_name, ''))
  ) / length(source_name) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_dispatch, ''))
    ) / length(source_dispatch) <> 1
    or position(target_name in function_definition) <> 0
    or position(target_dispatch in function_definition) <> 0
    or not exists (
      select 1
      from pg_proc
      where oid = source_function::oid
        and prosecdef
        and exists (
          select 1
          from unnest(coalesce(proconfig, array[]::text[])) as setting(value)
          where setting.value in ('search_path=', 'search_path=""')
        )
    )
  then
    raise exception 'exact_review_replacement_persist_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_name,
    target_name
  );
  function_definition := replace(
    function_definition,
    source_dispatch,
    target_dispatch
  );
  execute function_definition;
end;
$clone_exact_replacement_persist$;

revoke all on function
  private.persist_exact_review_assignment_exam_use_v7_compat(
    uuid, uuid, uuid[], uuid, text, uuid[], smallint, integer, smallint,
    public.question_order_mode, timestamptz, jsonb
  ) from public, anon, authenticated, service_role;

-- Replacement v4 creates an internal draft before reaching this private
-- compatibility function. Preserve that queue reservation lifecycle and
-- change only the persistence function selected for an exact review.
create or replace function private.create_exact_review_assignment_v5_draft_compat(
  p_review_draft_id uuid,
  p_title text,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  draft_student_id uuid;
  draft_dataset_id uuid;
  review_queue_ids uuid[];
begin
  select draft.student_id, draft.dataset_id
  into draft_student_id, draft_dataset_id
  from public.student_vocab_review_assignment_drafts as draft
  where draft.id = p_review_draft_id;

  select array_agg(item.queue_id order by item.position)
  into review_queue_ids
  from public.student_vocab_review_assignment_draft_items as item
  where item.draft_id = p_review_draft_id;

  if draft_student_id is null
    or draft_dataset_id is null
    or review_queue_ids is null
  then
    raise exception 'review_assignment_draft_not_found'
      using errcode = '22023';
  end if;

  perform private.assert_assignment_words_available_v2(
    array[draft_student_id],
    draft_dataset_id,
    p_questions
  );

  return private.persist_exact_review_assignment_exam_use_v7_compat(
    draft_student_id,
    draft_dataset_id,
    review_queue_ids,
    p_review_draft_id,
    p_title,
    array[]::uuid[],
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_questions
  );
end;
$$;

revoke all on function private.create_exact_review_assignment_v5_draft_compat(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;

-- The source cancellation trigger records session.attention during the
-- replacement transaction. v6 previously captured rebound_at before that
-- cancellation, so the later session.replaced insert carried an earlier
-- timestamp. Capture it only after the replacement writer succeeds.
do $move_series_rebound_timestamp$
declare
  target_function regprocedure :=
    'public.replace_student_assignment_v6(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,timestamp with time zone,text,integer,smallint[],text,uuid[],jsonb)'::regprocedure;
  function_definition text;
  source_declaration constant text :=
    'rebound_at timestamptz := clock_timestamp();';
  target_declaration constant text :=
    'rebound_at timestamptz;';
  source_marker constant text :=
    E'  );\n\n  update private.assignment_replacement_requests';
  target_marker constant text :=
    E'  );\n\n  rebound_at := clock_timestamp();\n\n  update private.assignment_replacement_requests';
  owner_before oid;
  acl_before aclitem[];
  security_definer_before boolean;
  config_before text[];
begin
  select replace(pg_get_functiondef(target_function), chr(13), '')
  into function_definition;
  select proowner, proacl, prosecdef, proconfig
  into owner_before, acl_before, security_definer_before, config_before
  from pg_proc
  where oid = target_function::oid;

  if (
    length(function_definition)
    - length(replace(function_definition, source_declaration, ''))
  ) / length(source_declaration) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_marker, ''))
    ) / length(source_marker) <> 1
    or position(target_marker in function_definition) <> 0
    or not security_definer_before
  then
    raise exception 'assignment_replacement_rebound_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_declaration,
    target_declaration
  );
  function_definition := replace(
    function_definition,
    source_marker,
    target_marker
  );
  execute function_definition;

  if not exists (
    select 1
    from pg_proc
    where oid = target_function::oid
      and proowner = owner_before
      and proacl is not distinct from acl_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
  ) then
    raise exception 'assignment_replacement_rebound_metadata_changed';
  end if;
end;
$move_series_rebound_timestamp$;

notify pgrst, 'reload schema';

commit;
