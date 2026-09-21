-- Apply only to new profile saves and new assignment commands. Old records and
-- completed command receipts remain readable; automatic follow-up exams are unchanged.
create function private.require_student_profile_values_v1(
  p_display_name text, p_school_name text, p_grade_label text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  whitespace constant text := U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF';
begin
  if nullif(btrim(p_display_name, whitespace), '') is null
    or nullif(btrim(p_school_name, whitespace), '') is null
    or nullif(btrim(p_grade_label, whitespace), '') is null then
    raise exception 'student_profile_required' using errcode = '22023';
  end if;
end;
$$;

create function private.require_complete_student_profiles_v1(p_student_ids uuid[])
returns void language plpgsql security definer set search_path = '' as $$
declare student_row record;
begin
  for student_row in
    select student.display_name, student.school_name, student.grade_label
    from public.students student
    where student.id = any(p_student_ids) and student.deleted_at is null
    order by student.id for update
  loop
    perform private.require_student_profile_values_v1(
      student_row.display_name, student_row.school_name, student_row.grade_label);
  end loop;
end;
$$;
revoke all on function private.require_student_profile_values_v1(text,text,text) from public,anon,authenticated,service_role;
revoke all on function private.require_complete_student_profiles_v1(uuid[]) from public,anon,authenticated,service_role;

-- Fail on a changed source anchor instead of silently losing a guard or replacing
-- an unrelated function. CREATE OR REPLACE retains existing function privileges.
do $migration$
declare target record; original text; anchor_count integer;
begin
  for target in select * from (values
    ('private.create_student_with_code_v2(text,text,text,uuid,text,text,text,text,text)',
      '  insert into public.students (',
      '  perform private.require_student_profile_values_v1(p_display_name,p_school_name,p_grade_label);'),
    ('private.update_admin_student_profile_v1(uuid,timestamptz,text,text,text)',
      '  update public.students as student',
      '  perform private.require_student_profile_values_v1(p_display_name,p_school_name,p_grade_label);'),
    ('private.update_admin_student_profile_v2(uuid,timestamptz,text,text,text,text)',
      '  update public.students as student',
      '  perform private.require_student_profile_values_v1(p_display_name,p_school_name,p_grade_label);'),
    ('private.create_vocab_assignment_queues_v1(uuid,text,jsonb)',
      '  for series_input, series_position in',
      '  perform private.require_complete_student_profiles_v1(array(select distinct (value->>''student_id'')::uuid from jsonb_array_elements(p_series)));'),
    ('private.create_bulk_vocab_assignments_v11(uuid,text,jsonb)',
      '  for batch_row in',
      '  perform private.require_complete_student_profiles_v1(distinct_student_ids);'),
    ('private.create_bulk_vocab_assignments_v7(uuid,text,jsonb)',
      '  for batch_row in',
      '  perform private.require_complete_student_profiles_v1(distinct_student_ids);'),
    ('public.create_bulk_canonical_assignments_preview_v1(uuid,text,jsonb)',
      '  for batch in',
      '  perform private.require_complete_student_profiles_v1(distinct_student_ids);'),
    ('public.create_assignment_with_delivery_v7(text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)',
      '  created_assignment_id := private.create_assignment_with_delivery_v6(',
      '  perform private.require_complete_student_profiles_v1(p_student_ids);'),
    ('public.create_mixed_review_assignment_v10(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)',
      '  created_assignment_id := private.create_mixed_review_assignment_v9(',
      '  perform private.require_complete_student_profiles_v1(array[p_student_id]);'),
    ('public.create_mixed_review_assignment_v8(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)',
      '  created_assignment_id := private.create_mixed_review_assignment_v8(',
      '  perform private.require_complete_student_profiles_v1(array[p_student_id]);'),
    ('public.create_exact_review_assignment_v7(uuid,uuid,uuid[],text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)',
      '  created_assignment_id := private.create_exact_review_assignment_v5(',
      '  perform private.require_complete_student_profiles_v1(array[p_student_id]);'),
    ('public.create_current_wrong_review_assignment_v1(uuid,uuid,smallint[],uuid[],uuid,text,text,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,text,integer,jsonb)',
      E'  select array_agg(\n    candidate.source_question_id',
      '  perform private.require_complete_student_profiles_v1(array[p_student_id]);')
  ) as guards(signature,anchor,guard_sql)
  loop
    original := replace(pg_get_functiondef(target.signature::regprocedure), E'\r\n', E'\n');
    anchor_count := (length(original)-length(replace(original,target.anchor,'')))/length(target.anchor);
    if anchor_count <> 1 then raise exception 'student_profile_guard_anchor_changed: %', target.signature; end if;
    execute replace(original,target.anchor,target.guard_sql || E'\n\n' || target.anchor);
  end loop;
end;
$migration$;

-- Public compatibility entry points can still create new assignments. Guard
-- these wrappers too, leaving their private writers usable by replacement flows.
create or replace function public.create_assignment_with_delivery_v6(
  p_title text,p_dataset_id uuid,p_unit_ids uuid[],p_question_count integer,
  p_english_to_korean_ratio smallint,p_time_limit_seconds integer,p_passing_score smallint,
  p_question_order_mode public.question_order_mode,p_available_until timestamptz,
  p_student_ids uuid[],p_timing_mode text,p_question_time_limit_seconds integer,p_questions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.require_complete_student_profiles_v1(p_student_ids);
  return private.create_assignment_with_delivery_v6(p_title,p_dataset_id,p_unit_ids,p_question_count,
    p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,
    p_available_until,p_student_ids,p_timing_mode,p_question_time_limit_seconds,p_questions);
end;
$$;

create or replace function public.create_mixed_review_assignment_v9(
  p_student_id uuid,p_dataset_id uuid,p_review_levels smallint[],p_review_scope text,
  p_selected_queue_ids uuid[],p_title text,p_primary_unit_ids uuid[],p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,p_passing_score smallint,p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,p_timing_mode text,p_question_time_limit_seconds integer,p_questions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.require_complete_student_profiles_v1(array[p_student_id]);
  return private.create_mixed_review_assignment_v9(p_student_id,p_dataset_id,p_review_levels,p_review_scope,
    p_selected_queue_ids,p_title,p_primary_unit_ids,p_english_to_korean_ratio,p_time_limit_seconds,
    p_passing_score,p_question_order_mode,p_available_until,p_timing_mode,p_question_time_limit_seconds,p_questions);
end;
$$;

create or replace function public.create_exact_review_assignment_v6(
  p_student_id uuid,p_dataset_id uuid,p_selected_queue_ids uuid[],p_title text,
  p_english_to_korean_ratio smallint,p_time_limit_seconds integer,p_passing_score smallint,
  p_question_order_mode public.question_order_mode,p_available_until timestamptz,
  p_timing_mode text,p_question_time_limit_seconds integer,p_questions jsonb
) returns uuid language plpgsql security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.require_complete_student_profiles_v1(array[p_student_id]);
  return private.create_exact_review_assignment_v5(p_student_id,p_dataset_id,p_selected_queue_ids,p_title,
    p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,
    p_available_until,p_timing_mode,p_question_time_limit_seconds,p_questions);
end;
$$;

notify pgrst, 'reload schema';
