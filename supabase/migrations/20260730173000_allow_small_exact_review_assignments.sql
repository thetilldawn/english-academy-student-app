begin;

-- A one-question review assignment still contains four answer choices. Only
-- the number of target questions changes; the verified v2 choice contract does
-- not.
do $guard$
declare
  constraint_definition text;
begin
  select pg_get_constraintdef(constraint_row.oid)
  into constraint_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.assignments'::regclass
    and constraint_row.conname = 'assignments_question_count_check';

  if constraint_definition is null
    or lower(constraint_definition) not like '%question_count%4%500%'
  then
    raise exception 'unexpected_assignments_question_count_constraint';
  end if;

  select pg_get_constraintdef(constraint_row.oid)
  into constraint_definition
  from pg_constraint as constraint_row
  where constraint_row.conrelid = 'public.quiz_attempts'::regclass
    and constraint_row.conname =
      'quiz_attempts_question_count_snapshot_check';

  if constraint_definition is null
    or lower(constraint_definition)
      not like '%question_count_snapshot%4%500%'
  then
    raise exception 'unexpected_attempt_question_count_constraint';
  end if;
end;
$guard$;

alter table public.assignments
  drop constraint assignments_question_count_check;
alter table public.assignments
  add constraint assignments_question_count_check
  check (question_count between 1 and 500)
  not valid;
alter table public.assignments
  validate constraint assignments_question_count_check;

alter table public.quiz_attempts
  drop constraint quiz_attempts_question_count_snapshot_check;
alter table public.quiz_attempts
  add constraint quiz_attempts_question_count_snapshot_check
  check (question_count_snapshot between 1 and 500)
  not valid;
alter table public.quiz_attempts
  validate constraint quiz_attempts_question_count_snapshot_check;

-- Keep the already-reviewed function bodies as the source of truth. This
-- guarded rewrite changes exactly one lower-bound predicate in each private
-- core function and aborts if a prior migration has drifted.
do $rewrite$
declare
  target_function regprocedure;
  target_functions regprocedure[];
  function_definition text;
  old_fragment constant text :=
    'p_question_count not between 4 and 500';
  new_fragment constant text :=
    'p_question_count not between 1 and 500';
  occurrence_count integer;
begin
  target_functions := array[
    to_regprocedure(
      'private.create_assignment_with_question_bank(' ||
      'text,uuid,uuid[],integer,smallint,integer,smallint,' ||
      'public.question_order_mode,uuid[],jsonb)'
    ),
    to_regprocedure(
      'private.create_assignment_with_question_bank_v2(' ||
      'text,uuid,uuid[],integer,smallint,integer,smallint,' ||
      'public.question_order_mode,uuid[],jsonb)'
    )
  ];

  foreach target_function in array target_functions
  loop
    if target_function is null then
      raise exception 'review_assignment_core_function_missing';
    end if;

    select pg_get_functiondef(target_function)
    into function_definition;

    occurrence_count := (
      char_length(function_definition)
      - char_length(replace(
        function_definition,
        old_fragment,
        ''
      ))
    ) / char_length(old_fragment);

    if occurrence_count <> 1 then
      raise exception
        'unexpected_review_assignment_core_definition: %',
        target_function;
    end if;

    execute replace(
      function_definition,
      old_fragment,
      new_fragment
    );
  end loop;
end;
$rewrite$;

notify pgrst, 'reload schema';

commit;
