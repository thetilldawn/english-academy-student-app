-- APP-20261008-01: retain historical receipts; never create another dictionary.
create or replace function public.create_mock_wordbook_composition_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request_id uuid; request_hash text; scope_count integer;
  prior word_index.mock_wordbook_composition;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request->'scopes') is distinct from 'array'
    or jsonb_array_length(p_request->'scopes') not between 1 and 500
    or length(trim(coalesce(p_request->>'title',''))) not between 1 and 100
    or (select count(*) from jsonb_object_keys(p_request)) <> 3 then
    raise exception 'invalid_composition_request' using errcode='22023'; end if;
  request_id := (p_request->>'requestId')::uuid;
  if request_id is null then raise exception 'invalid_composition_request' using errcode='22023'; end if;
  scope_count := jsonb_array_length(p_request->'scopes');
  if (select count(distinct value->>'id') from jsonb_array_elements(p_request->'scopes')) <> scope_count
    or exists(select 1 from jsonb_array_elements(p_request->'scopes') x where jsonb_typeof(x) <> 'object'
      or coalesce(x->>'version','') !~ '^[a-f0-9]{64}$' or (select count(*) from jsonb_object_keys(x)) <> 2) then
    raise exception 'invalid_composition_scopes' using errcode='22023'; end if;
  request_hash := encode(extensions.digest((p_request-'requestId')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||request_id::text,0));
  select * into prior from word_index.mock_wordbook_composition
    where created_by=auth.uid() and mock_wordbook_composition.request_id=(p_request->>'requestId')::uuid;
  if found then
    if prior.request_hash <> request_hash then raise exception 'composition_request_conflict' using errcode='40001'; end if;
    return prior.result;
  end if;
  raise exception 'legacy_composition_creation_retired' using errcode='PT410';
end;
$$;

comment on function public.create_mock_wordbook_composition_v1(jsonb) is
  'Historical matching receipt lookup only. New body-copying composition requests are retired.';

