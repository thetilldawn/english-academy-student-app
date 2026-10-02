-- M04: compact result facts; existing questions, answers, receipts and points remain intact.
begin;

create table private.vocabulary_result_policies (
  attempt_id uuid primary key references public.quiz_attempts(id),
  retention_policy text not null check(retention_policy in ('legacy_answers_preserved','summary_and_mistakes_v1')),
  detail_scope text not null check(detail_scope in ('legacy','initial_mistakes','summary_only')),
  registered_at timestamptz not null default clock_timestamp(),
  finalized_at timestamptz,
  final_reason text check(final_reason in ('completed','expired','student_deleted')),
  check((finalized_at is null) = (final_reason is null))
);
create table private.vocabulary_phase_results (
  attempt_id uuid not null references private.vocabulary_result_policies(attempt_id),
  phase text not null check(phase in ('initial','retry')),
  target_count integer not null check(target_count>0),
  correct_count integer not null check(correct_count>=0),
  wrong_count integer not null check(wrong_count>=0),
  unanswered_count integer not null check(unanswered_count>=0),
  score numeric(5,2) check(score between 0 and 100),
  score_basis text not null check(score_basis in ('initial_total','cumulative_after_retry')),
  passing_score smallint check(passing_score between 0 and 100),
  passed boolean,
  started_at timestamptz,
  ended_at timestamptz,
  end_reason text not null check(end_reason in ('completed','expired','student_deleted','legacy_unknown')),
  evidence text not null check(evidence in ('recorded_answers','legacy_reconstructed')),
  content_hash text not null check(content_hash ~ '^[a-f0-9]{64}$'),
  recorded_at timestamptz not null default clock_timestamp(),
  primary key(attempt_id,phase),
  check(correct_count+wrong_count+unanswered_count=target_count)
);
revoke all on private.vocabulary_result_policies,private.vocabulary_phase_results from public,anon,authenticated,service_role;

create function private.register_vocabulary_result_policy_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  insert into private.vocabulary_result_policies(attempt_id,retention_policy,detail_scope)
    values(new.id,'summary_and_mistakes_v1','initial_mistakes');
  return new;
end;
$$;
create trigger vocabulary_result_policy_after_insert after insert on public.quiz_attempts
for each row execute function private.register_vocabulary_result_policy_v1();

create function private.keep_vocabulary_phase_result_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  raise exception 'result_already_finalized' using errcode='PT409';
end;
$$;
create trigger vocabulary_phase_result_immutable before update or delete on private.vocabulary_phase_results
for each row execute function private.keep_vocabulary_phase_result_v1();

-- Reads the current recorded answers, without writing or inventing absent times.
-- This same builder supports a read-only legacy view; only the freeze function persists.
create function private.build_vocabulary_phase_result_v1(p_attempt_id uuid,p_phase text,p_reason text,p_evidence text)
returns jsonb language plpgsql stable set search_path='' as $$
declare a public.quiz_attempts; n integer; c integer; w integer; total integer;
  initial_correct integer; score_value numeric(5,2); passed_value boolean; basis text;
  start_value timestamptz; end_value timestamptz; passing_value smallint; value jsonb;
