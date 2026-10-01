begin isolation level read committed;
set local application_name='m01_preview_case_1_A';
set local transaction_timeout='20s';
set local statement_timeout='18s';
set local lock_timeout='6s';
set local idle_in_transaction_session_timeout='5s';
select set_config('m01.a_result',private.import_vocabulary_library_core_v1($raw${"schemaVersion":"vocabulary-library-import-v1","sourceCatalogHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","linksHash":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","referenceCatalogHash":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","scopes":[{"key":"m01-qa-c1011001-import","name":"가짜 M01 import","sourceTitle":"M01 동시 등록 검사 자료","source":{"datasetId":"c1011001-6a01-4b01-8c01-000000000001","unitId":"c1011001-6a01-4b01-8c01-000000000002","kind":"legacy_vocab","releaseId":null,"releaseVersion":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fileHash":"1111111111111111111111111111111111111111111111111111111111111111","locator":"m01-qa-c1011001-import.json"},"classification":{"kind":"wordbook","sourceGrade":"g11","exam":null,"lesson":null,"day":1,"publisher":null,"school":null,"targetGrade":null,"schoolYear":null,"semester":null,"assessment":null,"purpose":null},"rows":[{"sourceRow":1,"rowHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","resources":{"entryHash":"eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee","linkRecordHash":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","selected":{"schemaVersion":"vocabulary-resource-snapshot-v1","sourceFields":{"headword":"m01synthetic","meaning":"검사 단어"},"proofs":{},"pronunciation":{"displayKo":"검사 발음","variantId":"fake:m01","audioUrl":null,"available":false},"lexicalPos":"noun","dictionary":null,"senseId":null,"definitionEn":"Synthetic definition A.","exampleEn":"A synthetic example.","exampleKo":"검사 예문."}}}]}]}$raw$,'wojxpruvbjzbhrpmsbuy')::text,true);
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
