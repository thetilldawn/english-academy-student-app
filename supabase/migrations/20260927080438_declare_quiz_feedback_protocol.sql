begin;

-- APP-20260927-01. Protocol belongs to the implementation, not its RPC suffix.
-- No attempt/question rows are changed by this migration.
do $migration$
declare
  fn text := pg_get_functiondef('public.answer_quiz_question_v2(uuid,uuid,uuid,text,smallint,boolean)'::regprocedure);
  anchor text := '''timedOut'', timed_out,';
begin
  if position('interval ''7000 milliseconds''' in fn)=0
    or (length(fn)-length(replace(fn,anchor,'')))/length(anchor)<>1
  then raise exception 'quiz_feedback_protocol_anchor_changed'; end if;
  execute replace(fn,anchor,'''feedbackProtocol'', ''variable'', '||anchor);
end;
$migration$;
notify pgrst,'reload schema';
commit;
