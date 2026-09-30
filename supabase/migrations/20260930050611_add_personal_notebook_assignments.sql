begin;

-- A real source relation, not a synthetic vocabulary book. Existing rows keep
-- their original header dataset and all existing question/attempt records.
alter table public.assignments
  add column source_kind text not null default 'book' check(source_kind in('book','notebook')),
  add column points_policy_version text not null default 'vocab-points-v1',
  add constraint assignment_source_points_policy check(
    (source_kind='book' and points_policy_version='vocab-points-v1') or
    (source_kind='notebook' and points_policy_version='no-points-v1' and assignment_purpose='review'));
create table public.assignment_sources (
  assignment_id uuid not null references public.assignments(id) on delete cascade,
  dataset_id uuid not null references public.vocab_datasets(id) on delete restrict,
  primary key(assignment_id,dataset_id)
);
insert into public.assignment_sources select id,dataset_id from public.assignments;
alter table public.assignment_sources enable row level security;
revoke all on public.assignment_sources from public,anon,authenticated;
grant select on public.assignment_sources to authenticated,service_role;
create policy "active admins read assignment sources" on public.assignment_sources
  for select to authenticated using((select private.is_active_admin()));

alter table public.assignment_questions drop constraint assignment_questions_dataset_fkey;
alter table public.assignment_questions add constraint assignment_questions_dataset_fkey
  foreign key(assignment_id,dataset_id) references public.assignment_sources(assignment_id,dataset_id) on delete cascade;
alter table public.assignment_units drop constraint assignment_units_assignment_id_dataset_id_fkey;
alter table public.assignment_units add constraint assignment_units_assignment_id_dataset_id_fkey
  foreign key(assignment_id,dataset_id) references public.assignment_sources(assignment_id,dataset_id) on delete cascade;

create function private.sync_assignment_primary_source_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and (new.source_kind is distinct from old.source_kind or new.points_policy_version is distinct from old.points_policy_version
    or old.source_kind='notebook' and (to_jsonb(new)-array['status','deleted_at','deleted_by','updated_at']) is distinct from (to_jsonb(old)-array['status','deleted_at','deleted_by','updated_at'])) then
    raise exception 'assignment_source_policy_immutable' using errcode='55000';
  end if;
  insert into public.assignment_sources values(new.id,new.dataset_id) on conflict do nothing;
  if tg_op='UPDATE' and new.dataset_id is distinct from old.dataset_id then
    if exists(select 1 from public.assignment_questions where assignment_id=new.id)
      or exists(select 1 from public.assignment_units where assignment_id=new.id) then raise exception 'assignment_source_relation_mismatch' using errcode='23514'; end if;
    delete from public.assignment_sources where assignment_id=new.id and dataset_id=old.dataset_id;
  end if;
  return new;
end;
$$;
create trigger assignments_sync_primary_source after insert or update
  on public.assignments for each row execute function private.sync_assignment_primary_source_v1();

create function private.check_assignment_source_relation_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare aid uuid; a public.assignments;
begin
  if tg_op='UPDATE' and tg_table_name<>'assignments' and to_jsonb(new)->'assignment_id' is distinct from to_jsonb(old)->'assignment_id' then
    raise exception 'assignment_source_relation_immutable' using errcode='55000';
  end if;
  if tg_table_name='assignments' then aid:=case when tg_op='DELETE' then old.id else new.id end;
  else aid:=case when tg_op='DELETE' then old.assignment_id else new.assignment_id end; end if;
  select * into a from public.assignments where id=aid;
  if not found then return null; end if;
  if not exists(select 1 from public.assignment_sources where assignment_id=aid and dataset_id=a.dataset_id)
    or a.source_kind='book' and exists(select 1 from public.assignment_sources where assignment_id=aid and dataset_id<>a.dataset_id)
    or a.source_kind='notebook' and (
      (select count(*) from public.assignment_questions where assignment_id=aid)<>a.question_count
      or
      not exists(select 1 from public.assignment_questions where assignment_id=aid and dataset_id=a.dataset_id)
      or exists(select 1 from public.assignment_sources s where s.assignment_id=aid and not exists(
        select 1 from public.assignment_questions q where q.assignment_id=aid and q.dataset_id=s.dataset_id)))
    then raise exception 'assignment_source_relation_mismatch' using errcode='23514'; end if;
  return null;
end;
$$;
create constraint trigger assignment_sources_consistency after insert or update or delete on public.assignment_sources
  deferrable initially deferred for each row execute function private.check_assignment_source_relation_v1();
create constraint trigger assignment_header_sources_consistency after insert or update on public.assignments
  deferrable initially deferred for each row execute function private.check_assignment_source_relation_v1();
create constraint trigger assignment_question_sources_consistency after insert or update or delete on public.assignment_questions
  deferrable initially deferred for each row execute function private.check_assignment_source_relation_v1();

