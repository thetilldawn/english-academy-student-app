begin;

create table public.student_vocab_review_queue (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id uuid not null
    references public.students(id) on delete restrict,
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  vocab_entry_id bigint not null,
  canonical_lexeme_id_snapshot uuid,
  source_attempt_id uuid not null
    references public.quiz_attempts(id) on delete restrict,
  source_question_id uuid not null
    references public.quiz_questions(id) on delete restrict,
  reason_level smallint not null check (reason_level in (1, 2)),
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'cancelled')),
  queued_by uuid not null references auth.users(id),
  queued_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  consumed_assignment_id uuid
    references public.assignments(id) on delete restrict,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict,
  constraint student_vocab_review_queue_state_check check (
    (
      status = 'pending'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is null
    )
    or (
      status = 'consumed'
      and consumed_assignment_id is not null
      and consumed_at is not null
      and cancelled_at is null
    )
    or (
      status = 'cancelled'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is not null
    )
  )
);

create unique index student_vocab_review_queue_pending_entry_unique
  on public.student_vocab_review_queue (
    student_id,
    dataset_id,
    vocab_entry_id
  )
  where status = 'pending';
create unique index student_vocab_review_queue_pending_canonical_unique
  on public.student_vocab_review_queue (
    student_id,
    dataset_id,
    canonical_lexeme_id_snapshot
  )
  where status = 'pending'
    and canonical_lexeme_id_snapshot is not null;
create index student_vocab_review_queue_student_status_time_idx
  on public.student_vocab_review_queue (
    student_id,
    status,
    queued_at desc
  );
create index student_vocab_review_queue_dataset_entry_idx
  on public.student_vocab_review_queue (dataset_id, vocab_entry_id);
create index student_vocab_review_queue_source_attempt_idx
  on public.student_vocab_review_queue (source_attempt_id);
create index student_vocab_review_queue_source_question_idx
  on public.student_vocab_review_queue (source_question_id);
create index student_vocab_review_queue_consumed_assignment_idx
  on public.student_vocab_review_queue (consumed_assignment_id)
  where consumed_assignment_id is not null;
create index student_vocab_review_queue_queued_by_idx
  on public.student_vocab_review_queue (queued_by);

create trigger student_vocab_review_queue_set_updated_at
before update on public.student_vocab_review_queue
for each row execute function private.set_updated_at();

