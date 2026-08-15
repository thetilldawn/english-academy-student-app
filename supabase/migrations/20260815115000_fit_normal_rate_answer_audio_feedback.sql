begin;

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, 'interval ''1500 milliseconds''') <> 2 then
    raise exception 'quiz_feedback_window_guard_not_found';
  end if;

  v_updated := replace(
    v_definition,
    'interval ''1500 milliseconds''',
    'interval ''3000 milliseconds'''
  );
  execute v_updated;
end;
$$;

revoke all on function public.answer_quiz_question_v2(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) from public, anon, authenticated;

grant execute on function public.answer_quiz_question_v2(
  uuid,
  uuid,
  uuid,
  text,
  smallint,
  boolean
) to service_role;

notify pgrst, 'reload schema';

commit;
