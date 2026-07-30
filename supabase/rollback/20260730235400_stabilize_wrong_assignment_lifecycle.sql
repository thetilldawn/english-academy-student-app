-- Emergency compatibility rollback for the deployment window only.
--
-- Preconditions:
-- 1. Run only when no assignment, attempt, answer, wrong-state, queue, draft,
--    review-target, or audit activity occurred after the cutover marker.
-- 2. Redeploy the previous application immediately after this transaction.
-- 3. If a precondition fails, stop and perform a reviewed data migration
--    instead of forcing this script.

begin;

do $$
declare
  cutover_time timestamptz;
  snapshot_table_count integer;
begin
  select snapshot.captured_at
  into cutover_time
  from private.app_migration_snapshots as snapshot
  where snapshot.snapshot_id =
    'wrong_assignment_lifecycle_20260730'
    and snapshot.table_name = 'cutover';

  if cutover_time is null then
    raise exception 'wrong_assignment_lifecycle_cutover_missing';
  end if;

  select count(*)::integer
  into snapshot_table_count
  from private.app_migration_snapshots as snapshot
  where snapshot.snapshot_id =
    'wrong_assignment_lifecycle_20260730'
    and snapshot.table_name in (
      'assignments',
      'assignment_students',
      'student_vocab_review_queue',
      'student_vocab_review_assignment_drafts'
    );

  if snapshot_table_count <> 4 then
    raise exception 'wrong_assignment_lifecycle_snapshot_incomplete';
  end if;

  if exists (
    select 1
    from public.assignments as assignment
    where assignment.created_at > cutover_time
      or assignment.updated_at > cutover_time
  ) or exists (
    select 1
    from public.assignment_students as recipient
    where recipient.assigned_at > cutover_time
      or recipient.missed_at > cutover_time
      or recipient.cancelled_at > cutover_time
  ) or exists (
    select 1
    from public.quiz_attempts as attempt
    where attempt.started_at > cutover_time
      or attempt.initial_completed_at > cutover_time
      or attempt.retry_started_at > cutover_time
      or attempt.current_question_started_at > cutover_time
      or attempt.completed_at > cutover_time
  ) or exists (
    select 1
    from public.quiz_questions as question
    where question.initial_answered_at > cutover_time
      or question.retry_answered_at > cutover_time
  ) or exists (
    select 1
    from public.student_vocab_state as state
    where state.last_evaluated_at > cutover_time
      or state.updated_at > cutover_time
  ) or exists (
    select 1
    from public.student_vocab_wrong_events as wrong_event
    where wrong_event.wrong_at > cutover_time
      or wrong_event.created_at > cutover_time
  ) or exists (
    select 1
    from public.student_vocab_review_queue as queue
    where queue.queued_at > cutover_time
      or queue.updated_at > cutover_time
      or queue.consumed_at > cutover_time
      or queue.cancelled_at > cutover_time
      or queue.reserved_at > cutover_time
  ) or exists (
    select 1
    from public.student_vocab_review_assignment_drafts as draft
    where draft.created_at > cutover_time
      or draft.updated_at > cutover_time
      or draft.consumed_at > cutover_time
      or draft.cancelled_at > cutover_time
      or draft.expired_at > cutover_time
  ) or exists (
    select 1
    from public.assignment_review_targets as target
    where target.assigned_at > cutover_time
      or target.released_at > cutover_time
  ) or exists (
    select 1
    from public.audit_events as audit
    where audit.created_at > cutover_time
  ) or exists (
    select 1
    from private.app_migration_snapshots as snapshot
    cross join lateral jsonb_to_recordset(snapshot.rows)
      as original(id uuid)
    where snapshot.snapshot_id =
      'wrong_assignment_lifecycle_20260730'
      and snapshot.table_name = 'assignments'
      and not exists (
        select 1
        from public.assignments as current_row
        where current_row.id = original.id
      )
  ) or exists (
    select 1
    from private.app_migration_snapshots as snapshot
    cross join lateral jsonb_to_recordset(snapshot.rows)
      as original(assignment_id uuid, student_id uuid)
    where snapshot.snapshot_id =
      'wrong_assignment_lifecycle_20260730'
      and snapshot.table_name = 'assignment_students'
      and not exists (
        select 1
        from public.assignment_students as current_row
        where current_row.assignment_id = original.assignment_id
          and current_row.student_id = original.student_id
      )
  ) or exists (
    select 1
    from private.app_migration_snapshots as snapshot
    cross join lateral jsonb_to_recordset(snapshot.rows)
      as original(id uuid)
    where snapshot.snapshot_id =
      'wrong_assignment_lifecycle_20260730'
      and snapshot.table_name = 'student_vocab_review_queue'
      and not exists (
        select 1
        from public.student_vocab_review_queue as current_row
        where current_row.id = original.id
      )
  ) or exists (
    select 1
    from private.app_migration_snapshots as snapshot
    cross join lateral jsonb_to_recordset(snapshot.rows)
      as original(id uuid)
    where snapshot.snapshot_id =
      'wrong_assignment_lifecycle_20260730'
      and snapshot.table_name =
        'student_vocab_review_assignment_drafts'
      and not exists (
        select 1
        from public.student_vocab_review_assignment_drafts as current_row
        where current_row.id = original.id
      )
  ) then
    raise exception
      'wrong_assignment_lifecycle_has_post_cutover_activity';
  end if;
