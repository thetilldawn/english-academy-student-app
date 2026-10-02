begin;

-- APP-20261002-01: expected stale selections must return once, not retry forever.
-- PostgREST 14 retries custom 40001 errors. Preserve native serialization errors.
-- https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b
-- Only the reviewed M03 functions and their source, preparation and practice helpers change.
-- No row, ACL, owner or OID changes. The one accepted local source hash differs
-- only in pre-existing audit-reason encoding; retain the actual stored text.
do $domain_conflicts$
declare target jsonb; source text; definition text; function_id oid; occurrences integer;
begin
  for target in select value from jsonb_array_elements($targets$[
  {
    "signature": "private.assert_mixed_review_queue_snapshot_v1(uuid,uuid,smallint[],uuid[])",
    "source_hash": "aca1264ac71336709c4386ede08a4f30",
    "count": 1
  },
  {
    "signature": "private.assert_vocabulary_mistake_targets_v1(uuid,jsonb)",
    "source_hash": "d4283166941157e8e4dc3feb277d5c1c",
    "count": 3
  },
  {
    "signature": "private.assert_vocabulary_review_bank_v1(uuid,uuid,uuid[])",
    "source_hash": "cdb2353ca42f9815eee5d31733848de3",
    "count": 4
  },
  {
    "signature": "private.assert_vocabulary_review_queue_current_v1(uuid,uuid[])",
    "source_hash": "53e75b1b9500878afbf747b934ef9b5c",
    "count": 2
  },
  {
    "signature": "private.create_book_mistake_bank_v1(uuid,uuid,jsonb,jsonb,jsonb)",
    "source_hash": "3a63f84060b234512d2e29219964b963",
    "count": 2
  },
  {
    "signature": "private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)",
    "source_hash": "8c6363be4b0e0141a491948adc547beb",
    "count": 1
  },
  {
    "signature": "private.create_mixed_mistake_bank_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb)",
    "source_hash": "39dffd72e5b774dbb84e6c692decbc8e",
    "count": 13
  },
  {
    "signature": "private.create_mixed_review_assignment_v6(uuid,uuid,smallint[],uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)",
    "source_hash": "11d99f57a09eb4b67e92d66acef2ed5d",
    "count": 2
  },
  {
    "signature": "private.create_mixed_review_assignment_v8(uuid,uuid,smallint[],text,uuid[],text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)",
    "source_hash": "9f9ffaed4e4d30e9ce2650b2538f9fc2",
    "count": 1
  },
  {
    "signature": "private.create_notebook_mistake_bank_v2(uuid,uuid,jsonb,jsonb,jsonb)",
    "source_hash": "f34ef376b3c5b561d7e9b331c5d7aace",
    "count": 2
  },
  {
    "signature": "private.freeze_assignment_vocabulary_meanings_v1(uuid)",
    "source_hash": "7d93e49f80319aefdd416edceaba7ecb",
    "count": 2
  },
  {
    "signature": "private.guard_vocabulary_review_queue_v1()",
    "source_hash": "c3f028d8f2de25adbf757c3b93208ece",
    "count": 5
  },
  {
    "signature": "private.insert_mixed_primary_questions_v1(uuid,uuid,uuid,uuid[],uuid[],integer,integer,jsonb)",
    "source_hash": "0972d595cc9d4a5ccbda3ac1b6f2ed12",
    "count": 1
  },
  {
    "signature": "private.link_pending_review_targets_v2(uuid,uuid[],uuid[])",
    "source_hash": "00cfa59436863d18d31646978c9cafe1",
    "count": 1
  },
  {
    "signature": "private.mistake_word_practice_source_v1(uuid,jsonb)",
    "source_hash": "112f524fecf6ec0afd99ade0c868efed",
    "count": 3
  },
  {
    "signature": "private.persist_exact_review_assignment_exam_use_v7_compat(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)",
    "source_hash": "e58b24ea5e438ef574680521ebd15153",
    "count": 6
  },
  {
    "signature": "private.persist_review_assignment_v5(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)",
    "source_hash": "63d073d6ca0db42d5821e33f04ca24ff",
    "count": 6
  },
  {
    "signature": "private.preview_new_primary_meanings_v1(uuid,uuid[],jsonb)",
    "source_hash": "1276b77d3061b3b00db3f25d14a42efa",
    "count": 1
  },
  {
    "signature": "private.queue_notebook_mistake_targets_v2(uuid,uuid[],jsonb,uuid)",
    "source_hash": "cbbe5b50116327b7e9f10b00267109da",
    "count": 2
  },
  {
    "signature": "private.queue_student_vocabulary_targets_v1(uuid,uuid[],jsonb)",
    "source_hash": "ed86562de2cceaa211ef4c1de6a9c30b",
    "count": 2
  },
  {
    "signature": "private.reject_active_review_queue_consumption()",
    "source_hash": "048f8ac839ec526da6b9eee8d3581316",
    "count": 1
  },
  {
    "signature": "private.reject_duplicate_active_review_target()",
    "source_hash": "0bd1300e81f58602b2a440111707b164",
    "count": 2
  },
  {
    "signature": "private.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)",
    "source_hash": "55578e7138edd23b9e5bd678d0b91d2a",
    "count": 6,
    "local_source_hash": "883b2a0a9725be0a4273dee59df2b3f9"
  },
  {
    "signature": "private.vocabulary_mistake_episode_page_v1(uuid,text,bigint,jsonb,boolean)",
    "source_hash": "9d9dc5b891f7951db4edab41d1cf3008",
    "count": 3
  },
  {
    "signature": "private.vocabulary_mistake_page_v1(uuid,jsonb,jsonb,boolean)",
    "source_hash": "03af39139b767719acc114e381de51f0",
    "count": 3
  },
  {
    "signature": "public.begin_prepared_practice_v1(uuid,uuid)",
    "source_hash": "abcadd341740aa033fec21204f2012fa",
    "count": 1
  },
  {
    "signature": "public.create_book_mistake_assignments_v1(uuid,uuid,text,jsonb)",
    "source_hash": "33fb99d1ef41e6cd267049cba621c236",
    "count": 2
  },
  {
    "signature": "public.create_mixed_mistake_assignments_v1(uuid,uuid,text,jsonb)",
    "source_hash": "655fbb3cfacaff038ec7750bc36c1144",
    "count": 6
  },
  {
    "signature": "public.create_notebook_assignments_v2(uuid,uuid,text,jsonb)",
    "source_hash": "6d9fa40fb13fdb64ba7fcc8caaa41b09",
    "count": 2
  },
  {
    "signature": "public.find_word_practice_preparation_v1(uuid,uuid,text)",
    "source_hash": "f19833d0ca27ccf70d929c8983804e27",
    "count": 2
  },
  {
    "signature": "public.get_quiz_preparation_v1(uuid,uuid)",
    "source_hash": "7cd25abe0e1f75f4c9993d010aea1f26",
    "count": 1
  },
  {
    "signature": "public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)",
    "source_hash": "e28cb64f4ccd576a4d74eb24fadbe8d8",
    "count": 2
  },
  {
    "signature": "public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)",
    "source_hash": "cff6777037a31c6b0bf31a6c0ffeb2f4",
    "count": 3
  },
  {
    "signature": "public.get_notebook_assignment_result_v1(uuid,uuid,text)",
    "source_hash": "f5d17b26bd171e9a8b28d624485ddcf0",
    "count": 1
  },
  {
    "signature": "private.resolve_vocabulary_learning_binding_v1(jsonb)",
    "source_hash": "aa66ac5bbe2c140d7bc841c22294fec0",
    "count": 2
  },
  {
    "signature": "private.resolve_vocabulary_learning_value_v1(jsonb)",
    "source_hash": "fe0b31989aae0d6d3c8f76d86978404f",
    "count": 2
  },
  {
    "signature": "private.register_vocabulary_question_content_v1(text,uuid[],jsonb,jsonb,text)",
    "source_hash": "c0bf7015c8d5f1931814f2b765b10b32",
    "count": 1
  },
  {
    "signature": "public.read_question_contents_v1(text,uuid,uuid,uuid[])",
    "source_hash": "d208bb420344c843695e0a439bb6d013",
    "count": 2
  },
  {
    "signature": "public.answer_student_word_practice_v1(uuid,uuid,uuid,integer)",
    "source_hash": "c787d741bfcaf92ba81d6bad11f7fd60",
    "count": 5
  },
  {
    "signature": "public.expire_student_word_practice_v1(uuid,uuid)",
    "source_hash": "ed8a355d2e59488fbbe1f5a096363ac2",
    "count": 1
  },
  {
    "signature": "public.get_student_word_practice_v1(uuid,uuid,uuid,text,timestamp with time zone,uuid)",
    "source_hash": "948f66688333a965cb0b45e8f0d9b609",
    "count": 1
  },
  {
    "signature": "public.resume_student_word_practice_v1(uuid,uuid,uuid,integer)",
    "source_hash": "8ea307ed8883896b7c11fe07fc18cb0f",
    "count": 1
  },
  {
    "signature": "public.begin_prepared_quiz_v1(uuid,uuid)",
    "source_hash": "add35e3174dc4870ad400c61c52a902f",
    "count": 2
  }
]$targets$::jsonb) loop
    function_id := to_regprocedure(target->>'signature');
    if function_id is null then raise exception 'vocabulary_conflict_function_missing'; end if;
    select replace(p.prosrc,E'\r',''),pg_get_functiondef(p.oid) into source,definition from pg_proc p where p.oid=function_id;
    occurrences := (length(source)-length(replace(source,'''40001''','')))/7;
    if (md5(source) is distinct from target->>'source_hash'
        and md5(source) is distinct from target->>'local_source_hash')
       or occurrences<>(target->>'count')::integer then
      raise exception 'vocabulary_conflict_function_changed: %',target->>'signature' using errcode='55000';
    end if;
    execute replace(definition,'''40001''','''PT409''');
  end loop;
end;
$domain_conflicts$;

commit;

