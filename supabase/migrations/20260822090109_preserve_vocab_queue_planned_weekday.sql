-- Completion-gated sessions preserve the weekday, local time, and duration that
-- belong to their planned range chunk. Existing queue rows are not rewritten;
-- this only normalizes a ready item's next effective window when it advances.

create function private.preserve_vocab_assignment_queue_planned_window_v1()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_isodow integer;
  candidate_isodow integer;
  days_ahead integer;
  candidate_date date;
  candidate_from timestamptz;
  planned_duration interval;
begin
  if new.status <> 'ready' then
    return new;
  end if;

  target_isodow := extract(
    isodow from new.planned_available_from at time zone 'Asia/Seoul'
  )::integer;
  candidate_date := (
    new.effective_available_from at time zone 'Asia/Seoul'
  )::date;
  candidate_isodow := extract(isodow from candidate_date)::integer;
  days_ahead := (target_isodow - candidate_isodow + 7) % 7;
  candidate_from := (
    candidate_date + days_ahead +
    (new.planned_available_from at time zone 'Asia/Seoul')::time
  ) at time zone 'Asia/Seoul';

  if candidate_from < new.effective_available_from then
    candidate_from := candidate_from + interval '7 days';
  end if;

  planned_duration :=
    new.planned_available_until - new.planned_available_from;
  new.effective_available_from := candidate_from;
  new.effective_available_until := candidate_from + planned_duration;
  return new;
end;
$$;

create trigger vocab_assignment_queue_preserve_planned_window
before update of status, effective_available_from, effective_available_until
on private.vocab_assignment_series_items
for each row
when (
  new.status = 'ready'
  and (
    old.status is distinct from new.status
    or old.effective_available_from is distinct from
      new.effective_available_from
    or old.effective_available_until is distinct from
      new.effective_available_until
  )
)
execute function private.preserve_vocab_assignment_queue_planned_window_v1();

revoke all on function
  private.preserve_vocab_assignment_queue_planned_window_v1()
from public, anon, authenticated, service_role;
