begin;

-- Keep curriculum progress separate from exact review assignments.
alter table public.assignments
  add column assignment_purpose text not null default 'regular';

alter table public.assignments
  add constraint assignments_assignment_purpose_check
  check (assignment_purpose in ('regular', 'review', 'mixed'))
  not valid;

alter table public.assignments
  validate constraint assignments_assignment_purpose_check;

create index assignments_purpose_created_idx
  on public.assignments (assignment_purpose, created_at desc);

-- A mixed assignment may carry old review words through a wider contiguous
-- support scope. Only primary units are allowed to advance curriculum progress.
alter table public.assignment_units
  add column is_primary boolean not null default true;

create index assignment_units_primary_position_idx
  on public.assignment_units (assignment_id, position)
  where is_primary;

-- A server-side draft gives the UI a short, durable handoff ID instead of
-- exposing hundreds of queue IDs in the URL or relying on one browser tab.
create table public.student_vocab_review_assignment_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  student_id uuid not null
    references public.students(id) on delete restrict,
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  status text not null default 'pending'
    check (status in ('pending', 'consumed', 'cancelled', 'expired')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  consumed_assignment_id uuid
    references public.assignments(id) on delete restrict,
  consumed_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  constraint student_vocab_review_assignment_drafts_expiry_check
    check (expires_at > created_at),
  constraint student_vocab_review_assignment_drafts_state_check check (
    (
      status = 'pending'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is null
      and expired_at is null
    )
    or (
      status = 'consumed'
      and consumed_assignment_id is not null
      and consumed_at is not null
      and cancelled_at is null
      and expired_at is null
    )
    or (
      status = 'cancelled'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is not null
      and expired_at is null
    )
    or (
      status = 'expired'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is null
      and expired_at is not null
    )
  )
);

create index student_vocab_review_drafts_student_status_time_idx
  on public.student_vocab_review_assignment_drafts (
    student_id,
    status,
    created_at desc
  );
create index student_vocab_review_drafts_dataset_status_idx
  on public.student_vocab_review_assignment_drafts (
    dataset_id,
    status
  );
create index student_vocab_review_drafts_pending_expiry_idx
  on public.student_vocab_review_assignment_drafts (expires_at, id)
  where status = 'pending';
create index student_vocab_review_drafts_created_by_idx
  on public.student_vocab_review_assignment_drafts (created_by);
create index student_vocab_review_drafts_consumed_assignment_idx
  on public.student_vocab_review_assignment_drafts (
    consumed_assignment_id
  )
  where consumed_assignment_id is not null;

create trigger student_vocab_review_assignment_drafts_set_updated_at
before update on public.student_vocab_review_assignment_drafts
for each row execute function private.set_updated_at();

-- A pending queue word can be reserved by at most one durable draft.
alter table public.student_vocab_review_queue
  add column reserved_review_draft_id uuid
    references public.student_vocab_review_assignment_drafts(id)
    on delete restrict,
  add column reserved_at timestamptz;

alter table public.student_vocab_review_queue
  drop constraint student_vocab_review_queue_state_check;

alter table public.student_vocab_review_queue
  add constraint student_vocab_review_queue_state_check check (
    (
      status = 'pending'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is null
      and (
        (
          reserved_review_draft_id is null
          and reserved_at is null
        )
        or (
          reserved_review_draft_id is not null
          and reserved_at is not null
        )
      )
    )
    or (
      status = 'consumed'
      and consumed_assignment_id is not null
      and consumed_at is not null
      and cancelled_at is null
      and reserved_review_draft_id is null
      and reserved_at is null
    )
    or (
      status = 'cancelled'
      and consumed_assignment_id is null
      and consumed_at is null
      and cancelled_at is not null
      and reserved_review_draft_id is null
      and reserved_at is null
    )
  )
  not valid;

alter table public.student_vocab_review_queue
  validate constraint student_vocab_review_queue_state_check;

create index student_vocab_review_queue_reserved_draft_idx
  on public.student_vocab_review_queue (reserved_review_draft_id)
  where reserved_review_draft_id is not null;

create table public.student_vocab_review_assignment_draft_items (
  draft_id uuid not null
    references public.student_vocab_review_assignment_drafts(id)
    on delete restrict,
  queue_id uuid not null
    references public.student_vocab_review_queue(id)
    on delete restrict,
  position integer not null check (position between 1 and 400),
  created_at timestamptz not null default now(),
  primary key (draft_id, queue_id),
  unique (draft_id, position)
);

