-- Enforce the 60-day idle timeout for sessions created before rolling renewal.
update public.student_sessions
set expires_at = least(
  expires_at,
  last_seen_at + interval '60 days'
)
where revoked_at is null
  and expires_at > last_seen_at + interval '60 days';

create or replace function public.refresh_student_session_v1(
  p_token_hash text
)
returns table (
  session_id uuid,
  expires_at timestamptz
)
language sql
security invoker
set search_path = ''
as $$
  update public.student_sessions as session
  set
    last_seen_at = clock_timestamp(),
    expires_at = clock_timestamp() + interval '60 days'
  from public.students as student
  where session.token_hash = p_token_hash
    and session.student_id = student.id
    and session.revoked_at is null
    and session.expires_at > clock_timestamp()
    and session.last_seen_at + interval '60 days' > clock_timestamp()
    and student.deleted_at is null
    and student.status = 'active'
    and student.code_generation = session.code_generation
  returning session.id, session.expires_at;
$$;

revoke all on function public.refresh_student_session_v1(text)
  from public, anon, authenticated;
grant execute on function public.refresh_student_session_v1(text)
  to service_role;
