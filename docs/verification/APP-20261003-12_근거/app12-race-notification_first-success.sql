begin; set transaction isolation level read committed; set local statement_timeout='40s'; set local lock_timeout='30s'; set local application_name='app12-notification_first';
do $a$ declare counts jsonb; begin
if not exists(select 1 from public.students where id='b7120000-0000-4000-8000-000000000002' and note='APP12-b712 실제 학생 아님' and created_by='b6100000-0000-4000-8000-000000000001') then raise exception 'app12_fake_identity'; end if;
select to_jsonb(c) into counts from public.claim_student_notifications_v1('b7120000-0000-4000-8000-000000000002') c; perform set_config('app12.claim',counts::text,true);
end $a$;
do $observe$ declare proof jsonb; finish timestamptz:=clock_timestamp()+interval '28 seconds'; begin loop perform pg_stat_clear_snapshot();
select jsonb_build_object('aPid',pg_backend_pid(),'bPid',s.pid,'waitType',s.wait_event_type,'waitEvent',s.wait_event,'blockedBy',pg_blocking_pids(s.pid),'at',clock_timestamp()) into proof from pg_stat_activity s where s.pid<>pg_backend_pid() and s.query like '%create_quiz_attempt_from_bank%' and s.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(s.pid)) limit 1;
exit when proof is not null; if clock_timestamp()>finish then raise exception 'app12_overlap_not_observed'; end if; perform pg_sleep(0.1); end loop; perform set_config('app12.proof',proof::text,true); end $observe$;

select jsonb_build_object('case','notification_first','proof',current_setting('app12.proof')::jsonb,'claim',nullif(current_setting('app12.claim',true),'')::jsonb,'attempt',nullif(current_setting('app12.attempt',true),'')) value; commit;