alter table public.assignment_questions
  add column notebook_source_event_id bigint references public.student_vocab_wrong_events(id) on delete restrict,
  add column notebook_source_snapshot jsonb,
  add column notebook_pronunciation_snapshot jsonb;
do $migration$
declare table_name text; constraint_name text; definition text;
begin
  for table_name,constraint_name in select * from(values
    ('assignments','assignments_provenance_status_check'),('assignment_questions','assignment_questions_provenance_status_check'),
    ('assignments','assignments_canonical_preview_v1_check'),('assignments','assignments_reviewed_exam_v1_check')) x(t,n) loop
    select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid=('public.'||table_name)::regclass and conname=constraint_name;
    if definition is null then raise exception 'notebook_proof_constraint_missing'; end if;
    execute format('alter table public.%I drop constraint %I',table_name,constraint_name);
    execute format('alter table public.%I add constraint %I check ((provenance_status = ''notebook_snapshot_v1'') or (%s))',table_name,constraint_name,substring(definition from 8 for char_length(definition)-8));
  end loop;
end;
$migration$;
alter table public.assignments add constraint assignments_notebook_proof check(
  (source_kind='book' and provenance_status<>'notebook_snapshot_v1') or coalesce((source_kind='notebook'
    and provenance_status='notebook_snapshot_v1' and range_basis='units' and question_bank_version=6
    and generator_version='notebook-bank-v1' and quiz_content_mode='book_meaning_choice' and question_bank_sha256 is not null),false));
alter table public.assignment_questions add constraint assignment_questions_notebook_proof check(
  (provenance_status<>'notebook_snapshot_v1' and notebook_source_event_id is null and notebook_source_snapshot is null and notebook_pronunciation_snapshot is null)
  or coalesce((provenance_status='notebook_snapshot_v1' and notebook_source_event_id is not null
    and jsonb_typeof(notebook_source_snapshot)='object' and jsonb_typeof(notebook_pronunciation_snapshot)='object'
    and jsonb_typeof(notebook_pronunciation_snapshot->'target')='object' and jsonb_typeof(notebook_pronunciation_snapshot->'choices')='array'
    and jsonb_array_length(notebook_pronunciation_snapshot->'choices')=4 and dataset_id is not null and headword_snapshot is not null
    and primary_meaning_snapshot is not null and generator_version_snapshot='notebook-bank-v1' and question_content_sha256 is not null
    and cardinality(choice_vocab_entry_ids)=4 and array_position(choice_vocab_entry_ids,null) is null
    and choice_vocab_entry_ids[correct_choice_index+1]=vocab_entry_id and correct_answer_snapshot=choices->>correct_choice_index),false));

create function private.guard_notebook_question_source_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare a public.assignments; ev public.student_vocab_wrong_events;
begin
  if tg_op='DELETE' then
    if exists(select 1 from public.assignments where id=old.assignment_id and source_kind='notebook') then raise exception 'notebook_question_immutable' using errcode='55000'; end if;
    return old;
  end if;
  select * into a from public.assignments where id=new.assignment_id;
  if a.source_kind<>'notebook' and new.provenance_status<>'notebook_snapshot_v1' then return new; end if;
  if tg_op='UPDATE' and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'notebook_question_immutable' using errcode='55000'; end if;
  select * into ev from public.student_vocab_wrong_events where id=new.notebook_source_event_id;
  if a.source_kind<>'notebook' or new.provenance_status<>'notebook_snapshot_v1' or ev.id is null
    or ev.wrong_stage<>'initial' or ev.vocab_entry_id<>new.vocab_entry_id or ev.dataset_id<>new.dataset_id
    or not exists(select 1 from public.assignment_students l where l.assignment_id=a.id and l.student_id=ev.student_id)
    or new.notebook_source_snapshot->>'studentId' is distinct from ev.student_id::text
    or new.notebook_source_snapshot->>'sourceQuestionId' is distinct from ev.quiz_question_id::text
    or new.notebook_source_snapshot->>'dictionaryId' is distinct from ev.canonical_dictionary_id_snapshot
    or new.canonical_lexeme_id_snapshot is distinct from ev.canonical_lexeme_id_snapshot
    or new.notebook_source_snapshot->>'releaseId' is distinct from ev.exam_use_release_id_snapshot::text
    or new.notebook_source_snapshot->>'occurrenceId' is distinct from ev.occurrence_id_snapshot
    then raise exception 'notebook_question_source_mismatch' using errcode='23514'; end if;
  return new;
end;
$$;
create trigger notebook_question_source_guard before insert or update or delete on public.assignment_questions
  for each row execute function private.guard_notebook_question_source_v1();

