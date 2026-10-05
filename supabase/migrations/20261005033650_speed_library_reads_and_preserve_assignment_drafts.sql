-- APP-20261005-03: reuse computation within this read only; no persisted data or permission changes.
-- The existing book-page trim parsed 'books' - take before JSON extraction.
-- Fix both compatible readers without changing their grants or wrappers.
do $repair$
declare name text; definition text;
begin
  foreach name in array array['public.query_vocabulary_library_v1(jsonb)','public.query_vocabulary_library_v2(jsonb)'] loop
    definition:=pg_get_functiondef(name::regprocedure);
    if position('result->''books''-take' in definition)>0 then
      execute replace(definition,'result->''books''-take','(result->''books'')-take');
    elsif position('(result->''books'')-take' in definition)=0 then
      raise exception 'library_books_page_definition_changed';
    end if;
  end loop;
end;
$repair$;

CREATE OR REPLACE FUNCTION private.vocabulary_library_source_states_v1(p_scope_ids uuid[])
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  with headers as materialized (
    select s.id,s.dataset_id,s.unit_id,s.source_kind,s.source_release_id,
      case when d.id is null or d.status<>'ready' or not d.is_active
        or not coalesce(cat.is_assignable,s.source_kind='legacy_vocab') then 'retired'
      when (case s.source_kind when 'exam_use' then er.status='active' when 'reviewed_exam' then rr.status='active' else true end) is distinct from true then 'retired'
      when (case s.source_kind when 'exam_use' then lower(er.package_version) when 'reviewed_exam' then rr.content_sha256 else lower(d.source_sha256) end) is distinct from s.source_version then 'changed'
      else null end preliminary_state
    from private.vocabulary_library_scopes s left join public.vocab_datasets d on d.id=s.dataset_id
      left join public.vocab_dataset_catalog cat on cat.dataset_id=d.id
      left join word_index.app_exam_use_release er on s.source_kind='exam_use' and er.release_id=s.source_release_id and er.dataset_id=d.id
      left join private.reviewed_exam_releases rr on s.source_kind='reviewed_exam' and rr.release_id=s.source_release_id and rr.dataset_id=d.id
    where s.id=any(p_scope_ids)
  ), needed_rows as materialized (
    select r.*,h.dataset_id,h.unit_id,h.source_kind,h.source_release_id,
      case r.entry_snapshot->>'schemaVersion'
        when 'vocabulary-entry-index-v2' then 'entry'
        when 'vocabulary-occurrence-index-v2' then 'occurrence' else 'full' end entry_format,
      case r.occurrence_snapshot->>'schemaVersion'
        when 'vocabulary-entry-index-v2' then 'entry'
        when 'vocabulary-occurrence-index-v2' then 'occurrence' else 'full' end occurrence_format
    from headers h join private.vocabulary_library_scope_rows r on r.scope_id=h.id
    where h.preliminary_state is null
  ), entry_documents as materialized (
    select k.source_entry_id,e.dataset_id,e.unit_id,to_jsonb(e) document
    from (select distinct source_entry_id from needed_rows where state='included') k
    left join public.vocab_entries e on e.id=k.source_entry_id
  ), entry_comparable as materialized (
    select k.source_entry_id,k.entry_format,d.dataset_id,d.unit_id,
      case when k.entry_format='full' then d.document
        else private.compact_vocabulary_source_snapshot_v1(d.document,k.entry_format) end document
    from (select distinct source_entry_id,entry_format from needed_rows where state='included') k
    join entry_documents d on d.source_entry_id=k.source_entry_id
  ), occurrence_documents as materialized (
    select k.source_kind,k.source_release_id,k.source_row,
      case k.source_kind when 'exam_use' then private.restore_exam_use_occurrence_v1(to_jsonb(o))
        when 'reviewed_exam' then to_jsonb(re) end document
    from (select distinct source_kind,source_release_id,source_row from needed_rows
      where source_kind in ('exam_use','reviewed_exam')) k
    left join word_index.app_exam_use_occurrence o on k.source_kind='exam_use'
      and o.release_id=k.source_release_id and o.source_row=k.source_row
    left join private.reviewed_exam_entries re on k.source_kind='reviewed_exam'
      and re.release_id=k.source_release_id and re.source_row=k.source_row
  ), occurrence_comparable as materialized (
    select k.source_kind,k.source_release_id,k.source_row,k.occurrence_format,
      case when k.occurrence_format='full' then d.document
        else private.compact_vocabulary_source_snapshot_v1(d.document,k.occurrence_format) end document
    from (select distinct source_kind,source_release_id,source_row,occurrence_format from needed_rows
      where source_kind in ('exam_use','reviewed_exam')) k
    join occurrence_documents d on d.source_kind=k.source_kind
      and d.source_release_id=k.source_release_id and d.source_row=k.source_row
  ), changed as materialized (
    select distinct r.scope_id
    from needed_rows r
    left join entry_comparable e on e.source_entry_id=r.source_entry_id and e.entry_format=r.entry_format
    left join occurrence_comparable o on o.source_kind=r.source_kind
      and o.source_release_id=r.source_release_id and o.source_row=r.source_row
      and o.occurrence_format=r.occurrence_format
    where (r.state='included' and (r.entry_snapshot is distinct from e.document
      or e.dataset_id is distinct from r.dataset_id or e.unit_id is distinct from r.unit_id))
      or (r.source_kind in ('exam_use','reviewed_exam') and r.occurrence_snapshot is distinct from o.document)
  ) select coalesce(jsonb_object_agg(h.id,coalesce(h.preliminary_state,
      case when c.scope_id is not null then 'changed' else 'available' end)),'{}'::jsonb)
    from headers h left join changed c on c.scope_id=h.id;
