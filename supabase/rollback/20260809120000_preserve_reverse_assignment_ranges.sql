begin;

drop function if exists public.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
);
drop function if exists private.replace_student_assignment_v4(
  uuid, uuid, uuid, text, text, text, text, uuid, uuid[], integer,
  smallint, integer, smallint, public.question_order_mode, timestamptz,
  text, integer, smallint[], uuid[], jsonb
);
drop function if exists public.create_bulk_vocab_assignments_v4(jsonb);
drop function if exists private.create_bulk_vocab_assignments_v4(jsonb);
drop function if exists public.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
);
drop function if exists private.create_mixed_review_assignment_v9(
  uuid, uuid, smallint[], text, uuid[], text, uuid[], smallint, integer,
  smallint, public.question_order_mode, timestamptz, text, integer, jsonb
);
drop function if exists private.align_assignment_unit_direction_v1(
  uuid, uuid, uuid[]
);
drop function if exists private.resolve_contiguous_unit_direction_v1(
  uuid, uuid[]
);

notify pgrst, 'reload schema';

commit;
