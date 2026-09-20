-- Preserve the existing legacy catalog fallback without changing catalog rows.
create function private.vocabulary_library_catalog_available_v1(p_dataset_id uuid,p_source_kind text)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce((select c.is_assignable from public.vocab_dataset_catalog c where c.dataset_id=p_dataset_id),p_source_kind='legacy_vocab');
$$;
revoke all on function private.vocabulary_library_catalog_available_v1(uuid,text) from public,anon,authenticated,service_role;

create or replace function private.vocabulary_library_source_state_v1(p_scope private.vocabulary_library_scopes)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.vocab_datasets; actual_version text; active boolean;
begin
  select * into d from public.vocab_datasets where id=p_scope.dataset_id;
  if not found or d.status<>'ready' or not d.is_active or not private.vocabulary_library_catalog_available_v1(d.id,p_scope.source_kind)
    then return 'retired'; end if;
  if p_scope.source_kind='exam_use' then
    select lower(package_version),status='active' into actual_version,active
      from word_index.app_exam_use_release where release_id=p_scope.source_release_id and dataset_id=d.id;
  elsif p_scope.source_kind='reviewed_exam' then
    select content_sha256,status='active' into actual_version,active
      from private.reviewed_exam_releases where release_id=p_scope.source_release_id and dataset_id=d.id;
  else
    actual_version:=lower(d.source_sha256); active:=true;
  end if;
  if active is distinct from true then return 'retired'; end if;
  if actual_version is distinct from p_scope.source_version then return 'changed'; end if;
  if exists(select 1 from private.vocabulary_library_scope_rows r
    left join public.vocab_entries e on e.id=r.source_entry_id
    left join word_index.app_exam_use_occurrence o on p_scope.source_kind='exam_use'
      and o.release_id=p_scope.source_release_id and o.source_row=r.source_row
    left join private.reviewed_exam_entries re on p_scope.source_kind='reviewed_exam'
      and re.release_id=p_scope.source_release_id and re.source_row=r.source_row
    where r.scope_id=p_scope.id and (
      (r.state='included' and (to_jsonb(e) is distinct from r.entry_snapshot or e.dataset_id is distinct from p_scope.dataset_id
        or e.unit_id is distinct from p_scope.unit_id)) or
      (p_scope.source_kind='exam_use' and to_jsonb(o) is distinct from r.occurrence_snapshot) or
      (p_scope.source_kind='reviewed_exam' and to_jsonb(re) is distinct from r.occurrence_snapshot))) then return 'changed'; end if;
  return 'available';
end;
$$;

