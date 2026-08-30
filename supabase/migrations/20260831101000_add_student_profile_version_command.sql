begin;

alter table public.students
  add column profile_updated_at timestamptz;

update public.students
set profile_updated_at = updated_at;

alter table public.students
  alter column profile_updated_at set default clock_timestamp(),
  alter column profile_updated_at set not null;

create function private.get_admin_student_profile_v1(
  p_student_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null then
    raise exception 'invalid_student_profile_request'
      using errcode = '22023';
  end if;

  select jsonb_build_object(
    'id', student.id,
    'displayName', student.display_name,
    'schoolName', student.school_name,
    'gradeLabel', student.grade_label,
    'updatedAt', student.profile_updated_at
  )
  into result
  from public.students as student
  where student.id = p_student_id
    and student.deleted_at is null;

  return result;
end;
$$;

create function public.get_admin_student_profile_v1(
  p_student_id uuid
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.get_admin_student_profile_v1(p_student_id);
$$;

create function public.get_admin_student_detail_initial_v2(
  p_student_id uuid,
  p_snapshot_at timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  detail jsonb;
  profile_version timestamptz;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  detail := public.get_admin_student_detail_initial_v1(
    p_student_id,
    p_snapshot_at
  );
  if detail is null then
    return null;
  end if;

  select student.profile_updated_at
  into profile_version
  from public.students as student
  where student.id = p_student_id
    and student.deleted_at is null;
  if not found then
    return null;
  end if;

  return jsonb_set(
    detail,
    '{student}',
    (detail -> 'student') || jsonb_build_object(
      'updatedAt', profile_version
    ),
    true
  );
end;
$$;

create function private.update_admin_student_profile_v1(
  p_student_id uuid,
  p_base_version timestamptz,
  p_display_name text,
  p_school_name text,
  p_grade_label text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_student public.students%rowtype;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_base_version is null
    or not isfinite(p_base_version)
    or nullif(trim(p_display_name), '') is null
    or char_length(trim(p_display_name)) > 80
    or char_length(trim(coalesce(p_school_name, ''))) > 120
    or char_length(trim(coalesce(p_grade_label, ''))) > 40
  then
    raise exception 'invalid_student_profile_update'
      using errcode = '22023';
  end if;

  update public.students as student
  set display_name = trim(p_display_name),
      school_name = nullif(trim(coalesce(p_school_name, '')), ''),
      grade_label = nullif(trim(coalesce(p_grade_label, '')), ''),
      profile_updated_at = greatest(
        clock_timestamp(),
        student.profile_updated_at + interval '1 microsecond'
      )
  where student.id = p_student_id
    and student.deleted_at is null
    and student.profile_updated_at = p_base_version
  returning student.* into updated_student;

  if not found then
    if not exists (
      select 1
      from public.students as student
      where student.id = p_student_id
        and student.deleted_at is null
    ) then
      raise exception 'student_not_found' using errcode = 'P0002';
    end if;
    raise exception 'student_profile_conflict' using errcode = '40001';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  ) values (
    'student.profile_updated',
    (select auth.uid()),
    updated_student.id,
    jsonb_build_object(
      'display_name', updated_student.display_name,
      'school_name', updated_student.school_name,
      'grade_label', updated_student.grade_label
    )
  );

  return jsonb_build_object(
    'id', updated_student.id,
    'displayName', updated_student.display_name,
    'schoolName', updated_student.school_name,
    'gradeLabel', updated_student.grade_label,
    'updatedAt', updated_student.profile_updated_at
  );
end;
$$;

create function public.update_admin_student_profile_v1(
  p_student_id uuid,
  p_base_version timestamptz,
  p_display_name text,
  p_school_name text,
  p_grade_label text
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.update_admin_student_profile_v1(
    p_student_id,
    p_base_version,
    p_display_name,
    p_school_name,
    p_grade_label
  );
$$;

revoke all on function private.get_admin_student_profile_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_admin_student_profile_v1(uuid)
  from public, anon, service_role;
grant execute on function public.get_admin_student_profile_v1(uuid)
  to authenticated;

revoke all on function public.get_admin_student_detail_initial_v2(
  uuid, timestamptz
) from public, anon, service_role;
grant execute on function public.get_admin_student_detail_initial_v2(
  uuid, timestamptz
) to authenticated;

revoke all on function private.update_admin_student_profile_v1(
  uuid, timestamptz, text, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.update_admin_student_profile_v1(
  uuid, timestamptz, text, text, text
) from public, anon, service_role;
grant execute on function public.update_admin_student_profile_v1(
  uuid, timestamptz, text, text, text
) to authenticated;

notify pgrst, 'reload schema';

commit;
