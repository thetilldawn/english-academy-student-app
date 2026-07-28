alter table public.students
  add column current_vocab_dataset_id uuid,
  add constraint students_current_vocab_dataset_id_fkey
    foreign key (current_vocab_dataset_id)
    references public.vocab_datasets(id)
    on delete restrict;

create index students_current_vocab_dataset_idx
  on public.students (current_vocab_dataset_id)
  where current_vocab_dataset_id is not null;

comment on column public.students.current_vocab_dataset_id is
  '학생이 현재 학습하는 검수 완료 어휘 데이터셋';

create function private.create_student_with_code_v2(
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_current_vocab_dataset_id uuid,
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
  selected_dataset_title text;
  selected_dataset_edition text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_current_vocab_dataset_id is null then
    raise exception 'dataset_required' using errcode = '22023';
  end if;

  select title, edition
  into selected_dataset_title, selected_dataset_edition
  from public.vocab_datasets
  where id = p_current_vocab_dataset_id
    and status = 'ready'
    and is_active;

  if not found then
    raise exception 'dataset_not_ready' using errcode = '22023';
  end if;

  insert into public.students (
    display_name,
    school_name,
    grade_label,
    current_vocab_book,
    current_vocab_dataset_id,
    note,
    status,
    code_generation,
    created_by
  )
  values (
    trim(p_display_name),
    nullif(trim(p_school_name), ''),
    nullif(trim(p_grade_label), ''),
    left(
      concat_ws(' · ', selected_dataset_title, selected_dataset_edition),
      160
    ),
    p_current_vocab_dataset_id,
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
    student_id,
    details
  )
  values (
    'student.created',
    (select auth.uid()),
    created_student_id,
    jsonb_build_object(
      'current_vocab_dataset_id',
      p_current_vocab_dataset_id
    )
  );

  return query select created_student_id, 1;
end;
$$;

create function public.create_student_with_code_v2(
  p_display_name text,
  p_school_name text,
  p_grade_label text,
  p_current_vocab_dataset_id uuid,
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
  from private.create_student_with_code_v2(
    p_display_name,
    p_school_name,
    p_grade_label,
    p_current_vocab_dataset_id,
    p_note,
    p_lookup_hmac,
    p_encrypted_code,
    p_encryption_iv,
    p_encryption_tag
  );
$$;

revoke all on function private.create_student_with_code_v2(
  text, text, text, uuid, text, text, text, text, text
) from public, anon;
revoke all on function public.create_student_with_code_v2(
  text, text, text, uuid, text, text, text, text, text
) from public, anon;

grant execute on function private.create_student_with_code_v2(
  text, text, text, uuid, text, text, text, text, text
) to authenticated;
grant execute on function public.create_student_with_code_v2(
  text, text, text, uuid, text, text, text, text, text
) to authenticated;

notify pgrst, 'reload schema';
