begin;

-- One aggregation for up to 500 selected keys; the existing read delegates to this core.
create function private.wrong_word_notebook_page_v3(
  p_student_id uuid,
  p_dataset_id uuid default null,
  p_level text default 'all',
  p_query text default '',
  p_event_upper_id bigint default null,
  p_after_wrong_at timestamptz default null,
  p_after_key text default null,
  p_min_wrong_count integer default null,
  p_max_wrong_count integer default null,
  p_order text default 'count',
  p_after_wrong_count integer default null,
  p_word_key text default null,
  p_page_size integer default 11,
  p_word_keys text[] default null
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare upper_id bigint; result jsonb;
begin
  if p_order is null or p_order not in ('count','recent') or p_page_size is null or p_page_size < 1 or p_page_size > 501
    or p_after_wrong_count < 1 or length(p_word_key) > 1000
    or (p_order = 'count' and (p_after_key is null) <> (p_after_wrong_count is null))
    or p_student_id is null or p_level is null or p_level not in ('all','once','repeated')
    or p_query is null or length(p_query) > 200
    or p_min_wrong_count < 1 or p_max_wrong_count < 1
    or p_min_wrong_count > p_max_wrong_count
    or (p_level <> 'all' and (p_min_wrong_count is not null or p_max_wrong_count is not null))
    or p_event_upper_id < 0
    or (p_after_wrong_at is null) <> (p_after_key is null)
    or (p_after_wrong_at is not null and (not isfinite(p_after_wrong_at) or p_event_upper_id is null))
    or length(p_after_key) > 1000
    or (p_word_keys is not null and (cardinality(p_word_keys) not between 1 and 500
      or exists(select 1 from unnest(p_word_keys) k where k is null or length(k) not between 1 and 1000)
      or (select count(distinct k) from unnest(p_word_keys) k) <> cardinality(p_word_keys))) then
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
        saved.headword,false) as word_key,
      coalesce(nullif(concat_ws(' · ',nullif(d.title,''),nullif(d.edition,'')),''),'단어장') as dataset_label,
      saved.headword, saved.primary_meaning,
      coalesce(case when exam.provenance_status = 'reviewed_for_preview_v1' then exam.provenance_status end,
        aq.provenance_status,'legacy_backfill') as provenance_status
    from public.student_vocab_wrong_events ev
    join public.quiz_questions q on q.id = ev.quiz_question_id
    join public.vocab_entries e on e.id = ev.vocab_entry_id
    join public.vocab_entries qe on qe.id = q.vocab_entry_id
    left join public.vocab_datasets d on d.id = e.dataset_id
    left join public.assignment_questions aq on aq.id = q.assignment_question_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id
    cross join lateral (select
      coalesce(nullif(case when exam.provenance_status='reviewed_for_preview_v1' then exam.headword_snapshot end,''),
        nullif(aq.headword_snapshot,''),nullif(case when q.direction='english_to_korean' then q.prompt else q.choices->>q.correct_choice_index end,''),qe.headword,e.headword) as headword,
      coalesce(nullif(case when exam.provenance_status='reviewed_for_preview_v1' then exam.primary_meaning_snapshot end,''),
        nullif(aq.primary_meaning_snapshot,''),nullif(case when coalesce(aq.eligibility_quiz_mode,'book_meaning_choice')='book_meaning_choice'
          then case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end end,''),qe.primary_meaning,e.primary_meaning) as primary_meaning
    ) saved
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
    select * from grouped where (p_word_key is null or word_key = p_word_key)
      and (p_word_keys is null or word_key = any(p_word_keys))
      and (p_dataset_id is null or p_dataset_id=any(datasets))
      and (p_level='all' or p_level='once' and wrong_count=1 or p_level='repeated' and wrong_count>=2)
      and (p_min_wrong_count is null or wrong_count >= p_min_wrong_count)
      and (p_max_wrong_count is null or wrong_count <= p_max_wrong_count)
      and strpos(lower(concat_ws(' ',headword,primary_meaning,dataset_labels)),lower(btrim(p_query)))>0
  ), page as materialized (
    select * from filtered where p_after_wrong_at is null
      or (p_order='count' and wrong_count < p_after_wrong_count)
      or ((p_order='recent' or wrong_count = p_after_wrong_count) and
        (last_wrong_at < p_after_wrong_at or (last_wrong_at = p_after_wrong_at and word_key collate "C" > p_after_key collate "C")))
    order by case when p_order='count' then wrong_count end desc,last_wrong_at desc,word_key collate "C" limit p_page_size
  ), hydrated as (
    select p.wrong_count,p.last_wrong_at,p.word_key,jsonb_build_object(
      'key',p.word_key,'canonicalDictionaryId',g.dictionary_id,'canonicalLexemeId',g.canonical_id,
      'headword',p.headword,'primaryMeaning',p.primary_meaning,'wrongCount',p.wrong_count,
      'wrongLevel',case when p.wrong_count>=2 then 2 else 1 end,'lastWrongAt',p.last_wrong_at,
      'latestAttemptId',l.quiz_attempt_id,'latestQuestionId',l.quiz_question_id,'latestDatasetId',l.dataset_id,
      'studySource',(select jsonb_build_object(
        'entryId',e.id,'currentHeadword',e.headword,'snapshotDisplayKo',s.display_pronunciation_ko_snapshot,
        'dictionaryId',coalesce(s.dictionary_id,g.dictionary_id),
        'releaseId',coalesce(s.release_id,r.exam_use_release_id),
        'displayKo',coalesce(s.display_pronunciation_ko_snapshot,e.pronunciation_ko),
        'pronunciationSnapshot',s.pronunciation_snapshot,
        'compositionPronunciation',aq.composition_pronunciation_snapshot->'target',
        'definition',case when aq.provenance_status='composition_verified_v1' then composition.resources#>>'{selected,definitionEn}'
          when aq.provenance_status='exam_reviewed_v1' and aq.eligibility_quiz_mode in ('canonical_definition_to_headword','canonical_headword_to_definition') then reviewed.payload->>'english_definition'
          when aq.eligibility_quiz_mode='canonical_definition_to_headword' then aq.prompt else null end,
        'example',case when aq.provenance_status='composition_verified_v1' then composition.resources#>>'{selected,exampleEn}' else x.example_en end,
        'exampleKo',case when aq.provenance_status='composition_verified_v1' then composition.resources#>>'{selected,exampleKo}' else null end
      )
      from public.quiz_questions q join public.vocab_entries e on e.id=q.vocab_entry_id
      left join public.assignment_questions aq on aq.id=q.assignment_question_id
      left join private.reviewed_exam_entries reviewed on reviewed.release_id=aq.reviewed_exam_release_id_snapshot
        and reviewed.vocab_entry_id=aq.vocab_entry_id and upper(reviewed.entry_sha256)=aq.entry_row_sha256_snapshot
      left join public.assignment_question_exam_use_snapshot s on s.assignment_question_id=aq.id and s.provenance_status='reviewed_for_preview_v1'
      left join word_index.app_canonical_question_preview_release r on r.release_id=aq.canonical_question_release_id_snapshot
      left join word_index.app_canonical_question_preview_item source on source.release_id=aq.canonical_question_release_id_snapshot
        and source.vocab_entry_id=aq.vocab_entry_id and source.quiz_mode=aq.eligibility_quiz_mode
        and source.question_item_id=aq.canonical_question_item_id_snapshot and source.question_item_sha256=aq.canonical_question_item_sha256_snapshot
      left join private.assignment_study_examples_v1 x on x.release_id=source.release_id and x.vocab_entry_id=source.vocab_entry_id
        and x.question_item_id=source.question_item_id and x.question_item_sha256=source.question_item_sha256
        and x.source_example_sha256=source.source_example_content_hash
      left join private.vocabulary_composition_entries composition on composition.version_id=aq.composition_version_id_snapshot and composition.vocab_entry_id=aq.vocab_entry_id
      where q.id=l.quiz_question_id),
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
    'items',coalesce((select jsonb_agg(item order by case when p_order='count' then wrong_count end desc,last_wrong_at desc,word_key collate "C") from hydrated),'[]'::jsonb),
    'eventUpperId',upper_id::text,
    'totalCount',case when p_after_key is null then (select count(*) from filtered) else null end,
    'notebookSummary',case when p_after_key is null then (select jsonb_build_object(
      'wordCount',count(*),'wrongEventCount',coalesce(sum(wrong_count),0),
      'repeatedWordCount',count(*) filter(where wrong_count>=2)
    ) from grouped) else null end,
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

-- Existing callers retain their exact signature, defaults and response shape.
create or replace function private.wrong_word_notebook_page_v2(
  p_student_id uuid, p_dataset_id uuid default null, p_level text default 'all', p_query text default '',
  p_event_upper_id bigint default null, p_after_wrong_at timestamptz default null, p_after_key text default null,
  p_min_wrong_count integer default null, p_max_wrong_count integer default null,
  p_order text default 'count', p_after_wrong_count integer default null, p_word_key text default null,
  p_page_size integer default 11
) returns jsonb language sql stable security invoker set search_path='' as $$
  select private.wrong_word_notebook_page_v3(p_student_id,p_dataset_id,p_level,p_query,p_event_upper_id,
    p_after_wrong_at,p_after_key,p_min_wrong_count,p_max_wrong_count,p_order,p_after_wrong_count,p_word_key,p_page_size,null);
$$;
revoke all on function private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer,text,integer,text,integer,text[]) from public,anon,authenticated,service_role;

-- Deliberately independent of assignments, quiz_attempts, wrong events and points.
create table private.student_word_practice_runs (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students(id),
  request_key uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  source_hash text not null check(source_hash ~ '^[a-f0-9]{64}$'),
  selection jsonb not null,
  settings jsonb not null,
  status text not null default 'in_progress' check(status in('in_progress','completed','expired')),
  question_count integer not null check(question_count between 1 and 500),
  current_ordinal integer not null default 1,
  started_at timestamptz not null default clock_timestamp(),
  deadline_at timestamptz not null,
  current_starts_at timestamptz not null default clock_timestamp(),
  feedback_pending boolean not null default false,
  finished_at timestamptz,
  unique(student_id,request_key)
);
create index student_word_practice_history on private.student_word_practice_runs(student_id,started_at desc,id desc);
create table private.student_word_practice_questions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references private.student_word_practice_runs(id),
  ordinal integer not null,
  body jsonb not null check(jsonb_typeof(body)='object'),
  selected_index integer check(selected_index between 0 and 3),
  is_correct boolean,
  timed_out boolean not null default false,
  answered_at timestamptz,
  receipt jsonb,
  unique(run_id,ordinal)
);
alter table private.student_word_practice_runs enable row level security;
alter table private.student_word_practice_questions enable row level security;
revoke all on private.student_word_practice_runs,private.student_word_practice_questions from public,anon,authenticated,service_role;

