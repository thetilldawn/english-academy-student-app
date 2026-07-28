alter function public.create_student_with_code(
  text, text, text, text, text, text, text, text
) set schema private;
alter function public.rotate_student_code(
  uuid, text, text, text, text
) set schema private;
alter function public.set_student_access_status(
  uuid, public.student_status
) set schema private;
alter function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) set schema private;

create function public.create_student_with_code(
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_note text,
  p_lookup_hmac text,
  p_encrypted_code text,
  p_encryption_iv text,
  p_encryption_tag text
)
returns table (student_id uuid, code_generation integer)
language sql
security invoker
set search_path = ''
as $$
  select *
  from private.create_student_with_code(
    p_display_name,
    p_school_name,
    p_grade_label,
    p_note,
    p_lookup_hmac,
    p_encrypted_code,
    p_encryption_iv,
    p_encryption_tag
  );
$$;

create function public.rotate_student_code(
  p_student_id uuid,
  p_lookup_hmac text,
  p_encrypted_code text,
  p_encryption_iv text,
  p_encryption_tag text
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.rotate_student_code(
    p_student_id,
    p_lookup_hmac,
    p_encrypted_code,
    p_encryption_iv,
    p_encryption_tag
  );
$$;

create function public.set_student_access_status(
  p_student_id uuid,
  p_status public.student_status
)
returns integer
language sql
security invoker
set search_path = ''
as $$
  select private.set_student_access_status(
    p_student_id,
    p_status
  );
$$;

create function public.create_assignment_with_students(
  p_title text,
  p_dataset_id uuid,
  p_range_start integer,
  p_range_end integer,
  p_question_count integer,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retake_allowed boolean,
  p_student_ids uuid[]
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_assignment_with_students(
    p_title,
    p_dataset_id,
    p_range_start,
    p_range_end,
    p_question_count,
    p_time_limit_seconds,
    p_passing_score,
    p_retake_allowed,
    p_student_ids
  );
$$;

revoke all on function public.create_student_with_code(
  text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.rotate_student_code(
  uuid, text, text, text, text
) from public, anon;
revoke all on function public.set_student_access_status(
  uuid, public.student_status
) from public, anon;
revoke all on function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) from public, anon;

revoke all on function private.create_student_with_code(
  text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function private.rotate_student_code(
  uuid, text, text, text, text
) from public, anon;
revoke all on function private.set_student_access_status(
  uuid, public.student_status
) from public, anon;
revoke all on function private.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) from public, anon;

grant execute on function public.create_student_with_code(
  text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.rotate_student_code(
  uuid, text, text, text, text
) to authenticated;
grant execute on function public.set_student_access_status(
  uuid, public.student_status
) to authenticated;
grant execute on function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) to authenticated;

grant execute on function private.create_student_with_code(
  text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function private.rotate_student_code(
  uuid, text, text, text, text
) to authenticated;
grant execute on function private.set_student_access_status(
  uuid, public.student_status
) to authenticated;
grant execute on function private.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) to authenticated;
