begin isolation level repeatable read;
set local search_path=public;set local lock_timeout='5s';set local statement_timeout='120s';set local timezone='UTC';
create temporary table m10_preinstall_functions on commit drop as select p.oid,n.nspname schema,p.proname name,to_jsonb(p) metadata from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','word_index');
create temporary table m10_preinstall_tables on commit drop as select c.oid,n.nspname schema,c.relname name,c.relrowsecurity,c.relforcerowsecurity,c.relowner,c.relacl from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','private','word_index','cron');
create temporary table m10_preinstall_policies on commit drop as select to_jsonb(p) metadata from pg_policy p where p.polrelid in(select oid from m10_preinstall_tables);
create temporary table m10_preinstall_triggers on commit drop as select to_jsonb(t) metadata from pg_trigger t where t.tgrelid in(select oid from m10_preinstall_tables);
create temporary table m10_preinstall_hashes(oid oid primary key,rows bigint,hash text) on commit drop;
do $g$declare t record;c bigint;h text;begin
 if current_setting('transaction_isolation')<>'repeatable read' then raise exception 'm10_preinstall_isolation';end if;
 if to_regclass('private.quiz_start_control') is not null or to_regprocedure('public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])') is not null then raise exception 'm10_preinstall_already_present';end if;
 if (select count(*) from m10_preinstall_functions)<>590 or (select md5(prosrc) from pg_proc where oid='private.guard_new_attempt_release_v1()'::regprocedure)<>'9af270f54ad56c0512a8b10d9e82da1e' then raise exception 'm10_preinstall_baseline_drift';end if;
 for t in select * from m10_preinstall_tables loop
  execute format('select count(*),md5(coalesce(string_agg(h,'''' order by h),'''')) from(select md5(to_jsonb(r)::text) h from %I.%I r)s',t.schema,t.name) into c,h;
  insert into m10_preinstall_hashes values(t.oid,c,h);
 end loop;
end;$g$;
-- Operator-only control. Changing this row must be its own short transaction:
-- commit before deployment, preservation scans, or touching any student row.
create table private.quiz_start_control (
  singleton boolean primary key default true check (singleton),
  paused boolean not null default false,
  changed_at timestamptz not null default clock_timestamp()
);
alter table private.quiz_start_control enable row level security;
revoke all on table private.quiz_start_control from public, anon, authenticated, service_role;
insert into private.quiz_start_control(singleton, paused) values (true, false);

create or replace function private.guard_new_attempt_release_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
declare release_state text; starts_paused boolean;
begin
  -- Preserve the existing student lock order. Concurrent starts share this row;
  -- an operator UPDATE must wait for admitted starts to commit (and vice versa).
  perform 1 from public.students where id = new.student_id for update;
  select c.paused into starts_paused from private.quiz_start_control c
    where c.singleton for share;
  if not found then
    raise exception 'quiz_start_control_unavailable' using errcode = '55000';
  end if;
  if starts_paused then
    raise exception 'quiz_new_attempts_paused' using errcode = '55000';
  end if;
  release_state := private.student_assignment_release_v1(new.student_id, new.assignment_id, clock_timestamp())->>'state';
  if release_state not in ('open','unrestricted') then
    raise exception 'assignment_release_%', release_state using errcode = '55000';
  end if;
  return new;
end;
$$;

-- APP-20261004-02: preinstall before compact content to keep the legacy app readable.
-- No new table access: the future canonical reader still checks ownership and scope.
create function public.read_m10_transition_question_contents_v1(
  p_context text, p_actor_id uuid, p_context_id uuid, p_question_ids uuid[]
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_context is null or p_context not in ('student_preparation','student_assignment') then
    raise exception 'transition_content_context_invalid' using errcode='22023';
  end if;
  execute 'select public.read_question_contents_v1($1,$2,$3,$4)'
    into result using p_context,p_actor_id,p_context_id,p_question_ids;
  return result;
end;
$$;
revoke all on function public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])
  to service_role;
