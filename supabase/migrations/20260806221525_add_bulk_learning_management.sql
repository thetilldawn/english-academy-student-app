create table public.student_learning_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id uuid not null
    references public.students(id) on delete restrict,
  source_type text not null check (
    source_type in (
      'primary_vocab',
      'exam_vocab',
      'textbook',
      'supplement',
      'mock_exam',
      'passage'
    )
  ),
  vocab_dataset_id uuid
    references public.vocab_datasets(id) on delete restrict,
  display_label text not null check (
    char_length(trim(display_label)) between 1 and 200
  ),
  range_metadata jsonb not null default '{}'::jsonb check (
    jsonb_typeof(range_metadata) = 'object'
  ),
  active boolean not null default true,
  sort_order integer not null default 0 check (sort_order >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source_type <> 'primary_vocab' or vocab_dataset_id is not null),
  check (source_type <> 'exam_vocab' or vocab_dataset_id is not null)
);

create unique index student_learning_sources_one_primary_idx
  on public.student_learning_sources (student_id)
  where source_type = 'primary_vocab' and active;

create unique index student_learning_sources_active_vocab_idx
  on public.student_learning_sources (
    student_id,
    source_type,
    vocab_dataset_id
  )
  where active and vocab_dataset_id is not null;

create index student_learning_sources_student_sort_idx
  on public.student_learning_sources (
    student_id,
    active desc,
    sort_order,
    created_at
  );

create index student_learning_sources_dataset_idx
  on public.student_learning_sources (vocab_dataset_id)
  where vocab_dataset_id is not null;

create index student_learning_sources_created_by_idx
  on public.student_learning_sources (created_by);

create trigger student_learning_sources_set_updated_at
before update on public.student_learning_sources
for each row execute function private.set_updated_at();

alter table public.student_learning_sources enable row level security;

revoke all on table public.student_learning_sources
  from public, anon, authenticated;
grant select on table public.student_learning_sources to authenticated;
grant select, insert, update, delete
  on table public.student_learning_sources to service_role;

create policy "active admins view student learning sources"
on public.student_learning_sources
for select
to authenticated
using ((select private.is_active_admin()));

insert into public.student_learning_sources (
  student_id,
  source_type,
  vocab_dataset_id,
  display_label,
  range_metadata,
  active,
  sort_order,
  created_by
)
select
  student.id,
  'primary_vocab',
  dataset.id,
  concat_ws(' · ', dataset.title, dataset.edition),
  '{}'::jsonb,
  true,
  0,
  student.created_by
from public.students as student
join public.vocab_datasets as dataset
  on dataset.id = student.current_vocab_dataset_id
where student.deleted_at is null
on conflict do nothing;

create function private.sync_student_primary_learning_source()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  dataset_label text;
begin
  if new.current_vocab_dataset_id is null then
    update public.student_learning_sources
    set active = false
    where student_id = new.id
      and source_type = 'primary_vocab'
      and active;
    return new;
  end if;

  select concat_ws(' · ', dataset.title, dataset.edition)
  into dataset_label
  from public.vocab_datasets as dataset
  where dataset.id = new.current_vocab_dataset_id;

  if dataset_label is null then
    raise exception 'primary_vocab_dataset_not_found'
      using errcode = '23503';
  end if;

  update public.student_learning_sources
  set active = false
  where student_id = new.id
    and source_type = 'primary_vocab'
    and vocab_dataset_id <> new.current_vocab_dataset_id
    and active;

  update public.student_learning_sources
  set
    display_label = dataset_label,
    active = true,
    sort_order = 0
  where student_id = new.id
    and source_type = 'primary_vocab'
    and vocab_dataset_id = new.current_vocab_dataset_id;

  if not found then
    insert into public.student_learning_sources (
      student_id,
      source_type,
      vocab_dataset_id,
      display_label,
      range_metadata,
      active,
      sort_order,
      created_by
    )
    values (
      new.id,
      'primary_vocab',
      new.current_vocab_dataset_id,
      dataset_label,
      '{}'::jsonb,
      true,
      0,
      new.created_by
    );
  end if;

  return new;
