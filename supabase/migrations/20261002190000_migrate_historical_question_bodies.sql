-- APP-20261003-02. Operator-only, explicit historical content migration.
-- No automatic backfill, no student state writes, no trigger/GUC bypass.
begin;

create table private.historical_question_migrations (
  id uuid primary key default gen_random_uuid(),
  kind text not null check(kind in ('assignment','quiz','exam-use')),
  row_id uuid not null,
  assignment_id uuid not null references public.assignments(id),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  body_sha256 text not null check(body_sha256 ~ '^[a-f0-9]{64}$'),
  identity_sha256 text not null check(identity_sha256 ~ '^[a-f0-9]{64}$'),
  content_version_id uuid not null references private.vocabulary_question_content_versions(id),
  meaning jsonb not null,
  state text not null default 'prepared' check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp(),
  unique(kind,row_id,original_sha256)
);
create table private.historical_question_migration_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.historical_question_write_permits (
  backend_pid integer not null,
  transaction_id bigint not null,
  relation_id oid not null,
  before_sha256 text not null,
  after_sha256 text not null,
  primary key(backend_pid,transaction_id,relation_id,before_sha256)
);
alter table private.historical_question_migrations enable row level security;
alter table private.historical_question_migration_receipts enable row level security;
alter table private.historical_question_write_permits enable row level security;
revoke all on private.historical_question_migrations,private.historical_question_migration_receipts,
  private.historical_question_write_permits from public,anon,authenticated,service_role;
create trigger historical_question_receipt_immutable before update or delete on private.historical_question_migration_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.historical_question_spec_v1(p_kind text) returns jsonb
language plpgsql immutable set search_path='' as $$
begin
  if p_kind='assignment' then return jsonb_build_object('relation','public.assignment_questions','key','id','body',array[
    'prompt','choices','headword_snapshot','primary_meaning_snapshot','correct_answer_snapshot','provenance',
    'composition_pronunciation_snapshot','notebook_pronunciation_snapshot']);
  elsif p_kind='quiz' then return jsonb_build_object('relation','public.quiz_questions','key','id','body',array['prompt','choices']);
  elsif p_kind='exam-use' then return jsonb_build_object('relation','public.assignment_question_exam_use_snapshot','key','assignment_question_id','body',array[
    'headword_snapshot','primary_meaning_snapshot','display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots']);
  end if;
  raise exception 'historical_question_kind_invalid' using errcode='22023';
end $$;

