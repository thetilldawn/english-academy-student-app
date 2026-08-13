begin;

create table public.vocab_synthetic_audio_assets (
  asset_id text primary key check (
    asset_id ~ '^synthetic:[0-9a-f]{64}$'
  ),
  dictionary_id text not null check (
    dictionary_id ~ '^expression:[a-z0-9][a-z0-9._''’-]*$'
  ),
  profile_id text not null check (
    profile_id ~ '^profile:[0-9a-f]{16}$'
  ),
  dataset_key text not null check (
    char_length(trim(dataset_key)) between 3 and 200
  ),
  source_exam_package_version text not null check (
    source_exam_package_version ~ '^[0-9a-f]{64}$'
  ),
  speech_text text not null check (
    char_length(trim(speech_text)) between 1 and 160
    and speech_text = trim(speech_text)
  ),
  occurrence_ids jsonb not null check (
    jsonb_typeof(occurrence_ids) = 'array'
    and jsonb_array_length(occurrence_ids) > 0
  ),
  occurrence_count integer not null check (
    occurrence_count > 0
    and occurrence_count = jsonb_array_length(occurrence_ids)
  ),
  provider text not null check (
    provider = 'google_cloud_text_to_speech'
  ),
  model text not null check (model = 'chirp3-hd'),
  voice text not null check (voice = 'en-US-Chirp3-HD-Despina'),
  language_code text not null check (language_code = 'en-US'),
  audio_encoding text not null check (audio_encoding = 'MP3'),
  speaking_rate numeric not null check (speaking_rate = 0.88),
  volume_gain_db numeric not null check (volume_gain_db = 4.0),
  request_sha256 text not null unique check (
    request_sha256 ~ '^[0-9a-f]{64}$'
  ),
  audio_sha256 text not null check (audio_sha256 ~ '^[0-9a-f]{64}$'),
  byte_count integer not null check (byte_count between 128 and 1048576),
  storage_bucket text not null check (
    storage_bucket = 'vocab-pronunciation-audio'
  ),
  storage_object_key text not null unique check (
    storage_object_key ~ '^pronunciation/google_cloud_text_to_speech/profile-[0-9a-f]{16}/[0-9a-f]{64}[.]mp3$'
  ),
  source_queue_item_sha256 text not null check (
    source_queue_item_sha256 ~ '^[0-9a-f]{64}$'
  ),
  pronunciation_identity_type text not null check (
    pronunciation_identity_type = 'dictionary_expression'
  ),
  pronunciation_mode text not null check (
    pronunciation_mode = 'provider_default_expression'
  ),
  generation_status text not null check (
    generation_status in ('generated', 'reused_verified')
  ),
  review_status text not null check (
    review_status = 'profile_approved_generated'
  ),
  canonical_pronunciation_unchanged boolean not null check (
    canonical_pronunciation_unchanged
  ),
  canonical_pronunciation_approval_implied boolean not null check (
    not canonical_pronunciation_approval_implied
  ),
  storage_verified boolean not null check (storage_verified),
  playback_enabled boolean not null default true,
  created_at_utc timestamptz not null default now(),
  updated_at_utc timestamptz not null default now(),
  unique (dictionary_id, profile_id),
  constraint vocab_synthetic_audio_asset_request_contract check (
    asset_id = 'synthetic:' || request_sha256
    and storage_object_key =
      'pronunciation/google_cloud_text_to_speech/' ||
      replace(profile_id, ':', '-') || '/' || request_sha256 || '.mp3'
  ),
  constraint vocab_synthetic_audio_asset_playback_contract check (
    not playback_enabled
    or (
      storage_verified
      and review_status = 'profile_approved_generated'
      and canonical_pronunciation_unchanged
      and not canonical_pronunciation_approval_implied
    )
  )
);

create unique index vocab_synthetic_audio_one_enabled_dictionary_idx
  on public.vocab_synthetic_audio_assets(dictionary_id)
  where playback_enabled;

alter table public.vocab_synthetic_audio_assets enable row level security;

revoke all on table public.vocab_synthetic_audio_assets
  from public, anon, authenticated;
grant select, insert, update on table public.vocab_synthetic_audio_assets
  to service_role;

commit;
