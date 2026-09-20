
-- Pending books remain unassignable. Each bounded step commits only its own
-- rows and cursor, while final publication rechecks the entire fixed source.
create table private.vocabulary_composition_builds (
  version_id uuid primary key references private.vocabulary_compositions(version_id),
  dataset_id uuid not null unique references public.vocab_datasets(id),
  total_count integer not null check(total_count between 1 and 20000),
  next_row integer not null default 1,
  reviewed_after_row integer not null default 0,
  preparation_complete boolean not null default false,
  check(next_row between 1 and total_count+1),
  check(reviewed_after_row between 0 and total_count)
);
create table private.vocabulary_composition_build_positions (
  version_id uuid not null references private.vocabulary_composition_builds(version_id),
  row_no integer not null check(row_no between 1 and 20000),
  occurrence_key text not null,
  scope_id uuid not null references private.vocabulary_library_scopes(id),
  scope_ids uuid[] not null check(cardinality(scope_ids)>0 and scope_ids[1]=scope_id),
  unit_id uuid not null references public.vocab_units(id),
  position_no integer not null check(position_no>0),
  primary key(version_id,row_no),unique(version_id,occurrence_key),unique(version_id,unit_id,position_no)
);
create table private.vocabulary_composition_write_context (
  backend_pid integer not null,
  transaction_id bigint not null,
  version_id uuid not null references private.vocabulary_composition_builds(version_id),
  dataset_id uuid not null references public.vocab_datasets(id),
  phase text not null check(phase in ('units','entries')),
  first_row integer not null,
  last_row integer not null,
  primary key(backend_pid,transaction_id),
  check((phase='units' and first_row=0 and last_row=0) or
    (phase='entries' and first_row>0 and last_row>=first_row and last_row-first_row<500))
);
create table private.vocabulary_composition_question_plans (
  version_id uuid primary key references private.vocabulary_compositions(version_id),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  plan_sha256 text not null check(plan_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check(jsonb_typeof(payload)='array'),
  total_count integer not null check(total_count between 0 and 40000),
  processed_count integer not null default 0 check(processed_count>=0),
  check(jsonb_array_length(payload)=total_count and processed_count<=total_count)
);
do $$
declare n text;
begin
  foreach n in array array['builds','build_positions','write_context','question_plans'] loop
    execute format('alter table private.vocabulary_composition_%I enable row level security',n);
    execute format('revoke all on private.vocabulary_composition_%I from public,anon,authenticated,service_role',n);
  end loop;
end;
$$;
create trigger composition_build_positions_immutable before update or delete on private.vocabulary_composition_build_positions
  for each row execute function private.reject_mock_wordbook_history_change();
create function private.protect_vocabulary_composition_progress_v1()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'composition_progress_immutable' using errcode='42501'; end if;
  if tg_table_name='vocabulary_composition_builds' then
    if (to_jsonb(new)-array['next_row','reviewed_after_row','preparation_complete']) is distinct from
       (to_jsonb(old)-array['next_row','reviewed_after_row','preparation_complete'])
       or new.next_row<old.next_row or new.reviewed_after_row<old.reviewed_after_row
       or (old.preparation_complete and not new.preparation_complete) then
      raise exception 'composition_progress_immutable' using errcode='42501'; end if;
  else
    if (to_jsonb(new)-'processed_count') is distinct from (to_jsonb(old)-'processed_count')
      or new.processed_count<old.processed_count then
      raise exception 'composition_question_plan_immutable' using errcode='42501'; end if;
  end if;
  return new;
end;
$$;
create trigger composition_build_progress before update or delete on private.vocabulary_composition_builds
  for each row execute function private.protect_vocabulary_composition_progress_v1();
create trigger composition_question_plan_progress before update or delete on private.vocabulary_composition_question_plans
  for each row execute function private.protect_vocabulary_composition_progress_v1();

create or replace function private.protect_vocabulary_composition_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; composed boolean; dataset_value uuid;
begin
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) end;
  if tg_table_name='vocab_unit_catalog' then
    select exists(select 1 from private.vocabulary_compositions c join public.vocab_units u on u.dataset_id=c.dataset_id
      where u.id in ((before_row->>'unit_id')::uuid,(after_row->>'unit_id')::uuid)) into composed;
    select dataset_id into dataset_value from public.vocab_units where id=(after_row->>'unit_id')::uuid;
  else
    select exists(select 1 from private.vocabulary_compositions c where c.dataset_id in
      ((before_row->>'dataset_id')::uuid,(after_row->>'dataset_id')::uuid)) into composed;
    dataset_value:=(after_row->>'dataset_id')::uuid;
  end if;
  if composed and tg_op='INSERT' and exists(
    select 1 from private.vocabulary_composition_write_context w
      join private.vocabulary_composition_builds b on b.version_id=w.version_id and b.dataset_id=w.dataset_id
      join private.vocabulary_compositions c on c.version_id=b.version_id and c.dataset_id=b.dataset_id
    where w.backend_pid=pg_backend_pid() and w.transaction_id=txid_current() and w.dataset_id=dataset_value
      and c.state='preparing' and not b.preparation_complete
      and ((w.phase='units' and b.next_row=1 and tg_table_name in('vocab_units','vocab_unit_catalog'))
        or (w.phase='entries' and tg_table_name='vocab_entries' and b.next_row=w.first_row
          and (after_row->>'source_row')::integer between w.first_row and w.last_row))
  ) then return new; end if;
  if composed then raise exception 'composition_content_immutable' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create function private.vocabulary_composition_step_response_v1(p_version_id uuid,p_stage text,p_done integer,p_total integer,p_needs_questions boolean default false)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('versionId',c.version_id,'datasetId',c.dataset_id,'contentHash',c.content_sha256,'state',c.state,
    'stage',p_stage,'done',p_done,'total',p_total,'needsQuestions',p_needs_questions)
  from private.vocabulary_compositions c where c.version_id=p_version_id;
