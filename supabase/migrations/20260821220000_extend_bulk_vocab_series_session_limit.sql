begin;

-- Preserve the proven v5 atomic/idempotent write path and widen only the
-- per-student series limit. The total batch limit remains 210 assignments.
do $migration$
declare
  function_definition text;
  session_number_old text :=
    '(item ->> ''session_number'')::integer not between 1 and 7';
  session_count_old text :=
    '(item ->> ''session_count'')::integer not between 1 and 7';
begin
  select replace(
    pg_get_functiondef(
      'private.create_bulk_vocab_assignments_v5(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(
      'jsonb_array_length(p_batches) not between 1 and 210'
      in function_definition
    ) = 0
    or position(session_number_old in function_definition) = 0
    or position(session_count_old in function_definition) = 0
    or position(
      'duplicate_bulk_assignment_series_session'
      in function_definition
    ) = 0
    or position(
      'incomplete_bulk_assignment_series'
      in function_definition
    ) = 0
    or position(
      'non_increasing_bulk_assignment_series_schedule'
      in function_definition
    ) = 0
    or position(
      'private.create_assignment_with_delivery_v7('
      in function_definition
    ) = 0
    or position(
      'private.create_mixed_review_assignment_v9('
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v5_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_bulk_vocab_assignments_v5(',
    'private.create_bulk_vocab_assignments_v7('
  );
  function_definition := replace(
    function_definition,
    session_number_old,
    '(item ->> ''session_number'')::integer not between 1 and 210'
  );
  function_definition := replace(
    function_definition,
    session_count_old,
    '(item ->> ''session_count'')::integer not between 1 and 210'
  );
  function_definition := replace(
    function_definition,
    'assignment.bulk_vocab_series_v5_created',
    'assignment.bulk_vocab_series_v7_created'
  );

  if position(
      'private.create_bulk_vocab_assignments_v5('
      in function_definition
    ) > 0
    or position(session_number_old in function_definition) > 0
    or position(session_count_old in function_definition) > 0
    or position(
      '(item ->> ''session_number'')::integer not between 1 and 210'
      in function_definition
    ) = 0
    or position(
      '(item ->> ''session_count'')::integer not between 1 and 210'
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v7_rewrite_failed';
  end if;

  execute function_definition;
end;
$migration$;

-- Preserve v6 student locking and same-day conflict checks, then delegate to
-- the widened atomic writer above.
do $migration$
declare
  function_definition text;
begin
  select replace(
    pg_get_functiondef(
      'private.create_bulk_vocab_assignments_v6(uuid,text,jsonb)'::regprocedure
    ),
    chr(13),
    ''
  )
  into function_definition;

  if position(
      'jsonb_array_length(p_batches) not between 1 and 210'
      in function_definition
    ) = 0
    or position('order by student.id' in function_definition) = 0
    or position('for update' in function_definition) = 0
    or position(
      'bulk_assignment_schedule_conflict'
      in function_definition
    ) = 0
    or position(
      'return private.create_bulk_vocab_assignments_v5('
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v6_shape_changed';
  end if;

  function_definition := replace(
    function_definition,
    'private.create_bulk_vocab_assignments_v6(',
    'private.create_bulk_vocab_assignments_v8('
  );
  function_definition := replace(
    function_definition,
    'return private.create_bulk_vocab_assignments_v5(',
    'return private.create_bulk_vocab_assignments_v7('
  );

  if position(
      'private.create_bulk_vocab_assignments_v6('
      in function_definition
    ) > 0
    or position(
      'return private.create_bulk_vocab_assignments_v5('
      in function_definition
    ) > 0
    or position(
      'return private.create_bulk_vocab_assignments_v7('
      in function_definition
    ) = 0
  then
    raise exception 'bulk_vocab_series_v8_rewrite_failed';
  end if;

  execute function_definition;
end;
$migration$;

create function public.create_bulk_vocab_assignments_v8(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.create_bulk_vocab_assignments_v8(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );
$$;

revoke all on function private.create_bulk_vocab_assignments_v7(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function private.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) to authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) to authenticated, service_role;

commit;
