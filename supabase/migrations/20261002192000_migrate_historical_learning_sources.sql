-- APP-20261003-03. Explicit operator batches only; no automatic backfill.
begin;

create table private.historical_learning_migrations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('scope','composition')),
  group_id uuid not null,
  occurrence_key text not null check(occurrence_key ~ '^[a-f0-9]{64}$'),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  compacted_sha256 text not null check(compacted_sha256 ~ '^[a-f0-9]{64}$'),
  original_document_sha256 text check(original_document_sha256 ~ '^[a-f0-9]{64}$'),
  resource_refs jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp(),
  unique(kind,group_id,occurrence_key)
);
create table private.historical_learning_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.historical_learning_write_permits (
  backend_pid integer not null,
  transaction_id bigint not null,
  relation_id oid not null,
  before_sha256 text not null,
  after_sha256 text not null,
  primary key(backend_pid,transaction_id,relation_id,before_sha256)
);
alter table private.historical_learning_migrations enable row level security;
alter table private.historical_learning_receipts enable row level security;
alter table private.historical_learning_write_permits enable row level security;
revoke all on private.historical_learning_migrations,private.historical_learning_receipts,
  private.historical_learning_write_permits from public,anon,authenticated,service_role;
create trigger historical_learning_receipt_immutable before update or delete on private.historical_learning_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

