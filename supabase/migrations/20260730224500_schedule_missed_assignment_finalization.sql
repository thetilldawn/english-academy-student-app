begin;

create extension if not exists pg_cron;

select cron.schedule(
  'english-academy-finalize-missed-assignments',
  '* * * * *',
  $cron$
    select public.finalize_missed_assignments(null, 250);
  $cron$
);

commit;
