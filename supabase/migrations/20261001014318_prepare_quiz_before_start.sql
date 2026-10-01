-- APP-20261001-03. Prepared plans are not attempts; existing attempts are never retimed.
begin;
create table private.quiz_attempt_preparations (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  assignment_id uuid references public.assignments(id),
  kind text not null check (kind in ('initial','practice')),
  request_key text not null,
  request_hash text,
  fingerprint text not null,
  plan jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null default (clock_timestamp()+interval '15 minutes'),
  begun_id uuid,
  unique(student_id,kind,request_key)
);
revoke all on private.quiz_attempt_preparations from public,anon,authenticated;
grant select,insert,update,delete on private.quiz_attempt_preparations to service_role;

create function private.assert_quiz_preparation_student(p_student_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform 1 from public.students where id=p_student_id and status='active' and deleted_at is null for update;
  if not found then raise exception 'student_not_found' using errcode='42501'; end if;
end;
$$;

create function private.quiz_preparation_assignment(p_student_id uuid,p_assignment_id uuid)
returns public.assignments language plpgsql security invoker set search_path='' as $$
declare a public.assignments; release_state text;
begin
  select * into a from public.assignments where id=p_assignment_id for share;
  if not found or a.deleted_at is not null or a.status<>'active'
    or a.available_from>clock_timestamp() or a.available_until<=clock_timestamp()
    then raise exception 'assignment_unavailable' using errcode='22023'; end if;
  perform 1 from public.assignment_students where assignment_id=a.id and student_id=p_student_id
    and cancelled_at is null and missed_at is null and assigned_at<=clock_timestamp() for share;
  if not found then raise exception 'assignment_not_owned' using errcode='42501'; end if;
  release_state:=private.student_assignment_release_v1(p_student_id,a.id,clock_timestamp())->>'state';
  if release_state not in ('open','unrestricted') then raise exception 'assignment_release_%',release_state using errcode='55000'; end if;
  if not a.retake_allowed and exists(select 1 from public.quiz_attempts where student_id=p_student_id and assignment_id=a.id and status='completed')
    then raise exception 'retake_not_allowed' using errcode='22023'; end if;
  return a;
end;
$$;

create function private.quiz_preparation_fingerprint(a public.assignments)
returns text language sql stable security invoker set search_path='' as $$
  select encode(extensions.digest((to_jsonb(a)||jsonb_build_object('source',
    case when a.range_basis='units' and a.question_bank_version is not null then
      (select coalesce(jsonb_agg(to_jsonb(q) order by q.id),'[]') from public.assignment_questions q where q.assignment_id=a.id)
    else (select coalesce(jsonb_agg(jsonb_build_array(e.id,e.source_row,e.headword,e.headword_normalized,e.primary_meaning) order by e.id),'[]')
      from public.vocab_entries e where e.dataset_id=a.dataset_id and e.source_row between a.range_start and a.range_end)
    end))::text,'sha256'),'hex');
$$;

create function private.quiz_preparation_legacy_plan(a public.assignments,p_questions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare plan jsonb;
begin
  if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'questions_must_be_array' using errcode='22023'; end if;
  if jsonb_array_length(p_questions)<>a.question_count then raise exception 'question_count_mismatch' using errcode='22023'; end if;
  if (select count(distinct (q->>'order_index')::integer) from jsonb_array_elements(p_questions) q)<>a.question_count
    or (select min((q->>'order_index')::integer)<>1 or max((q->>'order_index')::integer)<>a.question_count from jsonb_array_elements(p_questions) q)
    then raise exception 'question_order_mismatch' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q left join public.vocab_entries e on e.id=(q->>'vocab_entry_id')::bigint
    where e.id is null or e.dataset_id<>a.dataset_id or e.source_row not between a.range_start and a.range_end
      or q->>'direction' is null or q->>'direction' not in ('english_to_korean','korean_to_english')
      or q->>'correct_choice_index' is null or (q->>'correct_choice_index')::integer not between 0 and 3
      or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_array_length(q->'choices')<>4
      or q->>'prompt' is distinct from case q->>'direction' when 'english_to_korean' then e.headword else e.primary_meaning end
      or q->'choices'->>((q->>'correct_choice_index')::integer) is distinct from case q->>'direction' when 'english_to_korean' then e.primary_meaning else e.headword end
      or (select count(distinct lower(btrim(c))) from jsonb_array_elements_text(q->'choices') c)<>4
      or exists(select 1 from jsonb_array_elements(q->'choices') c where jsonb_typeof(c)<>'string' or btrim(c#>>'{}')='')
      or (q->>'direction'='korean_to_english' and exists(select 1 from public.vocab_entries other where other.dataset_id=a.dataset_id
        and other.source_row between a.range_start and a.range_end and other.headword_normalized<>e.headword_normalized
        and lower(btrim(other.primary_meaning))=lower(btrim(e.primary_meaning)))))
    then raise exception 'invalid_question_payload' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_questions) q where q->>'direction'='english_to_korean')<>round(a.question_count*a.english_to_korean_ratio/100.0)
    then raise exception 'question_direction_ratio_mismatch' using errcode='22023'; end if;
  select jsonb_agg(q||jsonb_build_object('id',gen_random_uuid()) order by (q->>'order_index')::integer)
    into plan from jsonb_array_elements(p_questions) q;
  return plan;
end;
$$;

create function public.prepare_quiz_attempt_v1(p_student_id uuid,p_assignment_id uuid,p_questions jsonb default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare a public.assignments; p private.quiz_attempt_preparations; plan jsonb; fingerprint text; existing uuid;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  select id into existing from public.quiz_attempts where student_id=p_student_id and assignment_id=p_assignment_id and status='in_progress'
    and (phase='review' or deadline_at>clock_timestamp()) order by attempt_number desc limit 1;
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
        from public.assignment_questions b where b.assignment_id=a.id) q;
    if coalesce(jsonb_array_length(plan),0)<>a.question_count then raise exception 'question_bank_incomplete' using errcode='22023'; end if;
  else
    plan:=private.quiz_preparation_legacy_plan(a,p_questions);
  end if;
  -- Only obsolete private preparations are discarded; no attempt or result rows are deleted.
  delete from private.quiz_attempt_preparations where student_id=p_student_id and kind='initial' and request_key=p_assignment_id::text;
  insert into private.quiz_attempt_preparations(student_id,assignment_id,kind,request_key,fingerprint,plan)
    values(p_student_id,p_assignment_id,'initial',p_assignment_id::text,fingerprint,plan) returning id into existing;
  return existing;
end;
$$;

create function public.get_quiz_preparation_v1(p_student_id uuid,p_preparation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p private.quiz_attempt_preparations; a public.assignments;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null) then raise exception 'student_not_found' using errcode='42501'; end if;
  select * into p from private.quiz_attempt_preparations where id=p_preparation_id and student_id=p_student_id;
  if not found or p.expires_at<=clock_timestamp() and p.begun_id is null then return null; end if;
  if p.begun_id is not null then return jsonb_build_object('id',p.id,'kind',p.kind,'begunId',p.begun_id); end if;
  -- Raw plan includes answers; this service-only response must never be serialized to a student.
  if p.kind='initial' then
    a:=private.quiz_preparation_assignment(p_student_id,p.assignment_id);
    if private.quiz_preparation_fingerprint(a)<>p.fingerprint then raise exception 'preparation_changed' using errcode='40001'; end if;
    return jsonb_build_object('id',p.id,'kind',p.kind,'assignment',jsonb_build_object('id',a.id,'title',a.title,'timing_mode',a.timing_mode,
      'question_time_limit_seconds',a.question_time_limit_seconds,'quiz_content_mode',a.quiz_content_mode),'plan',p.plan,'begunId',p.begun_id);
  end if;
  return jsonb_build_object('id',p.id,'kind',p.kind,'plan',p.plan,'begunId',p.begun_id);
end;
$$;

create function public.begin_prepared_quiz_v1(p_student_id uuid,p_preparation_id uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
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
  if p.expires_at<=clock_timestamp() then raise exception 'preparation_expired' using errcode='40001'; end if;
  a:=private.quiz_preparation_assignment(p_student_id,p.assignment_id);
  if private.quiz_preparation_fingerprint(a)<>p.fingerprint then raise exception 'preparation_changed' using errcode='40001'; end if;
  select coalesce(max(attempt_number),0)+1 into next_number from public.quiz_attempts where student_id=p_student_id and assignment_id=a.id;
  at_time:=clock_timestamp();
  insert into public.quiz_attempts(id,student_id,assignment_id,attempt_number,status,started_at,deadline_at,current_question_started_at,
    question_count_snapshot,time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot)
    values(p.id,p_student_id,a.id,next_number,'in_progress',at_time,
      case when a.timing_mode='none' then coalesce(a.available_until,'infinity'::timestamptz) else at_time+make_interval(secs=>a.time_limit_seconds) end,
      at_time,a.question_count,a.time_limit_seconds,a.passing_score,a.passing_basis);
  insert into public.quiz_questions(id,attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index)
    select (q->>'id')::uuid,p.id,(q->>'vocab_entry_id')::bigint,(q->>'assignment_question_id')::uuid,(q->>'order_index')::integer,
      (q->>'direction')::public.question_direction,q->>'prompt',q->'choices',(q->>'correct_choice_index')::smallint from jsonb_array_elements(p.plan) q;
  update private.quiz_attempt_preparations set begun_id=p.id where id=p.id;
  return p.id;
end;
$$;

-- Practice plans use the existing source hash, request receipt and frozen pronunciation.
-- Starting still delegates all source/choice validation and scoring to the existing practice RPC.
create function public.find_word_practice_preparation_v1(p_student_id uuid,p_request_key uuid,p_request_hash text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p private.quiz_attempt_preparations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null) then raise exception 'student_not_found' using errcode='42501'; end if;
  select * into p from private.quiz_attempt_preparations where student_id=p_student_id and kind='practice' and request_key=p_request_key::text;
  if not found then return null; end if;
  if p.request_hash is distinct from p_request_hash then raise exception 'practice_request_conflict' using errcode='40001'; end if;
  if p.expires_at<=clock_timestamp() and p.begun_id is null then raise exception 'practice_source_changed' using errcode='40001'; end if;
  return coalesce(p.begun_id,p.id);
end;
$$;
create function public.prepare_word_practice_start_v1(p_student_id uuid,p_request_key uuid,p_request_hash text,p_selection jsonb,p_settings jsonb,p_source_hash text,p_questions jsonb)
returns uuid language plpgsql security invoker set search_path='' as $$
declare p private.quiz_attempt_preparations; existing uuid; plan jsonb; receipt jsonb;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  receipt:=public.get_student_word_practice_v1(p_student_id,null,p_request_key,p_request_hash);
  if receipt is not null then return (receipt->'attempt'->>'id')::uuid; end if;
  select * into p from private.quiz_attempt_preparations where student_id=p_student_id and kind='practice' and request_key=p_request_key::text for update;
  if found then
    if p.request_hash is distinct from p_request_hash then raise exception 'practice_request_conflict' using errcode='40001'; end if;
    if p.begun_id is not null then return p.begun_id; end if;
    if p.expires_at>clock_timestamp() then return p.id; end if;
    raise exception 'practice_source_changed' using errcode='40001';
  end if;
  if p_request_key is null or p_request_hash !~ '^[a-f0-9]{64}$' or p_source_hash !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 500
    then raise exception 'invalid_practice_request' using errcode='22023'; end if;
  plan:=jsonb_build_object('requestKey',p_request_key,'requestHash',p_request_hash,'selection',p_selection,'settings',p_settings,'sourceHash',p_source_hash,'questions',p_questions);
  insert into private.quiz_attempt_preparations(student_id,kind,request_key,request_hash,fingerprint,plan)
    values(p_student_id,'practice',p_request_key::text,p_request_hash,p_source_hash,plan) returning id into existing;
  return existing;
end;
$$;

create function public.begin_prepared_practice_v1(p_student_id uuid,p_preparation_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p private.quiz_attempt_preparations; result jsonb;
begin
  perform private.assert_quiz_preparation_student(p_student_id);
  select * into p from private.quiz_attempt_preparations where id=p_preparation_id and student_id=p_student_id and kind='practice' for update;
  if not found then raise exception 'preparation_not_found' using errcode='P0002'; end if;
  if p.begun_id is not null then return public.get_student_word_practice_v1(p_student_id,p.begun_id); end if;
  if p.expires_at<=clock_timestamp() then raise exception 'preparation_expired' using errcode='40001'; end if;
  result:=public.start_student_word_practice_v1(p_student_id,(p.plan->>'requestKey')::uuid,p.plan->>'requestHash',p.plan->'selection',p.plan->'settings',p.plan->>'sourceHash',p.plan->'questions');
  update private.quiz_attempt_preparations set begun_id=(result->'attempt'->>'id')::uuid where id=p.id;
  return result;
end;
$$;
revoke all on function private.assert_quiz_preparation_student(uuid),private.quiz_preparation_assignment(uuid,uuid),
  private.quiz_preparation_fingerprint(public.assignments),private.quiz_preparation_legacy_plan(public.assignments,jsonb) from public,anon,authenticated;
grant execute on function private.assert_quiz_preparation_student(uuid),private.quiz_preparation_assignment(uuid,uuid),
  private.quiz_preparation_fingerprint(public.assignments),private.quiz_preparation_legacy_plan(public.assignments,jsonb) to service_role;
revoke all on function public.prepare_quiz_attempt_v1(uuid,uuid,jsonb),public.get_quiz_preparation_v1(uuid,uuid),
  public.begin_prepared_quiz_v1(uuid,uuid),public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb),
  public.begin_prepared_practice_v1(uuid,uuid),public.find_word_practice_preparation_v1(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.prepare_quiz_attempt_v1(uuid,uuid,jsonb),public.get_quiz_preparation_v1(uuid,uuid),
  public.begin_prepared_quiz_v1(uuid,uuid),public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb),
  public.begin_prepared_practice_v1(uuid,uuid),public.find_word_practice_preparation_v1(uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
commit;

