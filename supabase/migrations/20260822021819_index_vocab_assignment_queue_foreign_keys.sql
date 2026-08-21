-- Keep every queue foreign-key lookup indexed. These tables start empty in
-- Preview, so regular index creation is the safest and cheapest rollout path.
create index vocab_assignment_queue_requests_actor_admin_id_idx
  on private.vocab_assignment_queue_requests (actor_admin_id);

create index vocab_assignment_series_actor_admin_id_idx
  on private.vocab_assignment_series (actor_admin_id);

create index vocab_assignment_series_dataset_id_idx
  on private.vocab_assignment_series (dataset_id);

create index vocab_assignment_series_exam_use_release_id_idx
  on private.vocab_assignment_series (exam_use_release_id);

create index vocab_assignment_series_items_completed_attempt_id_idx
  on private.vocab_assignment_series_items (completed_attempt_id);

create index vocab_assignment_series_events_assignment_id_idx
  on private.vocab_assignment_series_events (assignment_id);

create index vocab_assignment_series_events_attempt_id_idx
  on private.vocab_assignment_series_events (attempt_id);

create index vocab_assignment_series_events_item_id_idx
  on private.vocab_assignment_series_events (item_id);
