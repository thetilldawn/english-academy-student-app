begin;

create function private.vocab_pronunciation_selection_matches_v1(
  p_variants jsonb,
  p_variant_id text,
  p_audio_url text
)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select exists (
    select 1
    from jsonb_array_elements(p_variants) as variant(value)
    where variant.value ->> 'variant_id' = p_variant_id
      and variant.value ->> 'audio_url' = p_audio_url
  );
$$;

create table public.vocab_entry_pronunciations (
  vocab_entry_id bigint primary key,
  dataset_id uuid not null,
  source_row integer not null check (source_row > 0),
  entry_row_sha256 text not null check (
    entry_row_sha256 ~ '^[0-9A-F]{64}$'
  ),
  headword_normalized text not null check (
    char_length(trim(headword_normalized)) between 1 and 160
  ),
  provider text not null check (provider = 'merriam_webster'),
  status text not null check (
    status in ('raw_first_variant_unreviewed', 'api_lookup_required')
  ),
  review_status text not null check (review_status = 'raw_unreviewed'),
  needs_review boolean not null,
  listening_enabled boolean not null,
  selected_variant_id text,
  selected_audio_url text check (
    selected_audio_url is null
    or selected_audio_url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
  ),
  selected_sound_audio text,
  selected_pos text,
  selected_mw_notation text,
  variants jsonb not null check (jsonb_typeof(variants) = 'array'),
  raw_provenance jsonb not null check (
    jsonb_typeof(raw_provenance) = 'array'
  ),
  source_package_version text not null check (
    source_package_version ~ '^[0-9A-F]{64}$'
  ),
  content_sha256 text not null check (
    content_sha256 ~ '^[0-9A-F]{64}$'
  ),
  imported_at timestamptz not null default now(),
  unique (dataset_id, source_row),
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete cascade,
  constraint vocab_entry_pronunciations_playback_contract check (
    (
      status = 'raw_first_variant_unreviewed'
      and listening_enabled
      and selected_variant_id is not null
      and selected_audio_url is not null
      and selected_sound_audio is not null
      and jsonb_array_length(variants) > 0
      and private.vocab_pronunciation_selection_matches_v1(
        variants,
        selected_variant_id,
        selected_audio_url
      )
    )
    or (
      status = 'api_lookup_required'
      and not listening_enabled
      and selected_variant_id is null
      and selected_audio_url is null
      and selected_sound_audio is null
      and jsonb_array_length(variants) = 0
    )
  )
);

create index vocab_entry_pronunciations_dataset_status_idx
  on public.vocab_entry_pronunciations(
    dataset_id,
    listening_enabled,
    source_row
  );

alter table public.vocab_entry_pronunciations enable row level security;

revoke all on table public.vocab_entry_pronunciations
  from public, anon, authenticated;
grant select, insert, update on table public.vocab_entry_pronunciations
  to service_role;

revoke all on function private.vocab_pronunciation_selection_matches_v1(
  jsonb,
  text,
  text
) from public, anon, authenticated;
grant execute on function private.vocab_pronunciation_selection_matches_v1(
  jsonb,
  text,
  text
) to service_role;

notify pgrst, 'reload schema';

commit;
