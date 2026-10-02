-- APP-20261002-03 / M05. New, device-bound attempts only. No historical rewrite.
begin;

create table private.local_quiz_preparations (
  preparation_id uuid primary key references private.quiz_attempt_preparations(id) on delete cascade,
  device_hash text not null check(device_hash ~ '^[a-f0-9]{64}$'),
  plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$')
);
create table private.local_quiz_runs (
  attempt_id uuid primary key references public.quiz_attempts(id) on delete restrict,
  device_hash text not null check(device_hash ~ '^[a-f0-9]{64}$'),
  preparation_hash text not null check(preparation_hash ~ '^[a-f0-9]{64}$'),
  protocol text not null default 'local_batch_v1' check(protocol='local_batch_v1')
);
create table private.local_quiz_phase_plans (
  attempt_id uuid not null references private.local_quiz_runs(attempt_id) on delete restrict,
  phase text not null check(phase in ('initial','retry')),
  plan jsonb not null check(jsonb_typeof(plan)='array' and jsonb_array_length(plan) between 1 and 500),
  plan_hash text not null check(plan_hash ~ '^[a-f0-9]{64}$'),
  started_at timestamptz not null,
  limit_ms bigint check(limit_ms>=0),
  question_limit_ms integer check(question_limit_ms between 5000 and 600000 and question_limit_ms%1000=0),
  time_policy text not null default 'local-elapsed-v1' check(time_policy='local-elapsed-v1'),
  primary key(attempt_id,phase)
);
create table private.local_quiz_phase_receipts (
  submission_id uuid primary key,
  attempt_id uuid not null,
  phase text not null,
  payload_hash text not null check(payload_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  received_at timestamptz not null default clock_timestamp(),
  unique(attempt_id,phase),
  foreign key(attempt_id,phase) references private.local_quiz_phase_plans(attempt_id,phase) on delete restrict
);
alter table private.local_quiz_preparations enable row level security;
alter table private.local_quiz_runs enable row level security;
alter table private.local_quiz_phase_plans enable row level security;
alter table private.local_quiz_phase_receipts enable row level security;
revoke all on private.local_quiz_preparations,private.local_quiz_runs,private.local_quiz_phase_plans,private.local_quiz_phase_receipts from public,anon,authenticated,service_role;
create trigger local_quiz_runs_immutable before update or delete on private.local_quiz_runs
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger local_quiz_plans_immutable before update or delete on private.local_quiz_phase_plans
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger local_quiz_receipts_immutable before update or delete on private.local_quiz_phase_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.assert_local_quiz_device_v1(p_student_id uuid,p_attempt_id uuid,p_device_hash text)
returns void language plpgsql set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'student_not_found' using errcode='42501'; end if;
  if not exists(select 1 from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id)
    then raise exception 'attempt_not_found' using errcode='P0002'; end if;
  if not exists(select 1 from private.local_quiz_runs where attempt_id=p_attempt_id and device_hash=p_device_hash)
    then raise exception 'local_quiz_device_required' using errcode='PT409'; end if;
end $$;

create function public.get_local_quiz_protocol_v1(p_student_id uuid,p_attempt_id uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'service_required' using errcode='42501'; end if;
  return exists(select 1 from private.local_quiz_runs l join public.quiz_attempts a on a.id=l.attempt_id where a.id=p_attempt_id and a.student_id=p_student_id)
    or exists(select 1 from private.local_quiz_preparations l join private.quiz_attempt_preparations p on p.id=l.preparation_id where p.id=p_attempt_id and p.student_id=p_student_id);
end $$;
revoke all on function public.get_local_quiz_protocol_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_local_quiz_protocol_v1(uuid,uuid) to service_role;

create function public.read_local_quiz_materials_v1(p_student_id uuid,p_assignment_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a public.assignments; items jsonb;
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'service_required' using errcode='42501'; end if;
  a:=private.quiz_preparation_assignment(p_student_id,p_assignment_id);
  if a.range_basis<>'units' or a.question_bank_version is null then return null; end if;
  select jsonb_agg(jsonb_build_object('id',q.id,'content_version_id',q.content_version_id,'vocab_entry_id',q.vocab_entry_id,
    'order_index',q.base_order_index,'direction',q.direction,'prompt',q.prompt,'choices',q.choices,'correct_choice_index',q.correct_choice_index,
    'assignment_question',private.assignment_question_display_v1(q.id)) order by q.base_order_index)
    into items from private.assignment_question_contents_v1 q where q.assignment_id=a.id and q.content_version_id is not null;
  return jsonb_build_object('assignmentId',a.id,'mode',a.quiz_content_mode,'items',coalesce(items,'[]'::jsonb));
end $$;
revoke all on function public.read_local_quiz_materials_v1(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_local_quiz_materials_v1(uuid,uuid) to service_role;

create function private.local_quiz_plan_hash_v1(p_plan jsonb) returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(p_plan::text,'UTF8'),'sha256'),'hex')
$$;

create function private.create_local_quiz_phase_plan_v1(p_attempt_id uuid,p_phase text) returns void
language plpgsql set search_path='' as $$
declare a public.quiz_attempts; settings public.assignments; items jsonb; stamp timestamptz; ms bigint; qm integer; signature jsonb;
begin
  select * into strict a from public.quiz_attempts where id=p_attempt_id;
  select * into strict settings from public.assignments where id=a.assignment_id;
  stamp:=case when p_phase='retry' then a.retry_started_at else a.started_at end;
  select jsonb_agg(jsonb_build_object('id',q.id,'order',row_number,'contentId',q.content_version_id) order by row_number)
    into items from(select q.*,row_number() over(order by q.order_index) from public.quiz_questions q
      where q.attempt_id=p_attempt_id and (p_phase='initial' or q.initial_is_correct is false)) q;
  if items is null or exists(select 1 from jsonb_array_elements(items) x where x->>'contentId' is null)
    then raise exception 'local_quiz_content_missing' using errcode='PT409'; end if;
  ms:=case when isfinite(a.deadline_at) then greatest(0,floor(extract(epoch from(a.deadline_at-stamp))*1000)::bigint) else null end;
  qm:=case when settings.timing_mode='per_question' then settings.question_time_limit_seconds*1000 else null end;
  signature:=jsonb_build_object('protocol','local_batch_v1','attempt',a.id,'phase',p_phase,'items',items,'startedAt',stamp,'limitMs',ms,'questionLimitMs',qm);
  insert into private.local_quiz_phase_plans(attempt_id,phase,plan,plan_hash,started_at,limit_ms,question_limit_ms)
    values(a.id,p_phase,items,private.local_quiz_plan_hash_v1(signature),stamp,ms,qm);
end $$;

create function public.prepare_local_quiz_v1(p_student_id uuid,p_assignment_id uuid,p_device_hash text,p_questions jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing uuid; prep private.quiz_attempt_preparations; binding private.local_quiz_preparations; hashed text; plan jsonb;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  if p_device_hash is null or p_device_hash !~ '^[a-f0-9]{64}$' then raise exception 'local_quiz_device_required' using errcode='22023'; end if;
  select id into existing from public.quiz_attempts where student_id=p_student_id and assignment_id=p_assignment_id and status='in_progress' order by attempt_number desc limit 1;
  if found then
    if exists(select 1 from private.local_quiz_runs where attempt_id=existing) then
      perform private.assert_local_quiz_device_v1(p_student_id,existing,p_device_hash);
      return jsonb_build_object('protocol','local_batch_v1','resumeId',existing);
    end if;
    return jsonb_build_object('protocol','legacy','resumeId',existing);
  end if;
  existing:=public.prepare_quiz_attempt_v1(p_student_id,p_assignment_id,p_questions);
  select * into strict prep from private.quiz_attempt_preparations where id=existing and student_id=p_student_id for update;
  if jsonb_typeof(prep.plan)='array' and prep.begun_id is null then
    -- Preparations issued before M02 keep their immutable format and original
    -- protocol. All newly created preparations already use common references.
    return jsonb_build_object('protocol','legacy','resumeId',prep.id);
  end if;
  plan:=private.resolve_quiz_preparation_plan_v2(prep,true);
  hashed:=private.local_quiz_plan_hash_v1(jsonb_build_object('preparation',prep.id,'fingerprint',prep.fingerprint,'plan',prep.plan));
  select * into binding from private.local_quiz_preparations where preparation_id=prep.id;
  if found and binding.device_hash<>p_device_hash then raise exception 'local_quiz_device_required' using errcode='PT409'; end if;
  insert into private.local_quiz_preparations values(prep.id,p_device_hash,hashed) on conflict do nothing;
  return jsonb_build_object('protocol','local_batch_v1','preparationId',prep.id,'planHash',hashed,'plan',plan,'assignmentId',prep.assignment_id);
end $$;

create function public.read_local_quiz_plan_v1(p_student_id uuid,p_attempt_id uuid,p_device_hash text,p_phase text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p private.local_quiz_phase_plans; a public.quiz_attempts; items jsonb;
begin
  perform private.assert_local_quiz_device_v1(p_student_id,p_attempt_id,p_device_hash);
  select * into p from private.local_quiz_phase_plans where attempt_id=p_attempt_id and phase=p_phase;
  if not found then return null; end if;
  select * into strict a from public.quiz_attempts where id=p_attempt_id;
  select jsonb_agg(i||jsonb_build_object('correctChoiceIndex',q.correct_choice_index,'priorWrongCount',q.prior_wrong_count) order by (i->>'order')::integer)
    into items from jsonb_array_elements(p.plan) i join public.quiz_questions q on q.id=(i->>'id')::uuid;
  return jsonb_build_object('protocol','local_batch_v1','attemptId',p_attempt_id,'phase',p.phase,'planHash',p.plan_hash,
    'startedAt',p.started_at,'serverNow',clock_timestamp(),'limitMs',p.limit_ms,'questionLimitMs',p.question_limit_ms,'timePolicy',p.time_policy,
    'items',items,'status',a.status,'officialPhase',a.phase);
end $$;

create function public.begin_local_quiz_v1(p_student_id uuid,p_preparation_id uuid,p_device_hash text,p_plan_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.quiz_attempt_preparations; b private.local_quiz_preparations; created uuid;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  if exists(select 1 from private.local_quiz_runs where attempt_id=p_preparation_id) then
    perform private.assert_local_quiz_device_v1(p_student_id,p_preparation_id,p_device_hash);
    if not exists(select 1 from private.local_quiz_runs where attempt_id=p_preparation_id and preparation_hash=p_plan_hash)
      then raise exception 'local_quiz_preparation_conflict' using errcode='PT409'; end if;
    return public.read_local_quiz_plan_v1(p_student_id,p_preparation_id,p_device_hash,'initial');
  end if;
  select * into p from private.quiz_attempt_preparations where id=p_preparation_id and student_id=p_student_id for update;
  select * into b from private.local_quiz_preparations where preparation_id=p_preparation_id;
  if p.id is null or b.preparation_id is null then raise exception 'local_quiz_preparation_missing' using errcode='P0002'; end if;
  if b.device_hash is distinct from p_device_hash or b.plan_hash is distinct from p_plan_hash
    then raise exception 'local_quiz_preparation_conflict' using errcode='PT409'; end if;
  if p.begun_id is not null then return public.read_local_quiz_plan_v1(p_student_id,p.begun_id,p_device_hash,'initial'); end if;
  if exists(select 1 from public.quiz_attempts where student_id=p_student_id and assignment_id=p.assignment_id and status='in_progress')
    then raise exception 'local_quiz_attempt_already_started' using errcode='PT409'; end if;
  created:=private.begin_local_quiz_core_v1(p_student_id,p_preparation_id);
  if created<>p.id then raise exception 'local_quiz_attempt_already_started' using errcode='PT409'; end if;
  insert into private.local_quiz_runs(attempt_id,device_hash,preparation_hash) values(created,p_device_hash,p_plan_hash);
  perform private.create_local_quiz_phase_plan_v1(created,'initial');
  return public.read_local_quiz_plan_v1(p_student_id,created,p_device_hash,'initial');
end $$;

create function public.begin_local_quiz_retry_v1(p_student_id uuid,p_attempt_id uuid,p_device_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.quiz_attempts; settings public.assignments; stamp timestamptz;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  perform private.assert_local_quiz_device_v1(p_student_id,p_attempt_id,p_device_hash);
  select * into strict a from public.quiz_attempts where id=p_attempt_id for update;
  if exists(select 1 from private.local_quiz_phase_plans where attempt_id=p_attempt_id and phase='retry')
    then return public.read_local_quiz_plan_v1(p_student_id,p_attempt_id,p_device_hash,'retry'); end if;
  if a.status<>'in_progress' or a.phase<>'review' or not a.retry_enabled_snapshot
    or not exists(select 1 from private.local_quiz_phase_receipts where attempt_id=p_attempt_id and phase='initial')
    then raise exception 'local_quiz_retry_unavailable' using errcode='PT409'; end if;
  select * into strict settings from public.assignments where id=a.assignment_id;
  stamp:=clock_timestamp();
  update public.quiz_attempts set phase='retry',retry_started_at=stamp,current_question_started_at=stamp,
    deadline_at=case when settings.timing_mode='none' then coalesce(settings.available_until,'infinity'::timestamptz) else stamp+make_interval(secs=>a.time_limit_seconds_snapshot) end
    where id=a.id;
  perform private.create_local_quiz_phase_plan_v1(a.id,'retry');
  return public.read_local_quiz_plan_v1(p_student_id,a.id,p_device_hash,'retry');
end $$;

create function private.project_local_quiz_legacy_state_v1(p_student_id uuid,p_attempt_id uuid) returns void
language plpgsql set search_path='' as $$
declare target record; unresolved_value boolean; old public.student_vocab_state; stamp timestamptz:=clock_timestamp(); count_value integer;
begin
  -- Compatibility counts are failed attempts, not the M03 per-answer count.
  for target in select q.vocab_entry_id,array_agg(distinct private.quiz_vocabulary_meaning_v1(q.id)->>'wordKey') word_keys,
    bool_or(q.initial_is_correct is false and coalesce(q.retry_is_correct,false) is false) failed
    from public.quiz_questions q where q.attempt_id=p_attempt_id and q.vocab_entry_id is not null group by q.vocab_entry_id loop
    select bool_or(s.unresolved) into unresolved_value from private.current_vocabulary_meaning_states_v1(p_student_id) s where s.word_key=any(target.word_keys);
    -- M03 intentionally omits state for a correct word with no prior difficulty.
    unresolved_value:=coalesce(unresolved_value,false);
    select * into old from public.student_vocab_state where student_id=p_student_id and vocab_entry_id=target.vocab_entry_id for update;
    count_value:=case when not unresolved_value then 0 else greatest(1,coalesce(old.unresolved_wrong_count,0)+case when target.failed and old.last_attempt_id is distinct from p_attempt_id then 1 else 0 end) end;
    insert into public.student_vocab_state(student_id,vocab_entry_id,unresolved_wrong_count,last_wrong_at,resolved_at,last_attempt_id,last_evaluated_at)
      values(p_student_id,target.vocab_entry_id,count_value,case when unresolved_value then case when target.failed then stamp else coalesce(old.last_wrong_at,stamp) end else old.last_wrong_at end,
        case when unresolved_value then null else stamp end,p_attempt_id,greatest(stamp,old.last_evaluated_at))
      on conflict(student_id,vocab_entry_id) do update set unresolved_wrong_count=excluded.unresolved_wrong_count,last_wrong_at=excluded.last_wrong_at,
        resolved_at=excluded.resolved_at,last_attempt_id=excluded.last_attempt_id,last_evaluated_at=excluded.last_evaluated_at;
  end loop;
end $$;
revoke all on function private.project_local_quiz_legacy_state_v1(uuid,uuid) from public,anon,authenticated,service_role;

create function public.submit_local_quiz_phase_v1(p_student_id uuid,p_attempt_id uuid,p_phase text,p_device_hash text,
  p_plan_hash text,p_submission_id uuid,p_answers jsonb,p_completion jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a public.quiz_attempts; p private.local_quiz_phase_plans; old private.local_quiz_phase_receipts;
  hash text; item jsonb; expected jsonb; n integer:=0; elapsed bigint; opened bigint; previous_elapsed bigint:=-100;
  choice smallint; kind text; answer_hash text; is_correct boolean; excluded jsonb; accepted jsonb:='[]'; response jsonb;
  done_ms bigint; finish_reason text; finished_at timestamptz; initial_count integer; retry_count integer; total integer; wrong integer;
  initial_score_value numeric(5,2); final_score_value numeric(5,2); needs_retry boolean; official_pass boolean; seq bigint;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  perform private.assert_local_quiz_device_v1(p_student_id,p_attempt_id,p_device_hash);
  if p_phase is null or p_phase not in ('initial','retry') or p_submission_id is null or jsonb_typeof(p_answers) is distinct from 'array'
    or jsonb_array_length(p_answers) not between 1 and 500 or jsonb_typeof(p_completion) is distinct from 'object'
    then raise exception 'local_quiz_batch_invalid' using errcode='22023'; end if;
  select * into strict a from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id for update;
  select * into p from private.local_quiz_phase_plans where attempt_id=a.id and phase=p_phase;
  if p.plan_hash is null or p.plan_hash is distinct from p_plan_hash then raise exception 'local_quiz_plan_conflict' using errcode='PT409'; end if;
  hash:=private.local_quiz_plan_hash_v1(jsonb_build_object('attempt',a.id,'phase',p_phase,'planHash',p_plan_hash,'answers',p_answers,'completion',p_completion));
  select * into old from private.local_quiz_phase_receipts where submission_id=p_submission_id or (attempt_id=a.id and phase=p_phase);
  if found then
    if old.submission_id<>p_submission_id or old.attempt_id<>a.id or old.phase<>p_phase or old.payload_hash<>hash
      then raise exception 'local_quiz_submission_conflict' using errcode='PT409'; end if;
    return old.result;
  end if;
  if a.status<>'in_progress' or a.phase::text<>p_phase then raise exception 'local_quiz_not_active' using errcode='PT409'; end if;
  if jsonb_array_length(p_answers)<>jsonb_array_length(p.plan) then raise exception 'local_quiz_answers_incomplete' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_completion))<>2 or not(p_completion ?& array['elapsedMs','reason']) or p_completion->>'elapsedMs' !~ '^\d{1,13}$' or p_completion->>'reason' not in ('answered','deadline')
    then raise exception 'local_quiz_completion_invalid' using errcode='22023'; end if;
  done_ms:=(p_completion->>'elapsedMs')::bigint;finish_reason:=p_completion->>'reason';
  if done_ms is null or finish_reason is null or done_ms>greatest(0,floor(extract(epoch from(clock_timestamp()-p.started_at))*1000)::bigint)+1000
    then raise exception 'local_quiz_time_invalid' using errcode='22023'; end if;
  if finish_reason='deadline' and (p.limit_ms is null or done_ms<>p.limit_ms)
    or finish_reason='answered' and p.limit_ms is not null and done_ms>p.limit_ms
    then raise exception 'local_quiz_time_invalid' using errcode='22023'; end if;
  -- Validate the complete batch before any answer or official result is written.
  for item in select value from jsonb_array_elements(p_answers) loop
    expected:=p.plan->n;n:=n+1;
    if jsonb_typeof(item) is distinct from 'object' or (select count(*) from jsonb_object_keys(item))<>6 or not(item ?& array['id','order','kind','choice','elapsedMs','openedMs']) or item->>'id' is distinct from expected->>'id' or item->>'order' is distinct from n::text
      or item->>'elapsedMs' !~ '^\d{1,13}$' or item->>'openedMs' !~ '^\d{1,13}$'
      or item->>'kind' not in ('answer','timeout','unanswered')
      then raise exception 'local_quiz_answer_invalid' using errcode='22023'; end if;
    elapsed:=(item->>'elapsedMs')::bigint;opened:=(item->>'openedMs')::bigint;kind:=item->>'kind';
    if elapsed is null or opened is null or kind is null or elapsed<opened or elapsed>done_ms or elapsed<previous_elapsed
      then raise exception 'local_quiz_time_invalid' using errcode='22023'; end if;
    if kind='unanswered' then
      if finish_reason<>'deadline' or elapsed<>done_ms or item->'choice'<>'null'::jsonb
        then raise exception 'local_quiz_unanswered_invalid' using errcode='22023'; end if;
    else
      if opened<>previous_elapsed+100 or p.limit_ms is not null and elapsed>p.limit_ms
        or p.question_limit_ms is not null and elapsed-opened>p.question_limit_ms
        then raise exception 'local_quiz_time_invalid' using errcode='22023'; end if;
      if kind='timeout' and (p.question_limit_ms is null or elapsed-opened<>p.question_limit_ms or item->'choice'<>'null'::jsonb)
        then raise exception 'local_quiz_timeout_invalid' using errcode='22023'; end if;
      if kind='answer' and (item->>'choice' is null or item->>'choice' !~ '^[0-3]$')
        then raise exception 'local_quiz_choice_invalid' using errcode='22023'; end if;
    end if;
    previous_elapsed:=elapsed;
    if exists(select 1 from public.quiz_questions q where q.id=(item->>'id')::uuid and
      (p_phase='initial' and num_nonnulls(q.initial_choice_index,q.initial_is_correct,q.initial_answered_at)>0 or
       p_phase='retry' and num_nonnulls(q.retry_choice_index,q.retry_is_correct,q.retry_answered_at)>0))
      then raise exception 'local_quiz_answer_conflict' using errcode='PT409'; end if;
  end loop;
  if previous_elapsed<>done_ms then raise exception 'local_quiz_completion_invalid' using errcode='22023'; end if;
  perform private.preserve_vocabulary_legacy_questions_v1(a.id);
  select jsonb_agg(jsonb_build_object('id',i->>'id','phase',p_phase)) into excluded from jsonb_array_elements(p_answers) i;
  for item in select value from jsonb_array_elements(p_answers) loop
    choice:=(item->>'choice')::smallint;kind:=item->>'kind';elapsed:=(item->>'elapsedMs')::bigint;
    select kind='answer' and q.correct_choice_index=choice into strict is_correct from public.quiz_questions q where q.id=(item->>'id')::uuid and q.attempt_id=a.id for update;
    if p_phase='initial' then
      update public.quiz_questions set initial_choice_index=choice,initial_is_correct=is_correct,initial_timed_out=kind='timeout',
        initial_answered_at=p.started_at+elapsed*interval '1 millisecond' where id=(item->>'id')::uuid;
    else
      update public.quiz_questions set retry_choice_index=choice,retry_is_correct=is_correct,retry_timed_out=kind='timeout',
        retry_answered_at=p.started_at+elapsed*interval '1 millisecond' where id=(item->>'id')::uuid;
    end if;
    answer_hash:=encode(extensions.digest(convert_to(concat_ws('|',item->>'id',item->>'order',kind,coalesce(item->>'choice','-'),item->>'elapsedMs',item->>'openedMs'),'UTF8'),'sha256'),'hex');
    perform private.accept_vocabulary_answer_v1(p_student_id,a.id,(item->>'id')::uuid,p_phase,choice,kind<>'answer',
      jsonb_build_object('submissionId',p_submission_id,'answerHash',answer_hash),case when kind='unanswered' then 'expiry' else 'answer' end,excluded);
    select server_sequence into strict seq from private.vocabulary_answer_receipts where quiz_question_id=(item->>'id')::uuid and phase=p_phase;
    accepted:=accepted||jsonb_build_array(jsonb_build_object('id',item->>'id','answerHash',answer_hash,'sequence',seq));
  end loop;
  select count(*),count(*) filter(where initial_is_correct is true),count(*) filter(where initial_is_correct is false and retry_is_correct is true)
    into total,initial_count,retry_count from public.quiz_questions where attempt_id=a.id;
  wrong:=total-initial_count-retry_count;initial_score_value:=round(initial_count*100.0/total,2);final_score_value:=round((initial_count+retry_count)*100.0/total,2);
  needs_retry:=p_phase='initial' and initial_score_value<a.passing_score_snapshot and wrong>0 and a.retry_enabled_snapshot and finish_reason<>'deadline';
  official_pass:=case when finish_reason='deadline' then false when p_phase='retry' then final_score_value>=a.retry_passing_score_snapshot else initial_score_value>=a.passing_score_snapshot end;
  finished_at:=p.started_at+done_ms*interval '1 millisecond';
  update public.quiz_attempts set phase=case when needs_retry then 'review'::public.attempt_phase else 'completed'::public.attempt_phase end,
    status=case when needs_retry then 'in_progress'::public.attempt_status when finish_reason='deadline' then 'expired'::public.attempt_status else 'completed'::public.attempt_status end,
    initial_correct_count=initial_count,retry_correct_count=retry_count,unresolved_wrong_count=wrong,
    initial_score=initial_score_value,final_score=case when needs_retry then null else final_score_value end,passed=case when needs_retry then null else official_pass end,
    initial_completed_at=case when p_phase='initial' then finished_at else a.initial_completed_at end,
    completed_at=case when needs_retry then null else finished_at end,
    elapsed_seconds=floor(done_ms/1000.0)::integer+case when p_phase='retry' then greatest(0,floor(extract(epoch from(a.initial_completed_at-a.started_at)))::integer) else 0 end
    where id=a.id;
  perform private.project_local_quiz_legacy_state_v1(p_student_id,a.id);
  perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,a.id);
  perform private.freeze_vocabulary_result_v1(a.id,p_phase,case when finish_reason='deadline' then 'expired' else 'completed' end);
  response:=jsonb_build_object('protocol','local_batch_v1','submissionId',p_submission_id,'payloadHash',hash,'phase',p_phase,'planHash',p_plan_hash,'accepted',accepted,
    'result',public.read_vocabulary_result_record_v1('student',p_student_id,a.id),
    'retryTargets',case when needs_retry then (select jsonb_agg(id order by order_index) from public.quiz_questions where attempt_id=a.id and initial_is_correct is false) else '[]'::jsonb end);
  insert into private.local_quiz_phase_receipts(submission_id,attempt_id,phase,payload_hash,result) values(p_submission_id,a.id,p_phase,hash,response);
  return response;
end $$;

revoke all on function private.assert_local_quiz_device_v1(uuid,uuid,text),private.local_quiz_plan_hash_v1(jsonb),private.create_local_quiz_phase_plan_v1(uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.prepare_local_quiz_v1(uuid,uuid,text,jsonb),public.read_local_quiz_plan_v1(uuid,uuid,text,text),public.begin_local_quiz_v1(uuid,uuid,text,text),
  public.begin_local_quiz_retry_v1(uuid,uuid,text),public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.prepare_local_quiz_v1(uuid,uuid,text,jsonb),public.read_local_quiz_plan_v1(uuid,uuid,text,text),public.begin_local_quiz_v1(uuid,uuid,text,text),
  public.begin_local_quiz_retry_v1(uuid,uuid,text),public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb) to service_role;

-- Preserve invoker rights on legacy endpoints without exposing the private run table.
create function private.assert_legacy_quiz_protocol_v1(p_attempt_id uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from private.local_quiz_runs where attempt_id=p_attempt_id) then
    raise exception 'local_quiz_batch_required' using errcode='PT409';
  end if;
end $$;
revoke all on function private.assert_legacy_quiz_protocol_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function private.assert_legacy_quiz_protocol_v1(uuid) to service_role;

-- Legacy guards are appended from the verified M04 function definitions.
CREATE OR REPLACE FUNCTION private.begin_local_quiz_core_v1(p_student_id uuid, p_preparation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.quiz_attempt_preparations; a public.assignments; existing uuid; at_time timestamptz; next_number integer;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  select id into existing from public.quiz_attempts where id=p_preparation_id and student_id=p_student_id;
  if found then return existing; end if;
  select * into p from private.quiz_attempt_preparations where id=p_preparation_id and student_id=p_student_id and kind='initial' for update;
  if not found then raise exception 'preparation_not_found' using errcode='P0002'; end if;
  if p.begun_id is not null then return p.begun_id; end if;
  select id into existing from public.quiz_attempts where student_id=p_student_id and assignment_id=p.assignment_id and status='in_progress'
    order by attempt_number desc limit 1;
  if found then
    update private.quiz_attempt_preparations set begun_id=existing where id=p.id;
    return existing;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'preparation_expired' using errcode='PT409'; end if;
  a:=private.quiz_preparation_assignment(p_student_id,p.assignment_id);
  if private.quiz_preparation_fingerprint(a)<>p.fingerprint then raise exception 'preparation_changed' using errcode='PT409'; end if;
  p.plan:=private.compact_initial_quiz_plan_v2(p.assignment_id,p.plan);
  p.plan:=jsonb_build_object('contentStorageVersion',2,'questions',private.resolve_quiz_preparation_plan_v2(p,true));
  select coalesce(max(attempt_number),0)+1 into next_number from public.quiz_attempts where student_id=p_student_id and assignment_id=a.id;
  at_time:=clock_timestamp();
  insert into public.quiz_attempts(id,student_id,assignment_id,attempt_number,status,started_at,deadline_at,current_question_started_at,
    question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values(p.id,p_student_id,a.id,next_number,'in_progress',at_time,
      case when a.timing_mode='none' then coalesce(a.available_until,'infinity'::timestamptz) else at_time+make_interval(secs=>a.time_limit_seconds) end,
      at_time,a.question_count,a.time_limit_seconds,a.passing_score,a.passing_basis);
  insert into public.quiz_questions(id,attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index,content_version_id)
    select (q->>'id')::uuid,p.id,(q->>'vocab_entry_id')::bigint,(q->>'assignment_question_id')::uuid,(q->>'order_index')::integer,
      (q->>'direction')::public.question_direction,q->>'prompt',q->'choices',(q->>'correct_choice_index')::smallint,(q->>'content_version_id')::uuid from jsonb_array_elements(p.plan->'questions') q;
  update private.quiz_attempt_preparations set begun_id=p.id where id=p.id;
  return p.id;
end;
$function$
;
revoke all on function private.begin_local_quiz_core_v1(uuid,uuid) from public,anon,authenticated,service_role;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.begin_prepared_quiz_v1(uuid,uuid)'::regprocedure; if md5(src)<>'9e4fe3107fef2387a2e94b5b115a4552' then raise exception 'local_quiz_legacy_source_changed: public.begin_prepared_quiz_v1' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.begin_prepared_quiz_v1(p_student_id uuid, p_preparation_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p private.quiz_attempt_preparations; a public.assignments; existing uuid; at_time timestamptz; next_number integer;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  if exists(select 1 from private.local_quiz_preparations where preparation_id=p_preparation_id) then raise exception 'local_quiz_batch_required' using errcode='PT409'; end if;
  select id into existing from public.quiz_attempts where id=p_preparation_id and student_id=p_student_id;
  if found then return existing; end if;
  select * into p from private.quiz_attempt_preparations where id=p_preparation_id and student_id=p_student_id and kind='initial' for update;
  if not found then raise exception 'preparation_not_found' using errcode='P0002'; end if;
  if p.begun_id is not null then return p.begun_id; end if;
  select id into existing from public.quiz_attempts where student_id=p_student_id and assignment_id=p.assignment_id and status='in_progress'
    order by attempt_number desc limit 1;
  if found then
    update private.quiz_attempt_preparations set begun_id=existing where id=p.id;
    return existing;
  end if;
  if p.expires_at<=clock_timestamp() then raise exception 'preparation_expired' using errcode='PT409'; end if;
  a:=private.quiz_preparation_assignment(p_student_id,p.assignment_id);
  if private.quiz_preparation_fingerprint(a)<>p.fingerprint then raise exception 'preparation_changed' using errcode='PT409'; end if;
  p.plan:=private.compact_initial_quiz_plan_v2(p.assignment_id,p.plan);
  p.plan:=jsonb_build_object('contentStorageVersion',2,'questions',private.resolve_quiz_preparation_plan_v2(p,true));
  select coalesce(max(attempt_number),0)+1 into next_number from public.quiz_attempts where student_id=p_student_id and assignment_id=a.id;
  at_time:=clock_timestamp();
  insert into public.quiz_attempts(id,student_id,assignment_id,attempt_number,status,started_at,deadline_at,current_question_started_at,
    question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values(p.id,p_student_id,a.id,next_number,'in_progress',at_time,
      case when a.timing_mode='none' then coalesce(a.available_until,'infinity'::timestamptz) else at_time+make_interval(secs=>a.time_limit_seconds) end,
      at_time,a.question_count,a.time_limit_seconds,a.passing_score,a.passing_basis);
  insert into public.quiz_questions(id,attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index,content_version_id)
    select (q->>'id')::uuid,p.id,(q->>'vocab_entry_id')::bigint,(q->>'assignment_question_id')::uuid,(q->>'order_index')::integer,
      (q->>'direction')::public.question_direction,q->>'prompt',q->'choices',(q->>'correct_choice_index')::smallint,(q->>'content_version_id')::uuid from jsonb_array_elements(p.plan->'questions') q;
  update private.quiz_attempt_preparations set begun_id=p.id where id=p.id;
  return p.id;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.prepare_quiz_attempt_v1(uuid,uuid,jsonb)'::regprocedure; if md5(src)<>'1a1178a3208f07a71b780be2500ef0c7' then raise exception 'local_quiz_legacy_source_changed: public.prepare_quiz_attempt_v1' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.prepare_quiz_attempt_v1(p_student_id uuid, p_assignment_id uuid, p_questions jsonb DEFAULT NULL::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare a public.assignments; p private.quiz_attempt_preparations; plan jsonb; fingerprint text; existing uuid;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  select id into existing from public.quiz_attempts where student_id=p_student_id and assignment_id=p_assignment_id and status='in_progress'
    and (phase='review' or deadline_at>clock_timestamp() or exists(select 1 from private.local_quiz_runs l where l.attempt_id=public.quiz_attempts.id)) order by attempt_number desc limit 1;
  if found then return existing; end if;
  a:=private.quiz_preparation_assignment(p_student_id,p_assignment_id);
  fingerprint:=private.quiz_preparation_fingerprint(a);
  select * into p from private.quiz_attempt_preparations where student_id=p_student_id and kind='initial' and request_key=p_assignment_id::text for update;
  if found and p.begun_id is null and p.expires_at>clock_timestamp() and p.fingerprint=fingerprint then return p.id; end if;
  if a.range_basis='units' and a.question_bank_version is not null then
    select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'assignment_question_id',q.id,'vocab_entry_id',q.vocab_entry_id,
      'order_index',q.n,'direction',q.direction,'prompt',q.prompt,'choices',q.choices,'correct_choice_index',q.correct_choice_index) order by q.n)
      into plan from (select b.*,row_number() over(order by
        case when a.question_order_mode in ('fixed','ascending') then b.base_order_index end asc,
        case when a.question_order_mode='descending' then b.base_order_index end desc,
        case when a.question_order_mode='random' then random() end,b.base_order_index) n
        from private.assignment_question_contents_v1 b where b.assignment_id=a.id) q;
    if coalesce(jsonb_array_length(plan),0)<>a.question_count then raise exception 'question_bank_incomplete' using errcode='22023'; end if;
  else
    plan:=private.quiz_preparation_legacy_plan(a,p_questions);
  end if;
  -- Only obsolete private preparations are discarded; no attempt or result rows are deleted.
  delete from private.quiz_attempt_preparations where student_id=p_student_id and kind='initial' and request_key=p_assignment_id::text;
  insert into private.quiz_attempt_preparations(student_id,assignment_id,kind,request_key,fingerprint,plan)
    values(p_student_id,p_assignment_id,'initial',p_assignment_id::text,fingerprint,private.compact_initial_quiz_plan_v2(p_assignment_id,plan)) returning id into existing;
  return existing;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.submit_vocabulary_answer_v1(uuid,uuid,uuid,text,smallint,boolean,integer)'::regprocedure; if md5(src)<>'5a84e4d681c2d366f3782da4567f3db9' then raise exception 'local_quiz_legacy_source_changed: private.submit_vocabulary_answer_v1' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.submit_vocabulary_answer_v1(p_student_id uuid, p_attempt_id uuid, p_question_id uuid, p_phase text, p_choice smallint, p_timeout boolean, p_version integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare q public.quiz_questions; receipt private.vocabulary_answer_receipts; expired_result private.vocabulary_expired_answer_results; response jsonb;
begin
  if p_phase is null or p_phase not in ('initial','retry') or p_timeout is null or p_choice is null or p_choice not between 0 and 3 then
    raise exception 'invalid_answer_request' using errcode='22023'; end if;
  perform private.lock_vocabulary_student_v1(p_student_id);
  perform private.assert_legacy_quiz_protocol_v1(p_attempt_id);

  if not exists(select 1 from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id) then
    raise exception 'attempt_not_found' using errcode='P0002'; end if;
  select * into q from public.quiz_questions where id=p_question_id and attempt_id=p_attempt_id;
  if not found then raise exception 'question_not_found' using errcode='P0002'; end if;
  select * into receipt from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=p_phase;
  if found then
    if receipt.student_id<>p_student_id or receipt.attempt_id<>p_attempt_id then raise exception 'question_not_found' using errcode='P0002'; end if;
    if receipt.request_kind='expiry' then
      select * into expired_result from private.vocabulary_expired_answer_results where quiz_question_id=q.id and phase=p_phase;
      if found then
        if expired_result.requested_choice is distinct from p_choice or expired_result.requested_timeout is distinct from p_timeout then
          raise exception 'question_already_answered' using errcode='22023'; end if;
        return expired_result.result;
      end if;
      return receipt.result;
    end if;
    if receipt.requested_choice is distinct from p_choice or receipt.requested_timeout is distinct from p_timeout then
      raise exception 'question_already_answered' using errcode='22023'; end if;
    return receipt.result;
  end if;
  if (p_phase='initial' and num_nonnulls(q.initial_choice_index,q.initial_is_correct,q.initial_answered_at)>0)
    or (p_phase='retry' and num_nonnulls(q.retry_choice_index,q.retry_is_correct,q.retry_answered_at)>0) then
    raise exception 'question_already_answered' using errcode='22023'; end if;
  perform private.preserve_vocabulary_legacy_questions_v1(p_attempt_id);
  response:=case p_version
    when 1 then private.grade_vocabulary_base(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice)
    when 2 then private.grade_vocabulary_v2(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    when 3 then private.grade_vocabulary_v3(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    when 4 then private.grade_vocabulary_v4(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    else null end;
  if response is null then raise exception 'invalid_answer_version' using errcode='22023'; end if;
  if exists(select 1 from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=p_phase and request_kind='expiry') then
    insert into private.vocabulary_expired_answer_results(quiz_question_id,phase,requested_choice,requested_timeout,result)
      values(q.id,p_phase,p_choice,p_timeout,response);
    perform private.freeze_vocabulary_result_v1(p_attempt_id,p_phase,'expired');
    return response;
  end if;
  perform private.accept_vocabulary_answer_v1(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout,response);
  perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);
  perform private.freeze_vocabulary_result_v1(p_attempt_id,p_phase);
  return response;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.start_quiz_retry(uuid,uuid)'::regprocedure; if md5(src)<>'7742b9dd59ab8f21a2dbc3365e8450e0' then raise exception 'local_quiz_legacy_source_changed: public.start_quiz_retry' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.start_quiz_retry(p_student_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  attempt_row public.quiz_attempts%rowtype;
  initial_unanswered integer;
  initial_wrong integer;
  retry_unanswered integer;
  next_question_id uuid;
  retry_start_time timestamptz;
  retry_deadline timestamptz;
begin
  perform 1 from public.students where id=p_student_id for update;
  perform private.assert_legacy_quiz_protocol_v1(p_attempt_id);

  select *
    into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;

  if attempt_row.phase = 'retry' then
    if attempt_row.deadline_at <= now() then
      raise exception 'attempt_expired' using errcode = '22023';
    end if;

    select id
      into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
    order by order_index
    limit 1;

    return jsonb_build_object(
      'phase', 'retry',
      'nextQuestionId', next_question_id,
      'deadlineAt', attempt_row.deadline_at
    );
  end if;

  if attempt_row.phase <> 'review' then
    raise exception 'attempt_not_in_review' using errcode = '22023';
  end if;

  select
    count(*) filter (where initial_choice_index is null),
    count(*) filter (where initial_is_correct is false),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    )
  into
    initial_unanswered,
    initial_wrong,
    retry_unanswered
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if initial_unanswered > 0 then
    raise exception 'initial_phase_incomplete' using errcode = '22023';
  end if;

  if initial_wrong = 0 or retry_unanswered = 0 then
    raise exception 'retry_not_required' using errcode = '22023';
  end if;

  select id
    into next_question_id
  from public.quiz_questions
  where attempt_id = p_attempt_id
    and initial_is_correct is false
    and retry_choice_index is null
  order by order_index
  limit 1;

  retry_start_time := clock_timestamp();
  retry_deadline := case
    when exists (
      select 1
      from public.assignments as assignment
      where assignment.id = attempt_row.assignment_id
        and assignment.timing_mode = 'none'
    ) then coalesce(
      (
        select assignment.available_until
        from public.assignments as assignment
        where assignment.id = attempt_row.assignment_id
      ),
      'infinity'::timestamptz
    )
    else retry_start_time
      + make_interval(secs => attempt_row.time_limit_seconds_snapshot)
  end;

  update public.quiz_attempts
  set phase = 'retry',
      retry_started_at = retry_start_time,
      deadline_at = retry_deadline,
      current_question_started_at = retry_start_time
  where id = p_attempt_id;

  return jsonb_build_object(
    'phase', 'retry',
    'nextQuestionId', next_question_id,
    'deadlineAt', retry_deadline
  );
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.start_quiz_retry_v2(uuid,uuid)'::regprocedure; if md5(src)<>'6cc94fa75b827a3f810e89d2c9c45303' then raise exception 'local_quiz_legacy_source_changed: public.start_quiz_retry_v2' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.start_quiz_retry_v2(p_student_id uuid, p_attempt_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  retry_enabled_value boolean;
begin
  perform 1 from public.students where id=p_student_id for update;
  perform private.assert_legacy_quiz_protocol_v1(p_attempt_id);

  select attempt.retry_enabled_snapshot
  into retry_enabled_value
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if not retry_enabled_value then
    raise exception 'retry_disabled' using errcode = '22023';
  end if;

  return public.start_quiz_retry(p_student_id, p_attempt_id);
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.resume_quiz_after_feedback_v1(uuid,uuid,uuid,text)'::regprocedure; if md5(src)<>'3109cb29a26328857ec324d9cd1a9f7c' then raise exception 'local_quiz_legacy_source_changed: public.resume_quiz_after_feedback_v1' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.resume_quiz_after_feedback_v1(p_student_id uuid, p_attempt_id uuid, p_next_question_id uuid, p_next_phase text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  attempt_row public.quiz_attempts%rowtype;
  timing_mode_value text;
  per_question_seconds integer;
  current_question_id uuid;
  resume_requested_at timestamptz := clock_timestamp();
  adjusted_started_at timestamptz;
  unused_feedback interval;
  next_deadline timestamptz;
begin
  perform 1 from public.students where id=p_student_id for update;
  perform private.assert_legacy_quiz_protocol_v1(p_attempt_id);

  if p_next_phase is null or p_next_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;

  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;
  if attempt_row.phase::text <> p_next_phase then
    raise exception 'attempt_phase_mismatch' using errcode = '22023';
  end if;

  if p_next_phase = 'initial' then
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_choice_index is null
    order by question.order_index
    limit 1;
  else
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_is_correct is false
      and question.retry_choice_index is null
    order by question.order_index
    limit 1;
  end if;

  if current_question_id is distinct from p_next_question_id then
    raise exception 'next_question_mismatch' using errcode = '22023';
  end if;

  select assignment.timing_mode, assignment.question_time_limit_seconds
  into timing_mode_value, per_question_seconds
  from public.assignments as assignment
  where assignment.id = attempt_row.assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if timing_mode_value = 'per_question' and per_question_seconds is null then
    raise exception 'question_time_limit_missing' using errcode = '22023';
  end if;
  if attempt_row.current_question_started_at
    > resume_requested_at + interval '3250 milliseconds'
  then
    raise exception 'feedback_window_invalid' using errcode = '22023';
  end if;

  adjusted_started_at := least(
    attempt_row.current_question_started_at,
    resume_requested_at + interval '150 milliseconds'
  );
  unused_feedback := greatest(
    interval '0 milliseconds',
    attempt_row.current_question_started_at - adjusted_started_at
  );

  if timing_mode_value = 'per_question' then
    next_deadline :=
      adjusted_started_at + make_interval(secs => per_question_seconds);
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at
    where id = p_attempt_id;
  else
    next_deadline := attempt_row.deadline_at - unused_feedback;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at,
        deadline_at = next_deadline
    where id = p_attempt_id;
  end if;

  return jsonb_build_object(
    'questionStartsAt', adjusted_started_at,
    'questionDeadlineAt', next_deadline
  );
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.resume_quiz_after_feedback_v2(uuid,uuid,uuid,text,integer)'::regprocedure; if md5(src)<>'e1ac20ede00c5e5715617b79d517eb10' then raise exception 'local_quiz_legacy_source_changed: public.resume_quiz_after_feedback_v2' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.resume_quiz_after_feedback_v2(p_student_id uuid, p_attempt_id uuid, p_next_question_id uuid, p_next_phase text, p_transition_remaining_milliseconds integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  attempt_row public.quiz_attempts%rowtype;
  timing_mode_value text;
  per_question_seconds integer;
  current_question_id uuid;
  resume_requested_at timestamptz := clock_timestamp();
  adjusted_started_at timestamptz;
  unused_feedback interval;
  next_deadline timestamptz;
begin
  perform 1 from public.students where id=p_student_id for update;
  perform private.assert_legacy_quiz_protocol_v1(p_attempt_id);

  if p_next_phase is null or p_next_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;
  if p_transition_remaining_milliseconds is null
    or p_transition_remaining_milliseconds < 0
    or p_transition_remaining_milliseconds > 750
  then
    raise exception 'invalid_feedback_delay' using errcode = '22023';
  end if;

  select attempt.*
  into attempt_row
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;
  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;
  if attempt_row.phase::text <> p_next_phase then
    raise exception 'attempt_phase_mismatch' using errcode = '22023';
  end if;

  if p_next_phase = 'initial' then
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_choice_index is null
    order by question.order_index
    limit 1;
  else
    select question.id
    into current_question_id
    from public.quiz_questions as question
    where question.attempt_id = p_attempt_id
      and question.initial_is_correct is false
      and question.retry_choice_index is null
    order by question.order_index
    limit 1;
  end if;

  if current_question_id is distinct from p_next_question_id then
    raise exception 'next_question_mismatch' using errcode = '22023';
  end if;

  select assignment.timing_mode, assignment.question_time_limit_seconds
  into timing_mode_value, per_question_seconds
  from public.assignments as assignment
  where assignment.id = attempt_row.assignment_id;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;
  if timing_mode_value = 'per_question' and per_question_seconds is null then
    raise exception 'question_time_limit_missing' using errcode = '22023';
  end if;
  if attempt_row.current_question_started_at
    > resume_requested_at + interval '7250 milliseconds'
  then
    raise exception 'feedback_window_invalid' using errcode = '22023';
  end if;

  adjusted_started_at := least(
    attempt_row.current_question_started_at,
    resume_requested_at + make_interval(
      secs => p_transition_remaining_milliseconds::double precision / 1000
    )
  );
  unused_feedback := greatest(
    interval '0 milliseconds',
    attempt_row.current_question_started_at - adjusted_started_at
  );

  if timing_mode_value = 'per_question' then
    next_deadline :=
      adjusted_started_at + make_interval(secs => per_question_seconds);
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at
    where id = p_attempt_id;
  elsif timing_mode_value = 'total' then
    next_deadline := attempt_row.deadline_at - unused_feedback;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at,
        deadline_at = next_deadline
    where id = p_attempt_id;
  elsif timing_mode_value = 'none' then
    next_deadline := attempt_row.deadline_at;
    update public.quiz_attempts
    set current_question_started_at = adjusted_started_at
    where id = p_attempt_id;
  else
    raise exception 'invalid_timing_mode' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'questionStartsAt', adjusted_started_at,
    'questionDeadlineAt', next_deadline
  );
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.finalize_vocabulary_expiry_v2(uuid,uuid,timestamp with time zone,boolean,boolean)'::regprocedure; if md5(src)<>'8cd248c9b81b7da5e1015ad875e1af88' then raise exception 'local_quiz_legacy_source_changed: private.finalize_vocabulary_expiry_v2' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.finalize_vocabulary_expiry_v2(p_student_id uuid, p_attempt_id uuid, p_evaluation_at timestamp with time zone, p_legacy boolean, p_record_result boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare pending jsonb; item jsonb; response jsonb; phase_value text; previous_status text;
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  select phase::text,status::text into phase_value,previous_status from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id for update;
  if not found then raise exception 'attempt_not_found' using errcode='P0002'; end if;
  if exists(select 1 from private.local_quiz_runs where attempt_id=p_attempt_id) then return jsonb_build_object('expired',false,'completed',false,'awaitingLocalSubmission',true); end if;
  if previous_status='in_progress' then perform private.preserve_vocabulary_legacy_questions_v1(p_attempt_id); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'phase',s.phase) order by q.order_index,s.phase),'[]') into pending
    from public.quiz_questions q cross join lateral (values('initial',q.initial_choice_index,q.initial_is_correct,q.initial_answered_at),('retry',q.retry_choice_index,q.retry_is_correct,q.retry_answered_at)) s(phase,choice,correct,answered)
    where q.attempt_id=p_attempt_id and s.choice is null and s.correct is null and s.answered is null
      and (s.phase='initial' or phase_value='retry' and q.initial_is_correct is false);
  response:=case when p_legacy then private.m03_grade_expired_attempt(p_student_id,p_attempt_id)
    else private.m03_grade_expired_attempt_at_v2(p_student_id,p_attempt_id,p_evaluation_at) end;
  for item in select value from jsonb_array_elements(pending) loop
    perform private.accept_vocabulary_answer_v1(p_student_id,p_attempt_id,(item->>'id')::uuid,item->>'phase',null,true,response,'expiry',pending);
  end loop;
  if previous_status='in_progress' then
    perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);
    if p_record_result then perform private.freeze_vocabulary_result_v1(p_attempt_id,phase_value,'expired'); end if;
  end if;
  return response;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='public.finalize_quiz_attempt_if_stale(uuid)'::regprocedure; if md5(src)<>'ffe864e14d5f399caffefeccfeb79214' then raise exception 'local_quiz_legacy_source_changed: public.finalize_quiz_attempt_if_stale' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION public.finalize_quiz_attempt_if_stale(p_attempt_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  evaluation_at_value timestamptz := transaction_timestamp();
  student_id_value uuid;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_attempt_id is null then
    raise exception 'invalid_attempt_id' using errcode = '22023';
  end if;

  select attempt.student_id
  into student_id_value
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id;
  if not found then
    return false;
  end if;

  perform 1
  from public.students as student
  where student.id = student_id_value
  for update;
  if not found then
    return false;
  end if;

  perform 1
  from public.quiz_attempts as attempt
  where attempt.id = p_attempt_id
    and attempt.student_id = student_id_value
    and attempt.status = 'in_progress'
    and attempt.phase in ('initial', 'retry')
    and attempt.deadline_at <= evaluation_at_value
  for update;
  if not found then
    return false;
  end if;

  if exists(select 1 from private.local_quiz_runs where attempt_id=p_attempt_id) then return false; end if;
  perform private.finalize_expired_quiz_attempt_at_v2(
    student_id_value,
    p_attempt_id,
    evaluation_at_value
  );
  return true;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.run_stale_quiz_attempt_maintenance_v1(integer,integer,integer)'::regprocedure; if md5(src)<>'9dec72171621d61f6bcf85688469a6f3' then raise exception 'local_quiz_legacy_source_changed: private.run_stale_quiz_attempt_maintenance_v1' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.run_stale_quiz_attempt_maintenance_v1(p_student_limit integer DEFAULT 10, p_attempt_limit integer DEFAULT 25, p_backlog_probe_limit integer DEFAULT 1000)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET lock_timeout TO '2s'
 SET statement_timeout TO '30s'
AS $function$
declare
  job_name_value constant text :=
    'english-academy-finalize-stale-attempts';
  evaluation_at_value timestamptz := transaction_timestamp();
  completed_at_value timestamptz;
  candidate_student record;
  candidate_attempt record;
  work_count integer := 0;
  processed_count_value integer := 0;
  failed_count_value integer := 0;
  attention_count_value integer := 0;
  sampled_pending_count integer := 0;
  pending_count_value integer := 0;
  pending_count_is_lower_bound_value boolean := false;
  oldest_due_at_value timestamptz;
  error_sqlstate_value text;
  error_code_value text;
begin
  if p_student_limit is null or p_student_limit not between 1 and 50
    or p_attempt_limit is null or p_attempt_limit not between 1 and 250
    or p_backlog_probe_limit is null
    or p_backlog_probe_limit not between 1 and 5000
  then
    raise exception 'invalid_stale_attempt_maintenance_limit'
      using errcode = '22023';
  end if;

  for candidate_student in
    select student.id, due.oldest_due_at
    from public.students as student
    cross join lateral (
      select attempt.deadline_at as oldest_due_at
      from public.quiz_attempts as attempt
      where attempt.student_id = student.id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and not exists(select 1 from private.local_quiz_runs l where l.attempt_id=attempt.id)
        and attempt.deadline_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'quiz_attempt'
            and retry.target_id = attempt.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by attempt.deadline_at, attempt.id
      limit 1
    ) as due
    order by due.oldest_due_at, student.id
    for update of student skip locked
    limit p_student_limit
  loop
    exit when work_count >= p_attempt_limit;
    for candidate_attempt in
      select attempt.id
      from public.quiz_attempts as attempt
      where attempt.student_id = candidate_student.id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and not exists(select 1 from private.local_quiz_runs l where l.attempt_id=attempt.id)
        and attempt.deadline_at <= evaluation_at_value
        and not exists (
          select 1
          from private.student_app_maintenance_retry_state as retry
          where retry.job_name = job_name_value
            and retry.target_kind = 'quiz_attempt'
            and retry.target_id = attempt.id
            and (
              retry.requires_attention
              or retry.next_retry_at > evaluation_at_value
            )
        )
      order by attempt.deadline_at, attempt.id
      for update skip locked
      limit (p_attempt_limit - work_count)
    loop
      work_count := work_count + 1;
      begin
        perform private.finalize_expired_quiz_attempt_at_v2(
          candidate_student.id,
          candidate_attempt.id,
          evaluation_at_value
        );
        processed_count_value := processed_count_value + 1;
        perform private.clear_student_app_maintenance_failure_v1(
          job_name_value,
          candidate_attempt.id
        );
      exception when others then
        get stacked diagnostics error_sqlstate_value = returned_sqlstate;
        error_code_value :=
          private.classify_student_app_maintenance_error_v1(
            error_sqlstate_value
          );
        perform private.record_student_app_maintenance_failure_v1(
          job_name_value,
          'quiz_attempt',
          candidate_attempt.id,
          candidate_student.id,
          error_code_value,
          evaluation_at_value
        );
        failed_count_value := failed_count_value + 1;
      end;
    end loop;
  end loop;

  delete from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.target_kind = 'quiz_attempt'
    and not exists (
      select 1
      from public.quiz_attempts as attempt
      where attempt.id = retry.target_id
        and attempt.student_id = retry.student_id
        and attempt.status = 'in_progress'
        and attempt.phase in ('initial', 'retry')
        and not exists(select 1 from private.local_quiz_runs l where l.attempt_id=attempt.id)
        and attempt.deadline_at <= evaluation_at_value
    );

  select count(*)::integer, min(sample.deadline_at)
  into sampled_pending_count, oldest_due_at_value
  from (
    select attempt.deadline_at
    from public.quiz_attempts as attempt
    where attempt.status = 'in_progress'
      and attempt.phase in ('initial', 'retry')
        and not exists(select 1 from private.local_quiz_runs l where l.attempt_id=attempt.id)
      and attempt.deadline_at <= evaluation_at_value
    order by attempt.deadline_at, attempt.id
    limit (p_backlog_probe_limit + 1)
  ) as sample;
  pending_count_is_lower_bound_value :=
    sampled_pending_count > p_backlog_probe_limit;
  pending_count_value := least(
    sampled_pending_count,
    p_backlog_probe_limit
  );
  select count(*)::integer
  into attention_count_value
  from private.student_app_maintenance_retry_state as retry
  where retry.job_name = job_name_value
    and retry.requires_attention;
  if failed_count_value = 0 and attention_count_value > 0 then
    error_code_value := 'maintenance_attention_required';
  end if;

  completed_at_value := clock_timestamp();
  perform private.save_student_app_maintenance_state_v1(
    job_name_value,
    evaluation_at_value,
    completed_at_value,
    processed_count_value,
    failed_count_value,
    attention_count_value,
    pending_count_value,
    pending_count_is_lower_bound_value,
    oldest_due_at_value,
    error_code_value
  );

  return jsonb_build_object(
    'jobName', job_name_value,
    'processedCount', processed_count_value,
    'failedCount', failed_count_value,
    'attentionCount', attention_count_value,
    'pendingCount', pending_count_value,
    'pendingCountIsLowerBound', pending_count_is_lower_bound_value,
    'oldestDueAt', oldest_due_at_value
  );
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.resolve_vocab_state_on_correct_answer()'::regprocedure; if md5(src)<>'1a858a166bef56553f21d9bacce6dd59' then raise exception 'local_quiz_legacy_source_changed: private.resolve_vocab_state_on_correct_answer' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.resolve_vocab_state_on_correct_answer()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_identity record;
  identity_is_resolved boolean;
  evaluated_at timestamptz := coalesce(
    new.retry_answered_at,
    new.initial_answered_at,
    clock_timestamp()
  );
begin
  if exists(select 1 from private.local_quiz_runs where attempt_id=new.attempt_id) then return new; end if;
  select
    attempt.student_id,
    entry.dataset_id,
    entry.id as vocab_entry_id,
    exam_snapshot.dictionary_id,
    coalesce(
      bank_question.canonical_lexeme_id_snapshot,
      current_identity.canonical_lexeme_id
    ) as canonical_lexeme_id,
    coalesce(
      bank_question.headword_normalized_snapshot,
      entry.headword_normalized
    ) as headword_normalized
  into target_identity
  from public.quiz_attempts as attempt
  join public.vocab_entries as entry
    on entry.id = new.vocab_entry_id
  left join public.assignment_questions as bank_question
    on bank_question.id = new.assignment_question_id
   and bank_question.assignment_id = attempt.assignment_id
  left join private.assignment_question_word_identity_v1 as exam_snapshot
    on exam_snapshot.assignment_question_id = new.assignment_question_id
   and exam_snapshot.assignment_id = attempt.assignment_id
   and exam_snapshot.dataset_id = entry.dataset_id
   and exam_snapshot.vocab_entry_id = entry.id
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
  ) as current_identity on true
  where attempt.id = new.attempt_id;

  if not found then
    raise exception 'correct_answer_identity_not_found'
      using errcode = 'P0002';
  end if;

  perform 1
  from public.students as student
  where student.id = target_identity.student_id
  for update;
  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    canonical_dictionary_id_snapshot,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  values (
    target_identity.student_id,
    target_identity.vocab_entry_id,
    target_identity.dictionary_id,
    0,
    null,
    evaluated_at,
    new.attempt_id,
    evaluated_at
  )
  on conflict (student_id, vocab_entry_id)
  do update set
    canonical_dictionary_id_snapshot = coalesce(
      excluded.canonical_dictionary_id_snapshot,
      public.student_vocab_state.canonical_dictionary_id_snapshot
    ),
    unresolved_wrong_count = 0,
    resolved_at = excluded.resolved_at,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at >=
    public.student_vocab_state.last_evaluated_at;

  update public.student_vocab_state as state
  set
    unresolved_wrong_count = 0,
    resolved_at = evaluated_at,
    last_attempt_id = new.attempt_id,
    last_evaluated_at = evaluated_at
  from public.vocab_entries as state_entry
  left join lateral (
    select min(eligibility.canonical_lexeme_id::text)::uuid
      as canonical_lexeme_id
    from public.vocab_entry_quiz_eligibility as eligibility
    where eligibility.vocab_entry_id = state_entry.id
      and eligibility.dataset_id = state_entry.dataset_id
      and eligibility.status = 'eligible'
  ) as state_identity on true
  where state.student_id = target_identity.student_id
    and state_entry.id = state.vocab_entry_id
    and state_entry.dataset_id = target_identity.dataset_id
    and evaluated_at >= state.last_evaluated_at
    and private.vocab_identity_matches_v1(
      target_identity.dataset_id,
      target_identity.vocab_entry_id,
      target_identity.dictionary_id,
      target_identity.canonical_lexeme_id,
      target_identity.headword_normalized,
      state_entry.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot,
      state_identity.canonical_lexeme_id,
      state_entry.headword_normalized
    );

  select not exists (
    select 1
    from public.student_vocab_state as state
    join public.vocab_entries as state_entry
      on state_entry.id = state.vocab_entry_id
     and state_entry.dataset_id = target_identity.dataset_id
    left join lateral (
      select min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = state_entry.id
        and eligibility.dataset_id = state_entry.dataset_id
        and eligibility.status = 'eligible'
    ) as state_identity on true
    where state.student_id = target_identity.student_id
      and state.unresolved_wrong_count > 0
      and state.resolved_at is null
      and private.vocab_identity_matches_v1(
        target_identity.dataset_id,
        target_identity.vocab_entry_id,
        target_identity.dictionary_id,
        target_identity.canonical_lexeme_id,
        target_identity.headword_normalized,
        state_entry.dataset_id,
        state.vocab_entry_id,
        state.canonical_dictionary_id_snapshot,
        state_identity.canonical_lexeme_id,
        state_entry.headword_normalized
      )
  ) into identity_is_resolved;

  return new;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.record_initial_wrong_events_when_review_starts()'::regprocedure; if md5(src)<>'47413b8c1ee284dd5d22d9d15d00c3ef' then raise exception 'local_quiz_legacy_source_changed: private.record_initial_wrong_events_when_review_starts' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.record_initial_wrong_events_when_review_starts()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  evaluation_time timestamptz :=
    coalesce(new.initial_completed_at, clock_timestamp());
begin
  perform private.record_wrong_events_for_attempt(
    new.id,
    new.student_id,
    evaluation_time
  );

  if exists(select 1 from private.local_quiz_runs where attempt_id=new.id) then return new; end if;

  insert into public.student_vocab_state (
    student_id,
    vocab_entry_id,
    canonical_dictionary_id_snapshot,
    unresolved_wrong_count,
    last_wrong_at,
    resolved_at,
    last_attempt_id,
    last_evaluated_at
  )
  select
    new.student_id,
    question.vocab_entry_id,
    exam_snapshot.dictionary_id,
    1,
    coalesce(question.initial_answered_at, evaluation_time),
    null,
    new.id,
    evaluation_time
  from public.quiz_questions as question
  left join private.assignment_question_word_identity_v1 as exam_snapshot
    on exam_snapshot.assignment_question_id = question.assignment_question_id
   and exam_snapshot.assignment_id = new.assignment_id
   and exam_snapshot.vocab_entry_id = question.vocab_entry_id
  where question.attempt_id = new.id
    and question.initial_is_correct is false
  on conflict (student_id, vocab_entry_id)
  do update set
    canonical_dictionary_id_snapshot = coalesce(
      excluded.canonical_dictionary_id_snapshot,
      public.student_vocab_state.canonical_dictionary_id_snapshot
    ),
    unresolved_wrong_count = case
      when public.student_vocab_state.last_attempt_id =
        excluded.last_attempt_id
        then greatest(
          public.student_vocab_state.unresolved_wrong_count,
          1
        )
      else public.student_vocab_state.unresolved_wrong_count + 1
    end,
    last_wrong_at = excluded.last_wrong_at,
    resolved_at = null,
    last_attempt_id = excluded.last_attempt_id,
    last_evaluated_at = excluded.last_evaluated_at
  where excluded.last_evaluated_at >=
    public.student_vocab_state.last_evaluated_at;

  update public.student_vocab_review_queue as queue
  set reason_level = least(
    2,
    greatest(
      1,
      (
        select count(distinct wrong_event.quiz_attempt_id)
        from public.student_vocab_wrong_events as wrong_event
        join public.vocab_entries as wrong_entry
          on wrong_entry.id = wrong_event.vocab_entry_id
         and wrong_entry.dataset_id = wrong_event.dataset_id
        where wrong_event.student_id = new.student_id
          and wrong_event.wrong_stage = 'initial'
          and private.vocab_identity_matches_v1(
            queue.dataset_id,
            queue.vocab_entry_id,
            queue.canonical_dictionary_id_snapshot,
            queue.canonical_lexeme_id_snapshot,
            queue_entry.headword_normalized,
            wrong_event.dataset_id,
            wrong_event.vocab_entry_id,
            wrong_event.canonical_dictionary_id_snapshot,
            wrong_event.canonical_lexeme_id_snapshot,
            wrong_entry.headword_normalized
          )
      )
    )
  )::smallint
  from public.vocab_entries as queue_entry
  where queue_entry.id = queue.vocab_entry_id
    and queue_entry.dataset_id = queue.dataset_id
    and queue.student_id = new.student_id
    and queue.status = 'pending';

  return new;
end;
$function$
$definition$; end $guard$;
do $guard$ declare src text; begin select replace(prosrc,chr(13)||chr(10),chr(10)) into src from pg_proc where oid='private.record_vocab_quiz_point_events(uuid,uuid,text,timestamp with time zone)'::regprocedure; if md5(src)<>'d0a0a42e7e91d84046a578952aaab851' then raise exception 'local_quiz_legacy_source_changed: private.record_vocab_quiz_point_events' using errcode='PT409'; end if; execute $definition$CREATE OR REPLACE FUNCTION private.record_vocab_quiz_point_events(p_attempt_id uuid, p_student_id uuid, p_rule_version text, p_fallback_at timestamp with time zone)
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
        when stage.timed_out and exists(select 1 from private.local_quiz_runs l where l.attempt_id=attempt.id) then 'timeout'::text
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
    left join private.assignment_question_contents_v1 as bank_question
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
$definition$; end $guard$;

commit;
