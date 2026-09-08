begin;

-- Display-only, entry-scoped restoration. No source, audio or student rows are rewritten.
create table private.entry_source_pronunciations_v1 (
  vocab_entry_id bigint not null references public.vocab_entries(id),
  entry_row_sha256 text not null check (entry_row_sha256 ~ '^[0-9a-f]{64}$'),
  headword text not null check (headword = btrim(headword) and length(headword) between 1 and 200),
  lexical_pos text not null check (length(lexical_pos) between 1 and 100),
  source_kind text not null check (source_kind in ('identity','occurrence','registry')),
  identity_id text,
  identity_content_sha256 text,
  occurrence_release_id uuid,
  occurrence_content_hash text,
  registry_content_sha256 text,
  variant_id text not null,
  -- Official URL or host-independent public storage path; no project hostname in data.
  audio_key text not null check (length(audio_key) between 1 and 1024),
  display_ko text not null check (length(display_ko) between 1 and 200),
  segments jsonb not null,
  source_file_sha256 text not null check (source_file_sha256 ~ '^[0-9a-f]{64}$'),
  manifest_sha256 text not null check (manifest_sha256 ~ '^[0-9a-f]{64}$'),
  review_work text not null check (review_work ~ '^WORD-[0-9]{8}-[0-9]{2}$'),
  created_at timestamptz not null default now(),
  primary key (vocab_entry_id,entry_row_sha256,variant_id,audio_key),
  check (private.valid_korean_pronunciation_segments_v1(display_ko,segments)),
  check (jsonb_array_length(jsonb_path_query_array(segments,'$[*] ? (@.stress == "primary")'))=1),
  check (
    (source_kind='identity' and identity_id is not null and identity_content_sha256 is not null and identity_content_sha256 ~ '^[0-9a-f]{64}$'
      and occurrence_release_id is null and occurrence_content_hash is null and registry_content_sha256 is null)
    or (source_kind='occurrence' and identity_id is null and identity_content_sha256 is null
      and occurrence_release_id is not null and occurrence_content_hash is not null and occurrence_content_hash ~ '^[0-9a-f]{64}$' and registry_content_sha256 is null)
    or (source_kind='registry' and identity_id is null and identity_content_sha256 is null
      and occurrence_release_id is null and occurrence_content_hash is null and registry_content_sha256 is not null and registry_content_sha256 ~ '^[0-9a-f]{64}$')
  )
);
alter table private.entry_source_pronunciations_v1 enable row level security;
revoke all on private.entry_source_pronunciations_v1 from public,anon,authenticated,service_role;

create function public.list_entry_source_pronunciations_v1(p_vocab_entry_ids bigint[])
returns table(vocab_entry_id bigint,headword text,entry_row_sha256 text,variant_id text,
 audio_key text,display_ko text,segments jsonb,source_file_sha256 text,manifest_sha256 text)
