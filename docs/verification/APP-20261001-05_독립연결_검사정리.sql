begin;set local statement_timeout='8s';
select set_config('request.jwt.claim.sub','b1101001-5a11-4b11-8c11-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b1101001-5a11-4b11-8c11-000000000001"}',true);
do $cleanup$
declare row_record record;
begin
 if (select count(*) from public.assignments where created_by='b1101001-5a11-4b11-8c11-000000000001' and dataset_id='b1101001-5a11-4b11-8c11-000000000003')<>5
 then raise exception 'm11_cleanup_fixture_count_mismatch'; end if;
 for row_record in select id from public.assignments where created_by='b1101001-5a11-4b11-8c11-000000000001' and dataset_id='b1101001-5a11-4b11-8c11-000000000003'
 loop perform public.delete_assignment_v2(row_record.id,'M11 독립 연결 검증 종료'); end loop;
 perform public.delete_student_v2('b1101001-5a11-4b11-8c11-000000000002');
 update word_index.app_exam_use_release set status='retired',retired_at_utc=clock_timestamp()
 where release_id='b1101001-5a11-4b11-8c11-000000000405' and dataset_id='b1101001-5a11-4b11-8c11-000000000003' and release_key='m11-qa-b1101001-queue-release';
 update public.vocab_datasets set is_active=false,status='retired' where id='b1101001-5a11-4b11-8c11-000000000003' and imported_by='b1101001-5a11-4b11-8c11-000000000001';
 update public.admin_profiles set is_active=false where user_id='b1101001-5a11-4b11-8c11-000000000001';
end $cleanup$;
commit;
