-- APP-20261002-04 / M06. Operator-only bounded cleanup; no scheduled execution.
begin;

create table private.operational_retention_policy (
  singleton boolean primary key default true check(singleton),
  version integer not null default 1 check(version>0),
  success_days integer not null default 7 check(success_days>=7),
  failure_days integer not null default 30 check(failure_days>=30),
  session_days integer not null default 7 check(session_days>=7),
  login_hours integer not null default 24 check(login_hours>=24),
  preparation_hours integer not null default 24 check(preparation_hours>=24),
  changed_at timestamptz not null default clock_timestamp(),
  changed_by text not null default current_user
);
insert into private.operational_retention_policy(singleton) values(true);
create table private.operational_retention_jobs (
  jobid bigint primary key, jobname text not null, schedule text not null,
  database text not null, username text not null, command text not null
);
-- Both live jobs and their individual historical executions must still match.
insert into private.operational_retention_jobs
select j.jobid,j.jobname,j.schedule,j.database,j.username,j.command from cron.job j
join (values
 ('english-academy-finalize-missed-assignments','selectpublic.finalize_missed_assignments(null,250);'),
 ('english-academy-finalize-stale-attempts','selectprivate.run_stale_quiz_attempt_maintenance_v1(10,25,1000);'),
 ('english-academy-expire-review-drafts','selectprivate.run_expired_review_draft_maintenance_v1(10,50,10,1000);'),
 ('english-academy-materialize-ready-vocab-queues','selectprivate.run_ready_vocab_queue_maintenance_v1(2,1000);')
) expected(name,command) on j.jobname=expected.name
where j.username='postgres' and j.database=current_database()
  and regexp_replace(j.command,'\s','','g')=expected.command;

create table private.operational_retention_holds (
  kind text not null check(kind in('cron','sessions','login_failures','preparations')),
  row_key text not null, reason text not null check(length(reason) between 1 and 500),
  created_at timestamptz not null default clock_timestamp(), primary key(kind,row_key)
);
create table private.operational_retention_state (
  kind text primary key check(kind in('cron','sessions','login_failures','preparations')),
  cutoff timestamptz not null, policy_hash text not null, request_hash text not null,
  next_cursor text, result jsonb not null, updated_at timestamptz not null default clock_timestamp()
);
create table private.quiz_preparation_expirations (
  id uuid primary key, student_id uuid not null references public.students(id),
  kind text not null check(kind in('initial','practice')), request_key text not null, request_hash text,
  expired_at timestamptz not null, retired_at timestamptz not null default clock_timestamp()
);
create unique index preparation_expired_practice_request on private.quiz_preparation_expirations(student_id,request_key)
  where kind='practice';
create table private.quiz_preparation_compaction_checks (
  preparation_id uuid primary key references private.quiz_attempt_preparations(id) on delete cascade,
  original_hash text not null, compact_hash text not null, verified_at timestamptz not null,
  compacted_at timestamptz
);
do $$ declare n text; begin
  foreach n in array array['operational_retention_policy','operational_retention_jobs','operational_retention_holds',
    'operational_retention_state','quiz_preparation_expirations','quiz_preparation_compaction_checks'] loop
    execute format('alter table private.%I enable row level security',n);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',n);
  end loop;
end $$;

create function private.lock_operational_retention_v1() returns trigger language plpgsql set search_path='' as $$
begin
  perform pg_advisory_xact_lock(61002,4);
  return case when tg_op='DELETE' then old else new end;
end $$;
create trigger retention_policy_lock before insert or update or delete on private.operational_retention_policy
  for each row execute function private.lock_operational_retention_v1();
create trigger retention_jobs_lock before insert or update or delete on private.operational_retention_jobs
  for each row execute function private.lock_operational_retention_v1();
create trigger retention_holds_lock before insert or update or delete on private.operational_retention_holds
  for each row execute function private.lock_operational_retention_v1();
