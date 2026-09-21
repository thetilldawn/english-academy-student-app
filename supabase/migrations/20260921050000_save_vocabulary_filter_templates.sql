-- Filter criteria accompany new immutable versions; deletion only hides templates.
create or replace function public.save_vocabulary_library_template_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<library_save>>
declare action text; request_id uuid; request_hash text; cached private.vocabulary_library_requests;
  t private.vocabulary_library_templates; previous private.vocabulary_library_versions; tid uuid; recipe jsonb; fixed jsonb; result jsonb; next_number integer:=1;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000 then raise exception 'invalid_library_request' using errcode='22023'; end if;
  action:=p_request->>'action'; request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or coalesce(action,'') not in ('create','metadata','version','copy') then raise exception 'invalid_library_action' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_request))<>(case action when 'create' then 4 when 'metadata' then 5 when 'version' then case when p_request ? 'metadata' then 7 else 6 end else 4 end) or
    not(p_request ?& (case action when 'create' then array['action','requestId','metadata','recipe'] when 'metadata' then array['action','requestId','templateId','expectedRevision','metadata']
      when 'version' then array['action','requestId','templateId','expectedRevision','expectedContentHash','recipe'] else array['action','requestId','sourceVersionId','metadata'] end)) then
    raise exception 'invalid_library_request_fields' using errcode='22023'; end if;
  request_hash:=private.reviewed_exam_sha256_v1(p_request);
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_id::text,0));
  select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and vocabulary_library_requests.request_id=library_save.request_id;
  if found then
    if cached.request_hash<>request_hash then raise exception 'library_request_reused' using errcode='40001'; end if;
    return cached.result;
  end if;
  if action in ('create','copy') then
    perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-template-capacity',0));
    if (select count(*) from private.vocabulary_library_templates where deleted_at is null)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  end if;
  if action in ('metadata','version') then
    select * into t from private.vocabulary_library_templates where id=(p_request->>'templateId')::uuid for update;
    if not found or t.deleted_at is not null then raise exception 'library_template_not_found' using errcode='P0002'; end if;
    if t.revision is distinct from (p_request->>'expectedRevision')::integer then raise exception 'library_template_changed' using errcode='40001'; end if;
    tid:=t.id;
  end if;
  if action in ('metadata','create','copy') or (action='version' and p_request ? 'metadata') then perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata'); end if;
  if action='metadata' then
    update private.vocabulary_library_templates set metadata=p_request->'metadata',revision=revision+1,updated_at=now() where id=tid;
  else
    if action='copy' then
      select * into previous from private.vocabulary_library_versions where id=(p_request->>'sourceVersionId')::uuid;
      if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      select * into t from private.vocabulary_library_templates where id=previous.template_id for share;
      if t.deleted_at is not null then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      fixed:=previous.fixed_composition; recipe:=previous.recipe;
    else
      recipe:=p_request->'recipe'; fixed:=private.resolve_vocabulary_library_recipe_compact_v1(recipe);
    end if;
    if action in ('create','copy') then
      insert into private.vocabulary_library_templates(metadata,created_by) values(p_request->'metadata',auth.uid()) returning id into tid;
    else
      select * into previous from private.vocabulary_library_versions where template_id=tid order by number desc limit 1;
      if previous.content_sha256 is distinct from p_request->>'expectedContentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
      next_number:=previous.number+1;
      if next_number>1000 then raise exception 'library_version_limit' using errcode='22023'; end if;
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now(),
        metadata=case when p_request ? 'metadata' then p_request->'metadata' else metadata end where id=tid;
    end if;
    insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,source_version_id,created_by)
      values(tid,next_number,case when action='copy' then previous.content_sha256 else private.reviewed_exam_sha256_v1(fixed) end,recipe,fixed,previous.id,auth.uid());
  end if;
  perform private.sync_vocabulary_template_metadata_v1(tid);
  result:=jsonb_build_object('template',private.vocabulary_library_template_json_v1(tid));
  insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
  return result;
end;
$$;
alter function public.save_vocabulary_library_template_v1(jsonb) set statement_timeout='55s';

