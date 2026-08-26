begin;

-- Cover the student foreign key independently from the job-first retry scan.
-- The existing candidate index cannot support student-driven deletes because
-- student_id is not its leading column.
create index student_app_maintenance_retry_student_idx
  on private.student_app_maintenance_retry_state (student_id);

commit;
