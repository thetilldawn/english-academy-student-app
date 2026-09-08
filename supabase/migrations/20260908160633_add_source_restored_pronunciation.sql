begin;

-- Source-restored and user-directed corrections are display-only overlays.
-- Original dictionary/PDF evidence is bound in the restoration manifest. The source hash for
-- this review type is the immutable pronunciation identity document hash,
-- not the MP3 byte hash. No content, audio, or student rows are written here.
create or replace function private.list_entry_approved_korean_pronunciations_v1(
  p_vocab_entry_ids bigint[]
) returns table(vocab_entry_id bigint, dictionary_id text, approval jsonb, identity jsonb)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids) > 500 or
     exists (select 1 from unnest(p_vocab_entry_ids) id where id is null or id <= 0) then
    raise exception 'entry_approved_input_invalid' using errcode = '22023';
  end if;
  return query
  with sources as (
    select e.id, o.dictionary_id, i.*,
           count(*) over (partition by e.id) as match_count
    from public.vocab_entries e
    join public.vocab_datasets d on d.id = e.dataset_id
    join word_index.app_exam_use_release er on er.dataset_id = d.id
      and er.status = 'active' and er.exam_use_import_allowed
      and lower(er.source_sha256) = lower(d.source_sha256)
    join word_index.app_exam_use_occurrence o on o.release_id = er.release_id
      and o.dataset_id = d.id and o.vocab_entry_id = e.id
      and o.source_row = e.source_row and o.include_in_exam
      and o.exam_use_status = 'reviewed_for_preview'
      and upper(o.source_projection_row_sha256) = upper(e.row_sha256)
      and o.display_headword = e.headword
    join public.vocab_pronunciation_releases_v2 pr on pr.dataset_id = d.id
      and pr.status = 'active' and lower(pr.dataset_source_sha256) = lower(d.source_sha256)
    join public.vocab_entry_pronunciation_bindings_v2 b on b.release_id = pr.release_id
      and b.dataset_id = d.id and b.vocab_entry_id = e.id and b.is_entry_default
      and b.source_row = e.source_row and upper(b.entry_row_sha256) = upper(e.row_sha256)
      and b.headword = e.headword and b.headword_normalized = e.headword_normalized
    join public.vocab_pronunciation_identities_v2 i on i.identity_id = b.identity_id
      and i.headword = b.headword and i.headword_normalized = b.headword_normalized
      and i.lexical_pos is not distinct from b.lexical_pos
      and i.playback_enabled and i.display_enabled
    where e.id = any(p_vocab_entry_ids)
  )
  select s.id, s.dictionary_id,
    jsonb_build_object('dictionary_id', a.dictionary_id,
      'pronunciation_variant_id', a.pronunciation_variant_id,
      'display_pronunciation_ko', a.display_pronunciation_ko, 'segments', a.segments,
      'review_status', a.review_status, 'source_review_run_id', a.source_review_run_id,
      'source_content_sha256', a.source_content_sha256),
    to_jsonb(s) - 'id' - 'dictionary_id' - 'match_count'
  from sources s
  join public.vocab_approved_korean_pronunciations a on a.dictionary_id = s.dictionary_id
    and a.pronunciation_variant_id = s.pronunciation_variant_id
    and a.source_content_sha256 = lower(s.identity_content_sha256)
    and (starts_with(a.source_review_run_id, 'user-directed:')
      or a.source_review_run_id ~ '^source-restored:[A-Za-z0-9][A-Za-z0-9:._/-]*$')
    and a.review_status = 'approved'
  where s.match_count = 1
  order by s.id;
end;
$$;
revoke all on function private.list_entry_approved_korean_pronunciations_v1(bigint[])
  from public, anon, authenticated, service_role;

create or replace function public.list_entry_approved_korean_pronunciations_v1(p_vocab_entry_ids bigint[])
returns table(vocab_entry_id bigint, dictionary_id text, approval jsonb, identity jsonb)
language sql stable security definer set search_path = '' as $$
  select * from private.list_entry_approved_korean_pronunciations_v1(p_vocab_entry_ids);
$$;
revoke all on function public.list_entry_approved_korean_pronunciations_v1(bigint[])
  from public, anon, authenticated;
grant execute on function public.list_entry_approved_korean_pronunciations_v1(bigint[]) to service_role;
notify pgrst, 'reload schema';
commit;