create function private.assert_word_practice_student_v1(p_student_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'practice_student_unavailable' using errcode='42501'; end if;
end;
$$;

-- Private server source, never returned to the student's browser. The event
-- upper bound is fixed while all pages are read; no first-page truncation.
create function private.word_practice_source_v1(p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  filters jsonb; keys jsonb; page jsonb; words jsonb:='[]'; selected_words jsonb; candidates jsonb;
  upper_id bigint; after_at timestamptz; after_key text; after_count integer; last_row jsonb;
  dataset_ids uuid[]; candidate_count integer;
begin
  perform private.assert_word_practice_student_v1(p_student_id);
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection->>'mode' is null or p_selection->>'mode' not in('selected','filtered')
    then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
  filters:=coalesce(p_selection->'filters','{}'); keys:=p_selection->'keys';
  if p_selection->>'mode'='selected' then
    if jsonb_typeof(keys) is distinct from 'array' or jsonb_array_length(keys) not between 1 and 500
      or exists(select 1 from jsonb_array_elements(keys) x where jsonb_typeof(x)<>'string' or length(x#>>'{}')>1000)
      or (select count(distinct x) from jsonb_array_elements(keys) x)<>jsonb_array_length(keys)
      then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
    page:=private.wrong_word_notebook_page_v3(p_student_id,p_page_size=>501,
      p_word_keys=>array(select jsonb_array_elements_text(keys)));
    words:=page->'items';
  else
   loop
    page:=private.wrong_word_notebook_page_v2(p_student_id,nullif(filters->>'datasetId','')::uuid,
      coalesce(filters->>'level','all'),coalesce(filters->>'query',''),upper_id,after_at,after_key,
      (filters->>'minWrongCount')::integer,(filters->>'maxWrongCount')::integer,'count',after_count,null,501);
    if upper_id is null and (page->>'totalCount')::integer>10000 then
      raise exception 'practice_range_too_large' using errcode='22023'; end if;
    upper_id:=(page->>'eventUpperId')::bigint;
    words:=words||(page->'items');
    exit when jsonb_array_length(page->'items')<501;
    last_row:=(page->'items')->-1;
    after_at:=(last_row->>'lastWrongAt')::timestamptz; after_key:=last_row->>'key'; after_count:=(last_row->>'wrongCount')::integer;
   end loop;
  end if;
  select coalesce(jsonb_agg(w order by w->>'key'),'[]') into selected_words from jsonb_array_elements(words) w
    where p_selection->>'mode'='filtered' or keys ? (w->>'key');
  if p_selection->>'mode'='selected' and jsonb_array_length(selected_words)<>jsonb_array_length(keys)
    then raise exception 'practice_source_changed' using errcode='40001'; end if;
  select array_agg(distinct (w->>'latestDatasetId')::uuid) into dataset_ids from jsonb_array_elements(selected_words) w;
  select count(*) into candidate_count from public.vocab_entries e where e.dataset_id=any(dataset_ids);
  if candidate_count>20000 then raise exception 'practice_range_too_large' using errcode='22023'; end if;
  -- Same reviewed eligibility as regular meaning-choice generation. Do not
  -- call the administrator-only RPC with a student's service session.
  with eligible as (
    select e.id,e.dataset_id,e.headword,e.primary_meaning,e.pronunciation_ko,
      array(select distinct direction from (
        select case q.quiz_mode when 'book_meaning_en_to_ko' then 'english_to_korean' else 'korean_to_english' end direction
          from public.vocab_entry_quiz_eligibility q where q.vocab_entry_id=e.id and q.quiz_mode in('book_meaning_en_to_ko','book_meaning_ko_to_en')
          and (q.status='eligible' or q.status='review_required' and cardinality(q.reason_codes)>0
            and q.reason_codes <@ array['DUPLICATE_HEADWORD_DIFFERENT_MEANING','DUPLICATE_PRIMARY_MEANING_DIFFERENT_HEADWORD']::text[])
        union select unnest(array['english_to_korean','korean_to_english']) from word_index.app_exam_use_occurrence o
          join word_index.app_exam_use_release r on r.release_id=o.release_id and r.dataset_id=o.dataset_id
          where o.vocab_entry_id=e.id and r.status='active' and r.target_environment='preview' and r.exam_use_import_allowed
          and not r.common_dictionary_release_allowed and o.include_in_exam and o.exam_use_status='reviewed_for_preview'
        union select unnest(c.eligible_directions) from private.vocabulary_composition_entries c where c.vocab_entry_id=e.id
      ) directions order by direction) as directions
    from public.vocab_entries e where e.dataset_id=any(dataset_ids)
  ) select coalesce(jsonb_agg(jsonb_build_object('entryId',id,'datasetId',dataset_id,'headword',headword,'primaryMeaning',primary_meaning,
      'displayKo',pronunciation_ko,'eligibleDirections',directions,'choiceSafety',private.vocabulary_entry_choice_safety_v1(id)) order by id),'[]')
    into candidates from eligible where cardinality(directions)>0;
  select coalesce(jsonb_agg(w||jsonb_build_object('choiceSafety',private.vocabulary_entry_choice_safety_v1((w->>'latestVocabEntryId')::bigint)) order by w->>'key'),'[]')
    into selected_words from jsonb_array_elements(selected_words) w;
  return jsonb_build_object('words',selected_words,'candidates',candidates);
end;
$$;

create function public.prepare_student_word_practice_v1(p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  source:=private.word_practice_source_v1(p_student_id,p_selection);
  return source||jsonb_build_object('sourceHash',encode(extensions.digest(source::text,'sha256'),'hex'));
end;
$$;

create function private.word_practice_timer_v1(p_run private.student_word_practice_runs)
returns timestamptz language sql immutable set search_path='' as $$
  select case p_run.settings->>'timingMode' when 'none' then 'infinity'::timestamptz
    when 'per_question' then least(p_run.deadline_at,p_run.current_starts_at+make_interval(secs=>(p_run.settings->>'questionTimeLimitSeconds')::integer))
    else p_run.deadline_at end;
$$;
create function private.word_practice_milliseconds_v1(p_until timestamptz,p_now timestamptz)
returns integer language sql immutable set search_path='' as $$
  select case when isfinite(p_until) then greatest(0,floor(extract(epoch from p_until-p_now)*1000))::integer else 0 end;
$$;

create function private.word_practice_read_v1(p_run private.student_word_practice_runs)
returns jsonb language plpgsql security definer set search_path='' as $$
declare at_time timestamptz:=clock_timestamp(); finished boolean; state text; questions jsonb; next_id uuid; deadline timestamptz;
begin
  finished:=p_run.status<>'in_progress' or at_time>=p_run.deadline_at;
  state:=case when p_run.status='in_progress' and finished then 'expired' else p_run.status end;
  deadline:=private.word_practice_timer_v1(p_run);
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'orderIndex',q.ordinal,
    'direction',q.body->>'direction','prompt',q.body->>'prompt','choices',q.body->'choices',
    'pronunciation',case when q.body->>'direction'='english_to_korean' or q.answered_at is not null or finished then q.body->'pronunciation'
      else jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false) end,
    'choicePronunciations',case when q.body->>'direction'='korean_to_english' then q.body->'choicePronunciations'
      else jsonb_build_array(jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false),
        jsonb_build_object('displayKo',null,'variantId',null,'audioUrl',null,'available',false)) end,
    'initialChoiceIndex',q.selected_index,'initialIsCorrect',q.is_correct,'initialTimedOut',q.timed_out,
    'retryChoiceIndex',null,'retryIsCorrect',null,'retryTimedOut',false,'priorWrongLevel',0,
    'revealedCorrectChoiceIndex',case when q.answered_at is not null or finished then (q.body->>'correctChoiceIndex')::integer end) order by q.ordinal),'[]')
    into questions from private.student_word_practice_questions q where q.run_id=p_run.id;
  select id into next_id from private.student_word_practice_questions where run_id=p_run.id and ordinal=p_run.current_ordinal and not finished;
  return jsonb_build_object('attempt',jsonb_build_object('id',p_run.id,'assignmentTitle','내 단어장 연습','quizContentMode','book_meaning_choice',
    'status',state,'phase',case when finished then 'completed' else 'initial' end,'startedAt',p_run.started_at,
    'deadlineAt',p_run.deadline_at,'timerDeadlineAt',deadline,'timingMode',p_run.settings->>'timingMode',
    'questionTimeLimitSeconds',p_run.settings->'questionTimeLimitSeconds','questions',questions,'currentQuestionId',next_id),
    'timerRemainingMilliseconds',private.word_practice_milliseconds_v1(deadline,at_time),
    'transitionRemainingMilliseconds',least(7250,private.word_practice_milliseconds_v1(p_run.current_starts_at,at_time)));
