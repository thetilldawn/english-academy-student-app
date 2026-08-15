begin;

do $$
declare
  v_definition text;
  v_updated text;
  v_pattern text :=
    '    left join public[.]vocab_synthetic_audio_bindings as binding[[:space:]]+on binding[.]release_id = release[.]release_id[[:space:]]+and binding[.]vocab_entry_id = occurrence[.]vocab_entry_id[[:space:]]+and binding[.]dictionary_id = occurrence[.]dictionary_id[[:space:]]+left join public[.]vocab_synthetic_audio_assets as asset[[:space:]]+on asset[.]asset_id = binding[.]asset_id[[:space:]]+and asset[.]dictionary_id = occurrence[.]dictionary_id[[:space:]]+and asset[.]storage_verified[[:space:]]+and asset[.]playback_enabled';
begin
  select pg_get_functiondef(
    'private.import_rule_derived_korean_pronunciation_package_v2(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, v_pattern) <> 1 then
    raise exception 'ambiguous_synthetic_audio_identity_join_not_found';
  end if;

  v_updated := regexp_replace(
    v_definition,
    v_pattern,
    $replacement$    left join lateral (
      select
        candidate_asset.asset_id,
        candidate_asset.audio_sha256
      from public.vocab_synthetic_audio_bindings as candidate_binding
      join public.vocab_synthetic_audio_assets as candidate_asset
        on candidate_asset.asset_id = candidate_binding.asset_id
        and candidate_asset.dictionary_id = occurrence.dictionary_id
        and candidate_asset.storage_verified
        and candidate_asset.playback_enabled
      where candidate_binding.release_id = release.release_id
        and candidate_binding.vocab_entry_id = occurrence.vocab_entry_id
        and candidate_binding.dictionary_id = occurrence.dictionary_id
      order by
        case
          when occurrence.dictionary_id ~ '^expression:'
            and candidate_binding.profile_id = 'profile:286866721f7f4ee8'
            then 0
          when occurrence.dictionary_id ~ '^word:'
            and candidate_binding.profile_id = 'profile:1a77d56d47e26013'
            then 0
          else 1
        end,
        candidate_binding.profile_id,
        candidate_binding.asset_id
      limit 1
    ) as asset on true$replacement$
  );

  if regexp_count(v_updated, '    left join lateral \(') <> 1
    or regexp_count(v_updated, v_pattern) <> 0
  then
    raise exception 'preferred_synthetic_audio_identity_join_update_failed';
  end if;

  execute v_updated;
end;
$$;

revoke all on function
  private.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  from public, anon, authenticated;
grant execute on function
  public.import_rule_derived_korean_pronunciation_package_v2(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