begin
  if p_phase is null or p_reason is null or p_evidence is null or p_phase not in ('initial','retry') or p_reason not in ('completed','expired','student_deleted','legacy_unknown')
    or p_evidence not in ('recorded_answers','legacy_reconstructed') then
    raise exception 'invalid_result_phase' using errcode='22023';
  end if;
  select * into a from public.quiz_attempts where id=p_attempt_id;
  if not found then raise exception 'attempt_not_found' using errcode='P0002'; end if;
  if p_phase='initial' and a.initial_completed_at is null and a.status='in_progress' and a.phase='initial' then return null; end if;
  if p_phase='retry' and (a.status='in_progress' or (a.retry_started_at is null and not exists(
    select 1 from public.quiz_questions where attempt_id=a.id and
      num_nonnulls(retry_choice_index,retry_is_correct,retry_answered_at)>0))) then return null; end if;
  select count(*)::integer,count(*) filter(where initial_is_correct is true)::integer into total,initial_correct
    from public.quiz_questions where attempt_id=a.id;
  if total<>a.question_count_snapshot or total=0 then raise exception 'result_question_count_mismatch' using errcode='23514'; end if;
  select count(*)::integer,
    count(*) filter(where s.correct is true and not coalesce(s.timed_out,false))::integer,
    count(*) filter(where s.choice is not null and s.correct is false and not coalesce(s.timed_out,false))::integer
    into n,c,w from public.quiz_questions q cross join lateral
      (values(case when p_phase='initial' then q.initial_choice_index else q.retry_choice_index end,
        case when p_phase='initial' then q.initial_is_correct else q.retry_is_correct end,
        case when p_phase='initial' then q.initial_timed_out else q.retry_timed_out end)) s(choice,correct,timed_out)
    where q.attempt_id=a.id and (p_phase='initial' or q.initial_is_correct is false);
  if n=0 then return null; end if;
  if p_phase='initial' then
    score_value:=coalesce(a.initial_score,round(c::numeric/total*100,2));
    if p_evidence='recorded_answers' and score_value<>round(c::numeric/total*100,2) then
      raise exception 'result_score_mismatch' using errcode='23514'; end if;
    basis:='initial_total'; passing_value:=a.passing_score_snapshot;
    passed_value:=case when p_reason in ('expired','student_deleted') then false
      when p_reason='legacy_unknown' then null else score_value>=passing_value end;
    start_value:=a.started_at;
    end_value:=coalesce(a.initial_completed_at,case when a.retry_started_at is null and not exists(
      select 1 from public.quiz_questions where attempt_id=a.id and num_nonnulls(retry_choice_index,retry_is_correct,retry_answered_at)>0)
      then a.completed_at end);
  else
    score_value:=a.final_score;
    if p_evidence='recorded_answers' and (score_value is null or score_value<>round((initial_correct+c)::numeric/total*100,2)) then
      raise exception 'result_score_mismatch' using errcode='23514'; end if;
    basis:='cumulative_after_retry'; passing_value:=a.retry_passing_score_snapshot;
    passed_value:=a.passed; start_value:=a.retry_started_at; end_value:=a.completed_at;
  end if;
  value:=jsonb_build_object('attempt_id',a.id,'phase',p_phase,'target_count',n,'correct_count',c,'wrong_count',w,'unanswered_count',n-c-w,
    'score',score_value,'score_basis',basis,'passing_score',passing_value,'passed',passed_value,
    'started_at',start_value,'ended_at',end_value,'end_reason',p_reason,'evidence',p_evidence);
  return value||jsonb_build_object('content_hash',encode(extensions.digest(value::text,'sha256'),'hex'));
end;
$$;

create function private.freeze_vocabulary_result_v1(p_attempt_id uuid,p_phase text,p_reason text default 'completed')
returns void language plpgsql set search_path='' as $$
declare a public.quiz_attempts; policy private.vocabulary_result_policies; old private.vocabulary_phase_results;
  value jsonb; row_value private.vocabulary_phase_results; reason_value text;
