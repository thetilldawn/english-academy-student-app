begin;

create index assignment_review_targets_assignment_question_idx
  on public.assignment_review_targets (assignment_question_id);

create index assignment_review_targets_vocab_entry_dataset_idx
  on public.assignment_review_targets (vocab_entry_id, dataset_id);

create index assignment_students_cancelled_by_idx
  on public.assignment_students (cancelled_by);

commit;
