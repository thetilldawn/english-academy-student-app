create type public.vocab_unit_kind as enum ('day', 'supplement');
create type public.assignment_range_basis as enum ('source_rows', 'units');
create type public.question_order_mode as enum ('fixed', 'random');

create table public.vocab_units (
  id uuid primary key default extensions.gen_random_uuid(),
  dataset_id uuid not null references public.vocab_datasets(id) on delete cascade,
  unit_label text not null check (
    char_length(trim(unit_label)) between 1 and 160
  ),
  normalized_label text not null check (
    char_length(trim(normalized_label)) between 1 and 160
  ),
  unit_kind public.vocab_unit_kind not null,
  unit_number integer check (unit_number is null or unit_number > 0),
  sort_index integer not null check (sort_index > 0),
  entry_count integer not null default 0 check (entry_count >= 0),
  created_at timestamptz not null default now(),
  unique (dataset_id, normalized_label),
  unique (dataset_id, sort_index),
  unique (id, dataset_id),
  constraint vocab_units_day_number_check check (
    (unit_kind = 'day' and unit_number is not null)
    or (unit_kind = 'supplement' and unit_number is null)
  )
);

alter table public.vocab_entries
  add column unit_id uuid,
  add column position_in_unit integer,
  add column entry_type text;

with source_units as (
  select
    dataset_id,
    trim(split_part(source_ref, ' · ', 1)) as unit_label,
    min(source_row) as first_source_row,
    count(*) as entry_count
  from public.vocab_entries
  where source_ref is not null
    and position(' · ' in source_ref) > 0
  group by dataset_id, trim(split_part(source_ref, ' · ', 1))
),
ranked_units as (
  select
    dataset_id,
    unit_label,
    first_source_row,
    entry_count,
    row_number() over (
      partition by dataset_id
      order by first_source_row, unit_label
    )::integer as sort_index
  from source_units
)
insert into public.vocab_units (
  dataset_id,
  unit_label,
  normalized_label,
  unit_kind,
  unit_number,
  sort_index,
  entry_count
)
select
  dataset_id,
  unit_label,
  lower(unit_label),
  case
    when unit_label ~* '^DAY[[:space:]]*[0-9]+$'
      then 'day'::public.vocab_unit_kind
    else 'supplement'::public.vocab_unit_kind
  end,
  case
    when unit_label ~* '^DAY[[:space:]]*[0-9]+$'
      then substring(unit_label from '[0-9]+')::integer
    else null
  end,
  sort_index,
  entry_count
from ranked_units;

with ranked_entries as (
  select
    entry.id,
    unit.id as unit_id,
    row_number() over (
      partition by entry.dataset_id, unit.id
      order by entry.source_row, entry.id
    )::integer as position_in_unit,
    trim(split_part(entry.source_ref, ' · ', 2)) as entry_type
  from public.vocab_entries as entry
  join public.vocab_units as unit
    on unit.dataset_id = entry.dataset_id
   and unit.normalized_label =
     lower(trim(split_part(entry.source_ref, ' · ', 1)))
)
update public.vocab_entries as entry
set unit_id = ranked.unit_id,
    position_in_unit = ranked.position_in_unit,
    entry_type = ranked.entry_type
from ranked_entries as ranked
where entry.id = ranked.id;

do $$
declare
  total_entries integer;
  linked_entries integer;
begin
  select count(*) into total_entries
  from public.vocab_entries;

  select count(*) into linked_entries
  from public.vocab_entries
  where unit_id is not null
    and position_in_unit is not null
    and entry_type is not null
    and trim(entry_type) <> '';

  if total_entries <> linked_entries then
    raise exception 'vocab_unit_backfill_mismatch: total %, linked %',
      total_entries,
      linked_entries;
  end if;
end;
$$;

