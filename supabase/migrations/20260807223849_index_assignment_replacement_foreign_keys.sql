begin;

create index assignment_replacement_requests_actor_idx
  on private.assignment_replacement_requests (actor_admin_id);

create index assignment_replacement_requests_student_idx
  on private.assignment_replacement_requests (student_id);

commit;
