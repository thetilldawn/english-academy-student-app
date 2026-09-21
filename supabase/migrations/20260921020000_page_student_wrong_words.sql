begin;

-- The same NFKC / trim / lower / stress-marker rule as normalizeQuizHeadword.
create function private.wrong_history_headword_v1(p_text text)
returns text language sql immutable set search_path = '' as $$
  select replace(lower(btrim(normalize(coalesce(p_text, ''), NFKC),
    U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')), '*', '');
$$;

create function private.wrong_history_identity_v1(
  p_dataset uuid, p_entry bigint, p_dictionary text, p_canonical uuid,
  p_headword text, p_review boolean
) returns text language sql immutable set search_path = '' as $$
  select case
    when nullif(p_dictionary, '') is not null then
      'dictionary:' || case when p_review then p_dataset::text || ':' else '' end || p_dictionary
    when p_canonical is not null then
      'canonical:' || case when p_review then p_dataset::text || ':' else '' end || p_canonical::text
    when private.wrong_history_headword_v1(p_headword) <> '' then
      'headword:' || p_dataset::text || ':' || private.wrong_history_headword_v1(p_headword)
    else 'entry:' || p_dataset::text || ':' || p_entry::text end;
$$;

create function public.get_admin_student_wrong_word_page_v1(
  p_student_id uuid,
  p_dataset_id uuid default null,
  p_level text default 'all',
  p_query text default '',
  p_event_upper_id bigint default null,
  p_after_wrong_at timestamptz default null,
  p_after_key text default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare upper_id bigint; result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null or p_level is null or p_level not in ('all','once','repeated')
    or p_query is null or length(p_query) > 200
    or p_event_upper_id < 0
    or (p_after_wrong_at is null) <> (p_after_key is null)
    or (p_after_wrong_at is not null and (not isfinite(p_after_wrong_at) or p_event_upper_id is null))
    or length(p_after_key) > 1000 then
    raise exception 'invalid_wrong_history_page' using errcode = '22023';
  end if;
  if not exists(select 1 from public.students where id = p_student_id and deleted_at is null) then
    return null;
  end if;
  select coalesce(p_event_upper_id, max(id), 0) into upper_id
    from public.student_vocab_wrong_events where student_id = p_student_id and wrong_stage = 'initial';

  with base as materialized (
    select ev.id, ev.quiz_attempt_id, ev.quiz_question_id, ev.dataset_id, ev.vocab_entry_id,
      ev.canonical_dictionary_id_snapshot as dictionary_id,
      ev.canonical_lexeme_id_snapshot as canonical_id, ev.wrong_at, q.retry_is_correct,
      private.wrong_history_identity_v1(ev.dataset_id, ev.vocab_entry_id,
        ev.canonical_dictionary_id_snapshot, ev.canonical_lexeme_id_snapshot,
        coalesce(e.headword_normalized,e.headword),false) as word_key,
      coalesce(nullif(concat_ws(' · ',nullif(d.title,''),nullif(d.edition,'')),''),'단어장') as dataset_label,
      coalesce(nullif(coalesce(case when exam.provenance_status = 'reviewed_for_preview_v1' then exam.headword_snapshot end,
        case when aq.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1','exam_reviewed_v1','composition_verified_v1') then aq.headword_snapshot end, qe.headword),''), e.headword) as headword,
      coalesce(nullif(coalesce(case when exam.provenance_status = 'reviewed_for_preview_v1' then exam.primary_meaning_snapshot end,
        case when aq.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1','exam_reviewed_v1','composition_verified_v1') then aq.primary_meaning_snapshot end, qe.primary_meaning),''), e.primary_meaning) as primary_meaning,
      coalesce(case when exam.provenance_status = 'reviewed_for_preview_v1' then exam.provenance_status end,
        aq.provenance_status,'legacy_backfill') as provenance_status
    from public.student_vocab_wrong_events ev
    join public.quiz_questions q on q.id = ev.quiz_question_id
    join public.vocab_entries e on e.id = ev.vocab_entry_id
    join public.vocab_entries qe on qe.id = q.vocab_entry_id
    left join public.vocab_datasets d on d.id = e.dataset_id
    left join public.assignment_questions aq on aq.id = q.assignment_question_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id
    where ev.student_id = p_student_id and ev.wrong_stage = 'initial' and ev.id <= upper_id
  ), first_group as materialized (
    select distinct on (word_key) word_key, dictionary_id, canonical_id from base order by word_key,id desc
  ), latest_group as materialized (
    select distinct on (word_key) word_key, quiz_attempt_id,quiz_question_id,dataset_id,vocab_entry_id,retry_is_correct
    from base order by word_key,wrong_at desc,id desc
  ), first_occurrence as materialized (
    select distinct on (word_key,vocab_entry_id) word_key,vocab_entry_id,id,headword,primary_meaning,provenance_status,dataset_label,dataset_id
    from base order by word_key,vocab_entry_id,id desc
  ), latest_occurrence as materialized (
    select distinct on (word_key,vocab_entry_id) word_key,vocab_entry_id,quiz_question_id,retry_is_correct,wrong_at
    from base order by word_key,vocab_entry_id,wrong_at desc,id desc
  ), occurrence_count as materialized (
    select word_key,vocab_entry_id,count(*)::integer as wrong_count from base group by word_key,vocab_entry_id
  ), pending as materialized (
    select queue.*,
      private.wrong_history_identity_v1(queue.dataset_id,queue.vocab_entry_id,
        queue.canonical_dictionary_id_snapshot,queue.canonical_lexeme_id_snapshot,e.headword_normalized,true) as review_key
    from public.student_vocab_review_queue_read_v1 queue
    left join public.vocab_entries e on e.id = queue.vocab_entry_id
    where queue.student_id = p_student_id and queue.status = 'pending'
  ), active as materialized (
    select a.id as assignment_id,a.title,link.assigned_at,
      private.wrong_history_identity_v1(a.dataset_id,aq.vocab_entry_id,
        exam.dictionary_id,aq.canonical_lexeme_id_snapshot,aq.headword_normalized_snapshot,true) as review_key
    from public.assignment_students link
    join public.assignments a on a.id = link.assignment_id and a.status <> 'closed'
    join public.assignment_questions aq on aq.assignment_id = a.id and aq.dataset_id = a.dataset_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id
    where link.student_id = p_student_id and link.cancelled_at is null and link.missed_at is null
      and (not exists(select 1 from public.quiz_attempts t where t.assignment_id = a.id and t.student_id = p_student_id)
        or exists(select 1 from public.quiz_attempts t where t.assignment_id = a.id and t.student_id = p_student_id and t.status = 'in_progress'))
  ), occurrences as materialized (
    select f.*, l.quiz_question_id, l.wrong_at,c.wrong_count,
      case when state.vocab_entry_id is not null
        then case when state.unresolved_wrong_count > 0 and state.resolved_at is null then 'unresolved' else 'resolved' end
        when l.retry_is_correct is true then 'resolved' else 'unresolved' end as resolution,
      assigned.assignment_id, assigned.title as assignment_title,assigned.assigned_at,
      exists(select 1 from pending p where p.review_key =
        private.wrong_history_identity_v1(f.dataset_id,f.vocab_entry_id,g.dictionary_id,g.canonical_id,f.headword,true)) as queued
    from first_occurrence f join latest_occurrence l using(word_key,vocab_entry_id)
    join occurrence_count c using(word_key,vocab_entry_id) join first_group g using(word_key)
    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id
    left join lateral (
      select a.* from active a where a.review_key =
        private.wrong_history_identity_v1(f.dataset_id,f.vocab_entry_id,g.dictionary_id,g.canonical_id,f.headword,true)
      order by a.assigned_at desc,a.assignment_id limit 1
    ) assigned on true
  ), states as materialized (
    select o.*,case when resolution='resolved' then 'none' when assignment_id is not null then 'assigned'
      when queued then 'queued' else 'available' end as scheduling from occurrences o
  ), grouped as materialized (
    select word_key,sum(wrong_count)::integer as wrong_count,max(wrong_at) as last_wrong_at,
      (array_agg(headword order by wrong_at desc,id desc))[1] as headword,
      (array_agg(primary_meaning order by wrong_at desc,id desc))[1] as primary_meaning,
      array_agg(distinct dataset_id) as datasets,
      string_agg(dataset_label,' ' order by wrong_at desc,id desc) as dataset_labels,
      case when bool_or(resolution='unresolved') then 'unresolved' else 'resolved' end as resolution,
      case when bool_or(scheduling='assigned') then 'assigned' when bool_or(scheduling='queued') then 'queued'
        when bool_or(resolution='unresolved') then 'available' else 'none' end as scheduling
    from states group by word_key
  ), filtered as materialized (
    select * from grouped where (p_dataset_id is null or p_dataset_id=any(datasets))
      and (p_level='all' or p_level='once' and wrong_count=1 or p_level='repeated' and wrong_count>=2)
      and strpos(lower(concat_ws(' ',headword,primary_meaning,dataset_labels)),lower(btrim(p_query)))>0
  ), page as materialized (
    select * from filtered where p_after_wrong_at is null
      or last_wrong_at < p_after_wrong_at or (last_wrong_at = p_after_wrong_at and word_key collate "C" > p_after_key collate "C")
    order by last_wrong_at desc,word_key collate "C" limit 11
  ), hydrated as (
    select p.last_wrong_at,p.word_key,jsonb_build_object(
      'key',p.word_key,'canonicalDictionaryId',g.dictionary_id,'canonicalLexemeId',g.canonical_id,
      'headword',p.headword,'primaryMeaning',p.primary_meaning,'wrongCount',p.wrong_count,
      'wrongLevel',case when p.wrong_count>=2 then 2 else 1 end,'lastWrongAt',p.last_wrong_at,
      'latestAttemptId',l.quiz_attempt_id,'latestQuestionId',l.quiz_question_id,'latestDatasetId',l.dataset_id,
      'latestVocabEntryId',l.vocab_entry_id,'latestOutcome',case when l.retry_is_correct is true then 'recovered_on_retry' when l.retry_is_correct is false then 'wrong_again' else 'retry_unanswered' end,
      'resolution',p.resolution,'scheduling',p.scheduling,
      'activeAssignment',(select jsonb_build_object('assignmentId',s.assignment_id,'title',s.assignment_title,'assignedAt',s.assigned_at)
        from states s where s.word_key=p.word_key and s.scheduling='assigned' order by s.wrong_at desc,s.id desc limit 1),
      'occurrences',(select jsonb_agg(jsonb_build_object(
        'datasetId',s.dataset_id,'vocabEntryId',s.vocab_entry_id,'latestQuestionId',s.quiz_question_id,
        'datasetLabel',s.dataset_label,'headword',s.headword,'primaryMeaning',s.primary_meaning,'provenanceStatus',s.provenance_status,
        'wrongCount',s.wrong_count,'lastWrongAt',s.wrong_at,'resolution',s.resolution,'scheduling',s.scheduling,
        'activeAssignment',case when s.assignment_id is null then null else jsonb_build_object('assignmentId',s.assignment_id,'title',s.assignment_title,'assignedAt',s.assigned_at) end
      ) order by s.wrong_at desc,s.id desc) from states s where s.word_key=p.word_key)
    ) as item from page p join first_group g using(word_key) join latest_group l using(word_key)
  ) select jsonb_build_object(
    'items',coalesce((select jsonb_agg(item order by last_wrong_at desc,word_key collate "C") from hydrated),'[]'::jsonb),
    'eventUpperId',upper_id::text,
    'totalCount',case when p_after_key is null then (select count(*) from filtered) else null end,
    'summary',case when p_after_key is null then (select jsonb_build_object(
      'wrongEventCount',coalesce(sum(wrong_count),0),
      'uniqueWordCount',count(*) filter(where resolution='unresolved'),
      'onceWrongWordCount',count(*) filter(where resolution='unresolved' and wrong_count=1),
      'repeatedWrongWordCount',count(*) filter(where resolution='unresolved' and wrong_count>=2),
      'pendingReviewCount',count(*) filter(where scheduling='queued')
    ) from grouped) else null end,
    'datasetOptions',case when p_after_key is null then coalesce((select jsonb_agg(jsonb_build_object('id',d.dataset_id,'label',d.dataset_label) order by d.dataset_label,d.dataset_id)
      from (select distinct dataset_id,dataset_label from first_occurrence) d),'[]'::jsonb) else null end,
    'reviewDrafts',case when p_after_key is null then coalesce((select jsonb_agg(jsonb_build_object('draftId',draft_id,'datasetId',dataset_id,'questionCount',question_count) order by draft_id)
      from (select active_review_draft_id as draft_id,dataset_id,count(*) as question_count from pending where active_review_draft_id is not null group by active_review_draft_id,dataset_id) d),'[]'::jsonb) else null end
  ) into result;
  return result;
end;
$$;

revoke all on function private.wrong_history_headword_v1(text) from public,anon,authenticated,service_role;
revoke all on function private.wrong_history_identity_v1(uuid,bigint,text,uuid,text,boolean) from public,anon,authenticated,service_role;
revoke all on function public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamptz,text) from public,anon,authenticated,service_role;
grant execute on function public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamptz,text) to authenticated;
commit;
