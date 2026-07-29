create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;
alter default privileges revoke execute on functions from public;

create type public.student_status as enum ('active', 'blocked');
create type public.access_code_status as enum ('active', 'blocked');
create type public.assignment_status as enum ('draft', 'active', 'closed');
create type public.attempt_status as enum ('in_progress', 'completed', 'expired');
create type public.question_direction as enum ('english_to_korean', 'korean_to_english');
create type public.passing_basis as enum ('initial', 'after_retry');
create type public.dataset_status as enum ('pending_review', 'ready', 'retired');

create table public.admin_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.students (
  id uuid primary key default extensions.gen_random_uuid(),
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  school_name text check (school_name is null or char_length(trim(school_name)) between 1 and 120),
  grade_label text check (grade_label is null or char_length(trim(grade_label)) between 1 and 40),
  note text check (note is null or char_length(note) <= 2000),
  status public.student_status not null default 'active',
  code_generation integer not null default 0 check (code_generation >= 0),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.student_codes (
  student_id uuid primary key references public.students(id) on delete cascade,
  lookup_hmac text not null unique check (lookup_hmac ~ '^[A-F0-9]{64}$'),
  encrypted_code text not null,
  encryption_iv text not null,
  encryption_tag text not null,
  code_generation integer not null check (code_generation > 0),
  status public.access_code_status not null default 'active',
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  rotated_at timestamptz,
  blocked_at timestamptz,
  constraint student_codes_expiry_future_check
    check (expires_at is null or expires_at > created_at)
);

create table public.student_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[A-F0-9]{64}$'),
  code_generation integer not null check (code_generation > 0),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoke_reason text check (revoke_reason is null or char_length(revoke_reason) <= 120),
  user_agent_hash text check (user_agent_hash is null or user_agent_hash ~ '^[A-F0-9]{64}$'),
  constraint student_sessions_expiry_after_issue
    check (expires_at > issued_at)
);

create table public.student_login_attempts (
  id bigint generated always as identity primary key,
  code_lookup_hmac text not null check (code_lookup_hmac ~ '^[A-F0-9]{64}$'),
  ip_hash text not null check (ip_hash ~ '^[A-F0-9]{64}$'),
  was_successful boolean not null,
  attempted_at timestamptz not null default now()
);

