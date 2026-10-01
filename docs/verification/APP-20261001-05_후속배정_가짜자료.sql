-- Preview only. Run after the b1101001 synthetic four-attempt fixture.
begin;
set local statement_timeout='8s';
do $queue_fixture$
declare
  p constant text := 'b1101001-5a11-4b11-8c11-';
  admin_id uuid := (p||'000000000001')::uuid;
  student_id_value uuid := (p||'000000000002')::uuid;
  dataset_id_value uuid := (p||'000000000003')::uuid;
  unit_id_value uuid := (p||'000000000004')::uuid;
  assignment_id_value uuid := (p||'000000000104')::uuid;
  request_id_value uuid := (p||'000000000401')::uuid;
  series_id_value uuid := (p||'000000000402')::uuid;
  first_item_id uuid := (p||'000000000403')::uuid;
  next_item_id uuid := (p||'000000000404')::uuid;
  release_id_value uuid := (p||'000000000405')::uuid;
  at_time timestamptz := clock_timestamp();
  dataset_key_value text;
  package_hash text := encode(extensions.digest(convert_to('M11-QA-b1101001-20261001-queue-release','UTF8'),'sha256'),'hex');
  plan jsonb;
  common_payload jsonb;
  first_payload jsonb;
  next_payload jsonb;
  receipt jsonb;
