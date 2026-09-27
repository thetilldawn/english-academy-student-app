begin;

-- APP-20260927-02. Audio-only correction; immutable originals remain untouched.
create table private.pronunciation_audio_corrections_v1 (
  correction_id text primary key check(length(correction_id)>0),
  prior_identity_id text not null unique references public.vocab_pronunciation_identities_v2,
  prior_identity_sha256 text not null check(prior_identity_sha256 ~ '^[A-F0-9]{64}$'),
  headword text not null check(length(headword)>0),
  lexical_pos text not null check(length(lexical_pos)>0),
  locale text not null check(locale='en-US'),
  replacement_variant_id text not null check(replacement_variant_id ~ '^mw:[a-f0-9]{20}$'),
  replacement_sound_audio text not null check(replacement_sound_audio ~ '^[A-Za-z0-9_-]+$'),
  replacement_audio_url text not null check(
    replacement_audio_url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
    and right(replacement_audio_url,length(replacement_sound_audio)+5)='/'||replacement_sound_audio||'.mp3'),
  raw_source_sha256 text not null check(raw_source_sha256 ~ '^[a-f0-9]{64}$'),
  source_locator text not null check(length(source_locator)>0),
  review_sha256 text not null check(review_sha256 ~ '^[a-f0-9]{64}$'),
  approval_reason text not null check(length(approval_reason)>0),
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
alter table private.pronunciation_audio_corrections_v1 enable row level security;
revoke all on private.pronunciation_audio_corrections_v1 from public,anon,authenticated,service_role;

create function private.guard_pronunciation_audio_corrections_v1()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' or (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled')
  then raise exception 'audio_correction_immutable'; end if;
  return new;
end; $$;
revoke all on function private.guard_pronunciation_audio_corrections_v1() from public,anon,authenticated,service_role;
create trigger pronunciation_audio_corrections_immutable before update or delete
on private.pronunciation_audio_corrections_v1 for each row execute function private.guard_pronunciation_audio_corrections_v1();

create function public.list_pronunciation_audio_corrections_v1()
returns table(headword text,prior_variant_id text,prior_audio_key text,
  replacement_variant_id text,replacement_audio_url text)
language plpgsql stable security definer set search_path='' as $$
begin
  if (select count(*) from private.pronunciation_audio_corrections_v1 where enabled)>500
  then raise exception 'audio_correction_limit_exceeded'; end if;
  return query
  select c.headword,i.pronunciation_variant_id,
    '/storage/v1/object/public/'||i.storage_bucket||'/'||i.storage_object_key,
    c.replacement_variant_id,c.replacement_audio_url
  from private.pronunciation_audio_corrections_v1 c
  join public.vocab_pronunciation_identities_v2 i on i.identity_id=c.prior_identity_id
  where c.enabled and i.identity_content_sha256=c.prior_identity_sha256
    and i.headword=c.headword and i.lexical_pos=c.lexical_pos
    and i.audio_provider='google_cloud_text_to_speech'
    and i.playback_enabled and i.display_enabled
    and not exists (
      select 1 from public.vocab_pronunciation_identities_v2 other
      where other.pronunciation_variant_id=i.pronunciation_variant_id
        and other.storage_bucket=i.storage_bucket and other.storage_object_key=i.storage_object_key
        and (other.headword is distinct from i.headword or other.lexical_pos is distinct from i.lexical_pos)
    );
end; $$;
revoke all on function public.list_pronunciation_audio_corrections_v1() from public,anon,authenticated,service_role;
grant execute on function public.list_pronunciation_audio_corrections_v1() to service_role;
notify pgrst,'reload schema';
commit;
