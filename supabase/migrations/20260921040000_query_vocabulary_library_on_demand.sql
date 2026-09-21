-- Query summaries and selected pages only. Old immutable snapshots remain readable.
alter table private.vocabulary_library_templates add column deleted_at timestamptz;
alter table private.vocabulary_library_versions add column criteria jsonb;
create index vocabulary_library_templates_visible_order on private.vocabulary_library_templates(created_at desc,id desc) where deleted_at is null;
create index vocabulary_library_scopes_latest_key on private.vocabulary_library_scopes(scope_key,revision desc);

create function private.empty_vocabulary_library_filters_v1()
returns jsonb language sql immutable set search_path='' as $$
 select '{"search":"","kinds":[],"years":[],"yearFrom":null,"yearTo":null,"months":[],"types":[],"questions":[],"sourceGrades":[],"dayFrom":null,"dayTo":null,"lessons":[],"schools":[],"targetGrades":[],"semesters":[],"assessments":[],"purposes":[]}'::jsonb;
$$;

create function private.matches_vocabulary_library_scope_v1(p jsonb,f jsonb)
returns boolean language sql immutable set search_path='' as $$
 select not exists(select 1 from regexp_split_to_table(lower(trim(f->>'search')), '\s+') term
   where term<>'' and position(term in lower(concat_ws(' ',p->>'name',p->>'sourceTitle',p#>>'{classification,publisher}',p#>>'{classification,school}',
     p#>>'{classification,assessment}',p#>>'{classification,purpose}',p#>>'{classification,exam,typeLabel}')))=0)
 and not exists(select 1 from (values
   ('kinds',p#>'{classification,kind}'),('years',p#>'{classification,exam,executionYear}'),('months',p#>'{classification,exam,examMonth}'),
   ('types',p#>'{classification,exam,typeCode}'),('sourceGrades',p#>'{classification,sourceGrade}'),('lessons',p#>'{classification,lesson}'),
   ('schools',p#>'{classification,school}'),('targetGrades',p#>'{classification,targetGrade}'),('semesters',p#>'{classification,semester}'),
   ('assessments',p#>'{classification,assessment}'),('purposes',p#>'{classification,purpose}')) x(k,v)
   where jsonb_array_length(f->k)>0 and not coalesce(f->k @> jsonb_build_array(v),false))
 and (jsonb_array_length(f->'questions')=0 or exists(select 1 from jsonb_array_elements(coalesce(p#>'{classification,exam,questionNumbers}','[]')) n where f->'questions' @> jsonb_build_array(n)))
 and not exists(select 1 from (values ('yearFrom','yearTo',p#>>'{classification,exam,executionYear}'),('dayFrom','dayTo',p#>>'{classification,day}')) x(lo,hi,v)
   where (f->>lo is not null or f->>hi is not null) and (v is null or (f->>lo is not null and v::integer<(f->>lo)::integer) or (f->>hi is not null and v::integer>(f->>hi)::integer)));
$$;

create function private.vocabulary_library_scope_sort_v1(s private.vocabulary_library_scopes)
returns text language sql immutable set search_path='' as $$
 select concat_ws('|',s.payload#>>'{classification,kind}',
   lpad(coalesce(s.payload#>>'{classification,exam,executionYear}','0'),4,'0'),lpad(coalesce(s.payload#>>'{classification,exam,examMonth}','0'),2,'0'),
   s.payload->>'sourceTitle',lpad(coalesce((select min(n::integer)::text from jsonb_array_elements_text(coalesce(s.payload#>'{classification,exam,questionNumbers}','[]')) n),'0'),2,'0'),
   lpad(coalesce(s.payload#>>'{classification,day}','0'),3,'0'),lpad(coalesce(s.payload#>>'{classification,lesson}','0'),3,'0'),s.scope_key,s.id::text);
$$;

create function private.vocabulary_library_version_summary_v1(v private.vocabulary_library_versions)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',v.id,'number',v.number,'contentHash',v.content_sha256,'scopeStatus',v.recipe->'scopeStatus',
   'scopeCount',jsonb_array_length(v.recipe->'scopes'),'sourceCount',v.fixed_composition->'sourceCount','includedCount',jsonb_array_length(v.fixed_composition->'includedKeys'),
   'sourceVersionId',v.source_version_id,'datasetId',(select c.dataset_id from private.vocabulary_compositions c where c.version_id=v.id and c.state='ready'),
   'createdAt',v.created_at,'hasCriteria',v.criteria is not null);
$$;
create function private.vocabulary_library_template_summary_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',t.id,'revision',t.revision,'metadata',t.metadata,'latestVersion',private.vocabulary_library_version_summary_v1(v))
 from private.vocabulary_library_templates t cross join lateral(select * from private.vocabulary_library_versions x where x.template_id=t.id order by number desc limit 1) v where t.id=p_id;
$$;
create function private.vocabulary_library_scope_header_v1(s private.vocabulary_library_scopes,p_state text)
returns jsonb language sql stable security definer set search_path='' as $$
 select (s.payload-'occurrences')||jsonb_build_object('id',s.id,'version',s.version,'scopeKey',s.scope_key,'availability',p_state,
   'sourceCount',count(*),'includedCount',count(*) filter(where r.state='included'),'heldCount',count(*) filter(where r.state='held'))
 from private.vocabulary_library_scope_rows r where r.scope_id=s.id;
$$;

create function private.validate_vocabulary_library_criteria_v1(c jsonb)
returns void language plpgsql set search_path='' as $$
declare g jsonb;
begin
 if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>3 or not(c ?& array['groups','excludedOccurrenceKeys','scopeStatus'])
   or jsonb_typeof(c->'groups') is distinct from 'array' or jsonb_array_length(c->'groups')>100
   or jsonb_typeof(c->'excludedOccurrenceKeys') is distinct from 'array' or jsonb_array_length(c->'excludedOccurrenceKeys')>20000
   or coalesce(c->>'scopeStatus','') not in ('confirmed','unconfirmed')
   or (c->>'scopeStatus'='unconfirmed' and (jsonb_array_length(c->'groups')<>0 or jsonb_array_length(c->'excludedOccurrenceKeys')<>0)) then
   raise exception 'invalid_library_criteria' using errcode='22023'; end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(c->'groups') x)<>jsonb_array_length(c->'groups')
   or (select count(distinct x) from jsonb_array_elements_text(c->'excludedOccurrenceKeys') x)<>jsonb_array_length(c->'excludedOccurrenceKeys')
   or exists(select 1 from jsonb_array_elements_text(c->'excludedOccurrenceKeys') x where x is null or x !~ '^[a-f0-9]{64}$') then
   raise exception 'invalid_library_criteria' using errcode='22023'; end if;
 for g in select value from jsonb_array_elements(c->'groups') loop
   if jsonb_typeof(g) is distinct from 'object' or (select count(*) from jsonb_object_keys(g))<>7 or not(g ?& array['id','kind','datasetId','mode','filters','scopes','excludedScopeKeys'])
     or length(coalesce(g->>'id','')) not between 1 and 80 or coalesce(g->>'kind','') not in ('mock','csat','textbook','wordbook','school','unclassified')
     or coalesce(g->>'mode','') not in ('filter','fixed') or jsonb_typeof(g->'scopes') is distinct from 'array' or jsonb_array_length(g->'scopes')>2000
     or jsonb_typeof(g->'excludedScopeKeys') is distinct from 'array' or jsonb_array_length(g->'excludedScopeKeys')>2000
     or (g->>'mode'='filter' and (jsonb_array_length(g->'scopes')<>0 or g#>'{filters,kinds}' is distinct from jsonb_build_array(g->>'kind')))
     or (g->>'mode'='fixed' and jsonb_array_length(g->'excludedScopeKeys')<>0)
     or exists(select 1 from jsonb_array_elements_text(g->'excludedScopeKeys') x where x is null or length(x) not between 1 and 1000)
     or (select count(distinct x) from jsonb_array_elements_text(g->'excludedScopeKeys') x)<>jsonb_array_length(g->'excludedScopeKeys') then
     raise exception 'invalid_library_criteria_group' using errcode='22023'; end if;
   perform (g->>'datasetId')::uuid;
   perform private.validate_vocabulary_library_filters_v1(g->'filters');
 end loop;
end;
$$;

create function private.resolve_vocabulary_library_criteria_v1(c jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare g jsonb; picked jsonb; all_picks jsonb:='[]'; group_refs jsonb:='[]'; states jsonb; ids uuid[];
begin
 perform private.validate_vocabulary_library_criteria_v1(c);
 for g in select value from jsonb_array_elements(c->'groups') loop
   if g->>'mode'='fixed' then picked:=g->'scopes';
   elsif g->>'kind' not in ('mock','csat') and g->>'datasetId' is null then picked:='[]';
   else
     select array_agg(s.id) into ids from private.vocabulary_library_scopes s
       where not exists(select 1 from private.vocabulary_library_scopes n where n.scope_key=s.scope_key and n.revision>s.revision)
       and (g->>'datasetId' is null or s.dataset_id=(g->>'datasetId')::uuid) and private.matches_vocabulary_library_scope_v1(s.payload,g->'filters')
       and not(g->'excludedScopeKeys' ? s.scope_key);
     if cardinality(ids)>2000 then raise exception 'library_composition_too_large' using errcode='22023'; end if;
     states:=private.vocabulary_library_source_states_v1(ids);
     select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'version',s.version) order by private.vocabulary_library_scope_sort_v1(s)),'[]') into picked
       from private.vocabulary_library_scopes s where s.id=any(ids) and states->>s.id::text='available';
   end if;
   group_refs:=group_refs||jsonb_build_array(jsonb_build_object('id',g->>'id','scopes',picked));
   all_picks:=all_picks||picked;
 end loop;
 select coalesce(jsonb_agg(value order by ord),'[]') into all_picks from (
   select distinct on(value->>'id') value,ordinality ord from jsonb_array_elements(all_picks) with ordinality order by value->>'id',ordinality
 ) r;
 if jsonb_array_length(all_picks)>2000 then raise exception 'library_composition_too_large' using errcode='22023'; end if;
 return jsonb_build_object('recipe',jsonb_build_object('filters',private.empty_vocabulary_library_filters_v1(),'scopes',all_picks,
   'excludedOccurrenceKeys',c->'excludedOccurrenceKeys','scopeStatus',c->'scopeStatus'),'groups',group_refs);
end;
$$;

create function private.preview_vocabulary_library_selection_v1(p_selection jsonb,p_compare uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare resolved jsonb; recipe jsonb; fixed jsonb; previous private.vocabulary_library_versions; orphaned jsonb; diff jsonb; classes jsonb;
begin
 if jsonb_typeof(p_selection) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_selection))<>2 then raise exception 'invalid_library_selection' using errcode='22023'; end if;
 if p_selection->>'mode'='criteria' then resolved:=private.resolve_vocabulary_library_criteria_v1(p_selection->'criteria'); recipe:=resolved->'recipe';
 elsif p_selection->>'mode'='recipe' then recipe:=p_selection->'recipe'; resolved:=jsonb_build_object('groups','[]'::jsonb);
 else raise exception 'invalid_library_selection' using errcode='22023'; end if;
 -- An exclusion that left the selected range is visible to the editor and blocks saving.
 select coalesce(jsonb_agg(x),'[]') into orphaned from jsonb_array_elements_text(recipe->'excludedOccurrenceKeys') x
   where not exists(select 1 from jsonb_array_elements(recipe->'scopes') ref join private.vocabulary_library_scope_rows r on r.scope_id=(ref->>'id')::uuid where r.occurrence_key=x);
 recipe:=jsonb_set(recipe,'{excludedOccurrenceKeys}',coalesce((select jsonb_agg(x order by ordinality) from jsonb_array_elements(recipe->'excludedOccurrenceKeys') with ordinality e(x,ordinality) where not(orphaned @> jsonb_build_array(x))),'[]'));
 fixed:=private.resolve_vocabulary_library_recipe_compact_v1(recipe);
 if p_compare is not null then
   select * into previous from private.vocabulary_library_versions where id=p_compare;
   if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
   diff:=jsonb_build_object('added',(select count(*) from jsonb_array_elements_text(fixed->'includedKeys') x where not(previous.fixed_composition->'includedKeys' ? x)),
     'removed',(select count(*) from jsonb_array_elements_text(previous.fixed_composition->'includedKeys') x where not(fixed->'includedKeys' ? x)),
     'scopeAdded',(select count(*) from jsonb_array_elements(recipe->'scopes') x where not(previous.recipe->'scopes' @> jsonb_build_array(x))),
     'scopeRemoved',(select count(*) from jsonb_array_elements(previous.recipe->'scopes') x where not(recipe->'scopes' @> jsonb_build_array(x))),
     'orderChanged',coalesce((select jsonb_agg(x order by ordinality) from jsonb_array_elements_text(previous.fixed_composition->'includedKeys') with ordinality e(x,ordinality) where fixed->'includedKeys' ? x),'[]')
       is distinct from coalesce((select jsonb_agg(x order by ordinality) from jsonb_array_elements_text(fixed->'includedKeys') with ordinality e(x,ordinality) where previous.fixed_composition->'includedKeys' ? x),'[]'),
     'changed',previous.content_sha256<>private.reviewed_exam_sha256_v1(fixed));
 end if;
 select coalesce(jsonb_agg(distinct s.payload->'classification'),'[]') into classes from private.vocabulary_library_scopes s
   where exists(select 1 from jsonb_array_elements(recipe->'scopes') r where r->>'id'=s.id::text) and exists(
     select 1 from private.vocabulary_library_scope_rows r where r.scope_id=s.id and fixed->'includedKeys' ? r.occurrence_key);
 return jsonb_build_object('recipe',recipe,'contentHash',private.reviewed_exam_sha256_v1(fixed),'sourceCount',fixed->'sourceCount',
   'includedCount',jsonb_array_length(fixed->'includedKeys'),'heldCount',(select count(*) from jsonb_array_elements(fixed->'occurrences') x where x->>'state'='held'),
   'excludedCount',(fixed->>'sourceCount')::integer-jsonb_array_length(fixed->'includedKeys')-(select count(*) from jsonb_array_elements(fixed->'occurrences') x where x->>'state'='held'),
   'groups',resolved->'groups','orphanedExclusions',orphaned,'difference',diff,'classifications',classes);
end;
$$;

create function private.vocabulary_library_facets_v1(p_kind text,p_dataset uuid,p_search text,p_after text,p_limit integer,p_snapshot bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; records jsonb; options jsonb; item record; ids uuid[]; states jsonb;
begin
 select array_agg(s.id) into ids from private.vocabulary_library_scopes s where s.revision<=p_snapshot and s.payload#>>'{classification,kind}'=p_kind
   and not exists(select 1 from private.vocabulary_library_scopes n where n.scope_key=s.scope_key and n.revision>s.revision and n.revision<=p_snapshot);
 states:=private.vocabulary_library_source_states_v1(ids);
 select coalesce(jsonb_agg(s.payload->'classification'),'[]') into records from private.vocabulary_library_scopes s where s.id=any(ids) and states->>s.id::text='available' and (p_dataset is null or s.dataset_id=p_dataset);
 select jsonb_build_object('books',coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'count',n) order by id),'[]')) into result from (
   select s.dataset_id id,min(s.payload->>'sourceTitle') title,count(*) n from private.vocabulary_library_scopes s
   where s.id=any(ids) and states->>s.id::text='available' and s.dataset_id::text>p_after
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

-- Search saved classifications without loading words or all historical versions.
create function private.vocabulary_library_template_search_v1(p_template private.vocabulary_library_templates)
returns text language sql stable security definer set search_path=public,private,pg_temp as $$
 select lower(concat_ws(' ',p_template.metadata->>'title',p_template.metadata->>'tags',p_template.metadata->>'school',
   p_template.metadata->>'targetGrade',p_template.metadata->>'schoolYear',(p_template.metadata->>'semester')||'학기',
   p_template.metadata->>'assessment',p_template.metadata->>'purpose',(
     select string_agg(concat_ws(' ',
       case c->>'kind' when 'mock' then '모의고사 모고' when 'csat' then '수능' when 'textbook' then '교과서' when 'wordbook' then '단어장' when 'school' then '학교 자료' else '분류 확인' end,
       case c->>'sourceGrade' when 'g7' then '중1' when 'g8' then '중2' when 'g9' then '중3' when 'g10' then '고1' when 'g11' then '고2' when 'g12' then '고3' end,
       (c#>>'{exam,executionYear}')||'년',case when c->>'kind'='mock' then (c#>>'{exam,examMonth}')||'월' end,
       case when c->>'kind'='csat' then (c#>>'{exam,academicYear}')||'학년도' end,c#>>'{exam,typeLabel}',
       'DAY '||(c->>'day'),(c->>'lesson')||'과'),' ')
     from (select recipe,fixed_composition from private.vocabulary_library_versions where template_id=p_template.id order by number desc limit 1) v
     cross join lateral jsonb_array_elements(v.recipe->'scopes') ref
     join private.vocabulary_library_scopes s on s.id=(ref->>'id')::uuid and s.version=ref->>'version'
     cross join lateral (select s.payload->'classification' c) classification
     where exists(select 1 from private.vocabulary_library_scope_rows r where r.scope_id=s.id and v.fixed_composition->'includedKeys' ? r.occurrence_key)
   )))
$$;

create function public.query_vocabulary_library_v1(p_query jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
declare k text; fields text[]; binding text; snap bigint; after_key text:=''; take integer; page_rows jsonb; next_cursor jsonb; result jsonb;
  ids uuid[]; states jsonb; v private.vocabulary_library_versions; preview jsonb; fixed jsonb; total integer; last_key text;
begin
 if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 if jsonb_typeof(p_query) is distinct from 'object' or octet_length(p_query::text)>3000000 then raise exception 'invalid_library_query' using errcode='22023'; end if;
 k:=p_query->>'kind';
 fields:=case k when 'templates' then array['kind','search','cursor','limit'] when 'versions' then array['kind','templateId','cursor','limit']
   when 'detail' then array['kind','templateId','versionId'] when 'facets' then array['kind','sourceKind','datasetId','bookSearch','cursor','limit']
   when 'scopes' then array['kind','filters','datasetId','refs','cursor','limit'] when 'preview' then array['kind','selection','compareVersionId','metadata']
   when 'words' then array['kind','selection','versionId','contentHash','search','cursor','limit'] end;
 if fields is null or exists(select 1 from jsonb_object_keys(p_query) f where not(f=any(fields))) then raise exception 'invalid_library_query_fields' using errcode='22023'; end if;
 take:=coalesce((p_query->>'limit')::integer,20);
 if take not between 1 and 50 or length(coalesce(p_query->>'search',p_query->>'bookSearch',''))>240 then raise exception 'invalid_library_query_limit' using errcode='22023'; end if;
 binding:=private.reviewed_exam_sha256_v1(jsonb_build_object('actor',auth.uid(),'query',p_query-'cursor'));
 snap:=coalesce((select max(revision) from private.vocabulary_library_scopes),0);
 if p_query->'cursor' is not null and p_query->'cursor'<>'null' then
   if jsonb_typeof(p_query->'cursor')<>'object' or (select count(*) from jsonb_object_keys(p_query->'cursor'))<>3
     or not(p_query->'cursor' ?& array['binding','snapshot','after']) or p_query#>>'{cursor,binding}' is distinct from binding
     or jsonb_typeof(p_query#>'{cursor,snapshot}')<>'number' or jsonb_typeof(p_query#>'{cursor,after}')<>'string'
     or (p_query#>>'{cursor,snapshot}')::bigint not between 0 and snap or length(p_query#>>'{cursor,after}')>5000 then raise exception 'library_cursor_changed' using errcode='40001'; end if;
   snap:=(p_query#>>'{cursor,snapshot}')::bigint; after_key:=p_query#>>'{cursor,after}';
 end if;
 if k='templates' then
   select coalesce(jsonb_agg(jsonb_build_object('key',sort_key,'item',private.vocabulary_library_template_summary_v1(id)) order by sort_key desc),'[]') into page_rows from (
     select t.id,to_char(t.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'|'||t.id::text sort_key from private.vocabulary_library_templates t
       where t.deleted_at is null and (coalesce(p_query->>'search','')='' or not exists(select 1 from regexp_split_to_table(lower(trim(p_query->>'search')),'\s+') term
         where position(term in private.vocabulary_library_template_search_v1(t))=0))
       and (after_key='' or to_char(t.created_at at time zone 'UTC','YYYY-MM-DD HH24:MI:SS.US')||'|'||t.id::text<after_key)
       order by t.created_at desc,t.id desc limit take+1
   ) p;
 elsif k in ('versions','detail') then
   if not exists(select 1 from private.vocabulary_library_templates t where t.id=(p_query->>'templateId')::uuid and t.deleted_at is null) then raise exception 'library_template_not_found' using errcode='P0002'; end if;
   if k='detail' then
     select * into v from private.vocabulary_library_versions where template_id=(p_query->>'templateId')::uuid and (not(p_query ? 'versionId') or id=(p_query->>'versionId')::uuid) order by number desc limit 1;
     if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
     result:=jsonb_build_object('template',private.vocabulary_library_template_summary_v1(v.template_id),'version',private.vocabulary_library_version_summary_v1(v),'recipe',v.recipe,'criteria',v.criteria,
       'classifications',coalesce((select jsonb_agg(distinct s.payload->'classification') from private.vocabulary_library_scopes s
         where exists(select 1 from jsonb_array_elements(v.recipe->'scopes') ref where ref->>'id'=s.id::text) and exists(
           select 1 from private.vocabulary_library_scope_rows r where r.scope_id=s.id and v.fixed_composition->'includedKeys' ? r.occurrence_key)),'[]'));
   else
     select coalesce(jsonb_agg(jsonb_build_object('key',number::text,'item',private.vocabulary_library_version_summary_v1(p)) order by number desc),'[]') into page_rows from (
       select * from private.vocabulary_library_versions where template_id=(p_query->>'templateId')::uuid and (after_key='' or number<after_key::integer) order by number desc limit take+1
     ) p;
   end if;
 elsif k='facets' then
   if coalesce(p_query->>'sourceKind','') not in ('mock','csat','textbook','wordbook','school','unclassified') then raise exception 'invalid_library_query_kind' using errcode='22023'; end if;
   result:=private.vocabulary_library_facets_v1(p_query->>'sourceKind',(p_query->>'datasetId')::uuid,coalesce(p_query->>'bookSearch',''),after_key,take,snap);
   if jsonb_array_length(result->'books')>take then
     last_key:=result#>>array['books',(take-1)::text,'id']; next_cursor:=jsonb_build_object('binding',binding,'snapshot',snap,'after',last_key);
     result:=jsonb_set(result,'{books}',result->'books'-take);
   end if;
   result:=jsonb_build_object('facets',result,'nextCursor',next_cursor);
 elsif k='scopes' then
   perform private.validate_vocabulary_library_filters_v1(p_query->'filters');
   if p_query ? 'refs' and (jsonb_typeof(p_query->'refs')<>'array' or jsonb_array_length(p_query->'refs')>2000) then raise exception 'invalid_library_refs' using errcode='22023'; end if;
   select coalesce(jsonb_agg(jsonb_build_object('key',sort_key,'id',id) order by sort_key),'[]'),array_agg(id) into page_rows,ids from (select * from (
     select s.id,case when p_query ? 'refs' then lpad((select min(ordinality)::text from jsonb_array_elements(p_query->'refs') with ordinality r where r.value->>'id'=s.id::text and r.value->>'version'=s.version),6,'0') else private.vocabulary_library_scope_sort_v1(s) end sort_key
     from private.vocabulary_library_scopes s where
       case when p_query ? 'refs' then exists(select 1 from jsonb_array_elements(p_query->'refs') r where r->>'id'=s.id::text and r->>'version'=s.version)
       else s.revision<=snap and not exists(select 1 from private.vocabulary_library_scopes n where n.scope_key=s.scope_key and n.revision>s.revision and n.revision<=snap)
         and (p_query->>'datasetId' is null or s.dataset_id=(p_query->>'datasetId')::uuid) and private.matches_vocabulary_library_scope_v1(s.payload,p_query->'filters') end
   ) candidates where sort_key>after_key order by sort_key limit take+1) limited;
   -- Aggregate after LIMIT: this is a scope page, not a full catalog response.
   states:=private.vocabulary_library_source_states_v1(ids);
   select coalesce(jsonb_agg(x||jsonb_build_object('item',private.vocabulary_library_scope_header_v1(s,states->>s.id::text)) order by x->>'key'),'[]') into page_rows
     from jsonb_array_elements(page_rows) x join private.vocabulary_library_scopes s on s.id=(x->>'id')::uuid;
 elsif k='preview' then
   perform private.validate_vocabulary_library_metadata_v1(jsonb_set(p_query->'metadata','{title}','"미리보기"'));
   result:=private.preview_vocabulary_library_selection_v1(p_query->'selection',(p_query->>'compareVersionId')::uuid);
 elsif k='words' then
   if (p_query ? 'selection')=(p_query ? 'versionId') or coalesce(p_query->>'contentHash','') !~ '^[a-f0-9]{64}$' then raise exception 'invalid_library_words' using errcode='22023'; end if;
   if p_query ? 'versionId' then
     select * into v from private.vocabulary_library_versions where id=(p_query->>'versionId')::uuid;
     if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
     if v.content_sha256<>p_query->>'contentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
     fixed:=v.fixed_composition;
   else
     preview:=private.preview_vocabulary_library_selection_v1(p_query->'selection',null);
     if preview->>'contentHash'<>p_query->>'contentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
     fixed:=private.resolve_vocabulary_library_recipe_compact_v1(preview->'recipe');
   end if;
   with labels as materialized (
     select x,ordinality pos,coalesce(r.entry_snapshot->>'headword',x#>>'{entry,headword}') headword,
       coalesce(r.entry_snapshot->>'primary_meaning',x#>>'{entry,primary_meaning}') meaning
     from jsonb_array_elements(fixed->'occurrences') with ordinality e(x,ordinality)
     left join private.vocabulary_library_scope_rows r on r.scope_id=(x->>'sourceScopeId')::uuid and r.occurrence_key=x->>'key'
   ), matched as materialized (
     select * from labels where coalesce(p_query->>'search','')='' or position(lower(p_query->>'search') in lower(concat_ws(' ',headword,meaning)))>0
   ), limited as (
     select * from matched where pos>coalesce(nullif(after_key,'')::bigint,0) order by pos limit take+1
   ) select coalesce(jsonb_agg(jsonb_build_object('key',pos::text,'item',jsonb_build_object('key',x->'key','sourceRow',x->'sourceRow','headword',headword,'meaning',meaning,
     'state',x->'state','selected',fixed->'includedKeys' ? (x->>'key'))) order by pos),'[]'),(select count(*) from matched) into page_rows,total from limited;
 end if;
 if page_rows is not null then
   if jsonb_array_length(page_rows)>take then
     last_key:=page_rows#>>array[(take-1)::text,'key']; next_cursor:=jsonb_build_object('binding',binding,'snapshot',snap,'after',last_key);
     page_rows:=page_rows-take;
   end if;
   select jsonb_build_object('items',coalesce(jsonb_agg(x->'item' order by ordinality),'[]'),'nextCursor',next_cursor) into result from jsonb_array_elements(page_rows) with ordinality e(x,ordinality);
   if k='words' then result:=result||jsonb_build_object('total',total); end if;
 end if;
 return result||jsonb_build_object('kind',k,'viewerId',auth.uid());
end;
$$;

revoke all on function private.empty_vocabulary_library_filters_v1(),private.matches_vocabulary_library_scope_v1(jsonb,jsonb),private.vocabulary_library_scope_sort_v1(private.vocabulary_library_scopes),
 private.vocabulary_library_version_summary_v1(private.vocabulary_library_versions),private.vocabulary_library_template_summary_v1(uuid),private.vocabulary_library_scope_header_v1(private.vocabulary_library_scopes,text),
 private.validate_vocabulary_library_criteria_v1(jsonb),private.resolve_vocabulary_library_criteria_v1(jsonb),private.preview_vocabulary_library_selection_v1(jsonb,uuid),
 private.vocabulary_library_facets_v1(text,uuid,text,text,integer,bigint),private.vocabulary_library_template_search_v1(private.vocabulary_library_templates),public.query_vocabulary_library_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.query_vocabulary_library_v1(jsonb) to authenticated;