create or replace function private.import_vocabulary_library_core_v1(p_text text,p_project_ref text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare b jsonb; approval private.vocabulary_library_import_approvals; file_hash text; s jsonb; src jsonb; rr jsonb;
  d public.vocab_datasets; e public.vocab_entries; o word_index.app_exam_use_occurrence; re private.reviewed_exam_entries;
  rid uuid; uid uuid; kind text; actual_version text; source_active boolean; eid bigint; rh text; state text;
  row_doc jsonb; rows_doc jsonb; public_rows jsonb; occurrence jsonb; proof jsonb; ver text; sid uuid; result jsonb:='[]'; key text;
begin
  if octet_length(p_text)>100000000 then raise exception 'library_import_too_large' using errcode='22023'; end if;
  file_hash:=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex'); b:=p_text::jsonb;
  select * into approval from private.vocabulary_library_import_approvals
    where target_project_ref=p_project_ref and file_sha256=file_hash for update;
  if not found or approval.content_sha256<>private.reviewed_exam_sha256_v1(b) then
    raise exception 'library_import_not_approved' using errcode='42501'; end if;
  if jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>5 or
    not(b ?& array['schemaVersion','sourceCatalogHash','linksHash','referenceCatalogHash','scopes']) or
    b->>'schemaVersion' is distinct from 'vocabulary-library-import-v1' or jsonb_typeof(b->'scopes') is distinct from 'array'
    or jsonb_array_length(b->'scopes')<>approval.scope_count then raise exception 'invalid_library_import' using errcode='22023'; end if;
  proof:=jsonb_build_object('sourceCatalogHash',b->'sourceCatalogHash','linksHash',b->'linksHash','referenceCatalogHash',b->'referenceCatalogHash');
  if exists(select 1 from jsonb_each_text(proof) where value !~ '^[a-f0-9]{64}$' or value is null)
    or (select count(distinct x->>'key') from jsonb_array_elements(b->'scopes') x)<>approval.scope_count then
    raise exception 'invalid_library_references' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-scope-capacity',0));
  if (select count(*) from (select scope_key from private.vocabulary_library_scopes union select x->>'key' from jsonb_array_elements(b->'scopes') x) k)>5000 then
    raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  -- Source locks close status/entry changes during import and composition save.
  perform 1 from public.vocab_datasets where id in(select (x->'source'->>'datasetId')::uuid from jsonb_array_elements(b->'scopes') x) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id in(select (x->'source'->>'datasetId')::uuid from jsonb_array_elements(b->'scopes') x) order by dataset_id for share;
  for s in select value from jsonb_array_elements(b->'scopes') loop
    if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>6 or not(s ?& array['key','name','sourceTitle','source','classification','rows'])
      or jsonb_typeof(s->'source')<>'object' or (select count(*) from jsonb_object_keys(s->'source'))<>7
      or not(s->'source' ?& array['datasetId','unitId','kind','releaseId','releaseVersion','fileHash','locator'])
      or jsonb_typeof(s->'name')<>'string' or jsonb_typeof(s->'key')<>'string' or jsonb_typeof(s->'sourceTitle')<>'string' then
      raise exception 'invalid_library_scope_shape' using errcode='22023'; end if;
    src:=s->'source'; kind:=src->>'kind'; rid:=(src->>'releaseId')::uuid; uid:=(src->>'unitId')::uuid;
    if exists(select 1 from jsonb_each(src) q where q.key<>'releaseId' and jsonb_typeof(q.value)<>'string') or
      (jsonb_typeof(src->'releaseId') not in ('string','null')) then raise exception 'invalid_library_source_shape' using errcode='22023'; end if;
    select * into d from public.vocab_datasets where id=(src->>'datasetId')::uuid;
    if not found or d.status<>'ready' or not d.is_active or d.metadata ? 'compositionVersion'
      or not private.vocabulary_library_catalog_available_v1(d.id,kind)
      or not exists(select 1 from public.vocab_units u where u.id=uid and u.dataset_id=d.id) then
      raise exception 'library_source_unavailable' using errcode='22023'; end if;
    actual_version:=null; source_active:=false;
    if kind='exam_use' and rid is not null then
      select lower(package_version),status='active' and exam_use_import_allowed and not common_dictionary_release_allowed
        into actual_version,source_active from word_index.app_exam_use_release where release_id=rid and dataset_id=d.id for share;
    elsif kind='reviewed_exam' and rid is not null then
      select content_sha256,status='active' into actual_version,source_active from private.reviewed_exam_releases where release_id=rid and dataset_id=d.id for share;
    elsif kind='legacy_vocab' and rid is null and not exists(select 1 from word_index.app_exam_use_release where dataset_id=d.id)
      and not exists(select 1 from private.reviewed_exam_releases where dataset_id=d.id) then
      actual_version:=lower(d.source_sha256); source_active:=true;
    end if;
    if source_active is distinct from true or actual_version is distinct from src->>'releaseVersion' then
      raise exception 'library_source_version_changed' using errcode='40001'; end if;
    perform private.validate_vocabulary_library_classification_v1(s->'classification');
    if length(trim(coalesce(s->>'name',''))) not between 1 and 240 or length(trim(coalesce(s->>'sourceTitle',''))) not between 1 and 240
      or length(trim(coalesce(s->>'key',''))) not between 1 and 200 or src->>'fileHash' !~ '^[a-f0-9]{64}$'
      or length(trim(coalesce(src->>'locator',''))) not between 1 and 240
      or jsonb_typeof(s->'rows') is distinct from 'array' or jsonb_array_length(s->'rows') not between 1 and 20000
      or (select count(distinct x->>'sourceRow') from jsonb_array_elements(s->'rows') x)<>jsonb_array_length(s->'rows') then
      raise exception 'invalid_library_scope' using errcode='22023'; end if;
    rows_doc:='[]'; public_rows:='[]';
    for rr in select value from jsonb_array_elements(s->'rows') order by (value->>'sourceRow')::integer loop
      if jsonb_typeof(rr)<>'object' or (select count(*) from jsonb_object_keys(rr))<>3 or not(rr ?& array['sourceRow','rowHash','resources'])
        or jsonb_typeof(rr->'sourceRow')<>'number' or rr->>'sourceRow' !~ '^[0-9]+$' or (rr->>'sourceRow')::integer<1
        or jsonb_typeof(rr->'resources')<>'object' or (select count(*) from jsonb_object_keys(rr->'resources'))<>3
        or not(rr->'resources' ?& array['entryHash','linkRecordHash','selected']) then raise exception 'invalid_library_row_shape' using errcode='22023'; end if;
      e:=null; o:=null; re:=null; eid:=null; occurrence:=null; rh:=null; state:='included';
      if kind='exam_use' then
        select * into o from word_index.app_exam_use_occurrence where release_id=rid and source_row=(rr->>'sourceRow')::integer and unit_id=uid for share;
        if not found then raise exception 'library_source_row_missing' using errcode='40001'; end if;
        eid:=o.vocab_entry_id; occurrence:=to_jsonb(o);
        state:=case when o.include_in_exam then 'included' when o.exam_use_status='excluded' then 'excluded' else 'held' end;
        rh:=lower(o.occurrence_content_hash);
      elsif kind='reviewed_exam' then
        select * into re from private.reviewed_exam_entries where release_id=rid and source_row=(rr->>'sourceRow')::integer for share;
        if not found then raise exception 'library_source_row_missing' using errcode='40001'; end if;
        eid:=re.vocab_entry_id; occurrence:=to_jsonb(re);
      else
        select id into eid from public.vocab_entries where dataset_id=d.id and source_row=(rr->>'sourceRow')::integer and unit_id=uid;
      end if;
      if state='included' then
        select * into e from public.vocab_entries where id=eid and dataset_id=d.id and unit_id=uid for share;
        if not found then raise exception 'library_entry_mismatch' using errcode='40001'; end if;
        rh:=lower(e.row_sha256);
        if rr->'resources'->>'entryHash' is distinct from rh then raise exception 'library_resource_entry_mismatch' using errcode='40001'; end if;
      elsif rr->'resources'->'entryHash' is distinct from 'null'::jsonb then
        raise exception 'library_nonincluded_resource_entry' using errcode='22023';
      end if;
      if rh is distinct from rr->>'rowHash' or jsonb_typeof(rr->'resources') is distinct from 'object'
        or coalesce(rr->'resources'->>'linkRecordHash','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(rr->'resources'->'selected') is distinct from 'object' then
        raise exception 'library_row_or_reference_changed' using errcode='40001'; end if;
      key:=private.reviewed_exam_sha256_v1(jsonb_build_array(kind,d.id,rid,actual_version,src->>'fileHash',(rr->>'sourceRow')::integer));
      row_doc:=jsonb_build_object('key',key,'sourceRow',(rr->>'sourceRow')::integer,'sourceEntryId',eid,'rowHash',rh,'state',state,'headword',e.headword,'meaning',e.primary_meaning);
      public_rows:=public_rows||jsonb_build_array(row_doc);
      rows_doc:=rows_doc||jsonb_build_array(row_doc||jsonb_build_object('entry',case when eid is not null then to_jsonb(e) end,'occurrence',occurrence,'resources',rr->'resources'));
    end loop;
    ver:=private.reviewed_exam_sha256_v1(jsonb_build_object('key',s->'key','source',src,'classification',s->'classification','rows',rows_doc,'references',proof));
    select id into sid from private.vocabulary_library_scopes where scope_key=s->>'key' and version=ver;
    if sid is null then
      insert into private.vocabulary_library_scopes(scope_key,version,dataset_id,unit_id,source_kind,source_release_id,source_version,source_file_sha256,payload,review_references,import_file_sha256)
        values(s->>'key',ver,d.id,uid,kind,rid,actual_version,src->>'fileHash',
          jsonb_build_object('name',s->'name','sourceTitle',s->'sourceTitle','source',src,'classification',s->'classification','occurrences',public_rows),proof,file_hash)
        on conflict(scope_key,version) do nothing returning id into sid;
      if sid is null then
        select id into sid from private.vocabulary_library_scopes where scope_key=s->>'key' and version=ver;
      else
        insert into private.vocabulary_library_scope_rows(scope_id,occurrence_key,source_row,source_entry_id,row_sha256,state,entry_snapshot,occurrence_snapshot,resources)
          select sid,x->>'key',(x->>'sourceRow')::integer,(x->>'sourceEntryId')::bigint,x->>'rowHash',x->>'state',nullif(x->'entry','null'),nullif(x->'occurrence','null'),x->'resources'
          from jsonb_array_elements(rows_doc) x;
      end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('key',s->'key','id',sid,'version',ver));
  end loop;
  return jsonb_build_object('scopes',result);
end;
$$;



