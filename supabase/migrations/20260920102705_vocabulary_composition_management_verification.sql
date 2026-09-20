create table private.vocabulary_composition_management_approvals (
  project_ref text not null check(project_ref ~ '^[a-z]{20}$'),
  approval_id text not null check(length(trim(approval_id)) between 1 and 200),
  version_id uuid not null references private.vocabulary_library_versions(id),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  purpose text not null default 'preview_verification' check(purpose='preview_verification'),
  approved_at timestamptz not null default clock_timestamp(),
  primary key(project_ref,approval_id,version_id),
  unique(project_ref,approval_id,version_id,content_sha256)
);
create table private.vocabulary_composition_management_requests (
  id uuid primary key,
  project_ref text not null,
  approval_id text not null,
  version_id uuid not null unique references private.vocabulary_library_versions(id),
  content_sha256 text not null,
  executed_by name not null check(executed_by='postgres'),
  session_role name not null check(session_role='postgres'),
  executed_at timestamptz not null default clock_timestamp(),
  unique(id,version_id),
  foreign key(project_ref,approval_id,version_id,content_sha256)
    references private.vocabulary_composition_management_approvals(project_ref,approval_id,version_id,content_sha256)
);
create table private.vocabulary_composition_management_inputs (
  request_id uuid primary key references private.vocabulary_composition_management_requests(id),
  file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
  byte_count integer not null check(byte_count between 2 and 100000000),
  question_count integer not null check(question_count between 0 and 40000),
  recorded_at timestamptz not null default clock_timestamp(),
  unique(request_id,file_sha256)
);
create table private.vocabulary_composition_management_chunks (
  request_id uuid not null references private.vocabulary_composition_management_inputs(request_id),
  chunk_index integer not null check(chunk_index between 1 and 200),
  chunk_count integer not null check(chunk_count between 1 and 200 and chunk_index<=chunk_count),
  payload text not null check(octet_length(payload) between 1 and 500000),
  primary key(request_id,chunk_index)
);
create table private.vocabulary_composition_management_results (
  request_id uuid primary key,
  file_sha256 text not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  completed_at timestamptz not null default clock_timestamp(),
  foreign key(request_id,file_sha256) references private.vocabulary_composition_management_inputs(request_id,file_sha256)
);
do $$
declare name text;
begin
  foreach name in array array['approvals','requests','inputs','chunks','results'] loop
    execute format('alter table private.vocabulary_composition_management_%I enable row level security',name);
    execute format('revoke all on private.vocabulary_composition_management_%I from public,anon,authenticated,service_role',name);
    if name<>'chunks' then
      execute format('create trigger composition_management_%I before update or delete on private.vocabulary_composition_management_%I for each row execute function private.reject_mock_wordbook_history_change()',name,name);
    end if;
  end loop;
end;
$$;
alter table private.vocabulary_compositions
  alter column created_by drop not null,
  add column management_request_id uuid unique references private.vocabulary_composition_management_requests(id),
  add constraint vocabulary_composition_author check((created_by is null)<>(management_request_id is null)),
  add constraint vocabulary_composition_management_version foreign key(management_request_id,version_id)
    references private.vocabulary_composition_management_requests(id,version_id);
create function private.preserve_vocabulary_composition_author_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if new.created_by is distinct from old.created_by or new.management_request_id is distinct from old.management_request_id
    or new.version_id is distinct from old.version_id or new.dataset_id is distinct from old.dataset_id
    or new.content_sha256 is distinct from old.content_sha256 or new.created_at is distinct from old.created_at then
    raise exception 'composition_author_immutable' using errcode='42501'; end if;
  return new;
end;
$$;
create trigger vocabulary_composition_author_immutable before update on private.vocabulary_compositions
  for each row execute function private.preserve_vocabulary_composition_author_v1();