-- Original default remains untouched for book exams; notebook policy overrides
-- even an explicitly supplied default and is frozen by the existing update guard.
create or replace function private.default_quiz_attempt_point_rule_snapshot()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if exists(select 1 from public.assignments where id=new.assignment_id and source_kind='notebook' and points_policy_version='no-points-v1') then
    new.point_rule_version_snapshot:='no-points-v1';
  elsif new.point_rule_version_snapshot is null then new.point_rule_version_snapshot:='vocab-points-v1'; end if;
  return new;
end;
$$;
do $migration$
declare body text; needle text:=E'  if p_rule_version is null then';
begin
  body:=replace(pg_get_functiondef('private.record_vocab_quiz_point_events(uuid,uuid,text,timestamp with time zone)'::regprocedure),chr(13),'');
  if position(needle in body)=0 then raise exception 'notebook_points_hook_changed'; end if;
  execute replace(body,needle,E'  if p_rule_version = ''no-points-v1'' then return 0; end if;\n'||needle);
end;
$migration$;

create table private.notebook_assignment_requests (
  admin_id uuid not null references public.admin_profiles(user_id),
  request_key uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp(),
  primary key(admin_id,request_key)
);
alter table private.notebook_assignment_requests enable row level security;
revoke all on private.notebook_assignment_requests from public,anon,authenticated,service_role;
create function private.assert_notebook_admin_v1(p_admin_id uuid)
returns void language plpgsql stable security definer set search_path='' as $$
begin
  if auth.role() is distinct from 'service_role' or not exists(select 1 from public.admin_profiles where user_id=p_admin_id and is_active)
    then raise exception 'notebook_admin_required' using errcode='42501'; end if;
end;
$$;
create function public.get_notebook_assignment_result_v1(p_admin_id uuid,p_request_key uuid,p_request_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare row private.notebook_assignment_requests;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  select * into row from private.notebook_assignment_requests where admin_id=p_admin_id and request_key=p_request_key;
  if not found then return null; end if;
  if row.request_hash is distinct from p_request_hash then raise exception 'notebook_request_conflict' using errcode='40001'; end if;
  return row.result;
end;
$$;
create function public.prepare_notebook_assignment_source_v1(p_admin_id uuid,p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare source jsonb; student public.students;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  select * into student from public.students where id=p_student_id and status='active' and deleted_at is null;
  if not found then raise exception 'notebook_student_unavailable' using errcode='22023'; end if;
  if nullif(btrim(student.display_name),'') is null or nullif(btrim(student.school_name),'') is null or nullif(btrim(student.grade_label),'') is null
    then raise exception 'notebook_student_profile_required' using errcode='22023'; end if;
  source:=private.word_practice_source_v1(p_student_id,p_selection);
  source:=source||jsonb_build_object('student',jsonb_build_object('id',student.id,'displayName',student.display_name,'gradeLabel',student.grade_label,'schoolName',student.school_name));
  source:=source||jsonb_build_object('datasets',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'label',concat_ws(' · ',d.title,nullif(d.edition,'')),
      'gradeCode',c.grade_code,'available',d.status='ready' and d.is_active and coalesce(c.is_assignable,false)) order by d.id)
    from public.vocab_datasets d left join public.vocab_dataset_catalog c on c.dataset_id=d.id
    where d.id in(select (w->>'latestDatasetId')::uuid from jsonb_array_elements(source->'words') w)),'[]'));
  return source||jsonb_build_object('sourceHash',encode(extensions.digest(source::text,'sha256'),'hex'));
end;
$$;

