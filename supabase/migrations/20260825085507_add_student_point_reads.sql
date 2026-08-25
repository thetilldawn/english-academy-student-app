begin;

create function public.list_student_point_totals_v1(
  p_student_ids uuid[]
)
returns table (
  student_id uuid,
  current_points bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with requested_students as (
    select distinct requested.student_id
    from unnest(coalesce(p_student_ids, '{}'::uuid[]))
      as requested(student_id)
    where requested.student_id is not null
  )
  select
    requested.student_id,
    greatest(coalesce(total.total_points, 0::bigint), 0::bigint)
      as current_points
  from requested_students as requested
  left join public.student_point_totals as total
    on total.student_id = requested.student_id;
$$;

create function public.get_quiz_attempt_point_summary_v1(
  p_student_id uuid,
  p_attempt_id uuid
)
returns table (
  event_count bigint,
  correct_reward bigint,
  wrong_effect bigint,
  net_change bigint,
  current_points bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with attempt_summary as (
    select
      count(*)::bigint as event_count,
      coalesce(
        sum(event.delta) filter (where event.delta > 0),
        0::bigint
      )::bigint as correct_reward,
      coalesce(
        sum(event.delta) filter (where event.delta < 0),
        0::bigint
      )::bigint as wrong_effect,
      coalesce(sum(event.delta), 0::bigint)::bigint as net_change
    from public.student_point_events as event
    where event.student_id = p_student_id
      and event.quiz_attempt_id = p_attempt_id
      and event.event_kind = 'quiz_outcome'
  )
  select
    summary.event_count,
    summary.correct_reward,
    summary.wrong_effect,
    summary.net_change,
    greatest(coalesce(total.total_points, 0::bigint), 0::bigint)
      as current_points
  from attempt_summary as summary
  left join public.student_point_totals as total
    on total.student_id = p_student_id;
$$;

revoke all on function public.list_student_point_totals_v1(uuid[])
  from public, anon, authenticated, service_role;
grant execute on function public.list_student_point_totals_v1(uuid[])
  to service_role;

revoke all on function public.get_quiz_attempt_point_summary_v1(uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_quiz_attempt_point_summary_v1(uuid, uuid)
  to service_role;

notify pgrst, 'reload schema';

commit;
