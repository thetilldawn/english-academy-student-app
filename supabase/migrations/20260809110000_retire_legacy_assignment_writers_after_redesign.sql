-- Apply only after the redesign application deployment is READY.
-- Keeping the legacy writers callable through the code rollout avoids an
-- interval where the previous production application cannot create exams.
revoke all on function private.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_assignment_with_delivery_v5(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) from public, anon, authenticated, service_role;

revoke all on function private.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v5(
  uuid, uuid, smallint[], integer, uuid[], text, uuid[], smallint,
  integer, smallint, public.question_order_mode, timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_mixed_review_assignment_v7(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) from public, anon, authenticated, service_role;

revoke all on function private.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint, public.question_order_mode,
  timestamptz, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_exact_review_assignment_v4(
  uuid, text, smallint, integer, smallint, public.question_order_mode,
  timestamptz, jsonb
) from public, anon, authenticated, service_role;

revoke all on function private.create_bulk_vocab_assignments_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v2(jsonb)
  from public, anon, authenticated, service_role;

revoke all on function private.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text, integer,
  smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.replace_student_assignment_v1(
  uuid, uuid, uuid, text, text, text, uuid, uuid[], integer, smallint,
  integer, smallint, public.question_order_mode, timestamptz, text, integer,
  smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.replace_student_assignment_v2(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
) from public, anon, authenticated, service_role;

notify pgrst, 'reload schema';