begin
  select * into a from public.quiz_attempts where id=p_attempt_id for update;
  if not found then raise exception 'attempt_not_found' using errcode='P0002'; end if;
  select * into policy from private.vocabulary_result_policies where attempt_id=a.id for update;
  if not found then return; end if; -- Existing attempts keep their original retention policy and rows.
  if p_reason is null or p_phase is null or p_reason not in ('completed','expired','student_deleted') or p_phase not in ('initial','review','retry','completed') then
    raise exception 'invalid_result_phase' using errcode='22023'; end if;
  if p_phase in ('initial','retry') then
    select * into old from private.vocabulary_phase_results where attempt_id=a.id and phase=p_phase;
    reason_value:=coalesce(old.end_reason,p_reason);
    value:=private.build_vocabulary_phase_result_v1(a.id,p_phase,reason_value,'recorded_answers');
    if value is not null then
      if old.attempt_id is not null then
        if old.content_hash<>value->>'content_hash' then raise exception 'result_already_finalized' using errcode='PT409'; end if;
      else
        row_value:=jsonb_populate_record(null::private.vocabulary_phase_results,value);
        insert into private.vocabulary_phase_results(attempt_id,phase,target_count,correct_count,wrong_count,unanswered_count,
          score,score_basis,passing_score,passed,started_at,ended_at,end_reason,evidence,content_hash)
          values(row_value.attempt_id,row_value.phase,row_value.target_count,row_value.correct_count,row_value.wrong_count,row_value.unanswered_count,
            row_value.score,row_value.score_basis,row_value.passing_score,row_value.passed,row_value.started_at,row_value.ended_at,row_value.end_reason,row_value.evidence,row_value.content_hash);
      end if;
    end if;
  end if;
  if a.status in ('completed','expired') then
    if not exists(select 1 from private.vocabulary_phase_results where attempt_id=a.id and phase='initial') then
      raise exception 'initial_result_missing' using errcode='23514'; end if;
    if a.retry_started_at is not null and not exists(select 1 from private.vocabulary_phase_results where attempt_id=a.id and phase='retry') then
      raise exception 'retry_result_missing' using errcode='23514'; end if;
    if a.completed_at is null then raise exception 'result_end_time_missing' using errcode='23514'; end if;
    if policy.finalized_at is not null and (policy.finalized_at<>a.completed_at or policy.final_reason<>p_reason) then
      raise exception 'result_already_finalized' using errcode='PT409'; end if;
    if policy.finalized_at is null then update private.vocabulary_result_policies
      set finalized_at=a.completed_at,final_reason=p_reason where attempt_id=a.id; end if;
  end if;
end;
$$;

-- Patch only known final definitions; never replay an older whole answer function.
-- The private grader may adjust passed after expiry. Only that call passes false;
-- public/maintenance expiry always freezes. Caller-controlled settings are ignored.
do $expiry_core$
declare src text; def text; anchor text;
begin
  select prosrc,pg_get_functiondef(oid) into src,def from pg_proc
    where oid='private.finalize_vocabulary_expiry_v1(uuid,uuid,timestamp with time zone,boolean)'::regprocedure;
  if md5(src)<>'21ebba80b58033694b3513360674cdd3' then raise exception 'result_expiry_source_changed' using errcode='PT409'; end if;
  def:=replace(def,'private.finalize_vocabulary_expiry_v1(','private.finalize_vocabulary_expiry_v2(');
  def:=replace(def,'p_legacy boolean)','p_legacy boolean, p_record_result boolean)');
  anchor:='  if previous_status=''in_progress'' then perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id); end if;';
  if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>1 then raise exception 'result_expiry_anchor_changed' using errcode='PT409'; end if;
  def:=replace(def,anchor,'  if previous_status=''in_progress'' then'||chr(10)||
    '    perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);'||chr(10)||
    '    if p_record_result then perform private.freeze_vocabulary_result_v1(p_attempt_id,phase_value,''expired''); end if;'||chr(10)||'  end if;');
  execute def;
end;
$expiry_core$;