create function private.assert_notebook_question_plan_v1(source jsonb,p_questions jsonb,p_settings jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare item jsonb; word jsonb; choice jsonb; direction text; correct integer; count_requested integer; ratio integer;
begin
  count_requested:=(p_settings->>'questionCount')::integer; ratio:=(p_settings->>'englishToKoreanRatio')::integer;
  if count_requested is null or count_requested not between 1 and 500 or ratio is null or ratio not in(0,50,100)
    or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)<>count_requested
    or (select count(distinct q->>'wordKey') from jsonb_array_elements(p_questions) q)<>count_requested
    or (select count(distinct q->'choiceSources'->((q->>'correctChoiceIndex')::integer)->>'entryId') from jsonb_array_elements(p_questions) q)<>count_requested
    or (select count(*) from jsonb_array_elements(p_questions) q where q->>'direction'='english_to_korean')<>round(count_requested*ratio/100.0)
    then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    select w into word from jsonb_array_elements(source->'words') w where w->>'key'=item->>'wordKey';
    direction:=item->>'direction';correct:=(item->>'correctChoiceIndex')::integer;
    if word is null or direction is null or direction not in('english_to_korean','korean_to_english') or correct is null or correct not between 0 and 3
      or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_array_length(item->'choices')<>4
      or jsonb_typeof(item->'choiceSources') is distinct from 'array' or jsonb_array_length(item->'choiceSources')<>4
      or jsonb_typeof(item->'choicePronunciations') is distinct from 'array' or jsonb_array_length(item->'choicePronunciations')<>4
      or jsonb_typeof(item->'pronunciation') is distinct from 'object'
      or item->>'prompt' is distinct from (case direction when 'english_to_korean' then word->>'headword' else word->>'primaryMeaning' end)
      or item->'choices'->>correct is distinct from (case direction when 'english_to_korean' then word->>'primaryMeaning' else word->>'headword' end)
      or item->'choiceSources'->correct->>'entryId' is distinct from word->>'latestVocabEntryId'
      or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'choices') v)<>4
      then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
    if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=word->>'latestVocabEntryId'
      and c->>'headword'=word->>'headword' and c->'eligibleDirections' ? direction)
      or not exists(select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=word->>'latestDatasetId' and d->'available'='true')
      then raise exception 'notebook_target_unavailable' using errcode='22023'; end if;
    perform private.assert_reviewed_choice_texts_v1(nullif(word->'choiceSafety','null'),direction,item->'choices',correct);
    for choice in select value||jsonb_build_object('index',n-1) from jsonb_array_elements(item->'choiceSources') with ordinality c(value,n) loop
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->'eligibleDirections' ? direction
        and exists(select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=c->>'datasetId' and d->'available'='true'))
        then raise exception 'notebook_choice_unavailable' using errcode='22023'; end if;
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->>'primaryMeaning'=choice->>'primaryMeaning')
        and not exists(select 1 from jsonb_array_elements(source->'words') w where w->>'latestVocabEntryId'=choice->>'entryId'
          and w->>'headword'=choice->>'headword' and w->>'primaryMeaning'=choice->>'primaryMeaning')
        then raise exception 'notebook_choice_source_mismatch' using errcode='22023'; end if;
      if item->'choices'->>((choice->>'index')::integer) is distinct from (case direction when 'english_to_korean' then choice->>'primaryMeaning' else choice->>'headword' end)
        then raise exception 'notebook_choice_source_mismatch' using errcode='22023'; end if;
    end loop;
  end loop;
end;
$$;

create function private.notebook_grade_v1(p_value text)
returns text language sql immutable set search_path='' as $$
  with value as(select lower(regexp_replace(normalize(btrim(coalesce(p_value,'')),NFKC),'\s','','g')) v)
  select case when v in('g7','g8','g9','g10','g11','g12') then v
    when v ~ '^(m|중|중학교)[1-3](학년)?$' then 'g'||((substring(v from '[1-3]'))::integer+6)::text
    when v ~ '^(h|고|고등학교)[1-3](학년)?$' then 'g'||((substring(v from '[1-3]'))::integer+9)::text end from value;
$$;

