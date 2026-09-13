begin;
alter table public.students add column school_key text
  check (school_key is null or school_key ~ '^[A-Z][0-9]{2}:[0-9]{7}$');

create table private.school_schedule_versions (
  school_key text not null check (school_key ~ '^[A-Z][0-9]{2}:[0-9]{7}$'),
  academic_year integer not null check (academic_year between 2020 and 2200),
  semester smallint not null check (semester in (1,2)),
  version_id text primary key check (length(version_id) between 1 and 120),
  source_hash text not null check (source_hash ~ '^[a-f0-9]{64}$'),
  is_current boolean not null default true,
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create unique index school_schedule_current on private.school_schedule_versions(school_key,academic_year,semester) where is_current;
alter table private.school_schedule_versions enable row level security;
revoke all on private.school_schedule_versions from public, anon, authenticated, service_role;

create or replace function private.get_admin_student_profile_v1(
  p_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'invalid_student_profile_request'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', student.id,
    'displayName', student.display_name,
    'schoolName', student.school_name,
    'schoolKey', student.school_key,
    'gradeLabel', student.grade_label,
    'updatedAt', student.profile_updated_at
  )
  into result
  from public.students as student
  where student.id = p_student_id
    and student.deleted_at is null;

  return result;
end;
$$;
create or replace function public.get_admin_student_detail_initial_v2(
  p_student_id uuid,
  p_snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  detail jsonb;
  profile_version timestamptz;
  school_key text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  detail := public.get_admin_student_detail_initial_v1(
    p_student_id,
    p_snapshot_at
  );
  if detail is null then
    return null;
  end if;

  select student.profile_updated_at, student.school_key
  into profile_version, school_key
  from public.students as student
  where student.id = p_student_id
    and student.deleted_at is null;
  if not found then
    return null;
  end if;

  return jsonb_set(
    detail,
    '{student}',
    (detail -> 'student') || jsonb_build_object(
      'updatedAt', profile_version, 'schoolKey', school_key
    ),
    true
  );
end;
$$;
create or replace function private.update_admin_student_profile_v1(
  p_student_id uuid,
  p_base_version timestamptz,
  p_display_name text,
  p_school_name text,
  p_grade_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_student public.students%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_base_version is null
    or not isfinite(p_base_version)
    or nullif(trim(p_display_name), '') is null
    or char_length(trim(p_display_name)) > 80
    or char_length(trim(coalesce(p_school_name, ''))) > 120
    or char_length(trim(coalesce(p_grade_label, ''))) > 40
  then
    raise exception 'invalid_student_profile_update'
      using errcode = '22023';
  end if;

  update public.students as student
  set display_name = trim(p_display_name),
      school_key = case when student.school_name is not distinct from nullif(trim(coalesce(p_school_name, '')), '') then student.school_key else null end,
      school_name = nullif(trim(coalesce(p_school_name, '')), ''),
      grade_label = nullif(trim(coalesce(p_grade_label, '')), ''),
      profile_updated_at = greatest(
        clock_timestamp(),
        student.profile_updated_at + interval '1 microsecond'
      )
  where student.id = p_student_id
    and student.deleted_at is null
    and student.profile_updated_at = p_base_version
  returning student.* into updated_student;

  if not found then
    if not exists (
      select 1
      from public.students as student
      where student.id = p_student_id
        and student.deleted_at is null
    ) then
      raise exception 'student_not_found' using errcode = 'P0002';
    end if;
    raise exception 'student_profile_conflict' using errcode = '40001';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  ) values (
    'student.profile_updated',
    (select auth.uid()),
    updated_student.id,
    jsonb_build_object(
      'display_name', updated_student.display_name,
      'school_name', updated_student.school_name,
      'grade_label', updated_student.grade_label
    )
  );

  return jsonb_build_object(
    'id', updated_student.id,
    'displayName', updated_student.display_name,
    'schoolName', updated_student.school_name,
    'gradeLabel', updated_student.grade_label,
    'updatedAt', updated_student.profile_updated_at
  );
end;
$$;
create function private.update_admin_student_profile_v2(
  p_student_id uuid,
  p_base_version timestamptz,
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_school_key text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_student public.students%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or (p_school_key is not null and (p_school_key !~ '^[A-Z][0-9]{2}:[0-9]{7}$' or nullif(trim(p_school_name), '') is null))
    or p_base_version is null
    or not isfinite(p_base_version)
    or nullif(trim(p_display_name), '') is null
    or char_length(trim(p_display_name)) > 80
    or char_length(trim(coalesce(p_school_name, ''))) > 120
    or char_length(trim(coalesce(p_grade_label, ''))) > 40
  then
    raise exception 'invalid_student_profile_update'
      using errcode = '22023';
  end if;

  update public.students as student
  set display_name = trim(p_display_name),
      school_key = p_school_key,
      school_name = nullif(trim(coalesce(p_school_name, '')), ''),
      grade_label = nullif(trim(coalesce(p_grade_label, '')), ''),
      profile_updated_at = greatest(
        clock_timestamp(),
        student.profile_updated_at + interval '1 microsecond'
      )
  where student.id = p_student_id
    and student.deleted_at is null
    and student.profile_updated_at = p_base_version
  returning student.* into updated_student;

  if not found then
    if not exists (
      select 1
      from public.students as student
      where student.id = p_student_id
        and student.deleted_at is null
    ) then
      raise exception 'student_not_found' using errcode = 'P0002';
    end if;
    raise exception 'student_profile_conflict' using errcode = '40001';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  ) values (
    'student.profile_updated',
    (select auth.uid()),
    updated_student.id,
    jsonb_build_object(
      'display_name', updated_student.display_name,
      'school_name', updated_student.school_name, 'school_key', updated_student.school_key,
      'grade_label', updated_student.grade_label
    )
  );

  return jsonb_build_object(
    'id', updated_student.id,
    'displayName', updated_student.display_name,
    'schoolName', updated_student.school_name, 'schoolKey', updated_student.school_key,
    'gradeLabel', updated_student.grade_label,
    'updatedAt', updated_student.profile_updated_at
  );
end;
$$;

create function public.update_admin_student_profile_v2(p_student_id uuid,p_base_version timestamptz,p_display_name text,p_school_name text,p_grade_label text,p_school_key text)
returns jsonb language sql security definer set search_path='' as $$
 select private.update_admin_student_profile_v2(p_student_id,p_base_version,p_display_name,p_school_name,p_grade_label,p_school_key);
$$;
revoke all on function private.update_admin_student_profile_v2(uuid,timestamptz,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.update_admin_student_profile_v2(uuid,timestamptz,text,text,text,text) from public,anon,service_role;
grant execute on function public.update_admin_student_profile_v2(uuid,timestamptz,text,text,text,text) to authenticated;

create function public.create_student_with_code_v3(p_display_name text,p_school_name text,p_grade_label text,p_current_vocab_dataset_id uuid,p_note text,p_lookup_hmac text,p_encrypted_code text,p_encryption_iv text,p_encryption_tag text,p_school_key text)
returns table(student_id uuid) language plpgsql security definer set search_path='' as $$
declare created_id uuid;
begin
 if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_school_key is not null and (p_school_key !~ '^[A-Z][0-9]{2}:[0-9]{7}$' or nullif(trim(p_school_name),'') is null) then raise exception 'invalid_school' using errcode='22023'; end if;
 select created.student_id into created_id from public.create_student_with_code_v2(p_display_name,p_school_name,p_grade_label,p_current_vocab_dataset_id,p_note,p_lookup_hmac,p_encrypted_code,p_encryption_iv,p_encryption_tag) created;
 if p_school_key is not null then
   update public.students set school_key=p_school_key where id=created_id;
   insert into public.audit_events(event_type,actor_admin_id,student_id,details)
   values('student.school_selected',auth.uid(),created_id,jsonb_build_object('school_key',p_school_key));
 end if;
 return query select created_id;
end; $$;
revoke all on function public.create_student_with_code_v3(text,text,text,uuid,text,text,text,text,text,text) from public,anon,service_role;
grant execute on function public.create_student_with_code_v3(text,text,text,uuid,text,text,text,text,text,text) to authenticated;

create function private.school_schedule_payload(p_student_ids uuid[],p_active_only boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected as (
   select id,school_key,school_name,grade_label from public.students
   where deleted_at is null and (not p_active_only or status='active')
     and (p_student_ids is null or id=any(p_student_ids))
 ) select jsonb_build_object(
   'students',coalesce((select jsonb_agg(jsonb_build_object('id',id,'schoolKey',school_key,'schoolName',school_name,'gradeLabel',grade_label) order by id) from selected),'[]'::jsonb),
   'bundles',coalesce((select jsonb_agg(payload order by school_key,academic_year,semester) from private.school_schedule_versions v where is_current and exists(select 1 from selected s where s.school_key=v.school_key)),'[]'::jsonb)
 );
$$;
revoke all on function private.school_schedule_payload(uuid[],boolean) from public,anon,authenticated,service_role;
create function public.get_admin_school_schedules_v1(p_student_ids uuid[] default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 if p_student_ids is not null and cardinality(p_student_ids)>100 then raise exception 'invalid_request' using errcode='22023'; end if;
 return private.school_schedule_payload(p_student_ids,p_student_ids is null);
end; $$;
revoke all on function public.get_admin_school_schedules_v1(uuid[]) from public,anon,service_role;
grant execute on function public.get_admin_school_schedules_v1(uuid[]) to authenticated;
create function public.get_student_school_schedule_v1(p_student_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select private.school_schedule_payload(array[p_student_id],true);
$$;
revoke all on function public.get_student_school_schedule_v1(uuid) from public,anon,authenticated;
grant execute on function public.get_student_school_schedule_v1(uuid) to service_role;

create function public.register_school_schedule_v1(p_payload jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare existing private.school_schedule_versions%rowtype; item jsonb;
begin
 if jsonb_typeof(p_payload) is distinct from 'object'
   or not (p_payload ?& array['schoolKey','schoolName','schoolLevel','academicYear','semester','versionId','sourceHash','checkedOn','events'])
   or (select count(*) from jsonb_object_keys(p_payload)) <> 9
   or jsonb_typeof(p_payload->'schoolName') is distinct from 'string' or length(p_payload->>'schoolName') not between 1 and 120
   or coalesce(p_payload->>'schoolKey','') !~ '^[A-Z][0-9]{2}:[0-9]{7}$'
   or jsonb_typeof(p_payload->'sourceHash') is distinct from 'string' or coalesce(p_payload->>'sourceHash','') !~ '^[a-f0-9]{64}$'
   or jsonb_typeof(p_payload->'versionId') is distinct from 'string' or length(p_payload->>'versionId') not between 1 and 120
   or coalesce(p_payload->>'schoolLevel','') not in ('중','고')
   or jsonb_typeof(p_payload->'academicYear') is distinct from 'number' or coalesce(p_payload->>'academicYear','') !~ '^[0-9]{4}$'
   or jsonb_typeof(p_payload->'semester') is distinct from 'number' or coalesce(p_payload->>'semester','') not in ('1','2')
   or coalesce(p_payload->>'checkedOn','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   or jsonb_typeof(p_payload->'events') is distinct from 'array'
   or jsonb_array_length(p_payload->'events')>300
 then raise exception 'invalid_schedule' using errcode='22023'; end if;
 perform (p_payload->>'checkedOn')::date;
 -- Serialize both the existing-version check and promotion of a current version.
 perform pg_advisory_xact_lock(hashtextextended((p_payload->>'schoolKey')||':'||(p_payload->>'academicYear')||':'||(p_payload->>'semester'),0));
 select * into existing from private.school_schedule_versions where version_id=p_payload->>'versionId';
 if found then
   if existing.payload is distinct from p_payload then raise exception 'schedule_version_conflict' using errcode='22023'; end if;
   return existing.version_id;
 end if;
 for item in select value from jsonb_array_elements(p_payload->'events') loop
   if jsonb_typeof(item) is distinct from 'object'
     or not (item ?& array['id','grade','kind','round','title','subject','startDate','endDate','precision','status','dateText','maxPoints','applicability','sourceUrl'])
     or (select count(*) from jsonb_object_keys(item)) <> (14 + case when item ? 'sourceLabel' then 1 else 0 end)
     or jsonb_typeof(item->'id') is distinct from 'string' or length(item->>'id')<1
     or jsonb_typeof(item->'title') is distinct from 'string' or length(item->>'title') not between 1 and 240
     or jsonb_typeof(item->'dateText') is distinct from 'string' or length(item->>'dateText')>300
     or jsonb_typeof(item->'subject') not in ('null','string') or length(item->>'subject')>80
     or jsonb_typeof(item->'grade') is distinct from 'number' or coalesce(item->>'grade','') not in ('1','2','3')
     or coalesce(item->>'kind','') not in ('written','performance')
     or coalesce(item->>'precision','') not in ('day','range','week','month','unknown','none')
     or coalesce(item->>'status','') not in ('confirmed','planned','unknown','not-held')
     or coalesce(item->>'applicability','') not in ('grade','enrollment-unconfirmed')
     or jsonb_typeof(item->'sourceUrl') not in ('null','string')
     or (item->>'sourceUrl' is not null and item->>'sourceUrl' !~ '^https://[A-Za-z0-9][A-Za-z0-9.-]*\.[A-Za-z]{2,}([/?#][^[:space:]\\]*)?$')
     or (item ? 'sourceLabel' and (jsonb_typeof(item->'sourceLabel') is distinct from 'string' or length(item->>'sourceLabel') not between 1 and 120 or coalesce(item->>'sourceLabel','') !~ '[^[:space:]]'))
     or (item->>'sourceUrl' is null and (not (item ? 'sourceLabel') or coalesce(item->>'sourceLabel','') !~ '[^[:space:]]'))
     or (item->>'round' is not null and (jsonb_typeof(item->'round') is distinct from 'number' or item->>'round' not in ('1','2')))
     or (item->>'kind'='written' and item->>'round' is null)
     or (item->>'maxPoints' is not null and (jsonb_typeof(item->'maxPoints') is distinct from 'number' or (item->>'maxPoints')::numeric not between 0 and 1000))
     or ((item->>'status'='not-held') is distinct from (item->>'precision'='none'))
     or (item->>'precision'='unknown' and item->>'status'<>'unknown')
     or (coalesce(item->>'precision','') in ('unknown','none','month','week') and (item->>'startDate' is not null or item->>'endDate' is not null))
     or (item->>'precision' in ('day','range') and (coalesce(item->>'startDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(item->>'endDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
   then raise exception 'invalid_schedule_event' using errcode='22023'; end if;
   if item->>'startDate' is not null and ((item->>'startDate')::date>(item->>'endDate')::date or (item->>'precision'='day' and item->>'startDate'<>item->>'endDate')) then
     raise exception 'invalid_schedule_date' using errcode='22023';
   end if;
 end loop;
 if (select count(distinct value->>'id') from jsonb_array_elements(p_payload->'events')) <> jsonb_array_length(p_payload->'events') then raise exception 'duplicate_schedule_event' using errcode='22023'; end if;
 update private.school_schedule_versions set is_current=false where school_key=p_payload->>'schoolKey' and academic_year=(p_payload->>'academicYear')::int and semester=(p_payload->>'semester')::int and is_current;
 insert into private.school_schedule_versions(school_key,academic_year,semester,version_id,source_hash,payload)
 values(p_payload->>'schoolKey',(p_payload->>'academicYear')::int,(p_payload->>'semester')::int,p_payload->>'versionId',p_payload->>'sourceHash',p_payload);
 return p_payload->>'versionId';
end; $$;
revoke all on function public.register_school_schedule_v1(jsonb) from public,anon,authenticated;
grant execute on function public.register_school_schedule_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
