begin;

-- A composition has its own proof. It never impersonates a dictionary or a
-- reviewed source release. Source entries and all historical exams stay fixed.
create table private.vocabulary_compositions (
  version_id uuid primary key references private.vocabulary_library_versions(id),
  dataset_id uuid not null unique references public.vocab_datasets(id),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check(state in ('preparing','ready')),
  question_sha256 text check(question_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check((state='ready')=(question_sha256 is not null))
);
create table private.vocabulary_composition_entries (
  version_id uuid not null references private.vocabulary_library_versions(id),
  dataset_id uuid not null references public.vocab_datasets(id),
  vocab_entry_id bigint primary key references public.vocab_entries(id),
  unit_id uuid not null references public.vocab_units(id),
  occurrence_key text not null check(occurrence_key ~ '^[a-f0-9]{64}$'),
  source_entry_id bigint not null references public.vocab_entries(id),
  source_scope_ids uuid[] not null check(cardinality(source_scope_ids)>0),
  source_kind text not null check(source_kind in ('legacy_vocab','exam_use','reviewed_exam')),
  source_release_id uuid,
  entry_sha256 text not null check(entry_sha256 ~ '^[a-f0-9]{64}$'),
  identity_key text not null check(identity_key ~ '^[a-f0-9]{64}$'),
  source_snapshot jsonb not null,
  resources jsonb not null,
  eligible_directions text[] not null,
  eligibility_snapshot jsonb not null,
  unique(version_id,occurrence_key),unique(version_id,vocab_entry_id),
  foreign key(vocab_entry_id,dataset_id) references public.vocab_entries(id,dataset_id)
);
create table private.vocabulary_composition_items (
  version_id uuid not null references private.vocabulary_library_versions(id),
  dataset_id uuid not null references public.vocab_datasets(id),
  vocab_entry_id bigint not null references private.vocabulary_composition_entries(vocab_entry_id),
  item_id text not null,
  item_sha256 text not null check(item_sha256 ~ '^[a-f0-9]{64}$'),
  quiz_mode text not null check(quiz_mode in ('book_meaning_choice','canonical_definition_to_headword','canonical_headword_to_definition')),
  direction public.question_direction not null,
  source_kind text not null check(source_kind in ('generated_meaning','reviewed_item')),
  source_release_id uuid references private.reviewed_exam_releases(release_id),
  source_item_id text,
  source_item_sha256 text,
  prompt_role text not null,
  choice_role text not null,
  prompt text not null check(length(trim(prompt))>0),
  choice_texts text[] not null check(cardinality(choice_texts)=4 and array_position(choice_texts,null) is null),
  choice_vocab_entry_ids bigint[] not null check(cardinality(choice_vocab_entry_ids)=4 and array_position(choice_vocab_entry_ids,null) is null),
  correct_choice_index smallint not null check(correct_choice_index between 0 and 3),
  pronunciation_snapshot jsonb not null,
  source_proof jsonb not null,
  prompt_key text generated always as (lower(case when prompt_role='headword' then replace(normalize(btrim(prompt),NFKC),'*','') else normalize(btrim(prompt),NFKC) end)) stored,
  answer_key text generated always as (lower(case when choice_role='headword' then replace(normalize(btrim(choice_texts[correct_choice_index+1]),NFKC),'*','') else normalize(btrim(choice_texts[correct_choice_index+1]),NFKC) end)) stored,
  primary key(version_id,item_id),unique(version_id,item_id,item_sha256),
  unique(version_id,vocab_entry_id,quiz_mode,direction),
  foreign key(version_id,vocab_entry_id) references private.vocabulary_composition_entries(version_id,vocab_entry_id),
  foreign key(source_release_id,source_item_id,source_item_sha256) references private.reviewed_exam_items(release_id,item_id,item_sha256),
  check(choice_vocab_entry_ids[correct_choice_index+1]=vocab_entry_id and cardinality(array_positions(choice_vocab_entry_ids,vocab_entry_id))=1),
  check((source_kind='generated_meaning' and source_release_id is null and source_item_id is null and source_item_sha256 is null and quiz_mode='book_meaning_choice')
    or (source_kind='reviewed_item' and source_release_id is not null and source_item_id is not null and source_item_sha256 is not null))
);
create index vocabulary_composition_prompt_lookup on private.vocabulary_composition_items(version_id,quiz_mode,direction,prompt_key,answer_key);
create index vocabulary_composition_entries_source on private.vocabulary_composition_entries(version_id,source_entry_id);
alter table private.vocabulary_compositions enable row level security;
alter table private.vocabulary_composition_entries enable row level security;
alter table private.vocabulary_composition_items enable row level security;
revoke all on private.vocabulary_compositions,private.vocabulary_composition_entries,private.vocabulary_composition_items from public,anon,authenticated,service_role;
create trigger vocabulary_composition_entries_immutable before update or delete on private.vocabulary_composition_entries
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger vocabulary_composition_items_immutable before update or delete on private.vocabulary_composition_items
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.vocabulary_composition_resource_v1(p_resources jsonb)
returns jsonb language plpgsql immutable set search_path='' as $$
declare r jsonb; p jsonb;
begin
  r:=p_resources->'selected'; p:=r->'pronunciation';
  if r->>'schemaVersion' is distinct from 'vocabulary-resource-snapshot-v1'
    or jsonb_typeof(r->'proofs') is distinct from 'object'
    or jsonb_typeof(p) is distinct from 'object'
    or jsonb_typeof(p->'available') is distinct from 'boolean'
    or not(p ?& array['displayKo','variantId','audioUrl','available'])
    or jsonb_typeof(p->'displayKo') not in ('string','null')
    or jsonb_typeof(p->'variantId') not in ('string','null')
    or jsonb_typeof(p->'audioUrl') not in ('string','null')
    or (p->>'available')::boolean is distinct from (p->>'audioUrl' is not null)
  then raise exception 'composition_resources_unverified' using errcode='22023'; end if;
  return r;
end;
$$;

-- Resolve an outside choice only within the exact reviewed input set used for
-- this occurrence; never choose an arbitrary current pronunciation by spelling.
create function private.vocabulary_composition_choice_resource_v1(p_scope_id uuid,p_entry_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare wanted private.vocabulary_library_scopes; answer jsonb; variants integer;
begin
  select * into wanted from private.vocabulary_library_scopes where id=p_scope_id;
  select count(distinct r.resources->'selected'),(jsonb_agg(r.resources->'selected')->0) into variants,answer
    from private.vocabulary_library_scope_rows r join private.vocabulary_library_scopes s on s.id=r.scope_id
    where r.source_entry_id=p_entry_id and r.state='included' and s.source_kind=wanted.source_kind
      and s.source_release_id is not distinct from wanted.source_release_id
      and s.source_version=wanted.source_version and s.review_references=wanted.review_references
      and r.row_sha256=(select lower(row_sha256) from public.vocab_entries where id=p_entry_id);
  if variants<>1 then raise exception 'composition_choice_resources_missing_or_conflicting' using errcode='22023'; end if;
  return private.vocabulary_composition_resource_v1(jsonb_build_object('selected',answer));
end;
$$;

create function private.vocabulary_composition_preparation_v1(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('versionId',c.version_id,'datasetId',c.dataset_id,'contentHash',c.content_sha256,'state',c.state,
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'unitId',e.unit_id,'sourceRow',e.source_row,
      'headword',e.headword,'primaryMeaning',e.primary_meaning,'sourceKind',l.source_kind,'sourceEntryId',l.source_entry_id,
      'eligibleDirections',l.eligible_directions,'compositionTargetKey',l.identity_key,'resources',l.resources->'selected') order by e.source_row)
      from private.vocabulary_composition_entries l join public.vocab_entries e on e.id=l.vocab_entry_id where l.version_id=c.version_id),'[]'::jsonb))
  from private.vocabulary_compositions c where c.version_id=p_version_id;