create function private.compact_vocabulary_library_receipt_v1(p jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare t jsonb:=p->'template'; v jsonb;
begin
 if t is null or not(t ? 'versions') then return p; end if;
 select value into v from jsonb_array_elements(t->'versions') order by (value->>'number')::integer desc limit 1;
 return jsonb_set(p,'{template}',(t-'versions')||jsonb_build_object('latestVersion',jsonb_build_object(
   'id',v->'id','number',v->'number','contentHash',v->'contentHash','scopeStatus',v#>'{recipe,scopeStatus}',
   'scopeCount',jsonb_array_length(v#>'{recipe,scopes}'),'sourceCount',v->'sourceCount','includedCount',jsonb_array_length(v->'includedKeys'),
   'sourceVersionId',v->'sourceVersionId','datasetId',v->'datasetId','createdAt',v->'createdAt','hasCriteria',false)));
end;
$$;
revoke all on function private.compact_vocabulary_library_receipt_v1(jsonb) from public,anon,authenticated,service_role;

create or replace function public.save_vocabulary_library_template_v2(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<library_save>>
declare action text; request_id uuid; request_hash text; cached private.vocabulary_library_requests;
  t private.vocabulary_library_templates; previous private.vocabulary_library_versions; tid uuid; recipe jsonb; fixed jsonb; result jsonb; next_number integer:=1; criteria_value jsonb; preview jsonb;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000 then raise exception 'invalid_library_request' using errcode='22023'; end if;
  action:=p_request->>'action'; request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or coalesce(action,'') not in ('create','metadata','version','copy','delete') then raise exception 'invalid_library_action' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_request))<>(case action when 'create' then 6 when 'metadata' then 5 when 'version' then 9 when 'delete' then 4 else 4 end) or
    not(p_request ?& (case action when 'create' then array['action','requestId','metadata','recipe','criteria','previewHash'] when 'metadata' then array['action','requestId','templateId','expectedRevision','metadata']
      when 'version' then array['action','requestId','templateId','expectedRevision','expectedContentHash','recipe','metadata','criteria','previewHash'] when 'delete' then array['action','requestId','templateId','expectedRevision'] else array['action','requestId','sourceVersionId','metadata'] end)) then
    raise exception 'invalid_library_request_fields' using errcode='22023'; end if;
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
    update private.vocabulary_library_templates set metadata=p_request->'metadata',revision=revision+1,updated_at=now() where id=tid;
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
      insert into private.vocabulary_library_templates(metadata,created_by) values(p_request->'metadata',auth.uid()) returning id into tid;
    else
      select * into previous from private.vocabulary_library_versions where template_id=tid order by number desc limit 1;
      if previous.content_sha256 is distinct from p_request->>'expectedContentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
      next_number:=previous.number+1;
      if next_number>1000 then raise exception 'library_version_limit' using errcode='22023'; end if;
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now(),
        metadata=case when p_request ? 'metadata' then p_request->'metadata' else metadata end where id=tid;
    end if;
    insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,source_version_id,created_by,criteria)
      values(tid,next_number,case when action='copy' then previous.content_sha256 else private.reviewed_exam_sha256_v1(fixed) end,recipe,fixed,previous.id,auth.uid(),criteria_value);
  end if;
  perform private.sync_vocabulary_template_metadata_v1(tid);
  result:=jsonb_build_object('template',private.vocabulary_library_template_summary_v1(tid));
  insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
  return result;
end;
$$;
alter function public.save_vocabulary_library_template_v2(jsonb) set statement_timeout='55s';

