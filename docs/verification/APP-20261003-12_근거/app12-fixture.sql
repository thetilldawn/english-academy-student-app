begin;
set local statement_timeout='30s'; set local lock_timeout='3s';
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6100000-0000-4000-8000-000000000001","ref":"wojxpruvbjzbhrpmsbuy"}',true);
do $fixture$
declare plan jsonb; a uuid; result jsonb:='[]'; target uuid;
begin
 if not exists(select 1 from auth.users u join public.admin_profiles p on p.user_id=u.id where u.id='b6100000-0000-4000-8000-000000000001' and p.is_active and u.raw_user_meta_data->>'verification'='DEPLOY-20261003-01-fake-admin')
 or not exists(select 1 from public.vocab_datasets where id='b6100000-0000-4000-8000-000000000004' and dataset_key='m10-preview-fake-b610' and imported_by='b6100000-0000-4000-8000-000000000001' and is_active)
 or exists(select 1 from public.students where id in ('b7120000-0000-4000-8000-000000000002','b7120000-0000-4000-8000-000000000003')) then raise exception 'app12_fake_fixture_mismatch';end if;
 if (select count(*) from public.vocab_entries where dataset_id='b6100000-0000-4000-8000-000000000004' and headword='m10sample'||source_row and primary_meaning='검토 뜻 '||source_row)<>4 then raise exception 'app12_fake_words_mismatch';end if;
 select jsonb_agg(jsonb_build_object('vocab_entry_id',e.id,'base_order_index',e.source_row,'direction','english_to_korean',
 'choice_vocab_entry_ids',(select jsonb_agg(v.id order by ((v.source_row-e.source_row+4)%4)) from public.vocab_entries v where v.dataset_id=e.dataset_id)) order by e.source_row)
 into plan from public.vocab_entries e where dataset_id='b6100000-0000-4000-8000-000000000004';
 for n in 2..3 loop
  target:=('b7120000-0000-4000-8000-00000000000'||n)::uuid;
  insert into public.students(id,display_name,status,created_by,note,school_name,grade_label) values(target,'[알림 검증] 가짜 학생 '||n,'active','b6100000-0000-4000-8000-000000000001','APP12-b712 실제 학생 아님','가상고','고2');
  a:=public.create_assignment_with_delivery_v7('[알림 검증] 가짜 배정 '||n,'b6100000-0000-4000-8000-000000000004',array['b6100000-0000-4000-8000-000000000100']::uuid[],4,100::smallint,300,80::smallint,true,80::smallint,'fixed',clock_timestamp()+interval '2 hours',array[target],'none',null,plan);
  result:=result||jsonb_build_array(jsonb_build_object('case',case when n=2 then 'notification_first' else 'start_first' end,'studentId',target,'assignmentId',a));
 end loop;
 perform set_config('app12.fixture',result::text,true);
end;
$fixture$;
select current_setting('app12.fixture')::jsonb value;
commit;