create index student_vocab_review_draft_items_queue_idx
  on public.student_vocab_review_assignment_draft_items (queue_id);

create function private.enforce_review_assignment_draft_item()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (
    select 1
    from public.student_vocab_review_assignment_drafts as draft
    join public.student_vocab_review_queue as queue
      on queue.id = new.queue_id
    where draft.id = new.draft_id
      and draft.status = 'pending'
      and queue.status = 'pending'
      and queue.reserved_review_draft_id = draft.id
      and queue.student_id = draft.student_id
      and queue.dataset_id = draft.dataset_id
  ) then
    raise exception 'review_draft_item_reservation_mismatch'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger student_vocab_review_draft_item_consistency
before insert or update
on public.student_vocab_review_assignment_draft_items
for each row execute function
  private.enforce_review_assignment_draft_item();

create function private.prevent_assignment_unit_reparenting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.assignment_id is distinct from old.assignment_id
    or new.dataset_id is distinct from old.dataset_id
  then
    raise exception 'assignment_unit_reparenting_forbidden'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger assignment_units_prevent_reparenting
before update of assignment_id, dataset_id
on public.assignment_units
for each row execute function
  private.prevent_assignment_unit_reparenting();

-- The final transaction state must agree with the purpose metadata. A
-- deferred constraint lets v4 create a regular base assignment first and then
-- atomically relabel its support units before commit.
create function private.enforce_assignment_unit_purpose_consistency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_assignment_id uuid;
  purpose text;
  unit_count integer;
  primary_unit_count integer;
begin
  if tg_table_name = 'assignments' then
    if tg_op = 'DELETE' then
      target_assignment_id := old.id;
    else
      target_assignment_id := new.id;
    end if;
  else
    if tg_op = 'DELETE' then
      target_assignment_id := old.assignment_id;
    else
      target_assignment_id := new.assignment_id;
    end if;
  end if;

  select assignment.assignment_purpose
  into purpose
  from public.assignments as assignment
  where assignment.id = target_assignment_id;

  if not found then
    return null;
  end if;

  select
    count(*),
    count(*) filter (where unit.is_primary)
  into
    unit_count,
    primary_unit_count
  from public.assignment_units as unit
  where unit.assignment_id = target_assignment_id;

  if unit_count = 0
    or (
      purpose = 'regular'
      and primary_unit_count <> unit_count
    )
    or (
      purpose = 'review'
      and primary_unit_count <> 0
    )
    or (
      purpose = 'mixed'
      and primary_unit_count = 0
    )
  then
    raise exception 'assignment_unit_purpose_mismatch'
      using errcode = '23514';
  end if;

  return null;
end;
$$;

create constraint trigger assignments_unit_purpose_consistency
after insert or update of assignment_purpose
on public.assignments
deferrable initially deferred
for each row execute function
  private.enforce_assignment_unit_purpose_consistency();

create constraint trigger assignment_units_purpose_consistency
after insert or update or delete
on public.assignment_units
deferrable initially deferred
for each row execute function
  private.enforce_assignment_unit_purpose_consistency();

alter table public.student_vocab_review_assignment_drafts
  enable row level security;
alter table public.student_vocab_review_assignment_draft_items
  enable row level security;

create policy "active admins read vocabulary review assignment drafts"
on public.student_vocab_review_assignment_drafts
for select
to authenticated
using ((select private.is_active_admin()));

create policy "active admins read vocabulary review assignment draft items"
on public.student_vocab_review_assignment_draft_items
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.student_vocab_review_assignment_drafts
  from public, anon, authenticated;
revoke all on table public.student_vocab_review_assignment_draft_items
  from public, anon, authenticated;

grant select on table public.student_vocab_review_assignment_drafts
  to authenticated;
grant select on table public.student_vocab_review_assignment_draft_items
  to authenticated;

grant all on table public.student_vocab_review_assignment_drafts
  to service_role;
grant all on table public.student_vocab_review_assignment_draft_items
  to service_role;

revoke all on function private.enforce_review_assignment_draft_item()
  from public, anon, authenticated;
revoke all on function private.enforce_assignment_unit_purpose_consistency()
  from public, anon, authenticated;
revoke all on function private.prevent_assignment_unit_reparenting()
  from public, anon, authenticated;
grant execute on function private.enforce_review_assignment_draft_item()
  to service_role;
grant execute on function private.enforce_assignment_unit_purpose_consistency()
  to service_role;
grant execute on function private.prevent_assignment_unit_reparenting()
  to service_role;

notify pgrst, 'reload schema';

commit;