create function private.queue_student_vocab_review_words(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns uuid[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected record;
  existing_queue_id uuid;
  existing_source_completed_at timestamptz;
  merged_reason_level smallint;
  queued_ids uuid[] := array[]::uuid[];
  cancelled_queue_ids uuid[] := array[]::uuid[];
  newly_cancelled_queue_ids uuid[];
  selected_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_question_ids is null
    or cardinality(p_question_ids) not between 1 and 400
    or cardinality(p_question_ids) <> (
      select count(distinct question_id)
      from unnest(p_question_ids) as input(question_id)
      where question_id is not null
    )
  then
    raise exception 'invalid_review_question_selection'
      using errcode = '22023';
  end if;

  perform 1
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
  for update;

  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  select count(*)
  into selected_count
  from public.quiz_questions as question
  join public.quiz_attempts as attempt
    on attempt.id = question.attempt_id
  where question.id = any(p_question_ids)
    and attempt.student_id = p_student_id
    and attempt.status in ('completed', 'expired')
    and question.initial_is_correct is false
    and exists (
      select 1
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.quiz_question_id = question.id
    );

  if selected_count <> cardinality(p_question_ids) then
    raise exception 'review_question_not_finalized_or_owned'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.student_vocab_wrong_events as wrong_event
    where wrong_event.quiz_question_id = any(p_question_ids)
    group by wrong_event.quiz_question_id
    having count(distinct wrong_event.canonical_lexeme_id_snapshot) > 1
  ) then
    raise exception 'inconsistent_review_word_identity'
      using errcode = '22023';
  end if;

  for selected in
    with selected_questions as (
      select
        question.id as question_id,
        question.attempt_id,
        question.vocab_entry_id,
        entry.dataset_id,
        min(wrong_event.canonical_lexeme_id_snapshot::text)::uuid
          as canonical_lexeme_id_snapshot,
        attempt.completed_at
      from public.quiz_questions as question
      join public.quiz_attempts as attempt
        on attempt.id = question.attempt_id
      join public.vocab_entries as entry
        on entry.id = question.vocab_entry_id
      join public.student_vocab_wrong_events as wrong_event
        on wrong_event.quiz_question_id = question.id
      where question.id = any(p_question_ids)
        and attempt.student_id = p_student_id
        and attempt.status in ('completed', 'expired')
      group by
        question.id,
        question.attempt_id,
        question.vocab_entry_id,
        entry.dataset_id,
        attempt.completed_at
    )
    select
      selected_question.*,
      least(
        (
          select count(*)
          from public.student_vocab_wrong_events as historical_event
          where historical_event.student_id = p_student_id
            and (
              (
                selected_question.canonical_lexeme_id_snapshot is not null
                and historical_event.canonical_lexeme_id_snapshot =
                  selected_question.canonical_lexeme_id_snapshot
              )
              or (
                (
                  selected_question.canonical_lexeme_id_snapshot is null
                  or historical_event.canonical_lexeme_id_snapshot is null
                )
                and historical_event.dataset_id =
                  selected_question.dataset_id
                and historical_event.vocab_entry_id =
                  selected_question.vocab_entry_id
              )
            )
        ),
        2
      )::smallint as reason_level
    from selected_questions as selected_question
    order by selected_question.completed_at, selected_question.question_id
  loop
    existing_queue_id := null;
    existing_source_completed_at := null;
    merged_reason_level := selected.reason_level;

    perform 1
    from public.student_vocab_review_queue as queue
    where queue.student_id = p_student_id
      and queue.dataset_id = selected.dataset_id
      and queue.status = 'pending'
      and (
        queue.vocab_entry_id = selected.vocab_entry_id
        or (
          selected.canonical_lexeme_id_snapshot is not null
          and queue.canonical_lexeme_id_snapshot =
            selected.canonical_lexeme_id_snapshot
        )
      )
    for update;

    select
      queue.id,
      source_attempt.completed_at
    into
      existing_queue_id,
      existing_source_completed_at
    from public.student_vocab_review_queue as queue
    join public.quiz_attempts as source_attempt
      on source_attempt.id = queue.source_attempt_id
    where queue.student_id = p_student_id
      and queue.dataset_id = selected.dataset_id
      and queue.status = 'pending'
      and (
        queue.vocab_entry_id = selected.vocab_entry_id
        or (
          selected.canonical_lexeme_id_snapshot is not null
          and queue.canonical_lexeme_id_snapshot =
            selected.canonical_lexeme_id_snapshot
        )
      )
    order by
      source_attempt.completed_at desc,
      queue.queued_at desc,
      queue.id
    limit 1
    ;

    if existing_queue_id is null then
      insert into public.student_vocab_review_queue (
        student_id,
        dataset_id,
        vocab_entry_id,
        canonical_lexeme_id_snapshot,
        source_attempt_id,
        source_question_id,
        reason_level,
        queued_by
      )
      values (
        p_student_id,
        selected.dataset_id,
        selected.vocab_entry_id,
        selected.canonical_lexeme_id_snapshot,
        selected.attempt_id,
        selected.question_id,
        selected.reason_level,
        (select auth.uid())
      )
      returning id into existing_queue_id;
    else
      select greatest(
        selected.reason_level,
        coalesce(max(queue.reason_level), selected.reason_level)
      )::smallint
      into merged_reason_level
      from public.student_vocab_review_queue as queue
      where queue.student_id = p_student_id
        and queue.dataset_id = selected.dataset_id
        and queue.status = 'pending'
        and (
          queue.vocab_entry_id = selected.vocab_entry_id
          or (
            selected.canonical_lexeme_id_snapshot is not null
            and queue.canonical_lexeme_id_snapshot =
              selected.canonical_lexeme_id_snapshot
          )
        );

      -- A historical exact-entry row and a later canonical row can both match
      -- after linkage improves. Preserve the chosen row and retire any other
      -- pending match before changing its representative entry.
      with cancelled as (
        update public.student_vocab_review_queue as duplicate_queue
        set
          status = 'cancelled',
          cancelled_at = now()
        where duplicate_queue.student_id = p_student_id
          and duplicate_queue.dataset_id = selected.dataset_id
          and duplicate_queue.status = 'pending'
          and duplicate_queue.id <> existing_queue_id
          and (
            duplicate_queue.vocab_entry_id = selected.vocab_entry_id
            or (
              selected.canonical_lexeme_id_snapshot is not null
              and duplicate_queue.canonical_lexeme_id_snapshot =
                selected.canonical_lexeme_id_snapshot
            )
          )
        returning duplicate_queue.id
      )
      select coalesce(
        array_agg(cancelled.id order by cancelled.id),
        array[]::uuid[]
      )
      into newly_cancelled_queue_ids
      from cancelled;

      cancelled_queue_ids := cancelled_queue_ids ||
        newly_cancelled_queue_ids;

      update public.student_vocab_review_queue as queue
      set
        vocab_entry_id = case
          when selected.completed_at >= existing_source_completed_at
            then selected.vocab_entry_id
          else queue.vocab_entry_id
        end,
        canonical_lexeme_id_snapshot = coalesce(
          case
            when selected.completed_at >= existing_source_completed_at
              then selected.canonical_lexeme_id_snapshot
            else queue.canonical_lexeme_id_snapshot
          end,
          queue.canonical_lexeme_id_snapshot
        ),
        source_attempt_id = case
          when selected.completed_at >= existing_source_completed_at
            then selected.attempt_id
          else queue.source_attempt_id
        end,
        source_question_id = case
          when selected.completed_at >= existing_source_completed_at
            then selected.question_id
          else queue.source_question_id
        end,
        reason_level = merged_reason_level
      where queue.id = existing_queue_id;
    end if;

    if array_position(queued_ids, existing_queue_id) is null then
      queued_ids := array_append(queued_ids, existing_queue_id);
    end if;
  end loop;

  select coalesce(
    array_agg(queue.id order by queue.queued_at, queue.id),
    array[]::uuid[]
  )
  into queued_ids
  from public.student_vocab_review_queue as queue
  where queue.id = any(queued_ids)
    and queue.status = 'pending';

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.review_queue.words_queued',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'questionCount', cardinality(p_question_ids),
      'queueCount', cardinality(queued_ids),
      'queueIds', to_jsonb(queued_ids),
      'cancelledDuplicateCount', cardinality(cancelled_queue_ids),
      'cancelledDuplicateIds', to_jsonb(cancelled_queue_ids)
    )
  );

  return queued_ids;
end;
$$;

create function public.queue_student_vocab_review_words(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns uuid[]
language sql
security invoker
set search_path = ''
as $$
  select private.queue_student_vocab_review_words(
    p_student_id,
    p_question_ids
  );
$$;

alter table public.student_vocab_review_queue enable row level security;

create policy "active admins can read student vocab review queue"
on public.student_vocab_review_queue
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.student_vocab_review_queue
  from public, anon, authenticated;
grant select on table public.student_vocab_review_queue
  to authenticated;
grant all on table public.student_vocab_review_queue
  to service_role;

revoke all on function private.queue_student_vocab_review_words(
  uuid,
  uuid[]
) from public, anon, authenticated;
revoke all on function public.queue_student_vocab_review_words(
  uuid,
  uuid[]
) from public, anon;
grant execute on function private.queue_student_vocab_review_words(
  uuid,
  uuid[]
) to authenticated;
grant execute on function public.queue_student_vocab_review_words(
  uuid,
  uuid[]
) to authenticated;

notify pgrst, 'reload schema';

commit;
