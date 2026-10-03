begin;
set transaction isolation level repeatable read;
set local statement_timeout='25s';set local lock_timeout='3s';set local timezone='UTC';set local datestyle='ISO, YMD';
create temporary table start_control_before_rows(schema_name text,table_name text,amount bigint,fingerprint text) on commit drop;
do $snapshot$
declare t record; amount bigint; fingerprint text;
begin
 for t in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','private') and c.relkind='r'
 and (c.relname ~ '^(student|assignment|quiz|local_quiz|vocabulary_answer|vocabulary_expired|vocabulary_legacy|vocabulary_question_meaning|worksheet_mistake|notebook_question_origins)'
 or c.relname='admin_profiles') and c.relname not like 'student_app_maintenance%' order by n.nspname,c.relname loop
  execute format('select count(*),encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''''),''UTF8''),''sha256''),''hex'') from (select encode(extensions.digest(convert_to(to_jsonb(r)::text,''UTF8''),''sha256''),''hex'') h from %I.%I r where not (to_jsonb(r)::text ~ %L)) s',t.nspname,t.relname,'a5100000-|4647ed5a-4f22-47ad-8396-972e9e2263ac|e9ed6127-4117-4dd9-bbb1-4da9113409a6|1bd69af3-b28a-443f-8fc1-268ab5e8e441|0fbdb8f3-d1d7-4627-b229-0e45f284be63|35dc4848-425a-4941-b17d-867b7c358630|3321e88b-1472-4798-8f12-59a313d11fb5|785237e4-9efc-4969-91e4-bf857759e10b|fa98c01d-f87c-48d1-8aa0-eaa9ff3f1b32|6a195323-eb53-48d0-b44f-c00a4d65da52|d40307ed-b229-438a-9741-6a376bd11604|3a560b0e-e0f6-4aa0-a10d-397b7bcae9bf') into amount,fingerprint;
  insert into start_control_before_rows values(t.nspname,t.relname,amount,fingerprint);
 end loop;
end;
$snapshot$;
create temporary table start_control_other_functions on commit drop as select oid,encode(extensions.digest(convert_to(to_jsonb(p)::text,'UTF8'),'sha256'),'hex') fingerprint from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'private.guard_new_attempt_release_v1()'::regprocedure;

create temporary table start_control_guard_meta on commit drop as select to_jsonb(p)-'prosrc' meta from pg_proc p where oid='private.guard_new_attempt_release_v1()'::regprocedure;
select jsonb_build_object('checkedAt',clock_timestamp(),'tables',(select jsonb_agg(to_jsonb(t) order by schema_name,table_name) from start_control_before_rows t),'otherFunctions',(select count(*) from start_control_other_functions),'guardMeta',(select meta from start_control_guard_meta)) value;
rollback;
