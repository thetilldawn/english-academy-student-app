begin;
alter table private.reviewed_exam_items add unique(release_id,item_id,item_sha256);
alter table public.assignments
  add column reviewed_exam_release_id_snapshot uuid references private.reviewed_exam_releases(release_id),
  add column reviewed_exam_file_sha256_snapshot text check(reviewed_exam_file_sha256_snapshot is null or reviewed_exam_file_sha256_snapshot ~ '^[0-9a-f]{64}$');
alter table public.assignment_questions
  add column reviewed_exam_release_id_snapshot uuid,
  add column reviewed_exam_item_id_snapshot text,
  add column reviewed_exam_item_sha256_snapshot text,
  add foreign key(reviewed_exam_release_id_snapshot,reviewed_exam_item_id_snapshot,reviewed_exam_item_sha256_snapshot)
    references private.reviewed_exam_items(release_id,item_id,item_sha256);
alter table public.assignments drop constraint assignments_quiz_content_mode_check,
  drop constraint assignments_provenance_status_check;
alter table public.assignments add constraint assignments_quiz_content_mode_check check(quiz_content_mode in
  ('legacy_book_meaning_choice','book_meaning_choice','canonical_definition_to_headword','canonical_example_to_headword','canonical_headword_to_definition')),
  add constraint assignments_provenance_status_check check(provenance_status in('legacy_backfill','verified_v2','preview_verified_v1','exam_reviewed_v1'));
alter table public.assignment_questions drop constraint assignment_questions_eligibility_mode_check,
  drop constraint assignment_questions_provenance_status_check;
alter table public.assignment_questions add constraint assignment_questions_eligibility_mode_check check(eligibility_quiz_mode is null or eligibility_quiz_mode in
  ('book_meaning_en_to_ko','book_meaning_ko_to_en','canonical_definition_to_headword','canonical_example_to_headword','canonical_headword_to_definition')),
  add constraint assignment_questions_provenance_status_check check(provenance_status in('legacy_backfill','verified_v2','preview_verified_v1','exam_reviewed_v1'));

-- Keep every legacy condition intact. A new source has its own mandatory proof.
do $migration$
declare definition text;
begin
  select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.assignments'::regclass and conname='assignments_canonical_preview_v1_check';
  execute 'alter table public.assignments drop constraint assignments_canonical_preview_v1_check';
  execute 'alter table public.assignments add constraint assignments_canonical_preview_v1_check check ((provenance_status = ''exam_reviewed_v1'') or (' || substring(definition from 8 for char_length(definition)-8) || '))';
end;
$migration$;
alter table public.assignments add constraint assignments_reviewed_exam_v1_check check (
  (provenance_status<>'exam_reviewed_v1' and reviewed_exam_release_id_snapshot is null and reviewed_exam_file_sha256_snapshot is null and quiz_content_mode<>'canonical_headword_to_definition')
  or coalesce((provenance_status='exam_reviewed_v1' and question_bank_version=4 and generator_version='reviewed-exam-bank-v1'
    and reviewed_exam_release_id_snapshot is not null and reviewed_exam_file_sha256_snapshot is not null
    and canonical_question_release_id_snapshot is null and canonical_question_package_sha256_snapshot is null
    and question_bank_sha256 is not null and dataset_source_sha256_snapshot is not null
    and ((quiz_content_mode='book_meaning_choice' and english_to_korean_ratio in(0,50,100))
      or (quiz_content_mode='canonical_definition_to_headword' and english_to_korean_ratio=0)
      or (quiz_content_mode='canonical_headword_to_definition' and english_to_korean_ratio=100))),false)
);
alter table public.assignment_questions add constraint assignment_questions_reviewed_exam_v1_check check (
  (provenance_status<>'exam_reviewed_v1' and reviewed_exam_release_id_snapshot is null and reviewed_exam_item_id_snapshot is null and reviewed_exam_item_sha256_snapshot is null)
  or coalesce((provenance_status='exam_reviewed_v1' and reviewed_exam_release_id_snapshot is not null and reviewed_exam_item_id_snapshot is not null
    and reviewed_exam_item_sha256_snapshot is not null and dataset_id is not null and entry_row_sha256_snapshot is not null
    and headword_snapshot is not null and primary_meaning_snapshot is not null and question_content_sha256 is not null
    and generator_version_snapshot='reviewed-exam-bank-v1' and content_origin='book_occurrence'
    and cardinality(choice_vocab_entry_ids)=4 and array_position(choice_vocab_entry_ids,null) is null
    and cardinality(array_positions(choice_vocab_entry_ids,vocab_entry_id))=1
    and choice_vocab_entry_ids[correct_choice_index+1]=vocab_entry_id and correct_answer_snapshot=choices->>correct_choice_index
    and ((eligibility_quiz_mode in('book_meaning_en_to_ko','canonical_headword_to_definition') and direction='english_to_korean')
      or (eligibility_quiz_mode in('book_meaning_ko_to_en','canonical_definition_to_headword') and direction='korean_to_english'))),false)
);

