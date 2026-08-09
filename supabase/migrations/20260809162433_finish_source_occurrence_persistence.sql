-- Applied to the isolated staging project as remote version 20260809162433.
begin;

-- The same dictionary entry may occur in more than one source row. The
-- assignment target remains the occurrence/vocab entry, while dictionary_id
-- continues to identify the lexical item for review and distractor rules.
alter table public.assignment_question_exam_use_snapshot
  drop constraint if exists
    assignment_question_exam_use_sn_assignment_id_dictionary_id_key;

create index if not exists
  assignment_question_exam_use_assignment_dictionary_idx
  on public.assignment_question_exam_use_snapshot(
    assignment_id,
    dictionary_id
  );

do $migration$
declare
  function_definition text;
  duplicate_dictionary_guard text := $guard$  if (
    select count(distinct occurrence.dictionary_id)
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint
    )
    join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = p_release_id
     and occurrence.vocab_entry_id = question.vocab_entry_id
  ) <> p_question_count then
    raise exception 'duplicate_exam_use_dictionary_target'
      using errcode = '22023';
  end if;

$guard$;
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_exam_use_question_bank_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(duplicate_dictionary_guard in function_definition) = 0 then
    raise exception 'exam_use_dictionary_guard_shape_changed';
  end if;
  function_definition := replace(
    function_definition,
    duplicate_dictionary_guard,
    ''
  );
  if position('duplicate_exam_use_dictionary_target' in function_definition) > 0 then
    raise exception 'exam_use_dictionary_guard_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- The duplicate-active trigger runs before ON CONFLICT. Remove duplicate
-- source rows from the INSERT input so one pending queue is linked to the
-- earliest matching occurrence for each student.
do $migration$
declare
  function_definition text;
  select_marker text := E'  select\n    p_assignment_id,\n    link.student_id,\n    selected_queue.id,';
  order_marker text := E'  order by link.student_id, question.base_order_index\n  on conflict (assignment_id, student_id, review_queue_id) do nothing;';
begin
  select replace(
    pg_get_functiondef(
      'private.link_pending_review_targets_v2(uuid,uuid[],uuid[])'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(select_marker in function_definition) = 0
    or position(order_marker in function_definition) = 0
  then
    raise exception 'link_pending_review_targets_v2_dedupe_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    select_marker,
    E'  select distinct on (link.student_id, selected_queue.id)\n    p_assignment_id,\n    link.student_id,\n    selected_queue.id,'
  );
  function_definition := replace(
    function_definition,
    order_marker,
    E'  order by\n    link.student_id,\n    selected_queue.id,\n    question.base_order_index;'
  );

  if position('on conflict (assignment_id, student_id, review_queue_id)' in function_definition) > 0
    or position('select distinct on (link.student_id, selected_queue.id)' in function_definition) = 0
  then
    raise exception 'link_pending_review_targets_v2_dedupe_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- Fail closed if a future migration changes the aliases that the preceding
-- runtime-eligibility migration was expected to rewrite.
do $migration$
declare
  function_oid regprocedure;
  function_definition text;
  helper_count integer;
  check_row record;
begin
  for check_row in
    select *
    from (values
      (
        'private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)',
        2
      ),
      (
        'private.create_mixed_review_assignment_v8(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
        1
      ),
      (
        'private.assert_assignment_words_available_v2(uuid[],uuid,jsonb)',
        1
      )
    ) as expected(signature, minimum_helper_count)
  loop
    function_oid := to_regprocedure(check_row.signature);
    if function_oid is null then
      raise exception 'runtime_eligibility_function_missing: %',
        check_row.signature;
    end if;
    function_definition := pg_get_functiondef(function_oid);
    helper_count := (
      length(function_definition) - length(replace(
        function_definition,
        'private.quiz_eligibility_runtime_allowed_v1',
        ''
      ))
    ) / length('private.quiz_eligibility_runtime_allowed_v1');
    if helper_count < check_row.minimum_helper_count then
      raise exception 'runtime_eligibility_rewrite_missing: %',
        check_row.signature;
    end if;
  end loop;
end;
$migration$;

commit;