create function public.get_vocabulary_composition_summary_v2(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  select jsonb_build_object('template',private.vocabulary_library_template_summary_v1(v.template_id),'createdBook',jsonb_build_object('versionId',c.version_id,'contentHash',c.content_sha256,
    'dataset',jsonb_build_object('id',d.id,'title',t.metadata->>'title','displayName',t.metadata->>'title','edition',null,'catalogGroup',cat.catalog_group,'materialKind','wordbook',
      'gradeCode',cat.grade_code,'publisher',null,'seriesTitle',null,'academicYear',cat.academic_year,'curriculumRevision',null,'editionLabel',null,'isAssignable',cat.is_assignable,'catalogSortIndex',cat.sort_index,
      'schoolName',t.metadata->'school','schoolClassification',case when t.metadata->>'school' is null then 'common' else 'school' end,'purpose',case when t.metadata->>'purpose' is not null then 'exam_prep' end,'semester',t.metadata->'semester',
      'isActive',d.is_active,'rowCount',d.row_count,'status',d.status,'questionBankKind','vocabulary_composition_v1',
      'availableQuestionModes',coalesce((select jsonb_agg(quiz_mode order by quiz_mode) from (select quiz_mode from private.vocabulary_composition_items i where i.version_id=c.version_id group by quiz_mode having count(distinct vocab_entry_id)>=4)m),'[]'::jsonb)))) into result
    from private.vocabulary_compositions c join private.vocabulary_library_versions v on v.id=c.version_id join private.vocabulary_library_templates t on t.id=v.template_id
    join public.vocab_datasets d on d.id=c.dataset_id join public.vocab_dataset_catalog cat on cat.dataset_id=d.id where c.version_id=p_version_id and c.state='ready';
  if result is null then raise exception 'composition_not_ready' using errcode='55000'; end if;
  return result;
end;
$$;
revoke all on function public.save_vocabulary_library_template_v2(jsonb),public.get_vocabulary_composition_summary_v2(uuid) from public,anon,authenticated,service_role;
grant execute on function public.save_vocabulary_library_template_v2(jsonb),public.get_vocabulary_composition_summary_v2(uuid) to authenticated;

-- Retain completed requests and in-progress creation receipts across a deletion.
-- The marker is not a completed result: the original generator must keep running.
create function private.guard_vocabulary_template_creation_v1(p_request jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare cached private.vocabulary_library_requests; v private.vocabulary_library_versions; t private.vocabulary_library_templates;
  c private.vocabulary_compositions; request_value uuid; version_value uuid;
begin
 if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
 if jsonb_typeof(p_request) is distinct from 'object' or (select count(*) from jsonb_object_keys(p_request))<>5
   or not(p_request ?& array['action','requestId','templateId','versionId','contentHash']) or p_request->>'action' is distinct from 'materialize'
   or coalesce(p_request->>'contentHash','') !~ '^[a-f0-9]{64}$' then raise exception 'invalid_library_request' using errcode='22023'; end if;
 request_value:=(p_request->>'requestId')::uuid; version_value:=(p_request->>'versionId')::uuid;
 if request_value is null or version_value is null then raise exception 'invalid_library_request' using errcode='22023'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_value::text,0));
 select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and request_id=request_value;
 if found and cached.request_hash<>private.reviewed_exam_sha256_v1(p_request) then raise exception 'library_request_reused' using errcode='40001'; end if;
 select * into v from private.vocabulary_library_versions where id=version_value and template_id=(p_request->>'templateId')::uuid;
 if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
 if v.content_sha256<>p_request->>'contentHash' then raise exception 'library_version_changed' using errcode='40001'; end if;
 perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||version_value::text,0));
 select * into c from private.vocabulary_compositions where version_id=version_value for update;
 select * into t from private.vocabulary_library_templates where id=v.template_id for share;
 if t.deleted_at is not null and (cached.request_id is null or cached.result is distinct from jsonb_build_object('materializingVersion',version_value)
   or c.version_id is null or c.content_sha256<>v.content_sha256) then
   raise exception 'library_template_not_found' using errcode='P0002'; end if;
end;
$$;

alter function public.advance_vocabulary_template_book_v1(jsonb) set schema private;
alter function private.advance_vocabulary_template_book_v1(jsonb) rename to advance_vocabulary_template_book_before_delete_v1;
create function public.advance_vocabulary_template_book_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
begin
 perform private.guard_vocabulary_template_creation_v1(p_request);
 return private.advance_vocabulary_template_book_before_delete_v1(p_request);
end;
$$;
alter function public.prepare_vocabulary_template_book_v1(jsonb) set schema private;
alter function private.prepare_vocabulary_template_book_v1(jsonb) rename to prepare_vocabulary_template_book_before_delete_v1;
create function public.prepare_vocabulary_template_book_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
begin
 perform private.guard_vocabulary_template_creation_v1(p_request);
 return private.prepare_vocabulary_template_book_before_delete_v1(p_request);
