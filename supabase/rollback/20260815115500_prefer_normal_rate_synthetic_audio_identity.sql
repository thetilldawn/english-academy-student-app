begin;

do $$
declare
  v_definition text;
  v_updated text;
begin
  if exists (
    select 1
    from public.vocab_synthetic_audio_bindings
    group by release_id, vocab_entry_id, dictionary_id
    having count(*) > 1
  ) then
    raise exception 'additional_synthetic_audio_bindings_must_be_reverted_first';
  end if;

  select pg_get_functiondef(
    'private.import_rule_derived_korean_pronunciation_package_v2(jsonb)'::regprocedure
  ) into v_definition;

  v_updated := regexp_replace(
    v_definition,
    '    left join lateral \([[:space:]]+select[[:space:]]+candidate_asset[.]asset_id,[[:space:]]+candidate_asset[.]audio_sha256[[:space:]]+from public[.]vocab_synthetic_audio_bindings as candidate_binding[[:space:]]+join public[.]vocab_synthetic_audio_assets as candidate_asset[[:space:]]+on candidate_asset[.]asset_id = candidate_binding[.]asset_id[[:space:]]+and candidate_asset[.]dictionary_id = occurrence[.]dictionary_id[[:space:]]+and candidate_asset[.]storage_verified[[:space:]]+and candidate_asset[.]playback_enabled[[:space:]]+where candidate_binding[.]release_id = release[.]release_id[[:space:]]+and candidate_binding[.]vocab_entry_id = occurrence[.]vocab_entry_id[[:space:]]+and candidate_binding[.]dictionary_id = occurrence[.]dictionary_id[[:space:]]+order by[[:space:]]+case[[:space:]]+when occurrence[.]dictionary_id ~ ''\^expression:''[[:space:]]+and candidate_binding[.]profile_id = ''profile:286866721f7f4ee8''[[:space:]]+then 0[[:space:]]+when occurrence[.]dictionary_id ~ ''\^word:''[[:space:]]+and candidate_binding[.]profile_id = ''profile:1a77d56d47e26013''[[:space:]]+then 0[[:space:]]+else 1[[:space:]]+end,[[:space:]]+candidate_binding[.]profile_id,[[:space:]]+candidate_binding[.]asset_id[[:space:]]+limit 1[[:space:]]+\) as asset on true',
    $replacement$    left join public.vocab_synthetic_audio_bindings as binding
      on binding.release_id = release.release_id
      and binding.vocab_entry_id = occurrence.vocab_entry_id
      and binding.dictionary_id = occurrence.dictionary_id
    left join public.vocab_synthetic_audio_assets as asset
      on asset.asset_id = binding.asset_id
      and asset.dictionary_id = occurrence.dictionary_id
      and asset.storage_verified
      and asset.playback_enabled$replacement$
  );

  if v_updated = v_definition then
    raise exception 'preferred_synthetic_audio_identity_join_not_found';
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