end;
$$;

create function public.get_student_word_practice_v1(p_student_id uuid,p_run_id uuid default null,p_request_key uuid default null,p_request_hash text default null,
  p_before_started_at timestamptz default null,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run private.student_word_practice_runs;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform private.assert_word_practice_student_v1(p_student_id);
  if (p_before_started_at is null)<>(p_before_id is null) or p_before_started_at is not null and not isfinite(p_before_started_at)
    then raise exception 'invalid_practice_cursor' using errcode='22023'; end if;
  if p_run_id is null and p_request_key is null then
    return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'startedAt',r.started_at,'finishedAt',r.finished_at,'questionCount',r.question_count,
      'status',case when r.status='in_progress' and statement_timestamp()>=r.deadline_at then 'expired' else r.status end,
      'correctCount',(select count(*) from private.student_word_practice_questions q where q.run_id=r.id and q.is_correct)) order by r.started_at desc,r.id desc)
      from (select * from private.student_word_practice_runs where student_id=p_student_id
        and (p_before_started_at is null or (started_at,id)<(p_before_started_at,p_before_id))
        order by started_at desc,id desc limit 11) r),'[]');
  end if;
  select * into run from private.student_word_practice_runs where student_id=p_student_id
    and (p_run_id is null or id=p_run_id) and (p_request_key is null or request_key=p_request_key);
  if not found then return null; end if;
  if p_request_key is not null and run.request_hash is distinct from p_request_hash then raise exception 'practice_request_conflict' using errcode='40001'; end if;
  return private.word_practice_read_v1(run);