$$;

create function private.vocabulary_source_eligibility_v1(p_kind text,p_release_id uuid,p_entry_id bigint,p_dataset_id uuid,p_row_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare proof jsonb; directions text[];
begin
  if p_kind='legacy_vocab' then
    select coalesce(jsonb_agg(to_jsonb(q) order by q.quiz_mode),'[]'::jsonb),
      coalesce(array_agg(case q.quiz_mode when 'book_meaning_en_to_ko' then 'english_to_korean' else 'korean_to_english' end order by q.quiz_mode) filter(where
        q.input_content_hash=upper(p_row_hash) and (q.status='eligible' or (q.status='review_required' and cardinality(q.reason_codes)>0 and q.reason_codes <@ array['DUPLICATE_HEADWORD_DIFFERENT_MEANING','DUPLICATE_PRIMARY_MEANING_DIFFERENT_HEADWORD']))),'{}') into proof,directions
      from public.vocab_entry_quiz_eligibility q where q.vocab_entry_id=p_entry_id and q.dataset_id=p_dataset_id and q.quiz_mode in('book_meaning_en_to_ko','book_meaning_ko_to_en');
  elsif p_kind='exam_use' then
    select jsonb_build_object('releaseId',r.release_id,'packageVersion',r.package_version,'occurrenceHash',o.occurrence_content_hash),array['english_to_korean','korean_to_english'] into proof,directions
      from word_index.app_exam_use_release r join word_index.app_exam_use_occurrence o on o.release_id=r.release_id and o.dataset_id=r.dataset_id
      where r.release_id=p_release_id and r.dataset_id=p_dataset_id and r.status='active' and r.target_environment='preview' and r.exam_use_import_allowed and not r.common_dictionary_release_allowed
        and o.vocab_entry_id=p_entry_id and o.include_in_exam and o.exam_use_status='reviewed_for_preview';
  else proof:='[]'; directions:='{}'; end if;
  return jsonb_build_object('proof',coalesce(proof,'[]'::jsonb),'directions',coalesce(directions,'{}'));
end;
$$;

create function public.prepare_vocabulary_composition_v1(p_version_id uuid,p_content_sha256 text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v private.vocabulary_library_versions; t private.vocabulary_library_templates; fixed jsonb; row_doc jsonb; rows_by_key jsonb;
  c private.vocabulary_compositions; s private.vocabulary_library_scopes; e public.vocab_entries;
  dataset_value uuid:=extensions.gen_random_uuid(); unit_value uuid; entry_value bigint;
  scope_ids uuid[]; row_key text; membership jsonb; block_key jsonb; previous_block jsonb; class jsonb;
  row_no integer:=0; unit_no integer:=0; position_no integer:=0; row_hash text; unit_name text; group_name text;
  directions text[]; eligibility jsonb; selected jsonb; old_item private.reviewed_exam_items; target_entry private.vocabulary_composition_entries;
  choice_ids bigint[]; choice_pron jsonb; choice_id bigint; new_choice bigint; choice_resource jsonb; proof jsonb; item_doc jsonb; item_hash text;
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  if p_version_id is null or p_content_sha256 is null then raise exception 'composition_version_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
  select * into v from private.vocabulary_library_versions where id=p_version_id;
  if not found then raise exception 'library_version_missing' using errcode='P0002'; end if;
  if v.content_sha256<>p_content_sha256 then raise exception 'library_version_changed' using errcode='40001'; end if;
  select * into c from private.vocabulary_compositions where version_id=p_version_id;
  if found then return private.vocabulary_composition_preparation_v1(p_version_id); end if;
  fixed:=private.resolve_vocabulary_library_recipe_v1(v.recipe);
  if fixed is distinct from v.fixed_composition then raise exception 'composition_source_changed' using errcode='40001'; end if;
  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;
  select jsonb_object_agg(value->>'key',value) into rows_by_key from jsonb_array_elements(fixed->'occurrences');
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,auth.uid(),jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));
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
  insert into private.vocabulary_compositions(version_id,dataset_id,content_sha256,state,created_by) values(v.id,dataset_value,v.content_sha256,'preparing',auth.uid());
  return private.vocabulary_composition_preparation_v1(v.id);
end;
$$;

create function public.finalize_vocabulary_composition_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.vocabulary_compositions; v private.vocabulary_library_versions; q jsonb;
  target_entry private.vocabulary_composition_entries; e public.vocab_entries; choice public.vocab_entries;
  choice_lineage private.vocabulary_composition_entries; choice_id bigint; choice_ids bigint[]; texts text[];
  direction_value text; expected_prompt text; choice_pron jsonb; proof jsonb; item_doc jsonb; item_hash text; bank_hash text;
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  if not found then raise exception 'composition_missing' using errcode='P0002'; end if;
  if c.content_sha256 is distinct from p_content_sha256 then raise exception 'composition_changed' using errcode='40001'; end if;
  if c.state='ready' then return private.vocabulary_composition_preparation_v1(p_version_id); end if;
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
  return private.vocabulary_composition_preparation_v1(c.version_id);
end;
$$;

create function private.protect_vocabulary_composition_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; composed boolean;
begin
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) end;
  if tg_table_name='vocab_unit_catalog' then
    select exists(select 1 from private.vocabulary_compositions c join public.vocab_units u on u.dataset_id=c.dataset_id
      where u.id in ((before_row->>'unit_id')::uuid,(after_row->>'unit_id')::uuid)) into composed;
  else
    select exists(select 1 from private.vocabulary_compositions c where c.dataset_id in ((before_row->>'dataset_id')::uuid,(after_row->>'dataset_id')::uuid)) into composed;
  end if;
  if composed then raise exception 'composition_content_immutable' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger library_composed_entries_immutable before insert or update or delete on public.vocab_entries for each row execute function private.protect_vocabulary_composition_content_v1();
