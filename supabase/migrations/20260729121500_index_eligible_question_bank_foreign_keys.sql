create index assignment_questions_canonical_lexeme_snapshot_idx
  on public.assignment_questions(canonical_lexeme_id_snapshot)
  where canonical_lexeme_id_snapshot is not null;

create index assignment_questions_content_review_snapshot_idx
  on public.assignment_questions(content_review_id_snapshot)
  where content_review_id_snapshot is not null;

create index assignment_quiz_mode_snapshots_assignment_dataset_idx
  on public.assignment_quiz_mode_snapshots(assignment_id, dataset_id);
