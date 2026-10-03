begin read only; set local timezone='UTC'; set local datestyle='ISO, YMD'; select jsonb_build_object('at',clock_timestamp(),'tables',(select jsonb_agg(to_jsonb(t) order by schema_name,table_name) from (select 'private' schema_name,'assignment_release_links_v1' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."assignment_release_links_v1" t) q
union all
select 'private' schema_name,'assignment_replacement_requests' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."assignment_replacement_requests" t) q
union all
select 'private' schema_name,'assignment_study_examples_v1' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."assignment_study_examples_v1" t) q
union all
select 'private' schema_name,'assignment_vocabulary_meaning_refs' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."assignment_vocabulary_meaning_refs" t) q
union all
select 'private' schema_name,'assignment_vocabulary_new_questions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."assignment_vocabulary_new_questions" t) q
union all
select 'private' schema_name,'local_quiz_phase_plans' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."local_quiz_phase_plans" t) q
union all
select 'private' schema_name,'local_quiz_phase_receipts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."local_quiz_phase_receipts" t) q
union all
select 'private' schema_name,'local_quiz_preparations' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."local_quiz_preparations" t) q
union all
select 'private' schema_name,'local_quiz_runs' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."local_quiz_runs" t) q
union all
select 'private' schema_name,'notebook_question_origins_v2' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."notebook_question_origins_v2" t) q
union all
select 'private' schema_name,'quiz_attempt_preparations' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."quiz_attempt_preparations" t) q
union all
select 'private' schema_name,'quiz_preparation_compaction_checks' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."quiz_preparation_compaction_checks" t) q
union all
select 'private' schema_name,'quiz_preparation_expirations' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."quiz_preparation_expirations" t) q
union all
select 'private' schema_name,'quiz_start_control' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."quiz_start_control" t) q
union all
select 'private' schema_name,'student_vocabulary_meaning_states' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."student_vocabulary_meaning_states" t) q
union all
select 'private' schema_name,'student_vocabulary_versions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."student_vocabulary_versions" t) q
union all
select 'private' schema_name,'student_word_practice_questions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."student_word_practice_questions" t) q
union all
select 'private' schema_name,'student_word_practice_runs' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."student_word_practice_runs" t) q
union all
select 'private' schema_name,'vocabulary_answer_receipts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."vocabulary_answer_receipts" t) q
union all
select 'private' schema_name,'vocabulary_expired_answer_results' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."vocabulary_expired_answer_results" t) q
union all
select 'private' schema_name,'vocabulary_legacy_question_baselines' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."vocabulary_legacy_question_baselines" t) q
union all
select 'private' schema_name,'vocabulary_legacy_state_baselines' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."vocabulary_legacy_state_baselines" t) q
union all
select 'private' schema_name,'vocabulary_question_meaning_versions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."vocabulary_question_meaning_versions" t) q
union all
select 'private' schema_name,'worksheet_mistake_items' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "private"."worksheet_mistake_items" t) q
union all
select 'public' schema_name,'admin_profiles' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."admin_profiles" t) q
union all
select 'public' schema_name,'assignment_question_exam_use_snapshot' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_question_exam_use_snapshot" t) q
union all
select 'public' schema_name,'assignment_questions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_questions" t) q
union all
select 'public' schema_name,'assignment_quiz_mode_snapshots' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_quiz_mode_snapshots" t) q
union all
select 'public' schema_name,'assignment_review_targets' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_review_targets" t) q
union all
select 'public' schema_name,'assignment_sources' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_sources" t) q
union all
select 'public' schema_name,'assignment_students' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_students" t) q
union all
select 'public' schema_name,'assignment_units' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignment_units" t) q
union all
select 'public' schema_name,'assignments' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."assignments" t) q
union all
select 'public' schema_name,'notification_receipts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."notification_receipts" t) q
union all
select 'public' schema_name,'quiz_attempts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."quiz_attempts" t) q
union all
select 'public' schema_name,'quiz_questions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."quiz_questions" t) q
union all
select 'public' schema_name,'student_codes' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_codes" t) q
union all
select 'public' schema_name,'student_learning_sources' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_learning_sources" t) q
union all
select 'public' schema_name,'student_login_attempts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_login_attempts" t) q
union all
select 'public' schema_name,'student_point_events' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_point_events" t) q
union all
select 'public' schema_name,'student_point_totals' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_point_totals" t) q
union all
select 'public' schema_name,'student_sessions' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_sessions" t) q
union all
select 'public' schema_name,'student_vocab_review_assignment_draft_items' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_vocab_review_assignment_draft_items" t) q
union all
select 'public' schema_name,'student_vocab_review_assignment_drafts' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_vocab_review_assignment_drafts" t) q
union all
select 'public' schema_name,'student_vocab_review_queue' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_vocab_review_queue" t) q
union all
select 'public' schema_name,'student_vocab_state' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_vocab_state" t) q
union all
select 'public' schema_name,'student_vocab_wrong_events' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."student_vocab_wrong_events" t) q
union all
select 'public' schema_name,'students' table_name,count(*) amount,encode(extensions.digest(convert_to(coalesce(string_agg(h,chr(10) order by h),''),'UTF8'),'sha256'),'hex') fingerprint from (select encode(extensions.digest(convert_to(to_jsonb(t)::text,'UTF8'),'sha256'),'hex') h from "public"."students" t) q)t),'function',(select to_jsonb(p) from pg_proc p where oid='public.claim_student_notifications_v1(uuid)'::regprocedure),'otherFunctions',(select count(*) from pg_proc p where pronamespace in ('public'::regnamespace,'private'::regnamespace) and oid<>'public.claim_student_notifications_v1(uuid)'::regprocedure)) value; commit;
