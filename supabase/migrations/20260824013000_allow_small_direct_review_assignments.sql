begin;

-- The exact-review path assigns every selected wrong word as one target
-- question. A single target still receives four answer choices, so only the
-- selected target count needs the earlier 1-question lower bound.
do $rewrite$
declare
  target_function regprocedure;
  function_definition text;
  old_fragment constant text :=
    'cardinality(p_selected_queue_ids) not between 4 and 400';
  new_fragment constant text :=
    'cardinality(p_selected_queue_ids) not between 1 and 400';
  occurrence_count integer;
begin
  target_function := to_regprocedure(
    'private.create_exact_review_assignment_v5(' ||
    'uuid,uuid,uuid[],text,smallint,integer,smallint,' ||
    'public.question_order_mode,timestamp with time zone,text,integer,jsonb)'
  );
  if target_function is null then
    raise exception 'exact_review_assignment_function_missing';
  end if;

  select pg_get_functiondef(target_function)
  into function_definition;

  occurrence_count := (
    char_length(function_definition)
    - char_length(replace(function_definition, old_fragment, ''))
  ) / char_length(old_fragment);
  if occurrence_count <> 1 then
    raise exception 'unexpected_exact_review_assignment_definition';
  end if;

  execute replace(function_definition, old_fragment, new_fragment);
end;
$rewrite$;

notify pgrst, 'reload schema';

commit;
