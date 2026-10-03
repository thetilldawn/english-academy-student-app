begin;set local statement_timeout='30s';set local lock_timeout='3s';
select set_config('request.jwt.claim.sub','b6100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claim.role','authenticated',true);
select set_config('request.jwt.claims','{"role":"authenticated","sub":"b6100000-0000-4000-8000-000000000001","ref":"wojxpruvbjzbhrpmsbuy"}',true);
do $$ declare t record; begin
if (select count(*) from public.students where id in ('b7120000-0000-4000-8000-000000000002','b7120000-0000-4000-8000-000000000003') and note='APP12-b712 실제 학생 아님' and created_by='b6100000-0000-4000-8000-000000000001')<>2
or (select count(*) from public.assignments where id in ('c6068d04-b577-4bd6-9872-ee1061d7e2e3','71a11527-056a-46e1-a2fe-feeb20f5da68','4e48baae-46bf-459c-92f2-c4edeead4533','a717c544-b61d-48d8-965e-b8fe36002d20') and created_by='b6100000-0000-4000-8000-000000000001' and title like '[알림 검증] 가짜 배정 %')<>4 then raise exception 'app12_cleanup_scope_mismatch';end if;
for t in select id from public.students where id in ('b7120000-0000-4000-8000-000000000002','b7120000-0000-4000-8000-000000000003') loop perform public.delete_student_v2(t.id);end loop;
for t in select id from public.assignments where id in ('c6068d04-b577-4bd6-9872-ee1061d7e2e3','71a11527-056a-46e1-a2fe-feeb20f5da68','4e48baae-46bf-459c-92f2-c4edeead4533','a717c544-b61d-48d8-965e-b8fe36002d20') loop perform public.delete_assignment_v2(t.id,'가짜 알림 동시 요청 검사 종료');end loop;
end $$;
select jsonb_build_object('students',(select jsonb_agg(jsonb_build_object('id',id,'deleted',deleted_at is not null,'status',status)) from public.students where id in ('b7120000-0000-4000-8000-000000000002','b7120000-0000-4000-8000-000000000003')),'assignments',(select jsonb_agg(jsonb_build_object('id',id,'deleted',deleted_at is not null)) from public.assignments where id in ('c6068d04-b577-4bd6-9872-ee1061d7e2e3','71a11527-056a-46e1-a2fe-feeb20f5da68','4e48baae-46bf-459c-92f2-c4edeead4533','a717c544-b61d-48d8-965e-b8fe36002d20'))) value;
commit;
