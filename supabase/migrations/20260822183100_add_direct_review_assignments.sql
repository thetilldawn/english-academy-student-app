begin;

create or replace function public.create_exact_review_assignment_v6(
  p_student_id uuid,
  p_dataset_id uuid,
  p_selected_queue_ids uuid[],
  p_title text,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_exact_review_assignment_v5(
    p_student_id,
    p_dataset_id,
    p_selected_queue_ids,
    p_title,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );
$$;

revoke all on function private.create_exact_review_assignment_v5(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_exact_review_assignment_v5(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function public.create_exact_review_assignment_v6(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_exact_review_assignment_v6(
  uuid, uuid, uuid[], text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
