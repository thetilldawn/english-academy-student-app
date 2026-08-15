begin;

alter table public.vocab_synthetic_audio_assets
  drop constraint vocab_synthetic_audio_assets_speaking_rate_check;

alter table public.vocab_synthetic_audio_assets
  add constraint vocab_synthetic_audio_assets_profile_rate_scope_check check (
    (
      dictionary_id ~ '^expression:'
      and (
        (profile_id = 'profile:5b6efb0ecc8f4702' and speaking_rate = 0.88)
        or (profile_id = 'profile:286866721f7f4ee8' and speaking_rate = 1.0)
      )
    )
    or (
      dictionary_id ~ '^word:'
      and (
        (profile_id = 'profile:75ca7f418d66e6ab' and speaking_rate = 0.88)
        or (profile_id = 'profile:1a77d56d47e26013' and speaking_rate = 1.0)
      )
    )
  );

alter table public.vocab_synthetic_audio_bindings
  drop constraint vocab_synthetic_audio_binding_release_vocab_entry_key;

alter table public.vocab_synthetic_audio_bindings
  add constraint vocab_synthetic_audio_binding_release_vocab_entry_profile_key
    unique (release_id, vocab_entry_id, profile_id);

do $$
declare
  v_definition text;
  v_updated text;
  v_pattern text :=
    'p_package ->> ''profile_id'' <> ''profile:5b6efb0ecc8f4702''';
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, v_pattern) <> 1 then
    raise exception 'synthetic_expression_import_profile_guard_not_found';
  end if;

  v_updated := regexp_replace(
    v_definition,
    v_pattern,
    '(p_package ->> ''profile_id'') is null or (p_package ->> ''profile_id'') not in (''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8'')'
  );

  if regexp_count(
    v_updated,
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:5b6efb0ecc8f4702'', ''profile:286866721f7f4ee8''\)'
  ) <> 1 then
    raise exception 'synthetic_expression_import_profile_guard_update_failed';
  end if;

  execute v_updated;
end;
$$;

do $$
declare
  v_definition text;
  v_updated text;
  v_pattern text :=
    'p_package ->> ''profile_id'' is distinct from[[:space:]]+''profile:75ca7f418d66e6ab''';
begin
  select pg_get_functiondef(
    'private.import_vocab_synthetic_word_audio_package_v1(jsonb)'::regprocedure
  ) into v_definition;

  if regexp_count(v_definition, v_pattern) <> 1 then
    raise exception 'synthetic_word_import_profile_guard_not_found';
  end if;

  v_updated := regexp_replace(
    v_definition,
    v_pattern,
    '(p_package ->> ''profile_id'') is null or (p_package ->> ''profile_id'') not in (''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013'')'
  );

  if regexp_count(
    v_updated,
    '\(p_package ->> ''profile_id''\) is null or \(p_package ->> ''profile_id''\) not in \(''profile:75ca7f418d66e6ab'', ''profile:1a77d56d47e26013''\)'
  ) <> 1 then
    raise exception 'synthetic_word_import_profile_guard_update_failed';
  end if;

  execute v_updated;
end;
$$;

create or replace function public.import_vocab_synthetic_audio_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id text := p_package ->> 'profile_id';
  v_speaking_rate numeric;
begin
  v_speaking_rate := case v_profile_id
    when 'profile:5b6efb0ecc8f4702' then 0.88
    when 'profile:286866721f7f4ee8' then 1.0
    else null
  end;

  if v_speaking_rate is null
    or (p_package -> 'profile' ->> 'speaking_rate')::numeric
      is distinct from v_speaking_rate
    or exists (
      select 1
      from jsonb_to_recordset(p_package -> 'items') as item(
        profile_id text,
        speaking_rate numeric
      )
      where item.profile_id is distinct from v_profile_id
         or item.speaking_rate is distinct from v_speaking_rate
    )
  then
    raise exception 'synthetic_audio_profile_rate_mismatch'
      using errcode = '22023';
  end if;

  return private.import_vocab_synthetic_audio_package_v1(p_package);
end;
$$;

create or replace function public.import_vocab_synthetic_word_audio_package_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id text := p_package ->> 'profile_id';
  v_speaking_rate numeric;
begin
  v_speaking_rate := case v_profile_id
    when 'profile:75ca7f418d66e6ab' then 0.88
    when 'profile:1a77d56d47e26013' then 1.0
    else null
  end;

  if v_speaking_rate is null
    or (p_package -> 'profile' ->> 'speaking_rate')::numeric
      is distinct from v_speaking_rate
    or exists (
      select 1
      from jsonb_to_recordset(p_package -> 'items') as item(
        profile_id text,
        speaking_rate numeric
      )
      where item.profile_id is distinct from v_profile_id
         or item.speaking_rate is distinct from v_speaking_rate
    )
  then
    raise exception 'synthetic_word_audio_profile_rate_mismatch'
      using errcode = '22023';
  end if;

  return private.import_vocab_synthetic_word_audio_package_v1(p_package);
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

alter table public.vocab_pronunciation_tts_assets_v2
  drop constraint vocab_pronunciation_tts_assets_v2_check,
  drop constraint vocab_pronunciation_tts_assets_v2_profile_id_check;

alter table public.vocab_pronunciation_tts_assets_v2
  add constraint vocab_pronunciation_tts_asset_profile_path_v2 check (
    profile_id in (
      'profile:75ca7f418d66e6ab',
      'profile:1a77d56d47e26013'
    )
    and storage_object_key =
      'pronunciation/google_cloud_text_to_speech/' ||
      replace(profile_id, ':', '-') ||
      '/ability-voca-etymology-2025-v1/' ||
      request_sha256 || '.mp3'
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
        'pronunciation/google_cloud_text_to_speech/' ||
        replace(profile_id, ':', '-') ||
        '/ability-voca-etymology-2025-v1/' ||
        request_sha256 || '.mp3'
      and audio_sha256 is not null
      and byte_count is not null
      and profile_id in (
        'profile:75ca7f418d66e6ab',
        'profile:1a77d56d47e26013'
      )
      and model = 'chirp3-hd'
      and voice = 'en-US-Chirp3-HD-Despina'
    )
    , false)
  );

notify pgrst, 'reload schema';

commit;
