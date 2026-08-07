begin;

alter table private.assignment_replacement_requests
  drop constraint assignment_replacement_requests_replacement_kind_check;
alter table private.assignment_replacement_requests
  add constraint assignment_replacement_requests_replacement_kind_check
  check (replacement_kind in ('regular', 'mixed', 'review'));

alter table private.assignment_replacement_requests
  add column payload_sha256 text;
update private.assignment_replacement_requests
set payload_sha256 = request_sha256
where payload_sha256 is null;
alter table private.assignment_replacement_requests
  alter column payload_sha256 set not null;
alter table private.assignment_replacement_requests
  add constraint assignment_replacement_requests_payload_sha256_check
  check (payload_sha256 ~ '^[0-9a-f]{64}$');

create function private.assert_mixed_review_queue_snapshot_v1(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_queue_ids uuid[];
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_dataset_id is null
    or p_review_levels is null
    or cardinality(p_review_levels) not between 1 and 2
    or cardinality(p_review_levels) <> (
      select count(distinct level)
      from unnest(p_review_levels) as input(level)
      where level in (1, 2)
    )
    or p_selected_queue_ids is null
    or cardinality(p_selected_queue_ids) not between 1 and 400
    or cardinality(p_selected_queue_ids) <> (
      select count(distinct queue_id)
      from unnest(p_selected_queue_ids) as input(queue_id)
      where queue_id is not null
    )
  then
    raise exception 'invalid_mixed_review_selection'
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

  with identity_by_entry as materialized (
    select
      entry.id as vocab_entry_id,
      min(eligibility.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      lower(trim(replace(entry.headword_normalized, '*', '')))
        as headword_key
    from public.vocab_entries as entry
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = entry.id
      and eligibility.dataset_id = entry.dataset_id
      and eligibility.status = 'eligible'
    where entry.dataset_id = p_dataset_id
    group by entry.id, entry.headword_normalized
  ),
  active_words as materialized (
    select
      question.vocab_entry_id,
      coalesce(
        question.canonical_lexeme_id_snapshot,
        identity.canonical_lexeme_id
      ) as canonical_lexeme_id,
      lower(trim(replace(
        coalesce(
          question.headword_normalized_snapshot,
          identity.headword_key
        ),
        '*',
        ''
      ))) as headword_key
    from public.assignment_students as link
    join public.assignments as assignment
      on assignment.id = link.assignment_id
      and assignment.dataset_id = p_dataset_id
      and assignment.status <> 'closed'
    join public.assignment_questions as question
      on question.assignment_id = link.assignment_id
    left join identity_by_entry as identity
      on identity.vocab_entry_id = question.vocab_entry_id
    where link.student_id = p_student_id
      and link.cancelled_at is null
      and link.missed_at is null
      and (
        not exists (
          select 1
          from public.quiz_attempts as attempt
          where attempt.assignment_id = link.assignment_id
            and attempt.student_id = link.student_id
        )
        or exists (
          select 1
          from public.quiz_attempts as attempt
          where attempt.assignment_id = link.assignment_id
            and attempt.student_id = link.student_id
            and attempt.status = 'in_progress'
        )
      )
  ),
  ranked_queue as materialized (
    select
      queue.id,
      queue.reason_level,
      queue.queued_at,
      row_number() over (
        partition by coalesce(
          identity.canonical_lexeme_id::text,
          'headword:' || identity.headword_key,
          'entry:' || queue.vocab_entry_id::text
        )
        order by queue.reason_level desc, queue.queued_at, queue.id
      ) as identity_rank
    from public.student_vocab_review_queue as queue
    left join identity_by_entry as identity
      on identity.vocab_entry_id = queue.vocab_entry_id
    where queue.student_id = p_student_id
      and queue.dataset_id = p_dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null
      and queue.reason_level = any(p_review_levels)
      and not exists (
        select 1
        from active_words as active
        where active.vocab_entry_id = queue.vocab_entry_id
          or (
            identity.canonical_lexeme_id is not null
            and identity.canonical_lexeme_id = active.canonical_lexeme_id
          )
          or (
            identity.canonical_lexeme_id is null
            and active.canonical_lexeme_id is null
            and identity.headword_key is not null
            and identity.headword_key = active.headword_key
          )
      )
  ),
  selected_queue as materialized (
    select ranked.id, ranked.reason_level, ranked.queued_at
    from ranked_queue as ranked
    where ranked.identity_rank = 1
    order by ranked.reason_level desc, ranked.queued_at, ranked.id
    limit 400
  )
  select coalesce(
    array_agg(
      selected.id
      order by selected.reason_level desc, selected.queued_at, selected.id
    ),
    array[]::uuid[]
  )
  into current_queue_ids
  from selected_queue as selected;

  if cardinality(current_queue_ids) = 0 then
    raise exception 'mixed_review_queue_empty' using errcode = '22023';
  end if;
  if current_queue_ids is distinct from p_selected_queue_ids then
    raise exception 'mixed_review_queue_snapshot_changed'
      using errcode = '40001';
  end if;
end;
$$;

create function private.replace_student_assignment_v2(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.assignment_replacement_requests%rowtype;
  computed_payload_sha256 text;
  student_found boolean;
  student_status public.student_status;
  student_deleted_at timestamptz;
  source_status public.assignment_status;
  source_deleted_at timestamptz;
  source_available_until timestamptz;
  source_title text;
  source_dataset_id uuid;
  source_question_count integer;
  source_ratio smallint;
  source_time_limit integer;
  source_timing_mode text;
  source_question_time_limit integer;
  source_passing_score smallint;
  source_order_mode public.question_order_mode;
  source_purpose text;
  source_primary_unit_ids uuid[];
  source_review_queue_ids uuid[];
  source_review_levels smallint[];
  replacement_primary_unit_ids uuid[];
  replacement_review_queue_ids uuid[];
  replacement_review_levels smallint[];
  source_question_bank_sha256 text;
  replacement_question_bank_sha256 text;
  link_missed_at timestamptz;
  link_cancelled_at timestamptz;
  created_replacement_assignment_id uuid;
  replacement_purpose text;
  exact_review_draft_id uuid;
  reserved_queue_count integer;
  inserted_target_count integer;
  restored_queue_count integer;
  review_creator_needs_lifecycle boolean := false;
  result_value jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_source_assignment_id is null
    or p_student_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_replacement_kind is null
    or p_replacement_kind not in ('regular', 'mixed', 'review')
    or p_review_snapshot_mode is null
    or p_review_snapshot_mode not in ('none', 'preserve', 'recalculate')
    or (
      p_replacement_kind = 'regular'
      and p_review_snapshot_mode <> 'none'
    )
    or (
      p_replacement_kind = 'review'
      and p_review_snapshot_mode <> 'preserve'
    )
    or (
      p_replacement_kind = 'mixed'
      and p_review_snapshot_mode not in ('preserve', 'recalculate')
    )
    or p_title is null
    or char_length(trim(p_title)) not between 1 and 160
    or p_dataset_id is null
    or p_primary_unit_ids is null
    or cardinality(p_primary_unit_ids) > 500
    or cardinality(p_primary_unit_ids) <> (
      select count(distinct unit_id)
      from unnest(p_primary_unit_ids) as input(unit_id)
      where unit_id is not null
    )
    or p_question_count is null
    or p_question_count not between 1 and 500
    or (
      p_replacement_kind = 'regular'
      and (
        p_question_count < 4
        or cardinality(p_primary_unit_ids) < 1
      )
    )
    or (
      p_replacement_kind = 'mixed'
      and (
        cardinality(p_primary_unit_ids) < 1
        or (
          p_question_count < 4
          and cardinality(p_selected_queue_ids) <> p_question_count
        )
      )
    )
    or (
      p_replacement_kind = 'review'
      and cardinality(p_primary_unit_ids) <> 0
    )
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not in (0, 50, 100)
    or p_time_limit_seconds is null
    or p_time_limit_seconds not between 30 and 10800
    or p_passing_score is null
    or p_passing_score not between 0 and 100
    or p_question_order_mode is null
    or p_timing_mode is null
    or p_timing_mode not in ('total', 'per_question')
    or (
      p_timing_mode = 'total'
      and p_question_time_limit_seconds is not null
    )
    or (
      p_timing_mode = 'per_question'
      and (
        p_question_time_limit_seconds is null
        or p_question_time_limit_seconds not between 5 and 600
      )
    )
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
    or (
      p_replacement_kind = 'regular'
      and (
        coalesce(cardinality(p_review_levels), 0) <> 0
        or coalesce(cardinality(p_selected_queue_ids), 0) <> 0
      )
    )
    or (
      p_replacement_kind in ('mixed', 'review')
      and (
        p_review_levels is null
        or cardinality(p_review_levels) not between 1 and 2
        or cardinality(p_review_levels) <> (
          select count(distinct level)
          from unnest(p_review_levels) as input(level)
          where level in (1, 2)
        )
        or p_selected_queue_ids is null
        or cardinality(p_selected_queue_ids) not between 1 and (
          case
            when p_replacement_kind = 'mixed'
              and p_review_snapshot_mode = 'preserve'
              then 500
            else 400
          end
        )
        or cardinality(p_selected_queue_ids) <> (
          select count(distinct queue_id)
          from unnest(p_selected_queue_ids) as input(queue_id)
          where queue_id is not null
        )
      )
    )
  then
    raise exception 'invalid_assignment_replacement_input'
      using errcode = '22023';
  end if;

  computed_payload_sha256 := encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'sourceAssignmentId', p_source_assignment_id,
          'studentId', p_student_id,
          'replacementKind', p_replacement_kind,
          'reviewSnapshotMode', p_review_snapshot_mode,
          'title', trim(p_title),
          'datasetId', p_dataset_id,
          'primaryUnitIds', to_jsonb(p_primary_unit_ids),
          'questionCount', p_question_count,
          'englishToKoreanRatio', p_english_to_korean_ratio,
          'timeLimitSeconds', p_time_limit_seconds,
          'passingScore', p_passing_score,
          'questionOrderMode', p_question_order_mode,
          'availableUntil', p_available_until,
          'timingMode', p_timing_mode,
          'questionTimeLimitSeconds', p_question_time_limit_seconds,
          'reviewLevels', to_jsonb(p_review_levels),
          'selectedQueueIds', to_jsonb(p_selected_queue_ids)
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  select student.status, student.deleted_at
  into student_status, student_deleted_at
  from public.students as student
  where student.id = p_student_id
  for update;
  student_found := found;

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;
  if found then
    if request_row.source_assignment_id <> p_source_assignment_id
      or request_row.student_id <> p_student_id
      or request_row.request_sha256 <> p_request_sha256
      or request_row.replacement_kind <> p_replacement_kind
      or request_row.payload_sha256 <> computed_payload_sha256
    then
      raise exception 'idempotency_key_reused' using errcode = '23505';
    end if;
    if request_row.result is not null then
      return request_row.result || jsonb_build_object('idempotent', true);
    end if;
  end if;

  if not student_found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;
  if student_deleted_at is not null then
    raise exception 'student_deleted' using errcode = '22023';
  end if;
  if student_status <> 'active' then
    raise exception 'student_not_active' using errcode = '22023';
  end if;
  if p_available_until is not null
    and p_available_until <= clock_timestamp()
  then
    raise exception 'assignment_replacement_deadline_elapsed'
      using errcode = '22023';
  end if;

  select
    assignment.status,
    assignment.deleted_at,
    assignment.available_until,
    assignment.title,
    assignment.dataset_id,
    assignment.question_count,
    assignment.english_to_korean_ratio,
    assignment.time_limit_seconds,
    assignment.timing_mode,
    assignment.question_time_limit_seconds,
    assignment.passing_score,
    assignment.question_order_mode,
    assignment.assignment_purpose,
    link.missed_at,
    link.cancelled_at
  into
    source_status,
    source_deleted_at,
    source_available_until,
    source_title,
    source_dataset_id,
    source_question_count,
    source_ratio,
    source_time_limit,
    source_timing_mode,
    source_question_time_limit,
    source_passing_score,
    source_order_mode,
    source_purpose,
    link_missed_at,
    link_cancelled_at
  from public.assignment_students as link
  join public.assignments as assignment
    on assignment.id = link.assignment_id
  where link.assignment_id = p_source_assignment_id
    and link.student_id = p_student_id
  for update of assignment, link;

  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;
  if source_deleted_at is not null then
    raise exception 'assignment_deleted' using errcode = '22023';
  end if;
  if link_cancelled_at is not null then
    raise exception 'assignment_already_cancelled' using errcode = '22023';
  end if;
  if link_missed_at is not null then
    raise exception 'assignment_already_missed' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_source_assignment_id
      and attempt.student_id = p_student_id
      and attempt.status in ('completed', 'expired')
  ) then
    raise exception 'assignment_already_completed' using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.assignment_id = p_source_assignment_id
      and attempt.student_id = p_student_id
  ) then
    raise exception 'assignment_already_started' using errcode = '22023';
  end if;
  if source_available_until is not null
    and source_available_until <= clock_timestamp()
  then
    raise exception 'assignment_deadline_elapsed' using errcode = '22023';
  end if;
  if source_status <> 'active' then
    raise exception 'assignment_not_active' using errcode = '22023';
  end if;

  select coalesce(
    array_agg(link.unit_id order by link.position)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into source_primary_unit_ids
  from public.assignment_units as link
  where link.assignment_id = p_source_assignment_id;

  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'vocab_entry_id', question.vocab_entry_id,
              'base_order_index', question.base_order_index,
              'direction', question.direction,
              'choice_vocab_entry_ids', to_jsonb(question.choice_vocab_entry_ids)
            )
            order by question.base_order_index
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into source_question_bank_sha256
  from public.assignment_questions as question
  where question.assignment_id = p_source_assignment_id;

  select
    coalesce(
      array_agg(target.review_queue_id order by question.base_order_index),
      array[]::uuid[]
    ),
    coalesce(
      array_agg(distinct queue.reason_level order by queue.reason_level),
      array[]::smallint[]
    )
  into source_review_queue_ids, source_review_levels
  from public.assignment_review_targets as target
  join public.assignment_questions as question
    on question.id = target.assignment_question_id
  join public.student_vocab_review_queue as queue
    on queue.id = target.review_queue_id
  where target.assignment_id = p_source_assignment_id
    and target.student_id = p_student_id
    and target.released_at is null;

  if source_purpose = 'review'
    and p_replacement_kind <> 'review'
  then
    raise exception 'exact_review_replacement_kind_changed'
      using errcode = '22023';
  end if;

  if p_replacement_kind = 'review' then
    if source_purpose <> 'review'
      or source_dataset_id <> p_dataset_id
      or source_question_count <> p_question_count
    then
      raise exception 'exact_review_replacement_shape_changed'
        using errcode = '22023';
    end if;

    if source_review_queue_ids is distinct from p_selected_queue_ids
      or source_review_levels is distinct from (
        select array_agg(level order by level)
        from unnest(p_review_levels) as input(level)
      )
      or cardinality(source_review_queue_ids) <> p_question_count
    then
      raise exception 'exact_review_target_snapshot_changed'
        using errcode = '40001';
    end if;
  elsif p_replacement_kind = 'mixed' then
    if exists (
      select 1
      from unnest(p_selected_queue_ids) as selected(queue_id)
      left join public.student_vocab_review_queue as queue
        on queue.id = selected.queue_id
       and queue.student_id = p_student_id
       and queue.dataset_id = p_dataset_id
       and queue.status = 'pending'
       and queue.reserved_review_draft_id is null
       and queue.reason_level = any(p_review_levels)
      where queue.id is null
    ) then
      raise exception 'mixed_review_queue_snapshot_changed'
        using errcode = '40001';
    end if;
    if p_review_snapshot_mode = 'preserve'
      and (
        source_purpose <> 'mixed'
        or source_review_queue_ids is distinct from p_selected_queue_ids
        or source_review_levels is distinct from (
          select array_agg(level order by level)
          from unnest(p_review_levels) as input(level)
        )
      )
    then
      raise exception 'mixed_review_source_snapshot_changed'
        using errcode = '40001';
    end if;
  end if;

  insert into private.assignment_replacement_requests (
    idempotency_key,
    request_sha256,
    payload_sha256,
    actor_admin_id,
    source_assignment_id,
    student_id,
    replacement_kind
  )
  values (
    p_idempotency_key,
    p_request_sha256,
    computed_payload_sha256,
    (select auth.uid()),
    p_source_assignment_id,
    p_student_id,
    p_replacement_kind
  )
  on conflict (idempotency_key) do nothing;

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;
  if request_row.source_assignment_id <> p_source_assignment_id
    or request_row.student_id <> p_student_id
    or request_row.request_sha256 <> p_request_sha256
    or request_row.replacement_kind <> p_replacement_kind
    or request_row.payload_sha256 <> computed_payload_sha256
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is not null then
    return request_row.result || jsonb_build_object('idempotent', true);
  end if;

  perform private.cancel_student_assignment_v1(
    p_source_assignment_id,
    p_student_id,
    '배정 수정으로 교체'
  );

  if p_replacement_kind = 'regular' then
    created_replacement_assignment_id := private.create_assignment_with_delivery_v5(
      trim(p_title),
      p_dataset_id,
      p_primary_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      array[p_student_id],
      p_timing_mode,
      p_question_time_limit_seconds,
      p_questions
    );
  elsif p_replacement_kind = 'mixed' then
    if p_review_snapshot_mode = 'preserve' then
      created_replacement_assignment_id := private.create_assignment_with_delivery_v5(
        trim(p_title),
        p_dataset_id,
        p_primary_unit_ids,
        p_question_count,
        p_english_to_korean_ratio,
        p_time_limit_seconds,
        p_passing_score,
        p_question_order_mode,
        p_available_until,
        array[p_student_id],
        p_timing_mode,
        p_question_time_limit_seconds,
        p_questions
      );
      update public.assignments
      set assignment_purpose = 'mixed'
      where id = created_replacement_assignment_id;
    else
      perform private.assert_mixed_review_queue_snapshot_v1(
        p_student_id,
        p_dataset_id,
        p_review_levels,
        p_selected_queue_ids
      );

      perform private.assert_assignment_words_available_v1(
        array[p_student_id],
        p_dataset_id,
        p_questions
      );

      if cardinality(p_selected_queue_ids) < p_question_count then
        created_replacement_assignment_id := private.persist_review_assignment_v5(
          p_student_id,
          p_dataset_id,
          p_selected_queue_ids,
          null,
          trim(p_title),
          p_primary_unit_ids,
          p_english_to_korean_ratio,
          p_time_limit_seconds,
          p_passing_score,
          p_question_order_mode,
          p_available_until,
          p_questions
        );
      else
        insert into public.student_vocab_review_assignment_drafts (
          student_id,
          dataset_id,
          created_by
        )
        values (
          p_student_id,
          p_dataset_id,
          (select auth.uid())
        )
        returning id into exact_review_draft_id;

        update public.student_vocab_review_queue as queue
        set
          reserved_review_draft_id = exact_review_draft_id,
          reserved_at = clock_timestamp()
        where queue.id = any(p_selected_queue_ids)
          and queue.student_id = p_student_id
          and queue.dataset_id = p_dataset_id
          and queue.status = 'pending'
          and queue.reserved_review_draft_id is null;
        get diagnostics reserved_queue_count = row_count;
        if reserved_queue_count <> cardinality(p_selected_queue_ids) then
          raise exception 'mixed_review_queue_snapshot_changed'
            using errcode = '40001';
        end if;

        insert into public.student_vocab_review_assignment_draft_items (
          draft_id,
          queue_id,
          position
        )
        select
          exact_review_draft_id,
          selected.queue_id,
          selected.position::integer
        from unnest(p_selected_queue_ids) with ordinality
          as selected(queue_id, position);

        created_replacement_assignment_id := private.create_exact_review_assignment_v4(
          exact_review_draft_id,
          trim(p_title),
          p_english_to_korean_ratio,
          p_time_limit_seconds,
          p_passing_score,
          p_question_order_mode,
          p_available_until,
          p_questions
        );
      end if;
      review_creator_needs_lifecycle := true;
    end if;
  else
    insert into public.student_vocab_review_assignment_drafts (
      student_id,
      dataset_id,
      created_by
    )
    values (
      p_student_id,
      p_dataset_id,
      (select auth.uid())
    )
    returning id into exact_review_draft_id;

    update public.student_vocab_review_queue as queue
    set
      reserved_review_draft_id = exact_review_draft_id,
      reserved_at = clock_timestamp()
    where queue.id = any(p_selected_queue_ids)
      and queue.student_id = p_student_id
      and queue.dataset_id = p_dataset_id
      and queue.status = 'pending'
      and queue.reserved_review_draft_id is null;
    get diagnostics reserved_queue_count = row_count;
    if reserved_queue_count <> cardinality(p_selected_queue_ids) then
      raise exception 'exact_review_target_snapshot_changed'
        using errcode = '40001';
    end if;

    insert into public.student_vocab_review_assignment_draft_items (
      draft_id,
      queue_id,
      position
    )
    select
      exact_review_draft_id,
      selected.queue_id,
      selected.position::integer
    from unnest(p_selected_queue_ids) with ordinality
      as selected(queue_id, position);

    created_replacement_assignment_id := private.create_exact_review_assignment_v4(
      exact_review_draft_id,
      trim(p_title),
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_questions
    );
    review_creator_needs_lifecycle := true;
  end if;

  if review_creator_needs_lifecycle then
    insert into public.assignment_review_targets (
      assignment_id,
      student_id,
      review_queue_id,
      assignment_question_id,
      dataset_id,
      vocab_entry_id,
      canonical_lexeme_id_snapshot
    )
    select
      created_replacement_assignment_id,
      p_student_id,
      queue.id,
      question.id,
      queue.dataset_id,
      queue.vocab_entry_id,
      queue.canonical_lexeme_id_snapshot
    from unnest(p_selected_queue_ids) with ordinality
      as selected(queue_id, position)
    join public.student_vocab_review_queue as queue
      on queue.id = selected.queue_id
    join public.assignment_questions as question
      on question.assignment_id = created_replacement_assignment_id
      and question.vocab_entry_id = queue.vocab_entry_id
    order by selected.position;
    get diagnostics inserted_target_count = row_count;
    if inserted_target_count <> cardinality(p_selected_queue_ids) then
      raise exception 'assignment_review_target_insert_mismatch'
        using errcode = '21000';
    end if;

    update public.student_vocab_review_queue as queue
    set
      status = 'pending',
      consumed_assignment_id = null,
      consumed_at = null,
      cancelled_at = null,
      reserved_review_draft_id = null,
      reserved_at = null
    where queue.id = any(p_selected_queue_ids)
      and queue.status = 'consumed'
      and queue.consumed_assignment_id = created_replacement_assignment_id;
    get diagnostics restored_queue_count = row_count;
    if restored_queue_count <> cardinality(p_selected_queue_ids) then
      raise exception 'assignment_review_queue_restore_mismatch'
        using errcode = '40001';
    end if;

    perform private.link_pending_review_targets_v1(
      created_replacement_assignment_id,
      array[p_student_id]
    );
    perform private.configure_assignment_delivery_v1(
      created_replacement_assignment_id,
      p_timing_mode,
      p_question_time_limit_seconds
    );
  end if;

  select assignment.assignment_purpose
  into replacement_purpose
  from public.assignments as assignment
  where assignment.id = created_replacement_assignment_id;

  select coalesce(
    array_agg(link.unit_id order by link.position)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into replacement_primary_unit_ids
  from public.assignment_units as link
  where link.assignment_id = created_replacement_assignment_id;

  select encode(
    extensions.digest(
      convert_to(
        coalesce(
          jsonb_agg(
            jsonb_build_object(
              'vocab_entry_id', question.vocab_entry_id,
              'base_order_index', question.base_order_index,
              'direction', question.direction,
              'choice_vocab_entry_ids', to_jsonb(question.choice_vocab_entry_ids)
            )
            order by question.base_order_index
          ),
          '[]'::jsonb
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into replacement_question_bank_sha256
  from public.assignment_questions as question
  where question.assignment_id = created_replacement_assignment_id;

  select
    coalesce(
      array_agg(target.review_queue_id order by question.base_order_index),
      array[]::uuid[]
    ),
    coalesce(
      array_agg(distinct queue.reason_level order by queue.reason_level),
      array[]::smallint[]
    )
  into replacement_review_queue_ids, replacement_review_levels
  from public.assignment_review_targets as target
  join public.assignment_questions as question
    on question.id = target.assignment_question_id
  join public.student_vocab_review_queue as queue
    on queue.id = target.review_queue_id
  where target.assignment_id = created_replacement_assignment_id
    and target.student_id = p_student_id
    and target.released_at is null;

  if (
    p_replacement_kind = 'review'
    or (
      p_replacement_kind = 'mixed'
      and p_review_snapshot_mode = 'preserve'
    )
  )
  and replacement_review_queue_ids is distinct from p_selected_queue_ids
  then
    raise exception 'assignment_review_target_persistence_mismatch'
      using errcode = '21000';
  end if;
  if p_replacement_kind = 'mixed'
    and p_review_snapshot_mode = 'recalculate'
    and not p_selected_queue_ids <@ replacement_review_queue_ids
  then
    raise exception 'assignment_review_target_persistence_mismatch'
      using errcode = '21000';
  end if;

  if created_replacement_assignment_id is null
    or (
      p_replacement_kind = 'mixed'
      and replacement_purpose not in ('mixed', 'review')
    )
    or (
      p_replacement_kind <> 'mixed'
      and replacement_purpose is distinct from p_replacement_kind
    )
    or (
      select count(*)
      from public.assignment_students as link
      where link.assignment_id = created_replacement_assignment_id
        and link.student_id = p_student_id
        and link.cancelled_at is null
        and link.missed_at is null
    ) <> 1
    or (
      select count(*)
      from public.assignment_students as link
      where link.assignment_id = created_replacement_assignment_id
    ) <> 1
  then
    raise exception 'assignment_replacement_persistence_mismatch'
      using errcode = '21000';
  end if;

  result_value := jsonb_build_object(
    'status', 'replaced',
    'sourceAssignmentId', p_source_assignment_id,
    'replacementAssignmentId', created_replacement_assignment_id,
    'studentId', p_student_id,
    'replacementPurpose', replacement_purpose,
    'idempotent', false
  );

  update private.assignment_replacement_requests
  set
    replacement_assignment_id = created_replacement_assignment_id,
    result = result_value,
    completed_at = clock_timestamp()
  where idempotency_key = p_idempotency_key;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'assignment.student.replaced',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'sourceAssignmentId', p_source_assignment_id,
      'replacementAssignmentId', created_replacement_assignment_id,
      'idempotencyKey', p_idempotency_key,
      'requestSha256', p_request_sha256,
      'payloadSha256', computed_payload_sha256,
      'reviewSnapshotMode', p_review_snapshot_mode,
      'before', jsonb_build_object(
        'title', source_title,
        'datasetId', source_dataset_id,
        'purpose', source_purpose,
        'primaryUnitIds', to_jsonb(source_primary_unit_ids),
        'questionCount', source_question_count,
        'englishToKoreanRatio', source_ratio,
        'timeLimitSeconds', source_time_limit,
        'timingMode', source_timing_mode,
        'questionTimeLimitSeconds', source_question_time_limit,
        'passingScore', source_passing_score,
        'questionOrderMode', source_order_mode,
        'availableUntil', source_available_until,
        'reviewLevels', to_jsonb(coalesce(source_review_levels, array[]::smallint[])),
        'reviewQueueIds', to_jsonb(coalesce(source_review_queue_ids, array[]::uuid[])),
        'questionBankSha256', source_question_bank_sha256
      ),
      'after', jsonb_build_object(
        'title', trim(p_title),
        'datasetId', p_dataset_id,
        'purpose', replacement_purpose,
        'primaryUnitIds', to_jsonb(replacement_primary_unit_ids),
        'questionCount', p_question_count,
        'englishToKoreanRatio', p_english_to_korean_ratio,
        'timeLimitSeconds', p_time_limit_seconds,
        'timingMode', p_timing_mode,
        'questionTimeLimitSeconds', p_question_time_limit_seconds,
        'passingScore', p_passing_score,
        'questionOrderMode', p_question_order_mode,
        'availableUntil', p_available_until,
        'reviewLevels', to_jsonb(replacement_review_levels),
        'reviewQueueIds', to_jsonb(replacement_review_queue_ids),
        'questionBankSha256', replacement_question_bank_sha256
      )
    )
  );

  return result_value;
end;
$$;

create function public.replace_student_assignment_v2(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_replacement_kind text,
  p_review_snapshot_mode text,
  p_title text,
  p_dataset_id uuid,
  p_primary_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.replace_student_assignment_v2(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    p_request_sha256,
    p_replacement_kind,
    p_review_snapshot_mode,
    p_title,
    p_dataset_id,
    p_primary_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_review_levels,
    p_selected_queue_ids,
    p_questions
  );
$$;

revoke all on function private.assert_mixed_review_queue_snapshot_v1(
  uuid, uuid, smallint[], uuid[]
) from public, anon;
grant execute on function private.assert_mixed_review_queue_snapshot_v1(
  uuid, uuid, smallint[], uuid[]
) to authenticated, service_role;

revoke all on function private.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon;
grant execute on function private.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;
revoke all on function public.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon;
grant execute on function public.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) to authenticated, service_role;

revoke all on function public.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode,
  timestamptz, text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';

commit;