begin
  if exists(select 1 from private.vocab_assignment_queue_requests where idempotency_key=request_id_value)
     or exists(select 1 from private.vocab_assignment_series where id=series_id_value)
     or exists(select 1 from private.vocab_assignment_series_items where id in(first_item_id,next_item_id))
     or exists(select 1 from word_index.app_exam_use_release where release_id=release_id_value or package_version=package_hash)
  then raise exception 'm11_queue_fixture_already_exists'; end if;
  select dataset_key into dataset_key_value from public.vocab_datasets
    where id=dataset_id_value and imported_by=admin_id and status='ready' and is_active
      and metadata->>'fixtureOnly'='true';
  if not found or (select count(*) from public.vocab_entries where dataset_id=dataset_id_value)<>4
    or not exists(select 1 from public.quiz_attempts where id=(p||'000000000204')::uuid
      and assignment_id=assignment_id_value and student_id=student_id_value and status='in_progress')
  then raise exception 'm11_queue_fixture_input_mismatch'; end if;

  update public.vocab_datasets set metadata=metadata||jsonb_build_object(
    'projectionProfile','exam_scope_candidate_v1','packageVersion',package_hash,
    'syntheticFixture',true,'testRun','M11-QA-b1101001') where id=dataset_id_value;
  insert into word_index.app_exam_use_release(
    release_id,release_key,dataset_id,dataset_key,schema_version,package_version,
    source_sha256,candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,
    wordbook_id,title,target_environment,common_dictionary_release_allowed,exam_use_import_allowed,
    expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json,activated_at_utc)
  select release_id_value,'m11-qa-b1101001-queue-release',id,dataset_key,'1.0',package_hash,
    lower(source_sha256),package_hash,package_hash,package_hash,'m11-qa-b1101001',
    '[M11 검증] 가짜 후속 배정 자료','preview',false,true,4,4,4,'active',
    '{"syntheticFixture":true,"testRun":"M11-QA-b1101001"}'::jsonb,at_time
  from public.vocab_datasets where id=dataset_id_value;
  insert into word_index.app_exam_use_occurrence(
    release_id,dataset_id,source_row,vocab_entry_id,unit_id,position_in_unit,dictionary_id,
    display_headword,display_gloss_ko,display_pronunciation_review_status,audio_status,listening_enabled,
    occurrence_id,occurrence_content_hash,package_entry_content_hash,exam_review_id,exam_input_hash,
    exam_use_status,context_evidence_status,context_evidence,source_projection_row_sha256,
    source_entry_id,source_entry_sha256,include_in_exam,audio_json,package_entry_json)
  select release_id_value,e.dataset_id,e.source_row,e.id,e.unit_id,e.position_in_unit,
    'word:m11-qa-b1101001-'||e.source_row,e.headword,e.primary_meaning,'candidate','disabled',false,
    'occ:m11-qa-b1101001-'||e.source_row,lower(e.row_sha256),lower(e.row_sha256),
    'exam-review:m11-qa-b1101001-'||e.source_row,lower(e.row_sha256),'reviewed_for_preview',
    'source_entry_context','{"syntheticFixture":true}'::jsonb,lower(e.row_sha256),
    'm11-qa-b1101001-entry-'||e.source_row,lower(e.row_sha256),true,'{}'::jsonb,
    '{"syntheticFixture":true}'::jsonb
  from public.vocab_entries e where e.dataset_id=dataset_id_value;

  select jsonb_agg(jsonb_build_object('vocab_entry_id',e.id,'base_order_index',e.source_row,
    'direction','english_to_korean','choice_vocab_entry_ids',
      (select jsonb_agg(c.id order by c.source_row) from public.vocab_entries c where c.dataset_id=dataset_id_value))
      order by e.source_row)
    into plan from public.vocab_entries e where e.dataset_id=dataset_id_value;
  common_payload:=jsonb_build_object('kind','regular','student_id',student_id_value,
    'dataset_id',dataset_id_value,'unit_ids',jsonb_build_array(unit_id_value),'unit_labels',jsonb_build_array('DAY 1'),
    'question_count',4,'english_to_korean_ratio',100,'time_limit_seconds',60,'passing_score',80,
    'question_order_mode','fixed','timing_mode','total','question_time_limit_seconds',null,
    'retry_enabled',false,'retry_passing_score',null,'session_count',2,'questions',plan);
  first_payload:=common_payload||jsonb_build_object('title','[M11 검증] 경합 4','session_number',1,
    'available_from',at_time-interval '1 minute','available_until',at_time+interval '1 hour');
  next_payload:=common_payload||jsonb_build_object('title','[M11 검증] 후속 배정 2','session_number',2,
    'available_from',at_time+interval '1 day','available_until',at_time+interval '25 hours');
  receipt:=jsonb_build_array(
    jsonb_build_object('student_id',student_id_value,'queue_series_id',series_id_value,'assignment_id',assignment_id_value,'session_number',1,'status','assigned'),
    jsonb_build_object('student_id',student_id_value,'queue_series_id',series_id_value,'assignment_id',null,'session_number',2,'status','queued'));
  insert into private.vocab_assignment_queue_requests(idempotency_key,request_sha256,payload_sha256,actor_admin_id,result,completed_at)
    values(request_id_value,package_hash,package_hash,admin_id,receipt,at_time);
  insert into private.vocab_assignment_series(id,request_id,student_id,dataset_id,exam_use_release_id,
    actor_admin_id,dataset_label,range_label,recurrence_slots,status)
    values(series_id_value,request_id_value,student_id_value,dataset_id_value,release_id_value,admin_id,
      '[M11 검증] 가짜 4단어','DAY 1',
      jsonb_build_array(jsonb_build_object('isodow',1,'local_time','09:00:00','duration_seconds',3600)),'active');
  update public.assignments set available_from=at_time-interval '1 minute',available_until=at_time+interval '1 hour'
    where id=assignment_id_value and created_by=admin_id and dataset_id=dataset_id_value;
  insert into private.vocab_assignment_series_items(id,series_id,sequence_number,status,question_count,unit_ids,unit_labels,
    planned_available_from,planned_available_until,effective_available_from,effective_available_until,payload,assignment_id,materialized_at)
    values(first_item_id,series_id_value,1,'assigned',4,array[unit_id_value],array['DAY 1'],
      at_time-interval '1 minute',at_time+interval '1 hour',at_time-interval '1 minute',at_time+interval '1 hour',
      first_payload,assignment_id_value,at_time);
  insert into private.vocab_assignment_series_items(id,series_id,sequence_number,status,question_count,unit_ids,unit_labels,
    planned_available_from,planned_available_until,effective_available_from,effective_available_until,payload)
    values(next_item_id,series_id_value,2,'queued',4,array[unit_id_value],array['DAY 1'],
      at_time+interval '1 day',at_time+interval '25 hours',at_time+interval '1 day',at_time+interval '25 hours',next_payload);
end $queue_fixture$;
commit;
