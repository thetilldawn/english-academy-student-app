-- APP-20261003-11. New phase lists only; existing plans and student records stay intact.
begin;

alter table private.local_quiz_phase_plans drop constraint local_quiz_phase_plans_plan_check;
alter table private.local_quiz_phase_plans add constraint local_quiz_phase_plans_plan_check check (
  case jsonb_typeof(plan)
    when 'array' then jsonb_array_length(plan) between 1 and 500
    when 'object' then coalesce(
      plan->>'storageVersion'='local-quiz-phase-refs-v1'
      and plan ?& array['storageVersion','questionIds','startedAt']
      and plan-array['storageVersion','questionIds','startedAt']='{}'::jsonb
      and jsonb_typeof(plan->'startedAt')='string'
      and case when jsonb_typeof(plan->'questionIds')='array'
        then jsonb_array_length(plan->'questionIds') between 1 and 500 else false end,
      false)
    else false
  end
);

create function private.resolve_local_quiz_phase_plan_v1(p_plan private.local_quiz_phase_plans)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare stored jsonb:=p_plan.plan; ids jsonb; items jsonb; signature jsonb; stamp timestamptz;
  planned integer; distinct_ids integer; joined integer; contents integer;
begin
  -- Historical arrays lack the exact timezone string used by their old signature.
  -- Keep their original path; do not recompute their hash with today's TimeZone.
  if jsonb_typeof(stored)='array' then return stored; end if;
  if jsonb_typeof(stored) is distinct from 'object'
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  if stored->>'storageVersion' is distinct from 'local-quiz-phase-refs-v1'
    or not(stored ?& array['storageVersion','questionIds','startedAt'])
    or stored-array['storageVersion','questionIds','startedAt']<>'{}'::jsonb
    or jsonb_typeof(stored->'questionIds') is distinct from 'array'
    or jsonb_typeof(stored->'startedAt') is distinct from 'string'
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  ids:=stored->'questionIds'; planned:=jsonb_array_length(ids);
  if planned not between 1 and 500 or exists(select 1 from jsonb_array_elements(ids) i(value)
    where jsonb_typeof(i.value) is distinct from 'string'
      or (i.value#>>'{}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') is distinct from true)
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  select count(distinct i.value)::integer into distinct_ids from jsonb_array_elements(ids) i(value);
  if distinct_ids<>planned or (stored->>'startedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?([+-]\d{2}:\d{2}|Z)$') is distinct from true
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  begin
    stamp:=(stored->>'startedAt')::timestamptz;
  exception when invalid_datetime_format or datetime_field_overflow then
    raise exception 'local_quiz_plan_invalid' using errcode='XX001';
  end;
  if stamp is distinct from p_plan.started_at or not isfinite(stamp)
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  select count(q.id)::integer,count(v.id)::integer,
    jsonb_agg(jsonb_build_object('id',q.id,'order',i.ordinality,'contentId',q.content_version_id) order by i.ordinality)
    into joined,contents,items
    from jsonb_array_elements(ids) with ordinality i(value,ordinality)
    left join public.quiz_questions q on q.id=(i.value#>>'{}')::uuid and q.attempt_id=p_plan.attempt_id
    left join private.vocabulary_question_content_versions v on v.id=q.content_version_id;
  if joined<>planned or contents<>planned
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  signature:=jsonb_build_object('protocol','local_batch_v1','attempt',p_plan.attempt_id,'phase',p_plan.phase,
    'items',items,'startedAt',stored->'startedAt','limitMs',p_plan.limit_ms,'questionLimitMs',p_plan.question_limit_ms);
  if private.local_quiz_plan_hash_v1(signature) is distinct from p_plan.plan_hash
    then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
  return items;
end $$;
revoke all on function private.resolve_local_quiz_phase_plan_v1(private.local_quiz_phase_plans)
  from public,anon,authenticated,service_role;

do $patch$
declare target regprocedure; source text; old_text text; new_text text;
begin
  target:='private.create_local_quiz_phase_plan_v1(uuid,text)'::regprocedure;
  source:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  old_text:='signature jsonb;';
  new_text:='signature jsonb; compact jsonb; check_row private.local_quiz_phase_plans;';
  if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1
    then raise exception 'phase_plan_writer_declaration_mismatch'; end if;
  source:=replace(source,old_text,new_text);
  old_text:=$old$  insert into private.local_quiz_phase_plans(attempt_id,phase,plan,plan_hash,started_at,limit_ms,question_limit_ms)
    values(a.id,p_phase,items,private.local_quiz_plan_hash_v1(signature),stamp,ms,qm);$old$;
  new_text:=$new$  compact:=jsonb_build_object('storageVersion','local-quiz-phase-refs-v1',
    'questionIds',(select jsonb_agg(i.value->'id' order by i.ordinality) from jsonb_array_elements(items) with ordinality i(value,ordinality)),
    'startedAt',signature->'startedAt');
  if pg_column_size(compact)<pg_column_size(items) then
    check_row:=row(a.id,p_phase,compact,private.local_quiz_plan_hash_v1(signature),stamp,ms,qm,'local-elapsed-v1')::private.local_quiz_phase_plans;
    if private.resolve_local_quiz_phase_plan_v1(check_row)::text is distinct from items::text
      then raise exception 'local_quiz_plan_invalid' using errcode='XX001'; end if;
    items:=compact;
  end if;
  insert into private.local_quiz_phase_plans(attempt_id,phase,plan,plan_hash,started_at,limit_ms,question_limit_ms)
    values(a.id,p_phase,items,private.local_quiz_plan_hash_v1(signature),stamp,ms,qm);$new$;
  if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1
    then raise exception 'phase_plan_writer_insert_mismatch'; end if;
  execute replace(source,old_text,new_text);

  target:='public.read_local_quiz_plan_v1(uuid,uuid,text,text)'::regprocedure;
  source:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  old_text:='jsonb_array_elements(p.plan)';
  new_text:='jsonb_array_elements(private.resolve_local_quiz_phase_plan_v1(p))';
  if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1
    then raise exception 'phase_plan_reader_mismatch'; end if;
  execute replace(source,old_text,new_text);

  target:='public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)'::regprocedure;
  source:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  old_text:=$old$  if jsonb_array_length(p_answers)<>jsonb_array_length(p.plan) then raise exception 'local_quiz_answers_incomplete' using errcode='22023'; end if;$old$;
  new_text:=$new$  -- Preserve prior receipt replay before inspecting a new submission's plan.
  p.plan:=private.resolve_local_quiz_phase_plan_v1(p);
  if jsonb_array_length(p_answers)<>jsonb_array_length(p.plan) then raise exception 'local_quiz_answers_incomplete' using errcode='22023'; end if;$new$;
  if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1
    then raise exception 'phase_plan_submit_mismatch'; end if;
  execute replace(source,old_text,new_text);

  target:='private.local_quiz_receipt_accepted_v1(private.local_quiz_phase_receipts)'::regprocedure;
  source:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  old_text:=$old$  if plan.attempt_id is null or attempt.id is null or jsonb_typeof(plan.plan) is distinct from 'array'$old$;
  new_text:=$new$  if plan.attempt_id is null or attempt.id is null
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  plan.plan:=private.resolve_local_quiz_phase_plan_v1(plan);
  if jsonb_typeof(plan.plan) is distinct from 'array'$new$;
  if (length(source)-length(replace(source,old_text,'')))/length(old_text)<>1
    then raise exception 'phase_plan_receipt_mismatch'; end if;
  execute replace(source,old_text,new_text);
end $patch$;

commit;
