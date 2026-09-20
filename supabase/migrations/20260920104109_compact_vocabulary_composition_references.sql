-- Immutable compact references avoid duplicating the full original material in each version.
-- Existing v1 snapshots and their content hashes are never rewritten.
create table private.vocabulary_library_row_fingerprints (
  scope_id uuid not null,
  occurrence_key text not null,
  document_sha256 text not null check(document_sha256 ~ '^[a-f0-9]{64}$'),
  primary key(scope_id,occurrence_key),
  foreign key(scope_id,occurrence_key) references private.vocabulary_library_scope_rows(scope_id,occurrence_key)
);
alter table private.vocabulary_library_row_fingerprints enable row level security;
revoke all on private.vocabulary_library_row_fingerprints from public,anon,authenticated,service_role;
create trigger vocabulary_library_fingerprints_immutable before update or delete on private.vocabulary_library_row_fingerprints
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.vocabulary_library_row_document_v1(p_scope_id uuid,p_key text)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('key',sr.occurrence_key,'sourceRow',sr.source_row,'sourceEntryId',sr.source_entry_id,'rowHash',sr.row_sha256,
    'sourceClassification',(s.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'],
    'state',sr.state,'entry',sr.entry_snapshot,'occurrence',sr.occurrence_snapshot,'resources',sr.resources-'linkRecordHash')
  from private.vocabulary_library_scope_rows sr join private.vocabulary_library_scopes s on s.id=sr.scope_id
  where sr.scope_id=p_scope_id and sr.occurrence_key=p_key;
$$;
create function private.cache_vocabulary_library_row_fingerprints_v1(p_scope_ids uuid[])
returns integer language plpgsql security definer set search_path='' as $$
declare total integer;
begin
  insert into private.vocabulary_library_row_fingerprints(scope_id,occurrence_key,document_sha256)
    select r.scope_id,r.occurrence_key,private.reviewed_exam_sha256_v1(private.vocabulary_library_row_document_v1(r.scope_id,r.occurrence_key))
    from private.vocabulary_library_scope_rows r where r.scope_id=any(p_scope_ids)
      and not exists(select 1 from private.vocabulary_library_row_fingerprints f where f.scope_id=r.scope_id and f.occurrence_key=r.occurrence_key)
    on conflict do nothing;
  get diagnostics total=row_count; return total;
end;
$$;
create function private.cache_vocabulary_library_row_fingerprint_trigger_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into private.vocabulary_library_row_fingerprints(scope_id,occurrence_key,document_sha256)
    values(new.scope_id,new.occurrence_key,private.reviewed_exam_sha256_v1(private.vocabulary_library_row_document_v1(new.scope_id,new.occurrence_key)));
  return new;
end;
$$;
create trigger vocabulary_library_row_fingerprint after insert on private.vocabulary_library_scope_rows
  for each row execute function private.cache_vocabulary_library_row_fingerprint_trigger_v1();

create function private.validate_vocabulary_library_recipe_sources_v1(r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.vocabulary_library_scopes; picked jsonb; ranges jsonb:='[]';
begin
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>4 or not(r ?& array['filters','scopes','excludedOccurrenceKeys','scopeStatus'])
    or jsonb_typeof(r->'filters') is distinct from 'object' or octet_length((r->'filters')::text)>20000
    or jsonb_typeof(r->'scopes') is distinct from 'array' or jsonb_array_length(r->'scopes')>2000
    or jsonb_typeof(r->'excludedOccurrenceKeys') is distinct from 'array' or jsonb_array_length(r->'excludedOccurrenceKeys')>20000
    or coalesce(r->>'scopeStatus','') not in ('confirmed','unconfirmed') or
    (r->>'scopeStatus'='unconfirmed' and jsonb_array_length(r->'scopes')<>0) then raise exception 'invalid_library_recipe' using errcode='22023'; end if;
  perform private.validate_vocabulary_library_filters_v1(r->'filters');
  if (select count(distinct x->>'id') from jsonb_array_elements(r->'scopes') x)<>jsonb_array_length(r->'scopes') or
    (select count(distinct x) from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x)<>jsonb_array_length(r->'excludedOccurrenceKeys') or
    exists(select 1 from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x where x !~ '^[a-f0-9]{64}$' or x is null) then
    raise exception 'invalid_library_duplicates' using errcode='22023'; end if;
  perform 1 from public.vocab_datasets where id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by dataset_id for share;
  perform 1 from word_index.app_exam_use_release where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='exam_use' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from private.reviewed_exam_releases where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='reviewed_exam' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from public.vocab_entries where id in(select source_entry_id from private.vocabulary_library_scope_rows where scope_id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  for picked in select value from jsonb_array_elements(r->'scopes') loop
    if jsonb_typeof(picked)<>'object' or (select count(*) from jsonb_object_keys(picked))<>2 then raise exception 'invalid_library_pick' using errcode='22023'; end if;
    select * into s from private.vocabulary_library_scopes where id=(picked->>'id')::uuid;
    if not found then raise exception 'library_scope_missing' using errcode='40001'; end if;
    if s.version is distinct from picked->>'version' or private.vocabulary_library_source_state_v1(s)<>'available' then
      raise exception 'library_scope_changed' using errcode='40001'; end if;
    ranges:=ranges||jsonb_build_array(jsonb_build_object('id',s.id,'version',s.version,'source',s.payload->'source','classification',s.payload->'classification','references',s.review_references));
  end loop;
  return ranges;
end;
$$;

create function private.resolve_vocabulary_library_recipe_compact_v1(r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare ranges jsonb; row_list jsonb; membership_map jsonb; included jsonb; total integer; conflicting boolean;
begin
  ranges:=private.validate_vocabulary_library_recipe_sources_v1(r);
  if exists(select 1 from jsonb_array_elements(r->'scopes') x join private.vocabulary_library_scope_rows sr on sr.scope_id=(x->>'id')::uuid
    left join private.vocabulary_library_row_fingerprints f using(scope_id,occurrence_key) where f.scope_id is null) then
    raise exception 'library_fingerprints_incomplete' using errcode='55000'; end if;
  with selected as materialized (
    select (value->>'id')::uuid id,ordinality scope_order from jsonb_array_elements(r->'scopes') with ordinality
  ), members as materialized (
    select sr.occurrence_key key,sr.source_row,sr.state,selected.scope_order,selected.id scope_id,sr.resources->'linkRecordHash' link_hash,f.document_sha256
    from selected join private.vocabulary_library_scope_rows sr on sr.scope_id=selected.id
      join private.vocabulary_library_row_fingerprints f using(scope_id,occurrence_key)
  ), merged as materialized (
    select key,min(scope_order) first_scope,min(source_row) source_row,min(state) state,
      (array_agg(scope_id order by scope_order))[1] representative,(array_agg(document_sha256 order by scope_order))[1] document_sha256,
      count(*) member_count,jsonb_agg(scope_id order by scope_order) scope_ids,jsonb_agg(distinct link_hash order by link_hash) hashes
    from members group by key
  ), checked as (
    select merged.*,case when member_count>1 then exists(select 1 from members m where m.key=merged.key and m.scope_id<>representative
      and private.vocabulary_library_row_document_v1(m.scope_id,m.key) is distinct from private.vocabulary_library_row_document_v1(representative,merged.key)) else false end conflict
    from merged
  ) select coalesce(jsonb_agg(jsonb_build_object('key',key,'sourceRow',source_row,'state',state,'sourceScopeId',representative,'documentHash',document_sha256,'linkRecordHashes',hashes)
      order by first_scope,source_row),'[]'::jsonb),coalesce(jsonb_object_agg(key,scope_ids),'{}'::jsonb),
      coalesce(jsonb_agg(key order by first_scope,source_row) filter(where state='included' and not(r->'excludedOccurrenceKeys' ? key)),'[]'::jsonb),
      count(*)::integer,coalesce(bool_or(conflict),false)
    into row_list,membership_map,included,total,conflicting from checked;
  if conflicting then raise exception 'library_overlapping_rows_conflict' using errcode='40001'; end if;
  if total>20000 then raise exception 'library_composition_too_large' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x where not(membership_map ? x)) then
    raise exception 'library_exclusion_outside_scope' using errcode='22023'; end if;
  return jsonb_build_object('schemaVersion','vocabulary-library-composition-v2','scopes',ranges,'occurrences',row_list,'rowScopes',membership_map,
    'includedKeys',included,'sourceCount',total,'excludedOccurrenceKeys',r->'excludedOccurrenceKeys','scopeStatus',r->'scopeStatus');
end;
$$;
create function private.expand_vocabulary_library_occurrence_v1(p_row jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare doc jsonb;
begin
  if not(p_row ? 'sourceScopeId') then return p_row; end if;
  if not exists(select 1 from private.vocabulary_library_row_fingerprints where scope_id=(p_row->>'sourceScopeId')::uuid
    and occurrence_key=p_row->>'key' and document_sha256=p_row->>'documentHash') then
    raise exception 'composition_reference_changed' using errcode='40001'; end if;
  doc:=private.vocabulary_library_row_document_v1((p_row->>'sourceScopeId')::uuid,p_row->>'key');
  return jsonb_set(doc,'{resources,linkRecordHashes}',p_row->'linkRecordHashes');
end;
$$;
create function private.assert_vocabulary_library_version_current_v1(v private.vocabulary_library_versions)
returns void language plpgsql security definer set search_path='' as $$
begin
  if v.fixed_composition->>'schemaVersion'='vocabulary-library-composition-v2' then
    if private.resolve_vocabulary_library_recipe_compact_v1(v.recipe) is distinct from v.fixed_composition then
      raise exception 'composition_source_changed' using errcode='40001'; end if;
  elsif not(v.fixed_composition ? 'schemaVersion') then
    -- The v1 version and every referenced source scope/row are immutable. Their
    -- payload was validated when saved; only live source state can now change.
    if private.validate_vocabulary_library_recipe_sources_v1(v.recipe) is distinct from v.fixed_composition->'scopes' then
      raise exception 'composition_source_changed' using errcode='40001'; end if;
  else raise exception 'composition_format_invalid' using errcode='22023'; end if;
end;
$$;

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
  if (select count(*) from jsonb_object_keys(p_request))<>(case action when 'create' then 4 when 'metadata' then 5 when 'version' then 6 else 4 end) or
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
    if (select count(*) from private.vocabulary_library_templates)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  end if;
  if action in ('metadata','version') then
    select * into t from private.vocabulary_library_templates where id=(p_request->>'templateId')::uuid for update;
    if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
    if t.revision is distinct from (p_request->>'expectedRevision')::integer then raise exception 'library_template_changed' using errcode='40001'; end if;
    tid:=t.id;
  end if;
  if action in ('metadata','create','copy') then perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata'); end if;
  if action='metadata' then
    update private.vocabulary_library_templates set metadata=p_request->'metadata',revision=revision+1,updated_at=now() where id=tid;
  else
    if action='copy' then
      select * into previous from private.vocabulary_library_versions where id=(p_request->>'sourceVersionId')::uuid;
      if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
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
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now() where id=tid;
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
create or replace function private.create_vocabulary_library_template_management_v1(p_project_ref text,p_approval_id text,p_template_key text,p_request jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare request_id uuid; request_hash text; cached private.vocabulary_library_management_requests;
  tid uuid; fixed jsonb; result jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  if p_project_ref is null or p_project_ref !~ '^[a-z]{20}$' or not exists(
    select 1 from private.vocabulary_library_import_approvals where target_project_ref=p_project_ref
  ) then raise exception 'management_project_not_approved' using errcode='42501'; end if;
  if length(trim(coalesce(p_approval_id,''))) not between 1 and 200 or length(trim(coalesce(p_template_key,''))) not between 1 and 200
    or jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000
    or (select count(*) from jsonb_object_keys(p_request))<>4 or not(p_request ?& array['action','requestId','metadata','recipe'])
    or p_request->>'action' is distinct from 'create' or jsonb_typeof(p_request->'requestId') is distinct from 'string' then
    raise exception 'invalid_library_management_create' using errcode='22023'; end if;
  request_id:=(p_request->>'requestId')::uuid;
  request_hash:=private.reviewed_exam_sha256_v1(jsonb_build_array(p_project_ref,p_approval_id,p_template_key,p_request));
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-management:'||request_id,0));
  select * into cached from private.vocabulary_library_management_requests where id=request_id;
  if found then
    if cached.command_sha256<>request_hash then raise exception 'library_request_reused' using errcode='40001'; end if;
    select r.result into result from private.vocabulary_library_management_results r where r.request_id=cached.id;
    if not found then raise exception 'library_management_receipt_missing' using errcode='40001'; end if;
    return result;
  end if;
  if not exists(select 1 from private.vocabulary_library_template_approvals a
    where a.project_ref=p_project_ref and a.approval_id=p_approval_id and a.template_key=p_template_key and a.command_sha256=request_hash) then
    raise exception 'library_template_not_approved' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-template-capacity',0));
  if (select count(*) from private.vocabulary_library_templates)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata');
  fixed:=private.resolve_vocabulary_library_recipe_compact_v1(p_request->'recipe');
  if exists(select 1 from jsonb_array_elements(p_request->'recipe'->'scopes') x
    join private.vocabulary_library_scopes s on s.id=(x->>'id')::uuid
    where not exists(select 1 from private.vocabulary_library_import_approvals a where a.target_project_ref=p_project_ref and a.file_sha256=s.import_file_sha256)) then
    raise exception 'management_scope_project_mismatch' using errcode='42501'; end if;
  insert into private.vocabulary_library_management_requests(id,project_ref,approval_id,template_key,command_sha256,command,executed_by,session_role)
    values(request_id,p_project_ref,p_approval_id,p_template_key,request_hash,p_request,current_user,session_user);
  insert into private.vocabulary_library_templates(metadata,management_request_id) values(p_request->'metadata',request_id) returning id into tid;
  insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,management_request_id)
    values(tid,1,private.reviewed_exam_sha256_v1(fixed),p_request->'recipe',fixed,request_id);
  result:=jsonb_build_object('template',private.vocabulary_library_template_json_v1(tid));
  insert into private.vocabulary_library_management_results(request_id,result) values(request_id,result);
  return result;
end;
$$;
create or replace function private.prepare_vocabulary_composition_core_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v private.vocabulary_library_versions; t private.vocabulary_library_templates; fixed jsonb; row_doc jsonb; rows_by_key jsonb; frozen_rows jsonb; row_scopes jsonb;
  c private.vocabulary_compositions; s private.vocabulary_library_scopes; e public.vocab_entries;
  dataset_value uuid:=extensions.gen_random_uuid(); unit_value uuid; entry_value bigint;
  scope_ids uuid[]; row_key text; membership jsonb; block_key jsonb; previous_block jsonb; class jsonb;
  row_no integer:=0; unit_no integer:=0; position_no integer:=0; row_hash text; unit_name text; group_name text;
  directions text[]; eligibility jsonb; selected jsonb; old_item private.reviewed_exam_items; target_entry private.vocabulary_composition_entries;
  choice_ids bigint[]; choice_pron jsonb; choice_id bigint; new_choice bigint; choice_resource jsonb; proof jsonb; item_doc jsonb; item_hash text;
begin
  if p_version_id is null or p_content_sha256 is null then raise exception 'composition_version_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
  select * into v from private.vocabulary_library_versions where id=p_version_id;
  if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
  if v.content_sha256<>p_content_sha256 then raise exception 'library_version_changed' using errcode='40001'; end if;
  select * into c from private.vocabulary_compositions where version_id=p_version_id;
  if found then return private.vocabulary_composition_response_v1(p_version_id,p_management_request_id is not null); end if;
  perform private.assert_vocabulary_library_version_current_v1(v);
  fixed:=v.fixed_composition;
  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;
  frozen_rows:=fixed->'occurrences'; row_scopes:=fixed->'rowScopes';
  select jsonb_object_agg(value->>'key',ordinality-1) into rows_by_key from jsonb_array_elements(frozen_rows) with ordinality;
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,p_actor_id,jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));
  for row_key in select value from jsonb_array_elements_text(fixed->'includedKeys') loop
    row_doc:=private.expand_vocabulary_library_occurrence_v1(frozen_rows->((rows_by_key->>row_key)::integer));
    scope_ids:=array(select value::uuid from jsonb_array_elements_text(row_scopes->row_key));
    membership:=to_jsonb(array(select x from unnest(scope_ids) x order by x));
    select * into s from private.vocabulary_library_scopes where id=scope_ids[1];
    class:=row_doc->'sourceClassification';
    block_key:=jsonb_build_array(s.dataset_id,s.source_kind,s.source_release_id,s.source_version,s.source_file_sha256,s.unit_id,class,membership);
    if block_key is distinct from previous_block then
      unit_no:=unit_no+1; position_no:=0; unit_value:=extensions.gen_random_uuid(); previous_block:=block_key;
      unit_name:=left(s.payload->>'name',120)||case when cardinality(scope_ids)>1 then ' 외 '||(cardinality(scope_ids)-1)::text||'개 범위의 공통 부분' else '' end;
      group_name:=case when class->>'kind'='csat' then 'csat' when class->>'kind'='mock' and class->>'sourceGrade'='g12' then 'high_mock' else 'high' end;
      insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
        values(unit_value,dataset_value,unit_name,'composition-unit-'||unit_no::text,case when class->>'day' is not null then 'day'::public.vocab_unit_kind else 'supplement'::public.vocab_unit_kind end,(class->>'day')::int,unit_no,0);
      insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,academic_year,exam_month,agency,item_range,sort_index,metadata)
        values(unit_value,group_name,case when class->>'day' is not null then 'day' when class->>'lesson' is not null then 'lesson' when class->>'kind' in ('mock','csat') then 'exam_scope' else 'supplement' end,
          unit_name,(class#>>'{exam,executionYear}')::smallint,(class#>>'{exam,examMonth}')::smallint,class#>>'{exam,agency}',
          (select string_agg(n,'–' order by ord) from jsonb_array_elements_text(class#>'{exam,questionNumbers}') with ordinality q(n,ord)),unit_no,
          jsonb_build_object('mockScope',class->'exam','sourceClassification',class,'librarySourceScopes',(select jsonb_agg(jsonb_build_object('id',x.id,'name',x.payload->>'name')) from private.vocabulary_library_scopes x where x.id=any(scope_ids))));
    end if;
    row_no:=row_no+1; position_no:=position_no+1;
    e:=jsonb_populate_record(null::public.vocab_entries,row_doc->'entry');
    selected:=private.vocabulary_composition_resource_v1(row_doc->'resources');
    row_hash:=private.reviewed_exam_sha256_v1(jsonb_build_array(v.id,v.content_sha256,row_key));
    eligibility:=private.vocabulary_source_eligibility_v1(s.source_kind,s.source_release_id,e.id,e.dataset_id,e.row_sha256);
    directions:=array(select value from jsonb_array_elements_text(eligibility->'directions'));
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,example_en,example_ko,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      values(dataset_value,row_no,e.headword,e.headword_normalized,e.pronunciation_ko,e.meanings,e.primary_meaning,e.english_definition,e.example_en,e.example_ko,e.source_ref,upper(row_hash),unit_value,position_no,e.entry_type) returning id into entry_value;
    insert into private.vocabulary_composition_entries(version_id,dataset_id,vocab_entry_id,unit_id,occurrence_key,source_entry_id,source_scope_ids,source_kind,source_release_id,entry_sha256,identity_key,source_snapshot,resources,eligible_directions,eligibility_snapshot)
      values(v.id,dataset_value,entry_value,unit_value,row_key,e.id,scope_ids,s.source_kind,s.source_release_id,row_hash,
        private.reviewed_exam_sha256_v1(jsonb_build_array('unreviewed-occurrence-v1',v.id,row_key)),row_doc,row_doc->'resources',directions,eligibility);
  end loop;
  update public.vocab_units u set entry_count=n.total from (select unit_id,count(*)::integer total from public.vocab_entries where dataset_id=dataset_value group by unit_id) n where u.id=n.unit_id;
  -- Reviewed questions are copied from their original immutable bank, including
  -- choices outside the selected passage. Only exact included choice IDs map.
  for target_entry in select * from private.vocabulary_composition_entries where version_id=v.id and source_kind='reviewed_exam' loop
    for old_item in select * from private.reviewed_exam_items where release_id=target_entry.source_release_id and vocab_entry_id=target_entry.source_entry_id loop
      choice_ids:='{}'; choice_pron:='[]';
      foreach choice_id in array old_item.choice_vocab_entry_ids loop
        select vocab_entry_id into new_choice from private.vocabulary_composition_entries where version_id=v.id and source_kind='reviewed_exam' and source_release_id=old_item.release_id and source_entry_id=choice_id;
        choice_ids:=array_append(choice_ids,coalesce(new_choice,choice_id));
        choice_resource:=private.vocabulary_composition_choice_resource_v1(target_entry.source_scope_ids[1],choice_id);
        choice_pron:=choice_pron||jsonb_build_array(choice_resource->'pronunciation');
      end loop;
      proof:=jsonb_build_object('sourceKind','reviewed_item','releaseId',old_item.release_id,'itemId',old_item.item_id,'itemHash',old_item.item_sha256,
        'originalChoiceEntryIds',old_item.choice_vocab_entry_ids,'resources',target_entry.resources,'originalItem',old_item.payload);
      item_doc:=jsonb_build_object('target',target_entry.vocab_entry_id,'mode',old_item.quiz_mode,'direction',old_item.direction,'prompt',old_item.prompt,'choices',old_item.choice_texts,
        'choiceIds',choice_ids,'correctIndex',old_item.correct_choice_index,'proof',proof,'pronunciation',jsonb_build_object('target',target_entry.resources#>'{selected,pronunciation}','choices',choice_pron));
      item_hash:=private.reviewed_exam_sha256_v1(item_doc);
      insert into private.vocabulary_composition_items(version_id,dataset_id,vocab_entry_id,item_id,item_sha256,quiz_mode,direction,source_kind,source_release_id,source_item_id,source_item_sha256,prompt_role,choice_role,prompt,choice_texts,choice_vocab_entry_ids,correct_choice_index,pronunciation_snapshot,source_proof)
        values(v.id,dataset_value,target_entry.vocab_entry_id,item_hash,item_hash,old_item.quiz_mode,old_item.direction,'reviewed_item',old_item.release_id,old_item.item_id,old_item.item_sha256,old_item.prompt_role,old_item.choice_role,old_item.prompt,old_item.choice_texts,choice_ids,old_item.correct_choice_index,item_doc->'pronunciation',proof);
    end loop;
  end loop;
  insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,academic_year,is_assignable,metadata)
    values(dataset_value,t.metadata->>'title',case when (select count(distinct cat.catalog_group)=1 from public.vocab_unit_catalog cat join public.vocab_units u on u.id=cat.unit_id where u.dataset_id=dataset_value)
      then (select cat.catalog_group from public.vocab_unit_catalog cat join public.vocab_units u on u.id=cat.unit_id where u.dataset_id=dataset_value limit 1) else 'high' end,
      'wordbook',case when length(t.metadata->>'targetGrade')<=24 then t.metadata->>'targetGrade' end,(t.metadata->>'schoolYear')::smallint,false,
      jsonb_build_object('school',t.metadata->'school','audience',case when t.metadata->>'school' is not null then 'school' else 'common' end,'purpose',case when t.metadata->>'purpose' is not null then 'exam_prep' end,'semester',t.metadata->'semester','templateMetadata',t.metadata));
  insert into private.vocabulary_compositions(version_id,dataset_id,content_sha256,state,created_by,management_request_id) values(v.id,dataset_value,v.content_sha256,'preparing',p_actor_id,p_management_request_id);
  return private.vocabulary_composition_response_v1(v.id,p_management_request_id is not null);
end;
$$;
create or replace function private.finalize_vocabulary_composition_core_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb,p_summary_only boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c private.vocabulary_compositions; v private.vocabulary_library_versions; q jsonb;
  target_entry private.vocabulary_composition_entries; e public.vocab_entries; choice public.vocab_entries;
  choice_lineage private.vocabulary_composition_entries; choice_id bigint; choice_ids bigint[]; texts text[];
  direction_value text; expected_prompt text; choice_pron jsonb; proof jsonb; item_doc jsonb; item_hash text; bank_hash text;
begin
  select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  if not found then raise exception 'composition_missing' using errcode='P0002'; end if;
  if c.content_sha256 is distinct from p_content_sha256 then raise exception 'composition_changed' using errcode='40001'; end if;
  if c.state='ready' then return private.vocabulary_composition_response_v1(p_version_id,p_summary_only); end if;
  select * into v from private.vocabulary_library_versions where id=p_version_id;
  perform private.assert_vocabulary_library_version_current_v1(v);
  perform 1 from public.vocab_entry_quiz_eligibility q join private.vocabulary_composition_entries l on l.source_entry_id=q.vocab_entry_id
    where l.version_id=c.version_id order by q.vocab_entry_id,q.quiz_mode for share of q;
  if exists(select 1 from private.vocabulary_composition_entries l where l.version_id=c.version_id and l.eligibility_snapshot is distinct from
    private.vocabulary_source_eligibility_v1(l.source_kind,l.source_release_id,l.source_entry_id,(l.source_snapshot#>>'{entry,dataset_id}')::uuid,l.source_snapshot#>>'{entry,row_sha256}'))
    then raise exception 'composition_source_eligibility_changed' using errcode='40001'; end if;
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>40000
    then raise exception 'composition_questions_invalid' using errcode='22023'; end if;
  for q in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(q) is distinct from 'object' or not(q ?& array['vocabEntryId','direction','prompt','choices','choiceVocabEntryIds','correctChoiceIndex'])
      or (select count(*) from jsonb_object_keys(q))<>6 or jsonb_typeof(q->'vocabEntryId') is distinct from 'number'
      or jsonb_typeof(q->'correctChoiceIndex') is distinct from 'number' or q->>'correctChoiceIndex' !~ '^[0-3]$'
      or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_typeof(q->'choiceVocabEntryIds') is distinct from 'array'
      or jsonb_array_length(q->'choices')<>4 or jsonb_array_length(q->'choiceVocabEntryIds')<>4
      or exists(select 1 from jsonb_array_elements(q->'choices') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}'))<1)
      or exists(select 1 from jsonb_array_elements(q->'choiceVocabEntryIds') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-9][0-9]*$')
    then raise exception 'composition_question_invalid' using errcode='22023'; end if;
    direction_value:=q->>'direction';
    select * into target_entry from private.vocabulary_composition_entries where version_id=c.version_id and vocab_entry_id=(q->>'vocabEntryId')::bigint;
    if not found or target_entry.source_kind='reviewed_exam' or direction_value is null or not(direction_value=any(target_entry.eligible_directions))
      then raise exception 'composition_target_not_eligible' using errcode='22023'; end if;
    select * into e from public.vocab_entries where id=target_entry.vocab_entry_id and lower(row_sha256)=target_entry.entry_sha256;
    if not found then raise exception 'composition_entry_changed' using errcode='40001'; end if;
    expected_prompt:=case direction_value when 'english_to_korean' then e.headword else e.primary_meaning end;
    if q->>'prompt' is distinct from expected_prompt then raise exception 'composition_prompt_changed' using errcode='22023'; end if;
    choice_ids:=array(select value::bigint from jsonb_array_elements_text(q->'choiceVocabEntryIds'));
    if (select count(distinct x) from unnest(choice_ids) x)<>4 or choice_ids[(q->>'correctChoiceIndex')::int+1]<>e.id
      then raise exception 'composition_choices_invalid' using errcode='22023'; end if;
    texts:='{}'; choice_pron:='[]';
    foreach choice_id in array choice_ids loop
      select * into choice_lineage from private.vocabulary_composition_entries where version_id=c.version_id and vocab_entry_id=choice_id;
      if not found or choice_lineage.source_kind='reviewed_exam' or not(direction_value=any(choice_lineage.eligible_directions)) then raise exception 'composition_choice_not_eligible' using errcode='22023'; end if;
      select * into choice from public.vocab_entries where id=choice_id and lower(row_sha256)=choice_lineage.entry_sha256;
      if not found then raise exception 'composition_choice_changed' using errcode='40001'; end if;
      if choice_id<>e.id and (lower(normalize(trim(choice.headword),NFKC))=lower(normalize(trim(e.headword),NFKC))
        or lower(normalize(trim(choice.primary_meaning),NFKC))=lower(normalize(trim(e.primary_meaning),NFKC)))
        then raise exception 'composition_choice_ambiguous' using errcode='22023'; end if;
      texts:=array_append(texts,case direction_value when 'english_to_korean' then choice.primary_meaning else choice.headword end);
      choice_pron:=choice_pron||jsonb_build_array(choice_lineage.resources#>'{selected,pronunciation}');
    end loop;
    if to_jsonb(texts) is distinct from q->'choices' or (select count(distinct lower(regexp_replace(normalize(trim(x),NFKC),'\s+',' ','g'))) from unnest(texts) x)<>4
      then raise exception 'composition_choice_text_changed' using errcode='22023'; end if;
    proof:=jsonb_build_object('sourceKind','generated_meaning','generator','explicit-targeted-v1','occurrenceKey',target_entry.occurrence_key,'resources',target_entry.resources);
    item_doc:=q||jsonb_build_object('versionId',c.version_id,'proof',proof,'pronunciation',jsonb_build_object('target',target_entry.resources#>'{selected,pronunciation}','choices',choice_pron));
    item_hash:=private.reviewed_exam_sha256_v1(item_doc);
    insert into private.vocabulary_composition_items(version_id,dataset_id,vocab_entry_id,item_id,item_sha256,quiz_mode,direction,source_kind,prompt_role,choice_role,prompt,choice_texts,choice_vocab_entry_ids,correct_choice_index,pronunciation_snapshot,source_proof)
      values(c.version_id,c.dataset_id,e.id,item_hash,item_hash,'book_meaning_choice',direction_value::public.question_direction,'generated_meaning',
        case direction_value when 'english_to_korean' then 'headword' else 'korean_meaning' end,case direction_value when 'english_to_korean' then 'korean_meaning' else 'headword' end,
        expected_prompt,texts,choice_ids,(q->>'correctChoiceIndex')::smallint,item_doc->'pronunciation',proof);
  end loop;
  select private.reviewed_exam_sha256_v1(coalesce(jsonb_agg(item_sha256 order by item_id),'[]')) into bank_hash from private.vocabulary_composition_items where version_id=c.version_id;
  update private.vocabulary_compositions set state='ready',question_sha256=bank_hash where version_id=c.version_id;
  update public.vocab_datasets set status='ready' where id=c.dataset_id;
  update public.vocab_dataset_catalog set is_assignable=(select count(distinct vocab_entry_id)>=4 from private.vocabulary_composition_items where version_id=c.version_id) where dataset_id=c.dataset_id;
  return private.vocabulary_composition_response_v1(c.version_id,p_summary_only);
end;
$$;
revoke all on function private.vocabulary_library_row_document_v1(uuid,text),private.cache_vocabulary_library_row_fingerprints_v1(uuid[]),
  private.cache_vocabulary_library_row_fingerprint_trigger_v1(),private.validate_vocabulary_library_recipe_sources_v1(jsonb),
  private.resolve_vocabulary_library_recipe_compact_v1(jsonb),private.expand_vocabulary_library_occurrence_v1(jsonb),
  private.assert_vocabulary_library_version_current_v1(private.vocabulary_library_versions) from public,anon,authenticated,service_role;
-- Local function limits leave every unrelated endpoint and role unchanged.
alter function public.list_vocabulary_library_v1() set statement_timeout='55s';
alter function public.save_vocabulary_library_template_v1(jsonb) set statement_timeout='55s';
alter function public.prepare_vocabulary_composition_v1(uuid,text) set statement_timeout='55s';
alter function public.prepare_vocabulary_template_book_v1(jsonb) set statement_timeout='55s';
alter function public.finalize_vocabulary_composition_v1(uuid,text,jsonb) set statement_timeout='55s';