-- Unlike the new-import projector, this pure projector never reads today's
-- dictionary bridge or meaning approvals. Missing historical facts stay absent.
create function private.project_historical_learning_binding_v1(p_entry jsonb,p_occurrence jsonb,p_resources jsonb,p_source jsonb,p_selection_sha256 text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare selected jsonb:=p_resources->'selected'; entry_link jsonb:='null'; result jsonb; ids jsonb; learning jsonb;
  has_entry boolean:=p_entry is not null and p_entry<>'null'::jsonb;
  has_occurrence boolean:=p_occurrence is not null and p_occurrence<>'null'::jsonb;
begin
  perform private.project_vocabulary_learning_value_v1(p_entry,selected);
  if has_entry then
    if not(p_entry ?& array['id','dataset_id','unit_id','source_row','row_sha256','source_ref']) then
      raise exception 'vocabulary_entry_link_missing' using errcode='22023'; end if;
    entry_link:=jsonb_build_object('id',p_entry->>'id','datasetId',p_entry->'dataset_id','unitId',p_entry->'unit_id',
      'sourceRow',p_entry->'source_row','rowHash',p_entry->'row_sha256','sourceRef',p_entry->'source_ref');
  end if;
  ids:=case when p_source->>'kind'='reviewed_exam' then p_occurrence->'payload' when p_source->>'kind'='exam_use' then p_occurrence else null end;
  learning:=jsonb_build_object('kind','source-occurrence-v1',
    'key',private.reviewed_exam_sha256_v1(jsonb_build_array('source-occurrence-v1',p_source->'occurrenceKey',p_source->'version','primary_meaning',
      private.reviewed_exam_sha256_v1(jsonb_build_array(p_entry->'primary_meaning',selected->'lexicalPos')))),
    'senseId',null,'lexicalPos',selected->'lexicalPos','reviewEvidenceHash',null);
  result:=jsonb_build_object('schemaVersion','vocabulary-source-binding-v1','selectionHash',p_selection_sha256,'source',p_source,'entryLink',entry_link,
    'originalHashes',jsonb_build_object('entrySnapshotHash',case when has_entry then private.reviewed_exam_sha256_v1(p_entry) end,
      'occurrenceSnapshotHash',case when has_occurrence then private.reviewed_exam_sha256_v1(p_occurrence) end,
      'selectedSnapshotHash',private.reviewed_exam_sha256_v1(selected),
      'dictionarySnapshotHash',case when selected->'dictionary'<>'null'::jsonb then private.reviewed_exam_sha256_v1(selected->'dictionary') end),
    'selectedDictionary',private.project_vocabulary_dictionary_link_v1(selected->'dictionary'),'selectedSenseId',selected->'senseId',
    'sourceIdentifiers',jsonb_build_object('dictionaryId',ids->'dictionary_id','legacyIds',coalesce(nullif(ids->'legacy_ids','null'::jsonb),'[]'::jsonb),
      'occurrenceId',ids->'occurrence_id','senseId',ids->'sense_id','sourceEntryId',ids->'source_entry_id','sourceEntryHash',ids->'source_entry_sha256',
      'legacyLexemeId',null,'legacyOccurrenceId',null,'legacyMappingStatus',null),
    'proofs',private.project_vocabulary_proofs_v1(selected->'proofs'),'learningIdentity',learning);
  perform private.validate_vocabulary_learning_binding_v1(result);
  return result;
end $$;

do $copy$
declare d text;
begin
  d:=pg_get_functiondef('private.register_vocabulary_learning_resources_v1(jsonb,jsonb,jsonb,jsonb)'::regprocedure);
  if length(d)-length(replace(d,'private.project_vocabulary_learning_binding_v1(',''))<>length('private.project_vocabulary_learning_binding_v1(') then
    raise exception 'historical_learning_registration_anchor_changed'; end if;
  d:=replace(d,'private.register_vocabulary_learning_resources_v1(','private.register_historical_learning_resources_v1(');
  execute replace(d,'private.project_vocabulary_learning_binding_v1(','private.project_historical_learning_binding_v1(');
end $copy$;

create function private.historical_learning_row_v1(p_kind text,p_group uuid,p_key text) returns jsonb
language plpgsql stable set search_path='' as $$
declare result jsonb;
begin
  if p_kind='scope' then select to_jsonb(r) into result from private.vocabulary_library_scope_rows r where scope_id=p_group and occurrence_key=p_key;
  elsif p_kind='composition' then select to_jsonb(r) into result from private.vocabulary_composition_entries r where version_id=p_group and occurrence_key=p_key;
  else raise exception 'historical_learning_kind_invalid' using errcode='22023'; end if;
  if result is null then raise exception 'historical_learning_row_missing' using errcode='P0002'; end if;
  return result;
end $$;

create function private.assert_historical_learning_row_v1(p_kind text,p_group uuid,p_key text) returns void
language plpgsql stable set search_path='' as $$
declare m private.historical_learning_migrations; r jsonb; resources jsonb; binding jsonb;
begin
  select * into m from private.historical_learning_migrations where kind=p_kind and group_id=p_group and occurrence_key=p_key;
  if not found then return; end if;
  r:=private.historical_learning_row_v1(p_kind,p_group,p_key);
  if private.reviewed_exam_sha256_v1(r) is distinct from (case when m.state='compacted' then m.compacted_sha256 else m.original_sha256 end) then
    raise exception 'historical_learning_row_changed' using errcode='40001'; end if;
  if m.state='compacted' then
    resources:=r->'resources'; binding:=private.resolve_vocabulary_learning_binding_v1(resources);
    if jsonb_build_object('selected',resources->'selected','selectionBinding',resources->'selectionBinding') is distinct from m.resource_refs
      or coalesce(r#>>'{entry_snapshot,recordHash}',r#>>'{source_snapshot,entry,recordHash}') is distinct from binding#>>'{originalHashes,entrySnapshotHash}'
      or coalesce(r#>>'{occurrence_snapshot,recordHash}',r#>>'{source_snapshot,occurrence,recordHash}') is distinct from binding#>>'{originalHashes,occurrenceSnapshotHash}' then
      raise exception 'historical_learning_reference_changed' using errcode='40001'; end if;
  end if;
end $$;

-- Keep the logical fingerprint and fixed version unchanged; verify the physical
-- representation through the small migration receipt before expanding it.
do $copy$
begin
  execute replace(pg_get_functiondef('private.vocabulary_library_row_document_v1(uuid,text)'::regprocedure),
    'private.vocabulary_library_row_document_v1(','private.historical_learning_raw_scope_document_v1(');
  execute replace(pg_get_functiondef('private.vocabulary_composition_preparation_v1(uuid)'::regprocedure),
    'private.vocabulary_composition_preparation_v1(','private.historical_learning_preparation_before_v1(');
end $copy$;
create or replace function private.vocabulary_library_row_document_v1(p_scope_id uuid,p_key text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.assert_historical_learning_row_v1('scope',p_scope_id,p_key);
  return private.historical_learning_raw_scope_document_v1(p_scope_id,p_key);
end $$;
create or replace function private.vocabulary_composition_preparation_v1(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare m record;
begin
  for m in select occurrence_key from private.historical_learning_migrations where kind='composition' and group_id=p_version_id loop
    perform private.assert_historical_learning_row_v1('composition',p_version_id,m.occurrence_key);
  end loop;
  return private.historical_learning_preparation_before_v1(p_version_id);
end $$;

create function private.assert_historical_learning_scopes_v1(p_recipe jsonb) returns void
language plpgsql stable set search_path='' as $$
declare m record;
begin
  for m in select h.group_id,h.occurrence_key from private.historical_learning_migrations h
    where h.kind='scope' and h.group_id in(select (x->>'id')::uuid from jsonb_array_elements(p_recipe->'scopes') x) loop
    perform private.assert_historical_learning_row_v1('scope',m.group_id,m.occurrence_key);
    if not exists(select 1 from private.vocabulary_library_row_fingerprints f join private.historical_learning_migrations h
      on h.kind='scope' and h.group_id=f.scope_id and h.occurrence_key=f.occurrence_key
      where f.scope_id=m.group_id and f.occurrence_key=m.occurrence_key and f.document_sha256=h.original_document_sha256) then
      raise exception 'historical_learning_fingerprint_changed' using errcode='40001'; end if;
  end loop;
end $$;

do $patch$
declare d text; anchor text; signature text;
begin
  foreach signature in array array['private.resolve_vocabulary_library_recipe_compact_v1(jsonb)','private.assert_vocabulary_library_version_current_v1(private.vocabulary_library_versions)'] loop
    d:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    anchor:=E'begin\n';
    if strpos(d,anchor)=0 then raise exception 'historical_learning_reader_anchor_changed'; end if;
    execute overlay(d placing anchor||'  perform private.assert_historical_learning_scopes_v1('||
      case when signature like '%recipe_compact%' then 'r' else 'v.recipe' end||E');\n' from strpos(d,anchor) for length(anchor));
  end loop;
  d:=pg_get_functiondef('private.assignment_vocabulary_meaning_v1(uuid,integer)'::regprocedure);
  anchor:='    source_entry:=c.source_entry_id; source_kind:=c.source_kind; source_release:=c.source_release_id;';
  if length(d)-length(replace(d,anchor,''))<>length(anchor) then raise exception 'historical_learning_meaning_anchor_changed'; end if;
  execute replace(d,anchor,$new$
    perform private.assert_historical_learning_row_v1('composition',c.version_id,c.occurrence_key);
    -- Preserve the historical M03 branch, including its selected dictionary
    -- precedence. Do not adopt the later v2/current-review identity recipe.
    if exists(select 1 from private.historical_learning_migrations where kind='composition' and group_id=c.version_id
        and occurrence_key=c.occurrence_key and state='compacted') then
      c.resources:=jsonb_set(c.resources,'{selected}',private.vocabulary_composition_resource_v1(c.resources));
    end if;
    source_entry:=c.source_entry_id; source_kind:=c.source_kind; source_release:=c.source_release_id;$new$);
end $patch$;

-- A later, newly requested composition must retain its existing creation
-- policy. A raw old scope used to consult current reviewed identity/bridge at
-- that point. Recreate ONLY that new binding; never promote the migrated scope
-- or an already completed composition to today's identity.
create function private.historical_learning_resources_for_new_composition_v1(p_scope_id uuid,p_key text,p_resources jsonb,p_source jsonb)
returns jsonb language plpgsql volatile set search_path='' as $$
declare b jsonb; value_doc jsonb; entry_doc jsonb; selected_doc jsonb; bridge word_index.vocab_entry_link;
  bh text; stored private.vocabulary_learning_value_bindings;
begin
  perform private.assert_historical_learning_row_v1('scope',p_scope_id,p_key);
  b:=private.resolve_vocabulary_learning_binding_v1(p_resources);
  if b->'source' is distinct from p_source then raise exception 'vocabulary_source_content_mismatch' using errcode='40001'; end if;
  value_doc:=private.resolve_vocabulary_learning_value_v1(p_resources->'selected');
  selected_doc:=private.vocabulary_composition_resource_v1(p_resources);
  entry_doc:=case when b->'entryLink'='null'::jsonb then null else (value_doc->'entryValues')||jsonb_build_object(
    'id',b#>'{entryLink,id}','dataset_id',b#>'{entryLink,datasetId}','unit_id',b#>'{entryLink,unitId}',
    'source_row',b#>'{entryLink,sourceRow}','row_sha256',b#>'{entryLink,rowHash}','source_ref',b#>'{entryLink,sourceRef}') end;
  if entry_doc is not null then
    select * into bridge from word_index.vocab_entry_link where vocab_entry_id=(entry_doc->>'id')::bigint;
    if found and (bridge.dataset_id::text is distinct from entry_doc->>'dataset_id' or bridge.entry_row_sha256 is distinct from entry_doc->>'row_sha256') then
      raise exception 'vocabulary_legacy_link_mismatch' using errcode='40001'; end if;
  end if;
  b:=jsonb_set(b,'{sourceIdentifiers}',(b->'sourceIdentifiers')||jsonb_build_object('legacyLexemeId',bridge.lexeme_id,
    'legacyOccurrenceId',bridge.occurrence_id,'legacyMappingStatus',bridge.mapping_status));
  b:=jsonb_set(b,'{learningIdentity}',private.vocabulary_learning_identity_v1(entry_doc,p_source,selected_doc));
  perform private.validate_vocabulary_learning_binding_v1(b);
  bh:=private.reviewed_exam_sha256_v1(b);
  insert into private.vocabulary_learning_value_bindings(binding_sha256,selection_id,selection_sha256,payload)
    values(bh,(p_resources#>>'{selected,selectionId}')::uuid,p_resources#>>'{selected,selectionHash}',b) on conflict(binding_sha256) do nothing;
  select * into stored from private.vocabulary_learning_value_bindings where binding_sha256=bh;
  if not found or stored.payload is distinct from b or stored.selection_id is distinct from (p_resources#>>'{selected,selectionId}')::uuid then
    raise exception 'vocabulary_binding_conflict' using errcode='40001'; end if;
  return jsonb_set(p_resources,'{selectionBinding}',jsonb_build_object('schemaVersion','vocabulary-source-binding-ref-v1','bindingId',stored.binding_id,'bindingHash',bh));
end $$;
do $patch$
declare d text; anchor text;
begin
  d:=pg_get_functiondef('private.vocabulary_composition_row_document_v2(uuid,text,uuid[])'::regprocedure);
  anchor:='  saved_resources:=private.register_vocabulary_learning_resources_v1(r.entry_snapshot,r.occurrence_snapshot,r.resources,source_doc);';
  if length(d)-length(replace(d,anchor,''))<>length(anchor) then raise exception 'historical_learning_new_composition_anchor_changed'; end if;
  execute replace(d,anchor,$new$
  if exists(select 1 from private.historical_learning_migrations where kind='scope' and group_id=p_scope_id and occurrence_key=p_key and state='compacted') then
    saved_resources:=private.historical_learning_resources_for_new_composition_v1(p_scope_id,p_key,r.resources,source_doc);
  else
    saved_resources:=private.register_vocabulary_learning_resources_v1(r.entry_snapshot,r.occurrence_snapshot,r.resources,source_doc);
  end if;$new$);
end $patch$;

create function private.lock_historical_learning_batch_v1(p_kind text,p_group uuid,p_keys text[],p_compact boolean) returns void
language plpgsql set search_path='' as $$
declare versions uuid[]; datasets uuid[]; assignment_ids uuid[]; c private.vocabulary_compositions;
  expected integer; qplan private.vocabulary_composition_question_plans;
begin
  if current_user<>'postgres' then raise exception 'historical_learning_operator_required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed'
    or (select setting::integer from pg_settings where name='statement_timeout') not between 1 and 30000
    or (select setting::integer from pg_settings where name='lock_timeout') not between 1 and 1000 then
    raise exception 'historical_learning_transaction_limits_required' using errcode='22023'; end if;
  if p_kind is null or p_kind not in('scope','composition') or p_group is null or cardinality(p_keys) not between 1 and 100
    or p_keys is null or exists(select 1 from unnest(p_keys) k where k is null or k !~ '^[a-f0-9]{64}$')
    or cardinality(p_keys)<>(select count(distinct k) from unnest(p_keys) k) then
    raise exception 'historical_learning_batch_invalid' using errcode='22023'; end if;
  -- Fail immediately when normal work holds any conflicting lock. No student
  -- locks or waits in the opposite order of app creation/start paths.
  lock table private.vocabulary_library_versions in share row exclusive mode nowait;
  lock table private.vocabulary_compositions in share row exclusive mode nowait;
  lock table private.vocabulary_composition_entries in share row exclusive mode nowait;
  lock table private.vocabulary_library_scope_rows in share row exclusive mode nowait;
  if p_kind='scope' then
    select coalesce(array_agg(distinct id),'{}') into versions from (
      select v.id from private.vocabulary_library_versions v where exists(select 1 from jsonb_array_elements(v.recipe->'scopes') x where (x->>'id')::uuid=p_group)
      union select version_id from private.vocabulary_composition_build_positions where p_group=any(scope_ids)
      union select version_id from private.vocabulary_composition_entries where p_group=any(source_scope_ids)
    ) related;
    select array[dataset_id] into datasets from private.vocabulary_library_scopes where id=p_group;
  else
    versions:=array[p_group];
    select coalesce(array_agg(distinct s.dataset_id),'{}') into datasets from private.vocabulary_composition_entries e
      join private.vocabulary_library_scopes s on s.id=any(e.source_scope_ids) where e.version_id=p_group;
  end if;
  select coalesce(array_agg(distinct id),'{}') into datasets from (
    select unnest(datasets) id union select dataset_id from private.vocabulary_compositions where version_id=any(versions)
  ) d;
  perform 1 from public.vocab_datasets where id=any(datasets) order by id for update nowait;
  perform 1 from public.vocab_dataset_catalog where dataset_id=any(datasets) order by dataset_id for update nowait;
  perform 1 from private.vocabulary_compositions where version_id=any(versions) order by version_id for update nowait;
  -- Include original-dataset/direct assignments and stored composition links.
  select coalesce(array_agg(id order by id),'{}') into assignment_ids from public.assignments a where a.dataset_id=any(datasets)
    or exists(select 1 from public.assignment_sources x where x.assignment_id=a.id and x.dataset_id=any(datasets))
    or exists(select 1 from public.assignment_questions q where q.assignment_id=a.id and
      (q.dataset_id=any(datasets) or q.composition_version_id_snapshot=any(versions) or q.vocab_entry_id in
        (select source_entry_id from private.vocabulary_library_scope_rows where p_kind='scope' and scope_id=p_group and occurrence_key=any(p_keys))));
  perform 1 from public.assignments where id=any(assignment_ids) order by id for update nowait;
  if p_kind='scope' then perform 1 from private.vocabulary_library_scope_rows where scope_id=p_group and occurrence_key=any(p_keys) order by occurrence_key for update nowait;
  else perform 1 from private.vocabulary_composition_entries where version_id=p_group and occurrence_key=any(p_keys) order by occurrence_key for update nowait; end if;
  -- Fresh READ COMMITTED statements after all relevant parents are locked.
  for c in select * from private.vocabulary_compositions where version_id=any(versions) loop
    if c.state<>'ready' or c.question_sha256 is null then raise exception 'historical_learning_build_pending' using errcode='55000'; end if;
    if exists(select 1 from private.vocabulary_composition_builds where version_id=c.version_id and
        (not preparation_complete or next_row<>total_count+1)) then raise exception 'historical_learning_build_pending' using errcode='55000'; end if;
    perform private.assert_vocabulary_composition_build_complete_v1(c.version_id);
    select jsonb_array_length(fixed_composition->'includedKeys') into expected from private.vocabulary_library_versions where id=c.version_id;
    if expected is null or expected<>(select count(*) from private.vocabulary_composition_entries where version_id=c.version_id)
      or expected<>(select count(*) from public.vocab_entries where dataset_id=c.dataset_id)
      or c.question_sha256 is distinct from (select private.reviewed_exam_sha256_v1(coalesce(jsonb_agg(item_sha256 order by item_id),'[]'))
        from private.vocabulary_composition_items where version_id=c.version_id) then
      raise exception 'historical_learning_build_incomplete' using errcode='40001'; end if;
    select * into qplan from private.vocabulary_composition_question_plans where version_id=c.version_id;
    if found and (qplan.processed_count<>qplan.total_count or qplan.total_count<>(select count(*) from private.vocabulary_composition_items
      where version_id=c.version_id and source_kind='generated_meaning')) then raise exception 'historical_learning_plan_pending' using errcode='55000'; end if;
  end loop;
  if p_kind='composition' and not exists(select 1 from private.vocabulary_compositions where version_id=p_group) then
    raise exception 'historical_learning_row_missing' using errcode='P0002'; end if;
  if not p_compact then return; end if;
  if exists(select 1 from public.assignments where id=any(assignment_ids) and not coalesce(status='closed' or deleted_at is not null
      or (isfinite(available_until) and available_until<clock_timestamp()),false))
    or exists(select 1 from public.quiz_attempts where assignment_id=any(assignment_ids) and (status='in_progress' or completed_at is null or phase in('review','retry')))
    or exists(select 1 from private.quiz_attempt_preparations where assignment_id=any(assignment_ids) and begun_id is null)
    or exists(select 1 from private.local_quiz_runs r join public.quiz_attempts a on a.id=r.attempt_id where a.assignment_id=any(assignment_ids))
    or exists(select 1 from private.local_quiz_preparations l join private.quiz_attempt_preparations p on p.id=l.preparation_id where p.assignment_id=any(assignment_ids)) then
    raise exception 'historical_learning_student_work_pending' using errcode='55000'; end if;
end $$;

create function private.historical_learning_compacted_row_v1(p_kind text,p_before jsonb,p_refs jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare result jsonb:=p_before; d jsonb; resources jsonb:=(p_before->'resources')||p_refs;
begin
  if p_kind='scope' then
    return result||jsonb_build_object('entry_snapshot',private.compact_vocabulary_source_snapshot_v1(p_before->'entry_snapshot','entry'),
      'occurrence_snapshot',private.compact_vocabulary_source_snapshot_v1(p_before->'occurrence_snapshot','occurrence'),'resources',resources);
  elsif p_kind='composition' then
    d:=p_before->'source_snapshot';
    if d->'resources' is distinct from p_before->'resources' then raise exception 'historical_learning_resources_mismatch' using errcode='40001'; end if;
    d:=d||jsonb_build_object('entry',private.compact_vocabulary_source_snapshot_v1(d->'entry','entry'),
      'occurrence',private.compact_vocabulary_source_snapshot_v1(d->'occurrence','occurrence'),'resources',resources);
    return result||jsonb_build_object('source_snapshot',d,'resources',resources);
  end if;
  raise exception 'historical_learning_kind_invalid' using errcode='22023';
end $$;

create function private.prepare_historical_learning_batch_v1(p_kind text,p_group uuid,p_keys text[]) returns jsonb
language plpgsql set search_path='' as $$
declare k text; r jsonb; e jsonb; o jsonb; resources jsonb; refs jsonb; source_doc jsonb; after_doc jsonb; source_scope uuid;
  s private.vocabulary_library_scopes; m private.historical_learning_migrations; h text; doc_h text; result jsonb:='[]';
begin
  perform private.lock_historical_learning_batch_v1(p_kind,p_group,p_keys,true);
  for k in select x from unnest(p_keys) x order by x loop
    r:=private.historical_learning_row_v1(p_kind,p_group,k);
    if r#>>'{resources,selected,schemaVersion}' is distinct from 'vocabulary-resource-snapshot-v1' then
      raise exception 'historical_learning_inline_required' using errcode='22023'; end if;
    if p_kind='scope' then source_scope:=p_group; e:=r->'entry_snapshot'; o:=r->'occurrence_snapshot';
    else source_scope:=(r#>>'{source_scope_ids,0}')::uuid; e:=r#>'{source_snapshot,entry}'; o:=r#>'{source_snapshot,occurrence}'; end if;
    select * into s from private.vocabulary_library_scopes where id=source_scope;
    if not found then raise exception 'historical_learning_source_missing' using errcode='40001'; end if;
    source_doc:=jsonb_build_object('kind',s.source_kind,'datasetId',s.dataset_id,'unitId',s.unit_id,'releaseId',s.source_release_id,
      'version',s.source_version,'fileHash',s.source_file_sha256,'locator',s.payload#>'{source,locator}',
      'sourceRow',case when p_kind='scope' then r->'source_row' else r#>'{source_snapshot,sourceRow}' end,
      'occurrenceKey',k,'state',case when p_kind='scope' then r->'state' else r#>'{source_snapshot,state}' end);
    resources:=private.register_historical_learning_resources_v1(e,o,r->'resources',source_doc);
    refs:=jsonb_build_object('selected',resources->'selected','selectionBinding',resources->'selectionBinding');
    -- Fresh statement after registration, before an immutable row is touched.
    perform private.resolve_vocabulary_learning_binding_v1(resources);
    after_doc:=private.historical_learning_compacted_row_v1(p_kind,r,refs); h:=private.reviewed_exam_sha256_v1(r); doc_h:=null;
    if p_kind='scope' then
      doc_h:=private.reviewed_exam_sha256_v1(private.historical_learning_raw_scope_document_v1(p_group,k));
      insert into private.vocabulary_library_row_fingerprints(scope_id,occurrence_key,document_sha256) values(p_group,k,doc_h) on conflict do nothing;
      if not exists(select 1 from private.vocabulary_library_row_fingerprints where scope_id=p_group and occurrence_key=k and document_sha256=doc_h) then
        raise exception 'historical_learning_fingerprint_changed' using errcode='40001'; end if;
    end if;
    insert into private.historical_learning_migrations(kind,group_id,occurrence_key,original_sha256,compacted_sha256,original_document_sha256,resource_refs)
      values(p_kind,p_group,k,h,private.reviewed_exam_sha256_v1(after_doc),doc_h,refs) on conflict(kind,group_id,occurrence_key) do nothing;
    select * into m from private.historical_learning_migrations where kind=p_kind and group_id=p_group and occurrence_key=k;
    if m.original_sha256 is distinct from h or m.compacted_sha256 is distinct from private.reviewed_exam_sha256_v1(after_doc)
      or m.resource_refs is distinct from refs then raise exception 'historical_learning_preparation_changed' using errcode='40001'; end if;
    result:=result||jsonb_build_array(jsonb_build_object('id',m.id,'beforeText',r::text));
  end loop;
  if octet_length(result::text)>4194304 then raise exception 'historical_learning_batch_too_large' using errcode='22023'; end if;
  return result;
end $$;

create function private.guard_historical_learning_write_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    delete from private.historical_learning_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and relation_id=tg_relid and before_sha256=private.reviewed_exam_sha256_v1(to_jsonb(old))
      and after_sha256=private.reviewed_exam_sha256_v1(to_jsonb(new));
    if found then return new; end if;
  end if;
  raise exception 'mock_wordbook_history_is_immutable' using errcode='22023';
end $$;
drop trigger vocabulary_library_rows_immutable on private.vocabulary_library_scope_rows;
create trigger vocabulary_library_rows_immutable before update or delete on private.vocabulary_library_scope_rows
  for each row execute function private.guard_historical_learning_write_v1();
drop trigger vocabulary_composition_entries_immutable on private.vocabulary_composition_entries;
create trigger vocabulary_composition_entries_immutable before update or delete on private.vocabulary_composition_entries
  for each row execute function private.guard_historical_learning_write_v1();

create function private.apply_historical_learning_batch_v1(p_request_id uuid,p_action text,p_archive_sha256 text,p_rows jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare request_hash text; receipt private.historical_learning_receipts; m private.historical_learning_migrations;
  first_row private.historical_learning_migrations; packet jsonb; before_doc jsonb; current_doc jsonb; next_doc jsonb;
  keys text[]; meanings_before jsonb; meanings_after jsonb; result jsonb; changed integer:=0; key_column text;
  relation_name text; relation_id oid;
begin
  if current_user<>'postgres' then raise exception 'historical_learning_operator_required' using errcode='42501'; end if;
  if p_request_id is null or p_action is null or p_action not in('compact','restore') or p_archive_sha256 is null or p_archive_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_rows) is distinct from 'array' or jsonb_array_length(p_rows) not between 1 and 100 or octet_length(p_rows::text)>4194304 then
    raise exception 'historical_learning_batch_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) x where jsonb_typeof(x) is distinct from 'object'
    or not(x ?& array['id','beforeText']) or x-array['id','beforeText']<>'{}'::jsonb or jsonb_typeof(x->'beforeText') is distinct from 'string')
    or (select count(distinct (x->>'id')::uuid) from jsonb_array_elements(p_rows) x)<>jsonb_array_length(p_rows) then
    raise exception 'historical_learning_batch_invalid' using errcode='22023'; end if;
  request_hash:=private.reviewed_exam_sha256_v1(jsonb_build_array(p_action,p_archive_sha256,p_rows));
  select * into receipt from private.historical_learning_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'historical_learning_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  select * into first_row from private.historical_learning_migrations where id=(p_rows#>>'{0,id}')::uuid;
  if not found then raise exception 'historical_learning_preparation_missing' using errcode='P0002'; end if;
  select array_agg(h.occurrence_key order by h.occurrence_key) into keys from private.historical_learning_migrations h
    where h.id in(select (x->>'id')::uuid from jsonb_array_elements(p_rows) x) and h.kind=first_row.kind and h.group_id=first_row.group_id;
  if cardinality(keys) is distinct from jsonb_array_length(p_rows) then raise exception 'historical_learning_batch_mixed' using errcode='22023'; end if;
  perform private.lock_historical_learning_batch_v1(first_row.kind,first_row.group_id,keys,p_action='compact');
  select * into receipt from private.historical_learning_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'historical_learning_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  for packet in select x from jsonb_array_elements(p_rows) x order by (x->>'id')::uuid loop
    select * into m from private.historical_learning_migrations where id=(packet->>'id')::uuid for update nowait;
    before_doc:=(packet->>'beforeText')::jsonb;
    if private.reviewed_exam_sha256_v1(before_doc) is distinct from m.original_sha256 then
      raise exception 'historical_learning_archive_changed' using errcode='40001'; end if;
    current_doc:=private.historical_learning_row_v1(m.kind,m.group_id,m.occurrence_key);
    perform private.assert_historical_learning_row_v1(m.kind,m.group_id,m.occurrence_key);
    next_doc:=private.historical_learning_compacted_row_v1(m.kind,before_doc,m.resource_refs);
    if private.reviewed_exam_sha256_v1(next_doc) is distinct from m.compacted_sha256 then raise exception 'historical_learning_reference_changed' using errcode='40001'; end if;
    if p_action='restore' then next_doc:=before_doc; end if;
    if current_doc=next_doc then continue; end if;
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'meaning',private.assignment_vocabulary_meaning_v1(q.id)) order by q.id),'[]') into meanings_before
      from public.assignment_questions q where q.vocab_entry_id=(current_doc->>'vocab_entry_id')::bigint and q.composition_version_id_snapshot=m.group_id;
    if m.kind='scope' then relation_name:='private.vocabulary_library_scope_rows'; key_column:='scope_id';
    else relation_name:='private.vocabulary_composition_entries'; key_column:='version_id'; end if;
    relation_id:=relation_name::regclass;
    insert into private.historical_learning_write_permits values(pg_backend_pid(),txid_current(),relation_id,
      private.reviewed_exam_sha256_v1(current_doc),private.reviewed_exam_sha256_v1(next_doc));
    if m.kind='scope' then
      update private.vocabulary_library_scope_rows set entry_snapshot=nullif(next_doc->'entry_snapshot','null'::jsonb),
        occurrence_snapshot=nullif(next_doc->'occurrence_snapshot','null'::jsonb),resources=next_doc->'resources' where scope_id=m.group_id and occurrence_key=m.occurrence_key;
    else
      update private.vocabulary_composition_entries set source_snapshot=next_doc->'source_snapshot',resources=next_doc->'resources'
        where version_id=m.group_id and occurrence_key=m.occurrence_key;
    end if;
    if exists(select 1 from private.historical_learning_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()) then
      raise exception 'historical_learning_permit_not_consumed' using errcode='55000'; end if;
    update private.historical_learning_migrations set state=case when p_action='compact' then 'compacted' else 'restored' end where id=m.id;
    perform private.assert_historical_learning_row_v1(m.kind,m.group_id,m.occurrence_key);
    select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'meaning',private.assignment_vocabulary_meaning_v1(q.id)) order by q.id),'[]') into meanings_after
      from public.assignment_questions q where q.vocab_entry_id=(current_doc->>'vocab_entry_id')::bigint and q.composition_version_id_snapshot=m.group_id;
    if meanings_before is distinct from meanings_after then raise exception 'historical_learning_meaning_changed' using errcode='40001'; end if;
    changed:=changed+1;
  end loop;
  result:=jsonb_build_object('requestId',p_request_id,'action',p_action,'rows',jsonb_array_length(p_rows),'changed',changed,'archiveHash',p_archive_sha256);
  insert into private.historical_learning_receipts(request_id,request_sha256,archive_sha256,result) values(p_request_id,request_hash,p_archive_sha256,result);
  return result;
end $$;

-- Private operators and support helpers have no app-role execution grant.
do $acl$
declare r record;
begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and (p.proname like '%historical_learning%' or p.proname in
      ('vocabulary_library_row_document_v1','vocabulary_composition_preparation_v1')) loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
  end loop;
end $acl$;
commit;
