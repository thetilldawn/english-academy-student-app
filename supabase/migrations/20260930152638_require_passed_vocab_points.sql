-- APP-20261001-01 / OPS-20261001-01: existing point-bearing attempts only.
-- No grades, answers, wrong-word records, rule snapshots or original events change.
begin;
set local lock_timeout='5s';
lock table public.quiz_attempts in share row exclusive mode;
lock table public.student_point_events in share row exclusive mode;
lock table public.student_point_totals in share row exclusive mode;

CREATE OR REPLACE FUNCTION private.record_vocab_quiz_point_events(p_attempt_id uuid, p_student_id uuid, p_rule_version text, p_fallback_at timestamp with time zone)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  inserted_count integer;
  current_attempt public.quiz_attempts%rowtype;
begin
  if p_rule_version = 'no-points-v1' then return 0; end if;
  if p_rule_version is null then
    return 0;
  end if;

  if p_rule_version <> 'vocab-points-v1' then
    raise exception 'unsupported_point_rule_version'
      using errcode = '22023';
  end if;


  -- The deferred trigger's NEW can precede the retry wrapper's passed update.
  select * into current_attempt from public.quiz_attempts
  where id=p_attempt_id and student_id=p_student_id for update;
  if not found then return 0; end if;
  if current_attempt.point_rule_version_snapshot is distinct from p_rule_version then
    raise exception 'point_rule_snapshot_mismatch' using errcode='23514';
  end if;
  if current_attempt.status <> 'completed' or current_attempt.passed is not true then
    return 0;
  end if;

  -- Historical initial outcomes were neutralized while this retry was unfinished.
  -- Restore their original contribution once, then insert only missing outcomes.
  
  -- A deterministic key is not enough: reject a differently-shaped correction.
  if exists (
    select 1 from public.student_point_events original
    join public.student_point_events fix on fix.event_key =
      'passed-only-v1:neutralize:' || original.id::text
    where original.quiz_attempt_id = p_attempt_id
      and original.student_id = p_student_id and original.event_kind = 'quiz_outcome'
      and (fix.event_kind <> 'adjustment' or fix.rule_version <> 'passed-only-v1'
        or fix.reason_code <> 'unpassed_attempt_neutralized'
        or fix.delta <> -original.delta or (to_jsonb(fix) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']) IS DISTINCT FROM (to_jsonb(original) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']))
  ) or exists (
    select 1 from public.student_point_events original
    join public.student_point_events fix on fix.event_key =
      'passed-only-v1:restore:' || original.id::text
    where original.quiz_attempt_id = p_attempt_id
      and original.student_id = p_student_id and original.event_kind = 'quiz_outcome'
      and (fix.event_kind <> 'adjustment' or fix.rule_version <> 'passed-only-v1'
        or fix.reason_code <> 'passed_attempt_restored'
        or fix.delta <> original.delta or (to_jsonb(fix) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']) IS DISTINCT FROM (to_jsonb(original) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at'])
        or not exists (select 1 from public.student_point_events n
          where n.event_key='passed-only-v1:neutralize:'||original.id::text))
  ) then
    raise exception 'point_correction_conflict' using errcode='23514';
  end if;

  insert into public.student_point_events (event_key,event_kind,student_id,dataset_id_snapshot,vocab_entry_id_snapshot,
canonical_lexeme_id_snapshot,headword_snapshot,assignment_id,quiz_attempt_id,
quiz_question_id,stage,exam_kind,outcome,rule_version,reason_code,delta,occurred_at)
  select 'passed-only-v1:restore:'||original.id::text,'adjustment',original.student_id,original.dataset_id_snapshot,original.vocab_entry_id_snapshot,
