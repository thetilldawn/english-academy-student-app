begin;

-- Apply this migration only after every R1 body migration has been called
-- manually and concurrency/idempotency checks have passed in Preview.
create extension if not exists pg_cron;

select cron.schedule(
  'english-academy-finalize-stale-attempts',
  '* * * * *',
  $cron$
    select private.run_stale_quiz_attempt_maintenance_v1(10, 25, 1000);
  $cron$
);

select cron.schedule(
  'english-academy-expire-review-drafts',
  '*/2 * * * *',
  $cron$
    select private.run_expired_review_draft_maintenance_v1(10, 50, 10, 1000);
  $cron$
);

select cron.schedule(
  'english-academy-materialize-ready-vocab-queues',
  '* * * * *',
  $cron$
    select private.run_ready_vocab_queue_maintenance_v1(2, 1000);
  $cron$
);

commit;
