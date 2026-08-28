-- R2-2 keeps edit metadata and completion-gated series ownership intact when
-- an unstarted student assignment is replaced.

begin;

alter table public.assignments
  add column review_scope text;

alter table public.assignments
  add constraint assignments_review_scope_check
  check (review_scope is null or review_scope in ('dataset', 'selection'));

-- Keep the server-calculated request hash alongside the bound ledger hash.
-- The raw value lets the previous lookup endpoint safely recover a completed
-- request while the new bound value protects edit-only metadata at the DB edge.
alter table private.assignment_replacement_requests
  add column client_request_sha256 text;

alter table private.assignment_replacement_requests
  add constraint assignment_replacement_requests_client_sha_check
  check (
    client_request_sha256 is null
    or client_request_sha256 ~ '^[0-9a-f]{64}$'
  );

update private.assignment_replacement_requests
set client_request_sha256 = request_sha256
where client_request_sha256 is null;

-- Historical rows, including soft-deleted rows, need the same metadata. This
-- trigger is restored before the migration finishes; rollback also restores it.
alter table public.assignments
  disable trigger assignments_prevent_deleted_reactivation;
alter table public.assignments
  disable trigger assignments_set_updated_at;

do $migration$
declare
  conflict_count integer;
begin
  select count(*)::integer
  into conflict_count
  from (
    select event.details ->> 'assignmentId' as assignment_id
    from public.audit_events as event
    where event.event_type in (
        'assignment.mixed_review_v7_created',
        'assignment.mixed_review_v8_created'
      )
      and event.details ->> 'reviewScope' in ('dataset', 'selection')
      and event.details ->> 'assignmentId' is not null
    group by event.details ->> 'assignmentId'
    having count(distinct event.details ->> 'reviewScope') > 1
  ) as conflict;

  if conflict_count <> 0 then
    raise exception 'assignment_review_scope_audit_conflict'
      using errcode = '21000';
  end if;
end;
$migration$;

with recorded_scope as (
  select distinct on (event.details ->> 'assignmentId')
    event.details ->> 'assignmentId' as assignment_id,
    event.details ->> 'reviewScope' as review_scope
  from public.audit_events as event
  where event.event_type in (
      'assignment.mixed_review_v7_created',
      'assignment.mixed_review_v8_created'
    )
    and event.details ->> 'reviewScope' in ('dataset', 'selection')
    and event.details ->> 'assignmentId' is not null
  order by event.details ->> 'assignmentId', event.id desc
)
update public.assignments as assignment
set review_scope = recorded.review_scope
from recorded_scope as recorded
where assignment.assignment_purpose = 'mixed'
  and assignment.id::text = recorded.assignment_id;

update public.assignments as assignment
set review_scope = 'dataset'
where assignment.assignment_purpose = 'review';

update public.assignments as assignment
set review_scope = 'dataset'
where assignment.assignment_purpose = 'mixed'
  and assignment.review_scope is null
  and exists (
    select 1
    from public.audit_events as event
    where event.event_type in (
        'assignment.mixed_review_selected',
        'assignment.mixed_review_v6_created'
      )
      and event.details ->> 'assignmentId' = assignment.id::text
  );

update public.assignments as assignment
set review_scope = 'dataset'
where assignment.assignment_purpose = 'mixed'
  and assignment.review_scope is null
  and exists (
    select 1
    from public.audit_events as event
    where event.event_type = 'assignment.student.replaced'
      and event.details ->> 'replacementAssignmentId' = assignment.id::text
      and event.details ->> 'reviewSnapshotMode' = 'recalculate'
  );

do $migration$
declare
  updated_count integer;
begin
  loop
    update public.assignments as replacement
    set review_scope = source.review_scope
    from public.audit_events as event
    join public.assignments as source
      on source.id::text = event.details ->> 'sourceAssignmentId'
    where event.event_type = 'assignment.student.replaced'
      and event.details ->> 'reviewSnapshotMode' = 'preserve'
      and replacement.id::text =
        event.details ->> 'replacementAssignmentId'
      and replacement.review_scope is null
      and source.review_scope is not null;

    get diagnostics updated_count = row_count;
    exit when updated_count = 0;
  end loop;

  if exists (
    select 1
    from public.assignments as assignment
    where assignment.assignment_purpose in ('mixed', 'review')
      and assignment.review_scope is null
  ) then
    raise exception 'assignment_review_scope_provenance_missing'
      using errcode = '21000';
  end if;