end;
$$;

create function public.start_student_word_practice_v1(p_student_id uuid,p_request_key uuid,p_request_hash text,p_selection jsonb,p_settings jsonb,p_source_hash text,p_questions jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run private.student_word_practice_runs; source jsonb; item jsonb; word jsonb; choice jsonb; at_time timestamptz:=clock_timestamp(); ordinal integer:=0;
  count_requested integer; ratio integer; mode text; total_seconds integer; per_seconds integer; direction text; correct integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform private.assert_word_practice_student_v1(p_student_id);
  if p_request_key is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'invalid_practice_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||':'||p_request_key::text,913));
  select * into run from private.student_word_practice_runs where student_id=p_student_id and request_key=p_request_key;
  if found then
    if run.request_hash<>p_request_hash then raise exception 'practice_request_conflict' using errcode='40001'; end if;
    return private.word_practice_read_v1(run);
  end if;
  count_requested:=(p_settings->>'questionCount')::integer;ratio:=(p_settings->>'englishToKoreanRatio')::integer;
  mode:=p_settings->>'timingMode';total_seconds:=(p_settings->>'timeLimitSeconds')::integer;per_seconds:=(p_settings->>'questionTimeLimitSeconds')::integer;
  if count_requested is null or count_requested not between 1 and 500 or ratio is null or ratio not in(0,50,100)
    or mode is null or mode not in('none','total','per_question')
    or mode='total' and (total_seconds is null or total_seconds not between 30 and 10800)
    or mode='per_question' and (per_seconds is null or per_seconds not between 5 and 600)
    or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)<>count_requested
    then raise exception 'invalid_practice_settings' using errcode='22023'; end if;
  source:=private.word_practice_source_v1(p_student_id,p_selection);
  if encode(extensions.digest(source::text,'sha256'),'hex') is distinct from p_source_hash then raise exception 'practice_source_changed' using errcode='40001'; end if;
  if (select count(distinct q->>'wordKey') from jsonb_array_elements(p_questions) q)<>count_requested
    or (select count(*) from jsonb_array_elements(p_questions) q where q->>'direction'='english_to_korean')<>round(count_requested*ratio/100.0)
    then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    select w into word from jsonb_array_elements(source->'words') w where w->>'key'=item->>'wordKey';
    direction:=item->>'direction';correct:=(item->>'correctChoiceIndex')::integer;
    if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=word->>'latestVocabEntryId'
      and c->>'headword'=word->>'headword' and c->'eligibleDirections' ? direction)
      then raise exception 'practice_target_not_eligible' using errcode='22023'; end if;
    if word is null or direction is null or direction not in('english_to_korean','korean_to_english') or correct is null or correct not between 0 and 3
      or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_array_length(item->'choices')<>4
      or jsonb_typeof(item->'choiceSources') is distinct from 'array' or jsonb_array_length(item->'choiceSources')<>4
      or jsonb_typeof(item->'choicePronunciations') is distinct from 'array' or jsonb_array_length(item->'choicePronunciations')<>4
      or jsonb_typeof(item->'pronunciation') is distinct from 'object'
      or item->>'prompt' is distinct from (case direction when 'english_to_korean' then word->>'headword' else word->>'primaryMeaning' end)
      or item->'choices'->>correct is distinct from (case direction when 'english_to_korean' then word->>'primaryMeaning' else word->>'headword' end)
      or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'choices') v)<>4
      then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    perform private.assert_reviewed_choice_texts_v1(nullif(word->'choiceSafety','null'),direction,item->'choices',correct);
    for choice in select value||jsonb_build_object('index',n-1) from jsonb_array_elements(item->'choiceSources') with ordinality c(value,n) loop
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->'eligibleDirections' ? direction)
        then raise exception 'practice_choice_not_eligible' using errcode='22023'; end if;
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->>'primaryMeaning'=choice->>'primaryMeaning')
        and not exists(select 1 from jsonb_array_elements(source->'words') w where w->>'latestVocabEntryId'=choice->>'entryId'
          and w->>'headword'=choice->>'headword' and w->>'primaryMeaning'=choice->>'primaryMeaning')
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
      if item->'choices'->>((choice->>'index')::integer) is distinct from (case direction when 'english_to_korean' then choice->>'primaryMeaning' else choice->>'headword' end)
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
    end loop;
  end loop;
  at_time:=clock_timestamp();
  insert into private.student_word_practice_runs(student_id,request_key,request_hash,source_hash,selection,settings,question_count,started_at,current_starts_at,deadline_at)
    values(p_student_id,p_request_key,p_request_hash,p_source_hash,p_selection,p_settings,count_requested,at_time,at_time,
      case mode when 'none' then 'infinity'::timestamptz when 'total' then at_time+make_interval(secs=>total_seconds) else at_time+interval '3 hours' end) returning * into run;
  for item in select value from jsonb_array_elements(p_questions) loop
    ordinal:=ordinal+1;
    insert into private.student_word_practice_questions(run_id,ordinal,body) values(run.id,ordinal,item);
  end loop;
  return private.word_practice_read_v1(run);
