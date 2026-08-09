begin;

do $rollback$
declare
  function_definition text;
  availability_guard text := E'      and (assignment.available_from is null\n        or assignment.available_from <= clock_timestamp())\n';
begin
  select replace(
    pg_get_functiondef(
      'public.claim_student_notifications_v1(uuid)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;
  if position(availability_guard in function_definition) = 0 then
    raise exception 'student_notification_claim_guard_missing';
  end if;
  function_definition := replace(function_definition, availability_guard, '');
  execute function_definition;
end;
$rollback$;

drop function if exists public.create_bulk_vocab_assignments_v5(uuid, text, jsonb);
drop function if exists private.create_bulk_vocab_assignments_v5(uuid, text, jsonb);
drop function if exists public.get_bulk_vocab_series_result_v1(uuid, text);
drop function if exists private.get_bulk_vocab_series_result_v1(uuid, text);
drop function if exists private.create_assignment_with_delivery_v7(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
);
drop table if exists private.bulk_vocab_series_requests;

commit;
