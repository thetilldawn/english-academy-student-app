-- Bulk preparation preserves the original all-or-nothing transaction and protections.
create function private.vocabulary_composition_positions_v1(p_fixed jsonb)
returns table(row_no integer,occurrence_key text,scope_ids uuid[],scope_id uuid,unit_no integer,position_no integer)
language sql stable security definer set search_path='' as $$
  with picked as materialized (
    select ordinality::integer row_no,value occurrence_key,
      array(select value::uuid from jsonb_array_elements_text(p_fixed#>array['rowScopes',x.value])) scope_ids
    from jsonb_array_elements_text(p_fixed->'includedKeys') with ordinality x
  ), scoped as materialized (
    select p.*,s.id scope_id,jsonb_build_array(s.dataset_id,s.source_kind,s.source_release_id,s.source_version,s.source_file_sha256,s.unit_id,
      (s.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'],
      to_jsonb(array(select x from unnest(p.scope_ids) x order by x))) block_key
    from picked p join private.vocabulary_library_scopes s on s.id=p.scope_ids[1]
  ), changed as (
    select scoped.*,case when block_key is distinct from lag(block_key) over(order by row_no) then 1 else 0 end new_unit from scoped
  ), numbered as (
    select changed.*,sum(new_unit) over(order by row_no)::integer unit_no from changed
  ) select row_no,occurrence_key,scope_ids,scope_id,unit_no,row_number() over(partition by unit_no order by row_no)::integer position_no from numbered order by row_no;
$$;
revoke all on function private.vocabulary_composition_positions_v1(jsonb) from public,anon,authenticated,service_role;
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
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,p_actor_id,jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));
  with positions as materialized (
    select * from private.vocabulary_composition_positions_v1(fixed)
  ), blocks as materialized (
    select distinct on (p.unit_no) p.*,count(*) over(partition by p.unit_no)::integer entry_count
    from positions p order by p.unit_no,p.row_no
  ), units as materialized (
    select b.*,extensions.gen_random_uuid() unit_id,(scope_record.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'] class,
      left(scope_record.payload->>'name',120)||case when cardinality(b.scope_ids)>1 then ' 외 '||(cardinality(b.scope_ids)-1)::text||'개 범위의 공통 부분' else '' end unit_name
    from blocks b join private.vocabulary_library_scopes scope_record on scope_record.id=b.scope_id
  ), inserted_units as (
    insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      select u.unit_id,dataset_value,u.unit_name,'composition-unit-'||u.unit_no::text,
        case when u.class->>'day' is not null then 'day'::public.vocab_unit_kind else 'supplement'::public.vocab_unit_kind end,
        (u.class->>'day')::integer,u.unit_no,u.entry_count from units u returning id
  ), inserted_catalog as (
    insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,academic_year,exam_month,agency,item_range,sort_index,metadata)
      select u.unit_id,case when u.class->>'kind'='csat' then 'csat' when u.class->>'kind'='mock' and u.class->>'sourceGrade'='g12' then 'high_mock' else 'high' end,
        case when u.class->>'day' is not null then 'day' when u.class->>'lesson' is not null then 'lesson' when u.class->>'kind' in ('mock','csat') then 'exam_scope' else 'supplement' end,
        u.unit_name,(u.class#>>'{exam,executionYear}')::smallint,(u.class#>>'{exam,examMonth}')::smallint,u.class#>>'{exam,agency}',
        (select string_agg(n,'–' order by ord) from jsonb_array_elements_text(u.class#>'{exam,questionNumbers}') with ordinality q(n,ord)),u.unit_no,
        jsonb_build_object('mockScope',u.class->'exam','sourceClassification',u.class,'librarySourceScopes',
          (select jsonb_agg(jsonb_build_object('id',x.id,'name',x.payload->>'name')) from private.vocabulary_library_scopes x where x.id=any(u.scope_ids)))
      from units u join inserted_units i on i.id=u.unit_id returning unit_id
  ), inserted_entries as (
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,example_en,example_ko,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      select dataset_value,p.row_no,source_entry.headword,source_entry.headword_normalized,source_entry.pronunciation_ko,source_entry.meanings,source_entry.primary_meaning,source_entry.english_definition,source_entry.example_en,source_entry.example_ko,source_entry.source_ref,
        upper(private.reviewed_exam_sha256_v1(jsonb_build_array(v.id,v.content_sha256,p.occurrence_key))),u.unit_id,p.position_no,source_entry.entry_type
      from positions p join units u using(unit_no) join inserted_units i on i.id=u.unit_id
        join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
        cross join lateral jsonb_populate_record(null::public.vocab_entries,sr.entry_snapshot) source_entry
      returning id,source_row,unit_id,row_sha256
  ) insert into private.vocabulary_composition_entries(version_id,dataset_id,vocab_entry_id,unit_id,occurrence_key,source_entry_id,source_scope_ids,source_kind,source_release_id,entry_sha256,identity_key,source_snapshot,resources,eligible_directions,eligibility_snapshot)
    select v.id,dataset_value,i.id,i.unit_id,p.occurrence_key,sr.source_entry_id,p.scope_ids,scope_record.source_kind,scope_record.source_release_id,lower(i.row_sha256),
      private.reviewed_exam_sha256_v1(jsonb_build_array('unreviewed-occurrence-v1',v.id,p.occurrence_key)),doc.value,
      jsonb_set(doc.value->'resources','{selected}',private.vocabulary_composition_resource_v1(doc.value->'resources')),
      array(select value from jsonb_array_elements_text(eligibility_value.value->'directions')),eligibility_value.value
    from inserted_entries i join positions p on p.row_no=i.source_row
      join private.vocabulary_library_scopes scope_record on scope_record.id=p.scope_id
      join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
      cross join lateral (select jsonb_set(private.vocabulary_library_row_document_v1(p.scope_id,p.occurrence_key),'{resources,linkRecordHashes}',
        (select jsonb_agg(distinct r.resources->'linkRecordHash' order by r.resources->'linkRecordHash') from private.vocabulary_library_scope_rows r
          where r.scope_id=any(p.scope_ids) and r.occurrence_key=p.occurrence_key)) value offset 0) doc
      cross join lateral (select private.vocabulary_source_eligibility_v1(scope_record.source_kind,scope_record.source_release_id,sr.source_entry_id,scope_record.dataset_id,sr.row_sha256) value offset 0) eligibility_value;
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