alter table public.vocab_entries
  alter column unit_id set not null,
  alter column position_in_unit set not null,
  alter column entry_type set not null,
  add constraint vocab_entries_unit_id_fkey
    foreign key (unit_id)
    references public.vocab_units(id)
    on delete restrict,
  add constraint vocab_entries_position_in_unit_check
    check (position_in_unit > 0),
  add constraint vocab_entries_entry_type_length_check
    check (char_length(trim(entry_type)) between 1 and 80),
  add constraint vocab_entries_unit_position_unique
    unique (unit_id, position_in_unit);

create index vocab_entries_unit_order_idx
  on public.vocab_entries (unit_id, position_in_unit);

alter table public.students
  alter column current_vocab_dataset_id drop not null;

create or replace function private.create_student_with_code_v2(
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

  if p_current_vocab_dataset_id is not null then
    select title, edition
    into selected_dataset_title, selected_dataset_edition
    from public.vocab_datasets
    where id = p_current_vocab_dataset_id
      and status = 'ready'
      and is_active;

    if not found then
      raise exception 'dataset_not_ready' using errcode = '22023';
    end if;
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
    case
      when p_current_vocab_dataset_id is null then null
      else left(
        concat_ws(' · ', selected_dataset_title, selected_dataset_edition),
        160
      )
    end,
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
    jsonb_strip_nulls(
      jsonb_build_object(
        'current_vocab_dataset_id',
        p_current_vocab_dataset_id
      )
    )
  );

  return query select created_student_id, 1;
end;
$$;

alter table public.assignments
  add column range_basis public.assignment_range_basis
    not null default 'source_rows',
  add column question_order_mode public.question_order_mode
    not null default 'random',
  add column question_bank_version smallint,
  add constraint assignments_question_bank_version_check check (
    question_bank_version is null
    or question_bank_version between 1 and 1000
  ),
  add constraint assignments_units_bank_check check (
    (range_basis = 'source_rows' and question_bank_version is null)
    or (range_basis = 'units' and question_bank_version is not null)
  );

alter table public.assignments
  add constraint assignments_id_dataset_unique unique (id, dataset_id);

create table public.assignment_units (
  assignment_id uuid not null,
  dataset_id uuid not null,
  unit_id uuid not null,
  position integer not null check (position > 0),
  primary key (assignment_id, unit_id),
  unique (assignment_id, position),
  foreign key (assignment_id, dataset_id)
    references public.assignments(id, dataset_id)
    on delete cascade,
  foreign key (unit_id, dataset_id)
    references public.vocab_units(id, dataset_id)
    on delete restrict
);

create index assignment_units_dataset_idx
  on public.assignment_units (dataset_id);
create index assignment_units_unit_idx
  on public.assignment_units (unit_id);

create table public.assignment_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  assignment_id uuid not null
    references public.assignments(id) on delete cascade,
  vocab_entry_id bigint not null
    references public.vocab_entries(id) on delete restrict,
  base_order_index integer not null check (base_order_index > 0),
  direction public.question_direction not null,
  prompt text not null check (char_length(trim(prompt)) > 0),
  choices jsonb not null check (
    jsonb_typeof(choices) = 'array'
    and jsonb_array_length(choices) = 4
  ),
  correct_choice_index smallint not null
    check (correct_choice_index between 0 and 3),
  created_at timestamptz not null default now(),
  unique (assignment_id, base_order_index),
  unique (assignment_id, vocab_entry_id)
);

create index assignment_questions_vocab_entry_idx
  on public.assignment_questions (vocab_entry_id);

alter table public.quiz_questions
  add column assignment_question_id uuid
    references public.assignment_questions(id) on delete restrict;

create unique index quiz_questions_attempt_bank_question_unique
  on public.quiz_questions (attempt_id, assignment_question_id)
  where assignment_question_id is not null;
create index quiz_questions_assignment_question_idx
  on public.quiz_questions (assignment_question_id)
  where assignment_question_id is not null;