create function public.create_notebook_assignments_v1(p_admin_id uuid,p_request_key uuid,p_request_hash text,p_batches jsonb)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='55s' as $$
declare previous jsonb; batch jsonb; source jsonb; item jsonb; word jsonb; ev public.student_vocab_wrong_events;
  entry public.vocab_entries; aid uuid; sid uuid; representative uuid; ordinal integer; settings jsonb; qcount integer;
  mode text; seconds integer; per_seconds integer; score integer; retry boolean; retry_score integer; question_hash text;
  result jsonb:='[]'; source_sets jsonb:='{}';
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_request_key is null or p_request_hash is null or p_request_hash !~ '^[a-f0-9]{64}$' then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_request_key::text,914));
  previous:=public.get_notebook_assignment_result_v1(p_admin_id,p_request_key,p_request_hash);
  if previous is not null then return previous; end if;
  if jsonb_typeof(p_batches) is distinct from 'array' or jsonb_array_length(p_batches) not between 1 and 210
    or (select count(distinct b->>'studentId') from jsonb_array_elements(p_batches) b)<>jsonb_array_length(p_batches)
    or (select sum(jsonb_array_length(b->'questions')) from jsonb_array_elements(p_batches) b)>10000
    then raise exception 'notebook_invalid_batch' using errcode='22023'; end if;
  -- Consistent ordering prevents two bulk writers taking student locks in opposite order.
  perform 1 from public.students where id in(select (b->>'studentId')::uuid from jsonb_array_elements(p_batches) b) order by id for update;
  -- Protect the actual targets AND distractors before the final source read.
  -- Locks on a parent book alone do not protect updates to its existing entries.
  perform 1 from public.vocab_datasets d where d.id in(select e.dataset_id from public.vocab_entries e
    join jsonb_array_elements(p_batches) b on true cross join lateral jsonb_array_elements(b->'questions') q
    cross join lateral jsonb_array_elements(q->'choiceSources') c where e.id=(c->>'entryId')::bigint) order by d.id for share;
  perform 1 from public.vocab_dataset_catalog d where d.dataset_id in(select e.dataset_id from public.vocab_entries e
    join jsonb_array_elements(p_batches) b on true cross join lateral jsonb_array_elements(b->'questions') q
    cross join lateral jsonb_array_elements(q->'choiceSources') c where e.id=(c->>'entryId')::bigint) order by d.dataset_id for share;
  perform 1 from public.vocab_entries e where e.id in(select (c->>'entryId')::bigint from jsonb_array_elements(p_batches) b
    cross join lateral jsonb_array_elements(b->'questions') q cross join lateral jsonb_array_elements(q->'choiceSources') c) order by e.id for share;
  perform 1 from public.vocab_entry_quiz_eligibility e where e.vocab_entry_id in(select (c->>'entryId')::bigint from jsonb_array_elements(p_batches) b
    cross join lateral jsonb_array_elements(b->'questions') q cross join lateral jsonb_array_elements(q->'choiceSources') c) order by e.vocab_entry_id,e.quiz_mode for share;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid;
    source:=public.prepare_notebook_assignment_source_v1(p_admin_id,sid,batch->'selection');
    if source->>'sourceHash' is distinct from batch->>'sourceHash' then raise exception 'notebook_source_changed' using errcode='40001'; end if;
    if batch->>'audienceMode' is null or batch->>'audienceMode' not in('single','bulk')
      or (jsonb_array_length(p_batches)>1 and batch->>'audienceMode'<>'bulk') then raise exception 'notebook_invalid_audience' using errcode='22023'; end if;
    if batch->>'audienceMode'='bulk' and coalesce(batch->'gradeConfirmed','false')<>'true'::jsonb and exists(
      select 1 from jsonb_array_elements(source->'datasets') d join jsonb_array_elements(source->'words') w on w->>'latestDatasetId'=d->>'id'
      join jsonb_array_elements(batch->'questions') q on q->>'wordKey'=w->>'key'
      where private.notebook_grade_v1(d->>'gradeCode')<>private.notebook_grade_v1(source->'student'->>'gradeLabel')) then
      raise exception 'notebook_grade_review_required' using errcode='22023'; end if;
    settings:=batch->'settings'; mode:=settings->>'timingMode'; seconds:=(settings->>'timeLimitSeconds')::integer; per_seconds:=(settings->>'questionTimeLimitSeconds')::integer;
    score:=(settings->>'passingScore')::integer; retry:=(settings->>'retryEnabled')::boolean; retry_score:=(settings->>'retryPassingScore')::integer;
    if mode is null or mode not in('none','total','per_question') or score is null or score not between 0 and 100 or retry is null
      or (retry and (retry_score is null or retry_score not between 0 and 100)) or (not retry and retry_score is not null)
      or (mode='total' and (seconds is null or seconds not between 30 and 10800 or per_seconds is not null))
      or (mode='per_question' and (per_seconds is null or per_seconds not between 5 and 600 or seconds is not null))
      or (mode='none' and (seconds is not null or per_seconds is not null))
      then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
    perform private.assert_notebook_question_plan_v1(source,batch->'questions',settings);
    source_sets:=source_sets||jsonb_build_object(sid::text,source);
  end loop;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid; source:=source_sets->sid::text; settings:=batch->'settings'; qcount:=jsonb_array_length(batch->'questions');
    select (w->>'latestDatasetId')::uuid into representative from jsonb_array_elements(source->'words') w where w->>'key'=batch->'questions'->0->>'wordKey';
    insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,
      retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,timing_mode,question_time_limit_seconds,assignment_purpose,
      retry_enabled,retry_passing_score,source_kind,points_policy_version,provenance_status,quiz_content_mode,generator_version,question_bank_sha256,
      dataset_source_sha256_snapshot,eligibility_rule_version_snapshot)
    values('개인 오답',representative,1,1,qcount,(settings->>'englishToKoreanRatio')::smallint,coalesce((settings->>'timeLimitSeconds')::integer,10800),
      (settings->>'passingScore')::smallint,'initial',false,'active',p_admin_id,'units','random',6,settings->>'timingMode',(settings->>'questionTimeLimitSeconds')::integer,'review',
      (settings->>'retryEnabled')::boolean,(settings->>'retryPassingScore')::smallint,'notebook','no-points-v1','notebook_snapshot_v1','book_meaning_choice','notebook-bank-v1',
      upper(encode(extensions.digest((batch->'questions')::text,'sha256'),'hex')),(select upper(source_sha256) from public.vocab_datasets where id=representative),'notebook-current-eligibility-v1') returning id into aid;
    insert into public.assignment_students(assignment_id,student_id,assigned_by) values(aid,sid,p_admin_id);
    insert into public.assignment_sources(assignment_id,dataset_id)
      select distinct aid,(w->>'latestDatasetId')::uuid from jsonb_array_elements(source->'words') w join jsonb_array_elements(batch->'questions') q on q->>'wordKey'=w->>'key' on conflict do nothing;
    insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
      select aid,u.dataset_id,u.id,row_number() over(order by u.dataset_id,u.sort_index,u.id)::integer,false from public.vocab_units u where u.id in(
        select e.unit_id from public.vocab_entries e join jsonb_array_elements(source->'words') w on e.id=(w->>'latestVocabEntryId')::bigint
        join jsonb_array_elements(batch->'questions') q on q->>'wordKey'=w->>'key');
    ordinal:=0;
    for item in select value from jsonb_array_elements(batch->'questions') loop
      ordinal:=ordinal+1;
      select w into word from jsonb_array_elements(source->'words') w where w->>'key'=item->>'wordKey';
      select * into entry from public.vocab_entries where id=(word->>'latestVocabEntryId')::bigint and dataset_id=(word->>'latestDatasetId')::uuid for share;
      select e.* into ev from public.student_vocab_wrong_events e join public.quiz_questions q on q.id=e.quiz_question_id and q.vocab_entry_id=e.vocab_entry_id
        join public.quiz_attempts t on t.id=q.attempt_id and t.id=e.quiz_attempt_id and t.student_id=e.student_id
        where e.student_id=sid and e.quiz_question_id=(word->>'latestQuestionId')::uuid and e.vocab_entry_id=entry.id and e.dataset_id=entry.dataset_id and e.wrong_stage='initial';
      if ev.id is null then raise exception 'notebook_source_question_mismatch' using errcode='23514'; end if;
      question_hash:=upper(encode(extensions.digest(jsonb_build_object('sourceHash',source->>'sourceHash','sourceEventId',ev.id,'ordinal',ordinal,'question',item)::text,'sha256'),'hex'));
      insert into public.assignment_questions(assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id,entry_row_sha256_snapshot,
        eligibility_quiz_mode,headword_snapshot,headword_normalized_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,correct_answer_snapshot,
        content_origin,eligibility_rule_version_snapshot,generator_version_snapshot,question_content_sha256,provenance,provenance_status,canonical_lexeme_id_snapshot,
        notebook_source_event_id,notebook_source_snapshot,notebook_pronunciation_snapshot)
      values(aid,entry.id,ordinal,(item->>'direction')::public.question_direction,item->>'prompt',item->'choices',(item->>'correctChoiceIndex')::smallint,entry.dataset_id,upper(entry.row_sha256),
        case item->>'direction' when 'english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end,
        word->>'headword',lower(btrim(replace(word->>'headword','*',''))),word->>'primaryMeaning',array(select (c->>'entryId')::bigint from jsonb_array_elements(item->'choiceSources') c),
        item->'choices'->>((item->>'correctChoiceIndex')::integer),'book_occurrence','notebook-current-eligibility-v1','notebook-bank-v1',question_hash,
        jsonb_build_object('source','student-initial-wrong-event','sourceHash',source->>'sourceHash'),'notebook_snapshot_v1',ev.canonical_lexeme_id_snapshot,ev.id,
        jsonb_build_object('studentId',sid,'sourceQuestionId',ev.quiz_question_id,'wordKey',word->>'key','dictionaryId',ev.canonical_dictionary_id_snapshot,
          'releaseId',ev.exam_use_release_id_snapshot,'occurrenceId',ev.occurrence_id_snapshot,'sourceHash',source->>'sourceHash','study',word->'studySource'),
        jsonb_build_object('target',item->'pronunciation','choices',item->'choicePronunciations'));
    end loop;
    result:=result||jsonb_build_array(jsonb_build_object('studentId',sid,'assignmentId',aid,'questionCount',qcount));
  end loop;
  insert into private.notebook_assignment_requests(admin_id,request_key,request_hash,result) values(p_admin_id,p_request_key,p_request_hash,result);
  return result;
