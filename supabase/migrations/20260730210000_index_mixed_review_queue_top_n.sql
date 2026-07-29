begin;

create index student_vocab_review_queue_mixed_top_n_idx
  on public.student_vocab_review_queue (
    student_id,
    dataset_id,
    reason_level desc,
    queued_at,
    id
  )
  where status = 'pending'
    and reserved_review_draft_id is null;

notify pgrst, 'reload schema';

commit;
