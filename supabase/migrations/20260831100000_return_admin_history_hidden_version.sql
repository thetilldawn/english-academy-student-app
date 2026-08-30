begin;

create function private.hide_admin_history_entry_v2(
  p_assignment_id uuid,
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_hidden_at timestamptz;
begin
  perform private.hide_admin_history_entry_v1(
    p_assignment_id,
    p_student_id,
    p_attempt_id
  );

  if p_attempt_id is not null then
    select hidden.hidden_at
    into resolved_hidden_at
    from public.admin_history_hidden_entries as hidden
    where hidden.attempt_id = p_attempt_id;
  else
    select hidden.hidden_at
    into resolved_hidden_at
    from public.admin_history_hidden_entries as hidden
    where hidden.attempt_id is null
      and hidden.assignment_id = p_assignment_id
      and hidden.student_id = p_student_id;
  end if;

  if resolved_hidden_at is null then
    raise exception 'history_hide_receipt_missing'
      using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'status', 'hidden',
    'assignmentId', p_assignment_id,
    'studentId', p_student_id,
    'attemptId', p_attempt_id,
    'hiddenAt', resolved_hidden_at
  );
end;
$$;

create function public.hide_admin_history_entry_v2(
  p_assignment_id uuid,
  p_student_id uuid,
  p_attempt_id uuid default null
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.hide_admin_history_entry_v2(
    p_assignment_id,
    p_student_id,
    p_attempt_id
  );
$$;

revoke all on function private.hide_admin_history_entry_v2(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.hide_admin_history_entry_v2(uuid, uuid, uuid)
  from public, anon, service_role;
grant execute on function public.hide_admin_history_entry_v2(uuid, uuid, uuid)
  to authenticated;

notify pgrst, 'reload schema';

commit;
