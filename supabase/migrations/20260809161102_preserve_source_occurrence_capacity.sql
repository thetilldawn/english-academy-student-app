-- Applied to the isolated staging project as remote version 20260809161102.
begin;

-- Duplicate prompts are warnings at import time. Whether they are ambiguous
-- is decided from the teacher's selected target range at runtime.
create function private.quiz_eligibility_runtime_allowed_v1(
  p_status text,
  p_reason_codes text[]
)
returns boolean
language sql
immutable
security invoker
set search_path = ''
as $$
  select
    p_status = 'eligible'
    or (
      p_status = 'review_required'
      and cardinality(p_reason_codes) > 0
      and p_reason_codes <@ array[
        'DUPLICATE_HEADWORD_DIFFERENT_MEANING',
        'DUPLICATE_PRIMARY_MEANING_DIFFERENT_HEADWORD'
      ]::text[]
    );
$$;

revoke all on function private.quiz_eligibility_runtime_allowed_v1(
  text,
  text[]
) from public, anon, authenticated, service_role;

-- A source occurrence is the question target identity. Canonical/headword
-- identity remains available for distractors and wrong-answer lifecycle.
drop index if exists public.assignment_questions_normalized_headword_unique;
drop index if exists public.assignment_questions_canonical_lexeme_unique;

create index assignment_questions_normalized_headword_idx
  on public.assignment_questions(
    assignment_id,
    headword_normalized_snapshot
  )
  where provenance_status = 'verified_v2';

create index assignment_questions_canonical_lexeme_idx
  on public.assignment_questions(
    assignment_id,
    canonical_lexeme_id_snapshot
  )
  where provenance_status = 'verified_v2'
    and canonical_lexeme_id_snapshot is not null;

-- Keep the immutable v2 writer, but admit only the two import-time duplicate
-- warnings. All other review_required/excluded reasons remain blocked.
do $migration$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(
    $needle$eligibility.status is distinct from 'eligible'$needle$
    in function_definition
  ) = 0
    or position(
      $needle$choice_eligibility.status is distinct from 'eligible'$needle$
      in function_definition
    ) = 0
  then
    raise exception 'question_bank_v2_eligibility_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    $needle$choice_eligibility.status is distinct from 'eligible'$needle$,
    'not private.quiz_eligibility_runtime_allowed_v1(choice_eligibility.status, choice_eligibility.reason_codes)'
  );
  function_definition := replace(
    function_definition,
    $needle$eligibility.status is distinct from 'eligible'$needle$,
    'not private.quiz_eligibility_runtime_allowed_v1(eligibility.status, eligibility.reason_codes)'
  );

  if position(
    $needle$eligibility.status is distinct from 'eligible'$needle$
    in function_definition
  ) > 0
    or position(
      $needle$choice_eligibility.status is distinct from 'eligible'$needle$
      in function_definition
    ) > 0
  then
    raise exception 'question_bank_v2_eligibility_rewrite_failed';
  end if;

  execute function_definition;
end;
$migration$;

create function private.assert_assignment_target_prompts_unambiguous_v1(
  p_dataset_id uuid,
  p_questions jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_dataset_id is null
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
  then
    raise exception 'invalid_assignment_prompt_check'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      direction text
    )
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
     and entry.dataset_id = p_dataset_id
    group by
      question.direction,
      case question.direction
        when 'english_to_korean' then lower(normalize(
          trim(replace(entry.headword, '*', '')),
          NFKC
        ))
        when 'korean_to_english' then lower(normalize(
          trim(entry.primary_meaning),
          NFKC
        ))
        else null
      end
    having count(distinct case question.direction
      when 'english_to_korean' then lower(normalize(
        trim(entry.primary_meaning),
        NFKC
      ))
      when 'korean_to_english' then lower(normalize(
        trim(replace(entry.headword, '*', '')),
        NFKC
      ))
      else null
    end) > 1
  ) then
    raise exception 'assignment_target_prompt_ambiguous'
      using errcode = '22023';
  end if;
end;
$$;

revoke all on function
  private.assert_assignment_target_prompts_unambiguous_v1(uuid, jsonb)
  from public, anon, authenticated, service_role;

-- Regular DAY rows may intentionally overlap another pending regular exam.
-- Queue/exact-review writers keep their own queue snapshot and active-target
-- checks, so only the broad all-question guard is removed here.
do $migration$
declare
  function_definition text;
  guard_call text := E'  perform private.assert_assignment_words_available_v2(\n    p_student_ids,\n    p_dataset_id,\n    p_questions\n  );\n\n';
begin
  select replace(
    pg_get_functiondef(
      'private.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(guard_call in function_definition) = 0 then
    raise exception 'assignment_delivery_v6_guard_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    guard_call,
    E'  perform private.assert_assignment_target_prompts_unambiguous_v1(\n    p_dataset_id,\n    p_questions\n  );\n\n'
  );
  if position(guard_call in function_definition) > 0 then
    raise exception 'assignment_delivery_v6_guard_rewrite_failed';
  end if;
  execute function_definition;
end;
$migration$;

-- One pending wrong queue is attached to the first matching source occurrence.
-- Repeated occurrence rows remain ordinary questions instead of attempting to
-- reserve the same queue twice.
do $migration$
declare
  function_definition text;
  insertion_marker text := E'  order by link.student_id, question.base_order_index;\n\n  select count(*)';
begin
  select replace(
    pg_get_functiondef(
      'private.link_pending_review_targets_v2(uuid,uuid[],uuid[])'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(insertion_marker in function_definition) = 0 then
    raise exception 'link_pending_review_targets_v2_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    insertion_marker,
    E'  order by link.student_id, question.base_order_index\n  on conflict (assignment_id, student_id, review_queue_id) do nothing;\n\n  select count(*)'
  );
  execute function_definition;
end;
$migration$;

-- Mixed, exact-review, replacement and active-word identity readers must see
-- the same runtime-admitted rows as the application loader.
do $migration$
declare
  signature text;
  function_oid regprocedure;
  function_definition text;
begin
  foreach signature in array array[
    'private.create_mixed_review_assignment_v8(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)',
    'private.persist_review_assignment_exam_use_v6_compat(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)',
    'private.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)',
    'private.assert_assignment_words_available_v2(uuid[],uuid,jsonb)'
  ]
  loop
    function_oid := to_regprocedure(signature);
    if function_oid is null then
      raise exception 'runtime_eligibility_function_missing: %', signature;
    end if;

    select replace(pg_get_functiondef(function_oid), chr(13), '')
    into function_definition;
    function_definition := regexp_replace(
      function_definition,
      '(^|[^a-zA-Z0-9_])eligibility\.status = ''eligible''',
      E'\\1private.quiz_eligibility_runtime_allowed_v1(eligibility.status, eligibility.reason_codes)',
      'g'
    );
    execute function_definition;
  end loop;
end;
$migration$;

commit;