create table public.vocab_datasets (
  id uuid primary key default extensions.gen_random_uuid(),
  dataset_key text not null unique check (dataset_key ~ '^[a-z0-9][a-z0-9-]{2,79}$'),
  title text not null check (char_length(trim(title)) between 1 and 160),
  edition text check (edition is null or char_length(trim(edition)) between 1 and 80),
  source_label text not null check (char_length(trim(source_label)) between 1 and 200),
  source_sha256 text not null check (source_sha256 ~ '^[A-F0-9]{64}$'),
  row_count integer not null check (row_count >= 0),
  status public.dataset_status not null default 'pending_review',
  is_active boolean not null default true,
  imported_at timestamptz not null default now(),
  imported_by uuid references auth.users(id),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create table public.vocab_entries (
  id bigint generated always as identity primary key,
  dataset_id uuid not null references public.vocab_datasets(id) on delete cascade,
  source_row integer not null check (source_row > 0),
  headword text not null check (char_length(trim(headword)) between 1 and 160),
  headword_normalized text not null check (char_length(trim(headword_normalized)) between 1 and 160),
  pronunciation_ko text check (
    pronunciation_ko is null or char_length(trim(pronunciation_ko)) between 1 and 160
  ),
  meanings text[] not null check (cardinality(meanings) > 0),
  primary_meaning text not null check (char_length(trim(primary_meaning)) between 1 and 500),
  english_definition text,
  example_en text,
  example_ko text,
  source_ref text check (source_ref is null or char_length(source_ref) <= 500),
  row_sha256 text not null check (row_sha256 ~ '^[A-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (dataset_id, source_row),
  unique (dataset_id, row_sha256)
);

create table public.assignments (
  id uuid primary key default extensions.gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 160),
  dataset_id uuid not null references public.vocab_datasets(id),
  range_start integer not null check (range_start > 0),
  range_end integer not null check (range_end >= range_start),
  question_count integer not null check (question_count between 4 and 500),
  english_to_korean_ratio smallint not null default 50 check (
    english_to_korean_ratio between 0 and 100
  ),
  time_limit_seconds integer not null check (time_limit_seconds between 30 and 10800),
  passing_score smallint not null check (passing_score between 0 and 100),
  passing_basis public.passing_basis not null default 'initial',
  retake_allowed boolean not null default false,
  status public.assignment_status not null default 'draft',
  available_from timestamptz,
  available_until timestamptz,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint assignments_availability_order
    check (available_until is null or available_from is null or available_until > available_from)
);

create table public.assignment_students (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  assigned_at timestamptz not null default now(),
  assigned_by uuid not null references auth.users(id),
  primary key (assignment_id, student_id)
);

create table public.quiz_attempts (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id uuid not null references public.students(id) on delete cascade,
  assignment_id uuid not null references public.assignments(id) on delete restrict,
  attempt_number integer not null check (attempt_number > 0),
  status public.attempt_status not null default 'in_progress',
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  completed_at timestamptz,
  question_count_snapshot integer not null check (question_count_snapshot between 4 and 500),
  time_limit_seconds_snapshot integer not null check (
    time_limit_seconds_snapshot between 30 and 10800
  ),
  passing_score_snapshot smallint not null check (passing_score_snapshot between 0 and 100),
  passing_basis_snapshot public.passing_basis not null,
  initial_correct_count integer check (initial_correct_count is null or initial_correct_count >= 0),
  retry_correct_count integer check (retry_correct_count is null or retry_correct_count >= 0),
  unresolved_wrong_count integer check (
    unresolved_wrong_count is null or unresolved_wrong_count >= 0
  ),
  initial_score numeric(5,2) check (initial_score is null or initial_score between 0 and 100),
  final_score numeric(5,2) check (final_score is null or final_score between 0 and 100),
  passed boolean,
  elapsed_seconds integer check (elapsed_seconds is null or elapsed_seconds >= 0),
  unique (student_id, assignment_id, attempt_number),
  constraint quiz_attempts_deadline_after_start check (deadline_at > started_at),
  constraint quiz_attempts_state_consistency check (
    (
      status = 'in_progress'
      and completed_at is null
      and initial_correct_count is null
      and retry_correct_count is null
      and unresolved_wrong_count is null
      and initial_score is null
      and final_score is null
      and passed is null
      and elapsed_seconds is null
    )
    or (
      status in ('completed', 'expired')
      and completed_at is not null
      and initial_correct_count is not null
      and retry_correct_count is not null
      and unresolved_wrong_count is not null
      and initial_correct_count
        + retry_correct_count
        + unresolved_wrong_count
        = question_count_snapshot
      and initial_score is not null
      and final_score is not null
      and final_score >= initial_score
      and passed is not null
      and elapsed_seconds is not null
    )
  )
);

create table public.quiz_questions (
  id uuid primary key default extensions.gen_random_uuid(),
  attempt_id uuid not null references public.quiz_attempts(id) on delete cascade,
  vocab_entry_id bigint not null references public.vocab_entries(id) on delete restrict,
  order_index integer not null check (order_index > 0),
  direction public.question_direction not null,
  prompt text not null,
  choices jsonb not null check (
    jsonb_typeof(choices) = 'array' and jsonb_array_length(choices) = 4
  ),
  correct_choice_index smallint not null check (correct_choice_index between 0 and 3),
  initial_choice_index smallint check (initial_choice_index between 0 and 3),
  initial_is_correct boolean,
  initial_answered_at timestamptz,
  retry_choice_index smallint check (retry_choice_index between 0 and 3),
  retry_is_correct boolean,
  retry_answered_at timestamptz,
  unique (attempt_id, order_index),
  unique (attempt_id, vocab_entry_id)
);

create table public.student_vocab_state (
  student_id uuid not null references public.students(id) on delete cascade,
  vocab_entry_id bigint not null references public.vocab_entries(id) on delete cascade,
  unresolved_wrong_count integer not null default 0 check (unresolved_wrong_count >= 0),
  last_wrong_at timestamptz,
  resolved_at timestamptz,
  last_attempt_id uuid not null references public.quiz_attempts(id) on delete restrict,
  last_evaluated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (student_id, vocab_entry_id)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  event_type text not null check (event_type ~ '^[a-z0-9_.-]{3,100}$'),
  actor_admin_id uuid references auth.users(id),
  student_id uuid references public.students(id) on delete set null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default now()
);

create index student_sessions_active_lookup_idx
  on public.student_sessions (token_hash, expires_at)
  where revoked_at is null;
create index student_sessions_student_active_idx
  on public.student_sessions (student_id, code_generation)
  where revoked_at is null;
create index students_created_by_idx
  on public.students (created_by);
create index student_login_attempts_ip_time_idx
  on public.student_login_attempts (ip_hash, attempted_at desc);
create index student_login_attempts_code_time_idx
  on public.student_login_attempts (code_lookup_hmac, attempted_at desc);
create index vocab_datasets_imported_by_idx
  on public.vocab_datasets (imported_by);
create index vocab_entries_dataset_range_idx
  on public.vocab_entries (dataset_id, source_row);
create index assignments_dataset_idx
  on public.assignments (dataset_id);
create index assignments_created_by_idx
  on public.assignments (created_by);
create index assignments_status_window_idx
  on public.assignments (status, available_from, available_until);
create index assignment_students_student_idx
  on public.assignment_students (student_id, assignment_id);
create index assignment_students_assigned_by_idx
  on public.assignment_students (assigned_by);
create index quiz_attempts_student_assignment_idx
  on public.quiz_attempts (student_id, assignment_id, started_at desc);
create index quiz_attempts_assignment_idx
  on public.quiz_attempts (assignment_id, started_at desc);
create unique index quiz_attempts_one_in_progress_idx
  on public.quiz_attempts (student_id, assignment_id)
  where status = 'in_progress';
create index quiz_questions_attempt_order_idx
  on public.quiz_questions (attempt_id, order_index);
create index quiz_questions_vocab_entry_idx
  on public.quiz_questions (vocab_entry_id);
create index student_vocab_state_vocab_entry_idx
  on public.student_vocab_state (vocab_entry_id);
create index student_vocab_state_last_attempt_idx
  on public.student_vocab_state (last_attempt_id);
create index audit_events_actor_admin_time_idx
  on public.audit_events (actor_admin_id, created_at desc);
create index audit_events_student_time_idx
  on public.audit_events (student_id, created_at desc);

create function private.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger admin_profiles_set_updated_at
before update on public.admin_profiles
for each row execute function private.set_updated_at();

create trigger students_set_updated_at
before update on public.students
for each row execute function private.set_updated_at();

create trigger vocab_entries_set_updated_at
before update on public.vocab_entries
for each row execute function private.set_updated_at();

create trigger assignments_set_updated_at
before update on public.assignments
for each row execute function private.set_updated_at();

create trigger student_vocab_state_set_updated_at
before update on public.student_vocab_state
for each row execute function private.set_updated_at();

create function private.is_active_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    (select auth.uid()) is not null
    and exists (
      select 1
      from public.admin_profiles
      where user_id = (select auth.uid())
        and is_active
    );
$$;

revoke all on function private.is_active_admin() from public;
revoke all on function private.set_updated_at() from public;
grant execute on function private.is_active_admin() to authenticated, service_role;

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
    note,
    status,
    code_generation,
    created_by
  )
  values (
    trim(p_display_name),
    nullif(trim(p_school_name), ''),
    nullif(trim(p_grade_label), ''),
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

  insert into public.audit_events (event_type, actor_admin_id, student_id)
  values ('student.created', (select auth.uid()), created_student_id);

  return query select created_student_id, 1;
end;
$$;

create function public.rotate_student_code(
  p_student_id uuid,
  p_lookup_hmac text,
  p_encrypted_code text,
  p_encryption_iv text,
  p_encryption_tag text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_generation integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select code_generation + 1
    into next_generation
  from public.students
  where id = p_student_id
  for update;

  if next_generation is null then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  update public.students
  set code_generation = next_generation,
      status = 'active'
  where id = p_student_id;

  update public.student_codes
  set lookup_hmac = p_lookup_hmac,
      encrypted_code = p_encrypted_code,
      encryption_iv = p_encryption_iv,
      encryption_tag = p_encryption_tag,
      code_generation = next_generation,
      status = 'active',
      expires_at = null,
      rotated_at = now(),
      blocked_at = null
  where student_id = p_student_id;

  if not found then
    raise exception 'student_code_not_found' using errcode = 'P0002';
  end if;

  update public.student_sessions
  set revoked_at = coalesce(revoked_at, now()),
      revoke_reason = coalesce(revoke_reason, 'code_rotated')
  where student_id = p_student_id
    and revoked_at is null;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'student.code_rotated',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object('code_generation', next_generation)
  );

  return next_generation;
end;
$$;

create function public.set_student_access_status(
  p_student_id uuid,
  p_status public.student_status
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_generation integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    case
      when p_status = 'blocked' then code_generation + 1
      else code_generation
    end
    into next_generation
  from public.students
  where id = p_student_id
  for update;

  if next_generation is null then
    raise exception 'student_not_found' using errcode = 'P0002';
  end if;

  update public.students
  set status = p_status,
      code_generation = next_generation
  where id = p_student_id;

  update public.student_codes
  set status = case when p_status = 'blocked' then 'blocked' else 'active' end,
      code_generation = next_generation,
      blocked_at = case when p_status = 'blocked' then now() else null end
  where student_id = p_student_id;

  if p_status = 'blocked' then
    update public.student_sessions
    set revoked_at = coalesce(revoked_at, now()),
        revoke_reason = coalesce(revoke_reason, 'student_blocked')
    where student_id = p_student_id
      and revoked_at is null;
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    case when p_status = 'blocked' then 'student.blocked' else 'student.activated' end,
    (select auth.uid()),
    p_student_id,
    jsonb_build_object('code_generation', next_generation)
  );

  return next_generation;
end;
$$;

create function public.consume_student_login_attempt(
  p_code_lookup_hmac text,
  p_ip_hash text,
  p_window_minutes integer,
  p_max_code_failures integer,
  p_max_ip_failures integer
)
returns table (
  rate_limited boolean,
  authenticated_student_id uuid,
  authenticated_display_name text,
  authenticated_code_generation integer
)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  code_lock_key bigint;
  ip_lock_key bigint;
  code_failure_count integer;
  ip_failure_count integer;
  found_student_id uuid;
  found_display_name text;
  found_student_status public.student_status;
  found_student_generation integer;
  found_code_status public.access_code_status;
  found_code_generation integer;
  found_code_expires_at timestamptz;
  login_valid boolean;
begin
  if p_code_lookup_hmac is null
    or p_code_lookup_hmac !~ '^[A-F0-9]{64}$'
    or p_ip_hash is null
    or p_ip_hash !~ '^[A-F0-9]{64}$'
    or p_window_minutes not between 1 and 1440
    or p_max_code_failures not between 1 and 100
    or p_max_ip_failures not between 1 and 1000
  then
    raise exception 'invalid_login_guard_input' using errcode = '22023';
  end if;

  code_lock_key := pg_catalog.hashtextextended(
    'code:' || p_code_lookup_hmac,
    0
  );
  ip_lock_key := pg_catalog.hashtextextended(
    'ip:' || p_ip_hash,
    0
  );
  perform pg_catalog.pg_advisory_xact_lock(
    least(code_lock_key, ip_lock_key)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    greatest(code_lock_key, ip_lock_key)
  );

  select count(*)
    into code_failure_count
  from public.student_login_attempts
  where code_lookup_hmac = p_code_lookup_hmac
    and not was_successful
    and attempted_at >= now() - make_interval(mins => p_window_minutes);

  select count(*)
    into ip_failure_count
  from public.student_login_attempts
  where ip_hash = p_ip_hash
    and not was_successful
    and attempted_at >= now() - make_interval(mins => p_window_minutes);

  if code_failure_count >= p_max_code_failures
    or ip_failure_count >= p_max_ip_failures
  then
    return query select true, null::uuid, null::text, null::integer;
    return;
  end if;

  select
    student.id,
    student.display_name,
    student.status,
    student.code_generation,
    student_code.status,
    student_code.code_generation,
    student_code.expires_at
  into
    found_student_id,
    found_display_name,
    found_student_status,
    found_student_generation,
    found_code_status,
    found_code_generation,
    found_code_expires_at
  from public.student_codes as student_code
  join public.students as student
    on student.id = student_code.student_id
  where student_code.lookup_hmac = p_code_lookup_hmac;

  login_valid :=
    found_student_id is not null
    and found_student_status = 'active'
    and found_code_status = 'active'
    and found_student_generation = found_code_generation
    and (
      found_code_expires_at is null
      or found_code_expires_at > now()
    );

  insert into public.student_login_attempts (
    code_lookup_hmac,
    ip_hash,
    was_successful
  )
  values (
    p_code_lookup_hmac,
    p_ip_hash,
    login_valid
  );

  if login_valid then
    return query
    select
      false,
      found_student_id,
      found_display_name,
      found_code_generation;
  else
    return query select false, null::uuid, null::text, null::integer;
  end if;
end;
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
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
  available_entry_count integer;
  available_meaning_count integer;
  available_unambiguous_meaning_count integer;
  required_korean_question_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if cardinality(p_student_ids) is null or cardinality(p_student_ids) = 0 then
    raise exception 'student_required' using errcode = '22023';
  end if;

  if cardinality(p_student_ids) <> (
    select count(distinct selected.student_id)
    from unnest(p_student_ids) as selected(student_id)
    where selected.student_id is not null
  ) then
    raise exception 'invalid_or_duplicate_student' using errcode = '22023';
  end if;

  if p_range_start is null
    or p_range_end is null
    or p_range_start < 1
    or p_range_end < p_range_start
    or p_question_count is null
    or p_question_count not between 4 and 500
  then
    raise exception 'invalid_assignment_range' using errcode = '22023';
  end if;

  with deduplicated_entries as (
    select distinct on (headword_normalized)
      headword_normalized,
      lower(trim(primary_meaning)) as meaning_key
    from public.vocab_entries
    where dataset_id = p_dataset_id
      and source_row between p_range_start and p_range_end
    order by headword_normalized, source_row
  ),
  meaning_counts as (
    select meaning_key, count(*) as occurrence_count
    from deduplicated_entries
    group by meaning_key
  )
  select
    (select count(*) from deduplicated_entries),
    (select count(distinct meaning_key) from deduplicated_entries),
    (
      select count(*)
      from meaning_counts
      where occurrence_count = 1
    )
  into
    available_entry_count,
    available_meaning_count,
    available_unambiguous_meaning_count;

  if available_entry_count < p_question_count then
    raise exception 'insufficient_vocab_entries' using errcode = '22023';
  end if;

  if available_entry_count < 4 or available_meaning_count < 4 then
    raise exception 'insufficient_unique_choices' using errcode = '22023';
  end if;

  required_korean_question_count :=
    p_question_count
    - round(p_question_count * 0.5)::integer;

  if available_unambiguous_meaning_count
    < required_korean_question_count
  then
    raise exception 'insufficient_unambiguous_meanings'
      using errcode = '22023';
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
    created_by
  )
  values (
    trim(p_title),
    p_dataset_id,
    p_range_start,
    p_range_end,
    p_question_count,
    50,
    p_time_limit_seconds,
    p_passing_score,
    'initial',
    p_retake_allowed,
    'active',
    (select auth.uid())
  )
  returning id into created_assignment_id;

  insert into public.assignment_students (
    assignment_id,
    student_id,
    assigned_by
  )
  select
    created_assignment_id,
    student_id,
    (select auth.uid())
  from unnest(p_student_ids) as selected(student_id)
  where exists (
    select 1
    from public.students
    where id = selected.student_id
      and status = 'active'
  );

  if (
    select count(*)
    from public.assignment_students
    where assignment_id = created_assignment_id
  ) <> cardinality(p_student_ids) then
    raise exception 'invalid_or_duplicate_student' using errcode = '22023';
  end if;

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
      'student_count', cardinality(p_student_ids)
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_quiz_attempt(
  p_student_id uuid,
  p_assignment_id uuid,
  p_questions jsonb
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
begin
  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'questions_must_be_array' using errcode = '22023';
  end if;

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
    and status = 'active';

  if not found
    or (assignment_row.available_from is not null and assignment_row.available_from > now())
    or (assignment_row.available_until is not null and assignment_row.available_until <= now())
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

  if jsonb_array_length(p_questions) <> assignment_row.question_count then
    raise exception 'question_count_mismatch' using errcode = '22023';
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

  insert into public.quiz_questions (
    attempt_id,
    vocab_entry_id,
    order_index,
    direction,
    prompt,
    choices,
    correct_choice_index
  )
  select
    created_attempt_id,
    question.vocab_entry_id,
    question.order_index,
    question.direction::public.question_direction,
    question.prompt,
    question.choices,
    question.correct_choice_index
  from jsonb_to_recordset(p_questions) as question(
    vocab_entry_id bigint,
    order_index integer,
    direction text,
    prompt text,
    choices jsonb,
    correct_choice_index smallint
  );

  if (
    select count(*)
    from public.quiz_questions
    where attempt_id = created_attempt_id
  ) <> assignment_row.question_count then
    raise exception 'question_insert_mismatch' using errcode = '22023';
  end if;

  if (
    select min(order_index) <> 1
      or max(order_index) <> assignment_row.question_count
    from public.quiz_questions
    where attempt_id = created_attempt_id
  ) then
    raise exception 'question_order_mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.quiz_questions as quiz_question
    left join public.vocab_entries as vocab_entry
      on vocab_entry.id = quiz_question.vocab_entry_id
    where quiz_question.attempt_id = created_attempt_id
      and (
        vocab_entry.id is null
        or vocab_entry.dataset_id <> assignment_row.dataset_id
        or vocab_entry.source_row not between
          assignment_row.range_start and assignment_row.range_end
        or (
          quiz_question.direction = 'english_to_korean'
          and (
            quiz_question.prompt <> vocab_entry.headword
            or quiz_question.choices ->> quiz_question.correct_choice_index
              <> vocab_entry.primary_meaning
          )
        )
        or (
          quiz_question.direction = 'korean_to_english'
          and (
            quiz_question.prompt <> vocab_entry.primary_meaning
            or quiz_question.choices ->> quiz_question.correct_choice_index
              <> vocab_entry.headword
            or exists (
              select 1
              from public.vocab_entries as other_entry
              where other_entry.dataset_id = assignment_row.dataset_id
                and other_entry.source_row between
                  assignment_row.range_start and assignment_row.range_end
                and other_entry.headword_normalized
                  <> vocab_entry.headword_normalized
                and lower(trim(other_entry.primary_meaning))
                  = lower(trim(vocab_entry.primary_meaning))
            )
          )
        )
        or (
          select count(distinct lower(trim(choice.value)))
          from jsonb_array_elements_text(quiz_question.choices)
            as choice(value)
        ) <> 4
        or exists (
          select 1
          from jsonb_array_elements(quiz_question.choices)
            as choice(value)
          where jsonb_typeof(choice.value) <> 'string'
            or trim(choice.value #>> '{}') = ''
        )
      )
  ) then
    raise exception 'invalid_question_payload' using errcode = '22023';
  end if;

  if (
    select count(*) filter (
      where direction = 'english_to_korean'
    )
    from public.quiz_questions
    where attempt_id = created_attempt_id
  ) <> round(
    assignment_row.question_count
      * (assignment_row.english_to_korean_ratio::numeric / 100)
  ) then
    raise exception 'question_direction_ratio_mismatch'
      using errcode = '22023';
  end if;

  return created_attempt_id;
end;
$$;

create function private.finalize_expired_quiz_attempt(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  attempt_row public.quiz_attempts%rowtype;
  question_total integer;
  initial_correct integer;
  retry_correct integer;
  unresolved_wrong integer;
  initial_score_value numeric(5,2);
  final_score_value numeric(5,2);
  evaluation_time timestamptz;
begin
  select *
    into attempt_row
  from public.quiz_attempts
  where id = p_attempt_id
    and student_id = p_student_id
  for update;

  if not found then
    raise exception 'attempt_not_found' using errcode = 'P0002';
  end if;

  if attempt_row.status = 'completed' then
    return jsonb_build_object('completed', true, 'expired', false);
  end if;

  if attempt_row.status = 'expired' then
    return jsonb_build_object('completed', true, 'expired', true);
  end if;

  if attempt_row.deadline_at > now() then
    raise exception 'attempt_not_expired' using errcode = '22023';
  end if;

  select
    count(*),
    count(*) filter (where initial_is_correct is true),
    count(*) filter (
      where initial_is_correct is false
        and retry_is_correct is true
    ),
    count(*) filter (
      where coalesce(initial_is_correct, false) is false
        and coalesce(retry_is_correct, false) is false
    )
  into
    question_total,
    initial_correct,
    retry_correct,
    unresolved_wrong
  from public.quiz_questions
  where attempt_id = p_attempt_id;

  if question_total = 0 then
    raise exception 'attempt_has_no_questions' using errcode = '22023';
  end if;

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
  set status = 'expired',
      completed_at = evaluation_time,
      initial_correct_count = initial_correct,
      retry_correct_count = retry_correct,
      unresolved_wrong_count = unresolved_wrong,
      initial_score = initial_score_value,
      final_score = final_score_value,
      passed = false,
      elapsed_seconds = floor(
        extract(epoch from (deadline_at - started_at))
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
    and initial_choice_index is not null
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

  return jsonb_build_object(
    'completed', true,
    'expired', true,
    'initialScore', initial_score_value,
    'finalScore', final_score_value
  );
end;
$$;

revoke all on function private.finalize_expired_quiz_attempt(
  uuid, uuid
) from public, anon, authenticated;
grant execute on function private.finalize_expired_quiz_attempt(
  uuid, uuid
) to service_role;

create function public.answer_quiz_question(
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
      raise exception 'question_already_answered' using errcode = '22023';
    end if;

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
      raise exception 'retry_already_answered' using errcode = '22023';
    end if;

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

  select
    count(*) filter (where initial_choice_index is null),
    count(*) filter (
      where initial_is_correct is false
        and retry_choice_index is null
    ),
    count(*) filter (where initial_is_correct is false)
  into
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

    initial_score_value := round((initial_correct::numeric / question_total) * 100, 2);
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
  end if;

  return jsonb_build_object(
    'correct', answer_correct,
    'correctChoiceIndex', question_row.correct_choice_index,
    'completed', completed_now,
    'needsRetry', initial_unanswered = 0 and initial_wrong > 0 and retry_unanswered > 0
  );
end;
$$;

create function public.expire_quiz_attempt(
  p_student_id uuid,
  p_attempt_id uuid
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.finalize_expired_quiz_attempt(
    p_student_id,
    p_attempt_id
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
revoke all on function public.consume_student_login_attempt(
  text, text, integer, integer, integer
) from public, anon, authenticated;
revoke all on function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) from public, anon;
revoke all on function public.create_quiz_attempt(
  uuid, uuid, jsonb
) from public, anon, authenticated;
revoke all on function public.answer_quiz_question(
  uuid, uuid, uuid, text, smallint
) from public, anon, authenticated;
revoke all on function public.expire_quiz_attempt(
  uuid, uuid
) from public, anon, authenticated;

grant execute on function public.create_student_with_code(
  text, text, text, text, text, text, text, text
) to authenticated;
grant execute on function public.rotate_student_code(
  uuid, text, text, text, text
) to authenticated;
grant execute on function public.set_student_access_status(
  uuid, public.student_status
) to authenticated;
grant execute on function public.consume_student_login_attempt(
  text, text, integer, integer, integer
) to service_role;
grant execute on function public.create_assignment_with_students(
  text, uuid, integer, integer, integer, integer, smallint, boolean, uuid[]
) to authenticated;
grant execute on function public.create_quiz_attempt(
  uuid, uuid, jsonb
) to service_role;
grant execute on function public.answer_quiz_question(
  uuid, uuid, uuid, text, smallint
) to service_role;
grant execute on function public.expire_quiz_attempt(
  uuid, uuid
) to service_role;

alter table public.admin_profiles enable row level security;
alter table public.students enable row level security;
alter table public.student_codes enable row level security;
alter table public.student_sessions enable row level security;
alter table public.student_login_attempts enable row level security;
alter table public.vocab_datasets enable row level security;
alter table public.vocab_entries enable row level security;
alter table public.assignments enable row level security;
alter table public.assignment_students enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.quiz_questions enable row level security;
alter table public.student_vocab_state enable row level security;
alter table public.audit_events enable row level security;

create policy "active admins manage admin profiles"
on public.admin_profiles for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage students"
on public.students for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage student codes"
on public.student_codes for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage student sessions"
on public.student_sessions for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage student login attempts"
on public.student_login_attempts for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage vocab datasets"
on public.vocab_datasets for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage vocab entries"
on public.vocab_entries for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage assignments"
on public.assignments for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage assignment students"
on public.assignment_students for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage quiz attempts"
on public.quiz_attempts for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage quiz questions"
on public.quiz_questions for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage student vocab state"
on public.student_vocab_state for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins manage audit events"
on public.audit_events for select to authenticated
using ((select private.is_active_admin()));

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;

grant select on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;
grant all on all sequences in schema public to service_role;