create function private.create_assignment_with_question_bank(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
  selected_unit_count integer;
  first_unit_sort integer;
  last_unit_sort integer;
  selected_range_start integer;
  selected_range_end integer;
  available_entry_count integer;
  inserted_question_count integer;
  expected_english_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_title is null
    or char_length(trim(p_title)) not between 1 and 160
  then
    raise exception 'invalid_title' using errcode = '22023';
  end if;

  if p_question_count is null
    or p_question_count not between 4 and 500
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not between 0 and 100
    or p_time_limit_seconds is null
    or p_time_limit_seconds not between 30 and 10800
    or p_passing_score is null
    or p_passing_score not between 0 and 100
    or p_question_order_mode is null
  then
    raise exception 'invalid_assignment_settings' using errcode = '22023';
  end if;

  if p_unit_ids is null
    or cardinality(p_unit_ids) = 0
    or cardinality(p_unit_ids) <> (
      select count(distinct selected.unit_id)
      from unnest(p_unit_ids) as selected(unit_id)
      where selected.unit_id is not null
    )
  then
    raise exception 'invalid_or_duplicate_unit' using errcode = '22023';
  end if;

  select
    count(*),
    min(unit.sort_index),
    max(unit.sort_index)
  into
    selected_unit_count,
    first_unit_sort,
    last_unit_sort
  from public.vocab_units as unit
  where unit.dataset_id = p_dataset_id
    and unit.id = any(p_unit_ids);

  if selected_unit_count <> cardinality(p_unit_ids) then
    raise exception 'unit_dataset_mismatch' using errcode = '22023';
  end if;

  if selected_unit_count <> last_unit_sort - first_unit_sort + 1 then
    raise exception 'units_must_be_contiguous' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.vocab_datasets
    where id = p_dataset_id
      and status = 'ready'
      and is_active
  ) then
    raise exception 'dataset_not_ready' using errcode = '22023';
  end if;

  select
    min(entry.source_row),
    max(entry.source_row),
    count(distinct entry.headword_normalized)
  into
    selected_range_start,
    selected_range_end,
    available_entry_count
  from public.vocab_entries as entry
  where entry.dataset_id = p_dataset_id
    and entry.unit_id = any(p_unit_ids);

  if available_entry_count < p_question_count then
    raise exception 'insufficient_vocab_entries' using errcode = '22023';
  end if;

  if p_student_ids is null
    or cardinality(p_student_ids) = 0
    or cardinality(p_student_ids) <> (
      select count(distinct selected.student_id)
      from unnest(p_student_ids) as selected(student_id)
      where selected.student_id is not null
    )
  then
    raise exception 'invalid_or_duplicate_student' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.students
    where id = any(p_student_ids)
      and status = 'active'
  ) <> cardinality(p_student_ids) then
    raise exception 'invalid_or_inactive_student' using errcode = '22023';
  end if;

  if p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
  then
    raise exception 'question_count_mismatch' using errcode = '22023';
  end if;

  insert into public.assignments (
    title,
    dataset_id,
    range_start,
    range_end,
    question_count,
    english_to_korean_ratio,
    time_limit_seconds,
    passing_score,
    passing_basis,
    retake_allowed,
    status,
    created_by,
    range_basis,
    question_order_mode,
    question_bank_version
  )
  values (
    trim(p_title),
    p_dataset_id,
    selected_range_start,
    selected_range_end,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    'initial',
    false,
    'draft',
    (select auth.uid()),
    'units',
    p_question_order_mode,
    1
  )
  returning id into created_assignment_id;

  insert into public.assignment_units (
    assignment_id,
    dataset_id,
    unit_id,
    position
  )
  select
    created_assignment_id,
    p_dataset_id,
    selected.unit_id,
    selected.position::integer
  from unnest(p_unit_ids) with ordinality
    as selected(unit_id, position);

  insert into public.assignment_students (
    assignment_id,
    student_id,
    assigned_by
  )
  select
    created_assignment_id,
    selected.student_id,
    (select auth.uid())
  from unnest(p_student_ids) as selected(student_id);

  insert into public.assignment_questions (
    assignment_id,
    vocab_entry_id,
    base_order_index,
    direction,
    prompt,
    choices,
    correct_choice_index
  )
  select
    created_assignment_id,
    question.vocab_entry_id,
    question.base_order_index,
    question.direction::public.question_direction,
    question.prompt,
    question.choices,
    question.correct_choice_index
  from jsonb_to_recordset(p_questions) as question(
    vocab_entry_id bigint,
    base_order_index integer,
    direction text,
    prompt text,
    choices jsonb,
    correct_choice_index smallint
  );

  get diagnostics inserted_question_count = row_count;
  if inserted_question_count <> p_question_count then
    raise exception 'question_insert_mismatch' using errcode = '22023';
  end if;

  if (
    select min(base_order_index) <> 1
      or max(base_order_index) <> p_question_count
    from public.assignment_questions
    where assignment_id = created_assignment_id
  ) then
    raise exception 'question_order_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.assignment_questions as question
    left join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    where question.assignment_id = created_assignment_id
      and (
        entry.id is null
        or entry.dataset_id <> p_dataset_id
        or entry.unit_id <> all(p_unit_ids)
        or (
          question.direction = 'english_to_korean'
          and (
            question.prompt <> entry.headword
            or question.choices ->> question.correct_choice_index
              <> entry.primary_meaning
          )
        )
        or (
          question.direction = 'korean_to_english'
          and (
            question.prompt <> entry.primary_meaning
            or question.choices ->> question.correct_choice_index
              <> entry.headword
            or exists (
              select 1
              from public.vocab_entries as other_entry
              where other_entry.dataset_id = p_dataset_id
                and other_entry.unit_id = any(p_unit_ids)
                and other_entry.headword_normalized
                  <> entry.headword_normalized
                and lower(trim(other_entry.primary_meaning))
                  = lower(trim(entry.primary_meaning))
            )
          )
        )
        or (
          select count(distinct lower(trim(choice.value)))
          from jsonb_array_elements_text(question.choices)
            as choice(value)
        ) <> 4
        or exists (
          select 1
          from jsonb_array_elements(question.choices)
            as choice(value)
          where jsonb_typeof(choice.value) <> 'string'
            or trim(choice.value #>> '{}') = ''
        )
      )
  ) then
    raise exception 'invalid_question_payload' using errcode = '22023';
  end if;

  expected_english_count := round(
    p_question_count
      * (p_english_to_korean_ratio::numeric / 100)
  );

  if (
    select count(*) filter (
      where direction = 'english_to_korean'
    )
    from public.assignment_questions
    where assignment_id = created_assignment_id
  ) <> expected_english_count then
    raise exception 'question_direction_ratio_mismatch'
      using errcode = '22023';
  end if;

  update public.assignments
  set status = 'active'
  where id = created_assignment_id;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.created',
    (select auth.uid()),
    jsonb_build_object(
      'assignment_id', created_assignment_id,
      'student_count', cardinality(p_student_ids),
      'unit_count', cardinality(p_unit_ids),
      'question_order_mode', p_question_order_mode,
      'question_bank_version', 1
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_assignment_with_question_bank(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language sql
security invoker
set search_path = ''
as $$
  select private.create_assignment_with_question_bank(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_student_ids,
    p_questions
  );
$$;

create function public.create_quiz_attempt_from_bank(
  p_student_id uuid,
  p_assignment_id uuid
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  assignment_row public.assignments%rowtype;
  created_attempt_id uuid;
  next_attempt_number integer;
  stale_attempt_id uuid;
  inserted_question_count integer;
begin
  perform 1
  from public.students
  where id = p_student_id
    and status = 'active'
  for update;

  if not found then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  select *
  into assignment_row
  from public.assignments
  where id = p_assignment_id
    and status = 'active'
    and range_basis = 'units'
    and question_bank_version is not null;

  if not found
    or (
      assignment_row.available_from is not null
      and assignment_row.available_from > now()
    )
    or (
      assignment_row.available_until is not null
      and assignment_row.available_until <= now()
    )
  then
    raise exception 'assignment_unavailable' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.assignment_students
    where assignment_id = p_assignment_id
      and student_id = p_student_id
  ) then
    raise exception 'assignment_not_owned' using errcode = '42501';
  end if;

  for stale_attempt_id in
    select id
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'in_progress'
      and deadline_at <= now()
  loop
    perform private.finalize_expired_quiz_attempt(
      p_student_id,
      stale_attempt_id
    );
  end loop;

  if not assignment_row.retake_allowed and exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'completed'
  ) then
    raise exception 'retake_not_allowed' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.quiz_attempts
    where assignment_id = p_assignment_id
      and student_id = p_student_id
      and status = 'in_progress'
  ) then
    raise exception 'attempt_already_in_progress' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.assignment_questions
    where assignment_id = p_assignment_id
  ) <> assignment_row.question_count then
    raise exception 'question_bank_incomplete' using errcode = '22023';
  end if;

  select coalesce(max(attempt_number), 0) + 1
  into next_attempt_number
  from public.quiz_attempts
  where assignment_id = p_assignment_id
    and student_id = p_student_id;

  insert into public.quiz_attempts (
    student_id,
    assignment_id,
    attempt_number,
    status,
    started_at,
    deadline_at,
    question_count_snapshot,
    time_limit_seconds_snapshot,
    passing_score_snapshot,
    passing_basis_snapshot
  )
  values (
    p_student_id,
    p_assignment_id,
    next_attempt_number,
    'in_progress',
    now(),
    now() + make_interval(secs => assignment_row.time_limit_seconds),
    assignment_row.question_count,
    assignment_row.time_limit_seconds,
    assignment_row.passing_score,
    assignment_row.passing_basis
  )
  returning id into created_attempt_id;

  with ordered_bank as (
    select
      question.*,
      row_number() over (
        order by
          case
            when assignment_row.question_order_mode = 'fixed'
              then question.base_order_index
          end,
          case
            when assignment_row.question_order_mode = 'random'
              then random()
          end,
          question.base_order_index
      )::integer as attempt_order_index
    from public.assignment_questions as question
    where question.assignment_id = p_assignment_id
  )
  insert into public.quiz_questions (
    attempt_id,
    vocab_entry_id,
    assignment_question_id,
    order_index,
    direction,
    prompt,
    choices,
    correct_choice_index
  )
  select
    created_attempt_id,
    question.vocab_entry_id,
    question.id,
    question.attempt_order_index,
    question.direction,
    question.prompt,
    question.choices,
    question.correct_choice_index
  from ordered_bank as question;

  get diagnostics inserted_question_count = row_count;
  if inserted_question_count <> assignment_row.question_count then
    raise exception 'question_insert_mismatch' using errcode = '22023';
  end if;

  return created_attempt_id;
