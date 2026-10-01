begin;
set local statement_timeout='8s';
do $guard$ begin
 if not exists(select 1 from public.vocab_datasets where id='c1011001-6a01-4b01-8c01-000000000001' and dataset_key='m01-qa-c1011001-source' and metadata @> '{"qa":"APP-20261001-06","synthetic":true}'::jsonb) then raise exception 'm01_cleanup_scope_mismatch'; end if;
 if (select count(*) from private.vocabulary_library_scopes where dataset_id='c1011001-6a01-4b01-8c01-000000000001')<>3 then raise exception 'm01_cleanup_count_mismatch'; end if;
end $guard$;
update public.vocab_dataset_catalog set is_assignable=false where dataset_id='c1011001-6a01-4b01-8c01-000000000001';
update public.vocab_datasets set status='retired',is_active=false where id='c1011001-6a01-4b01-8c01-000000000001' and dataset_key='m01-qa-c1011001-source';
commit;
select jsonb_build_object(
'activeFixtureDatasets',(select count(*) from public.vocab_datasets where id='c1011001-6a01-4b01-8c01-000000000001' and is_active),
'assignableFixtureDatasets',(select count(*) from public.vocab_dataset_catalog where dataset_id='c1011001-6a01-4b01-8c01-000000000001' and is_assignable),
'studentAssignments',(select count(*) from public.assignments where dataset_id='c1011001-6a01-4b01-8c01-000000000001'),
'scopeAvailability',(select jsonb_agg(jsonb_build_object('id',s.id,'key',s.scope_key,'state',private.vocabulary_library_source_state_v1(s)) order by s.scope_key) from private.vocabulary_library_scopes s where s.dataset_id='c1011001-6a01-4b01-8c01-000000000001'),
'activeQaTransactions',(select count(*) from pg_stat_activity where application_name like 'm01_preview_%' and state<>'idle'),
'newTableAllocation',(select jsonb_agg(jsonb_build_object('table',c.oid::regclass::text,'bytes',pg_total_relation_size(c.oid))) from pg_class c where c.oid in('private.vocabulary_learning_value_versions'::regclass,'private.vocabulary_learning_value_bindings'::regclass,'private.vocabulary_composition_storage_formats'::regclass))
) cleanup;