end;
$$;

with snapshot as (
  select original.*
  from private.app_migration_snapshots as stored
  cross join lateral jsonb_to_recordset(stored.rows) as original(
    id uuid,
    reason_level smallint,
    status text,
    updated_at timestamptz,
    consumed_assignment_id uuid,
    consumed_at timestamptz,
    cancelled_at timestamptz,
    reserved_review_draft_id uuid,
    reserved_at timestamptz
  )
  where stored.snapshot_id =
    'wrong_assignment_lifecycle_20260730'
    and stored.table_name = 'student_vocab_review_queue'
)
update public.student_vocab_review_queue as queue
set
  reason_level = snapshot.reason_level,
  status = snapshot.status,
  updated_at = snapshot.updated_at,
  consumed_assignment_id = snapshot.consumed_assignment_id,
  consumed_at = snapshot.consumed_at,
  cancelled_at = snapshot.cancelled_at,
  reserved_review_draft_id =
    snapshot.reserved_review_draft_id,
  reserved_at = snapshot.reserved_at
from snapshot
where queue.id = snapshot.id;

with snapshot as (
  select original.*
  from private.app_migration_snapshots as stored
  cross join lateral jsonb_to_recordset(stored.rows) as original(
    id uuid,
    status text,
    cancelled_at timestamptz
  )
  where stored.snapshot_id =
    'wrong_assignment_lifecycle_20260730'
    and stored.table_name =
      'student_vocab_review_assignment_drafts'
)
update public.student_vocab_review_assignment_drafts as draft
set
  status = snapshot.status,
  cancelled_at = snapshot.cancelled_at
from snapshot
where draft.id = snapshot.id;

drop trigger if exists
  assignment_review_targets_reject_duplicate_active
  on public.assignment_review_targets;
drop trigger if exists
  student_vocab_review_queue_reject_active_consumption
  on public.student_vocab_review_queue;

revoke all on function public.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz,
  text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz,
  text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.cancel_student_assignment_v1(
  uuid, uuid, text
) from public, anon, authenticated, service_role;
revoke all on function private.cancel_student_assignment_v1(
  uuid, uuid, text
) from public, anon, authenticated, service_role;

grant execute on function private.create_assignment_with_question_bank_v3(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) to authenticated, service_role;
grant execute on function public.create_assignment_with_question_bank_v3(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], jsonb
) to authenticated, service_role;
grant execute on function
  private.create_student_vocab_review_assignment_draft(uuid, uuid[])
  to authenticated, service_role;
grant execute on function
  public.create_student_vocab_review_assignment_draft(uuid, uuid[])
  to authenticated, service_role;
grant execute on function private.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) to authenticated, service_role;
grant execute on function public.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint,
  public.question_order_mode, timestamptz, jsonb
) to authenticated, service_role;
grant execute on function private.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) to authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
