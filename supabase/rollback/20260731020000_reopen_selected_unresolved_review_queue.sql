begin;

drop trigger if exists assignment_review_targets_reopen_queue_after_missed
  on public.assignment_review_targets;
drop function if exists
  private.reopen_selected_vocab_review_queue_after_missed_target();

drop trigger if exists student_vocab_state_reopen_selected_review_queue
  on public.student_vocab_state;
drop function if exists
  private.reopen_selected_vocab_review_queue_after_state_change();
drop function if exists
  private.reopen_selected_vocab_review_queue_v1(uuid, bigint, integer);

drop trigger if exists quiz_attempts_lock_student_before_initial_wrong_state
  on public.quiz_attempts;
drop function if exists private.lock_student_before_initial_wrong_state();

-- Rows restored to pending are deliberately left pending: they still represent
-- unresolved words previously selected by the teacher. Re-cancelling them
-- automatically would discard valid user intent.

notify pgrst, 'reload schema';

commit;