do $attach$
declare fn regprocedure; src text; def text; anchor text; replacement text; expected text; sig text; inner_anchor text;
begin
  foreach sig in array array[
    'private.submit_vocabulary_answer_v1(uuid,uuid,uuid,text,smallint,boolean,integer)',
    'private.finalize_vocabulary_expiry_v1(uuid,uuid,timestamp with time zone,boolean)',
    'private.grade_vocabulary_base(uuid,uuid,uuid,text,smallint)',
    'private.abandon_student_attempt_v1(uuid,uuid)'] loop
    fn:=sig::regprocedure;
    select prosrc,pg_get_functiondef(oid) into src,def from pg_proc where oid=fn;
    -- Supabase retains CRLF in some older function bodies. Compare the exact
    -- reviewed SQL after line-ending normalization only; do not relax guards.
    src:=replace(src,chr(13)||chr(10),chr(10));
    def:=replace(def,chr(13)||chr(10),chr(10));
    if sig like 'private.submit_%' then
      expected:='877148193d933553175f8b9baea5ebf0';
      anchor:='  perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);'||chr(10)||'  return response;';
      replacement:='  perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);'||chr(10)||
        '  perform private.freeze_vocabulary_result_v1(p_attempt_id,p_phase);'||chr(10)||'  return response;';
    elsif sig like 'private.finalize_%' then
      expected:='21ebba80b58033694b3513360674cdd3';
      anchor:=src;
      replacement:=chr(10)||'begin return private.finalize_vocabulary_expiry_v2(p_student_id,p_attempt_id,p_evaluation_at,p_legacy,true); end;'||chr(10);
    elsif sig like 'private.grade_%' then
      expected:='843550cf4a41bc1dc99bdf4b27d0750d';
      anchor:='private.finalize_expired_quiz_attempt('||chr(10)||'      p_student_id,'||chr(10)||'      p_attempt_id'||chr(10)||'    )';
      replacement:='private.finalize_vocabulary_expiry_v2(p_student_id,p_attempt_id,null,true,false)';
    else
      expected:='fc31f47e2ab0c6dff4c547cf6043bd50';
      anchor:='where id = p_attempt_id;';
      replacement:=anchor||chr(10)||'  perform private.freeze_vocabulary_result_v1(p_attempt_id,attempt_row.phase::text,''student_deleted'');';
    end if;
    if md5(src)<>expected then raise exception 'result_hook_source_changed: %',sig using errcode='PT409'; end if;
    if (length(def)-length(replace(def,anchor,'')))/length(anchor)<>(case when sig like 'private.abandon_%' then 2 else 1 end) then
      raise exception 'result_hook_anchor_changed: %',sig using errcode='PT409'; end if;
    if sig like 'private.submit_%' then
      -- A late answer can expire inside the old grader, which then adjusts
      -- passed in its outer v4 frame. Freeze only after that final adjustment.
      inner_anchor:='      values(q.id,p_phase,p_choice,p_timeout,response);'||chr(10)||'    return response;';
      if (length(def)-length(replace(def,inner_anchor,'')))/length(inner_anchor)<>1 then
        raise exception 'result_expiry_return_anchor_changed' using errcode='PT409'; end if;
      def:=replace(def,inner_anchor,'      values(q.id,p_phase,p_choice,p_timeout,response);'||chr(10)||
        '    perform private.freeze_vocabulary_result_v1(p_attempt_id,p_phase,''expired'');'||chr(10)||'    return response;');
    end if;
    execute replace(def,anchor,replacement);
  end loop;
end;
$attach$;