$$;

create function private.initialize_vocabulary_composition_build_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
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
  if found then raise exception 'composition_already_started' using errcode='40001'; end if;
  perform private.assert_vocabulary_library_version_current_v1(v);
  fixed:=v.fixed_composition;
  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,p_actor_id,jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));

  insert into private.vocabulary_compositions(version_id,dataset_id,content_sha256,state,created_by,management_request_id)
    values(v.id,dataset_value,v.content_sha256,'preparing',p_actor_id,p_management_request_id);
  insert into private.vocabulary_composition_builds(version_id,dataset_id,total_count)
    values(v.id,dataset_value,jsonb_array_length(fixed->'includedKeys'));
  insert into private.vocabulary_composition_write_context values(pg_backend_pid(),txid_current(),v.id,dataset_value,'units',0,0);
  with positions as materialized (
    select * from private.vocabulary_composition_positions_v1(fixed)
  ), source_headers as materialized (
    select scope_record.id,scope_record.source_kind,scope_record.source_release_id,scope_record.dataset_id,
      (scope_record.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'] class,
      scope_record.payload->>'name' name
    from private.vocabulary_library_scopes scope_record where scope_record.id in(select scope_id from positions)
  ), blocks as materialized (
    select distinct on (p.unit_no) p.*,count(*) over(partition by p.unit_no)::integer entry_count
    from positions p order by p.unit_no,p.row_no
  ), units as materialized (
    select b.*,extensions.gen_random_uuid() unit_id,scope_record.class,
      left(scope_record.name,120)||case when cardinality(b.scope_ids)>1 then ' 외 '||(cardinality(b.scope_ids)-1)::text||'개 범위의 공통 부분' else '' end unit_name
    from blocks b join source_headers scope_record on scope_record.id=b.scope_id
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

  ) insert into private.vocabulary_composition_build_positions(version_id,row_no,occurrence_key,scope_id,scope_ids,unit_id,position_no)
    select v.id,p.row_no,p.occurrence_key,p.scope_id,p.scope_ids,u.unit_id,p.position_no
    from positions p join units u using(unit_no) join inserted_units i on i.id=u.unit_id;
  insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,academic_year,is_assignable,metadata)
    values(dataset_value,t.metadata->>'title',case when (select count(distinct cat.catalog_group)=1 from public.vocab_unit_catalog cat join public.vocab_units u on u.id=cat.unit_id where u.dataset_id=dataset_value)
      then (select cat.catalog_group from public.vocab_unit_catalog cat join public.vocab_units u on u.id=cat.unit_id where u.dataset_id=dataset_value limit 1) else 'high' end,
      'wordbook',case when length(t.metadata->>'targetGrade')<=24 then t.metadata->>'targetGrade' end,(t.metadata->>'schoolYear')::smallint,false,
      jsonb_build_object('school',t.metadata->'school','audience',case when t.metadata->>'school' is not null then 'school' else 'common' end,'purpose',case when t.metadata->>'purpose' is not null then 'exam_prep' end,'semester',t.metadata->'semester','templateMetadata',t.metadata));

  if (select count(*) from private.vocabulary_composition_build_positions where version_id=v.id)<>jsonb_array_length(fixed->'includedKeys') then
    raise exception 'composition_positions_incomplete' using errcode='40001'; end if;
  delete from private.vocabulary_composition_write_context where backend_pid=pg_backend_pid() and transaction_id=txid_current();
end;
$$;

