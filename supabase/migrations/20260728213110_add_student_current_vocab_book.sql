alter table public.students
  add column current_vocab_book text,
  add constraint students_current_vocab_book_length_check
    check (
      current_vocab_book is null
      or char_length(trim(current_vocab_book)) between 1 and 160
    );

comment on column public.students.current_vocab_book is
  '관리자가 기록하는 학생의 현재 학습 단어장 표시명';

create function private.create_student_with_code(
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_current_vocab_book text,
  p_note text,
  p_lookup_hmac text,
  p_encrypted_code text,
  p_encryption_iv text,
  p_encryption_tag text
)
returns table (student_id uuid, code_generation integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_student_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.students (
    display_name,
    school_name,
    grade_label,
    current_vocab_book,
    note,
    status,
    code_generation,
    created_by
  )
  values (
    trim(p_display_name),
    nullif(trim(p_school_name), ''),
    nullif(trim(p_grade_label), ''),
    nullif(trim(p_current_vocab_book), ''),
    nullif(trim(p_note), ''),
    'active',
    1,
    (select auth.uid())
  )
  returning id into created_student_id;

  insert into public.student_codes (
    student_id,
    lookup_hmac,
    encrypted_code,
    encryption_iv,
    encryption_tag,
    code_generation,
    status
  )
  values (
    created_student_id,
    p_lookup_hmac,
    p_encrypted_code,
    p_encryption_iv,
    p_encryption_tag,
    1,
    'active'
  );

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id
  )
  values (
    'student.created',
    (select auth.uid()),
    created_student_id
  );

  return query select created_student_id, 1;
end;
$$;

create function public.create_student_with_code(
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_current_vocab_book text,
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
    p_current_vocab_book,
    p_note,
    p_lookup_hmac,
    p_encrypted_code,
    p_encryption_iv,
    p_encryption_tag
  );
$$;

revoke all on function private.create_student_with_code(
  text, text, text, text, text, text, text, text, text
) from public, anon;
revoke all on function public.create_student_with_code(
  text, text, text, text, text, text, text, text, text
) from public, anon;

grant execute on function private.create_student_with_code(
  text, text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.create_student_with_code(
  text, text, text, text, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
