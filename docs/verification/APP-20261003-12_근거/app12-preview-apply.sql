-- APP-20261003-12: exact student notification DDL with before/after row preservation.
begin;
set transaction isolation level repeatable read;
set local statement_timeout='25s';set local lock_timeout='3s';set local timezone='UTC';set local datestyle='ISO, YMD';
create temporary table app12_before_rows(schema_name text,table_name text,amount bigint,fingerprint text) on commit drop;
do $snapshot$
declare t record; amount bigint; fingerprint text;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'
 and (c.relname ~ '^(student|assignment|quiz|local_quiz|vocabulary_answer|vocabulary_expired|vocabulary_legacy|vocabulary_question_meaning|worksheet_mistake|notebook_question_origins)'
 or c.relname in ('admin_profiles','notification_receipts')) and c.relname not like 'student_app_maintenance%' order by n.nspname,c.relname loop
  execute format('select count(*),encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''''),''UTF8''),''sha256''),''hex'') from (select encode(extensions.digest(convert_to(to_jsonb(r)::text,''UTF8''),''sha256''),''hex'') h from %I.%I r) s',t.nspname,t.relname) into amount,fingerprint;
  insert into app12_before_rows values(t.nspname,t.relname,amount,fingerprint);
 end loop;
end;
$snapshot$;
create temporary table app12_other_functions on commit drop as select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'public.claim_student_notifications_v1(uuid)'::regprocedure;

-- APP-20261003-12: serialize student notification claims before assignment FK locks.
-- Existing counts, eligibility, receipts and service-role-only execution are unchanged.

create temporary table app12_notification_meta on commit drop as
select to_jsonb(p)-'prosrc'-'prolang' value from pg_proc p
where p.oid='public.claim_student_notifications_v1(uuid)'::regprocedure;

create or replace function public.claim_student_notifications_v1(
  p_student_id uuid
)
returns table (
  new_assignment_count integer,
  deadline_soon_count integer
)
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Match quiz creation: lock the student before any assignment FK locks.
  -- The separate query takes a fresh snapshot after an in-flight start finishes.
  perform 1 from public.students as student
  where student.id = p_student_id
  for update;

  return query
  with claimed_assignments as (
    insert into public.notification_receipts (
      viewer_role,
      viewer_id,
      notification_type,
      assignment_id,
      student_id,
      deadline_version
    )
    select
      'student',
      p_student_id,
      'new_assignment',
      assignment_link.assignment_id,
      assignment_link.student_id,
      '-infinity'::timestamptz
    from public.assignment_students as assignment_link
    join public.assignments as assignment
      on assignment.id = assignment_link.assignment_id
    where assignment_link.student_id = p_student_id
      and assignment_link.cancelled_at is null
      and assignment_link.missed_at is null
      and assignment.deleted_at is null
      and assignment.status = 'active'
      and (assignment.available_from is null
        or assignment.available_from <= clock_timestamp())
      and (private.student_assignment_release_v1(
        assignment_link.student_id, assignment_link.assignment_id, clock_timestamp()
      )->>'state') in ('open', 'unrestricted')
      and not exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = assignment_link.assignment_id
          and attempt.student_id = assignment_link.student_id
      )
    on conflict do nothing
    returning 1
  ),
  claimed_deadlines as (
    insert into public.notification_receipts (
      viewer_role,
      viewer_id,
      notification_type,
      assignment_id,
      student_id,
      deadline_version
    )
    select
      'student',
      p_student_id,
      'deadline_soon',
      assignment_link.assignment_id,
      assignment_link.student_id,
      assignment.available_until
    from public.assignment_students as assignment_link
    join public.assignments as assignment
      on assignment.id = assignment_link.assignment_id
    where assignment_link.student_id = p_student_id
      and assignment_link.cancelled_at is null
      and assignment_link.missed_at is null
      and assignment.deleted_at is null
      and assignment.status = 'active'
      and (assignment.available_from is null
        or assignment.available_from <= clock_timestamp())
      and (private.student_assignment_release_v1(
        assignment_link.student_id, assignment_link.assignment_id, clock_timestamp()
      )->>'state') in ('open', 'unrestricted')
      and assignment.available_until > clock_timestamp()
      and assignment.available_until <= clock_timestamp() + interval '8 hours'
      and not exists (
        select 1
        from public.quiz_attempts as attempt
        where attempt.assignment_id = assignment_link.assignment_id
          and attempt.student_id = assignment_link.student_id
      )
    on conflict do nothing
    returning 1
  )
  select
    (select count(*)::integer from claimed_assignments),
    (select count(*)::integer from claimed_deadlines);
end;
$$;

do $verify$
begin
  if not exists (select 1 from app12_notification_meta) or not exists (
    select 1 from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid='public.claim_student_notifications_v1(uuid)'::regprocedure
      and l.lanname='plpgsql'
      and (to_jsonb(p)-'prosrc'-'prolang')=(select value from app12_notification_meta)
  ) then raise exception 'notification_function_metadata_changed' using errcode='55000'; end if;
end;
$verify$;

notify pgrst, 'reload schema';


do $preserve$
declare t record; amount bigint; fingerprint text;
begin
 for t in select * from app12_before_rows loop
  execute format('select count(*),encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''''),''UTF8''),''sha256''),''hex'') from (select encode(extensions.digest(convert_to(to_jsonb(r)::text,''UTF8''),''sha256''),''hex'') h from %I.%I r) s',t.schema_name,t.table_name) into amount,fingerprint;
  if amount is distinct from t.amount or fingerprint is distinct from t.fingerprint then
   raise exception 'app12_student_preservation_mismatch: %.%',t.schema_name,t.table_name using errcode='55000';
  end if;
 end loop;
 if exists((select * from app12_other_functions except select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'public.claim_student_notifications_v1(uuid)'::regprocedure) union all (select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'public.claim_student_notifications_v1(uuid)'::regprocedure except select * from app12_other_functions)) then
  raise exception 'app12_other_function_mismatch' using errcode='55000';
 end if;
end;
$preserve$;
commit;
