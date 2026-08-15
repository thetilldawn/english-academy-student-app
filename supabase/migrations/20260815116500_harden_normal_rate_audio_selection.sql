begin;

do $$
declare
  v_definition text;
  v_updated text;
  v_old_pattern text :=
    '\(p_package ->> ''profile_id''\) not in \(''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8''\)';
  v_new_pattern text :=
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8''\)';
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, v_new_pattern) = 1 then
    v_updated := v_definition;
  elsif regexp_count(v_definition, v_old_pattern) = 1 then
    v_updated := regexp_replace(
      v_definition,
      v_old_pattern,
      '(p_package ->> ''profile_id'') is null or (p_package ->> ''profile_id'') not in (''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8'')'
    );
  else
    raise exception 'synthetic_expression_profile_guard_is_ambiguous';
  end if;

  if regexp_count(v_updated, v_new_pattern) <> 1
    or regexp_count(v_updated, v_old_pattern) <> 1
  then
    -- The old pattern is a suffix of the null-safe expression, so both counts
    -- must be exactly one after hardening.
    raise exception 'synthetic_expression_profile_guard_hardening_failed';
  end if;
  if v_updated <> v_definition then execute v_updated; end if;
end;
$$;

do $$
declare
  v_definition text;
  v_updated text;
  v_old_pattern text :=
    '\(p_package ->> ''profile_id''\) not in \(''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013''\)';
  v_new_pattern text :=
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013''\)';
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_word_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, v_new_pattern) = 1 then
    v_updated := v_definition;
  elsif regexp_count(v_definition, v_old_pattern) = 1 then
    v_updated := regexp_replace(
      v_definition,
      v_old_pattern,
      '(p_package ->> ''profile_id'') is null or (p_package ->> ''profile_id'') not in (''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013'')'
    );
  else
    raise exception 'synthetic_word_profile_guard_is_ambiguous';
  end if;

  if regexp_count(v_updated, v_new_pattern) <> 1
    or regexp_count(v_updated, v_old_pattern) <> 1
  then
    raise exception 'synthetic_word_profile_guard_hardening_failed';
  end if;
  if v_updated <> v_definition then execute v_updated; end if;
end;
$$;

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'private.import_rule_derived_korean_pronunciation_package_v2(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, '    left join lateral \(') <> 1
    or regexp_count(
      v_definition,
      'left join public[.]vocab_synthetic_audio_bindings as binding'
    ) <> 0
    or regexp_count(v_definition, 'profile:286866721f7f4ee8') <> 1
    or regexp_count(v_definition, 'profile:1a77d56d47e26013') <> 1
  then
    raise exception 'preferred_synthetic_audio_identity_join_is_ambiguous';
  end if;
end;
$$;

revoke all on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  private.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;
grant execute on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