-- Reuse the existing legacy validator for queued delivery. Only actor identity
-- and the already-validated timing update differ; release safety guards remain.
do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  definition:=replace(pg_get_functiondef('private.create_assignment_with_canonical_question_bank_preview_v1(text,uuid,uuid[],integer,integer,smallint,boolean,smallint,public.question_order_mode,uuid,text,integer,text,uuid,text,jsonb)'::regprocedure),chr(13),'');
  definition:=replace(definition,'private.create_assignment_with_canonical_question_bank_preview_v1(p_title text,','private.create_canonical_bank_for_delivery_v1(p_actor_admin_id uuid, p_title text,');
  if position('private.create_canonical_bank_for_delivery_v1' in definition)=0 then raise exception 'canonical_delivery_clone_signature_changed'; end if;
  definition:=replace(definition,'(select private.is_active_admin())','(p_actor_admin_id is not null and exists(select 1 from public.admin_profiles where user_id=p_actor_admin_id and is_active))');
  definition:=replace(definition,'(select auth.uid())','p_actor_admin_id');
  old_fragment:=E'perform private.configure_assignment_delivery_v1(\n    created_assignment_id, p_timing_mode, p_question_time_limit_seconds\n  );';
  new_fragment:='update public.assignments set timing_mode=p_timing_mode,question_time_limit_seconds=p_question_time_limit_seconds where id=created_assignment_id;';
  if position(old_fragment in definition)=0 then raise exception 'canonical_delivery_clone_timing_changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  execute definition;
end;
$migration$;

create function private.create_reviewed_bank_for_delivery_v1(
  p_actor_admin_id uuid,p_title text,p_dataset_id uuid,p_unit_ids uuid[],p_question_count integer,
  p_english_to_korean_ratio smallint,p_time_limit_seconds integer,p_passing_score smallint,
  p_question_order_mode public.question_order_mode,p_available_until timestamptz,p_student_ids uuid[],
  p_timing_mode text,p_question_time_limit_seconds integer,p_questions jsonb,p_exact_review boolean default false
) returns uuid language plpgsql security definer set search_path='' as $$
declare
  first_descriptor jsonb; descriptor jsonb; target jsonb; release_value uuid; mode_value text; bank_source text;
  release_row private.reviewed_exam_releases%rowtype; source_item private.reviewed_exam_items%rowtype;
  source_entry private.reviewed_exam_entries%rowtype; dataset_row public.vocab_datasets%rowtype;
  assignment_value uuid; min_row integer; max_row integer; hashes text[]:='{}'; question_hash text;
  legacy_targets jsonb; actual_english integer; expected_english integer;
