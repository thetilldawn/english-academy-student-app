begin;

alter table private.current_wrong_review_assignment_requests
  add column selection_sha256 text check (selection_sha256 is null or selection_sha256 ~ '^[0-9a-f]{64}$');

create function private.current_wrong_review_selection_sha256_v1(
  p_expected uuid[],p_selected uuid[],p_excluded uuid[],p_selection text,p_material text,p_questions jsonb
) returns text language sql immutable set search_path='' as $$
  select encode(extensions.digest(convert_to(jsonb_build_object(
    'expected',p_expected,'selected',p_selected,'excluded',p_excluded,
    'selection',p_selection,'material',p_material,'questions',p_questions)::text,'UTF8'),'sha256'),'hex');
$$;

create function private.current_wrong_review_material_fingerprint_v1(p_dataset_id uuid,p_questions jsonb,p_source_question_ids uuid[])
returns text language plpgsql security definer set search_path='' as $$
declare reference_ids bigint[]; selected_ids bigint[]; evidence jsonb; plan jsonb; material_kind text; active_release uuid;
begin
  if p_dataset_id is null or p_questions is null or jsonb_typeof(p_questions)<>'array'
    or jsonb_array_length(p_questions)>400 or p_source_question_ids is null or cardinality(p_source_question_ids)>400 then
    raise exception 'invalid_current_wrong_review_material' using errcode='22023';
  end if;
  -- Parent locks also exclude new child rows while the final save is checked.
  perform id from public.vocab_datasets where id=p_dataset_id for update;
  if not found then raise exception 'wrong_review_dataset_unavailable' using errcode='22023'; end if;
  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id) then
    material_kind:='composition';
    perform id from private.vocabulary_library_versions where id in (select version_id from private.vocabulary_compositions where dataset_id=p_dataset_id) order by id for update;
    perform version_id from private.vocabulary_compositions where dataset_id=p_dataset_id for share;
    if jsonb_array_length(p_questions)>0 then plan:=private.vocabulary_composition_plan_from_choices_v1(p_dataset_id,p_questions,'book_meaning_choice'); end if;
  elsif exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then
    material_kind:='reviewed';
    perform release_id from private.reviewed_exam_releases where dataset_id=p_dataset_id order by release_id for update;
    if jsonb_array_length(p_questions)>0 then plan:=private.reviewed_exam_plan_from_choices_v1(p_dataset_id,p_questions,'book_meaning_choice'); end if;
  else
    select release_id into active_release from word_index.app_exam_use_release where dataset_id=p_dataset_id and status='active' for update;
    material_kind:=case when active_release is null then 'ordinary' else 'exam_use' end;
  end if;
  select coalesce(array_agg(distinct entry_id order by entry_id),'{}'::bigint[]) into selected_ids from (
    select (q->>'vocab_entry_id')::bigint entry_id from jsonb_array_elements(p_questions) q
    union all select choice::bigint from jsonb_array_elements(p_questions) q cross join lateral jsonb_array_elements_text(q->'choice_vocab_entry_ids') choice
  ) ids;
  if cardinality(selected_ids)>2000 or exists(select 1 from unnest(selected_ids) id where id is null or id<1) then
    raise exception 'invalid_current_wrong_review_material_entries' using errcode='22023';
  end if;
  perform id from public.quiz_questions where id=any(p_source_question_ids) order by id for share;
  select coalesce(array_agg(distinct id order by id),'{}'::bigint[]) into reference_ids from (
    select unnest(selected_ids) id union all
    select vocab_entry_id from public.quiz_questions where id=any(p_source_question_ids)
  ) refs;
  -- Choice availability and stored prompt collisions can depend on another
  -- entry in this dataset. Hash the pool inside the database; only its digest
  -- crosses the server boundary, including when every target is excluded.
  select coalesce(array_agg(id order by id),'{}'::bigint[]) into reference_ids from public.vocab_entries where dataset_id=p_dataset_id;
  if material_kind='ordinary' then
    perform quiz_mode from public.vocab_dataset_capabilities where dataset_id=p_dataset_id order by quiz_mode for share;
    perform package_snapshot_sha256 from word_index.vocab_link_import_run where dataset_id=p_dataset_id and status='complete'
      and package_snapshot_sha256 in (select details->>'packageSnapshotSha256' from public.vocab_dataset_capabilities where dataset_id=p_dataset_id)
      order by package_snapshot_sha256 for share;
  end if;
  perform id from public.vocab_entries where dataset_id=p_dataset_id and id=any(reference_ids) order by id for update;
  if (select count(*) from public.vocab_entries where dataset_id=p_dataset_id and id=any(selected_ids))<>cardinality(selected_ids) then
    raise exception 'wrong_review_material_entries_changed' using errcode='40001';
  end if;
  evidence:=jsonb_build_object('version',1,'kind',material_kind,'dataset',p_dataset_id,'questions',p_questions,'plan',plan,
    'sources',p_source_question_ids,
    'sourceQuestions',(select jsonb_agg(to_jsonb(q) order by q.id) from public.quiz_questions q where q.id=any(p_source_question_ids)),
    'entries',(select jsonb_agg(to_jsonb(e) order by e.id) from public.vocab_entries e where e.dataset_id=p_dataset_id and e.id=any(reference_ids)));
  if material_kind='exam_use' then
    perform vocab_entry_id from word_index.app_exam_use_occurrence where release_id=active_release and vocab_entry_id=any(reference_ids) order by vocab_entry_id for share;
    if (select count(*) from word_index.app_exam_use_occurrence where release_id=active_release and vocab_entry_id=any(selected_ids))<>cardinality(selected_ids) then
      raise exception 'wrong_review_material_occurrences_changed' using errcode='40001';
    end if;
    evidence:=evidence||jsonb_build_object(
      'release',(select to_jsonb(r) from word_index.app_exam_use_release r where r.release_id=active_release),
      'occurrences',(select jsonb_agg(to_jsonb(o) order by o.vocab_entry_id) from word_index.app_exam_use_occurrence o where o.release_id=active_release and o.vocab_entry_id=any(reference_ids)));
  elsif material_kind='composition' then
    perform vocab_entry_id from private.vocabulary_composition_entries where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) order by vocab_entry_id for share;
    perform item_id from private.vocabulary_composition_items where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) and quiz_mode='book_meaning_choice' order by item_id for share;
    evidence:=evidence||jsonb_build_object(
      'composition',(select to_jsonb(c) from private.vocabulary_compositions c where dataset_id=p_dataset_id),
      'targets',(select jsonb_agg(to_jsonb(e) order by vocab_entry_id) from private.vocabulary_composition_entries e where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids)),
      'items',(select jsonb_agg(to_jsonb(i) order by item_id) from private.vocabulary_composition_items i where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) and quiz_mode='book_meaning_choice'));
  elsif material_kind='reviewed' then
    perform vocab_entry_id from private.reviewed_exam_entries where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) order by release_id,vocab_entry_id for share;
    perform item_id from private.reviewed_exam_items where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) and quiz_mode='book_meaning_choice' order by release_id,item_id for share;
    evidence:=evidence||jsonb_build_object(
      'releases',(select jsonb_agg(to_jsonb(r) order by release_id) from private.reviewed_exam_releases r where dataset_id=p_dataset_id),
      'targets',(select jsonb_agg(to_jsonb(e) order by release_id,vocab_entry_id) from private.reviewed_exam_entries e where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids)),
      'items',(select jsonb_agg(to_jsonb(i) order by release_id,item_id) from private.reviewed_exam_items i where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) and quiz_mode='book_meaning_choice'));
  elsif material_kind='ordinary' then
    perform vocab_entry_id from word_index.vocab_entry_link where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) order by vocab_entry_id for share;
    perform vocab_entry_id from public.vocab_entry_quiz_eligibility where dataset_id=p_dataset_id and vocab_entry_id=any(reference_ids) order by vocab_entry_id,quiz_mode for share;
    evidence:=evidence||jsonb_build_object(
      'dataset',(select to_jsonb(d) from public.vocab_datasets d where d.id=p_dataset_id),
      'links',(select jsonb_agg(to_jsonb(l) order by l.vocab_entry_id) from word_index.vocab_entry_link l where l.dataset_id=p_dataset_id and l.vocab_entry_id=any(reference_ids)),
      'eligibility',(select jsonb_agg(to_jsonb(e) order by e.vocab_entry_id,e.quiz_mode) from public.vocab_entry_quiz_eligibility e where e.dataset_id=p_dataset_id and e.vocab_entry_id=any(reference_ids)),
      'capabilities',(select jsonb_agg(to_jsonb(c) order by c.quiz_mode) from public.vocab_dataset_capabilities c where c.dataset_id=p_dataset_id),
      'imports',(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from word_index.vocab_link_import_run r where r.dataset_id=p_dataset_id and r.status='complete'
        and r.package_snapshot_sha256 in (select details->>'packageSnapshotSha256' from public.vocab_dataset_capabilities where dataset_id=p_dataset_id)));
  end if;
  return encode(extensions.digest(convert_to(evidence::text,'UTF8'),'sha256'),'hex');