create trigger preparation_expiration_immutable before update or delete on private.quiz_preparation_expirations
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.assert_preparation_not_retired_v1(p_student uuid,p_id uuid,p_request_key text default null,p_hash text default null)
returns void language plpgsql security definer set search_path='' as $$
declare expired private.quiz_preparation_expirations;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  select * into expired from private.quiz_preparation_expirations where student_id=p_student
    and ((p_id is not null and id=p_id) or (p_request_key is not null and kind='practice' and request_key=p_request_key));
  if not found then return; end if;
  if p_request_key is not null then
    if expired.request_hash is distinct from p_hash then raise exception 'practice_request_conflict' using errcode='PT409'; end if;
    raise exception 'practice_source_changed' using errcode='PT409';
  end if;
  raise exception 'preparation_expired' using errcode='PT409';
end $$;
revoke all on function private.assert_preparation_not_retired_v1(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function private.assert_preparation_not_retired_v1(uuid,uuid,text,text) to service_role;

-- Keep function identities, signatures, ownership and privileges. Refuse unknown source shapes.
do $guards$
declare edit record; definition text; matches integer;
begin
  for edit in select * from(values
    ('public.begin_prepared_quiz_v1(uuid,uuid)',
     '  select * into p from private.quiz_attempt_preparations where id=p_preparation_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,p_preparation_id);\n  select * into p from private.quiz_attempt_preparations where id=p_preparation_id'),
    ('private.begin_local_quiz_core_v1(uuid,uuid)',
     '  select * into p from private.quiz_attempt_preparations where id=p_preparation_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,p_preparation_id);\n  select * into p from private.quiz_attempt_preparations where id=p_preparation_id'),
    ('public.begin_local_quiz_v1(uuid,uuid,text,text)',
     '  select * into p from private.quiz_attempt_preparations where id=p_preparation_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,p_preparation_id);\n  select * into p from private.quiz_attempt_preparations where id=p_preparation_id'),
    ('public.begin_prepared_practice_v1(uuid,uuid)',
     '  select * into p from private.quiz_attempt_preparations where id=p_preparation_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,p_preparation_id);\n  select * into p from private.quiz_attempt_preparations where id=p_preparation_id'),
    ('public.find_word_practice_preparation_v1(uuid,uuid,text)',
     '  select * into p from private.quiz_attempt_preparations where student_id=p_student_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,null,p_request_key::text,p_request_hash);\n  select * into p from private.quiz_attempt_preparations where student_id=p_student_id'),
    ('public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
     '  select * into p from private.quiz_attempt_preparations where student_id=p_student_id',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,null,p_request_key::text,p_request_hash);\n  select * into p from private.quiz_attempt_preparations where student_id=p_student_id'),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
     '  count_requested:=(p_settings->>''questionCount'')::integer;',
     E'  perform private.assert_preparation_not_retired_v1(p_student_id,null,p_request_key::text,p_request_hash);\n  count_requested:=(p_settings->>''questionCount'')::integer;')
  ) x(signature,needle,replacement) loop
    definition:=replace(pg_get_functiondef(to_regprocedure(edit.signature)),chr(13),'');
    matches:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if definition is null or matches<>1 then raise exception 'retention_source_changed: %',edit.signature; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end $guards$;

create function private.retention_policy_hash_v1() returns text language sql stable set search_path='' as $$
  select md5(jsonb_build_object('policy',to_jsonb(p),'jobs',coalesce((select jsonb_agg(to_jsonb(j) order by jobid)
    from private.operational_retention_jobs j),'[]'::jsonb))::text) from private.operational_retention_policy p where singleton
$$;

-- Pure read: reuse only references already attached to the actual ended attempt.
create function private.retention_compact_preparation_v1(p private.quiz_attempt_preparations) returns jsonb
language plpgsql stable set search_path='' as $$
declare items jsonb:='[]'; item jsonb; q public.quiz_questions; original jsonb; probe private.quiz_attempt_preparations;
  r record; item_ordinal integer:=0;
