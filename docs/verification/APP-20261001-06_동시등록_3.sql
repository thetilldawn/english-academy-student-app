begin isolation level read committed;
set local application_name='m01_preview_case_3_A';
set local transaction_timeout='20s';
set local statement_timeout='18s';
set local lock_timeout='6s';
set local idle_in_transaction_session_timeout='5s';
do $register$
declare bundle jsonb:=$raw${"schemaVersion":"vocabulary-library-import-v1","sourceCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","linksHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","referenceCatalogHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","scopes":[{"key":"m01-qa-c1011001-binding","name":"가짜 M01 binding","sourceTitle":"M01 동시 등록 검사 자료","source":{"datasetId":"c1011001-6a01-4b01-8c01-000000000001","unitId":"c1011001-6a01-4b01-8c01-000000000002","kind":"legacy_vocab","releaseId":null,"releaseVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fileHash":"3333333333333333333333333333333333333333333333333333333333333333","locator":"m01-qa-c1011001-binding.json"},"classification":{"kind":"wordbook","sourceGrade":"g11","exam":null,"lesson":null,"day":1,"publisher":null,"school":null,"targetGrade":null,"schoolYear":null,"semester":null,"assessment":null,"purpose":null},"rows":[{"sourceRow":1,"rowHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","resources":{"entryHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","linkRecordHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","selected":{"schemaVersion":"vocabulary-resource-snapshot-v1","sourceFields":{"headword":"m01synthetic","meaning":"검사 단어"},"proofs":{},"pronunciation":{"displayKo":"검사 발음","variantId":"fake:m01","audioUrl":null,"available":false},"lexicalPos":"noun","dictionary":null,"senseId":null,"definitionEn":"Synthetic definition B.","exampleEn":"A synthetic example.","exampleKo":"검사 예문."}}}]}]}$raw$::jsonb; s jsonb; src jsonb; entry_doc jsonb; resources_doc jsonb; source_doc jsonb; value_doc jsonb; vh text; bh text; result jsonb;
begin
 s:=bundle->'scopes'->0; src:=s->'source'; resources_doc:=s->'rows'->0->'resources';
 select to_jsonb(e) into strict entry_doc from public.vocab_entries e where e.dataset_id=(src->>'datasetId')::uuid and e.unit_id=(src->>'unitId')::uuid and e.source_row=1;
 source_doc:=jsonb_build_object('kind','legacy_vocab','datasetId',src->'datasetId','unitId',src->'unitId','releaseId',null,'version',src->'releaseVersion','fileHash',src->'fileHash','locator',src->'locator','sourceRow',1,
 'occurrenceKey',private.reviewed_exam_sha256_v1(jsonb_build_array('legacy_vocab',(src->>'datasetId')::uuid,null::uuid,src->>'releaseVersion',src->>'fileHash',1)),'state','included');
 value_doc:=private.project_vocabulary_learning_value_v1(entry_doc,resources_doc->'selected');
 vh:=private.reviewed_exam_sha256_v1(value_doc);
 bh:=private.reviewed_exam_sha256_v1(private.project_vocabulary_learning_binding_v1(entry_doc,null,resources_doc,source_doc,vh));
 if (select count(*) from private.vocabulary_learning_value_versions where selection_sha256=vh)<>1
 or exists(select 1 from private.vocabulary_learning_value_bindings where binding_sha256=bh) then raise exception 'm01_race_initial_state_mismatch'; end if;
 result:=private.register_vocabulary_learning_resources_v1(entry_doc,null,resources_doc,source_doc);
 perform set_config('m01.a_result',result::text,true);
 perform set_config('m01.expected_hashes',jsonb_build_object('selectionHash',vh,'bindingHash',bh)::text,true);
end $register$;
do $observe$
declare seen jsonb; until_time timestamptz:=clock_timestamp()+interval '14 seconds';
begin
 loop
  perform pg_stat_clear_snapshot();
  select jsonb_agg(jsonb_build_object('pidA',pg_backend_pid(),'pidB',a.pid,'waitEventType',a.wait_event_type,'waitEvent',a.wait_event,'blockingPids',pg_blocking_pids(a.pid),'observedAt',clock_timestamp(),'queryStartedAt',a.query_start,
  'locksB',(select jsonb_agg(jsonb_build_object('type',l.locktype,'mode',l.mode,'granted',l.granted,'relation',l.relation::regclass::text,'transactionId',l.transactionid::text)) from pg_locks l where l.pid=a.pid),
  'locksA',(select jsonb_agg(jsonb_build_object('type',l.locktype,'mode',l.mode,'granted',l.granted,'relation',l.relation::regclass::text,'transactionId',l.transactionid::text)) from pg_locks l where l.pid=pg_backend_pid())))
  into seen from pg_stat_activity a where a.pid<>pg_backend_pid() and a.state='active' and a.wait_event_type='Lock' and a.wait_event='transactionid' and pg_backend_pid()=any(pg_blocking_pids(a.pid)) and a.query like '%import_vocabulary_library_v1%';
  if seen is not null then
   if jsonb_array_length(seen)<>1 then raise exception 'm01_ambiguous_blocked_connections'; end if;
   perform set_config('m01.observed',seen::text,true); exit;
  end if;
  if clock_timestamp()>=until_time then raise exception 'm01_actual_lock_not_observed'; end if;
  perform pg_sleep(0.1);
 end loop;
end $observe$;
select current_setting('m01.observed')::jsonb observation,current_setting('m01.a_result')::jsonb a_result,clock_timestamp() before_commit_at;
commit;