end;
$$;

create or replace function public.answer_quiz_question(
  p_student_id uuid,
  p_attempt_id uuid,
  p_question_id uuid,
  p_phase text,
  p_choice_index smallint
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_row public.quiz_questions%rowtype;
  answer_correct boolean;
  initial_unanswered integer;
  retry_unanswered integer;
  initial_wrong integer;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5,2);
  final_score_value numeric(5,2);
  evaluation_time timestamptz;
  completed_now boolean := false;
  next_question_id uuid;
  next_phase text;
begin
  if p_choice_index is null
    or p_choice_index < 0
    or p_choice_index > 3
  then
    raise exception 'invalid_choice' using errcode = '22023';
  end if;

  if p_phase is null or p_phase not in ('initial', 'retry') then
    raise exception 'invalid_phase' using errcode = '22023';
  end if;

  select *
  into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status <> 'in_progress' then
    raise exception 'attempt_not_active' using errcode = '22023';
  end if;

  if attempt_row.deadline_at <= now() then
    return private.finalize_expired_quiz_attempt(
      p_student_id,
      p_attempt_id
    );
  end if;

  select *
  into question_row
  from public.quiz_questions
  where id = p_question_id
    and attempt_id = p_attempt_id
  for update;

  if not found then
    raise exception 'question_not_found' using errcode = 'P0002';
  end if;

  answer_correct := p_choice_index = question_row.correct_choice_index;

  if p_phase = 'initial' then
    if question_row.initial_choice_index is not null then
      if question_row.initial_choice_index = p_choice_index then
        answer_correct := question_row.initial_is_correct;
      else
        raise exception 'question_already_answered' using errcode = '22023';
      end if;
    else
      if question_row.order_index is distinct from (
        select min(order_index)
        from public.quiz_questions
        where attempt_id = p_attempt_id
          and initial_choice_index is null
      ) then
        raise exception 'question_out_of_order' using errcode = '22023';
      end if;

      update public.quiz_questions
      set initial_choice_index = p_choice_index,
          initial_is_correct = answer_correct,
          initial_answered_at = now()
      where id = p_question_id;
    end if;
  else
    if exists (
      select 1
      from public.quiz_questions
      where attempt_id = p_attempt_id
        and initial_choice_index is null
    ) then
      raise exception 'initial_phase_incomplete' using errcode = '22023';
    end if;

    if question_row.initial_is_correct is not false then
      raise exception 'retry_not_required' using errcode = '22023';
    end if;

    if question_row.retry_choice_index is not null then
      if question_row.retry_choice_index = p_choice_index then
        answer_correct := question_row.retry_is_correct;
      else
        raise exception 'retry_already_answered' using errcode = '22023';
      end if;
    else
      if question_row.order_index is distinct from (
        select min(order_index)
        from public.quiz_questions
        where attempt_id = p_attempt_id
          and initial_is_correct is false
          and retry_choice_index is null
      ) then
        raise exception 'retry_out_of_order' using errcode = '22023';
      end if;

      update public.quiz_questions
      set retry_choice_index = p_choice_index,
          retry_is_correct = answer_correct,
          retry_answered_at = now()
      where id = p_question_id;
    end if;
  end if;

  select
    count(*),
    count(*) filter (where initial_choice_index is null),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    ),
    count(*) filter (where initial_is_correct is false)
  into
    question_total,
    initial_unanswered,
    retry_unanswered,
    initial_wrong
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  completed_now :=
    initial_unanswered = 0
    and (
      initial_wrong = 0
      or retry_unanswered = 0
    );

  if completed_now then
    select
      count(*),
      count(*) filter (where initial_is_correct is true),
      count(*) filter (
        where initial_is_correct is false
          and retry_is_correct is true
      ),
      count(*) filter (
        where initial_is_correct is false
          and coalesce(retry_is_correct, false) is false
      )
    into
      question_total,
      initial_correct,
      retry_correct,
      unresolved_wrong
    from public.quiz_questions
    where attempt_id = p_attempt_id;

    initial_score_value := round(
      (initial_correct::numeric / question_total) * 100,
      2
    );
    final_score_value := round(
      ((initial_correct + retry_correct)::numeric / question_total) * 100,
      2
    );
    evaluation_time := clock_timestamp();

    update public.quiz_attempts
    set status = 'completed',
        completed_at = evaluation_time,
        initial_correct_count = initial_correct,
        retry_correct_count = retry_correct,
        unresolved_wrong_count = unresolved_wrong,
        initial_score = initial_score_value,
        final_score = final_score_value,
        passed = case
          when passing_basis_snapshot = 'initial'
            then initial_score_value >= passing_score_snapshot
          else final_score_value >= passing_score_snapshot
        end,
        elapsed_seconds = floor(
          extract(epoch from (evaluation_time - started_at))
        )::integer
    where id = p_attempt_id;

    insert into public.student_vocab_state (
      student_id,
      vocab_entry_id,
      unresolved_wrong_count,
      last_wrong_at,
      resolved_at,
      last_attempt_id,
      last_evaluated_at
    )
    select
      p_student_id,
      vocab_entry_id,
      1,
      evaluation_time,
      null,
      p_attempt_id,
      evaluation_time
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and coalesce(retry_is_correct, false) is false
    on conflict (student_id, vocab_entry_id)
    do update set
      unresolved_wrong_count =
        public.student_vocab_state.unresolved_wrong_count + 1,
      last_wrong_at = excluded.last_wrong_at,
      resolved_at = null,
      last_attempt_id = excluded.last_attempt_id,
      last_evaluated_at = excluded.last_evaluated_at
    where excluded.last_evaluated_at
      >= public.student_vocab_state.last_evaluated_at;

    insert into public.student_vocab_state (
      student_id,
      vocab_entry_id,
      unresolved_wrong_count,
      resolved_at,
      last_attempt_id,
      last_evaluated_at
    )
    select
      p_student_id,
      vocab_entry_id,
      0,
      evaluation_time,
      p_attempt_id,
      evaluation_time
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and (
        initial_is_correct is true
        or retry_is_correct is true
      )
    on conflict (student_id, vocab_entry_id)
    do update set
      unresolved_wrong_count = 0,
      resolved_at = excluded.resolved_at,
      last_attempt_id = excluded.last_attempt_id,
      last_evaluated_at = excluded.last_evaluated_at
    where excluded.last_evaluated_at
      >= public.student_vocab_state.last_evaluated_at;
  elsif initial_unanswered > 0 then
    next_phase := 'initial';
    select id
    into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_choice_index is null
    order by order_index
    limit 1;
  else
    next_phase := 'retry';
    select id
    into next_question_id
    from public.quiz_questions
    where attempt_id = p_attempt_id
      and initial_is_correct is false
      and retry_choice_index is null
    order by order_index
    limit 1;
  end if;

  return jsonb_build_object(
    'correct', answer_correct,
    'correctChoiceIndex', question_row.correct_choice_index,
    'completed', completed_now,
    'expired', false,
    'needsRetry',
      initial_unanswered = 0
      and initial_wrong > 0
      and retry_unanswered > 0,
    'nextQuestionId', next_question_id,
    'nextPhase', next_phase,
    'initialAnsweredCount', question_total - initial_unanswered,
    'initialQuestionCount', question_total,
    'retryAnsweredCount', initial_wrong - retry_unanswered,
    'retryQuestionCount', initial_wrong
  );
