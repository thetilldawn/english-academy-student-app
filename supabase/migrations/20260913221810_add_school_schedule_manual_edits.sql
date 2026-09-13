begin;

-- Administrator corrections never replace the immutable source versions.
create table private.school_schedule_manual_edits (
  revision bigint generated always as identity primary key,
  request_id uuid not null unique,
  school_key text not null check (school_key ~ '^[A-Z][0-9]{2}:[0-9]{7}$'),
  academic_year integer not null check (academic_year between 2020 and 2200),
  semester integer not null check (semester in (1,2)),
  school_name text not null,
  school_level text not null check (school_level in ('중','고')),
  event_id text not null,
  event jsonb not null,
  source_version_id text,
  base_manual_revision bigint not null,
  request_payload jsonb not null,
  actor_admin_id uuid not null,
  created_at timestamptz not null default clock_timestamp()
);
create index school_schedule_manual_scope_event on private.school_schedule_manual_edits
  (school_key,academic_year,semester,event_id,revision desc);
alter table private.school_schedule_manual_edits enable row level security;
revoke all on private.school_schedule_manual_edits from public,anon,authenticated,service_role;
revoke all on sequence private.school_schedule_manual_edits_revision_seq from public,anon,authenticated,service_role;

create function private.validate_school_schedule_manual_event(item jsonb)
returns void language plpgsql set search_path='' as $$
begin
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
  if item->>'sourceUrl' is not null or item->>'sourceLabel' is distinct from '관리자 수동 입력'
     or length(trim(item->>'title'))=0 or length(item->>'id')>180
     or (item->>'precision' in ('week','month') and length(trim(item->>'dateText'))=0)
     or (item->>'precision' in ('day','range','week','month') and item->>'status' not in ('confirmed','planned'))
  then raise exception 'invalid_schedule_event' using errcode='22023'; end if;
end; $$;
revoke all on function private.validate_school_schedule_manual_event(jsonb) from public,anon,authenticated,service_role;

create function private.effective_school_schedule_bundle(p_school_key text,p_academic_year integer,p_semester integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare original jsonb; manual private.school_schedule_manual_edits%rowtype; actual_events jsonb;
begin
 select payload into original from private.school_schedule_versions
 where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester and is_current;
 select * into manual from private.school_schedule_manual_edits
 where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester order by revision desc limit 1;
 if original is null and manual.revision is null then return null; end if;
 with latest as (
   select distinct on(event_id) event_id,event from private.school_schedule_manual_edits
   where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester
   order by event_id,revision desc
 ), combined as (
   select value as event from jsonb_array_elements(coalesce(original->'events','[]'::jsonb))
   where not exists(select 1 from latest where event_id=value->>'id')
   union all select event from latest
 ) select coalesce(jsonb_agg(event order by event->>'id'),'[]'::jsonb) into actual_events from combined;
 if original is not null then
   -- sourceHash continues to identify the preserved original source, never a hash of corrections.
   return jsonb_set(original,'{events}',actual_events);
 end if;
 return jsonb_build_object('schoolKey',p_school_key,'schoolName',manual.school_name,'schoolLevel',manual.school_level,
   'academicYear',p_academic_year,'semester',p_semester,'versionId','manual:'||manual.revision,
   'sourceHash',encode(sha256(convert_to(actual_events::text,'UTF8')),'hex'),
   'checkedOn',(manual.created_at at time zone 'Asia/Seoul')::date::text,'events',actual_events);
end; $$;
revoke all on function private.effective_school_schedule_bundle(text,integer,integer) from public,anon,authenticated,service_role;

create or replace function private.school_schedule_payload(p_student_ids uuid[],p_active_only boolean)
returns jsonb language sql stable security definer set search_path='' as $$
 with selected as (
   select id,school_key,school_name,grade_label from public.students
   where deleted_at is null and (not p_active_only or status='active')
     and (p_student_ids is null or id=any(p_student_ids))
 ), scopes as (
   select school_key,academic_year,semester from private.school_schedule_versions where is_current
   union select school_key,academic_year,semester from private.school_schedule_manual_edits
 ) select jsonb_build_object(
   'students',coalesce((select jsonb_agg(jsonb_build_object('id',id,'schoolKey',school_key,'schoolName',school_name,'gradeLabel',grade_label) order by id) from selected),'[]'::jsonb),
   'bundles',coalesce((select jsonb_agg(private.effective_school_schedule_bundle(v.school_key,v.academic_year,v.semester) order by v.school_key,v.academic_year,v.semester)
      from scopes v where exists(select 1 from selected s where s.school_key=v.school_key)),'[]'::jsonb)
 );
$$;

create function private.school_schedule_editor_snapshot(p_school_key text,p_academic_year integer,p_semester integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare original_version text; manual_revision bigint; actual jsonb; groups jsonb; changed jsonb;
begin
 if p_school_key is null or p_school_key !~ '^[A-Z][0-9]{2}:[0-9]{7}$'
   or p_academic_year is null or p_academic_year not between 2020 and 2200
   or p_semester is null or p_semester not in (1,2)
 then raise exception 'invalid_schedule_scope' using errcode='22023'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('schoolKey',school_key,'schoolName',school_name,
     'gradeLabel',school_level||grade::text,'grade',grade,'schoolLevel',school_level,'studentCount',student_count)
     order by school_name,grade),'[]'::jsonb) into groups from (
   select school_key,min(school_name) school_name,left(regexp_replace(grade_label,'\s','','g'),1) school_level,
     substring(regexp_replace(grade_label,'\s','','g') from 2 for 1)::integer grade,count(*) student_count
   from public.students where school_key=p_school_key and status='active' and deleted_at is null
     and school_name is not null and regexp_replace(grade_label,'\s','','g') ~ '^(중|고)[123](학년)?$'
   group by school_key,left(regexp_replace(grade_label,'\s','','g'),1),substring(regexp_replace(grade_label,'\s','','g') from 2 for 1)::integer
 ) selected;
 if jsonb_array_length(groups)=0 then raise exception 'school_scope_not_found' using errcode='P0002'; end if;
 select version_id into original_version from private.school_schedule_versions
 where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester and is_current;
 select coalesce(max(revision),0) into manual_revision from private.school_schedule_manual_edits
 where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester;
 select coalesce(jsonb_agg(event_id order by event_id),'[]'::jsonb) into changed from (
   select distinct on(event_id) event_id,source_version_id from private.school_schedule_manual_edits
   where school_key=p_school_key and academic_year=p_academic_year and semester=p_semester order by event_id,revision desc
 ) latest where source_version_id is distinct from original_version;
 actual:=private.effective_school_schedule_bundle(p_school_key,p_academic_year,p_semester);
 return jsonb_build_object('schoolKey',p_school_key,'academicYear',p_academic_year,'semester',p_semester,
   'sourceVersionId',original_version,'manualRevision',manual_revision,'groups',groups,
   'events',coalesce(actual->'events','[]'::jsonb),'sourceChangedEventIds',changed);