create function private.vocabulary_composition_response_v1(p_version_id uuid,p_summary_only boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not p_summary_only then return private.vocabulary_composition_preparation_v1(p_version_id); end if;
  return (select jsonb_build_object('versionId',c.version_id,'datasetId',c.dataset_id,'contentHash',c.content_sha256,'state',c.state,
    'entryCount',(select count(*) from private.vocabulary_composition_entries where version_id=c.version_id),
    'questionCount',(select count(*) from private.vocabulary_composition_items where version_id=c.version_id))
    from private.vocabulary_compositions c where c.version_id=p_version_id);
end;
$$;

create function private.prepare_vocabulary_composition_core_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  v private.vocabulary_library_versions; t private.vocabulary_library_templates; fixed jsonb; row_doc jsonb; rows_by_key jsonb;
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
  fixed:=private.resolve_vocabulary_library_recipe_v1(v.recipe);
  if fixed is distinct from v.fixed_composition then raise exception 'composition_source_changed' using errcode='40001'; end if;
  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;
  select jsonb_object_agg(value->>'key',value) into rows_by_key from jsonb_array_elements(fixed->'occurrences');
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,p_actor_id,jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));
  for row_key in select value from jsonb_array_elements_text(fixed->'includedKeys') loop
    row_doc:=rows_by_key->row_key;
    scope_ids:=array(select value::uuid from jsonb_array_elements_text(fixed->'rowScopes'->row_key));
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
    update public.vocab_units set entry_count=position_no where id=unit_value;
  end loop;
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

create function private.finalize_vocabulary_composition_core_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb,p_summary_only boolean)
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
  if private.resolve_vocabulary_library_recipe_v1(v.recipe) is distinct from v.fixed_composition then raise exception 'composition_source_changed' using errcode='40001'; end if;
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



