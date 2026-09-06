begin;

-- WORD-20260906-01: only approved source exports; existing students/attempts are untouched.
create function private.approved_pronunciation_scope_v1(p_key text, p_sha text, p_count integer)
returns boolean language sql immutable set search_path = '' as $$
  select exists(select 1 from (values
    ('ability-voca-etymology-2025', '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133', 3001),
    ('simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1', '039D9B3B5F2082F707830258A5A47280C36666A59DB53005012D27287FD050F1', 111),
    ('simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1', '5E6AEE5AFDE8A44C6685E6FF92109FB3D300BCB856F0B7C942D9AB0E3686C8CB', 111),
    ('simseok-g10-sem2-mid-adjective-500-v1', 'A7891662F732A57C4F9ADE87E73D82875DB61C44760BCC0C57A863353DB428C5', 500),
    ('simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1', '6876434435288010C844406C78C1C43B8AC3AB550A3FAC4C06A043F84536EBB4', 320),
    ('simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1', '9384C2D8AA8D25C88F87444FC3D78570660B39CD8F2D9C844A7BB4D977EAAF08', 189),
    ('simseok-g11-sem2-mid-mock-v1', '22DB0FFA49960DCF28C6B612203364A664B4C83378366F26E538A6D42457F17F', 278)
  ) as scope(dataset_key, source_sha256, row_count)
    where scope.dataset_key = p_key and scope.source_sha256 = p_sha and scope.row_count = p_count);
$$;

create function private.valid_pronunciation_storage_path_v1(p_profile text, p_hash text, p_key text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_hash ~ '^[0-9a-f]{64}$' and (
    (p_profile in ('profile:75ca7f418d66e6ab', 'profile:1a77d56d47e26013')
      and p_key = 'pronunciation/google_cloud_text_to_speech/' ||
        replace(p_profile, ':', '-') || '/ability-voca-etymology-2025-v1/' || p_hash || '.mp3')
    or (p_profile in ('profile:1a77d56d47e26013', 'profile:286866721f7f4ee8')
      and p_key = 'pronunciation/google_cloud_text_to_speech/' ||
        replace(p_profile, ':', '-') || '/' || p_hash || '.mp3')
  ), false);
$$;

revoke all on function private.approved_pronunciation_scope_v1(text, text, integer) from public, anon, authenticated, service_role;
revoke all on function private.valid_pronunciation_storage_path_v1(text, text, text) from public, anon, authenticated, service_role;

alter table public.vocab_pronunciation_releases_v2
  drop constraint vocab_pronunciation_releases_v2_dataset_key_check,
  drop constraint vocab_pronunciation_releases_v2_expected_entry_count_check,
  add constraint vocab_pronunciation_release_approved_scope_v1 check (
    private.approved_pronunciation_scope_v1(dataset_key, dataset_source_sha256, expected_entry_count)
  );

alter table public.vocab_pronunciation_tts_assets_v2
  drop constraint vocab_pronunciation_tts_asset_profile_path_v2,
  add constraint vocab_pronunciation_tts_asset_profile_path_v2 check (
    private.valid_pronunciation_storage_path_v1(profile_id, request_sha256, storage_object_key)
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
      and private.valid_pronunciation_storage_path_v1(profile_id, request_sha256, storage_object_key)
      and audio_sha256 is not null
      and byte_count is not null
      and model = 'chirp3-hd'
      and voice = 'en-US-Chirp3-HD-Despina'
    )
    , false)
  );


alter table public.vocab_pronunciation_identities_v2
  drop constraint vocab_pronunciation_identities_v2_stress_evidence_check,
  add constraint vocab_pronunciation_identities_v2_stress_evidence_check check (
    stress_evidence in ('selected_webster_lexical_stress', 'cmudict_lexical_stress', 'cmudict_phrase_stress_rule_v1')
  );

-- The binding contract already distinguishes exact headword and POS.
create unique index vocab_pronunciation_identity_surface_pos_variant_v4
on public.vocab_pronunciation_identities_v2 (
  headword_normalized, headword, pronunciation_variant_id, engine_version, lexical_pos
) nulls not distinct;
drop index public.vocab_pronunciation_identity_surface_variant_v3;

