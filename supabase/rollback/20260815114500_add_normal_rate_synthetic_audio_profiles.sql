begin;

do $$
begin
  if exists (
    select 1
    from public.vocab_synthetic_audio_assets
    where profile_id in (
      'profile:286866721f7f4ee8',
      'profile:1a77d56d47e26013'
    )
  ) or exists (
    select 1
    from public.vocab_pronunciation_tts_assets_v2
    where profile_id = 'profile:1a77d56d47e26013'
  ) or exists (
    select 1
    from public.vocab_pronunciation_identities_v2
    where profile_id = 'profile:1a77d56d47e26013'
  ) then
    raise exception 'normal_rate_audio_data_must_be_reverted_first';
  end if;
end;
$$;

alter table public.vocab_synthetic_audio_assets
  drop constraint vocab_synthetic_audio_assets_profile_rate_scope_check;

alter table public.vocab_synthetic_audio_assets
  add constraint vocab_synthetic_audio_assets_speaking_rate_check
    check (speaking_rate = 0.88);

alter table public.vocab_synthetic_audio_bindings
  drop constraint vocab_synthetic_audio_binding_release_vocab_entry_profile_key;

alter table public.vocab_synthetic_audio_bindings
  add constraint vocab_synthetic_audio_binding_release_vocab_entry_key
    unique (release_id, vocab_entry_id);

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
    'p_package ->> ''profile_id'' <> ''profile:5b6efb0ecc8f4702'''
  );
  if v_updated = v_definition then
    raise exception 'synthetic_expression_import_profile_guard_not_found';
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
    'p_package ->> ''profile_id'' is distinct from ''profile:75ca7f418d66e6ab'''
  );
  if v_updated = v_definition then
    raise exception 'synthetic_word_import_profile_guard_not_found';
  end if;
  execute v_updated;
end;
$$;

create or replace function public.import_vocab_synthetic_audio_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_vocab_synthetic_audio_package_v1(p_package);
$$;

create or replace function public.import_vocab_synthetic_word_audio_package_v1(
  p_package jsonb
)
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.import_vocab_synthetic_word_audio_package_v1(p_package);
$$;

revoke all on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function private.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;
grant execute on function private.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;
revoke all on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  from public, anon, authenticated;
revoke all on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.import_vocab_synthetic_audio_package_v1(jsonb)
  to service_role;
grant execute on function public.import_vocab_synthetic_word_audio_package_v1(jsonb)
  to service_role;

alter table public.vocab_pronunciation_tts_assets_v2
  drop constraint vocab_pronunciation_tts_asset_profile_path_v2;

alter table public.vocab_pronunciation_tts_assets_v2
  add constraint vocab_pronunciation_tts_assets_v2_check check (
    storage_object_key =
      'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/' ||
      request_sha256 || '.mp3'
  ),
  add constraint vocab_pronunciation_tts_assets_v2_profile_id_check check (
    profile_id = 'profile:75ca7f418d66e6ab'
  );

alter table public.vocab_pronunciation_identities_v2
  drop constraint vocab_pronunciation_identity_audio_v2;

alter table public.vocab_pronunciation_identities_v2
  add constraint vocab_pronunciation_identity_audio_v2 check (
    coalesce((
      audio_provider = 'merriam_webster'
      and pronunciation_variant_id ~ '^mw:[0-9a-f]{20}$'
      and official_audio_url is not null
      and official_audio_url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
      and sound_audio is not null
      and storage_bucket is null
      and storage_object_key is null
      and audio_sha256 is null
      and byte_count is null
      and profile_id is null
      and request_sha256 is null
      and model is null
      and voice is null
    )
    or (
      audio_provider = 'google_cloud_text_to_speech'
      and request_sha256 is not null
      and pronunciation_variant_id = 'synthetic:' || request_sha256
      and official_audio_url is null
      and sound_audio is null
      and mw_notation is null
      and storage_bucket = 'vocab-pronunciation-audio'
      and storage_object_key =
        'pronunciation/google_cloud_text_to_speech/profile-75ca7f418d66e6ab/ability-voca-etymology-2025-v1/' ||
        request_sha256 || '.mp3'
      and audio_sha256 is not null
      and byte_count is not null
      and profile_id = 'profile:75ca7f418d66e6ab'
      and model = 'chirp3-hd'
      and voice = 'en-US-Chirp3-HD-Despina'
    )
    , false)
  );

notify pgrst, 'reload schema';

commit;
