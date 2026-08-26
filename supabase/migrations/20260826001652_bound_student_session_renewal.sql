begin;

-- Proxy must stay a fast cookie-only boundary. Rolling renewal is an explicit
-- same-origin command and may write at most once per 24-hour interval.
create function public.renew_student_session_v2(
  p_token_hash text
)
returns table (
  session_id uuid,
  expires_at timestamptz,
  renew_after timestamptz,
  server_now timestamptz,
  renewed boolean
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  evaluation_at constant timestamptz := clock_timestamp();
  renewed_session_id uuid;
  renewed_expires_at timestamptz;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'service_role required'
      using errcode = '42501';
  end if;

  if p_token_hash is null or char_length(trim(p_token_hash)) < 16 then
    raise exception 'invalid_student_session_renewal'
      using errcode = '22023';
  end if;

  update public.student_sessions as session
  set
    last_seen_at = evaluation_at,
    expires_at = evaluation_at + interval '60 days'
  from public.students as student
  where session.token_hash = p_token_hash
    and session.student_id = student.id
    and session.revoked_at is null
    and session.expires_at > evaluation_at
    and session.last_seen_at + interval '60 days' > evaluation_at
    and session.last_seen_at <= evaluation_at - interval '24 hours'
    and student.deleted_at is null
    and student.status = 'active'
    and student.code_generation = session.code_generation
  returning session.id, session.expires_at
  into renewed_session_id, renewed_expires_at;

  if renewed_session_id is not null then
    return query
    select
      renewed_session_id,
      renewed_expires_at,
      evaluation_at + interval '24 hours',
      evaluation_at,
      true;
    return;
  end if;

  return query
  select
    session.id,
    session.expires_at,
    session.last_seen_at + interval '24 hours',
    evaluation_at,
    false
  from public.student_sessions as session
  join public.students as student
    on student.id = session.student_id
  where session.token_hash = p_token_hash
    and session.revoked_at is null
    and session.expires_at > evaluation_at
    and session.last_seen_at + interval '60 days' > evaluation_at
    and student.deleted_at is null
    and student.status = 'active'
    and student.code_generation = session.code_generation;
end;
$$;

revoke all on function public.renew_student_session_v2(text)
  from public, anon, authenticated;
grant execute on function public.renew_student_session_v2(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