create function private.stage_school_pronunciation_release_v1(p_header jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dataset_id uuid;
  v_release_id text;
begin
  if p_header is null
    or jsonb_typeof(p_header) is distinct from 'object'
    or p_header ->> 'schema_version' is distinct from
      'vocab-pronunciation-release-v2'
    or p_header ->> 'engine_version' is distinct from
      'cmudict-arpabet-hangul-nucleus-render-v2'
    or coalesce(p_header ->> 'release_id', '') !~
      '^voca-release:[0-9a-f]{64}$'
    or coalesce(p_header ->> 'package_version', '') !~ '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'source_plan_version', '') !~ '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'source_tts_manifest_sha256', '') !~
      '^[0-9A-F]{64}$'
    or coalesce(p_header ->> 'expected_entry_count', '') !~ '^[0-9]+$'
    or not private.approved_pronunciation_scope_v1(
      p_header ->> 'dataset_key', p_header ->> 'dataset_source_sha256',
      (p_header ->> 'expected_entry_count')::integer
    )
    or p_header ->> 'dataset_key' = 'ability-voca-etymology-2025'
    or coalesce(p_header ->> 'expected_identity_count', '') !~ '^[0-9]+$'
    or coalesce(p_header ->> 'expected_webster_binding_count', '') !~
      '^[0-9]+$'
    or coalesce(p_header ->> 'expected_tts_binding_count', '') !~ '^[0-9]+$'
    or coalesce(p_header ->> 'expected_tts_asset_count', '') !~ '^[0-9]+$'
  then
    raise exception 'invalid_vocab_pronunciation_release_header_v3'
      using errcode = '22023';
  end if;

  v_release_id := p_header ->> 'release_id';
  select dataset.id
  into strict v_dataset_id
  from public.vocab_datasets as dataset
  where dataset.dataset_key = p_header ->> 'dataset_key'
    and upper(dataset.source_sha256) = p_header ->> 'dataset_source_sha256'
    and dataset.row_count = (p_header ->> 'expected_entry_count')::integer
    and (
      select count(*)
      from public.vocab_entries as entry
      where entry.dataset_id = dataset.id
    ) = (p_header ->> 'expected_entry_count')::integer;

  if exists (
    select 1
    from public.vocab_pronunciation_releases_v2 as existing
    where existing.release_id = v_release_id
      and (
        existing.dataset_id <> v_dataset_id
        or existing.dataset_key <> p_header ->> 'dataset_key'
        or existing.dataset_source_sha256 <>
          p_header ->> 'dataset_source_sha256'
        or existing.package_version <> p_header ->> 'package_version'
        or existing.source_plan_version <> p_header ->> 'source_plan_version'
        or existing.source_tts_manifest_sha256 <>
          p_header ->> 'source_tts_manifest_sha256'
        or existing.engine_version <> p_header ->> 'engine_version'
        or existing.expected_entry_count <>
          (p_header ->> 'expected_entry_count')::integer
        or existing.expected_identity_count <>
          (p_header ->> 'expected_identity_count')::integer
        or existing.expected_webster_binding_count <>
          (p_header ->> 'expected_webster_binding_count')::integer
        or existing.expected_tts_binding_count <>
          (p_header ->> 'expected_tts_binding_count')::integer
        or existing.expected_tts_asset_count <>
          (p_header ->> 'expected_tts_asset_count')::integer
      )
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v3'
      using errcode = '23505';
  end if;

  insert into public.vocab_pronunciation_releases_v2 (
    release_id, dataset_id, dataset_key, dataset_source_sha256,
    source_plan_version, source_tts_manifest_sha256, package_version,
    engine_version, status, expected_entry_count, expected_identity_count,
    expected_webster_binding_count, expected_tts_binding_count,
    expected_tts_asset_count
  ) values (
    v_release_id, v_dataset_id, p_header ->> 'dataset_key',
    p_header ->> 'dataset_source_sha256', p_header ->> 'source_plan_version',
    p_header ->> 'source_tts_manifest_sha256',
    p_header ->> 'package_version', p_header ->> 'engine_version', 'staged',
    (p_header ->> 'expected_entry_count')::integer,
    (p_header ->> 'expected_identity_count')::integer,
    (p_header ->> 'expected_webster_binding_count')::integer,
    (p_header ->> 'expected_tts_binding_count')::integer,
    (p_header ->> 'expected_tts_asset_count')::integer
  ) on conflict (release_id) do nothing;

  if not exists (
    select 1
    from public.vocab_pronunciation_releases_v2 as stored
    where stored.release_id = v_release_id
      and stored.dataset_id = v_dataset_id
      and stored.dataset_key = p_header ->> 'dataset_key'
      and stored.dataset_source_sha256 = p_header ->> 'dataset_source_sha256'
      and stored.source_plan_version = p_header ->> 'source_plan_version'
      and stored.source_tts_manifest_sha256 =
        p_header ->> 'source_tts_manifest_sha256'
      and stored.package_version = p_header ->> 'package_version'
      and stored.engine_version = p_header ->> 'engine_version'
      and stored.expected_entry_count =
        (p_header ->> 'expected_entry_count')::integer
      and stored.expected_identity_count =
        (p_header ->> 'expected_identity_count')::integer
      and stored.expected_webster_binding_count =
        (p_header ->> 'expected_webster_binding_count')::integer
      and stored.expected_tts_binding_count =
        (p_header ->> 'expected_tts_binding_count')::integer
      and stored.expected_tts_asset_count =
        (p_header ->> 'expected_tts_asset_count')::integer
  ) then
    raise exception 'vocab_pronunciation_release_identity_conflict_v3'
      using errcode = '23505';
  end if;

  return jsonb_build_object(
    'release_id', v_release_id,
    'dataset_id', v_dataset_id,
    'status', (
      select release.status
      from public.vocab_pronunciation_releases_v2 as release
      where release.release_id = v_release_id
    )
  );
end;
$$;


revoke all on function private.stage_school_pronunciation_release_v1(jsonb)
  from public, anon, authenticated, service_role;

create function public.stage_school_pronunciation_release_v1(p_header jsonb)
returns jsonb language sql security definer set search_path = '' as $$
  select private.stage_school_pronunciation_release_v1(p_header);
$$;
revoke all on function public.stage_school_pronunciation_release_v1(jsonb)
  from public, anon, authenticated;
grant execute on function public.stage_school_pronunciation_release_v1(jsonb) to service_role;

-- Existing v3 identity/binding/verify/activate remain authoritative and unchanged.
notify pgrst, 'reload schema';
commit;