begin
  if p.begun_id is null then return null; end if;
  if p.kind='initial' then
    if jsonb_typeof(p.plan)<>'array' or not exists(select 1 from public.quiz_attempts a where a.id=p.begun_id
      and a.student_id=p.student_id and a.assignment_id=p.assignment_id and a.status in('completed','expired') and a.completed_at is not null)
      then return null; end if;
    for item in select value from jsonb_array_elements(p.plan) loop
      select * into q from public.quiz_questions where id=(item->>'id')::uuid and attempt_id=p.begun_id;
      if q.id is null or q.content_version_id is null or
        (q.vocab_entry_id,q.assignment_question_id,q.order_index,q.direction,q.correct_choice_index)
        is distinct from ((item->>'vocab_entry_id')::bigint,(item->>'assignment_question_id')::uuid,
          (item->>'order_index')::integer,(item->>'direction')::public.question_direction,(item->>'correct_choice_index')::smallint)
        then return null; end if;
      items:=items||jsonb_build_array((item-array['prompt','choices'])||jsonb_build_object('content_version_id',q.content_version_id));
    end loop;
    probe:=p; probe.plan:=jsonb_build_object('contentStorageVersion',2,'questions',items);
  else
    if jsonb_typeof(p.plan)<>'object' or p.plan ? 'contentStorageVersion' or jsonb_typeof(p.plan->'questions')<>'array'
      or not exists(select 1 from private.student_word_practice_runs a where a.id=p.begun_id and a.student_id=p.student_id
        and a.request_key::text=p.request_key and a.request_hash=p.request_hash and a.status in('completed','expired') and a.finished_at is not null)
      then return null; end if;
    for item in select value from jsonb_array_elements(p.plan->'questions') loop
      item_ordinal:=item_ordinal+1;
      select body,content_version_id into r from private.student_word_practice_questions where run_id=p.begun_id and ordinal=item_ordinal;
      if not found or r.content_version_id is null or private.resolve_practice_question_v2(r.body,r.content_version_id) is distinct from item then return null; end if;
      items:=items||jsonb_build_array((item-array['prompt','choices','pronunciation','choicePronunciations','choiceSources'])
        ||jsonb_build_object('content_version_id',r.content_version_id));
    end loop;
    probe:=p; probe.plan:=(p.plan-'questions')||jsonb_build_object('contentStorageVersion',2,'questions',items);
  end if;
  original:=private.resolve_quiz_preparation_plan_v2(p);
  if jsonb_array_length(items)=0 or private.resolve_quiz_preparation_plan_v2(probe) is distinct from original then return null; end if;
  return probe.plan;
exception when invalid_text_representation or data_exception or sqlstate '55000' then return null;
end $$;

create function private.retention_preparation_action_v1(p private.quiz_attempt_preparations,p_cutoff timestamptz)
returns text language plpgsql stable set search_path='' as $$
declare hours integer; proof private.quiz_preparation_compaction_checks; compact jsonb;
begin
  select preparation_hours into strict hours from private.operational_retention_policy where singleton;
  if p.begun_id is null then
    if p.expires_at>p_cutoff-make_interval(hours=>hours) or not isfinite(p.expires_at)
      or exists(select 1 from public.quiz_attempts a where a.id=p.id or
        (a.student_id=p.student_id and a.assignment_id=p.assignment_id and a.status='in_progress'))
      or exists(select 1 from private.student_word_practice_runs a where p.kind='practice' and a.student_id=p.student_id and a.request_key::text=p.request_key)
      or exists(select 1 from private.local_quiz_runs a where a.attempt_id=p.id) then return null; end if;
    return 'expire';
  end if;
  compact:=private.retention_compact_preparation_v1(p);
  if compact is null then return null; end if;
  select * into proof from private.quiz_preparation_compaction_checks where preparation_id=p.id;
  if not found or proof.original_hash<>md5(p.plan::text) or proof.compact_hash<>md5(compact::text) then return 'verify'; end if;
  if proof.compacted_at is null and proof.verified_at<=p_cutoff-make_interval(hours=>hours) then return 'compact'; end if;
  return null;
end $$;

