begin;

create table if not exists private.app_migration_snapshots (
  snapshot_id text not null,
  table_name text not null,
  captured_at timestamptz not null default clock_timestamp(),
  rows jsonb not null check (jsonb_typeof(rows) = 'array'),
  row_count integer not null check (row_count >= 0),
  primary key (snapshot_id, table_name)
);

comment on table private.app_migration_snapshots is
  'Short-lived, service-role-only data snapshots for reversible app migrations.';

insert into private.app_migration_snapshots (
  snapshot_id,
  table_name,
  rows,
  row_count
)
select
  'wrong_assignment_lifecycle_20260730',
  'assignments',
  coalesce(
    jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id),
    '[]'::jsonb
  ),
  count(*)::integer
from public.assignments as snapshot_row
on conflict (snapshot_id, table_name) do nothing;

insert into private.app_migration_snapshots (
  snapshot_id,
  table_name,
  rows,
  row_count
)
select
  'wrong_assignment_lifecycle_20260730',
  'assignment_students',
  coalesce(
    jsonb_agg(
      to_jsonb(snapshot_row)
      order by snapshot_row.assignment_id, snapshot_row.student_id
    ),
    '[]'::jsonb
  ),
  count(*)::integer
from public.assignment_students as snapshot_row
on conflict (snapshot_id, table_name) do nothing;

insert into private.app_migration_snapshots (
  snapshot_id,
  table_name,
  rows,
  row_count
)
select
  'wrong_assignment_lifecycle_20260730',
  'student_vocab_review_queue',
  coalesce(
    jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id),
    '[]'::jsonb
  ),
  count(*)::integer
from public.student_vocab_review_queue as snapshot_row
on conflict (snapshot_id, table_name) do nothing;

insert into private.app_migration_snapshots (
  snapshot_id,
  table_name,
  rows,
  row_count
)
select
  'wrong_assignment_lifecycle_20260730',
  'student_vocab_review_assignment_drafts',
  coalesce(
    jsonb_agg(to_jsonb(snapshot_row) order by snapshot_row.id),
    '[]'::jsonb
  ),
  count(*)::integer
from public.student_vocab_review_assignment_drafts as snapshot_row
on conflict (snapshot_id, table_name) do nothing;

revoke all on table private.app_migration_snapshots
  from public, anon, authenticated;
grant select on table private.app_migration_snapshots to service_role;

commit;