notify pgrst,'reload schema';
do $g$declare t record;f record;c bigint;h text;a jsonb;e jsonb;begin
 for t in select b.*,x.rows,x.hash from m10_preinstall_tables b join m10_preinstall_hashes x using(oid) loop
  if not exists(select 1 from pg_class p where p.oid=t.oid and p.relrowsecurity=t.relrowsecurity and p.relforcerowsecurity=t.relforcerowsecurity and p.relowner=t.relowner and p.relacl is not distinct from t.relacl) or to_regclass(format('%I.%I',t.schema,t.name))::oid is distinct from t.oid then raise exception 'm10_preinstall_table_changed';end if;
  execute format('select count(*),md5(coalesce(string_agg(h,'''' order by h),'''')) from(select md5(to_jsonb(r)::text) h from %I.%I r)s',t.schema,t.name) into c,h;
  if c<>t.rows or h is distinct from t.hash then raise exception 'm10_preinstall_rows_changed: %.%',t.schema,t.name;end if;
 end loop;
 for f in select * from m10_preinstall_functions loop
  select to_jsonb(p) into a from pg_proc p where p.oid=f.oid;e:=f.metadata;
  if f.oid='private.guard_new_attempt_release_v1()'::regprocedure then
   if md5(a->>'prosrc')<>'d0a14ce490d6fd061335bcc6979545c0' then raise exception 'm10_preinstall_guard_body';end if;e:=e||jsonb_build_object('prosrc',a->'prosrc');
  end if;
  if a is distinct from e then raise exception 'm10_preinstall_function_changed: %.%',f.schema,f.name;end if;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','private','word_index'))<>591 then raise exception 'm10_preinstall_function_count';end if;
 if not exists(select 1 from pg_proc p where p.oid='public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])'::regprocedure and not p.prosecdef and p.prolang=(select oid from pg_language where lanname='plpgsql') and p.prorettype='jsonb'::regtype and not p.proretset and p.provolatile='v' and not p.proisstrict and pg_get_userbyid(p.proowner)='postgres' and p.proconfig=array['search_path=""']::text[] and p.proacl::text='{postgres=X/postgres,service_role=X/postgres}' and md5(p.prosrc)='18511846acf8c0131f11975e562ff0eb') then raise exception 'm10_preinstall_reader_contract';end if;
 if (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','private','word_index','cron') and c.oid not in(select oid from m10_preinstall_tables))<>1 then raise exception 'm10_preinstall_table_count';end if;
 if not exists(select 1 from pg_class c where c.oid='private.quiz_start_control'::regclass and c.relrowsecurity and not c.relforcerowsecurity and pg_get_userbyid(c.relowner)='postgres') or exists(select 1 from aclexplode((select relacl from pg_class where oid='private.quiz_start_control'::regclass)) a where a.grantee<>'postgres'::regrole) or exists(select 1 from pg_policy where polrelid='private.quiz_start_control'::regclass) then raise exception 'm10_preinstall_control_acl';end if;
 if (select count(*) from private.quiz_start_control)<>1 or not exists(select 1 from private.quiz_start_control where singleton and not paused and changed_at between transaction_timestamp() and clock_timestamp()) then raise exception 'm10_preinstall_control_row';end if;
 if exists((select metadata from m10_preinstall_policies except select to_jsonb(p) from pg_policy p where p.polrelid in(select oid from m10_preinstall_tables)) union all (select to_jsonb(p) from pg_policy p where p.polrelid in(select oid from m10_preinstall_tables) except select metadata from m10_preinstall_policies)) then raise exception 'm10_preinstall_policy_changed';end if;
 if exists((select metadata from m10_preinstall_triggers except select to_jsonb(tr) from pg_trigger tr where tr.tgrelid in(select oid from m10_preinstall_tables)) union all (select to_jsonb(tr) from pg_trigger tr where tr.tgrelid in(select oid from m10_preinstall_tables) except select metadata from m10_preinstall_triggers)) then raise exception 'm10_preinstall_trigger_changed';end if;
end;$g$;
select jsonb_build_object('originalTables',(select count(*) from m10_preinstall_tables),'originalRows',(select sum(rows) from m10_preinstall_hashes),'originalFunctions',590,'changedFunctionBodies',1,'addedFunctions',1,'newControlRows',1,'paused',false,'preserved',true) as preservation;
commit;