create function private.retention_candidates_v1(p_kind text,p_cutoff timestamptz,p_after text,p_limit integer)
returns table(row_key text,student_id uuid,due_at timestamptz,body_bytes bigint,action text,row_hash text)
language plpgsql stable set search_path='' as $$
declare policy private.operational_retention_policy;
begin
  select * into strict policy from private.operational_retention_policy where singleton;
  if p_kind='cron' then
    return query select d.runid::text,null::uuid,d.end_time,pg_column_size(d)::bigint,'delete',md5(to_jsonb(d)::text)
      from cron.job_run_details d join private.operational_retention_jobs j on j.jobid=d.jobid
      join cron.job live on live.jobid=j.jobid and (live.jobname,live.schedule,live.database,live.username,live.command)
        =(j.jobname,j.schedule,j.database,j.username,j.command)
      where (d.database,d.username,d.command)=(j.database,j.username,j.command)
      and d.runid>coalesce(nullif(p_after,'')::bigint,-1)
      and ((d.status='succeeded' and d.end_time<=p_cutoff-make_interval(days=>policy.success_days))
        or (d.status='failed' and d.end_time<=p_cutoff-make_interval(days=>policy.failure_days)))
      and isfinite(d.end_time) and not exists(select 1 from private.operational_retention_holds h where h.kind=p_kind and h.row_key=d.runid::text)
      order by d.runid limit p_limit;
  elsif p_kind='sessions' then
    return query select s.id::text,s.student_id,least(s.expires_at,s.last_seen_at+interval '60 days',s.revoked_at),pg_column_size(s)::bigint,'delete',md5(to_jsonb(s)::text)
      from public.student_sessions s where s.id>coalesce(nullif(p_after,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid)
      and least(s.expires_at,s.last_seen_at+interval '60 days',s.revoked_at)<=p_cutoff-make_interval(days=>policy.session_days)
      and not exists(select 1 from private.operational_retention_holds h where h.kind=p_kind and h.row_key=s.id::text)
      order by s.id limit p_limit;
  elsif p_kind='login_failures' then
    return query select a.id::text,null::uuid,a.attempted_at,pg_column_size(a)::bigint,'delete',md5(to_jsonb(a)::text)
      from public.student_login_attempts a where a.id>coalesce(nullif(p_after,'')::bigint,-1) and not a.was_successful
      and a.attempted_at<=p_cutoff-make_interval(hours=>policy.login_hours)
      and not exists(select 1 from private.operational_retention_holds h where h.kind=p_kind and h.row_key=a.id::text)
      order by a.id limit p_limit;
  elsif p_kind='preparations' then
    return query select p.id::text,p.student_id,p.expires_at,pg_column_size(p.plan)::bigint,a.value,md5(to_jsonb(p)::text)
      from private.quiz_attempt_preparations p cross join lateral (select private.retention_preparation_action_v1(p,p_cutoff) value) a
      where p.id>coalesce(nullif(p_after,'')::uuid,'00000000-0000-0000-0000-000000000000'::uuid) and a.value is not null
      and not exists(select 1 from private.operational_retention_holds h where h.kind=p_kind and h.row_key=p.id::text)
      order by p.id limit p_limit;
  else raise exception 'retention_kind_invalid' using errcode='22023'; end if;
end $$;

create function private.preview_operational_retention_v1(p_kind text,p_cutoff timestamptz default statement_timestamp(),p_after text default '',p_limit integer default 250)
returns jsonb language plpgsql stable set search_path='' as $$
declare fingerprint text; summary jsonb;
begin
  if current_user<>'postgres' then raise exception 'retention_operator_required' using errcode='42501'; end if;
  if p_cutoff is null or not isfinite(p_cutoff) or p_cutoff>statement_timestamp() or p_limit is null or p_limit not between 1 and 1000 or p_after is null
    then raise exception 'retention_input_invalid' using errcode='22023'; end if;
  fingerprint:=private.retention_policy_hash_v1();
  if fingerprint is null then raise exception 'retention_policy_missing' using errcode='55000'; end if;
  select jsonb_build_object('candidateCount',count(*),'bodyBytes',coalesce(sum(body_bytes),0),'earliest',min(due_at),'latest',max(due_at),
    'hasMore',(select count(*)>p_limit from private.retention_candidates_v1(p_kind,p_cutoff,p_after,p_limit+1)),
    'actions',coalesce(jsonb_agg(jsonb_build_object('key',row_key,'action',action)),'[]')) into summary
    from private.retention_candidates_v1(p_kind,p_cutoff,p_after,p_limit);
  return jsonb_build_object('kind',p_kind,'cutoff',p_cutoff,'policyHash',fingerprint,'after',p_after,'limit',p_limit,'boundedPreview',true)||summary;
end $$;

create function private.run_operational_retention_batch_v1(p_preview jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare target_kind text:=p_preview->>'kind'; cutoff_value timestamptz:=(p_preview->>'cutoff')::timestamptz;
  after_key text:=p_preview->>'after'; row_limit integer:=(p_preview->>'limit')::integer; policy_value text:=p_preview->>'policyHash';
  request_value text; state private.operational_retention_state; c record; p private.quiz_attempt_preparations;
  expired private.quiz_preparation_expirations; compact jsonb; current_hash text; actual_action text; next_key text:=after_key;
  scanned integer:=0; removed integer:=0; verified integer:=0; shrunk integer:=0; skipped integer:=0; affected integer;
  started timestamptz:=clock_timestamp(); result jsonb; fresh jsonb;
begin
  if current_user<>'postgres' then raise exception 'retention_operator_required' using errcode='42501'; end if;
  if not pg_try_advisory_xact_lock(61002,4) then raise exception 'retention_busy' using errcode='55P03'; end if;
  fresh:=private.preview_operational_retention_v1(target_kind,cutoff_value,after_key,row_limit);
  if policy_value is distinct from fresh->>'policyHash' then raise exception 'retention_policy_changed' using errcode='PT409'; end if;
  request_value:=md5(jsonb_build_array(target_kind,cutoff_value,after_key,row_limit,policy_value)::text);
  select * into state from private.operational_retention_state where kind=target_kind for update;
  if found then
    if state.request_hash=request_value then return state.result; end if;
    if state.cutoff=cutoff_value and (state.policy_hash<>policy_value or state.next_cursor is distinct from after_key)
      then raise exception 'retention_cursor_conflict' using errcode='PT409'; end if;
    if state.cutoff>cutoff_value or (state.cutoff<>cutoff_value and after_key<>'') then raise exception 'retention_cutoff_conflict' using errcode='PT409'; end if;
  elsif after_key<>'' then raise exception 'retention_cursor_conflict' using errcode='PT409'; end if;
  if target_kind='cron' then
    perform 1 from cron.job j join private.operational_retention_jobs a on a.jobid=j.jobid order by j.jobid for share of j nowait;
  end if;
  for c in select * from private.retention_candidates_v1(target_kind,cutoff_value,after_key,row_limit) loop
    -- Always advance at least one candidate; do not persist an endlessly replayed zero-progress batch.
    exit when scanned>0 and clock_timestamp()-started>interval '2 seconds';
    scanned:=scanned+1; next_key:=c.row_key; current_hash:=null;
    if target_kind='cron' then
      select md5(to_jsonb(d)::text) into current_hash from cron.job_run_details d where runid=c.row_key::bigint for update skip locked;
      if current_hash=c.row_hash then delete from cron.job_run_details where runid=c.row_key::bigint; removed:=removed+1;
      else skipped:=skipped+1; end if;
    elsif target_kind='sessions' then
      select md5(to_jsonb(s)::text) into current_hash from public.student_sessions s where id=c.row_key::uuid for update skip locked;
      if current_hash=c.row_hash then delete from public.student_sessions where id=c.row_key::uuid; removed:=removed+1;
      else skipped:=skipped+1; end if;
    elsif target_kind='login_failures' then
      select md5(to_jsonb(a)::text) into current_hash from public.student_login_attempts a where id=c.row_key::bigint for update skip locked;
      if current_hash=c.row_hash then delete from public.student_login_attempts where id=c.row_key::bigint; removed:=removed+1;
      else skipped:=skipped+1; end if;
    else
      perform 1 from public.students where id=c.student_id for update skip locked;
      if not found then skipped:=skipped+1; continue; end if;
      select * into p from private.quiz_attempt_preparations where id=c.row_key::uuid for update skip locked;
      if not found then skipped:=skipped+1; continue; end if;
      actual_action:=private.retention_preparation_action_v1(p,cutoff_value);
      if actual_action is distinct from c.action or md5(to_jsonb(p)::text)<>c.row_hash then skipped:=skipped+1; continue; end if;
      if actual_action='expire' then
        insert into private.quiz_preparation_expirations(id,student_id,kind,request_key,request_hash,expired_at)
          values(p.id,p.student_id,p.kind,p.request_key,p.request_hash,p.expires_at) on conflict do nothing;
        select * into expired from private.quiz_preparation_expirations where id=p.id;
        if not found or (expired.student_id,expired.kind,expired.request_key,expired.request_hash,expired.expired_at)
          is distinct from (p.student_id,p.kind,p.request_key,p.request_hash,p.expires_at)
          then raise exception 'retention_expiration_conflict' using errcode='PT409'; end if;
        delete from private.quiz_attempt_preparations where id=p.id; removed:=removed+1;
      else
        compact:=private.retention_compact_preparation_v1(p);
        if compact is null then skipped:=skipped+1; continue; end if;
        if actual_action='verify' then
          insert into private.quiz_preparation_compaction_checks(preparation_id,original_hash,compact_hash,verified_at)
            values(p.id,md5(p.plan::text),md5(compact::text),clock_timestamp()) on conflict(preparation_id) do update
            set original_hash=excluded.original_hash,compact_hash=excluded.compact_hash,verified_at=excluded.verified_at,compacted_at=null;
          verified:=verified+1;
        else
          update private.quiz_attempt_preparations set plan=compact where id=p.id;
          update private.quiz_preparation_compaction_checks set compacted_at=clock_timestamp() where preparation_id=p.id;
          shrunk:=shrunk+1;
        end if;
      end if;
    end if;
  end loop;
  result:=jsonb_build_object('kind',target_kind,'cutoff',cutoff_value,'policyHash',policy_value,'scanned',scanned,'removed',removed,
    'verified',verified,'compacted',shrunk,'skipped',skipped,'nextCursor',next_key,'requiresRescan',skipped>0,
    'hasMore',exists(select 1 from private.retention_candidates_v1(target_kind,cutoff_value,next_key,1)),
    'durationMs',floor(extract(epoch from(clock_timestamp()-started))*1000));
  insert into private.operational_retention_state(kind,cutoff,policy_hash,request_hash,next_cursor,result)
    values(target_kind,cutoff_value,policy_value,request_value,next_key,result) on conflict(kind) do update
    set cutoff=excluded.cutoff,policy_hash=excluded.policy_hash,request_hash=excluded.request_hash,next_cursor=excluded.next_cursor,
      result=excluded.result,updated_at=clock_timestamp();
  return result;
end $$;

-- Holds must not claim success after the target was already removed.
create function private.set_operational_retention_hold_v1(p_kind text,p_key text,p_reason text)
returns void language plpgsql set search_path='' as $$
declare present boolean; canonical_key text;
begin
  if current_user<>'postgres' then raise exception 'retention_operator_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(61002,4);
  canonical_key:=case when p_kind in('cron','login_failures') then p_key::bigint::text
    when p_kind in('sessions','preparations') then p_key::uuid::text else null end;
  if p_kind='cron' then select exists(select 1 from cron.job_run_details where runid=p_key::bigint) into present;
  elsif p_kind='sessions' then select exists(select 1 from public.student_sessions where id=p_key::uuid) into present;
  elsif p_kind='login_failures' then select exists(select 1 from public.student_login_attempts where id=p_key::bigint) into present;
  elsif p_kind='preparations' then select exists(select 1 from private.quiz_attempt_preparations where id=p_key::uuid) into present;
  else raise exception 'retention_kind_invalid' using errcode='22023'; end if;
  if p_reason is null then delete from private.operational_retention_holds where kind=p_kind and row_key=canonical_key; return; end if;
  if not present then raise exception 'retention_target_missing' using errcode='P0002'; end if;
  insert into private.operational_retention_holds(kind,row_key,reason) values(p_kind,canonical_key,p_reason)
    on conflict(kind,row_key) do update set reason=excluded.reason;
end $$;

revoke all on function private.lock_operational_retention_v1(),private.retention_policy_hash_v1(),
  private.retention_compact_preparation_v1(private.quiz_attempt_preparations),private.retention_preparation_action_v1(private.quiz_attempt_preparations,timestamptz),
  private.retention_candidates_v1(text,timestamptz,text,integer),private.preview_operational_retention_v1(text,timestamptz,text,integer),
  private.run_operational_retention_batch_v1(jsonb),private.set_operational_retention_hold_v1(text,text,text)
from public,anon,authenticated,service_role;
commit;
