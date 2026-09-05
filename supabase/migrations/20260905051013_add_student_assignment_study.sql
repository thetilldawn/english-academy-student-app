begin;

-- Learning-only original examples. No changes to questions, attempts or scores.
create table private.assignment_study_examples_v1 (
  release_id uuid not null,
  vocab_entry_id bigint not null,
  quiz_mode text not null default 'canonical_example_to_headword'
    check (quiz_mode = 'canonical_example_to_headword'),
  question_item_id text not null,
  question_item_sha256 text not null,
  source_example_sha256 text not null,
  example_en text not null check (length(trim(example_en)) > 0 and example_en !~ '_{2,}'),
  imported_at timestamptz not null default now(),
  primary key (release_id, vocab_entry_id),
  foreign key (release_id, vocab_entry_id, quiz_mode)
    references word_index.app_canonical_question_preview_item(release_id, vocab_entry_id, quiz_mode),
  check (source_example_sha256 = encode(extensions.digest(convert_to(example_en, 'UTF8'), 'sha256'), 'hex'))
);
alter table private.assignment_study_examples_v1 enable row level security;
revoke all on private.assignment_study_examples_v1 from public, anon, authenticated, service_role;

create function public.get_student_assignment_study_v1(p_student_id uuid, p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with permitted as materialized (
    select a.id, a.title, a.quiz_content_mode
    from public.assignments a
    join public.assignment_students recipient on recipient.assignment_id = a.id
    join public.students student on student.id = recipient.student_id
    where a.id = p_assignment_id and recipient.student_id = p_student_id
      and recipient.cancelled_at is null and recipient.assigned_at <= now()
      and a.deleted_at is null and a.status in ('active', 'closed')
      and student.deleted_at is null and student.status = 'active'
  ), learning_rows as (
    select q.vocab_entry_id, e.dataset_id, e.source_row,
      jsonb_build_object(
        'entryId', q.vocab_entry_id,
        'headword', coalesce(nullif(s.headword_snapshot, ''), case when q.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1') then nullif(q.headword_snapshot, '') end, e.headword),
        'meaning', coalesce(nullif(s.primary_meaning_snapshot, ''), case when q.provenance_status in ('verified_v2','reviewed_for_preview_v1','preview_verified_v1') then nullif(q.primary_meaning_snapshot, '') end, e.primary_meaning),
        'displayKo', coalesce(s.display_pronunciation_ko_snapshot, e.pronunciation_ko),
        'pronunciationSnapshot', s.pronunciation_snapshot,
        'dictionaryId', s.dictionary_id,
        'releaseId', coalesce(s.release_id, r.exam_use_release_id),
        'definition', case when q.eligibility_quiz_mode = 'canonical_definition_to_headword' then q.prompt end,
        'example', case when q.eligibility_quiz_mode = 'canonical_example_to_headword' then x.example_en end
      ) as item
    from permitted a
    join public.assignment_questions q on q.assignment_id = a.id
    join public.vocab_entries e on e.id = q.vocab_entry_id
    left join public.assignment_question_exam_use_snapshot s
      on s.assignment_question_id = q.id and s.provenance_status = 'reviewed_for_preview_v1'
    left join word_index.app_canonical_question_preview_release r
      on r.release_id = q.canonical_question_release_id_snapshot
    left join word_index.app_canonical_question_preview_item source
      on source.release_id = q.canonical_question_release_id_snapshot
      and source.vocab_entry_id = q.vocab_entry_id
      and source.quiz_mode = q.eligibility_quiz_mode
      and source.question_item_id = q.canonical_question_item_id_snapshot
      and source.question_item_sha256 = q.canonical_question_item_sha256_snapshot
    left join private.assignment_study_examples_v1 x
      on x.release_id = source.release_id and x.vocab_entry_id = source.vocab_entry_id
      and x.question_item_id = source.question_item_id
      and x.question_item_sha256 = source.question_item_sha256
      and x.source_example_sha256 = source.source_example_content_hash
  )
  select jsonb_build_object('assignmentId', a.id, 'title', a.title, 'mode', a.quiz_content_mode,
    'words', coalesce((select jsonb_agg(item order by dataset_id, source_row, vocab_entry_id) from learning_rows), '[]'::jsonb))
  from permitted a;
$$;
revoke all on function public.get_student_assignment_study_v1(uuid,uuid) from public, anon, authenticated;
grant execute on function public.get_student_assignment_study_v1(uuid,uuid) to service_role;
comment on function public.get_student_assignment_study_v1(uuid,uuid) is
  'Session-scoped server-only learning view: assigned targets in source order, never choices or answer indexes.';
commit;
