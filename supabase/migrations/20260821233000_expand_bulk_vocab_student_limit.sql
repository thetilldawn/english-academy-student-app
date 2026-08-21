begin;

-- The application validates the combined student x session count at 210. Keep
-- the atomic v8 writer aligned so a one-session school assignment can include
-- more than the legacy 30-student limit without splitting the transaction.
do $migration$
declare
  function_definition text;
  old_limit text := '  ) not between 1 and 30 then';
  new_limit text := '  ) not between 1 and 210 then';
begin
  select replace(
    pg_get_functiondef(
      'private.create_bulk_vocab_assignments_v7(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(old_limit in function_definition) = 0 then
    raise exception 'bulk_vocab_student_limit_v7_shape_changed';
  end if;

  function_definition := replace(function_definition, old_limit, new_limit);

  if position(old_limit in function_definition) > 0 then
    raise exception 'bulk_vocab_student_limit_v7_rewrite_failed';
  end if;

  execute function_definition;
end;
$migration$;

commit;
