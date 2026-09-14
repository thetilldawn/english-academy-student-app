begin;
-- Optional confirmed English exam day; existing written dates remain the school period.
-- Preserve the original source registration, manual history, locking and public RPC grants.
create or replace function private.register_school_schedule_v1(p_payload jsonb)
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
     or (select count(*) from jsonb_object_keys(item)) <> (14 + case when item ? 'sourceLabel' then 1 else 0 end + case when item ? 'subjectDate' then 1 else 0 end)
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
     or (item ? 'subjectDate' and jsonb_typeof(item->'subjectDate') not in ('null','string'))
     or (item->>'subjectDate' is not null and (item->>'subjectDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or item->>'kind'<>'written' or item->>'status'='not-held'))
     or (item->>'maxPoints' is not null and (jsonb_typeof(item->'maxPoints') is distinct from 'number' or (item->>'maxPoints')::numeric not between 0 and 1000))
     or ((item->>'status'='not-held') is distinct from (item->>'precision'='none'))
     or (item->>'precision'='unknown' and item->>'status'<>'unknown')
     or (coalesce(item->>'precision','') in ('unknown','none','month','week') and (item->>'startDate' is not null or item->>'endDate' is not null))
     or (item->>'precision' in ('day','range') and (coalesce(item->>'startDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(item->>'endDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
   then raise exception 'invalid_schedule_event' using errcode='22023'; end if;
   if item->>'subjectDate' is not null then perform (item->>'subjectDate')::date; end if;
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
revoke all on function private.register_school_schedule_v1(jsonb) from public,anon,authenticated,service_role;
create or replace function private.validate_school_schedule_manual_event(item jsonb)
returns void language plpgsql set search_path='' as $$
begin
   if jsonb_typeof(item) is distinct from 'object'
     or not (item ?& array['id','grade','kind','round','title','subject','startDate','endDate','precision','status','dateText','maxPoints','applicability','sourceUrl'])
     or (select count(*) from jsonb_object_keys(item)) <> (14 + case when item ? 'sourceLabel' then 1 else 0 end + case when item ? 'subjectDate' then 1 else 0 end)
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
     or (item ? 'subjectDate' and jsonb_typeof(item->'subjectDate') not in ('null','string'))
     or (item->>'subjectDate' is not null and (item->>'subjectDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or item->>'kind'<>'written' or item->>'status'='not-held'))
     or (item->>'maxPoints' is not null and (jsonb_typeof(item->'maxPoints') is distinct from 'number' or (item->>'maxPoints')::numeric not between 0 and 1000))
     or ((item->>'status'='not-held') is distinct from (item->>'precision'='none'))
     or (item->>'precision'='unknown' and item->>'status'<>'unknown')
     or (coalesce(item->>'precision','') in ('unknown','none','month','week') and (item->>'startDate' is not null or item->>'endDate' is not null))
     or (item->>'precision' in ('day','range') and (coalesce(item->>'startDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or coalesce(item->>'endDate','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'))
   then raise exception 'invalid_schedule_event' using errcode='22023'; end if;
   if item->>'subjectDate' is not null then perform (item->>'subjectDate')::date; end if;
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
notify pgrst,'reload schema';
commit;
