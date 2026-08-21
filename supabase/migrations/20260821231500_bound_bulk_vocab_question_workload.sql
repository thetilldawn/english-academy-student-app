begin;

-- Keep the v8 atomic writer and add the only callable workload boundary. This
-- prevents a valid 210-series request from expanding into an impractical
-- 105,000-question transaction while preserving idempotency and locking.
create or replace function public.create_bulk_vocab_assignments_v8(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  total_question_count bigint;
begin
  -- Authenticate before walking caller-controlled JSON. The private writer is
  -- no longer executable by API roles, so this wrapper cannot be bypassed.
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if jsonb_typeof(p_batches) is distinct from 'array' then
    raise exception 'invalid_bulk_assignment_batches' using errcode = '22023';
  end if;

  select coalesce(sum(
    greatest(
      case
        when jsonb_typeof(item -> 'question_count') = 'number'
          and (item ->> 'question_count') ~ '^[0-9]+$'
        then (item ->> 'question_count')::bigint
        else 10001
      end,
      case
        when jsonb_typeof(item -> 'questions') = 'array'
        then jsonb_array_length(item -> 'questions')::bigint
        else 10001
      end
    )
  ), 0)
  into total_question_count
  from jsonb_array_elements(p_batches) as batch(item);

  if total_question_count > 10000 then
    raise exception 'bulk_question_count_exceeded' using errcode = '22023';
  end if;

  return private.create_bulk_vocab_assignments_v8(
    p_idempotency_key,
    p_request_sha256,
    p_batches
  );
end;
$$;

-- Retire every prior public bulk writer. v1-v2 were already retired by an
-- earlier migration; repeating the revoke keeps this boundary self-contained.
-- v3-v6 otherwise permit 15,000+ questions without the new guard.
revoke all on function public.create_bulk_vocab_assignments_v1(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v2(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v3(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v4(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v1(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v2(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v3(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v4(
  jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v5(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v6(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v7(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function private.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;

revoke all on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_vocab_assignments_v8(
  uuid, text, jsonb
) to authenticated, service_role;

commit;
