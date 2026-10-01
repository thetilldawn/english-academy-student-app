-- Preview wojxpruvbjzbhrpmsbuy only. Never apply as a migration or on Production.
-- Synthetic fixture: no email, password, login code, session or real student data.
begin;
set local statement_timeout = '8s';
do $fixture$
declare
  p constant text := 'a1101001-5a11-4b11-8c11-';
  admin_id uuid := (p || '000000000001')::uuid;
  student_id_value uuid := (p || '000000000002')::uuid;
  dataset_id_value uuid := (p || '000000000003')::uuid;
  unit_id_value uuid := (p || '000000000004')::uuid;
  assignment_id_value uuid;
  attempt_id_value uuid;
  k integer;
begin
  if exists (select 1 from auth.users where id::text like p || '%')
    or exists (select 1 from public.students where id::text like p || '%')
    or exists (select 1 from public.vocab_datasets where id::text like p || '%')
    or exists (select 1 from public.assignments where id::text like p || '%')
    or exists (select 1 from public.quiz_attempts where id::text like p || '%')
    or exists (select 1 from public.quiz_questions where id::text like p || '%')
    or exists (select 1 from public.vocab_datasets where dataset_key='m11-pg2-20261001-a1101001')
  then raise exception 'fixture_prefix_already_used'; end if;
  insert into auth.users(id) values (admin_id);
  insert into public.admin_profiles(user_id,display_name,is_active)
    values (admin_id,'[M11 검증] 가짜 관리자',true);
  insert into public.students(id,display_name,school_name,grade_label,note,status,created_by)
    values (student_id_value,'[M11 검증] 가짜 학생','검증용 가상고','고2',
      'M11-PG2-20261001: 실제 학생 아님','active',admin_id);
  insert into public.vocab_datasets(id,dataset_key,title,source_label,source_sha256,
    row_count,status,is_active,imported_by,metadata)
    values (dataset_id_value,'m11-pg2-20261001-a1101001','[M11 검증] 가짜 4단어',
      '독립 생성한 검증 자료',repeat('A',64),4,'ready',true,admin_id,
      '{"testRun":"M11-PG2-20261001","fixtureOnly":true}'::jsonb);
  insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,
    unit_number,sort_index,entry_count)
    values(unit_id_value,dataset_id_value,'DAY 1','day-1','day',1,1,4);
  insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,
    meanings,primary_meaning,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
    select dataset_id_value,n,'m11fixture'||n,'m11fixture'||n,
      array['가짜 뜻 '||n],'가짜 뜻 '||n,'M11-PG2-20261001',repeat(n::text,64),
      unit_id_value,n,'word' from generate_series(1,4) n;
  for k in 1..3 loop
    assignment_id_value := (p||lpad((100+k)::text,12,'0'))::uuid;
    attempt_id_value := (p||lpad((200+k)::text,12,'0'))::uuid;
    insert into public.assignments(id,title,dataset_id,range_start,range_end,question_count,
      english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,
      retake_allowed,retry_enabled,status,available_from,created_by,range_basis,
      question_order_mode,timing_mode,assignment_purpose,source_kind,points_policy_version)
      values(assignment_id_value,'[M11 검증] 경합 '||k,dataset_id_value,1,4,4,100,60,80,
        'initial',false,false,'active',clock_timestamp()-interval '1 minute',
        admin_id,'source_rows','fixed','total','regular','book','vocab-points-v1');
    insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
      values(assignment_id_value,dataset_id_value,unit_id_value,1,true);
    insert into public.assignment_students(assignment_id,student_id,assigned_by)
      values(assignment_id_value,student_id_value,admin_id);
    insert into public.quiz_attempts(id,student_id,assignment_id,attempt_number,status,phase,
      started_at,deadline_at,current_question_started_at,question_count_snapshot,
      time_limit_seconds_snapshot,passing_score_snapshot,passing_basis_snapshot,point_rule_version_snapshot)
      values(attempt_id_value,student_id_value,assignment_id_value,1,'in_progress','initial',
        clock_timestamp()-interval '50 seconds',clock_timestamp()+interval '1 day',
        clock_timestamp()-interval '5 seconds',4,60,80,'initial','vocab-points-v1');
    insert into public.quiz_questions(id,attempt_id,vocab_entry_id,order_index,direction,
      prompt,choices,correct_choice_index,initial_choice_index,initial_is_correct,initial_answered_at)
      select (p||lpad((300+k*10+e.source_row)::text,12,'0'))::uuid,
        attempt_id_value,e.id,e.source_row,'english_to_korean',e.headword,
        '["가짜 뜻 1","가짜 뜻 2","가짜 뜻 3","가짜 뜻 4"]'::jsonb,
        (e.source_row-1)::smallint,
        case when e.source_row<4 then (e.source_row-1)::smallint end,
        case when e.source_row<4 then true end,
        case when e.source_row<4 then clock_timestamp()-interval '10 seconds' end
        from public.vocab_entries e where e.dataset_id=dataset_id_value;
  end loop;
end $fixture$;
commit;
