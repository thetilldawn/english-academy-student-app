begin;

-- Keep the legacy public import surface usable for the original renderer only.
-- The private v2 functions predate the nucleus renderer and intentionally remain
-- unchanged so existing releases are readable.  These public guards prevent a
-- service-role caller from routing a nucleus (v3 identity) release through that
-- older, less-specific path.

create or replace function public.stage_vocab_pronunciation_release_v2(
  p_header jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_header is null
    or jsonb_typeof(p_header) is distinct from 'object'
    or p_header ->> 'engine_version' is distinct from
      'cmudict-arpabet-hangul-render-v1'
  then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  return private.stage_vocab_pronunciation_release_v2(p_header);
end;
$$;

create or replace function public.import_vocab_pronunciation_identity_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
    and release.engine_version = 'cmudict-arpabet-hangul-render-v1'
  for key share;
  if not found then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  if p_items is not null
    and jsonb_typeof(p_items) = 'array'
    and exists (
      select 1
      from jsonb_to_recordset(p_items) as item(
        identity_id text,
        engine_version text,
        display_source text
      )
      where item.identity_id !~ '^pron:v2:[0-9a-f]{64}$'
        or item.engine_version is distinct from
          'cmudict-arpabet-hangul-render-v1'
        or item.display_source not in (
          'user_approved_100_identity_v1',
          'deterministic_rule_v1'
        )
    )
  then
    raise exception 'vocab_pronunciation_identity_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  return private.import_vocab_pronunciation_identity_batch_v2(
    p_release_id,
    p_items
  );
end;
$$;

create or replace function public.import_vocab_pronunciation_binding_batch_v2(
  p_release_id text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.status = 'staged'
    and release.engine_version = 'cmudict-arpabet-hangul-render-v1'
  for key share;
  if not found then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  if p_items is not null
    and jsonb_typeof(p_items) = 'array'
    and exists (
      select 1
      from jsonb_to_recordset(p_items) as item(identity_id text)
      left join public.vocab_pronunciation_identities_v2 as identity
        on identity.identity_id = item.identity_id
      where identity.identity_id is null
        or identity.identity_id !~ '^pron:v2:[0-9a-f]{64}$'
        or identity.engine_version <>
          'cmudict-arpabet-hangul-render-v1'
    )
  then
    raise exception 'vocab_pronunciation_binding_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  return private.import_vocab_pronunciation_binding_batch_v2(
    p_release_id,
    p_items
  );
end;
$$;

create or replace function public.verify_vocab_pronunciation_release_v2(
  p_release_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.engine_version = 'cmudict-arpabet-hangul-render-v1'
  for key share;
  if not found then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.vocab_entry_pronunciation_bindings_v2 as binding
    left join public.vocab_pronunciation_identities_v2 as identity
      on identity.identity_id = binding.identity_id
    where binding.release_id = p_release_id
      and (
        identity.identity_id is null
        or identity.identity_id !~ '^pron:v2:[0-9a-f]{64}$'
        or identity.engine_version <>
          'cmudict-arpabet-hangul-render-v1'
      )
  ) then
    raise exception 'vocab_pronunciation_release_mixed_generation_v2'
      using errcode = '21000';
  end if;

  return private.verify_vocab_pronunciation_release_v2(p_release_id);
end;
$$;

create or replace function public.activate_vocab_pronunciation_release_v2(
  p_release_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform 1
  from public.vocab_pronunciation_releases_v2 as release
  where release.release_id = p_release_id
    and release.engine_version = 'cmudict-arpabet-hangul-render-v1'
  for update;
  if not found then
    raise exception 'vocab_pronunciation_release_generation_mismatch_v2'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from public.vocab_entry_pronunciation_bindings_v2 as binding
    left join public.vocab_pronunciation_identities_v2 as identity
      on identity.identity_id = binding.identity_id
    where binding.release_id = p_release_id
      and (
        identity.identity_id is null
        or identity.identity_id !~ '^pron:v2:[0-9a-f]{64}$'
        or identity.engine_version <>
          'cmudict-arpabet-hangul-render-v1'
      )
  ) then
    raise exception 'vocab_pronunciation_release_mixed_generation_v2'
      using errcode = '21000';
  end if;

  return private.activate_vocab_pronunciation_release_v2(p_release_id);
end;
$$;

revoke all on function public.stage_vocab_pronunciation_release_v2(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  from public, anon, authenticated;
revoke all on function public.verify_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;
revoke all on function public.activate_vocab_pronunciation_release_v2(text)
  from public, anon, authenticated;

grant execute on function public.stage_vocab_pronunciation_release_v2(jsonb)
  to service_role;
grant execute on function public.import_vocab_pronunciation_identity_batch_v2(text, jsonb)
  to service_role;
grant execute on function public.import_vocab_pronunciation_binding_batch_v2(text, jsonb)
  to service_role;
grant execute on function public.verify_vocab_pronunciation_release_v2(text)
  to service_role;
grant execute on function public.activate_vocab_pronunciation_release_v2(text)
  to service_role;

notify pgrst, 'reload schema';

commit;