end;
$$;

-- Identity only: preserve the original exam approval table and never present a
-- new notebook question as an approved exam-use occurrence.
create view private.assignment_question_word_identity_v1 as
  select assignment_question_id,assignment_id,dataset_id,vocab_entry_id,dictionary_id,release_id,occurrence_id
    from public.assignment_question_exam_use_snapshot s
    where not exists(select 1 from public.assignment_questions q where q.id=s.assignment_question_id and q.provenance_status='notebook_snapshot_v1')
  union all
  select id,assignment_id,dataset_id,vocab_entry_id,notebook_source_snapshot->>'dictionaryId',
    (notebook_source_snapshot->>'releaseId')::uuid,notebook_source_snapshot->>'occurrenceId'
    from public.assignment_questions where provenance_status='notebook_snapshot_v1';
revoke all on private.assignment_question_word_identity_v1 from public,anon,authenticated,service_role;
grant select on private.assignment_question_word_identity_v1 to service_role;
-- Existing direct wrong-word review uses the actual question's book, not the
-- compatibility header. Do not add this guard to ordinary DAY assignments.
do $migration$
declare body text; updated text;
begin
  body:=replace(pg_get_functiondef('private.assert_assignment_words_available_v2(uuid[],uuid,jsonb)'::regprocedure),chr(13),'');
  if position('and assignment.dataset_id = p_dataset_id' in body)=0 then raise exception 'notebook_active_guard_hook_missing'; end if;
  updated:=replace(body,'and assignment.dataset_id = p_dataset_id','');
  updated:=replace(updated,'on question.assignment_id = link.assignment_id','on question.assignment_id = link.assignment_id and coalesce(question.dataset_id,assignment.dataset_id)=p_dataset_id');
  updated:=replace(updated,'public.assignment_question_exam_use_snapshot','private.assignment_question_word_identity_v1');
  execute updated;
  body:=replace(pg_get_functiondef('private.list_student_direct_review_candidates_v1(uuid,uuid)'::regprocedure),chr(13),'');
  if position('and assignment.dataset_id = counted.dataset_id' in body)=0 then raise exception 'notebook_direct_candidate_hook_missing'; end if;
  updated:=replace(body,'and assignment.dataset_id = counted.dataset_id','');
  updated:=replace(updated,'on active_question.assignment_id = assignment.id','on active_question.assignment_id = assignment.id and coalesce(active_question.dataset_id,assignment.dataset_id)=counted.dataset_id');
  updated:=replace(updated,'and active_entry.dataset_id = assignment.dataset_id','and active_entry.dataset_id = coalesce(active_question.dataset_id,assignment.dataset_id)');
  updated:=replace(updated,'and eligibility.dataset_id = assignment.dataset_id','and eligibility.dataset_id = active_entry.dataset_id');
  updated:=replace(updated,E'            assignment.dataset_id,\n            active_question.vocab_entry_id,',E'            active_entry.dataset_id,\n            active_question.vocab_entry_id,');
  updated:=replace(updated,'public.assignment_question_exam_use_snapshot','private.assignment_question_word_identity_v1');
  execute updated;
