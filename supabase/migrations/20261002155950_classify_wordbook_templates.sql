-- M07: explicit classification, legacy text/receipts, and immutable contents.
alter table private.vocabulary_library_templates add column template_kind text
  check (template_kind in ('performance_assessment','exam_prep','mock_exam','other'));
comment on column private.vocabulary_library_templates.template_kind is 'Explicit wordbook kind. NULL means classification has not been confirmed; purpose text is not evidence.';

create function private.vocabulary_template_catalog_metadata_v1(m jsonb,k text)
returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_object('school',m->'school','audience',case when m->>'school' is null then 'common' else 'school' end,
   'purpose',case when k='exam_prep' then 'exam_prep' end,'semester',m->'semester','templateMetadata',m,'templateKind',k)
$$;
revoke all on function private.vocabulary_template_catalog_metadata_v1(jsonb,text) from public,anon,authenticated,service_role;

create function private.vocabulary_library_template_summary_v2(p_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select private.vocabulary_library_template_summary_v1(p_id)||jsonb_build_object('templateKind',t.template_kind)
 from private.vocabulary_library_templates t where t.id=p_id
$$;
create function private.vocabulary_library_template_search_v2(t private.vocabulary_library_templates)
returns text language sql stable set search_path='' as $$
 select private.vocabulary_library_template_search_v1(t)||' '||case t.template_kind
   when 'performance_assessment' then '수행평가' when 'exam_prep' then '직전대비'
   when 'mock_exam' then '모의고사' when 'other' then '기타' else '분류 확인' end
$$;
revoke all on function private.vocabulary_library_template_summary_v2(uuid),private.vocabulary_library_template_search_v2(private.vocabulary_library_templates) from public,anon,authenticated,service_role;

create or replace function private.sync_vocabulary_template_metadata_v1(p_template_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare metadata_value jsonb; kind_value text; dataset_ids uuid[];
begin
 select metadata,template_kind into metadata_value,kind_value from private.vocabulary_library_templates where id=p_template_id;
 select array_agg(c.dataset_id) into dataset_ids from private.vocabulary_compositions c
   join private.vocabulary_library_versions v on v.id=c.version_id where v.template_id=p_template_id;
 update public.vocab_datasets set title=metadata_value->>'title' where id=any(dataset_ids);
 update public.vocab_dataset_catalog set display_name=metadata_value->>'title',
   grade_code=case when length(metadata_value->>'targetGrade')<=24 then metadata_value->>'targetGrade' end,
   academic_year=(metadata_value->>'schoolYear')::smallint,
   metadata=metadata||private.vocabulary_template_catalog_metadata_v1(metadata_value,kind_value)
   where dataset_id=any(dataset_ids);
end;
$$;

-- Patch the live inner functions: M01 reference storage and deletion wrappers survive.
do $migration$
declare signature text; body text; old_fragment text; new_fragment text;
begin
 foreach signature in array array[
   'private.initialize_vocabulary_composition_before_delete_v1(uuid,text,uuid,uuid)',
   'private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)',
   'public.get_vocabulary_composition_summary_v1(uuid)',
   'public.get_vocabulary_composition_summary_v2(uuid)'
 ] loop
   body:=pg_get_functiondef(signature::regprocedure);
   if signature like 'private.%' then
     old_fragment:=$old$jsonb_build_object('school',t.metadata->'school','audience',case when t.metadata->>'school' is not null then 'school' else 'common' end,'purpose',case when t.metadata->>'purpose' is not null then 'exam_prep' end,'semester',t.metadata->'semester','templateMetadata',t.metadata)$old$;
     new_fragment:='private.vocabulary_template_catalog_metadata_v1(t.metadata,t.template_kind)';
   else
     old_fragment:=$old$case when t.metadata->>'purpose' is not null then 'exam_prep' end$old$;
     new_fragment:=$new$case when t.template_kind='exam_prep' then 'exam_prep' end$new$;
   end if;
   if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 unexpected function definition: %',signature; end if;
   execute replace(body,old_fragment,new_fragment);
 end loop;
end;
$migration$;

-- Only proven composition catalogs change; original material and student rows do not.
update public.vocab_dataset_catalog cat
set metadata=cat.metadata||private.vocabulary_template_catalog_metadata_v1(t.metadata,t.template_kind)
from private.vocabulary_compositions c join private.vocabulary_library_versions v on v.id=c.version_id
join private.vocabulary_library_templates t on t.id=v.template_id
where cat.dataset_id=c.dataset_id
  and cat.metadata is distinct from cat.metadata||private.vocabulary_template_catalog_metadata_v1(t.metadata,t.template_kind);

create or replace function public.save_vocabulary_library_template_v3(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<library_save>>
declare action text; request_id uuid; request_hash text; cached private.vocabulary_library_requests;
  t private.vocabulary_library_templates; previous private.vocabulary_library_versions; tid uuid; recipe jsonb; fixed jsonb; result jsonb; next_number integer:=1; criteria_value jsonb; preview jsonb;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000 then raise exception 'invalid_library_request' using errcode='22023'; end if;
  action:=p_request->>'action'; request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or coalesce(action,'') not in ('create','metadata','version','copy') then raise exception 'invalid_library_action' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_request))-2<>(case action when 'create' then 6 when 'metadata' then 5 when 'version' then 9 when 'delete' then 4 else 4 end) or
    not(p_request ?& (case action when 'create' then array['action','requestId','metadata','recipe','criteria','previewHash'] when 'metadata' then array['action','requestId','templateId','expectedRevision','metadata']
      when 'version' then array['action','requestId','templateId','expectedRevision','expectedContentHash','recipe','metadata','criteria','previewHash'] when 'delete' then array['action','requestId','templateId','expectedRevision'] else array['action','requestId','sourceVersionId','metadata'] end)) then
    raise exception 'invalid_library_request_fields' using errcode='22023'; end if;
  if p_request->'protocolVersion' is distinct from '3'::jsonb or not(p_request ? 'templateKind')
    or (p_request->'templateKind'<>'null'::jsonb and (jsonb_typeof(p_request->'templateKind') is distinct from 'string'
      or p_request->>'templateKind' not in ('performance_assessment','exam_prep','mock_exam','other')))
    or (action in ('create','copy') and p_request->>'templateKind' is null) then
    raise exception 'invalid_library_template_kind' using errcode='22023';
  end if;
  request_hash:=private.reviewed_exam_sha256_v1(p_request);
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_id::text,0));
  select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and vocabulary_library_requests.request_id=library_save.request_id;
  if found then
    if cached.request_hash<>request_hash then raise exception 'library_request_reused' using errcode='40001'; end if;
    return private.compact_vocabulary_library_receipt_v1(cached.result);
  end if;
  if action in ('create','version') and p_request->'criteria' is distinct from 'null'::jsonb then
    perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-scope-capacity',0));
  end if;
  if action in ('create','copy') then
    perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-template-capacity',0));
    if (select count(*) from private.vocabulary_library_templates where deleted_at is null)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  end if;
  if action in ('metadata','version','delete') then
    select * into t from private.vocabulary_library_templates where id=(p_request->>'templateId')::uuid for update;
    if not found or t.deleted_at is not null then raise exception 'library_template_not_found' using errcode='P0002'; end if;
    if t.revision is distinct from (p_request->>'expectedRevision')::integer then raise exception 'library_template_changed' using errcode='40001'; end if;
    if t.template_kind is not null and p_request->>'templateKind' is null then
      raise exception 'classified_template_kind_required' using errcode='22023';
    end if;
    tid:=t.id;
  end if;
  if action in ('metadata','create','copy') or (action='version' and p_request ? 'metadata') then perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata'); end if;
  if action='delete' then
    update private.vocabulary_library_templates set deleted_at=now(),revision=revision+1,updated_at=now() where id=tid;
    result:=jsonb_build_object('deleted',jsonb_build_object('templateId',tid,'revision',t.revision+1));
    insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
    return result;
  end if;
  if action='metadata' then
    update private.vocabulary_library_templates set metadata=p_request->'metadata',template_kind=p_request->>'templateKind',revision=revision+1,updated_at=now() where id=tid;
  else
    if action='copy' then
      select * into previous from private.vocabulary_library_versions where id=(p_request->>'sourceVersionId')::uuid;
      if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      select * into t from private.vocabulary_library_templates where id=previous.template_id for share;
      if t.deleted_at is not null then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      fixed:=previous.fixed_composition; recipe:=previous.recipe; criteria_value:=previous.criteria;
    else
      recipe:=p_request->'recipe'; criteria_value:=nullif(p_request->'criteria','null'::jsonb);
      if criteria_value is not null then
        -- The importer shares this capacity lock, acquired before any source locks.
        preview:=private.preview_vocabulary_library_selection_v1(jsonb_build_object('mode','criteria','criteria',criteria_value),null);
        if preview->'recipe' is distinct from recipe or jsonb_array_length(preview->'orphanedExclusions')<>0 then raise exception 'library_criteria_changed' using errcode='40001'; end if;
      end if;
      fixed:=private.resolve_vocabulary_library_recipe_compact_v1(recipe);
      if private.reviewed_exam_sha256_v1(fixed) is distinct from p_request->>'previewHash' then raise exception 'library_preview_changed' using errcode='40001'; end if;
    end if;
    if action in ('create','copy') then
      insert into private.vocabulary_library_templates(metadata,template_kind,created_by) values(p_request->'metadata',p_request->>'templateKind',auth.uid()) returning id into tid;
    else
      select * into previous from private.vocabulary_library_versions where template_id=tid order by number desc limit 1;
      if previous.content_sha256 is distinct from p_request->>'expectedContentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
      next_number:=previous.number+1;
      if next_number>1000 then raise exception 'library_version_limit' using errcode='22023'; end if;
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now(),
        template_kind=p_request->>'templateKind', metadata=case when p_request ? 'metadata' then p_request->'metadata' else metadata end where id=tid;
    end if;
    insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,source_version_id,created_by,criteria)
      values(tid,next_number,case when action='copy' then previous.content_sha256 else private.reviewed_exam_sha256_v1(fixed) end,recipe,fixed,previous.id,auth.uid(),criteria_value);
  end if;
  perform private.sync_vocabulary_template_metadata_v1(tid);
  result:=jsonb_build_object('template',private.vocabulary_library_template_summary_v2(tid));
  insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
  return result;
