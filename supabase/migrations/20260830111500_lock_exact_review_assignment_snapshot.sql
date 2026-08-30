begin;

-- Both the reviewed exam-use writer and its legacy-dataset fallback receive
-- the exact choice entry IDs, but the fallback historically discarded them
-- after rendering the choices. Persist that immutable plan at the shared
-- exact-review dispatcher so later schedule/settings edits can reproduce the
-- same questions without guessing from display text.
create function private.persist_exact_review_question_plan_v1(
  p_assignment_id uuid,
  p_question_count integer,
  p_questions jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_question_count integer;
begin
  if p_assignment_id is null
    or p_question_count is null
    or p_question_count not between 1 and 500
    or p_questions is null
    or jsonb_typeof(p_questions) is distinct from 'array'
    or jsonb_array_length(p_questions) <> p_question_count
    or exists (
      select 1
      from jsonb_to_recordset(p_questions) as question(
        vocab_entry_id bigint,
        base_order_index integer,
        direction text,
        choice_vocab_entry_ids bigint[]
      )
      where question.vocab_entry_id is null
        or question.base_order_index is null
        or question.direction not in (
          'english_to_korean',
          'korean_to_english'
        )
        or question.choice_vocab_entry_ids is null
        or cardinality(question.choice_vocab_entry_ids) <> 4
    )
  then
    raise exception 'invalid_exact_review_question_snapshot'
      using errcode = '22023';
  end if;

  update public.assignment_questions as stored
  set choice_vocab_entry_ids = planned.choice_vocab_entry_ids
  from jsonb_to_recordset(p_questions) as planned(
    vocab_entry_id bigint,
    base_order_index integer,
    direction text,
    choice_vocab_entry_ids bigint[]
  )
  where stored.assignment_id = p_assignment_id
    and stored.vocab_entry_id = planned.vocab_entry_id
    and stored.base_order_index = planned.base_order_index
    and stored.direction = planned.direction::public.question_direction;
  get diagnostics updated_question_count = row_count;
  if updated_question_count <> p_question_count then
    raise exception 'exact_review_question_snapshot_write_mismatch'
      using errcode = '21000';
  end if;
end;
$$;

revoke all on function private.persist_exact_review_question_plan_v1(
  uuid, integer, jsonb
) from public, anon, authenticated, service_role;

create or replace function private.create_exact_review_question_bank_exam_use_dispatch_v1(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  active_release_id uuid;
  created_assignment_id uuid;
begin
  select release.release_id
  into active_release_id
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
  for share;

  if active_release_id is null then
    if exists (
      select 1
      from word_index.app_exam_use_release as release
      where release.dataset_id = p_dataset_id
    ) then
      raise exception 'exam_use_release_inactive' using errcode = '55000';
    end if;
    created_assignment_id := private.create_assignment_with_question_bank_v3(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );
  else
    created_assignment_id :=
      private.create_exact_review_with_exam_use_question_bank_v1(
        active_release_id,
        p_title,
        p_dataset_id,
        p_unit_ids,
        p_question_count,
        p_english_to_korean_ratio,
        p_time_limit_seconds,
        p_passing_score,
        p_question_order_mode,
        p_available_until,
        p_student_ids,
        p_questions
      );
  end if;

  perform private.persist_exact_review_question_plan_v1(
    created_assignment_id,
    p_question_count,
    p_questions
  );
  return created_assignment_id;
end;
$$;

revoke all on function private.create_exact_review_question_bank_exam_use_dispatch_v1(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) from public, anon, authenticated, service_role;

-- Exact wrong-answer assignments retain the original question snapshot.
-- Clone the currently patched v6 implementation so later fixes remain intact,
-- then add the missing direction/question-plan guards in a new public version.
do $lock_exact_review_snapshot$
declare
  source_function regprocedure :=
    'public.replace_student_assignment_v6(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,timestamp with time zone,text,integer,smallint[],text,uuid[],jsonb)'::regprocedure;
  function_definition text;
  source_header constant text :=
    'CREATE OR REPLACE FUNCTION public.replace_student_assignment_v6(';
  target_header constant text :=
    'CREATE OR REPLACE FUNCTION public.replace_student_assignment_v7(';
  source_guard constant text :=
    E'    or (\n      source_purpose = ''review''\n      and (\n        p_dataset_id is distinct from source_dataset_id\n        or p_question_count is distinct from source_question_count\n      )\n    )';
  target_guard constant text :=
    E'    or (\n      source_purpose = ''review''\n      and (\n        p_dataset_id is distinct from source_dataset_id\n        or p_question_count is distinct from source_question_count\n        or p_english_to_korean_ratio is distinct from source_direction\n        or requested_question_plan is distinct from source_question_plan\n      )\n    )';
  owner_before oid;
  security_definer_before boolean;
  config_before text[];
  target_function regprocedure;
begin
  select replace(pg_get_functiondef(source_function), chr(13), '')
  into function_definition;
  select proowner, prosecdef, proconfig
  into owner_before, security_definer_before, config_before
  from pg_proc
  where oid = source_function::oid;

  if (
    length(function_definition)
    - length(replace(function_definition, source_header, ''))
  ) / length(source_header) <> 1
    or (
      length(function_definition)
      - length(replace(function_definition, source_guard, ''))
    ) / length(source_guard) <> 1
    or position(target_header in function_definition) <> 0
    or position('rebound_at timestamptz;' in function_definition) = 0
    or position('rebound_at := clock_timestamp();' in function_definition) = 0
    or position('private.replace_student_assignment_v4(' in function_definition) = 0
    or not security_definer_before
    or not exists (
      select 1
      from unnest(coalesce(config_before, array[]::text[])) as setting(value)
      where setting.value in ('search_path=', 'search_path=""')
    )
  then
    raise exception 'assignment_replacement_review_snapshot_contract_changed';
  end if;

  function_definition := replace(
    function_definition,
    source_header,
    target_header
  );
  function_definition := replace(
    function_definition,
    source_guard,
    target_guard
  );
  execute function_definition;

  target_function :=
    'public.replace_student_assignment_v7(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamp with time zone,timestamp with time zone,text,integer,smallint[],text,uuid[],jsonb)'::regprocedure;
  if not exists (
    select 1
    from pg_proc
    where oid = target_function::oid
      and proowner = owner_before
      and prosecdef = security_definer_before
      and proconfig is not distinct from config_before
  ) then
    raise exception 'assignment_replacement_review_snapshot_metadata_changed';
  end if;
end;
$lock_exact_review_snapshot$;

-- Keep the previous public writer callable during a rolling application
-- deploy, but route it through v7 so older servers cannot bypass the lock.
create or replace function public.replace_student_assignment_v6(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_from timestamptz,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.replace_student_assignment_v7(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256,
    p_replacement_kind,
    p_review_snapshot_mode,
    p_title,
    p_dataset_id,
    p_primary_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_retry_enabled,
    p_retry_passing_score,
    p_question_order_mode,
    p_available_from,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_review_levels,
    p_review_scope,
    p_selected_queue_ids,
    p_questions
  );
$$;

revoke all on function public.replace_student_assignment_v6(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v6(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) to authenticated, service_role;

revoke all on function public.replace_student_assignment_v7(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v7(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