end;
$$;
create function public.get_current_wrong_review_material_fingerprint_v1(p_dataset_id uuid,p_questions jsonb,p_source_question_ids uuid[])
returns text language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return private.current_wrong_review_material_fingerprint_v1(p_dataset_id,p_questions,p_source_question_ids);
end;
$$;
revoke all on function private.current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
revoke all on function public.get_current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.get_current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[]) to authenticated;

-- Copy the current guarded implementation into a separate private boundary.
-- Every old public entry point retains its original full-set equality rule.
do $migration$
declare definition text; patch record; new_arguments text;
begin
  new_arguments := 'p_questions jsonb, p_expected_source_question_ids uuid[], p_excluded_source_question_ids uuid[], p_selection_sha256 text, p_material_sha256 text)';
  definition := replace(pg_get_functiondef('public.create_current_wrong_review_assignment_v1(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)'::regprocedure),chr(13),'');
  for patch in select * from (values
    ('CREATE OR REPLACE FUNCTION public.create_current_wrong_review_assignment_v1(', 'CREATE OR REPLACE FUNCTION private.create_current_wrong_review_selection_v1('),
    ('p_questions jsonb)', new_arguments),
    (E'  insert into private.current_wrong_review_assignment_requests (', $replacement$
  if p_expected_source_question_ids is null or p_excluded_source_question_ids is null
    or cardinality(p_expected_source_question_ids) not between 1 and 400
    or cardinality(p_expected_source_question_ids) <> (select count(distinct id) from unnest(p_expected_source_question_ids) id where id is not null)
    or cardinality(p_excluded_source_question_ids) <> (select count(distinct id) from unnest(p_excluded_source_question_ids) id where id is not null)
    or not (p_excluded_source_question_ids <@ p_expected_source_question_ids)
    or p_source_question_ids && p_excluded_source_question_ids
    or cardinality(p_expected_source_question_ids) <> cardinality(p_source_question_ids) + cardinality(p_excluded_source_question_ids)
    or p_source_question_ids is distinct from array(select id from unnest(p_expected_source_question_ids) with ordinality as expected(id,position) where id=any(p_source_question_ids) order by position)
    or p_selection_sha256 is null or p_selection_sha256 !~ '^[0-9a-f]{64}$'
    or p_material_sha256 is null or p_material_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'invalid_current_wrong_review_selection' using errcode='22023';
  end if;
  insert into private.current_wrong_review_assignment_requests ($replacement$),
    (E'  if request_row.assignment_id is not null then', $replacement$
  if request_row.selection_sha256 is distinct from private.current_wrong_review_selection_sha256_v1(
    p_expected_source_question_ids,p_source_question_ids,p_excluded_source_question_ids,p_selection_sha256,p_material_sha256,p_questions) then
    raise exception 'idempotency_key_reused' using errcode='23505';
  end if;
  if request_row.assignment_id is not null then$replacement$),
    (E'  select array_agg(\n    candidate.source_question_id', $replacement$
  if p_material_sha256 is distinct from private.current_wrong_review_material_fingerprint_v1(p_dataset_id,p_questions,p_expected_source_question_ids) then
    raise exception 'current_wrong_review_material_changed' using errcode='40001';
  end if;
  select array_agg(
    candidate.source_question_id$replacement$),
    ('if current_source_question_ids is distinct from p_source_question_ids then', 'if current_source_question_ids is distinct from p_expected_source_question_ids then'),
    (E'  perform private.configure_assignment_retry_v1(', $replacement$
  if p_material_sha256 is distinct from private.current_wrong_review_material_fingerprint_v1(p_dataset_id,p_questions,p_expected_source_question_ids) then
    raise exception 'current_wrong_review_material_changed' using errcode='40001';
  end if;
  perform private.configure_assignment_retry_v1($replacement$)
  ) as patches(old_text,new_text) loop
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text) <> 1 then
      raise exception 'partial_wrong_review_core_anchor_changed: %',left(patch.old_text,90);
    end if;
    definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;

  definition := replace(pg_get_functiondef('public.create_current_wrong_review_assignment_v2(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,timestamptz,text,integer,jsonb)'::regprocedure),chr(13),'');
  for patch in select * from (values
    ('CREATE OR REPLACE FUNCTION public.create_current_wrong_review_assignment_v2(', 'CREATE OR REPLACE FUNCTION public.create_current_wrong_review_assignment_v3('),
    ('p_questions jsonb)', new_arguments),
    (E'    schedule_sha256\n  ) values (', E'    schedule_sha256,\n    selection_sha256\n  ) values ('),
    (E'    schedule_sha256_value\n  ) on conflict', E'    schedule_sha256_value,\n    private.current_wrong_review_selection_sha256_v1(p_expected_source_question_ids,p_source_question_ids,p_excluded_source_question_ids,p_selection_sha256,p_material_sha256,p_questions)\n  ) on conflict'),
    ('    or request_row.schedule_sha256 is distinct from schedule_sha256_value', E'    or request_row.schedule_sha256 is distinct from schedule_sha256_value\n    or request_row.selection_sha256 is distinct from private.current_wrong_review_selection_sha256_v1(p_expected_source_question_ids,p_source_question_ids,p_excluded_source_question_ids,p_selection_sha256,p_material_sha256,p_questions)'),
    ('public.create_current_wrong_review_assignment_v1(', 'private.create_current_wrong_review_selection_v1('),
    (E'    p_questions\n  );', E'    p_questions,\n    p_expected_source_question_ids,p_excluded_source_question_ids,p_selection_sha256,p_material_sha256\n  );')
  ) as patches(old_text,new_text) loop
    if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text) <> 1 then
      raise exception 'partial_wrong_review_public_anchor_changed: %',left(patch.old_text,90);
    end if;
    definition:=replace(definition,patch.old_text,patch.new_text);
  end loop;
  execute definition;
end;
$migration$;

revoke all on function private.current_wrong_review_selection_sha256_v1(uuid[],uuid[],uuid[],text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.create_current_wrong_review_selection_v1(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,text,integer,jsonb,uuid[],uuid[],text,text) from public,anon,authenticated,service_role;
revoke all on function public.create_current_wrong_review_assignment_v3(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,timestamptz,text,integer,jsonb,uuid[],uuid[],text,text) from public,anon,authenticated,service_role;
grant execute on function public.create_current_wrong_review_assignment_v3(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,timestamptz,text,integer,jsonb,uuid[],uuid[],text,text) to authenticated;
commit;