-- No new dictionary or body table. Only new source-key selections use this
-- representation; existing inline rows and their JSON/hash remain untouched.
-- Value and binding belong to the same source reference. Validate it once.
create or replace function private.vocabulary_composition_resource_v1(p_resources jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare resolved jsonb; v jsonb; b jsonb;
begin
  if p_resources#>>'{selected,schemaVersion}'='vocabulary-source-key-v3' then
    resolved:=private.resolve_vocabulary_source_key_v3(p_resources->'selected');
    v:=resolved->'value'; b:=resolved->'binding';
  elsif p_resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    v:=private.resolve_vocabulary_learning_value_v1(p_resources->'selected');
    b:=private.resolve_vocabulary_learning_binding_v1(p_resources);
  else
    return private.vocabulary_composition_inline_resource_v1(p_resources);
  end if;
  return (v->'selectedFields')||jsonb_build_object('schemaVersion','vocabulary-resource-selected-v2','dictionary',b->'selectedDictionary','senseId',b->'selectedSenseId','proofs',b->'proofs');
end;
$$;

create function private.vocabulary_composition_match_key_v1(p_value text,p_role text)
returns text language sql immutable strict set search_path='' as $$
  select lower(case when p_role='headword' then replace(normalize(btrim(p_value),NFKC),'*','') else normalize(btrim(p_value),NFKC) end);
$$;

-- Text-only JSON conversion is deterministic; keep scope lookups indexed.
create function private.vocabulary_composition_match_hash_v1(p_value text)
returns text language sql immutable strict set search_path='' as $$
  select private.reviewed_exam_sha256_v1(to_jsonb(p_value));
$$;

create function private.vocabulary_composition_item_document_v1(i private.vocabulary_composition_items)
returns jsonb language sql immutable set search_path='' as $$
  select case when i.source_kind='generated_meaning' then
    jsonb_build_object('vocabEntryId',i.vocab_entry_id,'direction',i.direction,'prompt',i.prompt,'choices',to_jsonb(i.choice_texts),
      'choiceVocabEntryIds',to_jsonb(i.choice_vocab_entry_ids),'correctChoiceIndex',i.correct_choice_index,'versionId',i.version_id,
      'proof',i.source_proof,'pronunciation',i.pronunciation_snapshot)
    else jsonb_build_object('target',i.vocab_entry_id,'mode',i.quiz_mode,'direction',i.direction,'prompt',i.prompt,'choices',i.choice_texts,
      'choiceIds',i.choice_vocab_entry_ids,'correctIndex',i.correct_choice_index,'proof',i.source_proof,'pronunciation',i.pronunciation_snapshot) end;
$$;

create function private.resolve_vocabulary_composition_item_v1(i private.vocabulary_composition_items)
returns private.vocabulary_composition_items language plpgsql stable set search_path='' as $$
declare result private.vocabulary_composition_items:=i; target private.vocabulary_composition_entries;
  old_item private.reviewed_exam_items; ref jsonb; value_doc jsonb; target_value jsonb;
  texts text[]:='{}'; pronunciations jsonb:='[]'; n integer; ref_entry bigint;
begin
  if not(i.source_proof ? 'bodyRef') then return i; end if;
  if i.source_proof#>>'{bodyRef,format}' is distinct from 'source-key-body-v1'
    or jsonb_typeof(i.source_proof#>'{bodyRef,choiceRefs}') is distinct from 'array'
    or jsonb_array_length(i.source_proof#>'{bodyRef,choiceRefs}')<>4 then
    raise exception 'composition_body_reference_invalid' using errcode='55000'; end if;
  select * into target from private.vocabulary_composition_entries where version_id=i.version_id and vocab_entry_id=i.vocab_entry_id;
  if target.vocab_entry_id is null or target.source_entry_id<>i.vocab_entry_id
    or target.resources is distinct from i.source_proof->'resources' then
    raise exception 'composition_body_target_mismatch' using errcode='55000'; end if;
  target_value:=private.resolve_vocabulary_source_key_v3(target.resources->'selected');
  if i.source_kind='reviewed_item' then
    select * into old_item from private.reviewed_exam_items where release_id=i.source_release_id and item_id=i.source_item_id and item_sha256=i.source_item_sha256;
    if old_item.item_id is null or old_item.vocab_entry_id<>i.vocab_entry_id or old_item.choice_vocab_entry_ids is distinct from i.choice_vocab_entry_ids
      or old_item.correct_choice_index<>i.correct_choice_index or old_item.quiz_mode<>i.quiz_mode or old_item.direction<>i.direction
      or old_item.prompt_role<>i.prompt_role or old_item.choice_role<>i.choice_role then
      raise exception 'composition_body_reviewed_mismatch' using errcode='55000'; end if;
    result.prompt:=old_item.prompt; texts:=old_item.choice_texts;
  else
    result.prompt:=case i.direction when 'english_to_korean' then target_value#>>'{value,entryValues,headword}' else target_value#>>'{value,entryValues,primary_meaning}' end;
  end if;
  for n in 0..3 loop
    ref:=i.source_proof#>array['bodyRef','choiceRefs',n::text];
    value_doc:=private.resolve_vocabulary_source_key_v3(ref);
    select source_entry_id into ref_entry from private.vocabulary_library_scope_rows where scope_id=(ref->>'scopeId')::uuid and occurrence_key=ref->>'occurrenceKey';
    if ref_entry is distinct from i.choice_vocab_entry_ids[n+1] then raise exception 'composition_body_choice_mismatch' using errcode='55000'; end if;
    if i.source_kind='generated_meaning' then
      texts:=array_append(texts,case i.direction when 'english_to_korean' then value_doc#>>'{value,entryValues,primary_meaning}' else value_doc#>>'{value,entryValues,headword}' end);
    end if;
    pronunciations:=pronunciations||jsonb_build_array(value_doc#>'{value,selectedFields,pronunciation}');
  end loop;
  result.choice_texts:=texts;
  result.pronunciation_snapshot:=jsonb_build_object('target',target_value#>'{value,selectedFields,pronunciation}','choices',pronunciations);
  result.prompt_key:=private.vocabulary_composition_match_key_v1(result.prompt,result.prompt_role);
  result.answer_key:=private.vocabulary_composition_match_key_v1(texts[i.correct_choice_index+1],result.choice_role);
  if result.prompt is null or cardinality(texts)<>4 or array_position(texts,null) is not null
    or private.reviewed_exam_sha256_v1(to_jsonb(result.prompt_key)) is distinct from i.source_proof#>>'{bodyRef,promptKeyHash}'
    or private.reviewed_exam_sha256_v1(to_jsonb(result.answer_key)) is distinct from i.source_proof#>>'{bodyRef,answerKeyHash}'
    or private.reviewed_exam_sha256_v1(private.vocabulary_composition_item_document_v1(result)) is distinct from i.item_sha256
    or i.item_id is distinct from i.item_sha256 then
    raise exception 'composition_body_reference_changed' using errcode='55000'; end if;
  return result;
end;
$$;

create function private.vocabulary_composition_choice_ref_v1(p_scope_id uuid,p_entry_id bigint)
returns jsonb language plpgsql stable set search_path='' as $$
declare wanted private.vocabulary_library_scopes; variants integer; answer jsonb;
begin
  select * into wanted from private.vocabulary_library_scopes where id=p_scope_id;
  select count(distinct private.vocabulary_selection_comparison_v2(r.entry_snapshot,r.resources)),
    (jsonb_agg(jsonb_build_object('schemaVersion','vocabulary-source-key-v3','scopeId',r.scope_id,'occurrenceKey',r.occurrence_key,
      'entryHash',r.row_sha256,'valueHash',private.reviewed_exam_sha256_v1(v.value->'value'),'bindingHash',private.reviewed_exam_sha256_v1(v.value->'binding'))
      order by r.scope_id,r.occurrence_key)->0) into variants,answer
  from private.vocabulary_library_scope_rows r join private.vocabulary_library_scopes s on s.id=r.scope_id
  cross join lateral (select private.vocabulary_source_key_values_v3(r.scope_id,r.occurrence_key) value offset 0) v
  where r.source_entry_id=p_entry_id and r.state='included' and s.source_kind=wanted.source_kind
    and s.source_release_id is not distinct from wanted.source_release_id and s.source_version=wanted.source_version
    and s.review_references=wanted.review_references
    and r.row_sha256=(select lower(row_sha256) from public.vocab_entries where id=p_entry_id);
  if variants is distinct from 1 or answer is null then raise exception 'composition_choice_resources_missing_or_conflicting' using errcode='22023'; end if;
  return answer;
end;
$$;

create function private.compact_new_vocabulary_composition_item_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare target private.vocabulary_composition_entries; choice private.vocabulary_composition_entries;
  refs jsonb:='[]'; ref jsonb; choice_id bigint; resolved private.vocabulary_composition_items;
  original_prompt text:=new.prompt; original_texts text[]:=new.choice_texts; original_pronunciation jsonb:=new.pronunciation_snapshot;
begin
  if not exists(select 1 from private.vocabulary_composition_storage_formats where version_id=new.version_id and format='source-keys-v3') then return new; end if;
  if new.prompt is null or new.choice_texts is null or new.pronunciation_snapshot is null or new.source_proof ? 'bodyRef' then
    raise exception 'composition_new_body_invalid' using errcode='23514'; end if;
  select * into target from private.vocabulary_composition_entries where version_id=new.version_id and vocab_entry_id=new.vocab_entry_id;
  if target.vocab_entry_id is null or target.resources#>>'{selected,schemaVersion}' is distinct from 'vocabulary-source-key-v3' then
    raise exception 'composition_body_target_mismatch' using errcode='23514'; end if;
  foreach choice_id in array new.choice_vocab_entry_ids loop
    if new.source_kind='reviewed_item' then
      ref:=private.vocabulary_composition_choice_ref_v1(target.source_scope_ids[1],choice_id);
    else
      select * into choice from private.vocabulary_composition_entries where version_id=new.version_id and vocab_entry_id=choice_id;
      if choice.vocab_entry_id is null then raise exception 'composition_body_choice_mismatch' using errcode='23514'; end if;
      ref:=choice.resources->'selected';
    end if;
    refs:=refs||jsonb_build_array(ref);
  end loop;
  new.source_proof:=new.source_proof||jsonb_build_object('bodyRef',jsonb_build_object('format','source-key-body-v1','choiceRefs',refs,
    'promptKeyHash',private.reviewed_exam_sha256_v1(to_jsonb(private.vocabulary_composition_match_key_v1(new.prompt,new.prompt_role))),
    'answerKeyHash',private.reviewed_exam_sha256_v1(to_jsonb(private.vocabulary_composition_match_key_v1(new.choice_texts[new.correct_choice_index+1],new.choice_role)))));
  new.item_sha256:=private.reviewed_exam_sha256_v1(private.vocabulary_composition_item_document_v1(new)); new.item_id:=new.item_sha256;
  new.prompt:=null; new.choice_texts:=null; new.pronunciation_snapshot:=null;
  -- Generated items have just been checked by the batch writer against these
  -- same entries/resources. Reviewed choices may live outside this selection.
  if new.source_kind='reviewed_item' then
    resolved:=private.resolve_vocabulary_composition_item_v1(new);
    if resolved.prompt is distinct from original_prompt or resolved.choice_texts is distinct from original_texts
      or resolved.pronunciation_snapshot is distinct from original_pronunciation then
      raise exception 'composition_body_reference_mismatch' using errcode='23514'; end if;
  end if;
  return new;
end;
$$;

alter table private.vocabulary_composition_items alter column prompt drop not null;
alter table private.vocabulary_composition_items alter column choice_texts drop not null;
alter table private.vocabulary_composition_items alter column pronunciation_snapshot drop not null;
alter table private.vocabulary_composition_items add constraint composition_body_storage_shape check(
  (prompt is not null and choice_texts is not null and pronunciation_snapshot is not null and not(source_proof ? 'bodyRef'))
  or (prompt is null and choice_texts is null and pronunciation_snapshot is null and coalesce(source_proof#>>'{bodyRef,format}'='source-key-body-v1',false)));
create trigger zz_compact_composition_body before insert on private.vocabulary_composition_items
  for each row execute function private.compact_new_vocabulary_composition_item_v1();

revoke all on function private.vocabulary_composition_match_key_v1(text,text),
  private.vocabulary_composition_match_hash_v1(text),
  private.vocabulary_composition_item_document_v1(private.vocabulary_composition_items),
  private.resolve_vocabulary_composition_item_v1(private.vocabulary_composition_items),
  private.vocabulary_composition_choice_ref_v1(uuid,bigint),private.compact_new_vocabulary_composition_item_v1()
  from public,anon,authenticated,service_role;

create function private.compact_vocabulary_composition_plan_v1(p_version_id uuid,p_questions jsonb)
returns jsonb language sql stable set search_path='' as $$
  select case when exists(select 1 from private.vocabulary_composition_storage_formats where version_id=p_version_id and format='source-keys-v3')
    then coalesce((select jsonb_agg(q-array['prompt','choices'] order by n) from jsonb_array_elements(p_questions) with ordinality x(q,n)),'[]'::jsonb)
    else p_questions end;
$$;

create function private.expand_vocabulary_composition_plan_question_v1(p_version_id uuid,q jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare e private.vocabulary_composition_entries; source public.vocab_entries; prompt_value text; choice_id bigint; texts text[]:='{}';
begin
  if q ? 'prompt' and q ? 'choices' then return q; end if;
  if jsonb_typeof(q) is distinct from 'object' or not(q ?& array['vocabEntryId','direction','choiceVocabEntryIds','correctChoiceIndex'])
    or (select count(*) from jsonb_object_keys(q))<>4 or coalesce(q->>'direction','') not in('english_to_korean','korean_to_english')
    or jsonb_typeof(q->'choiceVocabEntryIds') is distinct from 'array' or jsonb_array_length(q->'choiceVocabEntryIds')<>4 then
    raise exception 'composition_key_plan_invalid' using errcode='55000'; end if;
  select * into e from private.vocabulary_composition_entries where version_id=p_version_id and vocab_entry_id=(q->>'vocabEntryId')::bigint;
  if e.vocab_entry_id is null or e.source_kind='reviewed_exam' then raise exception 'composition_key_plan_target_invalid' using errcode='55000'; end if;
  select * into source from public.vocab_entries where id=e.source_entry_id and lower(row_sha256)=e.entry_sha256;
  if source.id is null then raise exception 'composition_key_plan_source_missing' using errcode='55000'; end if;
  prompt_value:=case q->>'direction' when 'english_to_korean' then source.headword else source.primary_meaning end;
  for choice_id in select value::bigint from jsonb_array_elements_text(q->'choiceVocabEntryIds') loop
    select * into e from private.vocabulary_composition_entries where version_id=p_version_id and vocab_entry_id=choice_id;
    if e.vocab_entry_id is null or e.source_kind='reviewed_exam' then raise exception 'composition_key_plan_choice_invalid' using errcode='55000'; end if;
    select * into source from public.vocab_entries where id=e.source_entry_id and lower(row_sha256)=e.entry_sha256;
    if source.id is null then raise exception 'composition_key_plan_source_missing' using errcode='55000'; end if;
    texts:=array_append(texts,case q->>'direction' when 'english_to_korean' then source.primary_meaning else source.headword end);
  end loop;
  if prompt_value is null or array_position(texts,null) is not null then raise exception 'composition_key_plan_source_missing' using errcode='55000'; end if;
  return q||jsonb_build_object('prompt',prompt_value,'choices',texts);
end;
$$;
revoke all on function private.compact_vocabulary_composition_plan_v1(uuid,jsonb),
  private.expand_vocabulary_composition_plan_question_v1(uuid,jsonb) from public,anon,authenticated,service_role;

-- Project lookup keys directly so version/item filters use the original indexes.
-- OFFSET prevents expanding the body resolver once per selected body field.
do $$ declare projection text; begin
  select string_agg(case when attname=any(array['prompt','choice_texts','pronunciation_snapshot','prompt_key','answer_key'])
    then format('(resolved.item).%I as %I',attname,attname) else format('i.%I',attname) end,',' order by attnum)
    into projection from pg_attribute where attrelid='private.vocabulary_composition_items'::regclass and attnum>0 and not attisdropped;
  execute 'create view private.vocabulary_composition_item_contents_v1 with (security_invoker=true) as select '||projection||
    ' from private.vocabulary_composition_items i cross join lateral (select private.resolve_vocabulary_composition_item_v1(i) item offset 0) resolved';
end $$;
revoke all on private.vocabulary_composition_item_contents_v1 from public,anon,authenticated,service_role;

-- Preserve all existing authorization, locks, source checks and function ACLs.
do $$ declare definition text; anchor text; begin
  definition:=pg_get_functiondef('private.vocabulary_question_bank_body_v1(jsonb)'::regprocedure);
  definition:=replace(definition,'result jsonb; count_sources integer;','result jsonb; count_sources integer; target_value jsonb;');
  anchor:='    result:=jsonb_build_object(''prompt'',item.prompt';
  if strpos(definition,anchor)=0 then raise exception 'composition_bank_reader_anchor_changed'; end if;
  definition:=replace(definition,anchor,E'    item:=private.resolve_vocabulary_composition_item_v1(item);\n'||anchor);
  anchor:='  elsif b->>''reviewed_exam_release_id_snapshot'' is not null then';
  if strpos(definition,anchor)=0 then raise exception 'composition_bank_snapshot_anchor_changed'; end if;
  definition:=replace(definition,anchor,$replace$
    if item.source_proof ? 'bodyRef' then
      target_value:=private.resolve_vocabulary_source_key_v3(item.source_proof#>'{resources,selected}');
      result:=result||jsonb_build_object('headword_snapshot',target_value#>>'{value,entryValues,headword}',
        'primary_meaning_snapshot',target_value#>>'{value,entryValues,primary_meaning}',
        'correct_answer_snapshot',item.choice_texts[item.correct_choice_index+1]);
    end if;
$replace$||anchor);
  execute definition;

  definition:=pg_get_functiondef('private.create_composition_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb,boolean)'::regprocedure);
  anchor:='if not found then raise exception ''composition_assignment_snapshot_mismatch'' using errcode=''55000''; end if;';
  if strpos(definition,anchor)=0 then raise exception 'composition_delivery_reader_anchor_changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n    source_item:=private.resolve_vocabulary_composition_item_v1(source_item);');
  anchor:='if exists(select 1 from private.vocabulary_composition_items i join public.assignment_questions q';
  if strpos(definition,anchor)=0 then raise exception 'composition_delivery_check_anchor_changed'; end if;
  definition:=replace(definition,anchor,'if exists(select 1 from private.vocabulary_composition_item_contents_v1 i join public.assignment_questions q');
  execute definition;

  definition:=replace(pg_get_functiondef('private.advance_vocabulary_composition_questions_v1(uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:='private.reviewed_exam_sha256_v1(p_questions),p_questions,jsonb_array_length(p_questions)';
  if strpos(definition,anchor)=0 then raise exception 'composition_plan_storage_anchor_changed'; end if;
  definition:=replace(definition,anchor,'private.reviewed_exam_sha256_v1(p_questions),private.compact_vocabulary_composition_plan_v1(p_version_id,p_questions),jsonb_array_length(p_questions)');
  definition:=replace(definition,'jsonb_agg(value order by ordinality)','jsonb_agg(private.expand_vocabulary_composition_plan_question_v1(p_version_id,value) order by ordinality)');
  -- Move the existing source validation/locks ahead of publication comparison.
  anchor:=E'  select * into v from private.vocabulary_library_versions where id=p_version_id;\n  perform private.assert_vocabulary_library_version_current_v1(v);';
  if strpos(definition,anchor)=0 then raise exception 'composition_source_lock_anchor_changed'; end if;
  definition:=replace(definition,anchor,'');
  definition:=replace(definition,'  perform private.assert_vocabulary_composition_build_complete_v1(p_version_id);',anchor||E'\n  perform private.assert_vocabulary_composition_build_complete_v1(p_version_id);');
  anchor:='perform private.assert_vocabulary_composition_build_complete_v1(p_version_id);';
  if strpos(definition,anchor)=0 then raise exception 'composition_plan_completion_anchor_changed'; end if;
  definition:=replace(definition,anchor,anchor||E'\n  select coalesce(jsonb_agg(private.expand_vocabulary_composition_plan_question_v1(p_version_id,value) order by ordinality),''[]''::jsonb) into batch from jsonb_array_elements(plan.payload) with ordinality;\n  if private.reviewed_exam_sha256_v1(batch) is distinct from plan.plan_sha256 then raise exception ''composition_question_plan_changed'' using errcode=''40001''; end if;');
  anchor:='jsonb_array_elements(plan.payload) q left join private.vocabulary_composition_items i';
  if strpos(definition,anchor)=0 then raise exception 'composition_plan_reader_anchor_changed'; end if;
  definition:=replace(definition,anchor,'jsonb_array_elements(batch) q left join private.vocabulary_composition_items i');
  anchor:='i.prompt is distinct from q->>''prompt'' or to_jsonb(i.choice_texts) is distinct from q->''choices''';
  if strpos(definition,anchor)=0 then raise exception 'composition_plan_body_check_anchor_changed'; end if;
  definition:=replace(definition,anchor,$replace$
    case when i.source_proof ? 'bodyRef' then
      i.source_proof#>>'{bodyRef,promptKeyHash}' is distinct from private.vocabulary_composition_match_hash_v1(private.vocabulary_composition_match_key_v1(q->>'prompt',i.prompt_role))
      or i.source_proof#>>'{bodyRef,answerKeyHash}' is distinct from private.vocabulary_composition_match_hash_v1(private.vocabulary_composition_match_key_v1(q->'choices'->>i.correct_choice_index,i.choice_role))
    else i.prompt is distinct from q->>'prompt' or to_jsonb(i.choice_texts) is distinct from q->'choices' end$replace$);
  execute definition;

  definition:=pg_get_functiondef('private.vocabulary_composition_question_in_scope_v1(uuid,text,uuid[])'::regprocedure);
  anchor:='other.prompt_key=i.prompt_key and other.answer_key<>i.answer_key';
  if strpos(definition,anchor)=0 then raise exception 'composition_scope_comparison_anchor_changed'; end if;
  definition:=replace(definition,anchor,$replace$
    coalesce(other.source_proof#>>'{bodyRef,promptKeyHash}',private.vocabulary_composition_match_hash_v1(other.prompt_key))
      =coalesce(i.source_proof#>>'{bodyRef,promptKeyHash}',private.vocabulary_composition_match_hash_v1(i.prompt_key))
    and coalesce(other.source_proof#>>'{bodyRef,answerKeyHash}',private.vocabulary_composition_match_hash_v1(other.answer_key))
      <>coalesce(i.source_proof#>>'{bodyRef,answerKeyHash}',private.vocabulary_composition_match_hash_v1(i.answer_key))$replace$);
  execute definition;
end $$;

create index vocabulary_composition_reference_prompt_lookup on private.vocabulary_composition_items(
  version_id,quiz_mode,direction,
  (coalesce(source_proof#>>'{bodyRef,promptKeyHash}',private.vocabulary_composition_match_hash_v1(prompt_key))),
  (coalesce(source_proof#>>'{bodyRef,answerKeyHash}',private.vocabulary_composition_match_hash_v1(answer_key))));
