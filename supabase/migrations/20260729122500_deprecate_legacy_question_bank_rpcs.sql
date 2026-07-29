-- The application now creates assignments through the provenance-verified v2
-- wrapper. Keep the legacy implementation for verified_v2's internal
-- SECURITY DEFINER call, but prevent clients from calling either legacy entry
-- point directly.

revoke execute on function private.create_assignment_with_question_bank(
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
) from authenticated;

revoke execute on function public.create_assignment_with_question_bank(
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
) from authenticated;

notify pgrst, 'reload schema';