end;
$migration$;
do $migration$
declare signature text; body text; updated text; active_start integer; active_end integer; fragment text;
begin
  foreach signature in array array[
    'private.record_wrong_events_for_attempt(uuid,uuid,timestamp with time zone)',
    'private.snapshot_prior_wrong_count()','private.record_initial_wrong_events_when_review_starts()',
    'private.resolve_vocab_state_on_correct_answer()','private.snapshot_vocab_state_dictionary_identity_v1()',
    'private.snapshot_wrong_event_exam_use_identity_v1()','private.snapshot_review_queue_exam_use_identity_v1()',
    'private.snapshot_review_target_dictionary_identity_v1()','private.link_pending_review_targets_v2(uuid,uuid[],uuid[])',
    'public.list_assignment_question_dictionary_identities_v1(uuid[],uuid)'
  ] loop
    body:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    updated:=replace(body,'public.assignment_question_exam_use_snapshot','private.assignment_question_word_identity_v1');
    if updated=body then raise exception 'notebook_identity_hook_missing: %',signature; end if;
    execute updated;
  end loop;
  foreach signature in array array[
    'private.wrong_word_notebook_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer)',
    'private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])'
  ] loop
    body:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    active_start:=position('), active as materialized (' in body);active_end:=position('), occurrences as materialized (' in body);
    if active_start=0 or active_end<active_start then raise exception 'notebook_active_hook_missing'; end if;
    fragment:=substring(body from active_start for active_end-active_start);
    updated:=replace(replace(replace(fragment,'private.wrong_history_identity_v1(a.dataset_id,','private.wrong_history_identity_v1(aq.dataset_id,'),
      ' and aq.dataset_id = a.dataset_id',''),'public.assignment_question_exam_use_snapshot','private.assignment_question_word_identity_v1');
    body:=replace(body,fragment,updated);
    body:=replace(body,'''composition_verified_v1'')','''composition_verified_v1'',''notebook_snapshot_v1'')');
    if signature like '%page_v3%' then
      if position(E'      )\n      from public.quiz_questions q' in body)=0 then raise exception 'notebook_study_source_hook_missing'; end if;
      body:=replace(body,E'      )\n      from public.quiz_questions q',
        E'      ) || case when aq.provenance_status=''notebook_snapshot_v1'' then jsonb_build_object(''notebookPronunciation'',aq.notebook_pronunciation_snapshot->''target'') else ''{}''::jsonb end\n      from public.quiz_questions q');
      body:=replace(body,'''definition'',case when aq.provenance_status=', '''definition'',case when aq.provenance_status=''notebook_snapshot_v1'' then aq.notebook_source_snapshot#>>''{study,definition}'' when aq.provenance_status=');
      body:=replace(body,'''example'',case when aq.provenance_status=', '''example'',case when aq.provenance_status=''notebook_snapshot_v1'' then aq.notebook_source_snapshot#>>''{study,example}'' when aq.provenance_status=');
      body:=replace(body,'''exampleKo'',case when aq.provenance_status=', '''exampleKo'',case when aq.provenance_status=''notebook_snapshot_v1'' then aq.notebook_source_snapshot#>>''{study,exampleKo}'' when aq.provenance_status=');
    end if;
    execute body;
  end loop;
  body:=pg_get_functiondef('private.student_assignment_study_content_v1(uuid,uuid)'::regprocedure);
  updated:=replace(body,'''composition_verified_v1'')','''composition_verified_v1'',''notebook_snapshot_v1'')');
  updated:=replace(updated,'''compositionPronunciation'',q.composition_pronunciation_snapshot->''target'',',
    '''compositionPronunciation'',q.composition_pronunciation_snapshot->''target'',''notebookPronunciation'',q.notebook_pronunciation_snapshot->''target'',');
  updated:=replace(updated,'''definition'', case when q.provenance_status=', '''definition'', case when q.provenance_status=''notebook_snapshot_v1'' then q.notebook_source_snapshot#>>''{study,definition}'' when q.provenance_status=');
  updated:=replace(updated,'''example'', case when q.provenance_status=', '''example'', case when q.provenance_status=''notebook_snapshot_v1'' then q.notebook_source_snapshot#>>''{study,example}'' when q.provenance_status=');
  if updated=body then raise exception 'notebook_study_hook_missing'; end if;
  execute updated;
end;
$migration$;

-- Keep the current read builders (and their later fixes); add explicit source
-- metadata at the common projection, so all first/subsequent pages agree.
create function private.assignment_source_labels_v1(p_assignment_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select coalesce(jsonb_agg(jsonb_build_object('datasetId',s.dataset_id,'title',coalesce(c.display_name,concat_ws(' · ',d.title,nullif(d.edition,'')))) order by s.dataset_id),'[]')
  from public.assignment_sources s join public.vocab_datasets d on d.id=s.dataset_id
  left join public.vocab_dataset_catalog c on c.dataset_id=s.dataset_id where s.assignment_id=p_assignment_id
    and (auth.role()='service_role' or private.is_active_admin());
$$;
do $migration$
declare signature text; body text; updated text; needle text; f oid;
begin
  foreach signature in array array['private.admin_history_read_rows_v1(timestamp with time zone,uuid,uuid,uuid,text)','private.student_dashboard_read_rows_v2(uuid,timestamp with time zone)'] loop
    body:=pg_get_functiondef(signature::regprocedure);
    updated:=replace(body,'assignment.assignment_purpose,','assignment.assignment_purpose,assignment.source_kind,');
    updated:=replace(updated,'''assignmentPurpose'', classified.assignment_purpose,',
      '''assignmentPurpose'', classified.assignment_purpose) || jsonb_build_object(''sourceKind'',classified.source_kind,''sourceDatasets'',private.assignment_source_labels_v1(classified.assignment_id),');
    if updated=body or position('classified.source_kind' in updated)=0 then raise exception 'notebook_read_hook_missing: %',signature; end if;
    execute updated;
  end loop;
  select p.oid into strict f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='replace_student_assignment_v7';
  body:=replace(pg_get_functiondef(f),chr(13),'');
  needle:=E'  select coalesce(\n    array_agg(link.unit_id order by link.position)';
  if position(needle in body)=0 then raise exception 'notebook_edit_hook_missing'; end if;
  execute replace(body,needle,E'  if exists(select 1 from public.assignments where id=p_source_assignment_id and source_kind=''notebook'') then\n    raise exception ''notebook_assignment_edit_unsupported'' using errcode=''55000'';\n  end if;\n'||needle);
end;
$migration$;

-- Existing v2/v3 notebook readers and result calculations will be extended below;
-- they never receive write privileges to the source projection.
revoke all on function private.sync_assignment_primary_source_v1(),private.check_assignment_source_relation_v1(),
  private.guard_notebook_question_source_v1(),private.assert_notebook_admin_v1(uuid),private.assert_notebook_question_plan_v1(jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.notebook_grade_v1(text),private.assignment_source_labels_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function private.assignment_source_labels_v1(uuid) to authenticated,service_role;
revoke all on function public.get_notebook_assignment_result_v1(uuid,uuid,text),public.prepare_notebook_assignment_source_v1(uuid,uuid,jsonb),public.create_notebook_assignments_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.get_notebook_assignment_result_v1(uuid,uuid,text),public.prepare_notebook_assignment_source_v1(uuid,uuid,jsonb),public.create_notebook_assignments_v1(uuid,uuid,text,jsonb) to service_role;

commit;