$function$;


create or replace function private.vocabulary_library_facets_v1(p_kind text,p_dataset uuid,p_search text,p_after text,p_limit integer,p_snapshot bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; records jsonb; options jsonb; item record; ids uuid[];
begin
 -- Facets describe registered source headers, not a chosen exam. Do not load
 -- every vocabulary row merely to display year/type/book choices. The scopes,
 -- preview and save readers still perform the full source-state validation.
 select array_agg(s.id) into ids from private.vocabulary_library_scopes s
 join public.vocab_datasets d on d.id=s.dataset_id and d.status='ready' and d.is_active
 left join public.vocab_dataset_catalog cat on cat.dataset_id=d.id
 left join word_index.app_exam_use_release er on s.source_kind='exam_use'
   and er.release_id=s.source_release_id and er.dataset_id=d.id
 left join private.reviewed_exam_releases rr on s.source_kind='reviewed_exam'
   and rr.release_id=s.source_release_id and rr.dataset_id=d.id
 where s.revision<=p_snapshot and s.payload#>>'{classification,kind}'=p_kind
   and coalesce(cat.is_assignable,s.source_kind='legacy_vocab')
   and (case s.source_kind when 'exam_use' then er.status='active'
     when 'reviewed_exam' then rr.status='active' else true end) is true
   and (case s.source_kind when 'exam_use' then lower(er.package_version)
     when 'reviewed_exam' then rr.content_sha256 else lower(d.source_sha256) end) is not distinct from s.source_version
   and not exists(select 1 from private.vocabulary_library_scopes n where n.scope_key=s.scope_key
     and n.revision>s.revision and n.revision<=p_snapshot);
 select coalesce(jsonb_agg(s.payload->'classification'),'[]') into records
 from private.vocabulary_library_scopes s where s.id=any(ids) and (p_dataset is null or s.dataset_id=p_dataset);
 select jsonb_build_object('books',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'count',n) order by id),'[]')) into result from (
   select s.dataset_id id,min(s.payload->>'sourceTitle') title,count(*) n from private.vocabulary_library_scopes s
   where s.id=any(ids) and s.dataset_id::text>p_after
     and (p_search='' or position(lower(p_search) in lower(s.payload->>'sourceTitle'))>0)
   group by s.dataset_id order by s.dataset_id limit p_limit+1
 ) books;
 for item in select * from (values ('sourceGrades','sourceGrade'),('years','executionYear'),('months','examMonth'),('types','typeCode'),('questions','questionNumbers'),
   ('lessons','lesson'),('schools','school'),('targetGrades','targetGrade'),('semesters','semester'),('assessments','assessment')) fields(k,field) loop
   with vals as (
     select c,case when item.k in ('years','months','types','questions') then c->'exam'->item.field else c->item.field end v from jsonb_array_elements(records) c
   ), flat as (
     select c,n v from vals cross join lateral jsonb_array_elements(case when item.k='questions' then coalesce(v,'[]') else jsonb_build_array(v) end) n
   ), counted as (
     select v,case when item.k='types' then min(c#>>'{exam,typeLabel}')
       when item.k='years' and p_kind='csat' then (v#>>'{}')||'년 시행'||coalesce(' · '||min(c#>>'{exam,academicYear}')||'학년도','') else v#>>'{}' end label,count(*) n
     from flat where v is not null and v<>'null'::jsonb group by v
   ) select coalesce(jsonb_agg(jsonb_build_object('value',v,'label',label,'count',n) order by v),'[]') into options from counted;
   if item.k='types' and p_kind in ('csat','mock') then
     select options||coalesce(jsonb_agg(jsonb_build_object('value',code,'label',label,'count',0) order by code),'[]') into options from (
       select s.payload#>>'{classification,exam,typeCode}' code,min(s.payload#>>'{classification,exam,typeLabel}') label from private.vocabulary_library_scopes s
       where s.revision<=p_snapshot and s.payload#>>'{classification,kind}' in ('csat','mock') group by s.payload#>>'{classification,exam,typeCode}'
     ) known where code is not null and not exists(select 1 from jsonb_array_elements(options) x where x->>'value'=code);
   end if;
   result:=result||jsonb_build_object(item.k,options);
 end loop;
 return result;
end;
$$;
