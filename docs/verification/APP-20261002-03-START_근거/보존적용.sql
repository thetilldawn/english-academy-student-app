begin;
set transaction isolation level repeatable read;
set local statement_timeout='25s';set local lock_timeout='3s';set local timezone='UTC';set local datestyle='ISO, YMD';
create temporary table start_control_before_rows(schema_name text,table_name text,amount bigint,fingerprint text) on commit drop;
do $snapshot$
declare t record; amount bigint; fingerprint text;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'
 and (c.relname ~ '^(student|assignment|quiz|local_quiz|vocabulary_answer|vocabulary_expired|vocabulary_legacy|vocabulary_question_meaning|worksheet_mistake|notebook_question_origins)'
 or c.relname='admin_profiles') and c.relname not like 'student_app_maintenance%' order by n.nspname,c.relname loop
  execute format('select count(*),encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''''),''UTF8''),''sha256''),''hex'') from (select encode(extensions.digest(convert_to(to_jsonb(r)::text,''UTF8''),''sha256''),''hex'') h from %I.%I r) s',t.nspname,t.relname) into amount,fingerprint;
  insert into start_control_before_rows values(t.nspname,t.relname,amount,fingerprint);
 end loop;
end;
$snapshot$;
create temporary table start_control_other_functions on commit drop as select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'private.guard_new_attempt_release_v1()'::regprocedure;

create temporary table start_control_guard_meta on commit drop as select to_jsonb(p)-'prosrc' meta from pg_proc p where oid='private.guard_new_attempt_release_v1()'::regprocedure;
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

do $guard_meta$ begin if (select meta from start_control_guard_meta) is distinct from (select to_jsonb(p)-'prosrc' from pg_proc p where oid='private.guard_new_attempt_release_v1()'::regprocedure) then raise exception 'start_control_guard_meta_changed';end if;end $guard_meta$;
do $preserve$
declare t record; amount bigint; fingerprint text;
begin
 for t in select * from start_control_before_rows loop
  execute format('select count(*),encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''''),''UTF8''),''sha256''),''hex'') from (select encode(extensions.digest(convert_to(to_jsonb(r)::text,''UTF8''),''sha256''),''hex'') h from %I.%I r) s',t.schema_name,t.table_name) into amount,fingerprint;
  if amount is distinct from t.amount or fingerprint is distinct from t.fingerprint then
   raise exception 'start_control_student_preservation_mismatch: %.%',t.schema_name,t.table_name using errcode='55000';
  end if;
 end loop;
 if exists((select * from start_control_other_functions except select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'private.guard_new_attempt_release_v1()'::regprocedure) union all (select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'private.guard_new_attempt_release_v1()'::regprocedure except select * from start_control_other_functions)) then
  raise exception 'start_control_other_function_mismatch' using errcode='55000';
 end if;
end;
$preserve$;
commit;
