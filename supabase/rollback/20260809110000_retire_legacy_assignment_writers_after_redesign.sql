begin;

-- Deployment-window rollback only. Restore exactly the legacy writers that
-- remain executable immediately before the post-deploy retirement migration.
-- Do not reopen older versions already retired by earlier migrations.
grant execute on function private.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;
grant execute on function public.create_assignment_with_delivery_v4(
  text, uuid, uuid[], integer, smallint, integer, smallint,
  public.question_order_mode, timestamptz, uuid[], text, integer, jsonb
) to authenticated, service_role;

grant execute on function private.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;
grant execute on function public.create_mixed_review_assignment_v6(
  uuid, uuid, smallint[], uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
) to authenticated, service_role;

grant execute on function private.create_bulk_vocab_assignments_v1(jsonb)
  to authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v1(jsonb)
  to authenticated, service_role;

notify pgrst, 'reload schema';

commit;