end;
$$;

revoke all on function public.save_vocabulary_library_template_v3(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_vocabulary_library_template_v3(jsonb) to authenticated;
alter function public.save_vocabulary_library_template_v3(jsonb) set statement_timeout='55s';

create function public.get_vocabulary_composition_summary_v3(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' set statement_timeout='55s' as $$
declare result jsonb; kind_value text;
begin
 result:=public.get_vocabulary_composition_summary_v2(p_version_id);
 select t.template_kind into kind_value from private.vocabulary_library_templates t
   join private.vocabulary_library_versions v on v.template_id=t.id where v.id=p_version_id;
 return jsonb_set(jsonb_set(result,'{template,templateKind}',coalesce(to_jsonb(kind_value),'null'::jsonb)),
   '{createdBook,dataset,templateKind}',coalesce(to_jsonb(kind_value),'null'::jsonb));
end;
$$;
revoke all on function public.get_vocabulary_composition_summary_v3(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_vocabulary_composition_summary_v3(uuid) to authenticated;

-- New query generation uses the same read-only range operations and strict pages.
-- Counts describe fixed learning identities, never current dictionary guesses.
create function private.vocabulary_library_quantities_v1(p_fixed jsonb,p_version uuid default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare item jsonb; doc jsonb; binding jsonb; word_key text; meaning_key text;
  word_keys text[]:='{}'; meaning_keys text[]:='{}'; source_meanings text[]:='{}';
  unknown_words integer:=0; unknown_meanings integer:=0; included integer:=0;
  c private.vocabulary_compositions; units uuid[]; questions jsonb:=null;
begin
  for item in select distinct on (x->>'key') x from jsonb_array_elements(p_fixed->'occurrences') x
    where p_fixed->'includedKeys' ? (x->>'key') order by x->>'key' loop
    included:=included+1; doc:=private.expand_vocabulary_library_occurrence_v1(item);
    meaning_key:=null;
    if doc#>>'{resources,selected,schemaVersion}'='vocabulary-resource-ref-v2'
       or (doc#>'{resources,selected}') ?| array['selectionId','selectionHash']
       or (doc->'resources') ? 'selectionBinding' then
      binding:=private.resolve_vocabulary_learning_binding_v1(doc->'resources');
      word_key:=coalesce(nullif(binding#>>'{sourceIdentifiers,dictionaryId}',''),nullif(binding#>>'{selectedDictionary,dictionary_id}',''));
      meaning_key:=(binding#>>'{learningIdentity,kind}')||':'||(binding#>>'{learningIdentity,key}');
      if binding#>>'{learningIdentity,kind}'='source-occurrence-v1' then source_meanings:=array_append(source_meanings,meaning_key); end if;
    else
      word_key:=coalesce(nullif(doc#>>'{occurrence,payload,dictionary_id}',''),nullif(doc#>>'{occurrence,dictionary_id}',''),nullif(doc#>>'{resources,selected,dictionary,dictionary_id}',''));
    end if;
    if word_key is null then unknown_words:=unknown_words+1; else word_keys:=array_append(word_keys,word_key); end if;
    if meaning_key is null then unknown_meanings:=unknown_meanings+1; else meaning_keys:=array_append(meaning_keys,meaning_key); end if;
  end loop;
  if included<>(select count(distinct x) from jsonb_array_elements_text(p_fixed->'includedKeys') x) then raise exception 'library_quantity_reference_missing' using errcode='40001'; end if;
  if p_version is not null then
    select * into c from private.vocabulary_compositions where version_id=p_version;
    if found and c.state='ready' then
      select array_agg(id order by id) into units from public.vocab_units where dataset_id=c.dataset_id;
      select jsonb_agg(jsonb_build_object('mode',mode,'englishToKorean',en,'koreanToEnglish',ko) order by mode) into questions from (
        select mode,count(q.question_item_id) filter(where q.direction='english_to_korean') en,count(q.question_item_id) filter(where q.direction='korean_to_english') ko
        from unnest(array['book_meaning_choice','canonical_definition_to_headword','canonical_headword_to_definition']) mode
        left join lateral public.list_active_vocabulary_composition_questions_v1(c.dataset_id,units,mode) q on true group by mode
      ) counts;
    end if;
  end if;
  return jsonb_build_object('uniqueWordCount',case when unknown_words=0 then (select count(distinct x) from unnest(word_keys)x) end,
    'unknownWordItems',unknown_words,'meaningItemCount',case when unknown_meanings=0 then (select count(distinct x) from unnest(meaning_keys)x) end,
    'unknownMeaningItems',unknown_meanings,'sourceSpecificMeaningItems',(select count(distinct x) from unnest(source_meanings)x),
    'questionCounts',questions);
end;
$$;
revoke all on function private.vocabulary_library_quantities_v1(jsonb,uuid) from public,anon,authenticated,service_role;
do $migration$
declare body text; anchor text:=$old$'sourceCount',fixed->'sourceCount'$old$;
begin
  body:=pg_get_functiondef('private.preview_vocabulary_library_selection_v1(jsonb,uuid)'::regprocedure);
  body:=replace(body,'private.preview_vocabulary_library_selection_v1(','private.preview_vocabulary_library_selection_v2(');
  if cardinality(string_to_array(body,anchor))<>2 then raise exception 'M07 preview quantities definition changed'; end if;
  execute replace(body,anchor,anchor||$new$,'quantities',private.vocabulary_library_quantities_v1(fixed)$new$);
end;
$migration$;
revoke all on function private.preview_vocabulary_library_selection_v2(jsonb,uuid) from public,anon,authenticated,service_role;

do $migration$
declare body text; old_fragment text; new_fragment text;
begin
 body:=pg_get_functiondef('public.query_vocabulary_library_v1(jsonb)'::regprocedure);
 body:=replace(body,'public.query_vocabulary_library_v1(','public.query_vocabulary_library_v2(');
 old_fragment:=$old$array['kind','search','cursor','limit']$old$;
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 query fields changed'; end if;
 body:=replace(body,old_fragment,$new$array['kind','search','cursor','limit','templateKind']$new$);
 old_fragment:=$old$k:=p_query->>'kind';$old$;
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 query kind changed'; end if;
 body:=replace(body,old_fragment,old_fragment||$new$
 if k='templates' and (jsonb_typeof(p_query->'templateKind') is distinct from 'string'
   or p_query->>'templateKind' not in ('all','unclassified','performance_assessment','exam_prep','mock_exam','other')) then
   raise exception 'invalid_library_template_kind' using errcode='22023';
 end if;$new$);
 old_fragment:=$old$jsonb_build_object('actor',auth.uid(),'query',p_query-'cursor')$old$;
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 query binding changed'; end if;
 body:=replace(body,old_fragment,$new$jsonb_build_object('contract','vocabulary-library-query-v2','actor',auth.uid(),'accessScope','active-admin-global-v1','query',p_query-'cursor')$new$);
 old_fragment:='private.vocabulary_library_template_summary_v1(';
 if cardinality(string_to_array(body,old_fragment))<>3 then raise exception 'M07 query summaries changed'; end if;
 body:=replace(body,old_fragment,'private.vocabulary_library_template_summary_v2(');
 body:=replace(body,'private.vocabulary_library_template_search_v1(t)','private.vocabulary_library_template_search_v2(t)');
 old_fragment:='result:=private.preview_vocabulary_library_selection_v1(';
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 query preview definition changed'; end if;
 body:=replace(body,old_fragment,'result:=private.preview_vocabulary_library_selection_v2(');
 old_fragment:=$old$'criteria',v.criteria,$old$;
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 detail quantities definition changed'; end if;
 body:=replace(body,old_fragment,old_fragment||$new$'quantities',private.vocabulary_library_quantities_v1(v.fixed_composition,v.id),$new$);
 old_fragment:=$old$where t.deleted_at is null and (coalesce(p_query->>'search','')=''$old$;
 if cardinality(string_to_array(body,old_fragment))<>2 then raise exception 'M07 template selection changed'; end if;
 new_fragment:=$new$where t.deleted_at is null
   and (p_query->>'templateKind'='all' or p_query->>'templateKind'='unclassified' and t.template_kind is null or t.template_kind=p_query->>'templateKind')
   and (coalesce(p_query->>'search','')=''$new$;
 execute replace(body,old_fragment,new_fragment);
end;
$migration$;
revoke all on function public.query_vocabulary_library_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.query_vocabulary_library_v2(jsonb) to authenticated;
notify pgrst, 'reload schema';
