begin;

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;
  v_updated := regexp_replace(
    v_definition,
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8''\)',
    '(p_package ->> ''profile_id'') not in (''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8'')'
  );
  if v_updated = v_definition then
    raise exception 'synthetic_expression_profile_guard_rollback_failed';
  end if;
  execute v_updated;
end;
$$;

do $$
declare
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_word_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;
  v_updated := regexp_replace(
    v_definition,
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013''\)',
    '(p_package ->> ''profile_id'') not in (''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013'')'
  );
  if v_updated = v_definition then
    raise exception 'synthetic_word_profile_guard_rollback_failed';
  end if;
  execute v_updated;
end;
$$;

revoke all on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;
grant execute on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