begin
  if p_actor_admin_id is null or not exists(select 1 from public.admin_profiles where user_id=p_actor_admin_id and is_active) then raise exception 'queue_actor_admin_inactive' using errcode='42501'; end if;
  if p_questions is null or jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions)<>p_question_count
    or p_question_count not between (case when p_exact_review then 1 else 4 end) and (case when p_exact_review then 400 else 500 end) or p_english_to_korean_ratio not in(0,50,100)
    or p_timing_mode not in('none','total','per_question')
    or (p_timing_mode in('none','total') and p_question_time_limit_seconds is not null)
    or (p_timing_mode='per_question' and (p_question_time_limit_seconds is null or p_question_time_limit_seconds not between 5 and 600))
    or p_student_ids is null or cardinality(p_student_ids)<>1
    or p_unit_ids is null or cardinality(p_unit_ids)<1
    or (select count(distinct v) from unnest(p_unit_ids) v)<>cardinality(p_unit_ids)
  then raise exception 'reviewed_assignment_settings_invalid' using errcode='22023'; end if;
  perform 1 from public.students where id=p_student_ids[1] and status='active' and deleted_at is null for update;
  if not found then raise exception 'student_not_active'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q)<>'object' or not(q?'reviewed_bank'))
    or exists(select 1 from jsonb_array_elements(p_questions) q cross join lateral jsonb_object_keys(q) k where k not in('vocab_entry_id','base_order_index','direction','reviewed_bank'))
    or exists(select 1 from jsonb_array_elements(p_questions) q cross join lateral jsonb_object_keys(q->'reviewed_bank') k where k not in('source','mode','release_id','package_sha256','question_item_id','question_item_sha256'))
  then raise exception 'reviewed_assignment_payload_not_id_only' using errcode='22023'; end if;
  if (select count(distinct(q->>'vocab_entry_id')::bigint)<>p_question_count or count(distinct(q->>'base_order_index')::int)<>p_question_count
    or min((q->>'base_order_index')::int)<>1 or max((q->>'base_order_index')::int)<>p_question_count from jsonb_array_elements(p_questions) q)
  then raise exception 'reviewed_assignment_plan_invalid' using errcode='22023'; end if;
  first_descriptor:=p_questions->0->'reviewed_bank';
  release_value:=(first_descriptor->>'release_id')::uuid; mode_value:=first_descriptor->>'mode'; bank_source:=first_descriptor->>'source';
  if bank_source is null or bank_source not in('reviewed_exam_v1','canonical_legacy') or mode_value is null or release_value is null
    or first_descriptor->>'package_sha256' !~ '^[0-9a-f]{64}$'
    or exists(select 1 from jsonb_array_elements(p_questions) q where
      ((q->'reviewed_bank')-'question_item_id'-'question_item_sha256') is distinct from (first_descriptor-'question_item_id'-'question_item_sha256'))
  then raise exception 'reviewed_assignment_mixed_release' using errcode='22023'; end if;
  select count(*) filter(where q->>'direction'='english_to_korean') into actual_english from jsonb_array_elements(p_questions) q;
  expected_english:=round(p_question_count*p_english_to_korean_ratio/100.0)::int;
  if actual_english<>expected_english or exists(select 1 from jsonb_array_elements(p_questions) q where q->>'direction' is null or q->>'direction' not in('english_to_korean','korean_to_english')) then raise exception 'reviewed_assignment_direction_mismatch' using errcode='22023'; end if;
  if bank_source='canonical_legacy' then
    if p_english_to_korean_ratio<>0 or mode_value not in('canonical_definition_to_headword','canonical_example_to_headword') then raise exception 'canonical_delivery_mode_invalid' using errcode='22023'; end if;
    select jsonb_agg(jsonb_build_object('vocab_entry_id',q->'vocab_entry_id','base_order_index',q->'base_order_index',
      'question_item_id',q#>'{reviewed_bank,question_item_id}','question_item_sha256',q#>'{reviewed_bank,question_item_sha256}') order by (q->>'base_order_index')::int)
      into legacy_targets from jsonb_array_elements(p_questions) q;
    assignment_value:=private.create_canonical_bank_for_delivery_v1(p_actor_admin_id,p_title,p_dataset_id,p_unit_ids,p_question_count,p_time_limit_seconds,p_passing_score,false,null,
      p_question_order_mode,p_student_ids[1],p_timing_mode,p_question_time_limit_seconds,mode_value,release_value,first_descriptor->>'package_sha256',legacy_targets);
    update public.assignments set available_until=p_available_until where id=assignment_value;
    return assignment_value;
  end if;
  if (mode_value='canonical_definition_to_headword' and p_english_to_korean_ratio<>0)
    or (mode_value='canonical_headword_to_definition' and p_english_to_korean_ratio<>100)
    or mode_value not in('book_meaning_choice','canonical_definition_to_headword','canonical_headword_to_definition')
    or (p_exact_review and mode_value<>'book_meaning_choice')
  then raise exception 'reviewed_assignment_mode_invalid' using errcode='22023'; end if;
  select * into release_row from private.reviewed_exam_releases where release_id=release_value and dataset_id=p_dataset_id and status='active' and file_sha256=first_descriptor->>'package_sha256' for share;
  if not found then raise exception 'reviewed_exam_release_unavailable' using errcode='55000'; end if;
  select * into dataset_row from public.vocab_datasets where id=p_dataset_id and status='ready' and is_active for share;
  if not found then raise exception 'dataset_not_ready' using errcode='55000'; end if;
  if (select count(*) from public.vocab_units where dataset_id=p_dataset_id and id=any(p_unit_ids))<>cardinality(p_unit_ids) then raise exception 'unit_dataset_mismatch' using errcode='22023'; end if;
  perform private.resolve_contiguous_unit_direction_v1(p_dataset_id,p_unit_ids);
  select min(e.source_row),max(e.source_row) into min_row,max_row from public.vocab_entries e join jsonb_array_elements(p_questions) q on e.id=(q->>'vocab_entry_id')::bigint where e.dataset_id=p_dataset_id;
  insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,available_until,timing_mode,question_time_limit_seconds)
    values(p_title,p_dataset_id,min_row,max_row,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,'initial',false,'draft',p_actor_admin_id,'units',p_question_order_mode,4,p_available_until,p_timing_mode,p_question_time_limit_seconds) returning id into assignment_value;
  insert into public.assignment_units(assignment_id,dataset_id,unit_id,position)
    select assignment_value,p_dataset_id,u.id,u.n::int from unnest(p_unit_ids) with ordinality u(id,n);
  insert into public.assignment_students(assignment_id,student_id,assigned_by) values(assignment_value,p_student_ids[1],p_actor_admin_id);
  for target in select value from jsonb_array_elements(p_questions) order by (value->>'base_order_index')::int loop
    descriptor:=target->'reviewed_bank';
    select i.* into source_item from private.reviewed_exam_items i join public.vocab_entries e on e.id=i.vocab_entry_id
      where i.release_id=release_value and i.dataset_id=p_dataset_id and i.vocab_entry_id=(target->>'vocab_entry_id')::bigint
        and i.item_id=descriptor->>'question_item_id' and i.item_sha256=descriptor->>'question_item_sha256'
        and i.quiz_mode=mode_value and i.direction::text=target->>'direction' and e.unit_id=any(p_unit_ids) for share of i;
    if not found then raise exception 'reviewed_assignment_snapshot_mismatch' using errcode='55000'; end if;
    select * into source_entry from private.reviewed_exam_entries where release_id=release_value and vocab_entry_id=source_item.vocab_entry_id;
    if not exists(select 1 from public.vocab_entries where id=source_entry.vocab_entry_id and lower(row_sha256)=source_entry.entry_sha256) then raise exception 'reviewed_assignment_entry_changed' using errcode='55000'; end if;
    question_hash:=upper(private.reviewed_exam_sha256_v1(jsonb_build_object('itemSha256',source_item.item_sha256,'order',target->'base_order_index')));
    hashes:=array_append(hashes,question_hash);
    insert into public.assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id,entry_row_sha256_snapshot,
      eligibility_quiz_mode,eligibility_input_hash_snapshot,headword_snapshot,headword_normalized_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,correct_answer_snapshot,
      content_origin,eligibility_rule_version_snapshot,generator_version_snapshot,question_content_sha256,provenance,provenance_status,
      reviewed_exam_release_id_snapshot,reviewed_exam_item_id_snapshot,reviewed_exam_item_sha256_snapshot)
    values(assignment_value,source_item.vocab_entry_id,(target->>'base_order_index')::int,source_item.direction,source_item.prompt,to_jsonb(source_item.choice_texts),source_item.correct_choice_index,p_dataset_id,upper(source_entry.entry_sha256),
      case when mode_value='book_meaning_choice' then case when source_item.direction='english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end else mode_value end,
      upper(source_item.item_sha256),source_entry.payload->>'headword',lower(normalize(trim(source_entry.payload->>'headword'),NFKC)),source_entry.payload->>'korean_meaning',source_item.choice_vocab_entry_ids,source_item.choice_texts[source_item.correct_choice_index+1],
      'book_occurrence','reviewed-exam-bundle-v1','reviewed-exam-bank-v1',question_hash,
      jsonb_build_object('releaseId',release_value,'inputContentSha256',release_row.content_sha256,'reviews',release_row.reviews,'definitionProvenance',source_entry.payload->'definition_provenance','promptRole',source_item.prompt_role,'choiceRole',source_item.choice_role),
      'exam_reviewed_v1',release_value,source_item.item_id,source_item.item_sha256);
  end loop;
  if exists(select 1 from public.assignment_questions q where q.assignment_id=assignment_value
    and (select count(distinct lower(regexp_replace(normalize(btrim(c),NFKC),'\s+',' ','g')))
      from jsonb_array_elements_text(q.choices) c)<>4)
  then raise exception 'assignment_target_choices_duplicate' using errcode='22023'; end if;
  -- Reviewed MCQs may share a genuine synonym gloss in separate questions.
  -- Never rewrite source meaning: reject when another correct answer is also
  -- offered in the SAME question. Legacy generated-bank guards remain intact.
  if exists(with normalized as (
    select id,direction,lower(regexp_replace(normalize(btrim(prompt),NFKC),'\s+',' ','g')) prompt_key,
      lower(regexp_replace(normalize(btrim(correct_answer_snapshot),NFKC),'\s+',' ','g')) answer_key,
      array(select lower(regexp_replace(normalize(btrim(c),NFKC),'\s+',' ','g')) from jsonb_array_elements_text(choices) c) choice_keys
    from public.assignment_questions where assignment_id=assignment_value)
    select 1 from normalized a join private.reviewed_exam_items b
      on b.release_id=release_value and b.quiz_mode=mode_value and a.direction=b.direction
      and a.prompt_key=lower(regexp_replace(normalize(btrim(b.prompt),NFKC),'\s+',' ','g'))
      and a.answer_key<>lower(regexp_replace(normalize(btrim(b.choice_texts[b.correct_choice_index+1]),NFKC),'\s+',' ','g'))
    where lower(regexp_replace(normalize(btrim(b.choice_texts[b.correct_choice_index+1]),NFKC),'\s+',' ','g'))=any(a.choice_keys))
  then raise exception 'assignment_target_prompt_ambiguous' using errcode='22023'; end if;
  update public.assignments set quiz_content_mode=mode_value,dataset_source_sha256_snapshot=upper(dataset_row.source_sha256),
    generator_version='reviewed-exam-bank-v1',question_bank_sha256=upper(encode(extensions.digest(convert_to(array_to_string(hashes,'|'),'UTF8'),'sha256'),'hex')),
    provenance_status='exam_reviewed_v1',reviewed_exam_release_id_snapshot=release_value,reviewed_exam_file_sha256_snapshot=release_row.file_sha256,status='active' where id=assignment_value;
  insert into public.audit_events(event_type,actor_admin_id,details) values('assignment.reviewed_exam_created',p_actor_admin_id,
    jsonb_build_object('assignmentId',assignment_value,'releaseId',release_value,'questionCount',p_question_count,'mode',mode_value));
  return assignment_value;
end;
$$;

-- Both direct creation and completion-queue delivery share the same bank writer.
do $migration$
declare definition text; signature text; actor text; needle text; injected text;
begin
  for signature,actor in select * from (values
    ('private.create_assignment_with_delivery_v7(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)','(select auth.uid())'),
    ('private.create_assignment_with_delivery_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)','p_actor_admin_id')
  ) v(signature,actor) loop
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    needle:=E'begin\n';
    injected:=E'begin\n  if jsonb_typeof(p_questions) = ''array'' and exists(select 1 from jsonb_array_elements(p_questions) q where q ? ''reviewed_bank'') then\n'
      ||'    return private.create_reviewed_bank_for_delivery_v1('||actor||E',p_title,p_dataset_id,p_unit_ids,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,p_available_until,p_student_ids,p_timing_mode,p_question_time_limit_seconds,p_questions);\n  end if;\n';
    if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'reviewed_delivery_body_changed'; end if;
    execute replace(definition,needle,injected);
  end loop;
end;
$migration$;
revoke all on function private.create_canonical_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,integer,smallint,boolean,smallint,public.question_order_mode,uuid,text,integer,text,uuid,text,jsonb),
  private.create_reviewed_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb,boolean) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
