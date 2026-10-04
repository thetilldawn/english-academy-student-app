begin;
set local statement_timeout='20s';
set local lock_timeout='1s';
do $$
declare before_hash text; after_hash text;
begin
if not exists(select 1 from auth.users u join public.admin_profiles p on p.user_id=u.id where u.id='b6100000-0000-4000-8000-000000000001' and u.raw_user_meta_data->>'verification'='DEPLOY-20261003-01-fake-admin') then raise exception 'fake_admin_marker_mismatch'; end if;
if not exists(select 1 from public.vocab_datasets where id='b6100000-0000-4000-8000-000000000004' and dataset_key='m10-preview-fake-b610') then raise exception 'fake_dataset_key_mismatch'; end if;
if exists(select 1 from public.students where created_by='b6100000-0000-4000-8000-000000000001' and deleted_at is null) then raise exception 'fake_students_still_active'; end if;
select md5(concat((select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.quiz_attempts t),(select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.assignment_questions t),(select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.vocab_entries t where dataset_id='b6100000-0000-4000-8000-000000000004'))) into before_hash;
update public.admin_profiles set is_active=false where user_id='b6100000-0000-4000-8000-000000000001' and is_active;
update public.vocab_dataset_catalog set is_assignable=false where dataset_id='b6100000-0000-4000-8000-000000000004' and is_assignable;
update public.vocab_datasets set is_active=false where id='b6100000-0000-4000-8000-000000000004' and is_active;
select md5(concat((select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.quiz_attempts t),(select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.assignment_questions t),(select string_agg(md5(to_jsonb(t)::text),'' order by id) from public.vocab_entries t where dataset_id='b6100000-0000-4000-8000-000000000004'))) into after_hash;
if before_hash is distinct from after_hash then raise exception 'cleanup_learning_records_changed'; end if;
end $$;
select jsonb_build_object('project','wojxpruvbjzbhrpmsbuy','at',clock_timestamp(),'admin_inactive',(select not is_active from public.admin_profiles where user_id='b6100000-0000-4000-8000-000000000001'),'dataset_inactive',(select not is_active from public.vocab_datasets where id='b6100000-0000-4000-8000-000000000004'),'not_assignable',(select not is_assignable from public.vocab_dataset_catalog where dataset_id='b6100000-0000-4000-8000-000000000004'),'fake_students',33,'active_fake_students',(select count(*) from public.students where created_by='b6100000-0000-4000-8000-000000000001' and deleted_at is null),'entries',(select count(*) from public.vocab_entries where dataset_id='b6100000-0000-4000-8000-000000000004'),'quiz_attempts',(select count(*) from public.quiz_attempts),'assignment_questions',(select count(*) from public.assignment_questions),'learning_hash_guard','passed') as cleanup;
commit;
