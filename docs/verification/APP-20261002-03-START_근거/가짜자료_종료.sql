begin;set local statement_timeout='25s';select set_config('request.jwt.claim.sub','a5100000-0000-4000-8000-000000000001',true);select set_config('request.jwt.claim.role','authenticated',true);select set_config('request.jwt.claims','{"role":"authenticated"}',true);
create temporary table start_cleanup_before(name text,amount int,fingerprint text) on commit drop;
do $cleanup$ declare table_name text;n int;h text;s record;
begin
if (select count(*) from public.students where created_by='a5100000-0000-4000-8000-000000000001')<>2 or not exists(select 1 from public.vocab_datasets where id='a5100000-0000-4000-8000-000000000004' and imported_by='a5100000-0000-4000-8000-000000000001' and dataset_key='start-control-fake-a510') or exists(select 1 from public.quiz_attempts where student_id='a5100000-0000-4000-8000-000000000002' and status<>'completed') then raise exception 'cleanup_fixture_mismatch';end if;
foreach table_name in array array['public.quiz_attempts','public.quiz_questions','public.student_vocab_wrong_events','public.student_point_events','public.student_point_totals','private.vocabulary_answer_receipts','private.vocabulary_phase_results','private.vocabulary_result_policies','private.local_quiz_runs','private.local_quiz_phase_plans','private.local_quiz_phase_receipts'] loop execute format('select count(*)::int,md5(coalesce(string_agg(to_jsonb(r)::text,chr(10) order by to_jsonb(r)::text),'''')) from %s r where to_jsonb(r)::text ~ %L',table_name,'a5100000-|4647ed5a-4f22-47ad-8396-972e9e2263ac|e9ed6127-4117-4dd9-bbb1-4da9113409a6') into n,h;insert into start_cleanup_before values(table_name,n,h);end loop;
perform public.delete_student_v2('a5100000-0000-4000-8000-000000000002');
perform public.delete_student_v2('a5100000-0000-4000-8000-000000000003');
perform public.delete_assignment_v2('a5100000-0000-4000-8000-000000000010','START 가짜 검사 종료');
perform public.delete_assignment_v2('a5100000-0000-4000-8000-000000000011','START 가짜 검사 종료');
perform public.delete_assignment_v2('a5100000-0000-4000-8000-000000000012','START 가짜 검사 종료');
update private.quiz_attempt_preparations set expires_at=least(expires_at,clock_timestamp()-interval '1 second') where student_id in ('a5100000-0000-4000-8000-000000000002','a5100000-0000-4000-8000-000000000003');
update public.vocab_datasets set is_active=false where id='a5100000-0000-4000-8000-000000000004';
update public.admin_profiles set is_active=false where user_id='a5100000-0000-4000-8000-000000000001';
for s in select * from start_cleanup_before loop execute format('select count(*)::int,md5(coalesce(string_agg(to_jsonb(r)::text,chr(10) order by to_jsonb(r)::text),'''')) from %s r where to_jsonb(r)::text ~ %L',s.name,'a5100000-|4647ed5a-4f22-47ad-8396-972e9e2263ac|e9ed6127-4117-4dd9-bbb1-4da9113409a6') into n,h;if n<>s.amount or h<>s.fingerprint then raise exception 'cleanup_preservation_failed:%',s.name;end if;end loop;
end $cleanup$;
select jsonb_build_object('tables',(select jsonb_agg(to_jsonb(t)) from start_cleanup_before t),'paused',(select paused from private.quiz_start_control),'temporaryFunction',to_regprocedure('private.start_control_fake_wait_v1()'),'fakeQuestions',(select jsonb_agg(id) from public.quiz_questions where attempt_id in ('4647ed5a-4f22-47ad-8396-972e9e2263ac','e9ed6127-4117-4dd9-bbb1-4da9113409a6'))) value;commit;