create trigger library_composed_units_immutable before insert or update or delete on public.vocab_units for each row execute function private.protect_vocabulary_composition_content_v1();
create trigger library_composed_unit_catalog_immutable before insert or update or delete on public.vocab_unit_catalog for each row execute function private.protect_vocabulary_composition_content_v1();

-- A template's public version links only to a finished materialization.
do $migration$
declare definition text; needle text:='''datasetId'',NULL';
begin
  definition:=pg_get_functiondef('private.vocabulary_library_template_json_v1(uuid)'::regprocedure);
  -- SQL-language functions preserve the source spelling in pg_get_functiondef.
  needle:='''datasetId'',null';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'library_template_dataset_hook_changed'; end if;
  execute replace(definition,needle,'''datasetId'',(select c.dataset_id from private.vocabulary_compositions c where c.version_id=v.id and c.state=''ready'')');
end;
$migration$;

alter table public.assignments
  add column composition_version_id_snapshot uuid references private.vocabulary_compositions(version_id),
  add column composition_content_sha256_snapshot text check(composition_content_sha256_snapshot ~ '^[a-f0-9]{64}$');
alter table public.assignment_questions
  add column composition_version_id_snapshot uuid,
  add column composition_item_id_snapshot text,
  add column composition_item_sha256_snapshot text,
  add column composition_pronunciation_snapshot jsonb,
  add foreign key(composition_version_id_snapshot,composition_item_id_snapshot,composition_item_sha256_snapshot)
    references private.vocabulary_composition_items(version_id,item_id,item_sha256);

-- Keep every old proof branch, and require a complete independent composition
-- proof for the new one. Null must never satisfy the new proof checks.
do $migration$
declare table_name text; constraint_name text; definition text;
begin
  for table_name,constraint_name in select * from (values
    ('assignments','assignments_provenance_status_check'),('assignment_questions','assignment_questions_provenance_status_check'),
    ('assignments','assignments_canonical_preview_v1_check'),('assignments','assignments_reviewed_exam_v1_check')) x(t,n) loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||table_name)::regclass and conname=constraint_name;
    if definition is null then raise exception 'composition_proof_constraint_missing'; end if;
    execute format('alter table public.%I drop constraint %I',table_name,constraint_name);
    execute format('alter table public.%I add constraint %I check ((provenance_status = ''composition_verified_v1'') or (%s))',table_name,constraint_name,substring(definition from 8 for char_length(definition)-8));
  end loop;
end;
$migration$;
alter table public.assignments add constraint assignments_composition_v1_check check (
  (provenance_status<>'composition_verified_v1' and composition_version_id_snapshot is null and composition_content_sha256_snapshot is null)
  or coalesce((provenance_status='composition_verified_v1' and question_bank_version=5 and generator_version='vocabulary-composition-bank-v1'
    and composition_version_id_snapshot is not null and composition_content_sha256_snapshot is not null
    and reviewed_exam_release_id_snapshot is null and reviewed_exam_file_sha256_snapshot is null
    and canonical_question_release_id_snapshot is null and canonical_question_package_sha256_snapshot is null
    and question_bank_sha256 is not null and dataset_source_sha256_snapshot is not null
    and ((quiz_content_mode='book_meaning_choice' and english_to_korean_ratio in(0,50,100))
      or (quiz_content_mode='canonical_definition_to_headword' and english_to_korean_ratio=0)
      or (quiz_content_mode='canonical_headword_to_definition' and english_to_korean_ratio=100))),false));
alter table public.assignment_questions add constraint assignment_questions_composition_v1_check check (
  (provenance_status<>'composition_verified_v1' and composition_version_id_snapshot is null and composition_item_id_snapshot is null and composition_item_sha256_snapshot is null and composition_pronunciation_snapshot is null)
  or coalesce((provenance_status='composition_verified_v1' and composition_version_id_snapshot is not null and composition_item_id_snapshot is not null and composition_item_sha256_snapshot is not null
    and jsonb_typeof(composition_pronunciation_snapshot)='object' and jsonb_typeof(composition_pronunciation_snapshot->'target')='object'
    and jsonb_typeof(composition_pronunciation_snapshot->'choices')='array' and jsonb_array_length(composition_pronunciation_snapshot->'choices')=4
    and dataset_id is not null and entry_row_sha256_snapshot is not null and headword_snapshot is not null and primary_meaning_snapshot is not null
    and question_content_sha256 is not null and generator_version_snapshot='vocabulary-composition-bank-v1' and content_origin='book_occurrence'
    and canonical_lexeme_id_snapshot is null and canonical_question_release_id_snapshot is null and reviewed_exam_release_id_snapshot is null
    and cardinality(choice_vocab_entry_ids)=4 and array_position(choice_vocab_entry_ids,null) is null and cardinality(array_positions(choice_vocab_entry_ids,vocab_entry_id))=1
    and choice_vocab_entry_ids[correct_choice_index+1]=vocab_entry_id and correct_answer_snapshot=choices->>correct_choice_index
    and ((eligibility_quiz_mode in('book_meaning_en_to_ko','canonical_headword_to_definition') and direction='english_to_korean')
      or (eligibility_quiz_mode in('book_meaning_ko_to_en','canonical_definition_to_headword') and direction='korean_to_english'))),false));

create or replace function private.set_composition_question_identity()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.composition_target_key_snapshot:=coalesce(
    (select l.identity_key from private.vocabulary_composition_entries l where l.vocab_entry_id=new.vocab_entry_id),
    (select l.identity_key from word_index.mock_wordbook_lineage l where l.vocab_entry_id=new.vocab_entry_id));
  return new;
end;
$$;

create function private.vocabulary_composition_question_in_scope_v1(p_version_id uuid,p_item_id text,p_unit_ids uuid[])
returns boolean language sql stable security definer set search_path='' as $$
  select exists(select 1 from private.vocabulary_composition_items i join public.vocab_entries e on e.id=i.vocab_entry_id
    where i.version_id=p_version_id and i.item_id=p_item_id and e.unit_id=any(p_unit_ids)
    and (i.source_kind='reviewed_item' or not exists(select 1 from private.vocabulary_composition_items other
      join public.vocab_entries oe on oe.id=other.vocab_entry_id where other.version_id=i.version_id and other.quiz_mode=i.quiz_mode
      and other.direction=i.direction and oe.unit_id=any(p_unit_ids)
      and other.prompt_key=i.prompt_key and other.answer_key<>i.answer_key)));
$$;

create function public.list_active_vocabulary_composition_questions_v1(p_dataset_id uuid,p_unit_ids uuid[],p_quiz_mode text)
returns table(release_id uuid,package_sha256 text,vocab_entry_id bigint,unit_id uuid,source_row integer,question_item_id text,question_item_sha256 text,direction public.question_direction)
language plpgsql stable security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  if p_unit_ids is null or cardinality(p_unit_ids) not between 1 and 20000 or p_quiz_mode is null or p_quiz_mode not in ('book_meaning_choice','canonical_definition_to_headword','canonical_headword_to_definition')
    then raise exception 'composition_selection_invalid' using errcode='22023'; end if;
  if (select count(*) from public.vocab_units u where u.dataset_id=p_dataset_id and u.id=any(p_unit_ids))<>cardinality(p_unit_ids)
    then raise exception 'unit_dataset_mismatch' using errcode='22023'; end if;
  return query select c.version_id,c.content_sha256,i.vocab_entry_id,e.unit_id,e.source_row,i.item_id,i.item_sha256,i.direction
    from private.vocabulary_compositions c join public.vocab_datasets d on d.id=c.dataset_id and d.status='ready' and d.is_active
    join public.vocab_dataset_catalog cat on cat.dataset_id=d.id and cat.is_assignable
    join private.vocabulary_composition_items i on i.version_id=c.version_id
    join private.vocabulary_composition_entries l on l.vocab_entry_id=i.vocab_entry_id
    join public.vocab_entries e on e.id=l.vocab_entry_id and lower(e.row_sha256)=l.entry_sha256
    where c.dataset_id=p_dataset_id and c.state='ready' and i.quiz_mode=p_quiz_mode and e.unit_id=any(p_unit_ids)
      and private.vocabulary_composition_question_in_scope_v1(c.version_id,i.item_id,p_unit_ids)
    order by e.source_row,i.direction;
end;
$$;

create function private.create_composition_bank_for_delivery_v1(
  p_actor_admin_id uuid,p_title text,p_dataset_id uuid,p_unit_ids uuid[],p_question_count integer,
  p_english_to_korean_ratio smallint,p_time_limit_seconds integer,p_passing_score smallint,
  p_question_order_mode public.question_order_mode,p_available_until timestamptz,p_student_ids uuid[],
  p_timing_mode text,p_question_time_limit_seconds integer,p_questions jsonb,p_exact_review boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare first_descriptor jsonb; descriptor jsonb; target jsonb; version_value uuid; mode_value text;
  composition_row private.vocabulary_compositions; source_item private.vocabulary_composition_items;
  source_entry private.vocabulary_composition_entries; entry_row public.vocab_entries; dataset_row public.vocab_datasets;
  assignment_value uuid; min_row integer; max_row integer; hashes text[]:='{}'; question_hash text;
begin
  if p_actor_admin_id is null or not exists(select 1 from public.admin_profiles where user_id=p_actor_admin_id and is_active) then raise exception 'queue_actor_admin_inactive' using errcode='42501'; end if;
  if p_question_count is null or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)<>p_question_count
    or p_question_count not between (case when p_exact_review then 1 else 4 end) and (case when p_exact_review then 400 else 500 end)
    or p_english_to_korean_ratio is null or p_english_to_korean_ratio not in(0,50,100)
    or p_timing_mode is null or p_timing_mode not in('none','total','per_question')
    or (p_timing_mode in('none','total') and p_question_time_limit_seconds is not null)
    or (p_timing_mode='per_question' and (p_question_time_limit_seconds is null or p_question_time_limit_seconds not between 5 and 600))
    or p_student_ids is null or cardinality(p_student_ids)<>1 or array_position(p_student_ids,null) is not null
    or p_unit_ids is null or cardinality(p_unit_ids)<1 or array_position(p_unit_ids,null) is not null
    or (select count(distinct x) from unnest(p_unit_ids)x)<>cardinality(p_unit_ids)
    then raise exception 'composition_assignment_settings_invalid' using errcode='22023'; end if;
  perform 1 from public.students where id=p_student_ids[1] and status='active' and deleted_at is null for update;
  if not found then raise exception 'student_not_active'; end if;
  for target in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(target) is distinct from 'object' or not(target ?& array['vocab_entry_id','base_order_index','direction','composition_bank'])
      or (select count(*) from jsonb_object_keys(target))<>4 or jsonb_typeof(target->'vocab_entry_id') is distinct from 'number' or target->>'vocab_entry_id' !~ '^[1-9][0-9]*$'
      or jsonb_typeof(target->'base_order_index') is distinct from 'number' or target->>'base_order_index' !~ '^[1-9][0-9]*$'
      or target->>'direction' is null or target->>'direction' not in('english_to_korean','korean_to_english')
      or jsonb_typeof(target->'composition_bank') is distinct from 'object'
      then raise exception 'composition_assignment_payload_not_id_only' using errcode='22023'; end if;
    descriptor:=target->'composition_bank';
    if not(descriptor ?& array['mode','version_id','content_sha256','question_item_id','question_item_sha256']) or (select count(*) from jsonb_object_keys(descriptor))<>5
      or descriptor->>'content_sha256' !~ '^[a-f0-9]{64}$' or descriptor->>'question_item_sha256' !~ '^[a-f0-9]{64}$'
      or descriptor->>'question_item_id' is null or descriptor->>'question_item_sha256' is null
      then raise exception 'composition_assignment_descriptor_invalid' using errcode='22023'; end if;
  end loop;
  if (select count(distinct(q->>'vocab_entry_id')::bigint)<>p_question_count or count(distinct(q->>'base_order_index')::int)<>p_question_count
      or min((q->>'base_order_index')::int)<>1 or max((q->>'base_order_index')::int)<>p_question_count from jsonb_array_elements(p_questions)q)
    then raise exception 'composition_assignment_plan_invalid' using errcode='22023'; end if;
  first_descriptor:=p_questions->0->'composition_bank'; version_value:=(first_descriptor->>'version_id')::uuid; mode_value:=first_descriptor->>'mode';
  if version_value is null or mode_value is null or mode_value not in('book_meaning_choice','canonical_definition_to_headword','canonical_headword_to_definition')
    or (mode_value='canonical_definition_to_headword' and p_english_to_korean_ratio<>0) or (mode_value='canonical_headword_to_definition' and p_english_to_korean_ratio<>100)
    or (p_exact_review and mode_value<>'book_meaning_choice')
    or exists(select 1 from jsonb_array_elements(p_questions)q where ((q->'composition_bank')-'question_item_id'-'question_item_sha256') is distinct from (first_descriptor-'question_item_id'-'question_item_sha256'))
    then raise exception 'composition_assignment_mixed_version' using errcode='22023'; end if;
  if (select count(*) from jsonb_array_elements(p_questions)q where q->>'direction'='english_to_korean')<>round(p_question_count*p_english_to_korean_ratio/100.0)::int
    then raise exception 'composition_assignment_direction_mismatch' using errcode='22023'; end if;
  select * into composition_row from private.vocabulary_compositions where version_id=version_value and dataset_id=p_dataset_id and state='ready' and content_sha256=first_descriptor->>'content_sha256' for share;
  if not found then raise exception 'composition_unavailable' using errcode='55000'; end if;
  select d.* into dataset_row from public.vocab_datasets d join public.vocab_dataset_catalog cat on cat.dataset_id=d.id and cat.is_assignable where d.id=p_dataset_id and d.status='ready' and d.is_active for share of d,cat;
  if not found then raise exception 'dataset_not_ready' using errcode='55000'; end if;
  if (select count(*) from public.vocab_units where dataset_id=p_dataset_id and id=any(p_unit_ids))<>cardinality(p_unit_ids) then raise exception 'unit_dataset_mismatch' using errcode='22023'; end if;
  perform private.resolve_contiguous_unit_direction_v1(p_dataset_id,p_unit_ids);
  select min(e.source_row),max(e.source_row) into min_row,max_row from public.vocab_entries e join jsonb_array_elements(p_questions)q on e.id=(q->>'vocab_entry_id')::bigint where e.dataset_id=p_dataset_id;
  insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,available_until,timing_mode,question_time_limit_seconds)
    values(p_title,p_dataset_id,min_row,max_row,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,'initial',false,'draft',p_actor_admin_id,'units',p_question_order_mode,5,p_available_until,p_timing_mode,p_question_time_limit_seconds) returning id into assignment_value;
  insert into public.assignment_units(assignment_id,dataset_id,unit_id,position) select assignment_value,p_dataset_id,u.id,u.n::int from unnest(p_unit_ids) with ordinality u(id,n);
  insert into public.assignment_students(assignment_id,student_id,assigned_by) values(assignment_value,p_student_ids[1],p_actor_admin_id);
  for target in select value from jsonb_array_elements(p_questions) order by (value->>'base_order_index')::int loop
    descriptor:=target->'composition_bank';
    select i.* into source_item from private.vocabulary_composition_items i join public.vocab_entries e on e.id=i.vocab_entry_id
      where i.version_id=version_value and i.dataset_id=p_dataset_id and i.vocab_entry_id=(target->>'vocab_entry_id')::bigint and i.item_id=descriptor->>'question_item_id'
        and i.item_sha256=descriptor->>'question_item_sha256' and i.quiz_mode=mode_value and i.direction::text=target->>'direction' and e.unit_id=any(p_unit_ids);
    if not found then raise exception 'composition_assignment_snapshot_mismatch' using errcode='55000'; end if;
    if not private.vocabulary_composition_question_in_scope_v1(version_value,source_item.item_id,p_unit_ids) then raise exception 'composition_target_outside_eligible_scope' using errcode='22023'; end if;
    select * into source_entry from private.vocabulary_composition_entries where vocab_entry_id=source_item.vocab_entry_id;
    select * into entry_row from public.vocab_entries where id=source_entry.vocab_entry_id and lower(row_sha256)=source_entry.entry_sha256;
    if not found then raise exception 'composition_entry_changed' using errcode='55000'; end if;
    question_hash:=upper(private.reviewed_exam_sha256_v1(jsonb_build_object('itemSha256',source_item.item_sha256,'order',target->'base_order_index'))); hashes:=array_append(hashes,question_hash);
    insert into public.assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id,entry_row_sha256_snapshot,
      eligibility_quiz_mode,eligibility_input_hash_snapshot,headword_snapshot,headword_normalized_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,correct_answer_snapshot,
      content_origin,eligibility_rule_version_snapshot,generator_version_snapshot,question_content_sha256,provenance,provenance_status,
      composition_version_id_snapshot,composition_item_id_snapshot,composition_item_sha256_snapshot,composition_pronunciation_snapshot)
      values(assignment_value,source_item.vocab_entry_id,(target->>'base_order_index')::int,source_item.direction,source_item.prompt,to_jsonb(source_item.choice_texts),source_item.correct_choice_index,p_dataset_id,upper(source_entry.entry_sha256),
        case when mode_value='book_meaning_choice' then case when source_item.direction='english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end else mode_value end,
        upper(source_item.item_sha256),entry_row.headword,entry_row.headword_normalized,entry_row.primary_meaning,source_item.choice_vocab_entry_ids,source_item.choice_texts[source_item.correct_choice_index+1],
        'book_occurrence','vocabulary-composition-v1','vocabulary-composition-bank-v1',question_hash,source_item.source_proof||jsonb_build_object('promptRole',source_item.prompt_role,'choiceRole',source_item.choice_role),
        'composition_verified_v1',version_value,source_item.item_id,source_item.item_sha256,source_item.pronunciation_snapshot);
  end loop;
  if exists(select 1 from public.assignment_questions q where q.assignment_id=assignment_value and
    (select count(distinct lower(regexp_replace(normalize(trim(x),NFKC),'\s+',' ','g'))) from jsonb_array_elements_text(q.choices)x)<>4)
    then raise exception 'assignment_target_choices_duplicate' using errcode='22023'; end if;
  -- Preserve the entire original reviewed release as the ambiguity reference,
  -- even when only one partial passage was included in this composition.
  if exists(select 1 from private.vocabulary_composition_items i join public.assignment_questions q on q.composition_item_id_snapshot=i.item_id and q.composition_version_id_snapshot=i.version_id
    join private.reviewed_exam_items other on other.release_id=i.source_release_id and other.quiz_mode=i.quiz_mode and other.direction=i.direction
    where q.assignment_id=assignment_value and i.source_kind='reviewed_item'
      and lower(regexp_replace(normalize(trim(other.prompt),NFKC),'\s+',' ','g'))=lower(regexp_replace(normalize(trim(i.prompt),NFKC),'\s+',' ','g'))
      and lower(normalize(trim(other.choice_texts[other.correct_choice_index+1]),NFKC))<>lower(normalize(trim(i.choice_texts[i.correct_choice_index+1]),NFKC))
      and lower(normalize(trim(other.choice_texts[other.correct_choice_index+1]),NFKC))=any(array(select lower(normalize(trim(x),NFKC)) from unnest(i.choice_texts)x)))
    then raise exception 'assignment_target_prompt_ambiguous' using errcode='22023'; end if;
  if exists(select 1 from public.assignment_questions a join public.assignment_questions b on b.assignment_id=a.assignment_id and b.direction=a.direction
    where a.assignment_id=assignment_value and a.id<>b.id and lower(replace(normalize(trim(a.prompt),NFKC),'*',''))=lower(replace(normalize(trim(b.prompt),NFKC),'*',''))
      and lower(normalize(trim(a.correct_answer_snapshot),NFKC))<>lower(normalize(trim(b.correct_answer_snapshot),NFKC))
      and (exists(select 1 from private.vocabulary_composition_items i where i.version_id=version_value and i.item_id=a.composition_item_id_snapshot and i.source_kind='generated_meaning')
        or lower(normalize(trim(b.correct_answer_snapshot),NFKC))=any(array(select lower(normalize(trim(x),NFKC)) from jsonb_array_elements_text(a.choices)x))))
    then raise exception 'assignment_target_prompt_ambiguous' using errcode='22023'; end if;
  update public.assignments set quiz_content_mode=mode_value,dataset_source_sha256_snapshot=upper(dataset_row.source_sha256),generator_version='vocabulary-composition-bank-v1',
    question_bank_sha256=upper(encode(extensions.digest(convert_to(array_to_string(hashes,'|'),'UTF8'),'sha256'),'hex')),
    provenance_status='composition_verified_v1',composition_version_id_snapshot=version_value,composition_content_sha256_snapshot=composition_row.content_sha256,status='active' where id=assignment_value;
  insert into public.audit_events(event_type,actor_admin_id,details) values('assignment.vocabulary_composition_created',p_actor_admin_id,jsonb_build_object('assignmentId',assignment_value,'versionId',version_value,'questionCount',p_question_count,'mode',mode_value));
  return assignment_value;
end;
$$;

-- Inject only the new source branch into the CURRENT three delivery functions.
-- Public retry, edit, scheduling and first-attempt release logic stay intact.
do $migration$
declare definition text; signature text; actor text; direct boolean; needle text:=E'begin\n'; injected text;
begin
  for signature,actor,direct in select * from (values
    ('private.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)','(select auth.uid())',true),
    ('private.create_assignment_with_delivery_v7(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)','(select auth.uid())',false),
    ('private.create_assignment_with_delivery_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)','p_actor_admin_id',false)) x(s,a,d) loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    injected:=E'begin\n  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) or (jsonb_typeof(p_questions)=''array'' and exists(select 1 from jsonb_array_elements(p_questions) q where q?''composition_bank'')) then\n';
    injected:=injected||case when direct then '    created_assignment_id:=' else '    return ' end||'private.create_composition_bank_for_delivery_v1('||actor||E',p_title,p_dataset_id,p_unit_ids,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,p_available_until,p_student_ids,p_timing_mode,p_question_time_limit_seconds,p_questions);\n';
    if direct then injected:=injected||E'    perform private.link_pending_review_targets_v2(created_assignment_id,p_student_ids,null);\n    return created_assignment_id;\n'; end if;
    injected:=injected||E'  end if;\n';
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'composition_delivery_hook_changed'; end if;
    execute replace(definition,needle,injected);
  end loop;
end;
$migration$;
-- Add frozen learning fields inside the existing permission-gated study query.
do $migration$
declare definition text; needle text; replacement text;
begin
  definition:=replace(pg_get_functiondef('private.student_assignment_study_content_v1(uuid,uuid)'::regprocedure),chr(13),'');
  needle:='''preview_verified_v1'',''exam_reviewed_v1''';
  if position(needle in definition)=0 then raise exception 'composition_study_trust_hook_changed'; end if;
  definition:=replace(definition,needle,'''preview_verified_v1'',''exam_reviewed_v1'',''composition_verified_v1''');
  needle:='''pronunciationSnapshot'', s.pronunciation_snapshot,';
  replacement:='''pronunciationSnapshot'', s.pronunciation_snapshot,''compositionPronunciation'',q.composition_pronunciation_snapshot->''target'',';
  if position(needle in definition)=0 then raise exception 'composition_study_pronunciation_hook_changed'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='''definition'', case when q.provenance_status=''exam_reviewed_v1''';
  replacement:='''definition'', case when q.provenance_status=''composition_verified_v1'' then composition.resources#>>''{selected,definitionEn}'' when q.provenance_status=''exam_reviewed_v1''';
  if position(needle in definition)=0 then raise exception 'composition_study_definition_hook_changed'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='''example'', case when q.eligibility_quiz_mode = ''canonical_example_to_headword'' then x.example_en end';
  replacement:='''example'', case when q.provenance_status=''composition_verified_v1'' then composition.resources#>>''{selected,exampleEn}'' when q.eligibility_quiz_mode = ''canonical_example_to_headword'' then x.example_en end';
  if position(needle in definition)=0 then raise exception 'composition_study_example_hook_changed'; end if;
  definition:=replace(definition,needle,replacement);
  needle:='left join public.assignment_question_exam_use_snapshot s';
  replacement:=E'left join private.vocabulary_composition_entries composition on composition.version_id=q.composition_version_id_snapshot and composition.vocab_entry_id=q.vocab_entry_id and upper(composition.entry_sha256)=q.entry_row_sha256_snapshot\n    left join public.assignment_question_exam_use_snapshot s';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'composition_study_source_hook_changed'; end if;
  execute replace(definition,needle,replacement);
end;
$migration$;

revoke all on function public.list_active_vocabulary_composition_questions_v1(uuid,uuid[],text),private.create_composition_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.list_active_vocabulary_composition_questions_v1(uuid,uuid[],text) to authenticated;

do $migration$
declare definition text; needle text:=') x group by x.dataset_id;';
begin
  definition:=pg_get_functiondef('public.list_assignment_question_mode_availability_v2()'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'composition_modes_hook_changed'; end if;
  execute replace(definition,needle,E' union all select c.dataset_id,count(*) filter(where i.quiz_mode=''canonical_definition_to_headword''),0::bigint,count(*) filter(where i.quiz_mode=''canonical_headword_to_definition'')\n      from private.vocabulary_compositions c join private.vocabulary_composition_items i on i.version_id=c.version_id join public.vocab_datasets d on d.id=c.dataset_id and d.status=''ready'' and d.is_active where c.state=''ready'' group by c.dataset_id\n  '||needle);
end;
$migration$;

create function public.list_vocabulary_unit_source_classifications_v1(p_dataset_id uuid)
returns table(unit_id uuid,metadata jsonb) language plpgsql stable security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  return query with latest as (
    select distinct on(s.scope_key) s.* from private.vocabulary_library_scopes s where s.dataset_id=p_dataset_id order by s.scope_key,s.revision desc
  ), library as (
    select u.id,(jsonb_agg(s.payload#>'{classification,exam}')->0) exam from public.vocab_units u
      join latest s on s.unit_id=u.id join private.vocabulary_library_scope_rows r on r.scope_id=s.id and r.state='included'
      join public.vocab_entries e on e.id=r.source_entry_id and e.unit_id=u.id and lower(e.row_sha256)=r.row_sha256
    where u.dataset_id=p_dataset_id group by u.id,u.entry_count
    having count(distinct r.source_entry_id)=u.entry_count and count(distinct s.payload#>'{classification,exam}')=1
      and bool_and(jsonb_typeof(s.payload#>'{classification,exam}')='object')
  ), previous as (
    select distinct on(s.source_unit_id) s.source_unit_id,s.metadata from word_index.mock_wordbook_scope s
      join public.vocab_units u on u.id=s.source_unit_id where u.dataset_id=p_dataset_id order by s.source_unit_id,s.revision desc
  ) select l.id,l.exam from library l union all select p.source_unit_id,p.metadata from previous p where not exists(select 1 from library l where l.id=p.source_unit_id);
end;
$$;
revoke all on function public.list_vocabulary_unit_source_classifications_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_vocabulary_unit_source_classifications_v1(uuid) to authenticated;

create function public.prepare_vocabulary_template_book_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare request_value uuid; version_value uuid; request_hash_value text; cached private.vocabulary_library_requests; result jsonb;
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or p_request->>'action' is distinct from 'materialize'
    or not(p_request ?& array['action','requestId','templateId','versionId','contentHash']) or (select count(*) from jsonb_object_keys(p_request))<>5
    then raise exception 'invalid_library_request' using errcode='22023'; end if;
  request_value:=(p_request->>'requestId')::uuid; version_value:=(p_request->>'versionId')::uuid;
  if request_value is null or version_value is null then raise exception 'invalid_library_request' using errcode='22023'; end if;
  request_hash_value:=private.reviewed_exam_sha256_v1(p_request);
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_value::text,0));
  select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and request_id=request_value;
  if found and cached.request_hash<>request_hash_value then raise exception 'library_request_reused' using errcode='40001'; end if;
  if not exists(select 1 from private.vocabulary_library_versions v where v.id=version_value and v.template_id=(p_request->>'templateId')::uuid)
    then raise exception 'library_version_missing' using errcode='P0002'; end if;
  result:=public.prepare_vocabulary_composition_v1(version_value,p_request->>'contentHash');
  if cached.request_id is null then
    insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_value,request_hash_value,jsonb_build_object('materializingVersion',version_value));
  end if;
  return result;
end;
$$;

create function private.sync_vocabulary_template_metadata_v1(p_template_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare metadata_value jsonb; dataset_ids uuid[];
begin
  select metadata into metadata_value from private.vocabulary_library_templates where id=p_template_id;
  select array_agg(c.dataset_id) into dataset_ids from private.vocabulary_compositions c join private.vocabulary_library_versions v on v.id=c.version_id where v.template_id=p_template_id;
  update public.vocab_datasets set title=metadata_value->>'title' where id=any(dataset_ids);
  update public.vocab_dataset_catalog set display_name=metadata_value->>'title',grade_code=case when length(metadata_value->>'targetGrade')<=24 then metadata_value->>'targetGrade' end,
    academic_year=(metadata_value->>'schoolYear')::smallint,metadata=metadata||jsonb_build_object('school',metadata_value->'school','audience',case when metadata_value->>'school' is null then 'common' else 'school' end,
      'purpose',case when metadata_value->>'purpose' is not null then 'exam_prep' end,'semester',metadata_value->'semester','templateMetadata',metadata_value) where dataset_id=any(dataset_ids);
end;
$$;
do $migration$
declare definition text; needle text:='result:=jsonb_build_object(''template'',private.vocabulary_library_template_json_v1(tid));';
begin
  definition:=pg_get_functiondef('public.save_vocabulary_library_template_v1(jsonb)'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'library_metadata_hook_changed'; end if;
  execute replace(definition,needle,E'perform private.sync_vocabulary_template_metadata_v1(tid);\n  '||needle);
end;
$migration$;

create function public.get_vocabulary_composition_summary_v1(p_version_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  select jsonb_build_object('template',private.vocabulary_library_template_json_v1(v.template_id),'createdBook',jsonb_build_object('versionId',c.version_id,'contentHash',c.content_sha256,
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
revoke all on function public.get_vocabulary_composition_summary_v1(uuid),private.vocabulary_source_eligibility_v1(text,uuid,bigint,uuid,text),private.vocabulary_composition_question_in_scope_v1(uuid,text,uuid[]),public.prepare_vocabulary_template_book_v1(jsonb),private.sync_vocabulary_template_metadata_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_vocabulary_composition_summary_v1(uuid) to authenticated;
grant execute on function public.prepare_vocabulary_template_book_v1(jsonb) to authenticated;

revoke all on function public.finalize_vocabulary_composition_v1(uuid,text,jsonb),private.protect_vocabulary_composition_content_v1() from public,anon,authenticated,service_role;
grant execute on function public.finalize_vocabulary_composition_v1(uuid,text,jsonb) to service_role;
revoke all on function private.vocabulary_composition_resource_v1(jsonb),private.vocabulary_composition_choice_resource_v1(uuid,bigint),private.vocabulary_composition_preparation_v1(uuid),public.prepare_vocabulary_composition_v1(uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.prepare_vocabulary_composition_v1(uuid,text) to authenticated;

-- Reuse the existing review/edit request shape. Only the fixed composition
-- bank resolves the choices to a new proof; no prompt text comes from a client.
create function public.list_vocabulary_composition_review_choices_v1(p_dataset_id uuid,p_vocab_entry_ids bigint[],p_quiz_mode text default 'book_meaning_choice',p_scope_unit_ids uuid[] default null)
returns table(vocab_entry_id bigint,direction public.question_direction,choice_vocab_entry_ids bigint[])
language plpgsql stable security definer set search_path='' as $$
declare scope_ids uuid[];
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>500 or exists(select 1 from unnest(p_vocab_entry_ids) v where v is null or v<1)
    then raise exception 'composition_review_selection_invalid' using errcode='22023'; end if;
  select coalesce(p_scope_unit_ids,array_agg(distinct e.unit_id)) into scope_ids from public.vocab_entries e where e.dataset_id=p_dataset_id and e.id=any(p_vocab_entry_ids);
  return query select i.vocab_entry_id,i.direction,i.choice_vocab_entry_ids from private.vocabulary_composition_items i
    join private.vocabulary_compositions c on c.version_id=i.version_id and c.state='ready'
    join public.vocab_datasets d on d.id=c.dataset_id and d.status='ready' and d.is_active
    join public.vocab_dataset_catalog cat on cat.dataset_id=d.id and cat.is_assignable
    join private.vocabulary_composition_entries ce on ce.version_id=i.version_id and ce.vocab_entry_id=i.vocab_entry_id
    join public.vocab_entries e on e.id=ce.vocab_entry_id and lower(e.row_sha256)=ce.entry_sha256
    where i.dataset_id=p_dataset_id and i.quiz_mode=p_quiz_mode and i.vocab_entry_id=any(p_vocab_entry_ids)
      and private.vocabulary_composition_question_in_scope_v1(i.version_id,i.item_id,scope_ids)
    order by i.vocab_entry_id,i.direction;
end;
$$;

create function private.vocabulary_composition_plan_from_choices_v1(p_dataset_id uuid,p_questions jsonb,p_mode text default 'book_meaning_choice')
returns jsonb language plpgsql security definer set search_path='' as $$
declare composition_row private.vocabulary_compositions; result_value jsonb; expected_count integer;
begin
  if p_questions is null or jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 500
    then raise exception 'composition_assignment_plan_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q)<>'object'
    or not(q ?& array['vocab_entry_id','base_order_index','direction','choice_vocab_entry_ids']) or (select count(*) from jsonb_object_keys(q))<>4)
    then raise exception 'composition_assignment_plan_invalid' using errcode='22023'; end if;
  select * into composition_row from private.vocabulary_compositions where dataset_id=p_dataset_id and state='ready' for share;
  if not found then raise exception 'composition_not_ready' using errcode='55000'; end if;
  expected_count:=jsonb_array_length(p_questions);
  select jsonb_agg(jsonb_build_object('vocab_entry_id',i.vocab_entry_id,'direction',i.direction,'base_order_index',q->'base_order_index',
    'composition_bank',jsonb_build_object('mode',p_mode,'version_id',composition_row.version_id,'content_sha256',composition_row.content_sha256,
      'question_item_id',i.item_id,'question_item_sha256',i.item_sha256)) order by (q->>'base_order_index')::int)
    into result_value from jsonb_array_elements(p_questions) q join private.vocabulary_composition_items i
      on i.version_id=composition_row.version_id and i.vocab_entry_id=(q->>'vocab_entry_id')::bigint and i.quiz_mode=p_mode
      and i.direction::text=q->>'direction' and to_jsonb(i.choice_vocab_entry_ids)=q->'choice_vocab_entry_ids';
  if coalesce(jsonb_array_length(result_value),0)<>expected_count then raise exception 'composition_assignment_snapshot_mismatch' using errcode='55000'; end if;
  return result_value;
end;
$$;

create function private.vocabulary_composition_target_units_v1(p_dataset_id uuid,p_questions jsonb)
returns uuid[] language plpgsql security definer set search_path='' as $$
declare result_value uuid[];
begin
  perform private.vocabulary_composition_plan_from_choices_v1(p_dataset_id,p_questions,'book_meaning_choice');
  select array_agg(u.id order by u.sort_index) into result_value from public.vocab_units u where u.dataset_id=p_dataset_id
    and exists(select 1 from jsonb_array_elements(p_questions) q join public.vocab_entries e on e.id=(q->>'vocab_entry_id')::bigint
      and e.dataset_id=p_dataset_id where e.unit_id=u.id);
  if result_value is null then raise exception 'composition_review_scope_invalid' using errcode='22023'; end if;
  return result_value;
end;
$$;

do $migration$
declare definition text; old_fragment text; new_fragment text; signature text; start_fragment text; end_fragment text; start_at integer; end_at integer;
begin
  definition:=replace(pg_get_functiondef('private.list_student_direct_review_candidates_v1(uuid,uuid)'::regprocedure),chr(13),'');
  old_fragment:=E'      and (\n        exists(select 1 from private.reviewed_exam_releases';
  new_fragment:=E'      and (\n        exists(select 1 from private.vocabulary_compositions c join private.vocabulary_composition_items i on i.version_id=c.version_id\n          join private.vocabulary_composition_entries ce on ce.version_id=i.version_id and ce.vocab_entry_id=i.vocab_entry_id\n          where c.state=''ready'' and i.dataset_id=entry.dataset_id and i.vocab_entry_id=entry.id\n            and i.quiz_mode=''book_meaning_choice'' and ce.entry_sha256=lower(entry.row_sha256))\n        or exists(select 1 from private.reviewed_exam_releases';
  if position(old_fragment in definition)=0 then raise exception 'composition_wrong_candidate_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('private.create_exact_review_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],jsonb)'::regprocedure),chr(13),'');
  old_fragment:=E'begin\n';
  new_fragment:=E'begin\n  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then\n    return private.create_composition_bank_for_delivery_v1((select auth.uid()),p_title,p_dataset_id,p_unit_ids,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,p_available_until,p_student_ids,''total'',null,private.vocabulary_composition_plan_from_choices_v1(p_dataset_id,p_questions,''book_meaning_choice''),true);\n  end if;\n';
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'composition_exact_dispatch_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('private.create_exact_review_assignment_with_delivery_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)'::regprocedure),chr(13),'');
  old_fragment:='if not exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then';
  new_fragment:='if not exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) and not exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then';
  if position(old_fragment in definition)=0 then raise exception 'composition_exact_prompt_guard_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  foreach signature in array array[
    'private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)',
    'private.persist_exact_review_assignment_exam_use_v7_compat(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamptz,jsonb)'
  ] loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    start_fragment:=E'  with referenced_entry_ids as (\n';
    end_fragment:=case when signature like 'private.create_exact%' then E'  created_assignment_id := private.create_exact_review_assignment_with_delivery_v1(\n'
      else E'  created_assignment_id :=\n    private.create_exact_review_question_bank_exam_use_dispatch_v1(\n' end;
    start_at:=position(start_fragment in definition); end_at:=position(end_fragment in definition);
    if start_at=0 or end_at<=start_at or (length(definition)-length(replace(definition,start_fragment,'')))/length(start_fragment)<>1 then raise exception 'composition_review_scope_anchor_changed'; end if;
    old_fragment:=substring(definition from start_at for end_at-start_at);
    new_fragment:=E'  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then\n    scope_unit_ids:=private.vocabulary_composition_target_units_v1(p_dataset_id,p_questions);\n  else\n'||old_fragment||E'  end if;\n\n';
    definition:=replace(definition,old_fragment,new_fragment);
    if signature like 'private.persist%' then
      start_fragment:=E'  -- Four rendered choices and their canonical identities must all differ.\n';
      end_fragment:=E'  -- Support units cover every target, every choice and every primary DAY.\n';
      start_at:=position(start_fragment in definition); end_at:=position(end_fragment in definition);
      if start_at=0 or end_at<=start_at then raise exception 'composition_review_choices_anchor_changed'; end if;
      old_fragment:=substring(definition from start_at for end_at-start_at);
      definition:=replace(definition,old_fragment,E'  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then\n    perform private.vocabulary_composition_plan_from_choices_v1(p_dataset_id,p_questions,''book_meaning_choice'');\n  else\n'||old_fragment||E'  end if;\n\n');
    end if;
    execute definition;
  end loop;

  definition:=replace(pg_get_functiondef('public.replace_student_assignment_v7(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,timestamptz,text,integer,smallint[],text,uuid[],jsonb)'::regprocedure),chr(13),'');
  old_fragment:=E'  if source_purpose=''regular'' then\n    if exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then';
  new_fragment:=E'  if source_purpose=''regular'' then\n    if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then\n      p_questions:=private.vocabulary_composition_plan_from_choices_v1(p_dataset_id,p_questions,coalesce((select case when provenance_status in (''exam_reviewed_v1'',''composition_verified_v1'') then quiz_content_mode else ''book_meaning_choice'' end from public.assignments where id=p_source_assignment_id),''book_meaning_choice''));\n    elsif exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then';
  if position(old_fragment in definition)=0 then raise exception 'composition_replacement_anchor_changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  definition:=replace(definition,'provenance_status=''exam_reviewed_v1''','provenance_status in (''exam_reviewed_v1'',''composition_verified_v1'')');
  execute definition;
end;
$migration$;
revoke all on function public.list_vocabulary_composition_review_choices_v1(uuid,bigint[],text,uuid[]),private.vocabulary_composition_plan_from_choices_v1(uuid,jsonb,text),private.vocabulary_composition_target_units_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.list_vocabulary_composition_review_choices_v1(uuid,bigint[],text,uuid[]) to authenticated;

notify pgrst,'reload schema';
commit;