create function private.historical_question_document_v1(p_kind text,p_row jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare spec jsonb:=private.historical_question_spec_v1(p_kind); fields text[]; identity_doc jsonb;
begin
  select array_agg(value) into fields from jsonb_array_elements_text(spec->'body');
  if p_kind='quiz' then
    identity_doc:=private.vocabulary_question_json_fields_v1(p_row,array[
      'id','attempt_id','assignment_question_id','vocab_entry_id','order_index','direction','correct_choice_index']);
  else identity_doc:=p_row-fields-'content_version_id'; end if;
  return jsonb_build_object('kind',p_kind,'identity',identity_doc,'body',private.vocabulary_question_json_fields_v1(p_row,fields),
    'contentVersionId',p_row->'content_version_id');
end $$;

create function private.historical_question_row_v1(p_kind text,p_row_id uuid,p_lock boolean default false) returns jsonb
language plpgsql set search_path='' as $$
declare spec jsonb:=private.historical_question_spec_v1(p_kind); answer jsonb;
begin
  execute format('select to_jsonb(q) from %s q where %I=$1%s',
    (spec->>'relation')::regclass,spec->>'key',case when p_lock then ' for update' else '' end) into answer using p_row_id;
  if answer is null then raise exception 'historical_question_missing' using errcode='P0002'; end if;
  return answer;
end $$;

create function private.historical_question_assignment_v1(p_kind text,p_row jsonb) returns uuid
language plpgsql stable set search_path='' as $$
declare answer uuid;
begin
  if p_kind in('assignment','exam-use') then answer:=(p_row->>'assignment_id')::uuid;
  elsif p_kind='quiz' then select assignment_id into answer from public.quiz_attempts where id=(p_row->>'attempt_id')::uuid;
  end if;
  if answer is null then raise exception 'historical_question_assignment_missing' using errcode='23503'; end if;
  return answer;
end $$;

create function private.historical_question_participants_v1(p_assignment_id uuid) returns uuid[]
language sql stable set search_path='' as $$
  select coalesce(array_agg(student_id order by student_id),'{}'::uuid[]) from (
    select student_id from public.assignment_students where assignment_id=p_assignment_id
    union select student_id from public.quiz_attempts where assignment_id=p_assignment_id
    union select student_id from private.quiz_attempt_preparations where assignment_id=p_assignment_id
  ) students;
$$;

create function private.lock_historical_question_assignment_v1(p_assignment_id uuid,p_compact boolean) returns void
language plpgsql set search_path='' as $$
declare participants uuid[]; settings public.assignments; student_id uuid;
begin
  participants:=private.historical_question_participants_v1(p_assignment_id);
  foreach student_id in array participants loop perform private.lock_vocabulary_student_v1(student_id); end loop;
  select * into settings from public.assignments where id=p_assignment_id for update;
  if settings.id is null then raise exception 'historical_question_assignment_missing' using errcode='P0002'; end if;
  if participants is distinct from private.historical_question_participants_v1(p_assignment_id)
    then raise exception 'historical_question_participants_changed' using errcode='40001'; end if;
  perform 1 from public.quiz_attempts where assignment_id=p_assignment_id order by id for update;
  perform 1 from private.quiz_attempt_preparations where assignment_id=p_assignment_id order by id for update;
  if not p_compact then return; end if;
  if not coalesce(settings.status='closed' or settings.deleted_at is not null
      or (isfinite(settings.available_until) and settings.available_until<clock_timestamp()),false)
    then raise exception 'historical_question_assignment_open' using errcode='55000'; end if;
  if exists(select 1 from public.quiz_attempts where assignment_id=p_assignment_id
      and (status='in_progress' or completed_at is null or phase in('review','retry')))
    then raise exception 'historical_question_attempt_pending' using errcode='55000'; end if;
  -- A server cannot infer whether a device still holds answers. Exclude every
  -- local protocol run rather than guessing from elapsed time or a summary.
  if exists(select 1 from private.local_quiz_runs r join public.quiz_attempts a on a.id=r.attempt_id where a.assignment_id=p_assignment_id)
    or exists(select 1 from private.local_quiz_preparations l join private.quiz_attempt_preparations p on p.id=l.preparation_id where p.assignment_id=p_assignment_id)
    then raise exception 'historical_question_device_bound' using errcode='55000'; end if;
  if exists(select 1 from private.vocabulary_result_policies r join public.quiz_attempts a on a.id=r.attempt_id where a.assignment_id=p_assignment_id)
    then raise exception 'historical_question_result_policy' using errcode='55000'; end if;
  if exists(select 1 from private.quiz_attempt_preparations where assignment_id=p_assignment_id and begun_id is null)
    then raise exception 'historical_question_preparation_pending' using errcode='55000'; end if;
  if exists(select 1 from public.assignment_questions where assignment_id=p_assignment_id and provenance_status='notebook_snapshot_v1')
    then raise exception 'historical_question_personal_source' using errcode='55000'; end if;
end $$;

create function private.historical_question_meaning_v1(p_kind text,p_row jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin
  if p_kind='quiz' then return private.quiz_vocabulary_meaning_v1((p_row->>'id')::uuid); end if;
  return private.assignment_vocabulary_meaning_v1((p_row->>(case when p_kind='assignment' then 'id' else 'assignment_question_id' end))::uuid);
end $$;

create function private.historical_question_resolve_v1(p_kind text,p_row jsonb) returns jsonb
language plpgsql stable set search_path='' as $$
begin
  if p_kind='assignment' then return to_jsonb(private.resolve_assignment_question_content_v1(jsonb_populate_record(null::public.assignment_questions,p_row)));
  elsif p_kind='quiz' then return to_jsonb(private.resolve_quiz_question_content_v1(jsonb_populate_record(null::public.quiz_questions,p_row)));
  elsif p_kind='exam-use' then return to_jsonb(private.resolve_exam_use_question_content_v1(jsonb_populate_record(null::public.assignment_question_exam_use_snapshot,p_row)));
  end if;
  raise exception 'historical_question_kind_invalid' using errcode='22023';
end $$;

create function private.prepare_historical_question_batch_v1(p_assignment_id uuid,p_kind text,p_row_ids uuid[]) returns jsonb
language plpgsql set search_path='' as $$
declare selected_row_id uuid; original jsonb; document jsonb; resolved jsonb; reference uuid;
  spec jsonb:=private.historical_question_spec_v1(p_kind); candidate private.historical_question_migrations;
  fields text[]; identity_doc jsonb; meaning_doc jsonb; answer jsonb:='[]'; fingerprint text;
begin
  if current_user<>'postgres' then raise exception 'historical_question_operator_required' using errcode='42501'; end if;
  if p_row_ids is null or cardinality(p_row_ids) not between 1 and 100 or array_position(p_row_ids,null) is not null
    or cardinality(p_row_ids)<>(select count(distinct x) from unnest(p_row_ids)x)
    then raise exception 'historical_question_batch_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(61003,2);
  perform private.lock_historical_question_assignment_v1(p_assignment_id,true);
  select array_agg(value) into fields from jsonb_array_elements_text(spec->'body');
  for selected_row_id in select x from unnest(p_row_ids)x order by x loop
    original:=private.historical_question_row_v1(p_kind,selected_row_id,true);
    if private.historical_question_assignment_v1(p_kind,original) is distinct from p_assignment_id
      then raise exception 'historical_question_assignment_mismatch' using errcode='23514'; end if;
    if original->>'content_version_id' is not null then raise exception 'historical_question_already_referenced' using errcode='55000'; end if;
    document:=private.historical_question_document_v1(p_kind,original);
    fingerprint:=private.reviewed_exam_sha256_v1(document);
    meaning_doc:=private.historical_question_meaning_v1(p_kind,original);
    if p_kind='assignment' then
      perform private.assert_assignment_question_body_v1(jsonb_populate_record(null::public.assignment_questions,original));
      reference:=private.register_assignment_question_content_v1(jsonb_populate_record(null::public.assignment_questions,original));
    elsif p_kind='quiz' then
      reference:=private.register_quiz_question_content_v1(jsonb_populate_record(null::public.quiz_questions,original),p_assignment_id);
    else
      perform private.assert_exam_use_question_body_v1(jsonb_populate_record(null::public.assignment_question_exam_use_snapshot,original));
      reference:=private.register_vocabulary_question_content_v1('exam-use',array[(original->>'dataset_id')::uuid],
        private.exam_use_question_binding_v1(jsonb_populate_record(null::public.assignment_question_exam_use_snapshot,original)),document->'body');
    end if;
    resolved:=private.historical_question_resolve_v1(p_kind,original||jsonb_build_object('content_version_id',reference));
    if private.historical_question_document_v1(p_kind,resolved)-'contentVersionId' is distinct from document-'contentVersionId'
      then raise exception 'historical_question_read_mismatch' using errcode='23514'; end if;
    if p_kind='assignment' and exists(select 1 from public.quiz_questions q where q.assignment_question_id=selected_row_id
      and q.content_version_id is not null and q.content_version_id<>reference)
      then raise exception 'historical_question_dependent_reference_mismatch' using errcode='23514'; end if;
    identity_doc:=document->'identity';
    insert into private.historical_question_migrations(kind,row_id,assignment_id,original_sha256,body_sha256,identity_sha256,content_version_id,meaning)
      values(p_kind,selected_row_id,p_assignment_id,fingerprint,private.reviewed_exam_sha256_v1(document->'body'),
        private.reviewed_exam_sha256_v1(identity_doc),reference,meaning_doc) on conflict(kind,row_id,original_sha256) do nothing;
    select * into strict candidate from private.historical_question_migrations where kind=p_kind and row_id=selected_row_id and original_sha256=fingerprint;
    if candidate.content_version_id<>reference or candidate.meaning is distinct from meaning_doc or candidate.state<>'prepared'
      then raise exception 'historical_question_preparation_conflict' using errcode='40001'; end if;
    answer:=answer||jsonb_build_array(jsonb_build_object('id',candidate.id,'before',document));
  end loop;
  return answer;
end $$;

create function private.keep_historical_question_meaning_v1(p_question_id uuid,p_meaning jsonb) returns void
language plpgsql set search_path='' as $$
declare reference uuid; context_key text; existing jsonb;
begin
  select content_version_id into reference from public.assignment_questions where id=p_question_id;
  if reference is null then return; end if;
  select v.identity into existing from private.assignment_vocabulary_meaning_refs r
    join private.vocabulary_question_meaning_versions v using(content_version_id,context_hash)
    where r.assignment_question_id=p_question_id and r.content_version_id=reference;
  if found then
    if existing is distinct from p_meaning then raise exception 'historical_question_meaning_changed' using errcode='23514'; end if;
    return;
  end if;
  context_key:=private.reviewed_exam_sha256_v1(jsonb_build_array(private.assignment_vocabulary_meaning_context_v1(p_question_id),p_meaning));
  insert into private.vocabulary_question_meaning_versions(content_version_id,context_hash,identity)
    values(reference,context_key,p_meaning) on conflict do nothing;
  select v.identity into existing from private.vocabulary_question_meaning_versions v where v.content_version_id=reference and v.context_hash=context_key;
  if existing is distinct from p_meaning then raise exception 'historical_question_meaning_changed' using errcode='23514'; end if;
  insert into private.assignment_vocabulary_meaning_refs(assignment_question_id,content_version_id,context_hash)
    values(p_question_id,reference,context_key);
end $$;

-- The exception capability is a single exact row image in this transaction.
-- It cannot be enabled through request claims, role names or a custom setting.
create function private.consume_historical_question_permit_v1(p_relation oid,p_before jsonb,p_after jsonb) returns boolean
language sql volatile security definer set search_path='' as $$
  with consumed as(delete from private.historical_question_write_permits
    where backend_pid=pg_backend_pid() and transaction_id=txid_current() and relation_id=p_relation
      and before_sha256=private.reviewed_exam_sha256_v1(p_before) and after_sha256=private.reviewed_exam_sha256_v1(p_after)
    returning true as permitted)
  select coalesce(bool_or(permitted),false) from consumed;
$$;

-- Preserve each current trigger's OID and ordinary path. Only the exact operator
-- update can keep an expanded, verified body alongside its original reference.
do $patch$
declare kind text; signature text; definition text; addition text;
begin
  foreach kind in array array['assignment','quiz','exam-use'] loop
    signature:=case kind when 'assignment' then 'private.freeze_assignment_question_content_v1()'
      when 'quiz' then 'private.freeze_quiz_question_content_v1()' else 'private.freeze_exam_use_question_content_v1()' end;
    definition:=replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
    if (length(definition)-length(replace(definition,E'\nbegin\n','')))/length(E'\nbegin\n')<>1
      then raise exception 'historical_question_trigger_context_changed' using errcode='55000'; end if;
    addition:=format($body$
  if tg_op='UPDATE' and private.consume_historical_question_permit_v1(tg_relid,to_jsonb(old),to_jsonb(new)) then
    if new.content_version_id is null or (old.content_version_id is not null and old.content_version_id<>new.content_version_id)
      then raise exception 'historical_question_reference_changed' using errcode='23514'; end if;
    if exists(select 1 from jsonb_each(private.historical_question_document_v1(%L,to_jsonb(new))->'body') e
      where e.value<>'null'::jsonb and e.value is distinct from
        (private.historical_question_document_v1(%L,private.historical_question_resolve_v1(%L,to_jsonb(new)))->'body')->e.key)
      then raise exception 'historical_question_body_mismatch' using errcode='23514'; end if;
    return new;
  end if;
$body$,kind,kind,kind);
    execute replace(definition,E'\nbegin\n',E'\nbegin\n'||addition);
  end loop;
end;
$patch$;

alter table public.assignment_questions drop constraint assignment_question_content_storage;
alter table public.assignment_questions add constraint assignment_question_content_storage check(
  (content_version_id is null and prompt is not null and choices is not null) or
  (content_version_id is not null and (
    (prompt is null and choices is null and headword_snapshot is null and primary_meaning_snapshot is null
      and correct_answer_snapshot is null and composition_pronunciation_snapshot is null and notebook_pronunciation_snapshot is null
      and (provenance_status='notebook_snapshot_v1' or provenance is null))
    or (prompt is not null and choices is not null))));
alter table public.quiz_questions drop constraint quiz_question_content_storage;
alter table public.quiz_questions add constraint quiz_question_content_storage check(
  (content_version_id is null and prompt is not null and choices is not null) or
  (content_version_id is not null and ((prompt is null and choices is null) or (prompt is not null and choices is not null))));
alter table public.assignment_question_exam_use_snapshot drop constraint exam_use_question_content_storage;
alter table public.assignment_question_exam_use_snapshot add constraint exam_use_question_content_storage check(
  (content_version_id is null and headword_snapshot is not null and primary_meaning_snapshot is not null
    and pronunciation_snapshot is not null and choice_dictionary_snapshots is not null) or
  (content_version_id is not null and (
    (headword_snapshot is null and primary_meaning_snapshot is null and display_pronunciation_ko_snapshot is null
      and pronunciation_snapshot is null and choice_dictionary_snapshots is null) or
    (headword_snapshot is not null and primary_meaning_snapshot is not null and pronunciation_snapshot is not null and choice_dictionary_snapshots is not null))));

create function private.apply_historical_question_batch_v1(p_request_id uuid,p_action text,p_archive_sha256 text,p_rows jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare request_hash text; receipt private.historical_question_migration_receipts; candidate private.historical_question_migrations;
  entry jsonb; original jsonb; before_doc jsonb; current_doc jsonb; changed jsonb; patch jsonb; spec jsonb; fields text[];
  assignment_id uuid; this_assignment uuid; row_count integer; updates integer:=0; assignments text;
  body_doc jsonb; after_doc jsonb; result jsonb; details jsonb:='[]'; actual jsonb; state_value text; referenced boolean;
begin
  if current_user<>'postgres' then raise exception 'historical_question_operator_required' using errcode='42501'; end if;
  if p_request_id is null or p_action is null or p_action not in('compact','restore') or p_archive_sha256 is null
    or p_archive_sha256 !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows) is distinct from 'array'
    then raise exception 'historical_question_request_invalid' using errcode='22023'; end if;
  row_count:=jsonb_array_length(p_rows);
  if row_count not between 1 and 100 or octet_length(p_rows::text)>4194304
    or exists(select 1 from jsonb_array_elements(p_rows)e where jsonb_typeof(e) is distinct from 'object'
      or e-array['id','before']<>'{}'::jsonb or e->>'id' is null or jsonb_typeof(e->'before') is distinct from 'object')
    or (select count(distinct (e->>'id')::uuid) from jsonb_array_elements(p_rows)e)<>row_count
    then raise exception 'historical_question_batch_invalid' using errcode='22023'; end if;
  request_hash:=private.reviewed_exam_sha256_v1(jsonb_build_array(1,p_action,p_archive_sha256,p_rows));
  -- Serialize only operator batches. Student traffic uses its existing row locks.
  perform pg_advisory_xact_lock(61003,2);
  select * into receipt from private.historical_question_migration_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'historical_question_request_conflict' using errcode='40001'; end if;
    return receipt.result;
  end if;
  select count(distinct m.assignment_id),min(m.assignment_id::text) into updates,assignments
    from jsonb_array_elements(p_rows)e join private.historical_question_migrations m on m.id=(e->>'id')::uuid;
  if updates<>1 or (select count(*) from jsonb_array_elements(p_rows)e join private.historical_question_migrations m on m.id=(e->>'id')::uuid)<>row_count
    then raise exception 'historical_question_candidates_mismatch' using errcode='23514'; end if;
  assignment_id:=assignments::uuid; updates:=0;
  perform private.lock_historical_question_assignment_v1(assignment_id,p_action='compact');
  for entry in select e from jsonb_array_elements(p_rows)e order by e->>'id' loop
    select * into strict candidate from private.historical_question_migrations where id=(entry->>'id')::uuid for update;
    before_doc:=entry->'before';
    if private.reviewed_exam_sha256_v1(before_doc)<>candidate.original_sha256
      or before_doc->>'kind' is distinct from candidate.kind or before_doc->>'contentVersionId' is not null
      or private.reviewed_exam_sha256_v1(before_doc->'body')<>candidate.body_sha256
      then raise exception 'historical_question_archive_mismatch' using errcode='23514'; end if;
    original:=private.historical_question_row_v1(candidate.kind,candidate.row_id,true);
    this_assignment:=private.historical_question_assignment_v1(candidate.kind,original);
    current_doc:=private.historical_question_document_v1(candidate.kind,original);
    if this_assignment<>assignment_id or private.reviewed_exam_sha256_v1(current_doc->'identity')<>candidate.identity_sha256
      or private.historical_question_meaning_v1(candidate.kind,original) is distinct from candidate.meaning
      then raise exception 'historical_question_current_changed' using errcode='40001'; end if;
    referenced:=original->>'content_version_id' is not null;
    if referenced and (original->>'content_version_id')::uuid<>candidate.content_version_id
      then raise exception 'historical_question_reference_changed' using errcode='40001'; end if;
    if not referenced and (p_action='restore' or candidate.state<>'prepared'
      or private.reviewed_exam_sha256_v1(current_doc)<>candidate.original_sha256)
      then raise exception 'historical_question_current_changed' using errcode='40001'; end if;
    -- Recheck at application time: another prepared historical batch can have
    -- attached a quiz reference since this candidate was prepared.
    if candidate.kind='assignment' and exists(select 1 from public.quiz_questions q
      where q.assignment_question_id=candidate.row_id and q.content_version_id is not null and q.content_version_id<>candidate.content_version_id)
      then raise exception 'historical_question_dependent_reference_mismatch' using errcode='23514'; end if;
    spec:=private.historical_question_spec_v1(candidate.kind);
    select array_agg(value) into fields from jsonb_array_elements_text(spec->'body');
    if p_action='compact' then
      select jsonb_object_agg(key,'null'::jsonb) into body_doc from unnest(fields)key;
      state_value:='compacted';
    else body_doc:=before_doc->'body'; state_value:='restored'; end if;
    patch:=body_doc||jsonb_build_object('content_version_id',candidate.content_version_id);
    changed:=original||patch;
    after_doc:=private.historical_question_document_v1(candidate.kind,private.historical_question_resolve_v1(candidate.kind,changed));
    if after_doc-'contentVersionId' is distinct from before_doc-'contentVersionId'
      then raise exception 'historical_question_read_mismatch' using errcode='23514'; end if;
    if referenced and current_doc->'body' is distinct from before_doc->'body' and
      exists(select 1 from jsonb_each(current_doc->'body')e where e.value<>'null'::jsonb)
      then raise exception 'historical_question_current_changed' using errcode='40001'; end if;
    if original is distinct from changed then
      insert into private.historical_question_write_permits values(pg_backend_pid(),txid_current(),(spec->>'relation')::regclass::oid,
        private.reviewed_exam_sha256_v1(original),private.reviewed_exam_sha256_v1(changed));
      select string_agg(format('%I=x.%I',field,field),',') into assignments from unnest(fields||array['content_version_id'])field;
      execute format('update %s q set %s from jsonb_populate_record(null::%s,$1) x where q.%I=$2',
        (spec->>'relation')::regclass,assignments,(spec->>'relation')::regclass,spec->>'key') using changed,candidate.row_id;
      if exists(select 1 from private.historical_question_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current())
        then raise exception 'historical_question_permit_unused' using errcode='55000'; end if;
      updates:=updates+1;
    end if;
    actual:=private.historical_question_row_v1(candidate.kind,candidate.row_id);
    if actual is distinct from changed or private.historical_question_meaning_v1(candidate.kind,actual) is distinct from candidate.meaning
      then raise exception 'historical_question_postcondition_failed' using errcode='23514'; end if;
    if candidate.kind in('assignment','exam-use') then
      perform private.keep_historical_question_meaning_v1(candidate.row_id,candidate.meaning);
    end if;
    update private.historical_question_migrations set state=state_value where id=candidate.id;
    details:=details||jsonb_build_array(jsonb_build_object('id',candidate.id,'kind',candidate.kind,'rowId',candidate.row_id,
      'originalHash',candidate.original_sha256,'currentHash',private.reviewed_exam_sha256_v1(private.historical_question_document_v1(candidate.kind,actual)),
      'contentVersionId',candidate.content_version_id,'state',state_value));
  end loop;
  result:=jsonb_build_object('requestId',p_request_id,'action',p_action,'rows',row_count,'changed',updates,'items',details);
  insert into private.historical_question_migration_receipts(request_id,request_sha256,archive_sha256,result)
    values(p_request_id,request_hash,p_archive_sha256,result);
  return result;
end $$;

do $permissions$
declare f record;
begin
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in(
      'historical_question_spec_v1','historical_question_document_v1','historical_question_row_v1','historical_question_assignment_v1',
      'historical_question_participants_v1','lock_historical_question_assignment_v1','historical_question_meaning_v1',
      'historical_question_resolve_v1','prepare_historical_question_batch_v1','consume_historical_question_permit_v1','apply_historical_question_batch_v1',
      'keep_historical_question_meaning_v1')
  loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature); end loop;
end;
$permissions$;
commit;