original.canonical_lexeme_id_snapshot,original.headword_snapshot,original.assignment_id,
original.quiz_attempt_id,original.quiz_question_id,original.stage,original.exam_kind,original.outcome,
    'passed-only-v1','passed_attempt_restored',original.delta,clock_timestamp()
  from public.student_point_events original
  join public.student_point_events neutralized
    on neutralized.event_key='passed-only-v1:neutralize:'||original.id::text
  where original.quiz_attempt_id=p_attempt_id and original.student_id=p_student_id
    and original.event_kind='quiz_outcome' and original.rule_version='vocab-points-v1'
  on conflict(event_key) do nothing;

  with point_candidates as (
    select
      question.id as quiz_question_id,
      attempt.assignment_id,
      attempt.student_id,
      assignment.dataset_id,
      question.vocab_entry_id,
      bank_question.canonical_lexeme_id_snapshot,
      coalesce(bank_question.headword_snapshot, entry.headword)
        as headword_snapshot,
      stage.stage,
      case
        when assignment.assignment_purpose = 'review'
          or exists (
            select 1
            from public.assignment_review_targets as review_target
            where review_target.assignment_id = attempt.assignment_id
              and review_target.student_id = attempt.student_id
              and review_target.assignment_question_id =
                question.assignment_question_id
          )
          then 'review'::text
        else 'regular'::text
      end as exam_kind,
      case
        when stage.is_correct then 'correct'::text
        when stage.choice_index is null then 'unanswered'::text
        when stage.timed_out then 'timeout'::text
        else 'wrong'::text
      end as outcome,
      coalesce(stage.answered_at, p_fallback_at, clock_timestamp())
        as occurred_at
    from public.quiz_attempts as attempt
    join public.assignments as assignment
      on assignment.id = attempt.assignment_id
    join public.quiz_questions as question
      on question.attempt_id = attempt.id
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    left join public.assignment_questions as bank_question
      on bank_question.id = question.assignment_question_id
    cross join lateral (
      values
        (
          'initial'::text,
          question.initial_choice_index,
          question.initial_is_correct,
          question.initial_timed_out,
          question.initial_answered_at
        ),
        (
          'retry'::text,
          question.retry_choice_index,
          question.retry_is_correct,
          question.retry_timed_out,
          question.retry_answered_at
        )
    ) as stage(
      stage,
      choice_index,
      is_correct,
      timed_out,
      answered_at
    )
    where attempt.id = p_attempt_id
      and attempt.student_id = p_student_id
      and stage.is_correct is not null
  ), inserted_events as (
    insert into public.student_point_events (
      event_key,
      event_kind,
      student_id,
      dataset_id_snapshot,
      vocab_entry_id_snapshot,
      canonical_lexeme_id_snapshot,
      headword_snapshot,
      assignment_id,
      quiz_attempt_id,
      quiz_question_id,
      stage,
      exam_kind,
      outcome,
      rule_version,
      reason_code,
      delta,
      occurred_at
    )
    select
      'vocab-quiz-outcome:' || candidate.quiz_question_id::text
        || ':' || candidate.stage,
      'quiz_outcome',
      candidate.student_id,
      candidate.dataset_id,
      candidate.vocab_entry_id,
      candidate.canonical_lexeme_id_snapshot,
      candidate.headword_snapshot,
      candidate.assignment_id,
      p_attempt_id,
      candidate.quiz_question_id,
      candidate.stage,
      candidate.exam_kind,
      candidate.outcome,
      p_rule_version,
      candidate.exam_kind || '_' || candidate.stage || '_'
        || candidate.outcome,
      private.vocab_quiz_point_delta_v1(
        candidate.exam_kind,
        candidate.stage,
        candidate.outcome
      ),
      candidate.occurred_at
    from point_candidates as candidate
    on conflict do nothing
    returning 1
  )
  select count(*)::integer
  into inserted_count
  from inserted_events;

  return inserted_count;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.get_quiz_attempt_point_summary_v1(p_student_id uuid, p_attempt_id uuid)
 RETURNS TABLE(event_count bigint, correct_reward bigint, wrong_effect bigint, net_change bigint, current_points bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  with attempt_summary as (
    select
      count(*)::bigint as event_count,
      coalesce(
        sum(event.delta) filter (where event.delta > 0),
        0::bigint
      )::bigint as correct_reward,
      coalesce(
        sum(event.delta) filter (where event.delta < 0),
        0::bigint
      )::bigint as wrong_effect,
      coalesce(sum(event.delta), 0::bigint)::bigint as net_change
    from public.student_point_events as event
    where event.student_id = p_student_id
      and event.quiz_attempt_id = p_attempt_id
      and event.event_kind = 'quiz_outcome'
      and exists (select 1 from public.quiz_attempts attempt
        where attempt.id=p_attempt_id and attempt.student_id=p_student_id
          and attempt.status='completed' and attempt.passed is true
          and attempt.point_rule_version_snapshot='vocab-points-v1')
  )
  select
    summary.event_count,
    summary.correct_reward,
    summary.wrong_effect,
    summary.net_change,
    greatest(coalesce(total.total_points, 0::bigint), 0::bigint)
      as current_points
  from attempt_summary as summary
  left join public.student_point_totals as total
    on total.student_id = p_student_id;
$function$
;

-- CREATE OR REPLACE preserves existing grants. Explicitly retain private and
-- service-role boundaries, never expose ledger writing to browser roles.
revoke all on function private.record_vocab_quiz_point_events(uuid,uuid,text,timestamptz)
  from public,anon,authenticated,service_role;
revoke all on function public.get_quiz_attempt_point_summary_v1(uuid,uuid)
  from public,anon,authenticated;
grant execute on function public.get_quiz_attempt_point_summary_v1(uuid,uuid) to service_role;

-- Fail closed on unexplained data; do not turn a deleted/missing attempt into a failure.
do $audit$
begin
  if exists (
    select 1 from public.student_point_events e left join public.quiz_attempts a
      on a.id=e.quiz_attempt_id and a.student_id=e.student_id
    where e.event_kind='quiz_outcome' and
      (a.id is null or a.point_rule_version_snapshot is distinct from 'vocab-points-v1')
  ) then raise exception 'point_attempt_evidence_missing' using errcode='23514'; end if;
  if exists (
    select 1 from (select student_id,sum(delta) total,count(*) n
      from public.student_point_events group by student_id) e
    full join public.student_point_totals t using(student_id)
    where coalesce(e.total,0)<>coalesce(t.total_points,0)
      or coalesce(e.n,0)<>coalesce(t.event_count,0)
  ) then raise exception 'point_total_mismatch' using errcode='23514'; end if;
  if exists (
    select 1 from public.student_point_events original
    join public.student_point_events fix on fix.event_key =
      'passed-only-v1:neutralize:'||original.id::text
    where original.event_kind='quiz_outcome'
      and (fix.event_kind <> 'adjustment' or fix.rule_version <> 'passed-only-v1'
        or fix.reason_code <> 'unpassed_attempt_neutralized'
        or fix.delta <> -original.delta or (to_jsonb(fix) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']) IS DISTINCT FROM (to_jsonb(original) - ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']))
  ) then raise exception 'point_correction_conflict' using errcode='23514'; end if;
  if exists (
    select 1 from public.student_point_events fix
    left join public.student_point_events original
      on fix.event_key='passed-only-v1:restore:'||original.id::text
      and original.event_kind='quiz_outcome'
    left join public.student_point_events neutralized
      on neutralized.event_key='passed-only-v1:neutralize:'||original.id::text
    where fix.event_key like 'passed-only-v1:restore:%'
      and (original.id is null or neutralized.id is null
        or fix.event_kind<>'adjustment' or fix.rule_version<>'passed-only-v1'
        or fix.reason_code<>'passed_attempt_restored' or fix.delta<>original.delta
        or (to_jsonb(fix)-ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at'])
          is distinct from (to_jsonb(original)-ARRAY['id','event_key','event_kind','rule_version','reason_code','delta','occurred_at','created_at']))
  ) then raise exception 'point_correction_conflict' using errcode='23514'; end if;
end;
$audit$;

-- Append compensation for BOTH positive rewards and negative effects.
-- A failed/unfinished attempt contributes zero, not merely a penalty refund.
insert into public.student_point_events (event_key,event_kind,student_id,dataset_id_snapshot,vocab_entry_id_snapshot,
canonical_lexeme_id_snapshot,headword_snapshot,assignment_id,quiz_attempt_id,
quiz_question_id,stage,exam_kind,outcome,rule_version,reason_code,delta,occurred_at)
select 'passed-only-v1:neutralize:'||original.id::text,'adjustment',original.student_id,original.dataset_id_snapshot,original.vocab_entry_id_snapshot,
original.canonical_lexeme_id_snapshot,original.headword_snapshot,original.assignment_id,
original.quiz_attempt_id,original.quiz_question_id,original.stage,original.exam_kind,original.outcome,
  'passed-only-v1','unpassed_attempt_neutralized',(-original.delta)::smallint,clock_timestamp()
from public.student_point_events original
join public.quiz_attempts attempt
  on attempt.id=original.quiz_attempt_id and attempt.student_id=original.student_id
where original.event_kind='quiz_outcome' and original.rule_version='vocab-points-v1'
  and attempt.point_rule_version_snapshot='vocab-points-v1'
  and not (attempt.status='completed' and attempt.passed is true)
on conflict(event_key) do nothing;

do $verify$
begin
  if exists (
    select 1 from (select student_id,sum(delta) total,count(*) n
      from public.student_point_events group by student_id) e
    full join public.student_point_totals t using(student_id)
    where coalesce(e.total,0)<>coalesce(t.total_points,0)
      or coalesce(e.n,0)<>coalesce(t.event_count,0)
  ) then raise exception 'point_total_mismatch_after_correction' using errcode='23514'; end if;
  if exists (
    select 1 from public.student_point_events e join public.quiz_attempts a on a.id=e.quiz_attempt_id
    where a.point_rule_version_snapshot='vocab-points-v1'
      and not(a.status='completed' and a.passed is true)
      and (e.event_kind='quiz_outcome' or e.rule_version='passed-only-v1')
    group by e.quiz_attempt_id having sum(e.delta)<>0
  ) then raise exception 'unpassed_point_effect_remains' using errcode='23514'; end if;
end;
$verify$;

notify pgrst,'reload schema';
commit;

