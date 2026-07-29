do $$
begin
  if exists (
    select 1
    from public.students
    where current_vocab_dataset_id is null
  ) then
    raise exception 'students_without_current_vocab_dataset'
      using errcode = '23502';
  end if;
end;
$$;

alter table public.students
  alter column current_vocab_dataset_id set not null;

drop function public.create_student_with_code(
  text, text, text, text, text, text, text, text
);
drop function public.create_student_with_code(
  text, text, text, text, text, text, text, text, text
);
drop function private.create_student_with_code(
  text, text, text, text, text, text, text, text
);
drop function private.create_student_with_code(
  text, text, text, text, text, text, text, text, text
);

notify pgrst, 'reload schema';