end;
$$;
alter function public.prepare_vocabulary_template_question_input_v1(jsonb) set schema private;
alter function private.prepare_vocabulary_template_question_input_v1(jsonb) rename to prepare_vocabulary_template_question_input_before_delete_v1;
create function public.prepare_vocabulary_template_question_input_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
begin
 perform private.guard_vocabulary_template_creation_v1(p_request);
 return private.prepare_vocabulary_template_question_input_before_delete_v1(p_request);
end;
$$;

create function private.guard_new_vocabulary_composition_v1(p_version_id uuid,p_hash text)
returns void language plpgsql security invoker set search_path='' as $$
declare v private.vocabulary_library_versions; t private.vocabulary_library_templates; c private.vocabulary_compositions;
begin
 perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
 select * into v from private.vocabulary_library_versions where id=p_version_id;
 if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
 if v.content_sha256 is distinct from p_hash then raise exception 'library_version_changed' using errcode='40001'; end if;
 select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
 if found then
   if c.content_sha256<>p_hash then raise exception 'library_version_changed' using errcode='40001'; end if;
   return;
 end if;
 select * into t from private.vocabulary_library_templates where id=v.template_id for share;
 if t.deleted_at is not null then raise exception 'library_template_not_found' using errcode='P0002'; end if;
end;
$$;
alter function private.initialize_vocabulary_composition_build_v1(uuid,text,uuid,uuid) rename to initialize_vocabulary_composition_before_delete_v1;
create function private.initialize_vocabulary_composition_build_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform private.guard_new_vocabulary_composition_v1(p_version_id,p_content_sha256);
 perform private.initialize_vocabulary_composition_before_delete_v1(p_version_id,p_content_sha256,p_actor_id,p_management_request_id);
end;
$$;
alter function private.prepare_vocabulary_composition_data_v1(uuid,text,uuid,uuid) rename to prepare_vocabulary_composition_data_before_delete_v1;
create function private.prepare_vocabulary_composition_data_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform private.guard_new_vocabulary_composition_v1(p_version_id,p_content_sha256);
 return private.prepare_vocabulary_composition_data_before_delete_v1(p_version_id,p_content_sha256,p_actor_id,p_management_request_id);
end;
$$;

alter function public.list_vocabulary_library_v1() set schema private;
alter function private.list_vocabulary_library_v1() rename to list_vocabulary_library_before_delete_v1;
create function public.list_vocabulary_library_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 result:=private.list_vocabulary_library_before_delete_v1();
 return jsonb_set(result,'{templates}',coalesce((select jsonb_agg(x order by ordinality) from jsonb_array_elements(result->'templates') with ordinality e(x,ordinality)
   join private.vocabulary_library_templates t on t.id=(x->>'id')::uuid where t.deleted_at is null),'[]'));
end;
$$;

revoke all on function private.guard_vocabulary_template_creation_v1(jsonb),private.advance_vocabulary_template_book_before_delete_v1(jsonb),
 private.prepare_vocabulary_template_book_before_delete_v1(jsonb),private.prepare_vocabulary_template_question_input_before_delete_v1(jsonb),
 private.guard_new_vocabulary_composition_v1(uuid,text),private.initialize_vocabulary_composition_before_delete_v1(uuid,text,uuid,uuid),
 private.initialize_vocabulary_composition_build_v1(uuid,text,uuid,uuid),private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid),
 private.prepare_vocabulary_composition_data_v1(uuid,text,uuid,uuid),private.list_vocabulary_library_before_delete_v1(),
 public.list_vocabulary_library_v1(),public.advance_vocabulary_template_book_v1(jsonb),public.prepare_vocabulary_template_book_v1(jsonb),public.prepare_vocabulary_template_question_input_v1(jsonb)
 from public,anon,authenticated,service_role;
grant execute on function public.list_vocabulary_library_v1(),public.advance_vocabulary_template_book_v1(jsonb),public.prepare_vocabulary_template_book_v1(jsonb),public.prepare_vocabulary_template_question_input_v1(jsonb) to authenticated;