end;
$$;

create function public.answer_student_word_practice_v1(p_student_id uuid,p_run_id uuid,p_question_id uuid,p_choice_index integer default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run private.student_word_practice_runs; q private.student_word_practice_questions; at_time timestamptz; deadline timestamptz; expired_question boolean; result jsonb; next_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform private.assert_word_practice_student_v1(p_student_id);
  if p_choice_index not between 0 and 3 then raise exception 'invalid_practice_answer' using errcode='22023'; end if;
  select * into run from private.student_word_practice_runs where id=p_run_id and student_id=p_student_id for update;
  if not found then raise exception 'practice_not_found' using errcode='P0002'; end if;
  select * into q from private.student_word_practice_questions where id=p_question_id and run_id=run.id;
  if not found then raise exception 'practice_not_found' using errcode='P0002'; end if;
  if q.answered_at is not null then
    if q.selected_index is distinct from p_choice_index then raise exception 'practice_answer_conflict' using errcode='40001'; end if;
    if q.ordinal<>run.current_ordinal-1 then raise exception 'practice_answer_outdated' using errcode='40001'; end if;
    return q.receipt;
  end if;
  at_time:=clock_timestamp();
  if run.status<>'in_progress' then raise exception 'practice_already_finished' using errcode='40001'; end if;
  if at_time>=run.deadline_at then
    update private.student_word_practice_runs set status='expired',finished_at=at_time where id=run.id;
    return jsonb_build_object('expired',true,'completed',true);
  end if;
  if q.ordinal<>run.current_ordinal or at_time<run.current_starts_at then raise exception 'practice_question_not_ready' using errcode='40001'; end if;
  deadline:=private.word_practice_timer_v1(run);
  expired_question:=at_time>=deadline+case when p_choice_index is null then interval '0' else interval '250 milliseconds' end;
  if p_choice_index is null and not expired_question then raise exception 'practice_timeout_too_early' using errcode='40001'; end if;
  q.is_correct:=not expired_question and p_choice_index=(q.body->>'correctChoiceIndex')::integer;
  if q.is_correct is null then q.is_correct:=false; end if;
  if q.ordinal=run.question_count then
    run.status:='completed';run.finished_at:=at_time;run.current_ordinal:=run.current_ordinal+1;
  else
    run.current_ordinal:=run.current_ordinal+1;run.current_starts_at:=at_time+interval '7 seconds';run.feedback_pending:=true;
    if run.settings->>'timingMode'='total' then run.deadline_at:=run.deadline_at+interval '7 seconds'; end if;
    select id into next_id from private.student_word_practice_questions where run_id=run.id and ordinal=run.current_ordinal;
  end if;
  update private.student_word_practice_runs set status=run.status,finished_at=run.finished_at,current_ordinal=run.current_ordinal,
    current_starts_at=run.current_starts_at,feedback_pending=run.feedback_pending,deadline_at=run.deadline_at where id=run.id;
  deadline:=private.word_practice_timer_v1(run);
  result:=jsonb_build_object('correct',q.is_correct,'correctChoiceIndex',(q.body->>'correctChoiceIndex')::integer,
    'completed',run.status='completed','needsRetry',false,'expired',false,'timedOut',expired_question,
    'initialAnsweredCount',q.ordinal,'initialQuestionCount',run.question_count,'retryAnsweredCount',0,'retryQuestionCount',0,
    'nextQuestionId',next_id,'nextPhase',case when next_id is not null then 'initial' end,
    'questionDeadlineAt',deadline,'timerRemainingMilliseconds',private.word_practice_milliseconds_v1(deadline,at_time),'feedbackProtocol','variable');
  update private.student_word_practice_questions set selected_index=p_choice_index,is_correct=q.is_correct,timed_out=expired_question,
    answered_at=at_time,receipt=result where id=q.id;
  return result;
end;
$$;

create function public.resume_student_word_practice_v1(p_student_id uuid,p_run_id uuid,p_question_id uuid,p_transition_ms integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run private.student_word_practice_runs; at_time timestamptz; old_start timestamptz; deadline timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform private.assert_word_practice_student_v1(p_student_id);
  if p_transition_ms is null or p_transition_ms not between 0 and 750 then raise exception 'invalid_practice_transition' using errcode='22023'; end if;
  select * into run from private.student_word_practice_runs where id=p_run_id and student_id=p_student_id for update;
  if not found then raise exception 'practice_not_found' using errcode='P0002'; end if;
  at_time:=clock_timestamp();
  if run.status<>'in_progress' or at_time>=run.deadline_at or not exists(select 1 from private.student_word_practice_questions where id=p_question_id and run_id=run.id and ordinal=run.current_ordinal)
    then raise exception 'practice_question_not_ready' using errcode='40001'; end if;
  if run.feedback_pending then
    old_start:=run.current_starts_at; run.current_starts_at:=least(old_start,at_time+make_interval(secs=>p_transition_ms/1000.0));
    if run.settings->>'timingMode'='total' then run.deadline_at:=run.deadline_at-greatest(interval '0',old_start-run.current_starts_at); end if;
    update private.student_word_practice_runs set current_starts_at=run.current_starts_at,deadline_at=run.deadline_at,feedback_pending=false where id=run.id;
  end if;
  deadline:=private.word_practice_timer_v1(run);
  return jsonb_build_object('questionDeadlineAt',deadline,'questionStartsAt',run.current_starts_at,
    'timerRemainingMilliseconds',private.word_practice_milliseconds_v1(deadline,at_time),
    'transitionRemainingMilliseconds',private.word_practice_milliseconds_v1(run.current_starts_at,at_time));
end;
$$;

create function public.expire_student_word_practice_v1(p_student_id uuid,p_run_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare run private.student_word_practice_runs; at_time timestamptz;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  perform private.assert_word_practice_student_v1(p_student_id);
  select * into run from private.student_word_practice_runs where id=p_run_id and student_id=p_student_id for update;
  if not found then raise exception 'practice_not_found' using errcode='P0002'; end if;
  at_time:=clock_timestamp();
  if run.status='in_progress' then
    if at_time<run.deadline_at then raise exception 'practice_expire_too_early' using errcode='40001'; end if;
    update private.student_word_practice_runs set status='expired',finished_at=at_time where id=run.id returning * into run;
  end if;
  return private.word_practice_read_v1(run);
end;
$$;

revoke all on function private.assert_word_practice_student_v1(uuid),private.word_practice_source_v1(uuid,jsonb),
  private.word_practice_timer_v1(private.student_word_practice_runs),private.word_practice_milliseconds_v1(timestamptz,timestamptz),
  private.word_practice_read_v1(private.student_word_practice_runs) from public,anon,authenticated,service_role;
revoke all on function public.prepare_student_word_practice_v1(uuid,jsonb),public.get_student_word_practice_v1(uuid,uuid,uuid,text,timestamptz,uuid),
  public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.answer_student_word_practice_v1(uuid,uuid,uuid,integer),
  public.resume_student_word_practice_v1(uuid,uuid,uuid,integer),public.expire_student_word_practice_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_student_word_practice_v1(uuid,jsonb),public.get_student_word_practice_v1(uuid,uuid,uuid,text,timestamptz,uuid),
  public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb),public.answer_student_word_practice_v1(uuid,uuid,uuid,integer),
  public.resume_student_word_practice_v1(uuid,uuid,uuid,integer),public.expire_student_word_practice_v1(uuid,uuid) to service_role;
commit;
