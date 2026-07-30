begin;

create function private.configure_assignment_delivery_v1(
  p_assignment_id uuid,
  p_timing_mode text,
  p_question_time_limit_seconds integer
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_timing_mode not in ('total', 'per_question')
    or (
      p_timing_mode = 'total'
      and p_question_time_limit_seconds is not null
    )
    or (
      p_timing_mode = 'per_question'
      and (
        p_question_time_limit_seconds is null
        or p_question_time_limit_seconds not between 5 and 600
      )
    )
  then
    raise exception 'invalid_timing_settings' using errcode = '22023';
  end if;

  perform 1
  from public.assignments
  where id = p_assignment_id
  for update;

  if not found then
    raise exception 'assignment_not_found' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
  ) then
    raise exception 'assignment_already_started' using errcode = '22023';
  end if;

  update public.assignments
  set timing_mode = p_timing_mode,
      question_time_limit_seconds = p_question_time_limit_seconds,
      updated_at = now()
  where id = p_assignment_id;
end;
$$;

create or replace function public.configure_assignment_delivery_v1(
  p_assignment_id uuid,
  p_timing_mode text,
  p_question_time_limit_seconds integer
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.configure_assignment_delivery_v1(
    p_assignment_id,
    p_timing_mode,
    p_question_time_limit_seconds
  );
$$;

revoke all on function private.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) from public, anon, authenticated;
grant execute on function private.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) to authenticated, service_role;

revoke all on function public.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) from public, anon;
grant execute on function public.configure_assignment_delivery_v1(
  uuid,
  text,
  integer
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