end;
$migration$;

update public.assignments
set review_scope = 'dataset'
where review_scope is null;

alter table public.assignments
  enable trigger assignments_prevent_deleted_reactivation;
alter table public.assignments
  enable trigger assignments_set_updated_at;

alter table public.assignments
  alter column review_scope set default 'dataset',
  alter column review_scope set not null;

create or replace function private.create_mixed_review_assignment_v9(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_review_scope not in ('dataset', 'selection') then
    raise exception 'invalid_review_scope' using errcode = '22023';
  end if;

  perform private.resolve_contiguous_unit_direction_v1(
    p_dataset_id,
    p_primary_unit_ids
  );
  created_assignment_id := private.create_mixed_review_assignment_v8(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_scope,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );

  update public.assignments
  set review_scope = p_review_scope
  where id = created_assignment_id
    and assignment_purpose in ('mixed', 'review');
  if not found then
    raise exception 'mixed_review_scope_persistence_mismatch'
      using errcode = '21000';
  end if;

  perform private.align_assignment_unit_direction_v1(
    created_assignment_id,
    p_dataset_id,
    p_primary_unit_ids
  );
  return created_assignment_id;
end;
$$;

create or replace function public.create_mixed_review_assignment_v8(
  p_student_id uuid,
  p_dataset_id uuid,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_title text,
  p_primary_unit_ids uuid[],
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_review_scope not in ('dataset', 'selection') then
    raise exception 'invalid_review_scope' using errcode = '22023';
  end if;

  created_assignment_id := private.create_mixed_review_assignment_v8(
    p_student_id,
    p_dataset_id,
    p_review_levels,
    p_review_scope,
    p_selected_queue_ids,
    p_title,
    p_primary_unit_ids,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_questions
  );

  update public.assignments
  set review_scope = p_review_scope
  where id = created_assignment_id
    and assignment_purpose in ('mixed', 'review');
  if not found then
    raise exception 'mixed_review_scope_persistence_mismatch'
      using errcode = '21000';
  end if;
  return created_assignment_id;
end;
$$;

create function private.bind_assignment_replacement_request_sha_v1(
  p_request_sha256 text,
  p_available_from timestamptz,
  p_review_scope text
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'requestSha256', p_request_sha256,
          'availableFrom', p_available_from,
          'reviewScope', p_review_scope
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function private.bind_assignment_replacement_request_sha_v2(
  p_request_sha256 text,
  p_available_from timestamptz,
  p_review_scope text,
  p_retry_enabled boolean,
  p_retry_passing_score smallint
)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'requestSha256', p_request_sha256,
          'availableFrom', p_available_from,
          'reviewScope', p_review_scope,
          'retryEnabled', p_retry_enabled,
          'retryPassingScore', p_retry_passing_score
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
$$;

create function public.get_student_assignment_replacement_result_v2(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_available_from timestamptz,
  p_review_scope text,
  p_retry_enabled boolean,
  p_retry_passing_score smallint
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.assignment_replacement_requests%rowtype;
  bound_request_sha256 text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_review_scope not in ('dataset', 'selection')
    or p_retry_enabled is null
    or p_retry_enabled <> (p_retry_passing_score is not null)
  then
    raise exception 'invalid_assignment_replacement_lookup'
      using errcode = '22023';
  end if;

  bound_request_sha256 :=
    private.bind_assignment_replacement_request_sha_v2(
      p_request_sha256,
      p_available_from,
      p_review_scope,
      p_retry_enabled,
      p_retry_passing_score
    );

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;
  if request_row.source_assignment_id <> p_source_assignment_id
    or request_row.student_id <> p_student_id
    or request_row.request_sha256 not in (
      p_request_sha256,
      bound_request_sha256
    )
    or (
      request_row.client_request_sha256 is not null
      and request_row.client_request_sha256 <> p_request_sha256
    )
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is null then
    return null;
  end if;
  return request_row.result || jsonb_build_object('idempotent', true);
end;
$$;

-- Older application instances still call v1 with the unbound request hash.
-- Accept both the legacy raw hash and the metadata-bound hash written by the
-- v5 compatibility wrapper during the rolling deployment window.
create or replace function public.get_student_assignment_replacement_result_v1(
  p_source_assignment_id uuid,
  p_student_id uuid,
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.assignment_replacement_requests%rowtype;
  source_available_from timestamptz;
  source_review_scope text;
  bound_request_sha256 text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_source_assignment_id is null
    or p_student_id is null
    or p_idempotency_key is null
    or p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_assignment_replacement_lookup'
      using errcode = '22023';
  end if;

  select request.*
  into request_row
  from private.assignment_replacement_requests as request
  where request.idempotency_key = p_idempotency_key;
  if not found then
    return null;
  end if;

  select assignment.available_from, assignment.review_scope
  into source_available_from, source_review_scope
  from public.assignments as assignment
  where assignment.id = p_source_assignment_id;
  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;

  bound_request_sha256 := private.bind_assignment_replacement_request_sha_v1(
    p_request_sha256,
    source_available_from,
    source_review_scope
  );
  if request_row.source_assignment_id <> p_source_assignment_id
    or request_row.student_id <> p_student_id
    or not (
      request_row.client_request_sha256 = p_request_sha256
      or (
        request_row.client_request_sha256 is null
        and request_row.request_sha256 in (
          p_request_sha256,
          bound_request_sha256
        )
      )
    )
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  if request_row.result is null then
    return null;
  end if;
  return request_row.result || jsonb_build_object('idempotent', true);
end;
$$;

create function public.get_assignment_edit_series_context_v1(
  p_assignment_id uuid,
  p_student_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item_count integer;
  context_editable boolean;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select
    count(*)::integer,
    coalesce(
      bool_and(
        item.status = 'assigned'
        and item.attention_reason is null
        and series.status = 'active'
        and series.attention_reason is null
      ),
      true
    )
  into item_count, context_editable
  from private.vocab_assignment_series_items as item
  join private.vocab_assignment_series as series
    on series.id = item.series_id
  where item.assignment_id = p_assignment_id
    and series.student_id = p_student_id
    and item.status not in ('completed', 'cancelled', 'skipped');

  if item_count > 1 then
    raise exception 'vocab_assignment_series_source_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'seriesItem', item_count = 1,
    'editable', context_editable
  );
end;
$$;

alter table private.vocab_assignment_series_events
  drop constraint vocab_assignment_series_events_event_kind_check;

alter table private.vocab_assignment_series_events
  add constraint vocab_assignment_series_events_event_kind_check
  check (
    event_kind in (
      'series.created',
      'session.assigned',
      'session.replaced',
      'session.completed',
      'session.ready',
      'session.attention',
      'session.materialization_failed',
      'session.skipped',
      'series.completed',
      'series.cancelled'
    )
  );

create function public.replace_student_assignment_v6(
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
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_available_from timestamptz,
  p_available_until timestamptz,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_review_levels smallint[],
  p_review_scope text,
  p_selected_queue_ids uuid[],
  p_questions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result_value jsonb;
  replacement_assignment_id uuid;
  source_purpose text;
  source_dataset_id uuid;
  source_question_count integer;
  source_direction smallint;
  source_available_from timestamptz;
  source_available_until timestamptz;
  source_review_scope text;
  source_primary_unit_ids uuid[];
  source_question_plan jsonb;
  requested_question_plan jsonb;
  source_series_item_id uuid;
  source_series_item_status text;
  source_series_status text;
  source_series_attention_reason text;
  source_series_item_count integer;
  replacement_unit_labels text[];
  bound_request_sha256 text;
  rebound_item private.vocab_assignment_series_items%rowtype;
  rebound_at timestamptz := clock_timestamp();
  restored_series_count integer;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_request_sha256 is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_review_scope not in ('dataset', 'selection')
    or p_retry_enabled is null
    or p_retry_enabled <> (p_retry_passing_score is not null)
    or (
      p_available_from is not null
      and p_available_until is not null
      and p_available_until <= p_available_from
    )
  then
    raise exception 'invalid_assignment_replacement_metadata'
      using errcode = '22023';
  end if;

  -- Student deletion takes this lock before attempts, series and items. Keep
  -- the edit path in the same order so concurrent delete/edit cannot invert
  -- the student and series locks.
  perform student.id
  from public.students as student
  where student.id = p_student_id
  for update;
  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;

  select
    assignment.assignment_purpose,
    assignment.dataset_id,
    assignment.question_count,
    assignment.english_to_korean_ratio,
    assignment.available_from,
    assignment.available_until,
    assignment.review_scope
  into
    source_purpose,
    source_dataset_id,
    source_question_count,
    source_direction,
    source_available_from,
    source_available_until,
    source_review_scope
  from public.assignments as assignment
  join public.assignment_students as link
    on link.assignment_id = assignment.id
   and link.student_id = p_student_id
  where assignment.id = p_source_assignment_id;
  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;

  select coalesce(
    array_agg(link.unit_id order by link.position)
      filter (where link.is_primary),
    array[]::uuid[]
  )
  into source_primary_unit_ids
  from public.assignment_units as link
  where link.assignment_id = p_source_assignment_id;

  select coalesce(
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
  )
  into source_question_plan
  from public.assignment_questions as question
  where question.assignment_id = p_source_assignment_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'vocab_entry_id', question.value -> 'vocab_entry_id',
        'base_order_index', question.value -> 'base_order_index',
        'direction', question.value -> 'direction',
        'choice_vocab_entry_ids', question.value -> 'choice_vocab_entry_ids'
      )
      order by (question.value ->> 'base_order_index')::integer
    ),
    '[]'::jsonb
  )
  into requested_question_plan
  from jsonb_array_elements(p_questions) as question(value);

  if p_replacement_kind is distinct from source_purpose
    or p_review_scope is distinct from source_review_scope
    or (
      source_purpose = 'regular'
      and p_review_snapshot_mode <> 'none'
    )
    or (
      source_purpose in ('mixed', 'review')
      and p_review_snapshot_mode <> 'preserve'
    )
    or (
      source_purpose = 'mixed'
      and (
        p_dataset_id is distinct from source_dataset_id
        or p_primary_unit_ids is distinct from source_primary_unit_ids
        or p_question_count is distinct from source_question_count
        or p_english_to_korean_ratio is distinct from source_direction
        or requested_question_plan is distinct from source_question_plan
      )
    )
    or (
      source_purpose = 'review'
      and (
        p_dataset_id is distinct from source_dataset_id
        or p_question_count is distinct from source_question_count
      )
    )
  then
    raise exception 'assignment_edit_field_locked' using errcode = '22023';
  end if;

  select count(*)::integer
  into source_series_item_count
  from private.vocab_assignment_series_items as item
  join private.vocab_assignment_series as series
    on series.id = item.series_id
  where item.assignment_id = p_source_assignment_id
    and series.student_id = p_student_id
    and item.status not in ('completed', 'cancelled', 'skipped');

  if source_series_item_count > 1 then
    raise exception 'vocab_assignment_series_source_mismatch'
      using errcode = '21000';
  end if;
  if source_series_item_count = 1 then
    select
      item.id,
      item.status,
      series.status,
      series.attention_reason
    into
      source_series_item_id,
      source_series_item_status,
      source_series_status,
      source_series_attention_reason
    from private.vocab_assignment_series_items as item
    join private.vocab_assignment_series as series
      on series.id = item.series_id
    where item.assignment_id = p_source_assignment_id
      and series.student_id = p_student_id
      and item.status not in ('completed', 'cancelled', 'skipped')
    for update of item, series;

    if source_series_item_status <> 'assigned'
      or source_series_status <> 'active'
      or source_series_attention_reason is not null
    then
      raise exception 'vocab_assignment_series_edit_unavailable'
        using errcode = '55000';
    end if;
    if p_available_from is null or p_available_until is null then
      raise exception 'vocab_assignment_series_schedule_required'
        using errcode = '22023';
    end if;
    if p_dataset_id is distinct from source_dataset_id then
      raise exception 'assignment_edit_field_locked' using errcode = '22023';
    end if;

    select coalesce(
      array_agg(unit.unit_label order by selected.position),
      array[]::text[]
    )
    into replacement_unit_labels
    from unnest(p_primary_unit_ids) with ordinality
      as selected(unit_id, position)
    join public.vocab_units as unit
      on unit.id = selected.unit_id
     and unit.dataset_id = p_dataset_id;
    if cardinality(replacement_unit_labels) <> cardinality(p_primary_unit_ids)
    then
      raise exception 'assignment_unit_not_found' using errcode = 'P0002';
    end if;
  end if;

  bound_request_sha256 :=
    private.bind_assignment_replacement_request_sha_v2(
      p_request_sha256,
      p_available_from,
      p_review_scope,
      p_retry_enabled,
      p_retry_passing_score
    );

  result_value := private.replace_student_assignment_v4(
    p_source_assignment_id,
    p_student_id,
    p_idempotency_key,
    bound_request_sha256,
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

  update private.assignment_replacement_requests
  set client_request_sha256 = p_request_sha256
  where idempotency_key = p_idempotency_key
    and (
      client_request_sha256 is null
      or client_request_sha256 = p_request_sha256
    );
  if not found then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;

  replacement_assignment_id :=
    (result_value ->> 'replacementAssignmentId')::uuid;

  update public.assignments
  set
    available_from = p_available_from,
    review_scope = p_review_scope
  where id = replacement_assignment_id;
  if not found then
    raise exception 'assignment_replacement_metadata_mismatch'
      using errcode = '21000';
  end if;

  perform private.configure_assignment_retry_v1(
    replacement_assignment_id,
    p_retry_enabled,
    p_retry_passing_score
  );

  update private.vocab_assignment_series_items as item
  set
    assignment_id = replacement_assignment_id,
    status = 'assigned',
    attention_reason = null,
    question_count = p_question_count,
    unit_ids = p_primary_unit_ids,
    unit_labels = replacement_unit_labels,
    effective_available_from = p_available_from,
    effective_available_until = p_available_until,
    payload = item.payload || jsonb_build_object(
      'title', p_title,
      'dataset_id', p_dataset_id,
      'question_count', p_question_count,
      'unit_ids', to_jsonb(p_primary_unit_ids),
      'unit_labels', to_jsonb(replacement_unit_labels),
      'english_to_korean_ratio', p_english_to_korean_ratio,
      'time_limit_seconds', p_time_limit_seconds,
      'passing_score', p_passing_score,
      'retry_enabled', p_retry_enabled,
      'retry_passing_score', p_retry_passing_score,
      'question_order_mode', p_question_order_mode,
      'available_from', p_available_from,
      'available_until', p_available_until,
      'timing_mode', p_timing_mode,
      'question_time_limit_seconds', p_question_time_limit_seconds,
      'review_levels', to_jsonb(p_review_levels),
      'review_scope', p_review_scope,
      'selected_queue_ids', to_jsonb(p_selected_queue_ids),
      'questions', p_questions
    ),
    updated_at = rebound_at
  from private.vocab_assignment_series as series
  where item.series_id = series.id
    and source_series_item_count = 1
    and item.id = source_series_item_id
    and item.assignment_id = p_source_assignment_id
    and item.status = 'attention'
    and item.attention_reason = 'assignment_cancelled'
    and series.student_id = p_student_id
    and series.status = 'attention'
    and series.attention_reason = 'assignment_cancelled'
  returning item.* into rebound_item;

  if source_series_item_count = 1 and rebound_item.id is null then
    raise exception 'vocab_assignment_series_rebind_mismatch'
      using errcode = '21000';
  end if;

  if rebound_item.id is not null then
    update private.vocab_assignment_series
    set
      status = 'active',
      attention_reason = null,
      updated_at = rebound_at
    where id = rebound_item.series_id
      and status = 'attention'
      and attention_reason = 'assignment_cancelled';
    get diagnostics restored_series_count = row_count;
    if restored_series_count <> 1 then
      raise exception 'vocab_assignment_series_rebind_mismatch'
        using errcode = '21000';
    end if;

    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details,
      occurred_at
    ) values (
      rebound_item.series_id,
      rebound_item.id,
      replacement_assignment_id,
      'session.replaced',
      jsonb_build_object(
        'sequenceNumber', rebound_item.sequence_number,
        'sourceAssignmentId', p_source_assignment_id,
        'replacementAssignmentId', replacement_assignment_id,
        'reason', 'assignment_edit'
      ),
      rebound_at
    );
  end if;

  if not coalesce((result_value ->> 'idempotent')::boolean, false) then
    insert into public.audit_events (
      event_type,
      actor_admin_id,
      student_id,
      details
    ) values (
      'assignment.student.replacement_metadata_v1',
      (select auth.uid()),
      p_student_id,
      jsonb_build_object(
        'sourceAssignmentId', p_source_assignment_id,
        'replacementAssignmentId', replacement_assignment_id,
        'before', jsonb_build_object(
          'availableFrom', source_available_from,
          'availableUntil', source_available_until,
          'reviewScope', source_review_scope
        ),
        'after', jsonb_build_object(
          'availableFrom', p_available_from,
          'availableUntil', p_available_until,
          'reviewScope', p_review_scope
        )
      )
    );
  end if;

  return result_value;
end;
$$;

-- Keep the immediately previous public writer callable during the rolling
-- application deploy, but route it through v6 so metadata and series
-- continuity cannot be bypassed by an older server instance.
create or replace function public.replace_student_assignment_v5(
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
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
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
  source_available_from timestamptz;
  source_review_scope text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select assignment.available_from, assignment.review_scope
  into source_available_from, source_review_scope
  from public.assignments as assignment
  where assignment.id = p_source_assignment_id;
  if not found then
    raise exception 'assignment_student_not_found' using errcode = 'P0002';
  end if;

  return public.replace_student_assignment_v6(
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
    p_retry_enabled,
    p_retry_passing_score,
    p_question_order_mode,
    source_available_from,
    p_available_until,
    p_timing_mode,
    p_question_time_limit_seconds,
    p_review_levels,
    source_review_scope,
    p_selected_queue_ids,
    p_questions
  );
end;
$$;

revoke all on function private.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v8(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function private.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.replace_student_assignment_v3(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.replace_student_assignment_v5(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, text, integer, smallint[],
  uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v5(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, text, integer, smallint[],
  uuid[], jsonb
) to authenticated, service_role;

revoke all on function private.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

revoke all on function private.bind_assignment_replacement_request_sha_v1(
  text, timestamptz, text
) from public, anon, authenticated, service_role;
revoke all on function private.bind_assignment_replacement_request_sha_v2(
  text, timestamptz, text, boolean, smallint
) from public, anon, authenticated, service_role;
revoke all on function public.get_student_assignment_replacement_result_v2(
  uuid, uuid, uuid, text, timestamptz, text, boolean, smallint
) from public, anon, authenticated, service_role;
grant execute on function public.get_student_assignment_replacement_result_v2(
  uuid, uuid, uuid, text, timestamptz, text, boolean, smallint
) to authenticated, service_role;
revoke all on function public.get_assignment_edit_series_context_v1(
  uuid, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.get_assignment_edit_series_context_v1(
  uuid, uuid
) to authenticated, service_role;
revoke all on function public.replace_student_assignment_v6(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.replace_student_assignment_v6(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, boolean, smallint,
  public.question_order_mode, timestamptz, timestamptz, text, integer,
  smallint[], text, uuid[], jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
