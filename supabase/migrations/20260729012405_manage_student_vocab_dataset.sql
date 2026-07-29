create function private.set_student_current_vocab_dataset(
  p_student_id uuid,
  p_dataset_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_dataset_title text;
  selected_dataset_edition text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_dataset_id is not null then
    select title, edition
    into selected_dataset_title, selected_dataset_edition
    from public.vocab_datasets
    where id = p_dataset_id
      and status = 'ready'
      and is_active;

    if not found then
      raise exception 'dataset_not_ready' using errcode = '22023';
    end if;
  end if;

  update public.students
  set current_vocab_dataset_id = p_dataset_id,
      current_vocab_book = case
        when p_dataset_id is null then null
        else left(
          concat_ws(
            ' · ',
            selected_dataset_title,
            selected_dataset_edition
          ),
          160
        )
      end
  where id = p_student_id;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.vocab_dataset_changed',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object('current_vocab_dataset_id', p_dataset_id)
  );
end;
$$;

create function public.set_student_current_vocab_dataset(
  p_student_id uuid,
  p_dataset_id uuid
)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.set_student_current_vocab_dataset(
    p_student_id,
    p_dataset_id
  );
$$;

revoke all on function private.set_student_current_vocab_dataset(
  uuid, uuid
) from public, anon;
revoke all on function public.set_student_current_vocab_dataset(
  uuid, uuid
) from public, anon;

grant execute on function private.set_student_current_vocab_dataset(
  uuid, uuid
) to authenticated;
grant execute on function public.set_student_current_vocab_dataset(
  uuid, uuid
) to authenticated;

notify pgrst, 'reload schema';
