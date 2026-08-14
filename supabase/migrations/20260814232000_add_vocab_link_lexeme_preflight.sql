create function private.preflight_vocab_link_lexeme_batch(
  p_build_id uuid,
  p_requirements jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  received_count integer;
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_build_id is null
    or p_requirements is null
    or jsonb_typeof(p_requirements) <> 'array'
  then
    raise exception 'invalid_vocab_link_lexeme_preflight'
      using errcode = '22023';
  end if;

  received_count := jsonb_array_length(p_requirements);
  if received_count not between 1 and 500 then
    raise exception 'vocab_link_lexeme_preflight_batch_size'
      using errcode = '22023';
  end if;
  if not exists (
    select 1
    from word_index.index_build as build
    where build.build_id = p_build_id
      and build.status = 'complete'
  ) then
    raise exception 'vocab_link_lexeme_preflight_build_not_ready'
      using errcode = '55000';
  end if;

  if (
    select count(distinct requirement.lexeme_id)
    from jsonb_to_recordset(p_requirements) as requirement(
      lexeme_id uuid,
      content_hash text,
      headword text,
      lexeme_type text
    )
  ) <> received_count
  or exists (
    select 1
    from jsonb_to_recordset(p_requirements) as requirement(
      lexeme_id uuid,
      content_hash text,
      headword text,
      lexeme_type text
    )
    where requirement.lexeme_id is null
      or nullif(trim(requirement.headword), '') is null
      or nullif(trim(requirement.lexeme_type), '') is null
      or (
        requirement.content_hash is not null
        and requirement.content_hash !~ '^[0-9A-F]{64}$'
      )
  ) then
    raise exception 'vocab_link_lexeme_preflight_invalid_requirement'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_requirements) as requirement(
      lexeme_id uuid,
      content_hash text,
      headword text,
      lexeme_type text
    )
    left join word_index.lexeme as lexeme
      on lexeme.lexeme_id = requirement.lexeme_id
    where lexeme.lexeme_id is null
      or lexeme.headword is distinct from requirement.headword
      or lexeme.lexeme_type is distinct from requirement.lexeme_type
      or (
        requirement.content_hash is not null
        and upper(lexeme.content_hash) <> requirement.content_hash
      )
  ) then
    raise exception 'vocab_link_lexeme_preflight_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'buildId', p_build_id,
    'checkedRows', received_count,
    'missingRows', 0,
    'mismatchedRows', 0
  );
end;
$$;

create function public.preflight_vocab_link_lexeme_batch(
  p_build_id uuid,
  p_requirements jsonb
)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  select private.preflight_vocab_link_lexeme_batch(
    p_build_id,
    p_requirements
  );
$$;

revoke all on function private.preflight_vocab_link_lexeme_batch(
  uuid,
  jsonb
) from public, anon, authenticated;
revoke all on function public.preflight_vocab_link_lexeme_batch(
  uuid,
  jsonb
) from public, anon, authenticated;
grant execute on function private.preflight_vocab_link_lexeme_batch(
  uuid,
  jsonb
) to service_role;
grant execute on function public.preflight_vocab_link_lexeme_batch(
  uuid,
  jsonb
) to service_role;

notify pgrst, 'reload schema';