end;
$$;

revoke all on function private.create_assignment_with_question_bank(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) from public, anon;
revoke all on function public.create_assignment_with_question_bank(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) from public, anon;
revoke all on function public.create_quiz_attempt_from_bank(
  uuid,
  uuid
) from public, anon, authenticated;

grant execute on function private.create_assignment_with_question_bank(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) to authenticated;
grant execute on function public.create_assignment_with_question_bank(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) to authenticated;
grant execute on function public.create_quiz_attempt_from_bank(
  uuid,
  uuid
) to service_role;

alter table public.vocab_units enable row level security;
alter table public.assignment_units enable row level security;
alter table public.assignment_questions enable row level security;

create policy "active admins view vocab units"
on public.vocab_units for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins view assignment units"
on public.assignment_units for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins view assignment questions"
on public.assignment_questions for select to authenticated
using ((select private.is_active_admin()));

revoke all on table public.vocab_units
  from public, anon, authenticated;
revoke all on table public.assignment_units
  from public, anon, authenticated;
revoke all on table public.assignment_questions
  from public, anon, authenticated;

grant select on table public.vocab_units to authenticated;
grant select on table public.assignment_units to authenticated;
grant select on table public.assignment_questions to authenticated;

grant all on table public.vocab_units to service_role;
grant all on table public.assignment_units to service_role;
grant all on table public.assignment_questions to service_role;

notify pgrst, 'reload schema';