language plpgsql stable security definer set search_path = '' as $$
begin
 if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400
    or exists(select 1 from unnest(p_vocab_entry_ids) id where id is null or id<1) then
   raise exception 'entry_source_input_invalid' using errcode='22023';
 end if;
 return query
 with requested as materialized (
   select s.* from private.entry_source_pronunciations_v1 s
   join public.vocab_entries e on e.id=s.vocab_entry_id and lower(e.row_sha256)=s.entry_row_sha256
     and e.headword=s.headword
   where s.vocab_entry_id=any(p_vocab_entry_ids)
 ), active as materialized (
   select * from public.list_active_vocab_pronunciation_bindings_v3(p_vocab_entry_ids)
 ), proven as (
   select s.* from requested s
   where s.source_kind='identity' and exists (
     select 1 from active a
     join public.vocab_pronunciation_identities_v2 i on i.identity_id=a.identity_id
     join public.vocab_entries e on e.id=a.vocab_entry_id
     where a.vocab_entry_id=s.vocab_entry_id and i.identity_id=s.identity_id
       and i.headword=s.headword and i.lexical_pos=s.lexical_pos
       and lower(i.identity_content_sha256)=s.identity_content_sha256
       and i.playback_enabled and i.display_enabled
       and i.display_source not in ('user_approved_100_identity_v1','user_approved_display_nucleus_projection_v2')
       and i.pronunciation_variant_id=s.variant_id
       and case when i.audio_provider='merriam_webster' then i.official_audio_url
         else '/storage/v1/object/public/'||i.storage_bucket||'/'||i.storage_object_key end = s.audio_key
       and (
         exists (select 1 from public.vocab_entry_pronunciation_bindings_v2 b
           join public.vocab_pronunciation_releases_v2 r on r.release_id=b.release_id and r.status='active'
           join public.vocab_datasets d on d.id=e.dataset_id and r.dataset_id=d.id
             and lower(r.dataset_source_sha256)=lower(d.source_sha256)
           where b.release_id=a.release_id and b.vocab_entry_id=e.id and b.identity_id=i.identity_id and b.is_entry_default
             and b.dataset_id=e.dataset_id and b.source_row=e.source_row
             and lower(b.entry_row_sha256)=s.entry_row_sha256 and b.headword=s.headword
             and b.headword_normalized=e.headword_normalized and b.lexical_pos=s.lexical_pos)
         or exists (select 1 from private.reviewed_exam_entries re
           join private.reviewed_exam_releases rr on rr.release_id=re.release_id
           where 'reviewed-exam:'||rr.release_id::text=a.release_id and re.vocab_entry_id=e.id
             and re.pronunciation_identity_id=i.identity_id and re.payload->>'headword'=s.headword
             and re.payload->>'lexical_pos'=s.lexical_pos and re.entry_sha256=s.entry_row_sha256
             and private.reviewed_exam_sha256_v1(re.payload-'entry_row_sha256')=re.entry_sha256
             and (rr.status='active' or exists(select 1 from public.assignment_questions aq
               where aq.reviewed_exam_release_id_snapshot=rr.release_id
                 and (aq.vocab_entry_id=e.id or e.id=any(aq.choice_vocab_entry_ids)))))
       )
   )
   union all
   select s.* from requested s
   where s.source_kind='occurrence' and exists (
     select 1 from word_index.app_exam_use_occurrence o
     join word_index.app_exam_use_release r on r.release_id=o.release_id
     join public.vocab_entries e on e.id=o.vocab_entry_id
     join public.vocab_datasets d on d.id=e.dataset_id
     where o.vocab_entry_id=s.vocab_entry_id and o.release_id=s.occurrence_release_id
       and o.dataset_id=e.dataset_id and o.source_row=e.source_row
       and lower(o.source_projection_row_sha256)=s.entry_row_sha256 and o.display_headword=s.headword
       and r.dataset_id=e.dataset_id and lower(r.source_sha256)=lower(d.source_sha256)
       and r.exam_use_import_allowed and o.include_in_exam and o.exam_use_status='reviewed_for_preview'
       and (r.status='active' or exists(select 1 from public.assignment_question_exam_use_snapshot aq
          where aq.release_id=r.release_id and aq.occurrence_id=o.occurrence_id))
       and o.occurrence_content_hash=s.occurrence_content_hash and o.listening_enabled
       and o.audio_json->>'variant_pos'=s.lexical_pos
       and o.pronunciation_variant_id=s.variant_id and o.audio_url=s.audio_key
       and not exists(select 1 from public.vocab_approved_korean_pronunciations ap
          where ap.dictionary_id=o.dictionary_id and ap.pronunciation_variant_id=s.variant_id and ap.review_status='approved')
   )
   union all
   select s.* from requested s
   where s.source_kind='registry' and exists (
     select 1 from public.vocab_entry_pronunciations p
     where p.vocab_entry_id=s.vocab_entry_id and lower(p.entry_row_sha256)=s.entry_row_sha256
       and p.headword_normalized=lower(s.headword) and p.selected_pos=s.lexical_pos
       and lower(p.content_sha256)=s.registry_content_sha256 and p.listening_enabled
       and p.selected_variant_id=s.variant_id and p.selected_audio_url=s.audio_key
       and exists(select 1 from jsonb_array_elements(p.variants) v
         where v->>'variant_id'=s.variant_id and v->>'audio_url'=s.audio_key and v->>'pos'=s.lexical_pos)
       and not exists(select 1 from word_index.app_exam_use_occurrence o
         join public.vocab_approved_korean_pronunciations ap on ap.dictionary_id=o.dictionary_id
           and ap.pronunciation_variant_id=s.variant_id and ap.review_status='approved'
         where o.vocab_entry_id=s.vocab_entry_id)
   )
 )
 select s.vocab_entry_id,s.headword,s.entry_row_sha256,s.variant_id,s.audio_key,
        s.display_ko,s.segments,s.source_file_sha256,s.manifest_sha256
 from proven s order by s.vocab_entry_id,s.variant_id,s.audio_key;
end;
$$;
revoke all on function public.list_entry_source_pronunciations_v1(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.list_entry_source_pronunciations_v1(bigint[]) to service_role;
notify pgrst,'reload schema';
commit;
