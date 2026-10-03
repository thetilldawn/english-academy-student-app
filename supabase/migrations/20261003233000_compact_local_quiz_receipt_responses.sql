-- APP-20261003-08. New phase receipts only; existing answers and receipts stay immutable.
begin;

create function private.local_quiz_receipt_accepted_v1(p_receipt private.local_quiz_phase_receipts)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  plan private.local_quiz_phase_plans;
  attempt public.quiz_attempts;
  planned integer;
  joined integer;
  distinct_ids integer;
  valid boolean;
  accepted jsonb;
begin
  select * into plan from private.local_quiz_phase_plans
    where attempt_id=p_receipt.attempt_id and phase=p_receipt.phase;
  select * into attempt from public.quiz_attempts where id=p_receipt.attempt_id;
  if plan.attempt_id is null or attempt.id is null or jsonb_typeof(plan.plan) is distinct from 'array'
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  planned:=jsonb_array_length(plan.plan);
  if planned not between 1 and 500
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  select count(*)::integer,count(distinct q.id)::integer,
    bool_and(coalesce(
      jsonb_typeof(i.value)='object' and i.value->>'order'=i.ordinality::text
      and q.attempt_id=p_receipt.attempt_id and q.content_version_id=(i.value->>'contentId')::uuid
      and r.student_id=attempt.student_id and r.attempt_id=attempt.id and r.phase=p_receipt.phase
      and r.result->>'submissionId'=p_receipt.submission_id::text
      and r.result->>'answerHash' ~ '^[a-f0-9]{64}$' and r.server_sequence>0,false)),
    jsonb_agg(jsonb_build_object('id',i.value->>'id','answerHash',r.result->>'answerHash','sequence',r.server_sequence) order by i.ordinality)
  into joined,distinct_ids,valid,accepted
  from jsonb_array_elements(plan.plan) with ordinality i(value,ordinality)
  left join public.quiz_questions q on q.id=(i.value->>'id')::uuid
  left join private.vocabulary_answer_receipts r on r.quiz_question_id=q.id and r.phase=p_receipt.phase;
  -- Validate only the fixed plan through question/receipt primary keys (at most 500).
  -- Unrelated corrupt rows are outside response restoration, not a global audit here.
  if valid is distinct from true or joined<>planned or distinct_ids<>planned
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  return accepted;
end $$;

create function private.resolve_local_quiz_receipt_v1(p_receipt private.local_quiz_phase_receipts)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare stored jsonb:=p_receipt.result; response jsonb; accepted jsonb; hash text;
begin
  if stored is null then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  if not(stored ? 'storageVersion') then return stored; end if;
  if stored->>'storageVersion' is distinct from 'local-quiz-receipt-ref-v1'
    or jsonb_typeof(stored) is distinct from 'object'
    or (select count(*) from jsonb_object_keys(stored))<>4
    or not(stored ?& array['storageVersion','response','acceptedCount','responseSha256'])
    or jsonb_typeof(stored->'response') is distinct from 'object'
    or jsonb_typeof(stored->'acceptedCount') is distinct from 'number'
    or (stored->>'acceptedCount' ~ '^[1-9][0-9]{0,2}$') is distinct from true
    or (stored->>'responseSha256' ~ '^[a-f0-9]{64}$') is distinct from true
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  response:=stored->'response';
  if response ? 'accepted' or response->>'protocol' is distinct from 'local_batch_v1'
    or response->>'submissionId' is distinct from p_receipt.submission_id::text
    or response->>'phase' is distinct from p_receipt.phase
    or response->>'payloadHash' is distinct from p_receipt.payload_hash
    or response->>'planHash' is distinct from (select p.plan_hash from private.local_quiz_phase_plans p
      where p.attempt_id=p_receipt.attempt_id and p.phase=p_receipt.phase)
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  accepted:=private.local_quiz_receipt_accepted_v1(p_receipt);
  if jsonb_array_length(accepted) is distinct from (stored->>'acceptedCount')::integer
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  response:=response||jsonb_build_object('accepted',accepted);
  hash:=private.local_quiz_plan_hash_v1(response);
  if hash is distinct from stored->>'responseSha256'
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  return response;
end $$;

create function private.compact_local_quiz_receipt_v1(p_receipt private.local_quiz_phase_receipts)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare compact jsonb; check_row private.local_quiz_phase_receipts:=p_receipt; restored jsonb;
begin
  if jsonb_typeof(p_receipt.result) is distinct from 'object' or p_receipt.result ? 'storageVersion'
    or jsonb_typeof(p_receipt.result->'accepted') is distinct from 'array'
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  compact:=jsonb_build_object('storageVersion','local-quiz-receipt-ref-v1',
    'response',p_receipt.result-'accepted','acceptedCount',jsonb_array_length(p_receipt.result->'accepted'),
    'responseSha256',private.local_quiz_plan_hash_v1(p_receipt.result));
  check_row.result:=compact;
  restored:=private.resolve_local_quiz_receipt_v1(check_row);
  if restored::text is distinct from p_receipt.result::text
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  if pg_column_size(compact)<pg_column_size(p_receipt.result) then return compact; end if;
  return p_receipt.result;
end $$;

revoke all on function private.local_quiz_receipt_accepted_v1(private.local_quiz_phase_receipts),
  private.resolve_local_quiz_receipt_v1(private.local_quiz_phase_receipts),
  private.compact_local_quiz_receipt_v1(private.local_quiz_phase_receipts)
  from public,anon,authenticated,service_role;

do $patch$
declare
  target regprocedure:='public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)'::regprocedure;
  source text;
  replay text:='return old.result;';
  write_old text:=$old$  insert into private.local_quiz_phase_receipts(submission_id,attempt_id,phase,payload_hash,result) values(p_submission_id,a.id,p_phase,hash,response);
  return response;$old$;
  write_new text:=$new$  old:=row(p_submission_id,a.id,p_phase,hash,response,null)::private.local_quiz_phase_receipts;
  old.result:=private.compact_local_quiz_receipt_v1(old);
  insert into private.local_quiz_phase_receipts(submission_id,attempt_id,phase,payload_hash,result)
    values(p_submission_id,a.id,p_phase,hash,old.result) returning * into old;
  if private.resolve_local_quiz_receipt_v1(old)::text is distinct from response::text
    then raise exception 'local_quiz_receipt_invalid' using errcode='XX001'; end if;
  return response;$new$;
  before_attributes jsonb;
  after_attributes jsonb;
begin
  select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,
    'definer',prosecdef,'volatility',provolatile,'parallel',proparallel)
    into before_attributes from pg_proc where oid=target;
  source:=replace(pg_get_functiondef(target),E'\r\n',E'\n');
  if length(source)-length(replace(source,replay,''))<>length(replay)
    or length(source)-length(replace(source,write_old,''))<>length(write_old)
    then raise exception 'local_quiz_receipt_patch_source_changed'; end if;
  source:=replace(source,replay,'return private.resolve_local_quiz_receipt_v1(old);');
  source:=replace(source,write_old,write_new);
  execute source;
  select jsonb_build_object('oid',oid,'owner',proowner,'acl',proacl,'config',proconfig,
    'definer',prosecdef,'volatility',provolatile,'parallel',proparallel)
    into after_attributes from pg_proc where oid=target;
  if before_attributes is distinct from after_attributes
    then raise exception 'local_quiz_receipt_patch_contract_changed'; end if;
end $patch$;

commit;