create function public.read_vocabulary_result_record_v1(p_actor_kind text,p_actor_id uuid,p_attempt_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare a public.quiz_attempts; policy private.vocabulary_result_policies; phases jsonb:='[]'; item jsonb;
  initial_value jsonb; retry_value jsonb; state_value text; final_value boolean; has_retry boolean; payload jsonb;
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if p_actor_kind is null or p_actor_kind not in ('student','admin') or p_actor_id is null then raise exception 'forbidden' using errcode='42501'; end if;
  if p_actor_kind='admin' and not exists(select 1 from public.admin_profiles where user_id=p_actor_id and is_active) then
    raise exception 'forbidden' using errcode='42501'; end if;
  select * into a from public.quiz_attempts where id=p_attempt_id;
  if not found then return null; end if;
  if p_actor_kind='student' and (a.student_id<>p_actor_id or not exists(select 1 from public.students where id=p_actor_id and status='active' and deleted_at is null)) then
    return null; end if;
  select * into policy from private.vocabulary_result_policies where attempt_id=a.id;
  has_retry:=a.retry_started_at is not null or exists(select 1 from public.quiz_questions where attempt_id=a.id and num_nonnulls(retry_choice_index,retry_is_correct,retry_answered_at)>0);
  if policy.attempt_id is not null then
    select coalesce(jsonb_agg(to_jsonb(r)-'recorded_at' order by phase),'[]') into phases from private.vocabulary_phase_results r where attempt_id=a.id;
    if (a.initial_completed_at is not null or a.status<>'in_progress' or a.phase in ('review','retry')) and not exists(
      select 1 from jsonb_array_elements(phases) p where p->>'phase'='initial') then
      raise exception 'initial_result_missing' using errcode='23514'; end if;
    if a.status<>'in_progress' and has_retry and not exists(select 1 from jsonb_array_elements(phases) p where p->>'phase'='retry') then
      raise exception 'retry_result_missing' using errcode='23514'; end if;
  else
    initial_value:=private.build_vocabulary_phase_result_v1(a.id,'initial',
      case when a.status='expired' and not has_retry then 'legacy_unknown' else 'completed' end,'legacy_reconstructed');
    retry_value:=private.build_vocabulary_phase_result_v1(a.id,'retry',
      case when a.status='expired' then 'legacy_unknown' else 'completed' end,'legacy_reconstructed');
    if initial_value is not null then phases:=phases||jsonb_build_array(initial_value); end if;
    if retry_value is not null then phases:=phases||jsonb_build_array(retry_value); end if;
  end if;
  final_value:=a.status in ('completed','expired');
  if policy.attempt_id is not null and final_value<>(policy.finalized_at is not null) then
    raise exception 'result_finalization_mismatch' using errcode='23514'; end if;
  state_value:=case when a.status='expired' then 'expired'
    when a.status='completed' and a.passed then 'completed' when a.status='completed' then 'failed'
    when a.phase='review' then 'retry_waiting' when a.phase='retry' then 'retry_in_progress' else 'initial_in_progress' end;
  payload:=jsonb_build_object('schemaVersion','vocabulary-result-v1','retentionPolicy',coalesce(policy.retention_policy,'legacy_answers_preserved'),
    'detailScope',coalesce(policy.detail_scope,'legacy'),'state',state_value,'finalized',final_value,'retryStarted',has_retry,
    'finalizedAt',case when final_value then a.completed_at else null end,'finalReason',policy.final_reason,'phases',phases,
    'attempt',jsonb_build_object('status',a.status,'phase',a.phase,'attemptNumber',a.attempt_number,'questionCount',a.question_count_snapshot,
      'initialCorrectCount',a.initial_correct_count,'retryCorrectCount',a.retry_correct_count,'unresolvedWrongCount',a.unresolved_wrong_count,
      'initialScore',a.initial_score,'finalScore',a.final_score,'passed',a.passed,'elapsedSeconds',a.elapsed_seconds,
      'startedAt',a.started_at,'initialCompletedAt',a.initial_completed_at,'retryStartedAt',a.retry_started_at,
      'deadlineAt',case when isfinite(a.deadline_at) then a.deadline_at else null end,'completedAt',a.completed_at));
  return payload||jsonb_build_object('resultVersion',encode(extensions.digest(payload::text,'sha256'),'hex'));
end;
$$;

revoke all on function private.register_vocabulary_result_policy_v1(),private.keep_vocabulary_phase_result_v1(),
  private.build_vocabulary_phase_result_v1(uuid,text,text,text),private.freeze_vocabulary_result_v1(uuid,text,text),
  private.finalize_vocabulary_expiry_v2(uuid,uuid,timestamptz,boolean,boolean),
  public.read_vocabulary_result_record_v1(text,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_vocabulary_result_record_v1(text,uuid,uuid) to service_role;
commit;