end; $$;
revoke all on function private.school_schedule_editor_snapshot(text,integer,integer) from public,anon,authenticated,service_role;

create function public.get_admin_school_schedule_editor_v1(p_school_key text,p_academic_year integer,p_semester integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 return private.school_schedule_editor_snapshot(p_school_key,p_academic_year,p_semester);
end; $$;
revoke all on function public.get_admin_school_schedule_editor_v1(text,integer,integer) from public,anon,service_role;
grant execute on function public.get_admin_school_schedule_editor_v1(text,integer,integer) to authenticated;

create function private.school_schedule_edit_receipt(p_edit private.school_schedule_manual_edits)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('requestId',p_edit.request_id,'revision',p_edit.revision,'eventId',p_edit.event_id,
   'schoolKey',p_edit.school_key,'academicYear',p_edit.academic_year,'semester',p_edit.semester);
$$;
revoke all on function private.school_schedule_edit_receipt(private.school_schedule_manual_edits) from public,anon,authenticated,service_role;

create function public.save_admin_school_schedule_event_v1(p_input jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare existing private.school_schedule_manual_edits%rowtype; saved private.school_schedule_manual_edits%rowtype;
 current_snapshot jsonb; selected_group jsonb; item jsonb; school_key text; academic_year integer; semester integer; edit_request_id uuid;
begin
 if not (select private.is_active_admin()) or (select auth.uid()) is null then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_input) is distinct from 'object'
   or not(p_input ?& array['requestId','schoolKey','academicYear','semester','sourceVersionId','manualRevision','event'])
   or (select count(*) from jsonb_object_keys(p_input))<>7
   or jsonb_typeof(p_input->'requestId') is distinct from 'string'
   or coalesce(p_input->>'requestId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   or jsonb_typeof(p_input->'schoolKey') is distinct from 'string'
   or coalesce(p_input->>'schoolKey','') !~ '^[A-Z][0-9]{2}:[0-9]{7}$'
   or jsonb_typeof(p_input->'academicYear') is distinct from 'number' or coalesce(p_input->>'academicYear','') !~ '^[0-9]{4}$'
   or (p_input->>'academicYear')::integer not between 2020 and 2200
   or jsonb_typeof(p_input->'semester') is distinct from 'number' or coalesce(p_input->>'semester','') not in ('1','2')
   or jsonb_typeof(p_input->'manualRevision') is distinct from 'number' or coalesce(p_input->>'manualRevision','') !~ '^[0-9]{1,15}$'
   or jsonb_typeof(p_input->'sourceVersionId') not in ('null','string')
   or length(p_input->>'sourceVersionId')>120
 then raise exception 'invalid_schedule_update' using errcode='22023'; end if;
 item:=p_input->'event';
 perform private.validate_school_schedule_manual_event(item);
 school_key:=p_input->>'schoolKey'; academic_year:=(p_input->>'academicYear')::integer; semester:=(p_input->>'semester')::integer;
 edit_request_id:=(p_input->>'requestId')::uuid;
 -- Same lock key as the immutable source registration command.
 perform pg_advisory_xact_lock(hashtextextended(school_key||':'||academic_year||':'||semester,0));
 select * into existing from private.school_schedule_manual_edits e where e.request_id=edit_request_id;
 if found then
   if existing.actor_admin_id is distinct from auth.uid() or existing.request_payload is distinct from p_input
   then raise exception 'schedule_request_conflict' using errcode='22023'; end if;
   return private.school_schedule_edit_receipt(existing);
 end if;
 current_snapshot:=private.school_schedule_editor_snapshot(school_key,academic_year,semester);
 if current_snapshot->>'sourceVersionId' is distinct from p_input->>'sourceVersionId'
   or (current_snapshot->>'manualRevision')::bigint<>(p_input->>'manualRevision')::bigint
 then raise exception 'school_schedule_conflict' using errcode='40001'; end if;
 select value into selected_group from jsonb_array_elements(current_snapshot->'groups') where (value->>'grade')::integer=(item->>'grade')::integer;
 if selected_group is null then raise exception 'school_grade_not_found' using errcode='P0002'; end if;
 if not exists(select 1 from jsonb_array_elements(current_snapshot->'events') where value->>'id'=item->>'id')
   and (item->>'id' !~ '^manual:[0-9a-fA-F-]{36}$' or jsonb_array_length(current_snapshot->'events')>=300)
 then raise exception 'invalid_new_schedule_event' using errcode='22023'; end if;
 insert into private.school_schedule_manual_edits(request_id,school_key,academic_year,semester,school_name,school_level,event_id,event,
   source_version_id,base_manual_revision,request_payload,actor_admin_id)
 values(edit_request_id,school_key,academic_year,semester,selected_group->>'schoolName',selected_group->>'schoolLevel',item->>'id',item,
   p_input->>'sourceVersionId',(p_input->>'manualRevision')::bigint,p_input,auth.uid()) returning * into saved;
 return private.school_schedule_edit_receipt(saved);
end; $$;
revoke all on function public.save_admin_school_schedule_event_v1(jsonb) from public,anon,service_role;
grant execute on function public.save_admin_school_schedule_event_v1(jsonb) to authenticated;

create function public.get_admin_school_schedule_edit_result_v1(p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare saved private.school_schedule_manual_edits%rowtype;
begin
 if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
 select * into saved from private.school_schedule_manual_edits where request_id=p_request_id and actor_admin_id=(select auth.uid());
 if not found then return null; end if;
 return private.school_schedule_edit_receipt(saved);
end; $$;
revoke all on function public.get_admin_school_schedule_edit_result_v1(uuid) from public,anon,service_role;
grant execute on function public.get_admin_school_schedule_edit_result_v1(uuid) to authenticated;

-- A valid source import must not make the combined display exceed its contract.
-- Keep the original validator/registration implementation and guard its transaction.
alter function public.register_school_schedule_v1(jsonb) set schema private;
revoke all on function private.register_school_schedule_v1(jsonb) from public,anon,authenticated,service_role;
create function public.register_school_schedule_v1(p_payload jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare registered text; combined jsonb;
begin
 registered:=private.register_school_schedule_v1(p_payload);
 combined:=private.effective_school_schedule_bundle(p_payload->>'schoolKey',(p_payload->>'academicYear')::integer,(p_payload->>'semester')::integer);
 if jsonb_array_length(combined->'events')>300 then raise exception 'schedule_effective_limit' using errcode='22023'; end if;
 return registered;
end; $$;
revoke all on function public.register_school_schedule_v1(jsonb) from public,anon,authenticated;
grant execute on function public.register_school_schedule_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