create function private.insert_vocabulary_composition_entry_batch_v1(p_version_id uuid,p_content_sha256 text,p_dataset_id uuid,p_first integer,p_last integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare written integer;
begin
  with positions as materialized (
    select row_no,occurrence_key,scope_id,scope_ids,unit_id,position_no from private.vocabulary_composition_build_positions
      where version_id=p_version_id and row_no between p_first and p_last order by row_no
  ), source_headers as materialized (
    select s.id,s.source_kind,s.source_release_id,s.dataset_id,
      (s.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'] class
    from private.vocabulary_library_scopes s where s.id in(select scope_id from positions)
  ), inserted_entries as (
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,example_en,example_ko,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      select p_dataset_id,p.row_no,source_entry.headword,source_entry.headword_normalized,source_entry.pronunciation_ko,source_entry.meanings,source_entry.primary_meaning,source_entry.english_definition,source_entry.example_en,source_entry.example_ko,source_entry.source_ref,
        upper(private.reviewed_exam_sha256_v1(jsonb_build_array(p_version_id,p_content_sha256,p.occurrence_key))),p.unit_id,p.position_no,source_entry.entry_type
      from positions p
        join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
        cross join lateral jsonb_populate_record(null::public.vocab_entries,sr.entry_snapshot) source_entry
      returning id,source_row,unit_id,row_sha256
  ) insert into private.vocabulary_composition_entries(version_id,dataset_id,vocab_entry_id,unit_id,occurrence_key,source_entry_id,source_scope_ids,source_kind,source_release_id,entry_sha256,identity_key,source_snapshot,resources,eligible_directions,eligibility_snapshot)
    select p_version_id,p_dataset_id,i.id,i.unit_id,p.occurrence_key,sr.source_entry_id,p.scope_ids,scope_record.source_kind,scope_record.source_release_id,lower(i.row_sha256),
      private.reviewed_exam_sha256_v1(jsonb_build_array('unreviewed-occurrence-v1',p_version_id,p.occurrence_key)),doc.value,
      jsonb_set(doc.value->'resources','{selected}',private.vocabulary_composition_resource_v1(doc.value->'resources')),
      array(select value from jsonb_array_elements_text(eligibility_value.value->'directions')),eligibility_value.value
    from inserted_entries i join positions p on p.row_no=i.source_row
      join source_headers scope_record on scope_record.id=p.scope_id
      join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
      cross join lateral (select jsonb_set(jsonb_build_object('key',sr.occurrence_key,'sourceRow',sr.source_row,'sourceEntryId',sr.source_entry_id,'rowHash',sr.row_sha256,'sourceClassification',scope_record.class,'state',sr.state,'entry',sr.entry_snapshot,'occurrence',sr.occurrence_snapshot,'resources',sr.resources-'linkRecordHash'),'{resources,linkRecordHashes}',
        (select jsonb_agg(distinct r.resources->'linkRecordHash' order by r.resources->'linkRecordHash') from private.vocabulary_library_scope_rows r
          where r.scope_id=any(p.scope_ids) and r.occurrence_key=p.occurrence_key)) value offset 0) doc
      cross join lateral (select private.vocabulary_source_eligibility_v1(scope_record.source_kind,scope_record.source_release_id,sr.source_entry_id,scope_record.dataset_id,sr.row_sha256) value offset 0) eligibility_value;

  get diagnostics written=row_count;
  if written<>p_last-p_first+1 then raise exception 'composition_entry_batch_incomplete' using errcode='40001'; end if;
  return written;
end;
$$;

create function private.copy_vocabulary_reviewed_batch_v1(p_version_id uuid,p_dataset_id uuid,p_after_row integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare target_entry private.vocabulary_composition_entries; old_item private.reviewed_exam_items;
  choice_ids bigint[]; choice_pron jsonb; choice_id bigint; new_choice bigint; choice_resource jsonb; proof jsonb; item_doc jsonb; item_hash text;
  last_row integer:=p_after_row;
begin
  for target_entry in select l.* from private.vocabulary_composition_entries l join public.vocab_entries e on e.id=l.vocab_entry_id
    where l.version_id=p_version_id and l.source_kind='reviewed_exam' and e.source_row>p_after_row order by e.source_row limit 100 loop
    for old_item in select * from private.reviewed_exam_items where release_id=target_entry.source_release_id and vocab_entry_id=target_entry.source_entry_id loop
      choice_ids:='{}'; choice_pron:='[]';
      foreach choice_id in array old_item.choice_vocab_entry_ids loop
        select vocab_entry_id into new_choice from private.vocabulary_composition_entries where version_id=p_version_id and source_kind='reviewed_exam' and source_release_id=old_item.release_id and source_entry_id=choice_id;
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
        values(p_version_id,p_dataset_id,target_entry.vocab_entry_id,item_hash,item_hash,old_item.quiz_mode,old_item.direction,'reviewed_item',old_item.release_id,old_item.item_id,old_item.item_sha256,old_item.prompt_role,old_item.choice_role,old_item.prompt,old_item.choice_texts,choice_ids,old_item.correct_choice_index,item_doc->'pronunciation',proof);
    end loop;
    select source_row into last_row from public.vocab_entries where id=target_entry.vocab_entry_id;
  end loop;

  return last_row;
end;
$$;


create function private.assert_vocabulary_composition_build_complete_v1(p_version_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
declare b private.vocabulary_composition_builds;
begin
  select * into b from private.vocabulary_composition_builds where version_id=p_version_id;
  if not found then return; end if;
  if b.next_row<>b.total_count+1
    or (select count(*) from public.vocab_entries where dataset_id=b.dataset_id)<>b.total_count
    or (select count(*) from private.vocabulary_composition_entries where version_id=b.version_id)<>b.total_count
    or exists(select 1 from private.vocabulary_composition_build_positions p
      left join public.vocab_entries e on e.dataset_id=b.dataset_id and e.source_row=p.row_no
      left join private.vocabulary_composition_entries l on l.version_id=b.version_id and l.vocab_entry_id=e.id
      where p.version_id=b.version_id and (e.id is null or l.vocab_entry_id is null or e.unit_id is distinct from p.unit_id
        or e.position_in_unit is distinct from p.position_no or l.unit_id is distinct from p.unit_id
        or l.occurrence_key is distinct from p.occurrence_key or l.source_scope_ids is distinct from p.scope_ids
        or lower(e.row_sha256) is distinct from l.entry_sha256))
    or exists(select 1 from public.vocab_units u where u.dataset_id=b.dataset_id and
      u.entry_count<>(select count(*) from public.vocab_entries e where e.unit_id=u.id and e.dataset_id=b.dataset_id))
    or exists(select 1 from private.vocabulary_composition_entries l join private.reviewed_exam_items o
      on o.release_id=l.source_release_id and o.vocab_entry_id=l.source_entry_id
      left join private.vocabulary_composition_items i on i.version_id=l.version_id and i.vocab_entry_id=l.vocab_entry_id
        and i.source_release_id=o.release_id and i.source_item_id=o.item_id and i.source_item_sha256=o.item_sha256
      where l.version_id=b.version_id and l.source_kind='reviewed_exam' and i.item_id is null) then
    raise exception 'composition_preparation_incomplete' using errcode='40001'; end if;
end;
$$;
create function private.advance_vocabulary_composition_build_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c private.vocabulary_compositions; b private.vocabulary_composition_builds; last_row integer; count_value integer;
begin
  if p_version_id is null or p_content_sha256 is null then raise exception 'composition_version_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
  select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  if not found then
    perform private.initialize_vocabulary_composition_build_v1(p_version_id,p_content_sha256,p_actor_id,p_management_request_id);
    select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  end if;
  if c.content_sha256 is distinct from p_content_sha256 then raise exception 'composition_changed' using errcode='40001'; end if;
  if c.state='ready' then
    select count(*)::integer into count_value from private.vocabulary_composition_entries where version_id=p_version_id;
    return private.vocabulary_composition_step_response_v1(p_version_id,'complete',count_value,count_value); end if;
  if c.management_request_id is distinct from p_management_request_id then
    raise exception 'composition_management_owner_changed' using errcode='40001'; end if;
  select * into b from private.vocabulary_composition_builds where version_id=p_version_id for update;
  if not found then
    select count(*)::integer into count_value from private.vocabulary_composition_entries where version_id=p_version_id;
    return private.vocabulary_composition_step_response_v1(p_version_id,'prepared',count_value,count_value); end if;
  if b.preparation_complete then return private.vocabulary_composition_step_response_v1(p_version_id,'prepared',b.total_count,b.total_count); end if;
  if b.next_row<=b.total_count then
    last_row:=least(b.next_row+499,b.total_count);
    insert into private.vocabulary_composition_write_context values(pg_backend_pid(),txid_current(),b.version_id,b.dataset_id,'entries',b.next_row,last_row);
    perform private.insert_vocabulary_composition_entry_batch_v1(b.version_id,c.content_sha256,b.dataset_id,b.next_row,last_row);
    update private.vocabulary_composition_builds set next_row=last_row+1 where version_id=b.version_id;
    delete from private.vocabulary_composition_write_context where backend_pid=pg_backend_pid() and transaction_id=txid_current();
    return private.vocabulary_composition_step_response_v1(p_version_id,'entries',last_row,b.total_count);
  end if;
  last_row:=private.copy_vocabulary_reviewed_batch_v1(b.version_id,b.dataset_id,b.reviewed_after_row);
  update private.vocabulary_composition_builds set reviewed_after_row=last_row where version_id=b.version_id;
  if exists(select 1 from private.vocabulary_composition_entries l join public.vocab_entries e on e.id=l.vocab_entry_id
    where l.version_id=b.version_id and l.source_kind='reviewed_exam' and e.source_row>last_row) then
    return private.vocabulary_composition_step_response_v1(p_version_id,'reviewed',last_row,b.total_count); end if;
  perform private.assert_vocabulary_composition_build_complete_v1(b.version_id);
  update private.vocabulary_composition_builds set preparation_complete=true where version_id=b.version_id;
  return private.vocabulary_composition_step_response_v1(p_version_id,'prepared',b.total_count,b.total_count);
end;
$$;

create function public.advance_vocabulary_template_book_v1(p_request jsonb)
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
  result:=private.advance_vocabulary_composition_build_v1(version_value,p_request->>'contentHash',auth.uid(),null);
  if cached.request_id is null then
    insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_value,request_hash_value,jsonb_build_object('materializingVersion',version_value));
  end if;
  return result;
end;
$$;
create function private.advance_vocabulary_composition_management_v1(p_project_ref text,p_approval_id text,p_request_id uuid,p_version_id uuid,p_content_sha256 text)
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
  return private.advance_vocabulary_composition_build_v1(p_version_id,p_content_sha256,null,p_request_id);
end;
$$;
create or replace function private.prepare_vocabulary_composition_data_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
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
  if found then
    if exists(select 1 from private.vocabulary_composition_builds where version_id=p_version_id and not preparation_complete) then
      raise exception 'composition_preparation_incomplete' using errcode='40001'; end if;
    return private.vocabulary_composition_response_v1(p_version_id,true);
  end if;
  perform private.assert_vocabulary_library_version_current_v1(v);
  fixed:=v.fixed_composition;
  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;
  select * into t from private.vocabulary_library_templates where id=v.template_id for share;
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(dataset_value,'vocabulary-composed-'||p_version_id::text,t.metadata->>'title','템플릿에서 고른 원자료 범위',upper(v.content_sha256),
      jsonb_array_length(fixed->'includedKeys'),'pending_review',true,p_actor_id,jsonb_build_object('questionBankKind','vocabulary_composition_v1','templateId',v.template_id,'templateVersionId',v.id,'canonicalApproved',false));
  with positions as materialized (
    select * from private.vocabulary_composition_positions_v1(fixed)
  ), source_headers as materialized (
    select scope_record.id,scope_record.source_kind,scope_record.source_release_id,scope_record.dataset_id,
      (scope_record.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'] class,
      scope_record.payload->>'name' name
    from private.vocabulary_library_scopes scope_record where scope_record.id in(select scope_id from positions)
  ), blocks as materialized (
    select distinct on (p.unit_no) p.*,count(*) over(partition by p.unit_no)::integer entry_count
    from positions p order by p.unit_no,p.row_no
  ), units as materialized (
    select b.*,extensions.gen_random_uuid() unit_id,scope_record.class,
      left(scope_record.name,120)||case when cardinality(b.scope_ids)>1 then ' 외 '||(cardinality(b.scope_ids)-1)::text||'개 범위의 공통 부분' else '' end unit_name
    from blocks b join source_headers scope_record on scope_record.id=b.scope_id
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
  ), assigned_positions as materialized (
    select p.*,u.unit_id from positions p join units u using(unit_no) join inserted_units i on i.id=u.unit_id
  ), inserted_entries as (
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,example_en,example_ko,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      select dataset_value,p.row_no,source_entry.headword,source_entry.headword_normalized,source_entry.pronunciation_ko,source_entry.meanings,source_entry.primary_meaning,source_entry.english_definition,source_entry.example_en,source_entry.example_ko,source_entry.source_ref,
        upper(private.reviewed_exam_sha256_v1(jsonb_build_array(v.id,v.content_sha256,p.occurrence_key))),p.unit_id,p.position_no,source_entry.entry_type
      from assigned_positions p
        join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
        cross join lateral jsonb_populate_record(null::public.vocab_entries,sr.entry_snapshot) source_entry
      returning id,source_row,unit_id,row_sha256
  ) insert into private.vocabulary_composition_entries(version_id,dataset_id,vocab_entry_id,unit_id,occurrence_key,source_entry_id,source_scope_ids,source_kind,source_release_id,entry_sha256,identity_key,source_snapshot,resources,eligible_directions,eligibility_snapshot)
    select v.id,dataset_value,i.id,i.unit_id,p.occurrence_key,sr.source_entry_id,p.scope_ids,scope_record.source_kind,scope_record.source_release_id,lower(i.row_sha256),
      private.reviewed_exam_sha256_v1(jsonb_build_array('unreviewed-occurrence-v1',v.id,p.occurrence_key)),doc.value,
      jsonb_set(doc.value->'resources','{selected}',private.vocabulary_composition_resource_v1(doc.value->'resources')),
      array(select value from jsonb_array_elements_text(eligibility_value.value->'directions')),eligibility_value.value
    from inserted_entries i join positions p on p.row_no=i.source_row
      join source_headers scope_record on scope_record.id=p.scope_id
      join private.vocabulary_library_scope_rows sr on sr.scope_id=p.scope_id and sr.occurrence_key=p.occurrence_key
      cross join lateral (select jsonb_set(jsonb_build_object('key',sr.occurrence_key,'sourceRow',sr.source_row,'sourceEntryId',sr.source_entry_id,'rowHash',sr.row_sha256,'sourceClassification',scope_record.class,'state',sr.state,'entry',sr.entry_snapshot,'occurrence',sr.occurrence_snapshot,'resources',sr.resources-'linkRecordHash'),'{resources,linkRecordHashes}',
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
  return private.vocabulary_composition_response_v1(v.id,true);
end;
$$;
create function private.insert_vocabulary_composition_question_batch_v1(p_version_id uuid,p_questions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare c private.vocabulary_compositions; v private.vocabulary_library_versions; q jsonb;
  target_entry private.vocabulary_composition_entries; e public.vocab_entries; choice public.vocab_entries;
  choice_lineage private.vocabulary_composition_entries; choice_id bigint; choice_ids bigint[]; texts text[];
  direction_value text; expected_prompt text; choice_pron jsonb; proof jsonb; item_doc jsonb; item_hash text; bank_hash text;
begin
  select * into c from private.vocabulary_compositions where version_id=p_version_id;
  if not found or c.state<>'preparing' or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>500 then
    raise exception 'composition_question_batch_invalid' using errcode='22023'; end if;
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
end;
$$;

create function private.validate_vocabulary_composition_question_plan_v1(p_version_id uuid,p_questions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>40000 then
    raise exception 'composition_questions_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q) is distinct from 'object') then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where
    not(q ?& array['vocabEntryId','direction','prompt','choices','choiceVocabEntryIds','correctChoiceIndex'])
    or (select count(*) from jsonb_object_keys(q))<>6 or jsonb_typeof(q->'vocabEntryId') is distinct from 'number'
    or q->>'vocabEntryId' !~ '^[1-9][0-9]*$' or jsonb_typeof(q->'correctChoiceIndex') is distinct from 'number'
    or q->>'correctChoiceIndex' !~ '^[0-3]$' or coalesce(q->>'direction','') not in('english_to_korean','korean_to_english')
    or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_typeof(q->'choiceVocabEntryIds') is distinct from 'array') then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_array_length(q->'choices')<>4 or jsonb_array_length(q->'choiceVocabEntryIds')<>4
    or exists(select 1 from jsonb_array_elements(q->'choices') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}'))<1)
    or exists(select 1 from jsonb_array_elements(q->'choiceVocabEntryIds') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-9][0-9]*$')) then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if (select count(distinct (q->>'vocabEntryId',q->>'direction')) from jsonb_array_elements(p_questions) q)<>jsonb_array_length(p_questions) then
    raise exception 'composition_question_plan_invalid' using errcode='22023'; end if;
  -- Check the complete plan before accepting it. Only scalar entry columns are
  -- joined here; the original per-item validator still builds the frozen proof.
  if exists(with documents as materialized (
      select q,(q->>'vocabEntryId')::bigint id,q->>'direction' direction from jsonb_array_elements(p_questions) q
    ) select 1 from documents d left join private.vocabulary_composition_entries l on l.version_id=p_version_id and l.vocab_entry_id=d.id
      left join public.vocab_entries e on e.id=l.vocab_entry_id and lower(e.row_sha256)=l.entry_sha256
      where l.vocab_entry_id is null or l.source_kind='reviewed_exam' or not(d.direction=any(l.eligible_directions)) or e.id is null
        or d.q->>'prompt' is distinct from case d.direction when 'english_to_korean' then e.headword else e.primary_meaning end
        or (d.q->'choiceVocabEntryIds'->>((d.q->>'correctChoiceIndex')::integer))::bigint<>e.id) then
    raise exception 'composition_question_plan_target_invalid' using errcode='22023'; end if;
  if exists(with documents as materialized (
      select q,ordinality n,(q->>'vocabEntryId')::bigint id,q->>'direction' direction from jsonb_array_elements(p_questions) with ordinality x(q,ordinality)
    ), choices as materialized (
      select d.n,d.direction,d.id,(x.value#>>'{}')::bigint choice_id,d.q->'choices'->>(x.ordinality::integer-1) text
      from documents d cross join lateral jsonb_array_elements(d.q->'choiceVocabEntryIds') with ordinality x
    ) select 1 from choices d join public.vocab_entries target on target.id=d.id
      left join private.vocabulary_composition_entries l on l.version_id=p_version_id and l.vocab_entry_id=d.choice_id
      left join public.vocab_entries e on e.id=l.vocab_entry_id and lower(e.row_sha256)=l.entry_sha256
      where l.vocab_entry_id is null or l.source_kind='reviewed_exam' or not(d.direction=any(l.eligible_directions)) or e.id is null
        or d.text is distinct from case d.direction when 'english_to_korean' then e.primary_meaning else e.headword end
        or (d.id<>d.choice_id and (lower(normalize(trim(e.headword),NFKC))=lower(normalize(trim(target.headword),NFKC))
          or lower(normalize(trim(e.primary_meaning),NFKC))=lower(normalize(trim(target.primary_meaning),NFKC))))
    union all select 1 from choices group by n having count(distinct choice_id)<>4
      or count(distinct lower(regexp_replace(normalize(trim(text),NFKC),'\s+',' ','g')))<>4) then
    raise exception 'composition_question_plan_choices_invalid' using errcode='22023'; end if;
end;
$$;

create function private.advance_vocabulary_composition_questions_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c private.vocabulary_compositions; v private.vocabulary_library_versions; plan private.vocabulary_composition_question_plans;
  batch jsonb; last_row integer; bank_hash text; count_value integer;
begin
  select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  if not found then raise exception 'composition_missing' using errcode='P0002'; end if;
  if c.content_sha256 is distinct from p_content_sha256 then raise exception 'composition_changed' using errcode='40001'; end if;
  if c.state='ready' then
    select count(*)::integer into count_value from private.vocabulary_composition_items where version_id=p_version_id;
    return private.vocabulary_composition_step_response_v1(p_version_id,'complete',count_value,count_value); end if;
  if exists(select 1 from private.vocabulary_composition_builds where version_id=p_version_id and not preparation_complete) then
    raise exception 'composition_preparation_incomplete' using errcode='40001'; end if;
  select * into plan from private.vocabulary_composition_question_plans where version_id=p_version_id for update;
  if not found then
    if p_questions is null then return private.vocabulary_composition_step_response_v1(p_version_id,'prepared',0,0,true); end if;
    if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>40000 then
      raise exception 'composition_questions_invalid' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q) is distinct from 'object'
      or jsonb_typeof(q->'vocabEntryId') is distinct from 'number' or q->>'vocabEntryId' !~ '^[1-9][0-9]*$'
      or coalesce(q->>'direction','') not in('english_to_korean','korean_to_english'))
      or (select count(distinct (q->>'vocabEntryId',q->>'direction')) from jsonb_array_elements(p_questions) q)<>jsonb_array_length(p_questions) then
      raise exception 'composition_question_plan_invalid' using errcode='22023'; end if;
    perform private.validate_vocabulary_composition_question_plan_v1(p_version_id,p_questions);
    -- A fully checked plan is accepted once. Each bounded write also retains
    -- the unchanged validator and exact resource/proof hashing.
    insert into private.vocabulary_composition_question_plans(version_id,content_sha256,plan_sha256,payload,total_count)
      values(p_version_id,p_content_sha256,private.reviewed_exam_sha256_v1(p_questions),p_questions,jsonb_array_length(p_questions)) returning * into plan;
  elsif plan.content_sha256 is distinct from p_content_sha256 or (p_questions is not null
    and private.reviewed_exam_sha256_v1(p_questions) is distinct from plan.plan_sha256) then
    raise exception 'composition_question_plan_changed' using errcode='40001';
  end if;
  if plan.processed_count<plan.total_count then
    last_row:=least(plan.processed_count+500,plan.total_count);
    select jsonb_agg(value order by ordinality) into batch from jsonb_array_elements(plan.payload) with ordinality
      where ordinality>plan.processed_count and ordinality<=last_row;
    perform private.insert_vocabulary_composition_question_batch_v1(p_version_id,batch);
    update private.vocabulary_composition_question_plans set processed_count=last_row where version_id=p_version_id;
    -- Final publication is always a separate step, keeping a batch independent
    -- of the full-source recheck and preserving completed work on conflict.
    return private.vocabulary_composition_step_response_v1(p_version_id,'questions',last_row,plan.total_count);
  end if;
  perform private.assert_vocabulary_composition_build_complete_v1(p_version_id);
  if (select count(*) from private.vocabulary_composition_items where version_id=p_version_id and source_kind='generated_meaning')<>plan.total_count
    or exists(select 1 from jsonb_array_elements(plan.payload) q left join private.vocabulary_composition_items i
      on i.version_id=p_version_id and i.source_kind='generated_meaning' and i.vocab_entry_id=(q->>'vocabEntryId')::bigint and i.direction::text=q->>'direction'
      where i.item_id is null or i.prompt is distinct from q->>'prompt' or to_jsonb(i.choice_texts) is distinct from q->'choices'
        or to_jsonb(i.choice_vocab_entry_ids) is distinct from q->'choiceVocabEntryIds' or i.correct_choice_index is distinct from (q->>'correctChoiceIndex')::integer) then
    raise exception 'composition_question_plan_incomplete' using errcode='40001'; end if;
  select * into v from private.vocabulary_library_versions where id=p_version_id;
  perform private.assert_vocabulary_library_version_current_v1(v);
  perform 1 from public.vocab_entry_quiz_eligibility q join private.vocabulary_composition_entries l on l.source_entry_id=q.vocab_entry_id
    where l.version_id=c.version_id order by q.vocab_entry_id,q.quiz_mode for share of q;
  if exists(select 1 from private.vocabulary_composition_entries l where l.version_id=c.version_id and l.eligibility_snapshot is distinct from
    private.vocabulary_source_eligibility_v1(l.source_kind,l.source_release_id,l.source_entry_id,(l.source_snapshot#>>'{entry,dataset_id}')::uuid,l.source_snapshot#>>'{entry,row_sha256}'))
    then raise exception 'composition_source_eligibility_changed' using errcode='40001'; end if;
  select private.reviewed_exam_sha256_v1(coalesce(jsonb_agg(item_sha256 order by item_id),'[]')) into bank_hash from private.vocabulary_composition_items where version_id=c.version_id;
  update private.vocabulary_compositions set state='ready',question_sha256=bank_hash where version_id=c.version_id;
  update public.vocab_datasets set status='ready' where id=c.dataset_id;
  update public.vocab_dataset_catalog set is_assignable=(select count(distinct vocab_entry_id)>=4 from private.vocabulary_composition_items where version_id=c.version_id) where dataset_id=c.dataset_id;

  return private.vocabulary_composition_step_response_v1(p_version_id,'complete',plan.total_count,plan.total_count);
end;
$$;
create function public.advance_vocabulary_composition_questions_v1(p_version_id uuid,p_content_sha256 text,p_questions jsonb default null)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
begin
  if (select auth.role()) is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if exists(select 1 from private.vocabulary_compositions where version_id=p_version_id and management_request_id is not null) then
    raise exception 'composition_management_completion_required' using errcode='42501'; end if;
  return private.advance_vocabulary_composition_questions_v1(p_version_id,p_content_sha256,p_questions);
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
  if exists(select 1 from private.vocabulary_composition_builds where version_id=p_version_id and not preparation_complete)
    or exists(select 1 from private.vocabulary_composition_question_plans where version_id=p_version_id) then
    raise exception 'composition_bounded_completion_required' using errcode='40001'; end if;
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
create function private.advance_vocabulary_composition_management_questions_v1(p_request_id uuid,p_file_sha256 text)
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
  result:=private.advance_vocabulary_composition_questions_v1(request.version_id,request.content_sha256,questions);
  if result->>'state'<>'ready' then return result; end if;
  result:=private.vocabulary_composition_response_v1(request.version_id,true);
  insert into private.vocabulary_composition_management_results(request_id,file_sha256,result) values(p_request_id,p_file_sha256,result);
  delete from private.vocabulary_composition_management_chunks where request_id=p_request_id;
  return result;
end;
$$;

alter function public.advance_vocabulary_template_book_v1(jsonb) set statement_timeout='55s';
alter function private.advance_vocabulary_composition_management_v1(text,text,uuid,uuid,text) set statement_timeout='55s';
alter function private.advance_vocabulary_composition_management_questions_v1(uuid,text) set statement_timeout='55s';
revoke all on function
  private.protect_vocabulary_composition_progress_v1(),
  private.vocabulary_composition_step_response_v1(uuid,text,integer,integer,boolean),
  private.initialize_vocabulary_composition_build_v1(uuid,text,uuid,uuid),
  private.insert_vocabulary_composition_entry_batch_v1(uuid,text,uuid,integer,integer),
  private.copy_vocabulary_reviewed_batch_v1(uuid,uuid,integer),
  private.assert_vocabulary_composition_build_complete_v1(uuid),
  private.advance_vocabulary_composition_build_v1(uuid,text,uuid,uuid),
  private.advance_vocabulary_composition_management_v1(text,text,uuid,uuid,text),
  private.insert_vocabulary_composition_question_batch_v1(uuid,jsonb),
  private.validate_vocabulary_composition_question_plan_v1(uuid,jsonb),
  private.advance_vocabulary_composition_questions_v1(uuid,text,jsonb),
  private.advance_vocabulary_composition_management_questions_v1(uuid,text),
  public.advance_vocabulary_template_book_v1(jsonb),
  public.advance_vocabulary_composition_questions_v1(uuid,text,jsonb)
from public,anon,authenticated,service_role;
grant execute on function public.advance_vocabulary_template_book_v1(jsonb) to authenticated;
grant execute on function public.advance_vocabulary_composition_questions_v1(uuid,text,jsonb) to service_role;