create or replace function public.prepare_vocabulary_composition_v1(p_version_id uuid,p_content_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  return private.prepare_vocabulary_composition_core_v1(p_version_id,p_content_sha256,auth.uid(),null);
end;
$$;
create or replace function public.finalize_vocabulary_composition_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if exists(select 1 from private.vocabulary_compositions where version_id=p_version_id and management_request_id is not null) then
    raise exception 'composition_management_completion_required' using errcode='42501'; end if;
  return private.finalize_vocabulary_composition_core_v1(p_version_id,p_content_sha256,p_questions,false);
end;
$$;

create function private.prepare_vocabulary_composition_management_v1(p_project_ref text,p_approval_id text,p_request_id uuid,p_version_id uuid,p_content_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare old_request private.vocabulary_composition_management_requests;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  if not exists(select 1 from private.vocabulary_composition_management_approvals a
    where a.project_ref=p_project_ref and a.approval_id=p_approval_id and a.version_id=p_version_id and a.content_sha256=p_content_sha256) then
    raise exception 'composition_management_not_approved' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition-management:'||p_project_ref||':'||p_approval_id,0));
  if (select count(*) from private.vocabulary_composition_management_approvals where project_ref=p_project_ref and approval_id=p_approval_id)>5 then
    raise exception 'composition_management_capacity' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
  select * into old_request from private.vocabulary_composition_management_requests where id=p_request_id;
  if found and (old_request.project_ref is distinct from p_project_ref or old_request.approval_id is distinct from p_approval_id
    or old_request.version_id is distinct from p_version_id or old_request.content_sha256 is distinct from p_content_sha256) then
    raise exception 'library_request_reused' using errcode='40001'; end if;
  if exists(select 1 from private.vocabulary_compositions where version_id=p_version_id and management_request_id is distinct from p_request_id) then
    raise exception 'composition_management_owner_changed' using errcode='40001'; end if;
  if not exists(select 1 from private.vocabulary_library_import_approvals where target_project_ref=p_project_ref) or exists(
    select 1 from private.vocabulary_library_versions v cross join lateral jsonb_array_elements(v.recipe->'scopes') x
    join private.vocabulary_library_scopes s on s.id=(x->>'id')::uuid where v.id=p_version_id and not exists(
      select 1 from private.vocabulary_library_import_approvals a where a.target_project_ref=p_project_ref and a.file_sha256=s.import_file_sha256)) then
    raise exception 'management_scope_project_mismatch' using errcode='42501'; end if;
  insert into private.vocabulary_composition_management_requests(id,project_ref,approval_id,version_id,content_sha256,executed_by,session_role)
    values(p_request_id,p_project_ref,p_approval_id,p_version_id,p_content_sha256,current_user,session_user) on conflict(id) do nothing;
  return private.prepare_vocabulary_composition_core_v1(p_version_id,p_content_sha256,null,p_request_id);
end;
$$;

create function private.stage_vocabulary_composition_questions_v1(p_request_id uuid,p_index integer,p_count integer,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare existing private.vocabulary_composition_management_chunks;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition-questions:'||p_request_id::text,0));
  if exists(select 1 from private.vocabulary_composition_management_results where request_id=p_request_id) then
    raise exception 'composition_questions_already_finished' using errcode='40001'; end if;
  insert into private.vocabulary_composition_management_chunks(request_id,chunk_index,chunk_count,payload)
    values(p_request_id,p_index,p_count,p_text) on conflict do nothing;
  select * into existing from private.vocabulary_composition_management_chunks where request_id=p_request_id and chunk_index=p_index;
  if existing.chunk_count is distinct from p_count or existing.payload is distinct from p_text then
    raise exception 'composition_question_chunk_changed' using errcode='40001'; end if;
end;
$$;
create function private.finish_vocabulary_composition_management_v1(p_request_id uuid,p_file_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare request private.vocabulary_composition_management_requests; input private.vocabulary_composition_management_inputs;
  composition private.vocabulary_compositions;
  raw_text text; questions jsonb; actual_count integer; expected_min integer; expected_max integer; result jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition-questions:'||p_request_id::text,0));
  select * into request from private.vocabulary_composition_management_requests where id=p_request_id;
  select * into input from private.vocabulary_composition_management_inputs where request_id=p_request_id;
  if request.id is null or input.file_sha256 is distinct from p_file_sha256 then raise exception 'composition_management_input_changed' using errcode='40001'; end if;
  select r.result into result from private.vocabulary_composition_management_results r where r.request_id=p_request_id;
  if found then return result; end if;
  select * into composition from private.vocabulary_compositions where version_id=request.version_id for update;
  if not found or composition.management_request_id is distinct from p_request_id then
    raise exception 'composition_management_owner_changed' using errcode='40001'; end if;
  if composition.state<>'preparing' then raise exception 'composition_management_unrecorded_completion' using errcode='40001'; end if;
  select string_agg(payload,'' order by chunk_index),count(*)::integer,min(chunk_count),max(chunk_count)
    into raw_text,actual_count,expected_min,expected_max from private.vocabulary_composition_management_chunks where request_id=p_request_id;
  if actual_count=0 or actual_count<>expected_min or expected_min<>expected_max then raise exception 'composition_questions_incomplete' using errcode='22023'; end if;
  if octet_length(raw_text)<>input.byte_count or encode(extensions.digest(convert_to(raw_text,'UTF8'),'sha256'),'hex') is distinct from input.file_sha256 then
    raise exception 'composition_questions_hash_mismatch' using errcode='40001'; end if;
  questions:=raw_text::jsonb;
  if jsonb_typeof(questions) is distinct from 'array' or jsonb_array_length(questions)<>input.question_count then
    raise exception 'composition_questions_count_mismatch' using errcode='22023'; end if;
  result:=private.finalize_vocabulary_composition_core_v1(request.version_id,request.content_sha256,questions,true);
  insert into private.vocabulary_composition_management_results(request_id,file_sha256,result) values(p_request_id,p_file_sha256,result);
  delete from private.vocabulary_composition_management_chunks where request_id=p_request_id;
  return result;
end;
$$;

revoke all on function private.preserve_vocabulary_composition_author_v1(),private.vocabulary_composition_response_v1(uuid,boolean),
  private.prepare_vocabulary_composition_core_v1(uuid,text,uuid,uuid),private.finalize_vocabulary_composition_core_v1(uuid,text,jsonb,boolean),
  private.prepare_vocabulary_composition_management_v1(text,text,uuid,uuid,text),private.stage_vocabulary_composition_questions_v1(uuid,integer,integer,text),
  private.finish_vocabulary_composition_management_v1(uuid,text) from public,anon,authenticated,service_role;
