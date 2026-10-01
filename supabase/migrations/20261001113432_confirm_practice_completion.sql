-- APP-20261001-05: distinguish displayed expiry from a committed practice result.
-- No student, question, deadline, answer, or scoring data is updated.
begin;

create or replace function private.word_practice_read_v1(p_run private.student_word_practice_runs)
returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); finished boolean; state text; questions jsonb; next_id uuid; deadline timestamptz;
begin
  -- A zero clock requests the existing expiry/timeout command. A read must not
  -- invent a committed result or reveal unanswered keys before that command.
  finished:=p_run.status<>'in_progress';
  state:=p_run.status;
  deadline:=private.word_practice_timer_v1(p_run);
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'orderIndex',q.ordinal,
    'direction',q.body->>'direction','prompt',q.body->>'prompt','choices',q.body->'choices',
    'pronunciation',case when q.body->>'direction'='english_to_korean' or q.answered_at is not null or finished then q.body->'pronunciation'
      else jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false) end,
    'choicePronunciations',case when q.body->>'direction'='korean_to_english' then q.body->'choicePronunciations'
      else jsonb_build_array(jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false)) end,
    'initialChoiceIndex',q.selected_index,'initialIsCorrect',q.is_correct,'initialTimedOut',q.timed_out,
    'retryChoiceIndex',null,'retryIsCorrect',null,'retryTimedOut',false,'priorWrongLevel',0,
    'revealedCorrectChoiceIndex',case when q.answered_at is not null or finished then (q.body->>'correctChoiceIndex')::integer end) order by q.ordinal),'[]')
    into questions from private.student_word_practice_questions q where q.run_id=p_run.id;
  select id into next_id from private.student_word_practice_questions where run_id=p_run.id and ordinal=p_run.current_ordinal and not finished;
  return jsonb_build_object('completionConfirmed',p_run.status in ('completed','expired'),'attempt',jsonb_build_object('id',p_run.id,'assignmentTitle','내 단어장 연습','quizContentMode','book_meaning_choice',
    'status',state,'phase',case when finished then 'completed' else 'initial' end,'startedAt',p_run.started_at,
    'deadlineAt',p_run.deadline_at,'timerDeadlineAt',deadline,'timingMode',p_run.settings->>'timingMode',
    'questionTimeLimitSeconds',p_run.settings->'questionTimeLimitSeconds','questions',questions,'currentQuestionId',next_id),
    'timerRemainingMilliseconds',private.word_practice_milliseconds_v1(deadline,at_time),
    'transitionRemainingMilliseconds',least(7250,private.word_practice_milliseconds_v1(p_run.current_starts_at,at_time)));
end;
$$;

revoke all on function private.word_practice_read_v1(private.student_word_practice_runs) from public,anon,authenticated,service_role;

commit;
