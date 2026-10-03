begin;
create or replace function private.start_control_fake_wait_v1() returns trigger language plpgsql set search_path='' as $$
declare proof jsonb;finish timestamptz:=clock_timestamp()+interval '25 seconds';
begin
 if new.id<>'e9ed6127-4117-4dd9-bbb1-4da9113409a6'::uuid or new.student_id<>'a5100000-0000-4000-8000-000000000002'::uuid then return new;end if;
 if not exists(select 1 from public.students where id=new.student_id and created_by='a5100000-0000-4000-8000-000000000001' and note='START-CONTROL-a510: 실제 학생 아님') then raise exception 'start_control_not_fixture';end if;
 perform set_config('application_name','start-control-http-holder',true);
 loop perform pg_stat_clear_snapshot();
 select jsonb_build_object('aPid',pg_backend_pid(),'bPid',s.pid,'waitType',s.wait_event_type,'waitEvent',s.wait_event,'blockedBy',pg_blocking_pids(s.pid),'at',clock_timestamp()) into proof
 from pg_stat_activity s where s.pid<>pg_backend_pid() and s.query like '%update private.quiz_start_control set paused=true%' and s.wait_event_type='Lock' and pg_backend_pid()=any(pg_blocking_pids(s.pid)) limit 1;
 exit when proof is not null;if clock_timestamp()>finish then raise exception 'start_control_reverse_overlap_not_observed';end if;perform pg_sleep(0.1);
 end loop;
 update public.vocab_datasets set metadata=jsonb_set(coalesce(metadata,'{}'),'{startControlConcurrency}',proof,true)
 where id='a5100000-0000-4000-8000-000000000004' and imported_by='a5100000-0000-4000-8000-000000000001' and dataset_key='start-control-fake-a510';
 return new;
end $$;
revoke all on function private.start_control_fake_wait_v1() from public,anon,authenticated,service_role;
commit;
