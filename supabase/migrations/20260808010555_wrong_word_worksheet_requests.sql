begin;

create table public.worksheet_requests (
  id uuid primary key default extensions.gen_random_uuid(),
  schema_version text not null default 'wrong-word-worksheet-request-v1'
    check (schema_version = 'wrong-word-worksheet-request-v1'),
  request_type text not null default 'wrong_word_translation'
    check (request_type = 'wrong_word_translation'),
  student_id uuid not null
    references public.students(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete restrict,
  school_name_snapshot text check (
    school_name_snapshot is null
    or char_length(trim(school_name_snapshot)) between 1 and 120
  ),
  grade_label_snapshot text check (
    grade_label_snapshot is null
    or char_length(trim(grade_label_snapshot)) between 1 and 40
  ),
  status text not null default 'queued'
    check (status in ('queued', 'generated', 'approved', 'rejected', 'cancelled')),
  item_count integer not null check (item_count between 1 and 50),
  input_sha256 text not null check (input_sha256 ~ '^[A-F0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[A-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, student_id)
);

create unique index worksheet_requests_active_input_idx
  on public.worksheet_requests(student_id, request_type, input_sha256)
  where status in ('queued', 'generated', 'approved');

create index worksheet_requests_student_created_idx
  on public.worksheet_requests(student_id, created_at desc);

create table public.worksheet_request_items (
  request_id uuid not null
    references public.worksheet_requests(id) on delete cascade,
  position integer not null check (position between 1 and 50),
  item_identity text not null
    check (char_length(trim(item_identity)) between 3 and 500),
  primary_wrong_event_id bigint not null
    references public.student_vocab_wrong_events(id) on delete restrict,
  source_wrong_event_ids bigint[] not null
    check (cardinality(source_wrong_event_ids) >= 1),
  source_question_id uuid not null
    references public.quiz_questions(id) on delete restrict,
  dataset_id uuid not null
    references public.vocab_datasets(id) on delete restrict,
  vocab_entry_id bigint not null,
  canonical_lexeme_id_snapshot uuid,
  dictionary_id_snapshot text check (
    dictionary_id_snapshot is null
    or dictionary_id_snapshot ~ '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  sense_id_snapshot text,
  occurrence_id_snapshot text check (
    occurrence_id_snapshot is null
    or occurrence_id_snapshot ~ '^occ:[a-z0-9][a-z0-9._-]*$'
  ),
  headword_snapshot text not null
    check (char_length(trim(headword_snapshot)) between 1 and 160),
  primary_meaning_snapshot text not null
    check (char_length(trim(primary_meaning_snapshot)) between 1 and 500),
  wrong_count_snapshot integer not null check (wrong_count_snapshot >= 1),
  wrong_level_snapshot smallint not null check (wrong_level_snapshot in (1, 2)),
  last_wrong_at_snapshot timestamptz not null,
  dataset_label_snapshot text not null
    check (char_length(trim(dataset_label_snapshot)) between 1 and 260),
  provenance_status_snapshot text not null
    check (char_length(trim(provenance_status_snapshot)) between 1 and 80),
  generation_status text not null check (
    generation_status in (
      'ready',
      'needs_dictionary_link',
      'needs_meaning_review'
    )
  ),
  occurrence_content_hash_snapshot text check (
    occurrence_content_hash_snapshot is null
    or occurrence_content_hash_snapshot ~ '^[A-Fa-f0-9]{64}$'
  ),
  source_metadata_snapshot jsonb not null
    check (jsonb_typeof(source_metadata_snapshot) = 'object'),
  item_content_sha256 text not null
    check (item_content_sha256 ~ '^[A-F0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (request_id, position),
  unique (request_id, item_identity),
  unique (request_id, source_question_id),
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id) on delete restrict
);

create index worksheet_request_items_question_idx
  on public.worksheet_request_items(source_question_id);
create index worksheet_request_items_dictionary_idx
  on public.worksheet_request_items(dictionary_id_snapshot)
  where dictionary_id_snapshot is not null;

create trigger worksheet_requests_set_updated_at
before update on public.worksheet_requests
for each row execute function private.set_updated_at();

alter table public.worksheet_requests enable row level security;
alter table public.worksheet_request_items enable row level security;

create policy "active admins read worksheet requests"
on public.worksheet_requests for select to authenticated
using ((select private.is_active_admin()));

create policy "active admins read worksheet request items"
on public.worksheet_request_items for select to authenticated
using ((select private.is_active_admin()));

revoke all on table public.worksheet_requests
  from public, anon, authenticated;
revoke all on table public.worksheet_request_items
  from public, anon, authenticated;
grant select on table public.worksheet_requests to authenticated;
grant select on table public.worksheet_request_items to authenticated;
grant all on table public.worksheet_requests to service_role;
grant all on table public.worksheet_request_items to service_role;

create function public.create_wrong_word_worksheet_request_v1(
  p_student_id uuid,
  p_question_ids uuid[]
)
returns table (
  request_id uuid,
  item_count integer,
  content_sha256 text,
  reused boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  selected_snapshot jsonb;
  export_snapshot jsonb;
  identity_snapshot jsonb;
  selected_count integer;
  selected_identity_count integer;
  input_hash text;
  snapshot_hash text;
  created_request_id uuid;
  student_school_name text;
  student_grade_label text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'worksheet_request_forbidden' using errcode = '42501';
  end if;

  if p_student_id is null
    or p_question_ids is null
    or cardinality(p_question_ids) not between 1 and 50
    or cardinality(p_question_ids) <> (
      select count(distinct selected_id)
      from unnest(p_question_ids) as selected_id
    )
  then
    raise exception 'worksheet_request_invalid_selection'
      using errcode = '22023';
  end if;

  select student.school_name, student.grade_label
  into student_school_name, student_grade_label
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active';

  if not found then
    raise exception 'worksheet_request_student_not_found'
      using errcode = 'P0002';
  end if;

  with selected_base as (
    select
      question.id as source_question_id,
      entry.dataset_id,
      entry.id as vocab_entry_id,
      bank_question.canonical_lexeme_id_snapshot,
      exam_snapshot.dictionary_id,
      exam_snapshot.sense_id,
      exam_snapshot.occurrence_id,
      coalesce(
        exam_snapshot.headword_snapshot,
        case
          when bank_question.provenance_status in (
            'verified_v2',
            'reviewed_for_preview_v1'
          ) then bank_question.headword_snapshot
        end,
        entry.headword
      ) as headword,
      coalesce(
        exam_snapshot.primary_meaning_snapshot,
        case
          when bank_question.provenance_status in (
            'verified_v2',
            'reviewed_for_preview_v1'
          ) then bank_question.primary_meaning_snapshot
        end,
        entry.primary_meaning
      ) as primary_meaning,
      concat_ws(' · ', dataset.title, dataset.edition) as dataset_label,
      coalesce(
        exam_snapshot.provenance_status,
        bank_question.provenance_status,
        'legacy_backfill'
      ) as provenance_status,
      case
        when exam_snapshot.provenance_status = 'reviewed_for_preview_v1'
          and exam_snapshot.dictionary_id is not null
          and exam_snapshot.occurrence_id is not null
          then 'ready'
        when bank_question.provenance_status in (
          'verified_v2',
          'reviewed_for_preview_v1'
        ) then 'needs_dictionary_link'
        else 'needs_meaning_review'
      end as generation_status,
      exam_snapshot.occurrence_content_hash,
      case
        when exam_snapshot.dictionary_id is not null
          and exam_snapshot.occurrence_id is not null
          then exam_snapshot.dictionary_id || '|' || exam_snapshot.occurrence_id
        else 'entry:' || entry.dataset_id::text || ':' || entry.id::text
      end as item_identity,
      wrong_history.primary_wrong_event_id,
      wrong_history.source_wrong_event_ids,
      wrong_history.wrong_count,
      least(wrong_history.wrong_count, 2)::smallint as wrong_level,
      wrong_history.last_wrong_at,
      jsonb_build_object(
        'datasetKey', dataset.dataset_key,
        'title', dataset.title,
        'edition', dataset.edition,
        'sourceLabel', dataset.source_label
      ) as source_metadata
    from unnest(p_question_ids) as selected(source_question_id)
    join public.quiz_questions as question
      on question.id = selected.source_question_id
    join public.quiz_attempts as attempt
      on attempt.id = question.attempt_id
     and attempt.student_id = p_student_id
     and attempt.status in ('completed', 'expired')
    join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
    join public.vocab_datasets as dataset
      on dataset.id = entry.dataset_id
    join public.student_vocab_state as state
      on state.student_id = p_student_id
     and state.vocab_entry_id = entry.id
     and state.unresolved_wrong_count > 0
     and state.resolved_at is null
    left join public.assignment_questions as bank_question
      on bank_question.id = question.assignment_question_id
    left join public.assignment_question_exam_use_snapshot as exam_snapshot
      on exam_snapshot.assignment_question_id = question.assignment_question_id
    cross join lateral (
      select
        (array_agg(wrong_event.id order by wrong_event.wrong_at desc, wrong_event.id desc))[1]
          as primary_wrong_event_id,
        array_agg(wrong_event.id order by wrong_event.wrong_at, wrong_event.id)
          as source_wrong_event_ids,
        count(*)::integer as wrong_count,
        max(wrong_event.wrong_at) as last_wrong_at
      from public.student_vocab_wrong_events as wrong_event
      where wrong_event.student_id = p_student_id
        and wrong_event.wrong_stage = 'initial'
        and wrong_event.dataset_id = entry.dataset_id
        and wrong_event.vocab_entry_id = entry.id
    ) as wrong_history
    where question.initial_is_correct = false
      and wrong_history.wrong_count > 0
      and exists (
        select 1
        from public.student_vocab_wrong_events as selected_wrong_event
        where selected_wrong_event.student_id = p_student_id
          and selected_wrong_event.quiz_question_id = question.id
          and selected_wrong_event.wrong_stage = 'initial'
      )
  ),
  positioned_items as (
    select
      row_number() over (order by item_identity)::integer as position,
      selected_base.*
    from selected_base
  ),
  snapshot_items as (
    select
      item_identity,
      jsonb_build_object(
        'position', position,
        'itemIdentity', item_identity,
        'sourceQuestionId', source_question_id,
        'primaryWrongEventId', primary_wrong_event_id,
        'sourceWrongEventIds', source_wrong_event_ids,
        'datasetId', dataset_id,
        'vocabEntryId', vocab_entry_id,
        'canonicalLexemeId', canonical_lexeme_id_snapshot,
        'dictionaryId', dictionary_id,
        'senseId', sense_id,
        'occurrenceId', occurrence_id,
        'headword', headword,
        'primaryMeaning', primary_meaning,
        'wrongCount', wrong_count,
        'wrongLevel', wrong_level,
        'lastWrongAt', last_wrong_at,
        'datasetLabel', dataset_label,
        'provenanceStatus', provenance_status,
        'generationStatus', generation_status,
        'occurrenceContentHash', occurrence_content_hash,
        'sourceMetadata', source_metadata,
        'exportItem', jsonb_build_object(
          'position', position,
          'item_id', item_identity,
          'dictionary_id', dictionary_id,
          'sense_id', sense_id,
          'occurrence_id', occurrence_id,
          'dataset_id', dataset_id,
          'vocab_entry_id', vocab_entry_id,
          'canonical_lexeme_id', canonical_lexeme_id_snapshot,
          'headword', headword,
          'display_gloss_ko', primary_meaning,
          'wrong_level', wrong_level,
          'generation_status', generation_status,
          'provenance_status', provenance_status,
          'occurrence_content_hash', occurrence_content_hash,
          'source_metadata', source_metadata
        )
      ) as item_json
    from positioned_items
  ),
  hashed_items as (
    select
      item_identity,
      (item_json - 'exportItem') || jsonb_build_object(
        'itemContentSha256', item_hash,
        'exportItem', (item_json -> 'exportItem') ||
          jsonb_build_object('item_content_sha256', item_hash)
      ) as item_json
    from snapshot_items
    cross join lateral (
      select upper(encode(
        extensions.digest(
          convert_to((item_json -> 'exportItem')::text, 'UTF8'),
          'sha256'
        ),
        'hex'
      )) as item_hash
    ) as hash_projection
  )
  select
    jsonb_agg(item_json order by item_identity),
    jsonb_agg(item_json -> 'exportItem' order by item_identity),
    jsonb_agg(to_jsonb(item_identity) order by item_identity),
    count(*)::integer,
    count(distinct item_identity)::integer
  into
    selected_snapshot,
    export_snapshot,
    identity_snapshot,
    selected_count,
    selected_identity_count
  from hashed_items;

  if selected_count <> cardinality(p_question_ids)
    or selected_identity_count <> selected_count
  then
    raise exception 'worksheet_request_invalid_or_duplicate_occurrence'
      using errcode = '22023';
  end if;

  snapshot_hash := upper(encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'schema_version', 'wrong-word-worksheet-request-v1',
          'request_type', 'wrong_word_translation',
          'student_id', p_student_id,
          'target_profile', jsonb_build_object(
            'school_name', student_school_name,
            'grade_label', student_grade_label
          ),
          'item_count', selected_count,
          'items', export_snapshot
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ));
  input_hash := upper(encode(
    extensions.digest(
      convert_to(
        jsonb_build_object(
          'studentId', p_student_id,
          'requestType', 'wrong_word_translation',
          'itemIdentities', identity_snapshot
        )::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ));

  insert into public.worksheet_requests (
    student_id,
    requested_by,
    school_name_snapshot,
    grade_label_snapshot,
    item_count,
    input_sha256,
    content_sha256
  )
  values (
    p_student_id,
    (select auth.uid()),
    student_school_name,
    student_grade_label,
    selected_count,
    input_hash,
    snapshot_hash
  )
  on conflict (student_id, request_type, input_sha256)
    where status in ('queued', 'generated', 'approved')
  do nothing
  returning id into created_request_id;

  if created_request_id is null then
    return query
    select
      request.id,
      request.item_count,
      request.content_sha256,
      true
    from public.worksheet_requests as request
    where request.student_id = p_student_id
      and request.request_type = 'wrong_word_translation'
      and request.input_sha256 = input_hash
      and request.status in ('queued', 'generated', 'approved')
    order by request.created_at desc
    limit 1;

    if not found then
      raise exception 'worksheet_request_conflict_without_active_row'
        using errcode = '40001';
    end if;
    return;
  end if;

  insert into public.worksheet_request_items (
    request_id,
    position,
    item_identity,
    primary_wrong_event_id,
    source_wrong_event_ids,
    source_question_id,
    dataset_id,
    vocab_entry_id,
    canonical_lexeme_id_snapshot,
    dictionary_id_snapshot,
    sense_id_snapshot,
    occurrence_id_snapshot,
    headword_snapshot,
    primary_meaning_snapshot,
    wrong_count_snapshot,
    wrong_level_snapshot,
    last_wrong_at_snapshot,
    dataset_label_snapshot,
    provenance_status_snapshot,
    generation_status,
    occurrence_content_hash_snapshot,
    source_metadata_snapshot,
    item_content_sha256
  )
  select
    created_request_id,
    item.ordinality::integer,
    item.value ->> 'itemIdentity',
    (item.value ->> 'primaryWrongEventId')::bigint,
    array(
      select source_event.value::bigint
      from jsonb_array_elements_text(
        item.value -> 'sourceWrongEventIds'
      ) as source_event(value)
    ),
    (item.value ->> 'sourceQuestionId')::uuid,
    (item.value ->> 'datasetId')::uuid,
    (item.value ->> 'vocabEntryId')::bigint,
    nullif(item.value ->> 'canonicalLexemeId', '')::uuid,
    nullif(item.value ->> 'dictionaryId', ''),
    nullif(item.value ->> 'senseId', ''),
    nullif(item.value ->> 'occurrenceId', ''),
    item.value ->> 'headword',
    item.value ->> 'primaryMeaning',
    (item.value ->> 'wrongCount')::integer,
    (item.value ->> 'wrongLevel')::smallint,
    (item.value ->> 'lastWrongAt')::timestamptz,
    item.value ->> 'datasetLabel',
    item.value ->> 'provenanceStatus',
    item.value ->> 'generationStatus',
    nullif(item.value ->> 'occurrenceContentHash', ''),
    item.value -> 'sourceMetadata',
    item.value ->> 'itemContentSha256'
  from jsonb_array_elements(selected_snapshot) with ordinality as item;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  values (
    'worksheet.wrong_word.queued',
    (select auth.uid()),
    p_student_id,
    jsonb_build_object(
      'requestId', created_request_id,
      'itemCount', selected_count,
      'contentSha256', snapshot_hash
    )
  );

  return query
  select created_request_id, selected_count, snapshot_hash, false;
end;
$$;

create function public.export_wrong_word_worksheet_request_v1(
  p_request_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'worksheet_export_forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'schema_version', request.schema_version,
    'request_id', request.id,
    'student_id', request.student_id,
    'request_type', request.request_type,
    'created_at_utc', request.created_at,
    'target_profile', jsonb_build_object(
      'school_name', request.school_name_snapshot,
      'grade_label', request.grade_label_snapshot
    ),
    'item_count', request.item_count,
    'items', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'position', item.position,
          'item_id', item.item_identity,
          'dictionary_id', item.dictionary_id_snapshot,
          'sense_id', item.sense_id_snapshot,
          'occurrence_id', item.occurrence_id_snapshot,
          'dataset_id', item.dataset_id,
          'vocab_entry_id', item.vocab_entry_id,
          'canonical_lexeme_id', item.canonical_lexeme_id_snapshot,
          'headword', item.headword_snapshot,
          'display_gloss_ko', item.primary_meaning_snapshot,
          'wrong_level', item.wrong_level_snapshot,
          'generation_status', item.generation_status,
          'provenance_status', item.provenance_status_snapshot,
          'occurrence_content_hash', item.occurrence_content_hash_snapshot,
          'source_metadata', item.source_metadata_snapshot,
          'item_content_sha256', item.item_content_sha256
        ) order by item.position
      )
      from public.worksheet_request_items as item
      where item.request_id = request.id
    ), '[]'::jsonb),
    'content_sha256', request.content_sha256
  )
  into result
  from public.worksheet_requests as request
  where request.id = p_request_id
    and request.status in ('queued', 'generated', 'approved');

  if result is null then
    raise exception 'worksheet_request_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    student_id,
    details
  )
  select
    'worksheet.wrong_word.exported',
    (select auth.uid()),
    request.student_id,
    jsonb_build_object(
      'requestId', request.id,
      'itemCount', request.item_count,
      'contentSha256', request.content_sha256
    )
  from public.worksheet_requests as request
  where request.id = p_request_id;

  return result;
end;
$$;

revoke all on function public.create_wrong_word_worksheet_request_v1(
  uuid,
  uuid[]
) from public, anon;
revoke all on function public.export_wrong_word_worksheet_request_v1(uuid)
  from public, anon;
grant execute on function public.create_wrong_word_worksheet_request_v1(
  uuid,
  uuid[]
) to authenticated;
grant execute on function public.export_wrong_word_worksheet_request_v1(uuid)
  to authenticated;

commit;