end;
$$;

revoke all on function private.sync_student_primary_learning_source()
  from public, anon, authenticated, service_role;

create trigger students_sync_primary_learning_source
after insert or update of current_vocab_dataset_id
on public.students
for each row execute function private.sync_student_primary_learning_source();

create function private.create_bulk_vocab_assignments_v1(
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  batch jsonb;
  batch_kind text;
  batch_student_id uuid;
  created_assignment_id uuid;
  locked_student_count integer;
  results jsonb := '[]'::jsonb;
  student_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_batches is null
    or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) not between 1 and 30
  then
    raise exception 'invalid_bulk_assignment_batches'
      using errcode = '22023';
  end if;

  select array_agg((item ->> 'student_id')::uuid order by item ->> 'student_id')
  into student_ids
  from jsonb_array_elements(p_batches) as input(item);

  if cardinality(student_ids) <> (
    select count(distinct student_id)
    from unnest(student_ids) as input(student_id)
    where student_id is not null
  ) then
    raise exception 'duplicate_bulk_assignment_student'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = any(student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;

  select count(*)
  into locked_student_count
  from public.students as student
  where student.id = any(student_ids)
    and student.status = 'active'
    and student.deleted_at is null;

  if locked_student_count <> cardinality(student_ids) then
    raise exception 'bulk_assignment_student_not_active'
      using errcode = '22023';
  end if;

  for batch in
    select item
    from jsonb_array_elements(p_batches) with ordinality
      as input(item, position)
    order by position
  loop
    batch_kind := batch ->> 'kind';
    batch_student_id := (batch ->> 'student_id')::uuid;

    if batch_kind = 'regular' then
      created_assignment_id := private.create_assignment_with_delivery_v4(
        batch ->> 'title',
        (batch ->> 'dataset_id')::uuid,
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'unit_ids') as input(value)
        ),
        (batch ->> 'question_count')::integer,
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        nullif(batch ->> 'available_until', '')::timestamptz,
        array[batch_student_id],
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
    elsif batch_kind = 'mixed' then
      created_assignment_id := private.create_mixed_review_assignment_v6(
        batch_student_id,
        (batch ->> 'dataset_id')::uuid,
        array(
          select value::smallint
          from jsonb_array_elements_text(batch -> 'review_levels')
            as input(value)
        ),
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'selected_queue_ids')
            as input(value)
        ),
        batch ->> 'title',
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'unit_ids') as input(value)
        ),
        (batch ->> 'english_to_korean_ratio')::smallint,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        nullif(batch ->> 'available_until', '')::timestamptz,
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch -> 'questions'
      );
    else
      raise exception 'invalid_bulk_assignment_kind'
        using errcode = '22023';
    end if;

    results := results || jsonb_build_array(jsonb_build_object(
      'student_id', batch_student_id,
      'assignment_id', created_assignment_id
    ));
  end loop;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.bulk_vocab_v1_created',
    (select auth.uid()),
    jsonb_build_object(
      'studentIds', to_jsonb(student_ids),
      'assignmentIds', (
        select coalesce(jsonb_agg(item -> 'assignment_id'), '[]'::jsonb)
        from jsonb_array_elements(results) as input(item)
      )
    )
  );

  return results;
end;
$$;

create function public.create_bulk_vocab_assignments_v1(
  p_batches jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v1(p_batches);
$$;

revoke all on function private.create_bulk_vocab_assignments_v1(jsonb)
  from public, anon;
grant execute on function private.create_bulk_vocab_assignments_v1(jsonb)
  to authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v1(jsonb)
  from public, anon;
grant execute on function public.create_bulk_vocab_assignments_v1(jsonb)
  to authenticated, service_role;
