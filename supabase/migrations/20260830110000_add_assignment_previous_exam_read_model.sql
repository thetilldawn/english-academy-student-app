begin;

-- The planner needs one compatible exam for the currently selected
-- student+dataset pair. Returning only that row avoids loading every selected
-- student's full assignment history into the browser.
create function public.get_admin_assignment_previous_exam_v1(
  p_student_id uuid,
  p_dataset_id uuid
)
returns table (
  assignment_id uuid,
  assignment_title text,
  assignment_purpose text,
  student_id uuid,
  student_name text,
  dataset_id uuid,
  dataset_title text,
  assigned_at timestamptz,
  missed_at timestamptz,
  available_from timestamptz,
  available_until timestamptz,
  english_to_korean_ratio smallint,
  time_limit_seconds integer,
  timing_mode text,
  question_time_limit_seconds integer,
  passing_score smallint,
  retry_enabled boolean,
  retry_passing_score smallint,
  question_order_mode text
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null or p_dataset_id is null then
    raise exception 'invalid_assignment_previous_exam_request'
      using errcode = '22023';
  end if;

  return query
  select
    assignment.id,
    assignment.title,
    assignment.assignment_purpose::text,
    recipient.student_id,
    student.display_name,
    assignment.dataset_id,
    dataset.title,
    recipient.assigned_at,
    recipient.missed_at,
    assignment.available_from,
    assignment.available_until,
    assignment.english_to_korean_ratio,
    assignment.time_limit_seconds,
    assignment.timing_mode::text,
    assignment.question_time_limit_seconds,
    assignment.passing_score,
    assignment.retry_enabled,
    assignment.retry_passing_score,
    assignment.question_order_mode::text
  from public.assignment_students as recipient
  join public.assignments as assignment
    on assignment.id = recipient.assignment_id
  join public.students as student
    on student.id = recipient.student_id
  join public.vocab_datasets as dataset
    on dataset.id = assignment.dataset_id
  where recipient.student_id = p_student_id
    and assignment.dataset_id = p_dataset_id
    and recipient.cancelled_at is null
    and assignment.deleted_at is null
    and assignment.assignment_purpose <> 'review'
    and student.deleted_at is null
    and student.status = 'active'
    and assignment.english_to_korean_ratio in (0, 50, 100)
    and (
      assignment.timing_mode = 'none'
      or (
        assignment.timing_mode = 'total'
        and assignment.time_limit_seconds > 0
      )
      or (
        assignment.timing_mode = 'per_question'
        and assignment.question_time_limit_seconds > 0
      )
    )
  order by
    coalesce(assignment.available_from, recipient.assigned_at) desc,
    recipient.assigned_at desc,
    assignment.id desc
  limit 1;
end;
$$;

revoke all on function public.get_admin_assignment_previous_exam_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_assignment_previous_exam_v1(
  uuid, uuid
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
