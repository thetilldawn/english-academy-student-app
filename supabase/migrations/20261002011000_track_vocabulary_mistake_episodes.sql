begin;

alter table public.student_vocab_review_queue
  add column meaning_key_snapshot text,
  add column mistake_episode_id uuid,
  add column source_phase_snapshot text,
  add constraint review_queue_meaning_reference_check check (
    (meaning_key_snapshot is null and mistake_episode_id is null and source_phase_snapshot is null)
    or (meaning_key_snapshot is not null and meaning_key_snapshot ~ '^[a-f0-9]{64}$' and mistake_episode_id is not null
      and source_phase_snapshot is not null and source_phase_snapshot in ('initial','retry')));
alter table public.assignment_review_targets
  add column meaning_key_snapshot text,
  add column mistake_episode_id uuid,
  add constraint review_target_meaning_reference_check check (
    (meaning_key_snapshot is null and mistake_episode_id is null)
    or (meaning_key_snapshot is not null and meaning_key_snapshot ~ '^[a-f0-9]{64}$' and mistake_episode_id is not null));
drop index public.student_vocab_review_queue_pending_entry_unique;
create unique index student_vocab_review_queue_pending_entry_unique on public.student_vocab_review_queue(student_id,dataset_id,vocab_entry_id)
  where status='pending' and meaning_key_snapshot is null;
create unique index student_vocab_review_queue_pending_meaning_unique on public.student_vocab_review_queue(student_id,meaning_key_snapshot,mistake_episode_id)
  where status='pending' and meaning_key_snapshot is not null;
create unique index assignment_review_targets_active_meaning_unique on public.assignment_review_targets(student_id,meaning_key_snapshot,mistake_episode_id)
  where released_at is null and meaning_key_snapshot is not null;
drop index public.student_vocab_review_queue_pending_canonical_unique;
create unique index student_vocab_review_queue_pending_canonical_unique on public.student_vocab_review_queue(student_id,dataset_id,canonical_lexeme_id_snapshot)
  where status='pending' and canonical_lexeme_id_snapshot is not null and meaning_key_snapshot is null;
drop index public.student_vocab_review_queue_active_dictionary_unique;
create unique index student_vocab_review_queue_active_dictionary_unique on public.student_vocab_review_queue(student_id,dataset_id,canonical_dictionary_id_snapshot)
  where status='pending' and canonical_dictionary_id_snapshot is not null and meaning_key_snapshot is null;
drop index public.assignment_review_targets_active_dictionary_unique;
create unique index assignment_review_targets_active_dictionary_unique on public.assignment_review_targets(student_id,dataset_id,canonical_dictionary_id_snapshot)
  where released_at is null and canonical_dictionary_id_snapshot is not null and meaning_key_snapshot is null;

-- APP-20261002-01. Append-only answer receipts and meaning-specific episodes.
-- Historical answers, scores, events and question bodies are not backfilled.
create table private.vocabulary_question_meaning_versions (
  content_version_id uuid not null references private.vocabulary_question_content_versions(id),
  context_hash text not null check(context_hash ~ '^[a-f0-9]{64}$'),
  identity jsonb not null check(jsonb_typeof(identity)='object'),
  created_at timestamptz not null default clock_timestamp(),
  check(identity->>'meaningKey' ~ '^[a-f0-9]{64}$'),
  check(identity->>'testedField' in ('primary_meaning','definition','example')),
  primary key(content_version_id,context_hash)
);
create trigger vocabulary_question_meaning_immutable before update or delete
  on private.vocabulary_question_meaning_versions for each row execute function private.reject_mock_wordbook_history_change();
create table private.assignment_vocabulary_meaning_refs (
  assignment_question_id uuid primary key references public.assignment_questions(id),
  content_version_id uuid not null,
  context_hash text not null,
  foreign key(content_version_id,context_hash) references private.vocabulary_question_meaning_versions(content_version_id,context_hash)
);
create trigger assignment_vocabulary_meaning_refs_immutable before update or delete on private.assignment_vocabulary_meaning_refs
  for each row execute function private.reject_mock_wordbook_history_change();

create table private.student_vocabulary_versions (
  student_id uuid primary key references public.students(id),
  version bigint not null default 0 check(version>=0)
);
create table private.student_vocabulary_meaning_states (
  student_id uuid not null references public.students(id),
  meaning_key text not null check(meaning_key ~ '^[a-f0-9]{64}$'),
  word_key text not null,
  episode_id uuid,
  unresolved boolean not null,
  current_wrong_count integer not null default 0 check(current_wrong_count>=0),
  lifetime_wrong_count integer not null default 0 check(lifetime_wrong_count>=current_wrong_count),
  current_missed_count integer not null default 0 check(current_missed_count>=0),
  lifetime_missed_count integer not null default 0 check(lifetime_missed_count>=current_missed_count),
  legacy_wrong_count integer not null default 0 check(legacy_wrong_count>=0),
  count_quality text not null check(count_quality in ('exact','legacy-continuation')),
  last_sequence bigint not null check(last_sequence>=0),
  last_question_id uuid not null references public.quiz_questions(id),
  last_wrong_at timestamptz,
  resolved_at timestamptz,
  primary key(student_id,meaning_key),
  check(not unresolved or episode_id is not null),
  check(unresolved or (current_wrong_count=0 and current_missed_count=0))
);
create index student_vocabulary_current on private.student_vocabulary_meaning_states(student_id,word_key) where unresolved;

-- Preserve the old small state only on its first mutation. The old wide-word
-- resolver may touch other entries, but cannot change their legacy baseline.
create table private.vocabulary_legacy_state_baselines (
  student_id uuid not null references public.students(id),
  vocab_entry_id bigint not null references public.vocab_entries(id),
  existed boolean not null,
  unresolved_wrong_count integer,
  resolved_at timestamptz,
  last_evaluated_at timestamptz,
  last_attempt_id uuid,
  primary key(student_id,vocab_entry_id)
);
create function private.preserve_vocabulary_legacy_state_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare existing public.student_vocab_state;
begin
  if tg_op='INSERT' then
    -- BEFORE INSERT also runs for ON CONFLICT DO UPDATE. Preserve the actual
    -- existing row instead of recording an absent baseline for that path.
    select * into existing from public.student_vocab_state where student_id=new.student_id and vocab_entry_id=new.vocab_entry_id;
    insert into private.vocabulary_legacy_state_baselines(student_id,vocab_entry_id,existed,unresolved_wrong_count,resolved_at,last_evaluated_at,last_attempt_id)
      values(new.student_id,new.vocab_entry_id,existing.student_id is not null,existing.unresolved_wrong_count,existing.resolved_at,existing.last_evaluated_at,existing.last_attempt_id) on conflict do nothing;
  else
    insert into private.vocabulary_legacy_state_baselines(student_id,vocab_entry_id,existed,unresolved_wrong_count,resolved_at,last_evaluated_at,last_attempt_id)
      values(old.student_id,old.vocab_entry_id,true,old.unresolved_wrong_count,old.resolved_at,old.last_evaluated_at,old.last_attempt_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger aaa_preserve_vocabulary_legacy_state before insert or update on public.student_vocab_state
  for each row execute function private.preserve_vocabulary_legacy_state_v1();

create table private.vocabulary_answer_receipts (
  quiz_question_id uuid not null references public.quiz_questions(id),
  phase text not null check(phase in ('initial','retry')),
  student_id uuid not null references public.students(id),
  attempt_id uuid not null references public.quiz_attempts(id),
  request_kind text not null check(request_kind in ('answer','expiry')),
  requested_choice smallint check(requested_choice between 0 and 3),
  requested_timeout boolean not null,
  result jsonb not null check(jsonb_typeof(result)='object'),
  outcome text not null check(outcome in ('correct','wrong','timeout','unanswered')),
  meaning_key text not null check(meaning_key ~ '^[a-f0-9]{64}$'),
  word_key text not null,
  episode_id uuid,
  server_sequence bigint not null check(server_sequence>0),
  accepted_at timestamptz not null default clock_timestamp(),
  primary key(quiz_question_id,phase),
  unique(student_id,server_sequence)
);
create index vocabulary_answer_history on private.vocabulary_answer_receipts(student_id,meaning_key,server_sequence);
create trigger vocabulary_answer_receipts_immutable before update or delete on private.vocabulary_answer_receipts
  for each row execute function private.reject_mock_wordbook_history_change();
-- A pre-rollout initial failure can still be awaiting its retry. Preserve its
-- old resolution flag and dates before grading changes that same question.
create table private.vocabulary_legacy_question_baselines (
  quiz_question_id uuid primary key references public.quiz_questions(id),
  retry_is_correct boolean,
  initial_wrong_at timestamptz,
  retry_wrong_at timestamptz
);
create trigger vocabulary_legacy_questions_immutable before update or delete on private.vocabulary_legacy_question_baselines
  for each row execute function private.reject_mock_wordbook_history_change();
create function private.preserve_vocabulary_legacy_questions_v1(p_attempt_id uuid) returns void
language sql set search_path='' as $$
  insert into private.vocabulary_legacy_question_baselines(quiz_question_id,retry_is_correct,initial_wrong_at,retry_wrong_at)
  select q.id,q.retry_is_correct,
    max(coalesce(s.answered_at,e.wrong_at,t.completed_at,t.started_at)) filter(where s.phase='initial'),
    max(coalesce(s.answered_at,e.wrong_at,t.completed_at,t.started_at)) filter(where s.phase='retry')
  from public.quiz_questions q join public.quiz_attempts t on t.id=q.attempt_id
  cross join lateral(values('initial',q.initial_is_correct,q.initial_answered_at),('retry',q.retry_is_correct,q.retry_answered_at)) s(phase,correct,answered_at)
  left join public.student_vocab_wrong_events e on e.quiz_question_id=q.id and e.wrong_stage=s.phase and e.student_id=t.student_id
  where t.id=p_attempt_id and (s.correct is false or e.id is not null)
    and not exists(select 1 from private.vocabulary_answer_receipts r where r.quiz_question_id=q.id and r.phase=s.phase)
  group by q.id,q.retry_is_correct on conflict do nothing;
$$;
-- Only a submitted request that itself discovers whole-attempt expiry needs
-- this extra response. Expiry also creates events for other unanswered items;
-- their event result must not replace this request's final v2/v4 response.
create table private.vocabulary_expired_answer_results (
  quiz_question_id uuid not null,phase text not null,requested_choice smallint not null,
  requested_timeout boolean not null,result jsonb not null,
  primary key(quiz_question_id,phase),
  foreign key(quiz_question_id,phase) references private.vocabulary_answer_receipts(quiz_question_id,phase)
);
create trigger vocabulary_expired_answer_results_immutable before update or delete on private.vocabulary_expired_answer_results
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.lock_vocabulary_student_v1(p_student_id uuid) returns void
language plpgsql set search_path='' as $$
begin
  perform 1 from public.students where id=p_student_id for update;
  if not found then raise exception 'student_not_found' using errcode='P0002'; end if;
end;
$$;

-- Read only frozen questions/bindings. No current dictionary/eligibility lookup.
create function private.assignment_vocabulary_meaning_context_v1(p_question_id uuid) returns text
language sql stable set search_path='' as $$
  select private.reviewed_exam_sha256_v1(jsonb_build_array('meaning-context-v1',
    (select content_version_id from public.assignment_question_exam_use_snapshot where assignment_question_id=p_question_id)))
$$;
create function private.frozen_vocabulary_meaning_key_v1(p_source_kind text,p_dataset_id uuid,p_entry_id bigint,
  p_release_id uuid,p_source_hash text,p_tested_field text,p_selected_hash text) returns text
language sql immutable set search_path='' as $$
  select private.reviewed_exam_sha256_v1(jsonb_build_array('frozen-selection-v1',p_source_kind,p_dataset_id,
    p_entry_id,p_release_id,p_source_hash,p_tested_field,p_selected_hash))
$$;
revoke all on function private.frozen_vocabulary_meaning_key_v1(text,uuid,bigint,uuid,text,text,text)
  from public,anon,authenticated,service_role;

create function private.assignment_vocabulary_meaning_v1(p_question_id uuid,p_depth integer default 0)
returns jsonb language plpgsql stable set search_path='' as $$
declare q public.assignment_questions; existing jsonb; binding jsonb; learning jsonb;
  c private.vocabulary_composition_entries; item private.vocabulary_composition_items;
  source_kind text:='legacy_vocab'; source_dataset uuid; source_entry bigint; source_hash text; source_release uuid;
  field_value text; selected_value text; selected_hash text; word_value text; dictionary_value text;
  identity_kind text:='source-occurrence-v1'; meaning_value text; original_question uuid; original jsonb;
  source_matches boolean; source_version_value text;
begin
  if p_depth>8 then raise exception 'vocabulary_meaning_reference_cycle' using errcode='55000'; end if;
  select * into q from private.assignment_question_contents_v1 where id=p_question_id;
  if not found then raise exception 'question_not_found' using errcode='P0002'; end if;
  select v.identity into existing from private.assignment_vocabulary_meaning_refs r
    join private.vocabulary_question_meaning_versions v using(content_version_id,context_hash)
    where r.assignment_question_id=q.id and r.content_version_id=q.content_version_id;
  if found then return existing; end if;
  field_value:=case when q.eligibility_quiz_mode like '%definition%' then 'definition'
    when q.eligibility_quiz_mode like '%example%' then 'example' else 'primary_meaning' end;
  -- The answer actually tested wins over a possibly inconsistent legacy label.
  selected_value:=case when field_value='primary_meaning' then
      case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end
    when q.eligibility_quiz_mode like '%headword_to_definition%' then q.choices->>q.correct_choice_index else q.prompt end;
  if nullif(selected_value,'') is null then raise exception 'vocabulary_meaning_selection_missing' using errcode='55000'; end if;
  selected_hash:=private.reviewed_exam_sha256_v1(to_jsonb(selected_value));
  source_dataset:=q.dataset_id; source_entry:=q.vocab_entry_id; source_hash:=q.entry_row_sha256_snapshot;
  select x.dictionary_id into dictionary_value from private.assignment_question_word_identity_v1 x where x.assignment_question_id=q.id;
  word_value:=case when nullif(dictionary_value,'') is not null then 'dictionary:'||dictionary_value
    when q.canonical_lexeme_id_snapshot is not null then 'canonical:'||q.canonical_lexeme_id_snapshot::text
    else 'headword:'||private.wrong_history_headword_v1(coalesce(nullif(q.headword_snapshot,''),
      case when q.direction='english_to_korean' then q.prompt else q.choices->>q.correct_choice_index end)) end;
  if q.provenance_status='notebook_snapshot_v1' and q.notebook_source_event_id is not null then
    select qq.id into original_question from public.student_vocab_wrong_events e
      join public.quiz_questions qq on qq.id=e.quiz_question_id where e.id=q.notebook_source_event_id;
    if original_question is not null then
      original:=private.quiz_vocabulary_meaning_v1(original_question,p_depth+1);
      if original->>'testedField'=field_value and original->>'selectedHash'=selected_hash then return original; end if;
    end if;
    -- A translated exercise does not silently resolve a definition/example.
    source_kind:='notebook-selection'; source_hash:=selected_hash;
  elsif q.composition_version_id_snapshot is not null then
    select * into c from private.vocabulary_composition_entries where vocab_entry_id=q.vocab_entry_id and version_id=q.composition_version_id_snapshot;
    if not found then raise exception 'vocabulary_meaning_source_missing' using errcode='55000'; end if;
    source_entry:=c.source_entry_id; source_kind:=c.source_kind; source_release:=c.source_release_id;
    if c.resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
      binding:=private.resolve_vocabulary_learning_binding_v1(c.resources);
      source_dataset:=(binding#>>'{entryLink,datasetId}')::uuid;
      source_hash:=binding#>>'{entryLink,rowHash}';
      learning:=binding->'learningIdentity';
      dictionary_value:=coalesce(nullif(binding#>>'{sourceIdentifiers,dictionaryId}',''),nullif(binding#>>'{selectedDictionary,dictionary_id}',''));
      word_value:=case when dictionary_value is not null then 'dictionary:'||dictionary_value
        when binding#>>'{sourceIdentifiers,legacyLexemeId}' is not null then 'canonical:'||(binding#>>'{sourceIdentifiers,legacyLexemeId}') else word_value end;
      if field_value='primary_meaning' and selected_value=private.resolve_vocabulary_learning_value_v1(c.resources->'selected')#>>'{entryValues,primary_meaning}' then
        meaning_value:=learning->>'key'; identity_kind:=learning->>'kind';
      end if;
    else
      source_dataset:=(c.source_snapshot#>>'{entry,dataset_id}')::uuid;
      source_hash:=c.source_snapshot#>>'{entry,row_sha256}';
      if field_value='primary_meaning' and selected_value=c.source_snapshot#>>'{entry,primary_meaning}' then
        select count(*)=cardinality(c.source_scope_ids) and count(distinct s.source_version)=1
          and bool_and(coalesce(s.source_kind=c.source_kind and s.source_release_id is not distinct from c.source_release_id
            and s.dataset_id=source_dataset and r.source_entry_id=c.source_entry_id and r.source_row=(c.source_snapshot->>'sourceRow')::integer
            and r.row_sha256=lower(source_hash) and r.occurrence_key=c.source_snapshot->>'key'
            and r.occurrence_key=private.reviewed_exam_sha256_v1(jsonb_build_array(s.source_kind,s.dataset_id,s.source_release_id,s.source_version,s.source_file_sha256,r.source_row)),false)),
          min(s.source_version) into source_matches,source_version_value
        from unnest(c.source_scope_ids) requested(scope_id) join private.vocabulary_library_scopes s on s.id=requested.scope_id
        join private.vocabulary_library_scope_rows r on r.scope_id=s.id and r.occurrence_key=c.occurrence_key;
        if source_matches is distinct from true then raise exception 'vocabulary_meaning_source_mismatch' using errcode='55000'; end if;
        meaning_value:=private.reviewed_exam_sha256_v1(jsonb_build_array('source-occurrence-v1',c.occurrence_key,source_version_value,'primary_meaning',
          private.reviewed_exam_sha256_v1(jsonb_build_array(c.source_snapshot#>'{entry,primary_meaning}',c.resources#>'{selected,lexicalPos}'))));
      end if;
      dictionary_value:=nullif(c.resources#>>'{selected,dictionary,dictionary_id}','');
      if dictionary_value is not null then word_value:='dictionary:'||dictionary_value; end if;
    end if;
    select * into item from private.vocabulary_composition_items where version_id=q.composition_version_id_snapshot and item_id=q.composition_item_id_snapshot;
    if field_value<>'primary_meaning' and item.source_kind='reviewed_item' then source_release:=item.source_release_id; end if;
  elsif q.reviewed_exam_release_id_snapshot is not null then
    source_kind:='reviewed_exam'; source_release:=q.reviewed_exam_release_id_snapshot;
  elsif q.canonical_question_release_id_snapshot is not null then
    source_kind:='canonical-preview'; source_release:=q.canonical_question_release_id_snapshot;
  end if;
  if meaning_value is null then
    meaning_value:=private.frozen_vocabulary_meaning_key_v1(source_kind,source_dataset,source_entry,source_release,source_hash,field_value,selected_hash);
  end if;
  return jsonb_build_object('wordKey',word_value,'meaningKey',meaning_value,'identityKind',identity_kind,
    'testedField',field_value,'selectedHash',selected_hash);
end;
$$;

create function private.quiz_vocabulary_meaning_v1(p_question_id uuid,p_depth integer default 0) returns jsonb
language plpgsql stable set search_path='' as $$
declare q public.quiz_questions; selected_value text; headword_value text;
begin
  if p_depth>8 then raise exception 'vocabulary_meaning_reference_cycle' using errcode='55000'; end if;
  select * into q from private.quiz_question_contents_v1 where id=p_question_id;
  if not found then raise exception 'question_not_found' using errcode='P0002'; end if;
  if q.assignment_question_id is not null then return private.assignment_vocabulary_meaning_v1(q.assignment_question_id,p_depth); end if;
  selected_value:=case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end;
  headword_value:=case when q.direction='english_to_korean' then q.prompt else q.choices->>q.correct_choice_index end;
  return jsonb_build_object('wordKey','headword:'||private.wrong_history_headword_v1(headword_value),
    'meaningKey',private.reviewed_exam_sha256_v1(jsonb_build_array('legacy-question-selection-v1',q.id,q.vocab_entry_id,selected_value)),
    'identityKind','legacy-unverified','testedField','primary_meaning','selectedHash',private.reviewed_exam_sha256_v1(to_jsonb(selected_value)));
end;
$$;

-- The absence of a frozen reference is not proof of a new question. Only an
-- INSERT in this transaction may adopt a newly verified meaning.
create table private.assignment_vocabulary_new_questions(
  assignment_question_id uuid primary key references public.assignment_questions(id) on delete cascade,
  backend_pid integer not null,transaction_id bigint not null
);
alter table private.assignment_vocabulary_new_questions enable row level security;
revoke all on private.assignment_vocabulary_new_questions from public,anon,authenticated,service_role;
create function private.mark_new_vocabulary_question_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.provenance_status<>'notebook_snapshot_v1' then
    insert into private.assignment_vocabulary_new_questions values(new.id,pg_backend_pid(),txid_current());
  end if;
  return new;
end;
$$;
create trigger mark_new_vocabulary_question after insert on public.assignment_questions
  for each row execute function private.mark_new_vocabulary_question_v1();
create function private.expire_new_vocabulary_question_marker_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
  delete from private.assignment_vocabulary_new_questions where assignment_question_id=new.assignment_question_id
    and backend_pid=new.backend_pid and transaction_id=new.transaction_id;
  return new;
end;
$$;
create constraint trigger expire_new_vocabulary_question_marker after insert on private.assignment_vocabulary_new_questions
  deferrable initially deferred for each row execute function private.expire_new_vocabulary_question_marker_v1();
revoke all on function private.mark_new_vocabulary_question_v1(),private.expire_new_vocabulary_question_marker_v1()
  from public,anon,authenticated,service_role;

create function private.raw_vocabulary_learning_binding_core_v1(p_question public.assignment_questions,p_mode public.assignment_quiz_mode_snapshots) returns jsonb
language plpgsql volatile set search_path='' as $$
declare q public.assignment_questions:=p_question; e public.vocab_entries; ctx record; r record; x record;
  source_doc jsonb; entry_doc jsonb; entry_values jsonb; entry_link jsonb; selected_value text; selected_pos jsonb; expected_key text;
  v2 boolean; found_ids uuid[]:='{}'; result jsonb; dictionary_value text; word_value text;
begin
  if q.vocab_entry_id is null or q.provenance_status is distinct from 'verified_v2' or q.composition_version_id_snapshot is not null
    or q.reviewed_exam_release_id_snapshot is not null or q.canonical_question_release_id_snapshot is not null
    or q.eligibility_quiz_mode not in('book_meaning_en_to_ko','book_meaning_ko_to_en')
    then return null; end if;
  if q.eligibility_quiz_mode is distinct from (case q.direction when 'english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end)
    then return null; end if;
  select * into e from public.vocab_entries where id=q.vocab_entry_id and dataset_id=q.dataset_id for share;
  if not found then return null; end if;
  selected_value:=case q.direction when 'english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end;
  if q.entry_row_sha256_snapshot is distinct from e.row_sha256 or q.headword_snapshot is distinct from e.headword
    or q.headword_normalized_snapshot is distinct from e.headword_normalized or q.primary_meaning_snapshot is distinct from e.primary_meaning
    or selected_value is distinct from e.primary_meaning or q.provenance->'sourceRow' is distinct from to_jsonb(e.source_row)
    or q.provenance->'unitId' is distinct from to_jsonb(e.unit_id) then return null; end if;
  select lower(m.dataset_source_sha256) source_version,lower(src.source_sha256) source_file_sha256,l.lexeme_id,l.occurrence_id,l.mapping_status into ctx
  from (select (p_mode).*) m join public.vocab_datasets d on d.id=m.dataset_id
  join word_index.dataset_source ds on ds.dataset_id=m.dataset_id and ds.source_id=m.source_id and ds.build_id=m.build_id
  join word_index.index_build ib on ib.build_id=m.build_id join word_index.source src on src.source_id=m.source_id
  join word_index.vocab_link_import_run ir on ir.dataset_id=m.dataset_id and ir.source_id=m.source_id and ir.build_id=m.build_id
  join word_index.vocab_entry_link l on l.dataset_id=m.dataset_id and l.vocab_entry_id=e.id and l.source_id=m.source_id
  join public.vocab_entry_quiz_eligibility el on el.dataset_id=m.dataset_id and el.vocab_entry_id=e.id and el.quiz_mode=m.quiz_mode
  where m.dataset_id=q.dataset_id and m.quiz_mode=q.eligibility_quiz_mode
    and d.status='ready' and d.is_active and lower(d.source_sha256)=lower(m.dataset_source_sha256)
    and ds.dataset_source_sha256=m.dataset_source_sha256 and ib.status='complete' and lower(ib.input_snapshot_sha256)=lower(m.canonical_snapshot_sha256)
    and ir.status='complete' and ir.package_snapshot_sha256=m.link_package_snapshot_sha256 and ir.source_payload_sha256=m.source_payload_sha256
    and ir.capabilities_payload_sha256=m.capabilities_payload_sha256 and src.source_sha256 is not null
    and l.entry_row_sha256=q.entry_row_sha256_snapshot and l.mapping_status=q.provenance->>'mappingStatus'
    and l.lexeme_id is not distinct from q.canonical_lexeme_id_snapshot and el.status='eligible'
    and el.input_content_hash=q.eligibility_input_hash_snapshot and el.rule_version=q.eligibility_rule_version_snapshot
    and el.canonical_lexeme_id is not distinct from q.canonical_lexeme_id_snapshot
    and el.canonical_content_hash is not distinct from q.canonical_content_hash_snapshot and el.content_review_id is not distinct from q.content_review_id_snapshot
    and q.provenance->>'eligibilityStatus'='eligible' and q.provenance->>'datasetSourceSha256'=m.dataset_source_sha256
    and q.provenance->>'canonicalSnapshotSha256'=m.canonical_snapshot_sha256 and q.provenance->>'linkPackageSnapshotSha256'=m.link_package_snapshot_sha256
    and q.provenance->>'sourcePayloadSha256'=m.source_payload_sha256 and q.provenance->>'capabilitiesPayloadSha256'=m.capabilities_payload_sha256
  for share of d,ds,ib,src,ir,l,el;
  if not found then return null; end if;
  entry_doc:=to_jsonb(e);
  select jsonb_object_agg(key,value) into entry_values from jsonb_each(entry_doc) where key=any(array[
    'headword','headword_normalized','pronunciation_ko','meanings','primary_meaning','english_definition','example_en','example_ko','entry_type']);
  entry_link:=jsonb_build_object('id',e.id::text,'datasetId',e.dataset_id,'unitId',e.unit_id,'sourceRow',e.source_row,'rowHash',e.row_sha256,'sourceRef',e.source_ref);
  for r in select s.id scope_id,s.payload scope_payload,s.source_kind,s.dataset_id,s.unit_id,s.source_release_id,s.source_version,s.source_file_sha256,
    sr.source_row,sr.occurrence_key,sr.entry_snapshot,sr.occurrence_snapshot,sr.resources
    from private.vocabulary_library_scope_rows sr join private.vocabulary_library_scopes s on s.id=sr.scope_id
    where sr.source_entry_id=e.id and sr.state='included' and sr.source_row=e.source_row and sr.row_sha256=lower(e.row_sha256)
      and sr.resources->>'entryHash'=lower(e.row_sha256) and s.dataset_id=e.dataset_id and s.unit_id=e.unit_id
      and s.source_kind='legacy_vocab' and s.source_release_id is null and s.source_version=ctx.source_version and s.source_file_sha256=ctx.source_file_sha256
      and sr.occurrence_key=private.reviewed_exam_sha256_v1(jsonb_build_array(s.source_kind,s.dataset_id,s.source_release_id,s.source_version,s.source_file_sha256,sr.source_row))
    order by s.id loop
    v2:=r.resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2';
    if v2 then perform private.resolve_vocabulary_learning_binding_v1(r.resources); end if;
    if not private.vocabulary_source_snapshot_matches_v2(r.entry_snapshot,entry_doc)
      or r.occurrence_snapshot is not null and r.occurrence_snapshot<>'null'::jsonb then continue; end if;
    source_doc:=jsonb_build_object('kind',r.source_kind,'datasetId',r.dataset_id,'unitId',r.unit_id,'releaseId',r.source_release_id,
      'version',r.source_version,'fileHash',r.source_file_sha256,'locator',r.scope_payload#>'{source,locator}',
      'sourceRow',r.source_row,'occurrenceKey',r.occurrence_key,'state','included');
    for x in select b.binding_id,b.binding_sha256,b.payload binding,v.payload value
      from private.vocabulary_learning_value_bindings b join private.vocabulary_learning_value_versions v
        on v.selection_id=b.selection_id and v.selection_sha256=b.selection_sha256
      where b.payload#>>'{entryLink,id}'=e.id::text and b.payload->'source'=source_doc and b.payload->'entryLink'=entry_link
        and b.payload#>>'{originalHashes,entrySnapshotHash}'=private.reviewed_exam_sha256_v1(entry_doc)
        and b.payload#>'{originalHashes,occurrenceSnapshotHash}'='null'::jsonb
        and b.payload#>>'{sourceIdentifiers,legacyLexemeId}' is not distinct from ctx.lexeme_id::text
        and b.payload#>>'{sourceIdentifiers,legacyOccurrenceId}' is not distinct from ctx.occurrence_id::text
        and b.payload#>>'{sourceIdentifiers,legacyMappingStatus}' is not distinct from ctx.mapping_status
        and b.payload#>>'{learningIdentity,kind}'='source-occurrence-v1' and v.payload->'entryValues'=entry_values
        and ((v2 and b.binding_id::text=r.resources#>>'{selectionBinding,bindingId}' and b.binding_sha256=r.resources#>>'{selectionBinding,bindingHash}'
          and b.selection_id::text=r.resources#>>'{selected,selectionId}' and b.selection_sha256=r.resources#>>'{selected,selectionHash}')
          or (not v2 and r.resources#>>'{selected,schemaVersion}'='vocabulary-resource-snapshot-v1'
            and b.payload#>>'{originalHashes,selectedSnapshotHash}'=private.reviewed_exam_sha256_v1(r.resources->'selected'))) loop
      selected_pos:=x.value#>'{selectedFields,lexicalPos}';
      if x.binding#>'{learningIdentity,lexicalPos}' is distinct from selected_pos then continue; end if;
      if selected_pos<>'null'::jsonb and not exists(select 1 from(values(x.binding#>'{proofs,lexical_pos}'),(x.binding#>'{proofs,source.pos}')) p(proof)
        where proof->>'state'='linked' and proof#>>'{ref,fileHash}'=r.source_file_sha256 and proof#>>'{ref,valueHash}'=private.reviewed_exam_sha256_v1(selected_pos))
        then continue; end if;
      expected_key:=private.reviewed_exam_sha256_v1(jsonb_build_array('source-occurrence-v1',source_doc->'occurrenceKey',source_doc->'version','primary_meaning',
        private.reviewed_exam_sha256_v1(jsonb_build_array(x.value#>'{entryValues,primary_meaning}',selected_pos))));
      if x.binding#>>'{learningIdentity,key}' is distinct from expected_key then continue; end if;
      if not(x.binding_id=any(found_ids)) then
        found_ids:=array_append(found_ids,x.binding_id);
        dictionary_value:=coalesce(nullif(x.binding#>>'{sourceIdentifiers,dictionaryId}',''),nullif(x.binding#>>'{selectedDictionary,dictionary_id}',''));
        word_value:=case when dictionary_value is not null then 'dictionary:'||dictionary_value
          when x.binding#>>'{sourceIdentifiers,legacyLexemeId}' is not null then 'canonical:'||(x.binding#>>'{sourceIdentifiers,legacyLexemeId}') else null end;
        result:=jsonb_build_object('bindingId',x.binding_id,'bindingHash',x.binding_sha256,'learningIdentity',x.binding->'learningIdentity','wordKey',word_value);
      end if;
    end loop;
  end loop;
  if cardinality(found_ids)<>1 then return null; end if;
  return result;
end;
$$;
revoke all on function private.raw_vocabulary_learning_binding_core_v1(public.assignment_questions,public.assignment_quiz_mode_snapshots) from public,anon,authenticated,service_role;

-- Only real INSERTs in this transaction can adopt current raw bindings. Preview
-- uses the read-only core with server-built prototypes and never creates a marker.
create function private.new_raw_vocabulary_learning_binding_v1(p_question_id uuid) returns jsonb
language plpgsql volatile set search_path='' as $$
declare q public.assignment_questions; m public.assignment_quiz_mode_snapshots;
begin
  if not exists(select 1 from private.assignment_vocabulary_new_questions n where n.assignment_question_id=p_question_id
    and n.backend_pid=pg_backend_pid() and n.transaction_id=txid_current())
    or exists(select 1 from private.assignment_vocabulary_meaning_refs where assignment_question_id=p_question_id) then return null; end if;
  select * into q from private.assignment_question_contents_v1 where id=p_question_id;
  if not found or exists(select 1 from public.assignment_question_exam_use_snapshot where assignment_question_id=q.id) then return null; end if;
  select * into m from public.assignment_quiz_mode_snapshots where assignment_id=q.assignment_id
    and dataset_id=q.dataset_id and quiz_mode=q.eligibility_quiz_mode for share;
  if not found then return null; end if;
  return private.raw_vocabulary_learning_binding_core_v1(q,m);
end;
$$;
revoke all on function private.new_raw_vocabulary_learning_binding_v1(uuid) from public,anon,authenticated,service_role;

create function private.new_assignment_vocabulary_identity_v1(p_question public.assignment_questions,
  p_mode public.assignment_quiz_mode_snapshots,p_exam_use public.assignment_question_exam_use_snapshot,p_frozen_identity jsonb) returns jsonb
language plpgsql volatile set search_path='' as $$
declare result jsonb:=p_frozen_identity; reviewed record; candidate jsonb;
begin
  if result->>'testedField' is distinct from 'primary_meaning' then return result; end if;
  if p_exam_use.release_id is not null then
    select r.* into reviewed from word_index.mock_wordbook_identity_review r
      where r.source_release_id=p_exam_use.release_id and r.source_entry_id=p_exam_use.vocab_entry_id
        and r.source_row_sha256=p_question.entry_row_sha256_snapshot and r.reviewed_headword=p_question.headword_snapshot
        and r.reviewed_gloss=p_question.primary_meaning_snapshot
        and private.reviewed_exam_sha256_v1(to_jsonb(r.reviewed_gloss))=result->>'selectedHash'
      for share;
    if found then
      return result||jsonb_build_object('identityKind','reviewed-meaning-v1',
        'meaningKey',encode(extensions.digest(jsonb_build_array(lower(normalize(reviewed.reviewed_headword,NFKC)),reviewed.lexical_pos,reviewed.sense_id,reviewed.reviewed_gloss)::text,'sha256'),'hex'),
        'reviewEvidenceHash',reviewed.review_evidence_sha256);
    end if;
    return result;
  end if;
  candidate:=private.raw_vocabulary_learning_binding_core_v1(p_question,p_mode);
  if candidate is null then return result; end if;
  result:=result||jsonb_build_object('meaningKey',candidate#>>'{learningIdentity,key}',
    'identityKind',candidate#>>'{learningIdentity,kind}','sourceBinding',jsonb_build_object('bindingId',candidate->'bindingId','bindingHash',candidate->'bindingHash'));
  if candidate->>'wordKey' is not null then result:=result||jsonb_build_object('wordKey',candidate->'wordKey'); end if;
  return result;
end;
$$;
revoke all on function private.new_assignment_vocabulary_identity_v1(public.assignment_questions,public.assignment_quiz_mode_snapshots,public.assignment_question_exam_use_snapshot,jsonb)
  from public,anon,authenticated,service_role;

create function private.freeze_assignment_vocabulary_meanings_v1(p_assignment_id uuid) returns void
language plpgsql set search_path='' as $$
declare q public.assignment_questions; m public.assignment_quiz_mode_snapshots; x public.assignment_question_exam_use_snapshot;
  selected_identity jsonb; saved jsonb; context_value text;
begin
  -- Notebook provenance is personal and deliberately excluded from this shared
  -- cache. Its immutable source-event link is resolved by the reader instead.
  for q in select * from private.assignment_question_contents_v1 where assignment_id=p_assignment_id and provenance_status<>'notebook_snapshot_v1' order by base_order_index loop
    if q.content_version_id is null then raise exception 'vocabulary_meaning_content_missing' using errcode='55000'; end if;
    selected_identity:=private.assignment_vocabulary_meaning_v1(q.id);
    -- Only a newly finalized AQ may adopt the currently verified exam-use
    -- meaning. The per-AQ reference prevents a later identical body from
    -- silently reinterpreting a historical AQ that has no frozen reference.
    if not exists(select 1 from private.assignment_vocabulary_meaning_refs where assignment_question_id=q.id)
      and exists(select 1 from private.assignment_vocabulary_new_questions n where n.assignment_question_id=q.id
        and n.backend_pid=pg_backend_pid() and n.transaction_id=txid_current())
      and selected_identity->>'testedField'='primary_meaning' then
      select * into m from public.assignment_quiz_mode_snapshots where assignment_id=q.assignment_id
        and dataset_id=q.dataset_id and quiz_mode=q.eligibility_quiz_mode for share;
      select * into x from private.exam_use_question_contents_v1 where assignment_question_id=q.id;
      selected_identity:=private.new_assignment_vocabulary_identity_v1(q,m,x,selected_identity);
    end if;
    context_value:=private.reviewed_exam_sha256_v1(jsonb_build_array(private.assignment_vocabulary_meaning_context_v1(q.id),selected_identity));
    insert into private.vocabulary_question_meaning_versions(content_version_id,context_hash,identity) values(q.content_version_id,context_value,selected_identity) on conflict do nothing;
    select identity into saved from private.vocabulary_question_meaning_versions where content_version_id=q.content_version_id and context_hash=context_value;
    if saved is distinct from selected_identity then raise exception 'vocabulary_meaning_conflict' using errcode='40001'; end if;
    insert into private.assignment_vocabulary_meaning_refs(assignment_question_id,content_version_id,context_hash)
      values(q.id,q.content_version_id,context_value) on conflict do nothing;
    if not exists(select 1 from private.assignment_vocabulary_meaning_refs where assignment_question_id=q.id and content_version_id=q.content_version_id and context_hash=context_value)
      then raise exception 'vocabulary_meaning_reference_conflict' using errcode='40001'; end if;
    delete from private.assignment_vocabulary_new_questions where assignment_question_id=q.id
      and backend_pid=pg_backend_pid() and transaction_id=txid_current();
  end loop;
end;
$$;

-- Freeze only newly finalized banks; existing content/assignments are untouched.
do $freeze$
declare d text;
begin
  d:=pg_get_functiondef('private.finalize_assignment_question_body_refs_v1(uuid)'::regprocedure);
  if strpos(d,'return p_assignment_id;')=0 then raise exception 'unexpected_question_finalizer'; end if;
  execute replace(d,'return p_assignment_id;','perform private.freeze_assignment_vocabulary_meanings_v1(p_assignment_id); return p_assignment_id;');
end;
$freeze$;

create function private.legacy_vocabulary_meaning_states_v1(p_student_id uuid,p_exclude_question uuid default null,p_exclude_phase text default null,p_excluded_phases jsonb default '[]')
returns table(meaning_key text,word_key text,unresolved boolean,lifetime_wrong_count integer,lifetime_missed_count integer,
  legacy_wrong_count integer,last_question_id uuid,last_wrong_at timestamptz,resolved_at timestamptz,first_wrong_at timestamptz)
language sql stable set search_path='' as $$
  with old_phases as materialized (
    -- A pre-rollout answer can acquire its historical wrong-event only when
    -- the rest of its attempt finishes. Read the persisted phase as well, so
    -- creating a new meaning state early cannot omit that late batch event.
    select coalesce(e.id,0) id,t.student_id,q.vocab_entry_id,t.id quiz_attempt_id,q.id quiz_question_id,s.phase wrong_stage,
      coalesce(case s.phase when 'initial' then qb.initial_wrong_at else qb.retry_wrong_at end,s.answered_at,e.wrong_at,t.completed_at,t.started_at) wrong_at
    from public.quiz_attempts t join public.quiz_questions q on q.attempt_id=t.id
    cross join lateral (values('initial',q.initial_is_correct,q.initial_answered_at),('retry',q.retry_is_correct,q.retry_answered_at)) s(phase,correct,answered_at)
    left join public.student_vocab_wrong_events e on e.quiz_question_id=q.id and e.wrong_stage=s.phase and e.student_id=t.student_id
    left join private.vocabulary_legacy_question_baselines qb on qb.quiz_question_id=q.id
    where t.student_id=p_student_id and (e.id is not null or s.correct is false)
      and (p_exclude_question is null or q.id<>p_exclude_question or s.phase<>p_exclude_phase)
      and not exists(select 1 from jsonb_array_elements(p_excluded_phases) x where (x->>'id')::uuid=q.id and x->>'phase'=s.phase)
      and not exists(select 1 from private.vocabulary_answer_receipts r where r.quiz_question_id=q.id and r.phase=s.phase)
  ), events as materialized (
    select e.*,case when qb.quiz_question_id is not null then qb.retry_is_correct else q.retry_is_correct end retry_is_correct, identity.value,
      case when e.wrong_stage='initial' then q.initial_choice_index is not null and not q.initial_timed_out
        else q.retry_choice_index is not null and not q.retry_timed_out end as actual_choice,
      coalesce(b.existed,s.vocab_entry_id is not null) as old_state_exists,
      case when b.student_id is not null then b.unresolved_wrong_count else s.unresolved_wrong_count end as old_count,
      case when b.student_id is not null then b.resolved_at else s.resolved_at end as old_resolved
    from old_phases e join public.quiz_questions q on q.id=e.quiz_question_id
    left join private.vocabulary_legacy_question_baselines qb on qb.quiz_question_id=q.id
    cross join lateral (select private.quiz_vocabulary_meaning_v1(q.id) value) identity
    left join private.vocabulary_legacy_state_baselines b on b.student_id=e.student_id and b.vocab_entry_id=e.vocab_entry_id
    left join public.student_vocab_state s on s.student_id=e.student_id and s.vocab_entry_id=e.vocab_entry_id
    where e.student_id=p_student_id
  ), grouped as (
    select value->>'meaningKey' meaning_key, min(value->>'wordKey') word_key,
      bool_or(case when old_state_exists then old_count>0 and old_resolved is null else retry_is_correct is not true end) unresolved,
      count(*) filter(where actual_choice)::integer lifetime_wrong_count,
      count(*) filter(where not coalesce(actual_choice,false))::integer lifetime_missed_count,
      count(*) filter(where wrong_stage='initial')::integer legacy_wrong_count,
      (array_agg(quiz_question_id order by wrong_at desc,id desc))[1] last_question_id,max(wrong_at) last_wrong_at,max(old_resolved) resolved_at,min(wrong_at) first_wrong_at
    from events group by value->>'meaningKey'
  ) select meaning_key,word_key,unresolved,lifetime_wrong_count,lifetime_missed_count,legacy_wrong_count,last_question_id,last_wrong_at,
      case when unresolved then null else resolved_at end,first_wrong_at from grouped;
$$;

create function private.accept_vocabulary_answer_v1(p_student_id uuid,p_attempt_id uuid,p_question_id uuid,p_phase text,
  p_choice smallint,p_timeout boolean,p_result jsonb,p_kind text default 'answer',p_excluded_phases jsonb default '[]') returns void
language plpgsql set search_path='' as $$
declare q public.quiz_questions; identity jsonb; outcome_value text; seq bigint; episode uuid;
  current_state private.student_vocabulary_meaning_states; old_state record; actual_correct boolean; actual_timeout boolean;
begin
  -- Callers establish the untouched-stage precondition before existing grading.
  perform private.lock_vocabulary_student_v1(p_student_id);
  if exists(select 1 from private.vocabulary_answer_receipts where quiz_question_id=p_question_id and phase=p_phase) then return; end if;
  select * into q from public.quiz_questions where id=p_question_id and attempt_id=p_attempt_id;
  if not found or not exists(select 1 from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id) then
    raise exception 'question_not_found' using errcode='P0002'; end if;
  actual_correct:=case when p_phase='initial' then q.initial_is_correct else q.retry_is_correct end;
  actual_timeout:=case when p_phase='initial' then q.initial_timed_out else q.retry_timed_out end;
  if actual_correct is null then return; end if;
  outcome_value:=case when p_kind='expiry' then 'unanswered' when actual_timeout then 'timeout' when actual_correct then 'correct' else 'wrong' end;
  identity:=private.quiz_vocabulary_meaning_v1(q.id);
  insert into private.student_vocabulary_versions(student_id,version) values(p_student_id,1)
    on conflict(student_id) do update set version=private.student_vocabulary_versions.version+1 returning version into seq;
  -- The student lock serializes first insertion. Exclude this phase from the
  -- legacy projection even when the old completion trigger just appended it.
  select * into current_state from private.student_vocabulary_meaning_states where student_id=p_student_id and meaning_key=identity->>'meaningKey' for update;
  if not found then
    select * into old_state from private.legacy_vocabulary_meaning_states_v1(p_student_id,q.id,p_phase,p_excluded_phases) x where x.meaning_key=identity->>'meaningKey';
    if outcome_value='correct' and old_state.meaning_key is null then
      -- Successful words with no previous difficulty need no permanent state.
      insert into private.vocabulary_answer_receipts(quiz_question_id,phase,student_id,attempt_id,request_kind,requested_choice,requested_timeout,
        result,outcome,meaning_key,word_key,server_sequence,episode_id)
        values(q.id,p_phase,p_student_id,p_attempt_id,p_kind,p_choice,p_timeout,p_result,outcome_value,identity->>'meaningKey',identity->>'wordKey',seq,null);
      return;
    end if;
    insert into private.student_vocabulary_meaning_states(student_id,meaning_key,word_key,episode_id,unresolved,current_wrong_count,lifetime_wrong_count,
      current_missed_count,lifetime_missed_count,legacy_wrong_count,count_quality,last_sequence,last_question_id,last_wrong_at,resolved_at)
      values(p_student_id,identity->>'meaningKey',identity->>'wordKey',case when coalesce(old_state.unresolved,false)
        then md5('legacy-v1/'||p_student_id::text||'/'||(identity->>'meaningKey'))::uuid end,
      coalesce(old_state.unresolved,false),0,coalesce(old_state.lifetime_wrong_count,0),0,coalesce(old_state.lifetime_missed_count,0),
      coalesce(old_state.legacy_wrong_count,0),case when coalesce(old_state.unresolved,false) then 'legacy-continuation' else 'exact' end,
      0,q.id,old_state.last_wrong_at,old_state.resolved_at) returning * into current_state;
  end if;
  episode:=case when outcome_value<>'correct' and not current_state.unresolved then gen_random_uuid() else current_state.episode_id end;
  update private.student_vocabulary_meaning_states set
    episode_id=episode,unresolved=outcome_value<>'correct',
    current_wrong_count=case when outcome_value='correct' then 0 else current_wrong_count+case when outcome_value='wrong' then 1 else 0 end end,
    lifetime_wrong_count=lifetime_wrong_count+case when outcome_value='wrong' then 1 else 0 end,
    current_missed_count=case when outcome_value='correct' then 0 else current_missed_count+case when outcome_value in ('timeout','unanswered') then 1 else 0 end end,
    lifetime_missed_count=lifetime_missed_count+case when outcome_value in ('timeout','unanswered') then 1 else 0 end,
    count_quality=case when outcome_value='correct' or not current_state.unresolved then 'exact' else count_quality end,
    last_sequence=seq,last_question_id=q.id,last_wrong_at=case when outcome_value='correct' then last_wrong_at else clock_timestamp() end,
    resolved_at=case when outcome_value='correct' then
      case when current_state.unresolved then clock_timestamp() else current_state.resolved_at end end
  where student_id=p_student_id and meaning_key=identity->>'meaningKey';
  insert into private.vocabulary_answer_receipts(quiz_question_id,phase,student_id,attempt_id,request_kind,requested_choice,requested_timeout,
    result,outcome,meaning_key,word_key,server_sequence,episode_id)
    values(q.id,p_phase,p_student_id,p_attempt_id,p_kind,p_choice,p_timeout,p_result,outcome_value,identity->>'meaningKey',identity->>'wordKey',seq,episode);
  if outcome_value='correct' and current_state.unresolved then
    perform private.resolve_vocabulary_review_episode_v1(p_student_id,identity->>'meaningKey',episode);
  elsif outcome_value<>'correct' then
    perform private.reopen_vocabulary_review_episode_v1(p_student_id,identity->>'meaningKey',episode);
  end if;
end;
$$;

-- Copy the four reviewed grading implementations into private functions. Public
-- OIDs stay unchanged. Internal calls never re-enter receipt processing.
do $grading$
declare name text; signature text; d text; suffix text;
begin
  foreach suffix in array array['','_v2','_v3','_v4'] loop
    name:='answer_quiz_question'||suffix;
    signature:='public.'||name||'(uuid,uuid,uuid,text,smallint'||case when suffix='' then '' else ',boolean' end||')';
    d:=pg_get_functiondef(signature::regprocedure);
    d:=replace(d,'public.answer_quiz_question_v4(','private.grade_vocabulary_v4(');
    d:=replace(d,'public.answer_quiz_question_v3(','private.grade_vocabulary_v3(');
    d:=replace(d,'public.answer_quiz_question_v2(','private.grade_vocabulary_v2(');
    d:=replace(d,'public.answer_quiz_question(','private.grade_vocabulary_base(');
    execute d;
  end loop;
end;
$grading$;

create function private.submit_vocabulary_answer_v1(p_student_id uuid,p_attempt_id uuid,p_question_id uuid,p_phase text,
  p_choice smallint,p_timeout boolean,p_version integer) returns jsonb
language plpgsql set search_path='' as $$
declare q public.quiz_questions; receipt private.vocabulary_answer_receipts; expired_result private.vocabulary_expired_answer_results; response jsonb;
begin
  if p_phase is null or p_phase not in ('initial','retry') or p_timeout is null or p_choice is null or p_choice not between 0 and 3 then
    raise exception 'invalid_answer_request' using errcode='22023'; end if;
  perform private.lock_vocabulary_student_v1(p_student_id);
  if not exists(select 1 from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id) then
    raise exception 'attempt_not_found' using errcode='P0002'; end if;
  select * into q from public.quiz_questions where id=p_question_id and attempt_id=p_attempt_id;
  if not found then raise exception 'question_not_found' using errcode='P0002'; end if;
  select * into receipt from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=p_phase;
  if found then
    if receipt.student_id<>p_student_id or receipt.attempt_id<>p_attempt_id then raise exception 'question_not_found' using errcode='P0002'; end if;
    if receipt.request_kind='expiry' then
      select * into expired_result from private.vocabulary_expired_answer_results where quiz_question_id=q.id and phase=p_phase;
      if found then
        if expired_result.requested_choice is distinct from p_choice or expired_result.requested_timeout is distinct from p_timeout then
          raise exception 'question_already_answered' using errcode='22023'; end if;
        return expired_result.result;
      end if;
      return receipt.result;
    end if;
    if receipt.requested_choice is distinct from p_choice or receipt.requested_timeout is distinct from p_timeout then
      raise exception 'question_already_answered' using errcode='22023'; end if;
    return receipt.result;
  end if;
  if (p_phase='initial' and num_nonnulls(q.initial_choice_index,q.initial_is_correct,q.initial_answered_at)>0)
    or (p_phase='retry' and num_nonnulls(q.retry_choice_index,q.retry_is_correct,q.retry_answered_at)>0) then
    raise exception 'question_already_answered' using errcode='22023'; end if;
  perform private.preserve_vocabulary_legacy_questions_v1(p_attempt_id);
  response:=case p_version
    when 1 then private.grade_vocabulary_base(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice)
    when 2 then private.grade_vocabulary_v2(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    when 3 then private.grade_vocabulary_v3(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    when 4 then private.grade_vocabulary_v4(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout)
    else null end;
  if response is null then raise exception 'invalid_answer_version' using errcode='22023'; end if;
  if exists(select 1 from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=p_phase and request_kind='expiry') then
    insert into private.vocabulary_expired_answer_results(quiz_question_id,phase,requested_choice,requested_timeout,result)
      values(q.id,p_phase,p_choice,p_timeout,response);
    return response;
  end if;
  perform private.accept_vocabulary_answer_v1(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice,p_timeout,response);
  perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id);
  return response;
end;
$$;

do $entrypoints$
declare suffix text; d text; sig text;
begin
  foreach suffix in array array['','_v2','_v3','_v4'] loop
    sig:='uuid,uuid,uuid,text,smallint'||case when suffix='' then '' else ',boolean' end;
    d:=format('create or replace function public.answer_quiz_question%s(p_student_id uuid,p_attempt_id uuid,p_question_id uuid,p_phase text,p_choice_index smallint%s) returns jsonb language sql security definer set search_path='''' as $body$ select private.submit_vocabulary_answer_v1(p_student_id,p_attempt_id,p_question_id,p_phase,p_choice_index,%s,%s) $body$',
      suffix,case when suffix='' then '' else ',p_force_timeout boolean default false' end,
      case when suffix='' then 'false' else 'p_force_timeout' end,case when suffix='' then '1' else right(suffix,1) end);
    execute d;
    execute 'revoke all on function public.answer_quiz_question'||suffix||'('||sig||') from public,anon,authenticated';
    execute 'grant execute on function public.answer_quiz_question'||suffix||'('||sig||') to service_role';
  end loop;
end;
$entrypoints$;

-- Expiry gathers only previously untouched stages. Deadline timestamps are not
-- used to order newly accepted events or to decide whether an answer is new.
do $expiry_copy$
declare d text; suffix text; signature text;
begin
  foreach suffix in array array['','_at_v2'] loop
    signature:='private.finalize_expired_quiz_attempt'||suffix||'(uuid,uuid'||case when suffix='' then '' else ',timestamp with time zone' end||')';
    d:=pg_get_functiondef(signature::regprocedure);
    execute replace(d,'private.finalize_expired_quiz_attempt'||suffix||'(','private.m03_grade_expired_attempt'||suffix||'(');
  end loop;
end;
$expiry_copy$;
create function private.finalize_vocabulary_expiry_v1(p_student_id uuid,p_attempt_id uuid,p_evaluation_at timestamptz,p_legacy boolean)
returns jsonb language plpgsql set search_path='' as $$
declare pending jsonb; item jsonb; response jsonb; phase_value text; previous_status text;
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  select phase::text,status::text into phase_value,previous_status from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id for update;
  if not found then raise exception 'attempt_not_found' using errcode='P0002'; end if;
  if previous_status='in_progress' then perform private.preserve_vocabulary_legacy_questions_v1(p_attempt_id); end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'phase',s.phase) order by q.order_index,s.phase),'[]') into pending
    from public.quiz_questions q cross join lateral (values('initial',q.initial_choice_index,q.initial_is_correct,q.initial_answered_at),('retry',q.retry_choice_index,q.retry_is_correct,q.retry_answered_at)) s(phase,choice,correct,answered)
    where q.attempt_id=p_attempt_id and s.choice is null and s.correct is null and s.answered is null
      and (s.phase='initial' or phase_value='retry' and q.initial_is_correct is false);
  response:=case when p_legacy then private.m03_grade_expired_attempt(p_student_id,p_attempt_id)
    else private.m03_grade_expired_attempt_at_v2(p_student_id,p_attempt_id,p_evaluation_at) end;
  for item in select value from jsonb_array_elements(pending) loop
    perform private.accept_vocabulary_answer_v1(p_student_id,p_attempt_id,(item->>'id')::uuid,item->>'phase',null,true,response,'expiry',pending);
  end loop;
  if previous_status='in_progress' then perform private.reopen_terminal_vocabulary_reviews_v1(p_student_id,p_attempt_id); end if;
  return response;
end;
$$;
create or replace function private.finalize_expired_quiz_attempt(p_student_id uuid,p_attempt_id uuid) returns jsonb
language sql security definer set search_path='' as $$ select private.finalize_vocabulary_expiry_v1(p_student_id,p_attempt_id,null,true) $$;
create or replace function private.finalize_expired_quiz_attempt_at_v2(p_student_id uuid,p_attempt_id uuid,p_evaluation_at timestamptz) returns jsonb
language sql security definer set search_path='' as $$ select private.finalize_vocabulary_expiry_v1(p_student_id,p_attempt_id,p_evaluation_at,false) $$;

create function private.current_vocabulary_meaning_states_v1(p_student_id uuid)
returns table(meaning_key text,word_key text,episode_id uuid,unresolved boolean,current_wrong_count integer,lifetime_wrong_count integer,
  current_missed_count integer,lifetime_missed_count integer,legacy_wrong_count integer,count_quality text,last_sequence bigint,
  last_question_id uuid,last_wrong_at timestamptz,resolved_at timestamptz)
language sql stable set search_path='' as $$
  select s.meaning_key,s.word_key,s.episode_id,s.unresolved,s.current_wrong_count,s.lifetime_wrong_count,s.current_missed_count,s.lifetime_missed_count,
    s.legacy_wrong_count,s.count_quality,s.last_sequence,s.last_question_id,s.last_wrong_at,s.resolved_at
  from private.student_vocabulary_meaning_states s where s.student_id=p_student_id
  union all
  select l.meaning_key,l.word_key,md5('legacy-v1/'||p_student_id::text||'/'||l.meaning_key)::uuid,l.unresolved,0,l.lifetime_wrong_count,
    0,l.lifetime_missed_count,l.legacy_wrong_count,'legacy-continuation',0,l.last_question_id,l.last_wrong_at,l.resolved_at
  from private.legacy_vocabulary_meaning_states_v1(p_student_id) l
  where not exists(select 1 from private.student_vocabulary_meaning_states s where s.student_id=p_student_id and s.meaning_key=l.meaning_key);
$$;

-- NULL legacy references always point to the legacy episode, not a later one.
create function private.vocabulary_queue_identity_v1(p_queue_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object('meaningKey',coalesce(q.meaning_key_snapshot,i.value->>'meaningKey'),
    'episodeId',coalesce(q.mistake_episode_id,md5('legacy-v1/'||q.student_id::text||'/'||(i.value->>'meaningKey'))::uuid),
    'sourcePhase',coalesce(q.source_phase_snapshot,'initial'))
  from public.student_vocab_review_queue q cross join lateral(select private.quiz_vocabulary_meaning_v1(q.source_question_id) value) i where q.id=p_queue_id
$$;

-- Legacy evidence keeps NULL distinct from an actual wrong answer and never
-- substitutes an initial event for a selected retry phase.
create function private.vocabulary_legacy_failure_evidence_v1(p_student_id uuid,p_question_id uuid,p_phase text) returns jsonb
language plpgsql stable set search_path='' as $$
declare q public.quiz_questions; baseline private.vocabulary_legacy_question_baselines; ev public.student_vocab_wrong_events;
  phase_correct boolean; has_baseline boolean; failure_at timestamptz;
begin
  if p_phase is null or p_phase not in('initial','retry') then return null; end if;
  select qq.* into q from public.quiz_questions qq join public.quiz_attempts a on a.id=qq.attempt_id
    where qq.id=p_question_id and a.student_id=p_student_id;
  if q.id is null or exists(select 1 from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=p_phase) then return null; end if;
  select * into baseline from private.vocabulary_legacy_question_baselines where quiz_question_id=q.id;
  has_baseline:=found;
  phase_correct:=case when p_phase='initial' then q.initial_is_correct when has_baseline then baseline.retry_is_correct else q.retry_is_correct end;
  if phase_correct is true then return null; end if;
  select e.* into ev from public.student_vocab_wrong_events e join public.vocab_entries v on v.id=q.vocab_entry_id
    where e.student_id=p_student_id and e.quiz_attempt_id=q.attempt_id and e.quiz_question_id=q.id and e.wrong_stage=p_phase
      and e.vocab_entry_id=q.vocab_entry_id and e.dataset_id=v.dataset_id;
  if phase_correct is null and ev.id is null then return null; end if;
  failure_at:=coalesce(ev.wrong_at,case when p_phase='initial' then baseline.initial_wrong_at else baseline.retry_wrong_at end,
    case when p_phase='initial' then q.initial_answered_at else q.retry_answered_at end);
  return jsonb_build_object('evidenceKind',case when phase_correct is false then 'phase_false' else 'wrong_event' end,
    'phaseIsCorrect',phase_correct,'baselinePresent',has_baseline,'baselineRetryIsCorrect',baseline.retry_is_correct,
    'failureAt',failure_at,'wrongEventId',ev.id);
end;
$$;
revoke all on function private.vocabulary_legacy_failure_evidence_v1(uuid,uuid,text) from public,anon,authenticated,service_role;

create function private.assert_vocabulary_mistake_targets_v1(p_student_id uuid,p_targets jsonb) returns void
language plpgsql set search_path='' as $$
declare item jsonb; st record; q public.quiz_questions; receipt private.vocabulary_answer_receipts; version_value bigint;
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 500
    or (select count(distinct value->>'meaningKey') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets) then
    raise exception 'invalid_mistake_targets' using errcode='22023'; end if;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into version_value;
  for item in select value from jsonb_array_elements(p_targets) loop
    if jsonb_typeof(item) is distinct from 'object' or not(item ?& array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion'])
      or item->>'sourceQuestionId' is null or item->>'episodeId' is null or item->>'stateVersion' is null or item->>'meaningKey' is null
      or item->>'sourcePhase' is null or item->>'sourcePhase' not in ('initial','retry') or item->>'meaningKey' !~ '^[a-f0-9]{64}$'
      or item->>'stateVersion' !~ '^[0-9]{1,19}$'
      or exists(select 1 from jsonb_object_keys(item) k where not(k=any(array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion']))) then
      raise exception 'invalid_mistake_targets' using errcode='22023'; end if;
    if (item->>'stateVersion')::bigint<>version_value then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    select * into st from private.current_vocabulary_meaning_states_v1(p_student_id) where meaning_key=item->>'meaningKey';
    if st.meaning_key is null or not st.unresolved or st.episode_id is distinct from (item->>'episodeId')::uuid then
      raise exception 'wrong_history_changed' using errcode='40001'; end if;
    select question.* into q from public.quiz_questions question join public.quiz_attempts a on a.id=question.attempt_id
      where question.id=(item->>'sourceQuestionId')::uuid and a.student_id=p_student_id;
    if not found or private.quiz_vocabulary_meaning_v1(q.id)->>'meaningKey' is distinct from item->>'meaningKey' then
      raise exception 'review_question_not_available' using errcode='22023'; end if;
    select * into receipt from private.vocabulary_answer_receipts where quiz_question_id=q.id and phase=item->>'sourcePhase';
    if found then
      if receipt.outcome='correct' or receipt.episode_id is distinct from st.episode_id then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    elsif private.vocabulary_legacy_failure_evidence_v1(p_student_id,q.id,item->>'sourcePhase') is null
      or st.episode_id is distinct from md5('legacy-v1/'||p_student_id::text||'/'||(item->>'meaningKey'))::uuid then
      raise exception 'review_question_not_available' using errcode='22023';
    end if;
  end loop;
end;
$$;

create function private.guard_vocabulary_review_queue_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity jsonb; st record; question public.quiz_questions; receipt private.vocabulary_answer_receipts;
  selected_phase text; selected_episode uuid;
begin
  perform private.lock_vocabulary_student_v1(new.student_id);
  if tg_op='UPDATE' then
    if new.student_id is distinct from old.student_id or new.meaning_key_snapshot is distinct from old.meaning_key_snapshot
      or new.mistake_episode_id is distinct from old.mistake_episode_id or new.source_phase_snapshot is distinct from old.source_phase_snapshot
      or (new.source_question_id,new.source_attempt_id,new.dataset_id,new.vocab_entry_id)
        is distinct from (old.source_question_id,old.source_attempt_id,old.dataset_id,old.vocab_entry_id) then
      raise exception 'mistake_reference_immutable' using errcode='55000'; end if;
    if new.status='cancelled' or (new.status is not distinct from old.status and new.reserved_review_draft_id is null)
      or (new.status is not distinct from old.status and new.reserved_review_draft_id is not distinct from old.reserved_review_draft_id
        and new.consumed_assignment_id is not distinct from old.consumed_assignment_id and new.source_question_id is not distinct from old.source_question_id) then return new; end if;
    identity:=private.vocabulary_queue_identity_v1(old.id);
    if not exists(select 1 from private.current_vocabulary_meaning_states_v1(new.student_id) s
      where s.meaning_key=identity->>'meaningKey' and s.episode_id=(identity->>'episodeId')::uuid and s.unresolved) then
      raise exception 'wrong_history_changed' using errcode='40001'; end if;
    if new.status='pending' and old.status<>'pending' and exists(
      select 1 from public.student_vocab_review_queue other cross join lateral(select private.vocabulary_queue_identity_v1(other.id) value) x
      where other.id<>old.id and other.student_id=new.student_id and other.status='pending'
        and x.value->>'meaningKey'=identity->>'meaningKey' and x.value->>'episodeId'=identity->>'episodeId') then
      raise exception 'review_word_already_queued' using errcode='40001'; end if;
    return new;
  end if;
  select q.* into question from public.quiz_questions q join public.quiz_attempts a on a.id=q.attempt_id
    where q.id=new.source_question_id and a.id=new.source_attempt_id and a.student_id=new.student_id;
  if not found or question.vocab_entry_id<>new.vocab_entry_id then raise exception 'review_question_not_available' using errcode='22023'; end if;
  identity:=private.quiz_vocabulary_meaning_v1(question.id);
  select * into st from private.current_vocabulary_meaning_states_v1(new.student_id) s where s.meaning_key=identity->>'meaningKey';
  if st.meaning_key is null or not st.unresolved then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  select * into receipt from private.vocabulary_answer_receipts where quiz_question_id=question.id and outcome<>'correct'
    and (new.source_phase_snapshot is null or phase=new.source_phase_snapshot) order by server_sequence desc limit 1;
  if found then selected_phase:=receipt.phase; selected_episode:=receipt.episode_id;
  else
    selected_phase:=coalesce(new.source_phase_snapshot,case when question.retry_is_correct is false then 'retry' else 'initial' end);
    if private.vocabulary_legacy_failure_evidence_v1(new.student_id,question.id,selected_phase) is null then
      raise exception 'review_question_not_available' using errcode='22023'; end if;
    selected_episode:=md5('legacy-v1/'||new.student_id::text||'/'||(identity->>'meaningKey'))::uuid;
  end if;
  if selected_episode is distinct from st.episode_id or (new.meaning_key_snapshot is not null and new.meaning_key_snapshot is distinct from st.meaning_key)
    or (new.mistake_episode_id is not null and new.mistake_episode_id is distinct from selected_episode) then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  if exists(select 1 from public.student_vocab_review_queue other cross join lateral(select private.vocabulary_queue_identity_v1(other.id) value) x
    where other.student_id=new.student_id and other.status='pending' and x.value->>'meaningKey'=st.meaning_key
      and x.value->>'episodeId'=st.episode_id::text) then raise exception 'review_word_already_queued' using errcode='40001'; end if;
  new.meaning_key_snapshot:=st.meaning_key; new.mistake_episode_id:=st.episode_id; new.source_phase_snapshot:=selected_phase;
  return new;
end;
$$;
create trigger zz_guard_vocabulary_review_queue before insert or update on public.student_vocab_review_queue
  for each row execute function private.guard_vocabulary_review_queue_v1();

create or replace function private.reject_duplicate_active_review_target() returns trigger
language plpgsql security definer set search_path='' as $$
declare queue public.student_vocab_review_queue; identity jsonb; target_identity jsonb;
begin
  perform private.lock_vocabulary_student_v1(new.student_id);
  select * into queue from public.student_vocab_review_queue where id=new.review_queue_id for update;
  if queue.id is null or queue.student_id<>new.student_id or queue.status not in ('pending','consumed')
    or (queue.status='pending' and queue.reserved_review_draft_id is not null)
    or (queue.status='consumed' and queue.consumed_assignment_id is distinct from new.assignment_id)
    or not exists(select 1 from public.assignment_questions q where q.id=new.assignment_question_id and q.assignment_id=new.assignment_id
      and q.vocab_entry_id=new.vocab_entry_id and q.dataset_id=new.dataset_id)
    or not exists(select 1 from public.assignment_students s where s.assignment_id=new.assignment_id and s.student_id=new.student_id and s.cancelled_at is null) then
    raise exception 'review_target_source_mismatch' using errcode='22023'; end if;
  identity:=private.vocabulary_queue_identity_v1(queue.id);
  target_identity:=private.assignment_vocabulary_meaning_v1(new.assignment_question_id);
  if target_identity->>'meaningKey' is distinct from identity->>'meaningKey'
    or not exists(select 1 from private.current_vocabulary_meaning_states_v1(new.student_id) s where s.meaning_key=identity->>'meaningKey'
      and s.episode_id=(identity->>'episodeId')::uuid and s.unresolved) then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  if (new.meaning_key_snapshot is not null and new.meaning_key_snapshot is distinct from identity->>'meaningKey')
    or (new.mistake_episode_id is not null and new.mistake_episode_id is distinct from (identity->>'episodeId')::uuid) then
    raise exception 'review_target_source_mismatch' using errcode='22023'; end if;
  if exists(select 1 from public.assignment_review_targets t cross join lateral(select private.vocabulary_queue_identity_v1(t.review_queue_id) value) x
    where t.student_id=new.student_id and t.released_at is null and x.value->>'meaningKey'=identity->>'meaningKey' and x.value->>'episodeId'=identity->>'episodeId') then
    raise exception 'review_word_already_assigned' using errcode='40001'; end if;
  new.meaning_key_snapshot:=identity->>'meaningKey'; new.mistake_episode_id:=(identity->>'episodeId')::uuid;
  return new;
end;
$$;
create function private.guard_vocabulary_review_target_update_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if (new.student_id,new.assignment_id,new.assignment_question_id,new.review_queue_id,new.meaning_key_snapshot,new.mistake_episode_id,new.dataset_id,new.vocab_entry_id)
    is distinct from (old.student_id,old.assignment_id,old.assignment_question_id,old.review_queue_id,old.meaning_key_snapshot,old.mistake_episode_id,old.dataset_id,old.vocab_entry_id)
    or (old.released_at is not null and new.released_at is null) then raise exception 'mistake_reference_immutable' using errcode='55000'; end if;
  return new;
end;
$$;
create trigger zz_guard_vocabulary_review_target_update before update on public.assignment_review_targets
  for each row execute function private.guard_vocabulary_review_target_update_v1();
create or replace function private.reject_active_review_queue_consumption() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity jsonb;
begin
  if old.status='pending' and new.status='consumed' then
    identity:=private.vocabulary_queue_identity_v1(old.id);
    if exists(select 1 from public.assignment_review_targets t cross join lateral(select private.vocabulary_queue_identity_v1(t.review_queue_id) value) x
      where t.student_id=old.student_id and t.released_at is null and t.assignment_id is distinct from new.consumed_assignment_id
        and x.value->>'meaningKey'=identity->>'meaningKey' and x.value->>'episodeId'=identity->>'episodeId') then
      raise exception 'review_word_already_assigned' using errcode='40001'; end if;
  end if;
  return new;
end;
$$;

create or replace function private.queue_student_vocab_review_words(p_student_id uuid,p_question_ids uuid[]) returns uuid[]
language plpgsql security definer set search_path='' as $$
declare question_id uuid; q public.quiz_questions; identity jsonb; st record; existing_id uuid; queued uuid[]:='{}'; event public.student_vocab_wrong_events;
  reason smallint; phase_value text; episode_value uuid;
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_question_ids is null or cardinality(p_question_ids) not between 1 and 500
    or cardinality(p_question_ids)<>(select count(distinct id) from unnest(p_question_ids) id where id is not null) then
    raise exception 'invalid_review_question_selection' using errcode='22023'; end if;
  perform private.lock_vocabulary_student_v1(p_student_id);
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null) then raise exception 'student_not_active' using errcode='22023'; end if;
  foreach question_id in array p_question_ids loop
    select question.* into q from public.quiz_questions question join public.quiz_attempts a on a.id=question.attempt_id
      where question.id=question_id and a.student_id=p_student_id;
    if not found then raise exception 'review_question_not_available' using errcode='22023'; end if;
    identity:=private.quiz_vocabulary_meaning_v1(q.id);
    select * into st from private.current_vocabulary_meaning_states_v1(p_student_id) where meaning_key=identity->>'meaningKey';
    if st.meaning_key is null or not st.unresolved then raise exception 'review_question_not_available' using errcode='22023'; end if;
    select phase,episode_id into phase_value,episode_value from private.vocabulary_answer_receipts where quiz_question_id=q.id and outcome<>'correct' order by server_sequence desc limit 1;
    if not found then
      phase_value:=case when q.retry_is_correct is false then 'retry' else 'initial' end;
      if private.vocabulary_legacy_failure_evidence_v1(p_student_id,q.id,phase_value) is null then raise exception 'review_question_not_available' using errcode='22023'; end if;
      episode_value:=md5('legacy-v1/'||p_student_id::text||'/'||st.meaning_key)::uuid;
    end if;
    if episode_value is distinct from st.episode_id then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    if exists(select 1 from public.assignment_review_targets t cross join lateral(select private.vocabulary_queue_identity_v1(t.review_queue_id) value) x
      where t.student_id=p_student_id and t.released_at is null and x.value->>'meaningKey'=st.meaning_key and x.value->>'episodeId'=st.episode_id::text) then
      raise exception 'review_word_already_assigned' using errcode='40001'; end if;
    select queue.id into existing_id from public.student_vocab_review_queue queue cross join lateral(select private.vocabulary_queue_identity_v1(queue.id) value) x
      where queue.student_id=p_student_id and queue.status='pending' and x.value->>'meaningKey'=st.meaning_key and x.value->>'episodeId'=st.episode_id::text
      order by queue.id limit 1 for update of queue;
    if existing_id is null then
      select * into event from public.student_vocab_wrong_events where student_id=p_student_id and quiz_question_id=q.id order by id desc limit 1;
      select greatest(1,least(2,count(distinct e.quiz_attempt_id)))::smallint into reason from public.student_vocab_wrong_events e
        where e.student_id=p_student_id and e.wrong_stage='initial' and private.quiz_vocabulary_meaning_v1(e.quiz_question_id)->>'meaningKey'=st.meaning_key;
      insert into public.student_vocab_review_queue(student_id,dataset_id,vocab_entry_id,source_attempt_id,source_question_id,reason_level,queued_by,
        canonical_dictionary_id_snapshot,canonical_lexeme_id_snapshot,source_exam_use_release_id_snapshot,source_occurrence_id_snapshot,
        meaning_key_snapshot,mistake_episode_id,source_phase_snapshot)
      values(p_student_id,(select dataset_id from public.vocab_entries where id=q.vocab_entry_id),q.vocab_entry_id,q.attempt_id,q.id,reason,auth.uid(),
        event.canonical_dictionary_id_snapshot,event.canonical_lexeme_id_snapshot,event.exam_use_release_id_snapshot,event.occurrence_id_snapshot,
        st.meaning_key,st.episode_id,phase_value) returning id into existing_id;
    end if;
    if not(existing_id=any(queued)) then queued:=array_append(queued,existing_id); end if;
  end loop;
  return queued;
end;
$$;
-- Keep the legacy two-argument entry point, but new explicit targets preserve
-- the selected phase rather than silently choosing a later retry receipt.
do $queue_phases$
declare definition text;
begin
  definition:=pg_get_functiondef('private.queue_student_vocab_review_words(uuid,uuid[])'::regprocedure);
  if strpos(definition,'p_question_ids uuid[])')=0 or strpos(definition,'reason smallint; phase_value text; episode_value uuid;')=0
    or strpos(definition,'where quiz_question_id=q.id and outcome<>''correct'' order by server_sequence desc limit 1;')=0
    or strpos(definition,'foreach question_id in array p_question_ids loop')=0
    or strpos(definition,'phase_value:=case when q.retry_is_correct is false then ''retry'' else ''initial'' end;')=0
    then raise exception 'unexpected_review_phase_writer'; end if;
  definition:=replace(definition,'private.queue_student_vocab_review_words(','private.queue_student_vocabulary_targets_v1(');
  definition:=replace(definition,'p_question_ids uuid[])','p_question_ids uuid[], p_targets jsonb)');
  definition:=replace(definition,'reason smallint; phase_value text; episode_value uuid;','reason smallint; phase_value text; episode_value uuid; requested_phase text;');
  definition:=replace(definition,'foreach question_id in array p_question_ids loop',
    'if p_targets is not null then perform private.assert_vocabulary_mistake_targets_v1(p_student_id,p_targets); end if;
  foreach question_id in array p_question_ids loop
    requested_phase:=(select value->>''sourcePhase'' from jsonb_array_elements(p_targets) where value->>''sourceQuestionId''=question_id::text);');
  definition:=replace(definition,'where quiz_question_id=q.id and outcome<>''correct'' order by server_sequence desc limit 1;',
    'where quiz_question_id=q.id and outcome<>''correct'' and (requested_phase is null or phase=requested_phase) order by server_sequence desc limit 1;');
  definition:=replace(definition,'phase_value:=case when q.retry_is_correct is false then ''retry'' else ''initial'' end;',
    'phase_value:=coalesce(requested_phase,case when q.retry_is_correct is false then ''retry'' else ''initial'' end);');
  execute definition;
end;
$queue_phases$;
revoke all on function private.queue_student_vocabulary_targets_v1(uuid,uuid[],jsonb) from public,anon,authenticated,service_role;
create or replace function private.queue_student_vocab_review_words(p_student_id uuid,p_question_ids uuid[]) returns uuid[]
language sql security definer set search_path='' as $$
  select private.queue_student_vocabulary_targets_v1(p_student_id,p_question_ids,null)
$$;
create function public.queue_student_vocabulary_mistakes_v1(p_student_id uuid,p_targets jsonb) returns uuid[]
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  perform private.assert_vocabulary_mistake_targets_v1(p_student_id,p_targets);
  return private.queue_student_vocabulary_targets_v1(p_student_id,array(select (value->>'sourceQuestionId')::uuid from jsonb_array_elements(p_targets)),p_targets);
end;
$$;
revoke all on function public.queue_student_vocabulary_mistakes_v1(uuid,jsonb) from public,anon,service_role;
grant execute on function public.queue_student_vocabulary_mistakes_v1(uuid,jsonb) to authenticated;

create function private.resolve_vocabulary_review_episode_v1(p_student_id uuid,p_meaning_key text,p_episode_id uuid) returns void
language plpgsql set search_path='' as $$
begin
  -- No ongoing question or assignment is rewritten by another test's answer.
  update public.student_vocab_review_queue queue set status='cancelled',cancelled_at=clock_timestamp(),consumed_assignment_id=null,
    consumed_at=null,reserved_review_draft_id=null,reserved_at=null
    where queue.student_id=p_student_id and queue.status in ('pending','consumed')
      and private.vocabulary_queue_identity_v1(queue.id)->>'meaningKey'=p_meaning_key
      and private.vocabulary_queue_identity_v1(queue.id)->>'episodeId'=p_episode_id::text;
  update public.assignment_review_targets t set released_at=clock_timestamp(),release_reason='resolved'
    where t.student_id=p_student_id and t.released_at is null
      and private.vocabulary_queue_identity_v1(t.review_queue_id)->>'meaningKey'=p_meaning_key
      and private.vocabulary_queue_identity_v1(t.review_queue_id)->>'episodeId'=p_episode_id::text;
end;
$$;

-- The old word-level projection remains compatibility data. Remove its broad
-- queue cancellation; only the final classified answer resolves a meaning.
do $resolution$
declare definition text; marker text:=E'  update public.student_vocab_review_queue as queue\n';
begin
  definition:=pg_get_functiondef('private.resolve_vocab_state_on_correct_answer()'::regprocedure);
  if strpos(definition,marker)=0 then raise exception 'mistake_resolution_patch_missing'; end if;
  definition:=substring(definition from 1 for strpos(definition,marker)-1)||E'  return new;\nend;\n$function$';
  execute definition;
end;
$resolution$;

create function private.reopen_vocabulary_review_episode_v1(p_student_id uuid,p_meaning_key text,p_episode_id uuid) returns uuid
language plpgsql set search_path='' as $$
declare queue_id uuid; reason smallint;
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  if not exists(select 1 from private.current_vocabulary_meaning_states_v1(p_student_id) s
    where s.meaning_key=p_meaning_key and s.episode_id=p_episode_id and s.unresolved) then return null; end if;
  if exists(select 1 from public.assignment_review_targets t where t.student_id=p_student_id and t.released_at is null
    and private.vocabulary_queue_identity_v1(t.review_queue_id)->>'meaningKey'=p_meaning_key
    and private.vocabulary_queue_identity_v1(t.review_queue_id)->>'episodeId'=p_episode_id::text) then return null; end if;
  select q.id into queue_id from public.student_vocab_review_queue q where q.student_id=p_student_id and q.reserved_review_draft_id is null
    and private.vocabulary_queue_identity_v1(q.id)->>'meaningKey'=p_meaning_key
    and private.vocabulary_queue_identity_v1(q.id)->>'episodeId'=p_episode_id::text
    order by (q.status='pending') desc,q.updated_at desc,q.id limit 1 for update;
  if queue_id is null then return null; end if;
  select greatest(1,least(2,count(distinct e.quiz_attempt_id)))::smallint into reason from public.student_vocab_wrong_events e
    where e.student_id=p_student_id and e.wrong_stage='initial' and private.quiz_vocabulary_meaning_v1(e.quiz_question_id)->>'meaningKey'=p_meaning_key;
  update public.student_vocab_review_queue set status='pending',reason_level=greatest(reason_level,reason),
    consumed_assignment_id=null,consumed_at=null,cancelled_at=null,reserved_review_draft_id=null,reserved_at=null where id=queue_id;
  return queue_id;
end;
$$;
create or replace function private.reopen_selected_vocab_review_queue_after_state_change() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- The old projection is updated midway through grading. Final receipt
  -- processing and terminal/missed-target handling perform the exact reopen.
  return new;
end;
$$;
create or replace function private.reopen_selected_vocab_review_queue_after_missed_target() returns trigger
language plpgsql security definer set search_path='' as $$
declare identity jsonb;
begin
  if old.released_at is null and new.released_at is not null and new.release_reason='missed' then
    identity:=private.vocabulary_queue_identity_v1(new.review_queue_id);
    perform private.reopen_vocabulary_review_episode_v1(new.student_id,identity->>'meaningKey',(identity->>'episodeId')::uuid);
  end if;
  return new;
end;
$$;
create or replace function private.reopen_selected_vocab_review_queue_v1(p_student_id uuid,p_vocab_entry_id bigint,p_wrong_count integer) returns uuid
language plpgsql security definer set search_path='' as $$
declare identity record; result uuid; current_id uuid;
begin
  if coalesce(p_wrong_count,0)<=0 then return null; end if;
  perform private.lock_vocabulary_student_v1(p_student_id);
  for identity in select distinct private.vocabulary_queue_identity_v1(q.id) value from public.student_vocab_review_queue q
    where q.student_id=p_student_id and q.vocab_entry_id=p_vocab_entry_id loop
    current_id:=private.reopen_vocabulary_review_episode_v1(p_student_id,identity.value->>'meaningKey',(identity.value->>'episodeId')::uuid);
    result:=coalesce(result,current_id);
  end loop;
  return result;
end;
$$;

create or replace function private.link_pending_review_targets_v2(p_assignment_id uuid,p_student_ids uuid[],p_selected_queue_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare selected record; identity jsonb;
begin
  perform 1 from public.students where id=any(p_student_ids) order by id for update;
  -- Every caller has finished its immutable bank and sidecars at this point.
  perform private.finalize_assignment_question_body_refs_v1(p_assignment_id);
  for selected in select q.*,link.student_id from public.assignment_students link join public.assignment_questions q on q.assignment_id=link.assignment_id
    where link.assignment_id=p_assignment_id and link.student_id=any(p_student_ids) and link.cancelled_at is null and link.missed_at is null
    order by link.student_id,q.base_order_index loop
    identity:=private.assignment_vocabulary_meaning_v1(selected.id);
    if exists(select 1 from public.assignment_review_targets existing
      cross join lateral(select private.vocabulary_queue_identity_v1(existing.review_queue_id) value) qi
      join private.current_vocabulary_meaning_states_v1(selected.student_id) st on st.meaning_key=qi.value->>'meaningKey'
        and st.unresolved and st.episode_id=(qi.value->>'episodeId')::uuid
      where existing.student_id=selected.student_id and existing.assignment_id<>p_assignment_id and existing.released_at is null
        and st.meaning_key=identity->>'meaningKey') then
      raise exception 'review_word_already_assigned' using errcode='40001'; end if;
    insert into public.assignment_review_targets(assignment_id,student_id,review_queue_id,assignment_question_id,dataset_id,vocab_entry_id,
      canonical_lexeme_id_snapshot,canonical_dictionary_id_snapshot)
    select p_assignment_id,selected.student_id,queue.id,selected.id,selected.dataset_id,selected.vocab_entry_id,
      selected.canonical_lexeme_id_snapshot,queue.canonical_dictionary_id_snapshot
    from public.student_vocab_review_queue queue cross join lateral(select private.vocabulary_queue_identity_v1(queue.id) value) qi
    join lateral(select * from private.current_vocabulary_meaning_states_v1(selected.student_id) s where s.meaning_key=qi.value->>'meaningKey') st on true
    where queue.student_id=selected.student_id and qi.value->>'meaningKey'=identity->>'meaningKey'
      and st.unresolved and st.episode_id=(qi.value->>'episodeId')::uuid
      and ((queue.status='pending' and queue.reserved_review_draft_id is null)
        or (queue.status='consumed' and queue.consumed_assignment_id=p_assignment_id))
      and (p_selected_queue_ids is null or queue.id=any(p_selected_queue_ids))
      and not exists(select 1 from public.assignment_review_targets existing where existing.student_id=selected.student_id and existing.released_at is null
        and private.vocabulary_queue_identity_v1(existing.review_queue_id)->>'meaningKey'=identity->>'meaningKey'
        and private.vocabulary_queue_identity_v1(existing.review_queue_id)->>'episodeId'=st.episode_id::text)
    order by case when p_selected_queue_ids is not null then array_position(p_selected_queue_ids,queue.id) end,queue.reason_level desc,queue.queued_at,queue.id limit 1;
  end loop;
  return (select count(*)::integer from public.assignment_review_targets t where t.assignment_id=p_assignment_id and t.student_id=any(p_student_ids)
    and t.released_at is null and (p_selected_queue_ids is null or t.review_queue_id=any(p_selected_queue_ids)));
end;
$$;
create or replace function private.link_pending_review_targets_v1(p_assignment_id uuid,p_student_ids uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare before_count integer;
begin
  select count(*) into before_count from public.assignment_review_targets where assignment_id=p_assignment_id and student_id=any(p_student_ids) and released_at is null;
  return private.link_pending_review_targets_v2(p_assignment_id,p_student_ids,null)-before_count;
end;
$$;

create function private.assert_vocabulary_review_queue_current_v1(p_student_id uuid,p_queue_ids uuid[]) returns void
language plpgsql set search_path='' as $$
declare item record; keys text[]:=array[]::text[];
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  if p_queue_ids is null or cardinality(p_queue_ids) not between 1 and 500
    or (select count(distinct id) from unnest(p_queue_ids) id)<>cardinality(p_queue_ids) then
    raise exception 'invalid_mixed_review_selection' using errcode='22023'; end if;
  if (select count(*) from public.student_vocab_review_queue where student_id=p_student_id and id=any(p_queue_ids))<>cardinality(p_queue_ids) then
    raise exception 'wrong_history_changed' using errcode='40001'; end if;
  for item in select q.id,qi.value from public.student_vocab_review_queue q
    cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value) qi
    where q.student_id=p_student_id and q.id=any(p_queue_ids) order by q.id for update of q loop
    if item.value->>'meaningKey'=any(keys) or not exists(select 1 from private.current_vocabulary_meaning_states_v1(p_student_id) s
      where s.meaning_key=item.value->>'meaningKey' and s.episode_id=(item.value->>'episodeId')::uuid and s.unresolved) then
      raise exception 'wrong_history_changed' using errcode='40001'; end if;
    keys:=array_append(keys,item.value->>'meaningKey');
  end loop;
end;
$$;

create function private.available_vocabulary_review_queues_v1(p_student_id uuid)
returns table(queue_id uuid,meaning_key text,episode_id uuid)
language sql stable set search_path='' as $$
  with states as materialized(select * from private.current_vocabulary_meaning_states_v1(p_student_id) where unresolved),
  active as materialized(select ti.value->>'meaningKey' meaning_key,ti.value->>'episodeId' episode_id
    from public.assignment_review_targets t cross join lateral(select private.vocabulary_queue_identity_v1(t.review_queue_id) value) ti
    where t.student_id=p_student_id and t.released_at is null)
  select q.id,s.meaning_key,s.episode_id from public.student_vocab_review_queue q
    cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value) qi
    join states s on s.meaning_key=qi.value->>'meaningKey'
      and s.episode_id=(qi.value->>'episodeId')::uuid and s.unresolved
    where q.student_id=p_student_id and q.status='pending' and q.reserved_review_draft_id is null
      and not exists(select 1 from active t where t.meaning_key=s.meaning_key and t.episode_id=s.episode_id::text);
$$;

create function private.assert_vocabulary_review_bank_v1(p_student_id uuid,p_assignment_id uuid,p_queue_ids uuid[]) returns void
language plpgsql set search_path='' as $$
declare offset_value integer; linked uuid[];
begin
  perform private.assert_vocabulary_review_queue_current_v1(p_student_id,p_queue_ids);
  perform private.finalize_assignment_question_body_refs_v1(p_assignment_id);
  select count(*)-cardinality(p_queue_ids) into offset_value from public.assignment_questions where assignment_id=p_assignment_id;
  if offset_value<0 or exists(select 1 from unnest(p_queue_ids) with ordinality selected(id,position)
    left join public.assignment_questions aq on aq.assignment_id=p_assignment_id and aq.base_order_index=offset_value+selected.position
    where aq.id is null or private.assignment_vocabulary_meaning_v1(aq.id)->>'meaningKey'
      is distinct from private.vocabulary_queue_identity_v1(selected.id)->>'meaningKey') then
    raise exception 'review_target_meaning_changed' using errcode='40001'; end if;
  if offset_value>0 and exists(select 1 from public.assignment_questions aq
    join public.student_vocab_review_queue q on q.student_id=p_student_id and q.status='pending' and not(q.id=any(p_queue_ids))
    cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value) qi
    join private.current_vocabulary_meaning_states_v1(p_student_id) s on s.meaning_key=qi.value->>'meaningKey'
      and s.episode_id=(qi.value->>'episodeId')::uuid and s.unresolved
    where aq.assignment_id=p_assignment_id and aq.base_order_index<=offset_value
      and private.assignment_vocabulary_meaning_v1(aq.id)->>'meaningKey'=s.meaning_key) then
    raise exception 'mixed_regular_target_already_pending_review' using errcode='22023'; end if;
  if offset_value>0 and exists(select 1 from public.assignment_questions aq cross join unnest(p_queue_ids) selected(queue_id)
    where aq.assignment_id=p_assignment_id and aq.base_order_index<=offset_value
      and private.assignment_vocabulary_meaning_v1(aq.id)->>'meaningKey'=private.vocabulary_queue_identity_v1(selected.queue_id)->>'meaningKey') then
    raise exception 'review_target_order_mismatch' using errcode='40001'; end if;
  perform private.link_pending_review_targets_v2(p_assignment_id,array[p_student_id],p_queue_ids);
  if exists(select 1 from unnest(p_queue_ids) with ordinality selected(id,position)
    join public.assignment_questions aq on aq.assignment_id=p_assignment_id and aq.base_order_index=offset_value+selected.position
    where not exists(select 1 from public.assignment_review_targets t where t.assignment_id=p_assignment_id and t.student_id=p_student_id
      and t.review_queue_id=selected.id and t.assignment_question_id=aq.id and t.released_at is null)) then
    raise exception 'review_target_meaning_changed' using errcode='40001'; end if;
  select array_agg(t.review_queue_id order by aq.base_order_index) into linked from public.assignment_review_targets t
    join public.assignment_questions aq on aq.id=t.assignment_question_id
    where t.assignment_id=p_assignment_id and t.student_id=p_student_id and t.released_at is null and t.review_queue_id=any(p_queue_ids);
  if linked is distinct from p_queue_ids then raise exception 'review_target_meaning_changed' using errcode='40001'; end if;
end;
$$;

do $review_consumers$
declare r record; d text; first_pos integer; last_pos integer; needle text; replacement text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in('persist_review_assignment_v5','persist_exact_review_assignment_exam_use_v7_compat') loop
    d:=replace(pg_get_functiondef(r.oid),chr(13),'');
    needle:='  if p_review_draft_id is not null then';
    -- One occurrence validates the draft before the bank; the last consumes it.
    last_pos:=strpos(d,E'  get diagnostics consumed_queue_count = row_count;');
    if last_pos=0 then raise exception 'unexpected_review_writer'; end if;
    first_pos:=strpos(substring(d from last_pos),needle)+last_pos-1;
    if first_pos<last_pos then raise exception 'unexpected_review_writer'; end if;
    d:=overlay(d placing E'  perform private.assert_vocabulary_review_bank_v1(p_student_id,created_assignment_id,p_review_queue_ids);\n\n' from first_pos for 0);
    first_pos:=strpos(d,'    -- A general target must actually be new');
    if first_pos>0 then
      last_pos:=strpos(d,'  -- Reject a stale queue snapshot');
      if last_pos<=first_pos then raise exception 'unexpected_review_writer_general_guard'; end if;
      d:=overlay(d placing E'  end if;\n\n' from first_pos for last_pos-first_pos);
    end if;
    execute d;
  end loop;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='create_mixed_review_assignment_v6';
  d:=replace(d,chr(13),'');
  first_pos:=strpos(d,'  insert into public.assignment_review_targets (');
  last_pos:=strpos(d,'  update public.student_vocab_review_queue as queue');
  if first_pos=0 or last_pos<=first_pos then raise exception 'unexpected_mixed_target_writer'; end if;
  d:=overlay(d placing E'  perform private.assert_vocabulary_review_bank_v1(p_student_id,created_assignment_id,current_queue_ids);\n\n' from first_pos for last_pos-first_pos);
  execute d;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='create_exact_review_assignment_v5_draft_compat';
  d:=replace(d,chr(13),'');
  needle:=E'  perform private.assert_assignment_words_available_v2(\n    array[draft_student_id],\n    draft_dataset_id,\n    p_questions\n  );';
  if strpos(d,needle)=0 then raise exception 'unexpected_exact_review_guard'; end if;
  execute replace(d,needle,'  perform private.assert_vocabulary_review_queue_current_v1(draft_student_id,review_queue_ids);');
  d:=pg_get_functiondef('private.enforce_review_assignment_draft_item()'::regprocedure);
  needle:='      and queue.dataset_id = draft.dataset_id';
  if strpos(d,needle)=0 then raise exception 'unexpected_review_draft_guard'; end if;
  execute replace(d,needle,needle||E'\n      and exists(select 1 from private.current_vocabulary_meaning_states_v1(queue.student_id) s\n        where s.unresolved and s.meaning_key=private.vocabulary_queue_identity_v1(queue.id)->>''meaningKey''\n          and s.episode_id=(private.vocabulary_queue_identity_v1(queue.id)->>''episodeId'')::uuid)');
  -- Older mixed entrypoints keep their original bounds/permissions, but their
  -- candidate set no longer includes resolved or already assigned episodes.
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in('assert_mixed_review_queue_snapshot_v1','create_mixed_review_assignment_v6') loop
    d:=replace(pg_get_functiondef(r.oid),chr(13),'');
    first_pos:=strpos(d,'  with identity_by_entry as materialized (');
    last_pos:=strpos(d,'  if cardinality(current_queue_ids) = 0 then');
    if first_pos=0 or last_pos<=first_pos then raise exception 'unexpected_mixed_queue_candidates'; end if;
    replacement:=format($sql$  select coalesce(array_agg(id order by reason_level desc,queued_at,id),array[]::uuid[]) into current_queue_ids
      from (select distinct on(a.meaning_key,a.episode_id) q.id,q.reason_level,q.queued_at
        from private.available_vocabulary_review_queues_v1(p_student_id) a join public.student_vocab_review_queue q on q.id=a.queue_id
        where q.dataset_id=p_dataset_id and q.reason_level=any(p_review_levels)
        order by a.meaning_key,a.episode_id,q.reason_level desc,q.queued_at,q.id) choices;
      if cardinality(current_queue_ids)>%s then current_queue_ids:=current_queue_ids[1:%s]; end if;

$sql$,case when r.proname='assert_mixed_review_queue_snapshot_v1' then 400 else 500 end,case when r.proname='assert_mixed_review_queue_snapshot_v1' then 400 else 500 end);
    d:=overlay(d placing replacement from first_pos for last_pos-first_pos);
    needle:=E'  perform private.assert_assignment_words_available_v1(\n    array[p_student_id],\n    p_dataset_id,\n    p_questions\n  );';
    if r.proname='create_mixed_review_assignment_v6' then
      if strpos(d,needle)=0 then raise exception 'unexpected_legacy_mixed_guard'; end if;
      d:=replace(d,needle,'  perform private.assert_vocabulary_review_queue_current_v1(p_student_id,p_selected_queue_ids);');
    end if;
    execute d;
  end loop;
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='create_mixed_review_assignment_v8';
  d:=replace(d,chr(13),'');
  first_pos:=strpos(d,'  available_queue as materialized (');
  last_pos:=strpos(d,'  ranked_queue as materialized (');
  if first_pos=0 or last_pos<=first_pos then raise exception 'unexpected_mixed_active_words'; end if;
  replacement:=E'  available_queue as materialized (\n    select candidate.*,a.meaning_key,a.episode_id from queue_candidates candidate\n      join private.available_vocabulary_review_queues_v1(p_student_id) a on a.queue_id=candidate.id\n  ),\n';
  d:=overlay(d placing replacement from first_pos for last_pos-first_pos);
  first_pos:=strpos(d,'        partition by coalesce(');
  last_pos:=strpos(substring(d from first_pos),'        order by')+first_pos-1;
  if first_pos=0 or last_pos<=first_pos then raise exception 'unexpected_mixed_rank'; end if;
  d:=overlay(d placing E'        partition by available.meaning_key,available.episode_id\n' from first_pos for last_pos-first_pos);
  first_pos:=strpos(d,'  -- No pending word outside the selected snapshot');
  last_pos:=strpos(d,'  with referenced_entry_ids as (');
  if first_pos=0 or last_pos<=first_pos then raise exception 'unexpected_mixed_regular_guard'; end if;
  d:=overlay(d placing '' from first_pos for last_pos-first_pos);
  needle:=E'  select array_agg(\n    target.review_queue_id';
  if strpos(d,needle)=0 then raise exception 'unexpected_mixed_final_targets'; end if;
  execute replace(d,needle,E'  perform private.assert_vocabulary_review_bank_v1(p_student_id,created_assignment_id,p_selected_queue_ids);\n\n'||needle);
  select pg_get_functiondef(p.oid) into d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='create_exact_review_assignment_v5';
  d:=replace(d,chr(13),'');
  if strpos(d,needle)=0 then raise exception 'unexpected_exact_final_targets'; end if;
  execute replace(d,needle,E'  perform private.assert_vocabulary_review_bank_v1(p_student_id,created_assignment_id,p_selected_queue_ids);\n\n'||needle);
end;
$review_consumers$;

-- Replacement writers now use the same idempotent exact target linker as the
-- creator; inserting its targets a second time would reject valid replacements.
do $replacement_targets$
declare d text; branch_at integer; first_at integer; last_at integer;
begin
  select pg_get_functiondef(p.oid) into strict d from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname='replace_student_assignment_v4';
  branch_at:=strpos(d,'if review_creator_needs_lifecycle then');
  first_at:=strpos(substr(d,branch_at),'insert into public.assignment_review_targets');
  last_at:=strpos(substr(d,branch_at),'update public.student_vocab_review_queue');
  if branch_at=0 or first_at=0 or last_at<=first_at then raise exception 'm03_replacement_target_patch_mismatch'; end if;
  first_at:=branch_at+first_at-1; last_at:=branch_at+last_at-1;
  d:=substr(d,1,first_at-1)||'perform private.assert_vocabulary_review_bank_v1(p_student_id,created_replacement_assignment_id,p_selected_queue_ids);'
    ||E'\n      '||substr(d,last_at);
  execute d;
end;
$replacement_targets$;

create or replace function private.release_review_targets_on_attempt_terminal() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Grading can still be changing the final question here. Only release the
  -- finished assignment's links. Reopen/cancel after all receipts are accepted.
  update public.assignment_review_targets t set released_at=coalesce(new.completed_at,clock_timestamp()),
    release_reason=case when exists(select 1 from public.quiz_questions q
      where q.attempt_id=new.id and q.assignment_question_id=t.assignment_question_id
        and (q.initial_is_correct is true or q.retry_is_correct is true)
        and private.quiz_vocabulary_meaning_v1(q.id)->>'meaningKey'=private.vocabulary_queue_identity_v1(t.review_queue_id)->>'meaningKey')
      then 'resolved' else 'completed_unresolved' end
    where t.assignment_id=new.assignment_id and t.student_id=new.student_id and t.released_at is null;
  return new;
end;
$$;

create function private.reopen_terminal_vocabulary_reviews_v1(p_student_id uuid,p_attempt_id uuid) returns void
language plpgsql set search_path='' as $$
declare a public.quiz_attempts; item record;
begin
  perform private.lock_vocabulary_student_v1(p_student_id);
  select * into a from public.quiz_attempts where id=p_attempt_id and student_id=p_student_id for update;
  if not found or a.status not in('completed','expired') then return; end if;
  for item in select distinct qi.value->>'meaningKey' meaning_key,(qi.value->>'episodeId')::uuid episode_id
    from public.assignment_review_targets t
    cross join lateral(select private.vocabulary_queue_identity_v1(t.review_queue_id) value) qi
    where t.assignment_id=a.assignment_id and t.student_id=p_student_id and t.released_at is not null and t.release_reason='completed_unresolved'
    order by 1,2 loop
    perform private.reopen_vocabulary_review_episode_v1(p_student_id,item.meaning_key,item.episode_id);
  end loop;
end;
$$;

-- A queue records its source book, while a target records the actual new book.
-- The earlier meaning/episode guard proves approved cross-book equivalence.
do $target_source$
declare d text; needle text:=E'      or target_identity.queue_dataset_id <> new.dataset_id\n';
begin
  d:=replace(pg_get_functiondef('private.snapshot_review_target_dictionary_identity_v1()'::regprocedure),chr(13),'');
  if strpos(d,needle)=0 then raise exception 'unexpected_review_target_source_guard'; end if;
  execute replace(d,needle,'');
end;
$target_source$;

create function private.vocabulary_meaning_study_source_v1(p_question_id uuid) returns jsonb
language sql stable set search_path='' as $$
  select jsonb_build_object(
    'entryId',e.id,'currentHeadword',e.headword,'snapshotDisplayKo',s.display_pronunciation_ko_snapshot,
    'dictionaryId',coalesce(s.dictionary_id,word_identity.dictionary_id),'releaseId',coalesce(s.release_id,r.exam_use_release_id),
    'displayKo',coalesce(s.display_pronunciation_ko_snapshot,e.pronunciation_ko),'pronunciationSnapshot',s.pronunciation_snapshot,
    'compositionPronunciation',aq.composition_pronunciation_snapshot->'target',
    'notebookPronunciation',aq.notebook_pronunciation_snapshot->'target',
    'definition',case when aq.provenance_status='notebook_snapshot_v1' then aq.notebook_source_snapshot#>>'{study,definition}'
      when aq.provenance_status='composition_verified_v1' then private.vocabulary_composition_resource_v1(composition.resources)->>'definitionEn'
      when aq.provenance_status='exam_reviewed_v1' then reviewed.payload->>'english_definition'
      when aq.eligibility_quiz_mode='canonical_definition_to_headword' then aq.prompt
      when aq.eligibility_quiz_mode='canonical_headword_to_definition' then aq.choices->>aq.correct_choice_index else null end,
    'example',case when aq.provenance_status='notebook_snapshot_v1' then aq.notebook_source_snapshot#>>'{study,example}'
      when aq.provenance_status='composition_verified_v1' then private.vocabulary_composition_resource_v1(composition.resources)->>'exampleEn' else x.example_en end,
    'exampleKo',case when aq.provenance_status='notebook_snapshot_v1' then aq.notebook_source_snapshot#>>'{study,exampleKo}'
      when aq.provenance_status='composition_verified_v1' then private.vocabulary_composition_resource_v1(composition.resources)->>'exampleKo' else null end)
  from public.quiz_questions q join public.vocab_entries e on e.id=q.vocab_entry_id
  left join private.assignment_question_contents_v1 aq on aq.id=q.assignment_question_id
  left join private.assignment_question_word_identity_v1 word_identity on word_identity.assignment_question_id=aq.id
  left join private.reviewed_exam_entries reviewed on reviewed.release_id=aq.reviewed_exam_release_id_snapshot
    and reviewed.vocab_entry_id=aq.vocab_entry_id and upper(reviewed.entry_sha256)=aq.entry_row_sha256_snapshot
  left join private.exam_use_question_contents_v1 s on s.assignment_question_id=aq.id and s.provenance_status='reviewed_for_preview_v1'
  left join word_index.app_canonical_question_preview_release r on r.release_id=aq.canonical_question_release_id_snapshot
  left join word_index.app_canonical_question_preview_item source on source.release_id=aq.canonical_question_release_id_snapshot
    and source.question_item_id=aq.canonical_question_item_id_snapshot and source.question_item_sha256=aq.canonical_question_item_sha256_snapshot
  left join private.assignment_study_examples_v1 x on x.release_id=source.release_id and x.vocab_entry_id=source.vocab_entry_id
    and x.question_item_id=source.question_item_id and x.question_item_sha256=source.question_item_sha256 and x.source_example_sha256=source.source_example_content_hash
  left join private.vocabulary_composition_entries composition on composition.version_id=aq.composition_version_id_snapshot and composition.vocab_entry_id=aq.vocab_entry_id
  where q.id=p_question_id;
$$;

-- History cursors retain their first read's sequence upper bound. Reconstruct
-- from immutable receipts, rather than using today's mutable current state.
create function private.vocabulary_meaning_states_at_v1(p_student_id uuid,p_upper bigint)
returns table(meaning_key text,word_key text,episode_id uuid,unresolved boolean,current_wrong_count integer,lifetime_wrong_count integer,
  current_missed_count integer,lifetime_missed_count integer,legacy_wrong_count integer,count_quality text,last_sequence bigint,
  last_question_id uuid,last_wrong_at timestamptz,resolved_at timestamptz)
language sql stable set search_path='' as $$
  with legacy as materialized(select * from private.legacy_vocabulary_meaning_states_v1(p_student_id)),
  events as materialized(select * from private.vocabulary_answer_receipts where student_id=p_student_id and server_sequence<=p_upper),
  latest as(select distinct on(meaning_key) * from events order by meaning_key,server_sequence desc),
  totals as(select r.meaning_key,count(*) filter(where outcome='wrong')::integer wrong_count,
    count(*) filter(where outcome in('timeout','unanswered'))::integer missed_count,
    max(accepted_at) filter(where outcome<>'correct') last_wrong from events r group by r.meaning_key),
  episodes as(select meaning_key,episode_id,count(*) filter(where outcome='wrong')::integer wrong_count,
    count(*) filter(where outcome in('timeout','unanswered'))::integer missed_count,min(accepted_at) filter(where outcome='correct') resolved_at
    from events group by meaning_key,episode_id),
  projected as(
    select r.meaning_key,r.word_key,r.episode_id,r.outcome<>'correct' unresolved,
      case when r.outcome='correct' then 0 else coalesce(ep.wrong_count,0) end current_wrong_count,
      t.wrong_count+coalesce(l.lifetime_wrong_count,0) lifetime_wrong_count,
      case when r.outcome='correct' then 0 else coalesce(ep.missed_count,0) end current_missed_count,
      t.missed_count+coalesce(l.lifetime_missed_count,0) lifetime_missed_count,coalesce(l.legacy_wrong_count,0) legacy_wrong_count,
      case when r.outcome<>'correct' and r.episode_id=md5('legacy-v1/'||p_student_id::text||'/'||r.meaning_key)::uuid then 'legacy-continuation' else 'exact' end count_quality,
      r.server_sequence last_sequence,r.quiz_question_id last_question_id,greatest(t.last_wrong,l.last_wrong_at) last_wrong_at,
      case when r.outcome='correct' then coalesce(ep.resolved_at,l.resolved_at) end resolved_at
    from latest r join totals t on t.meaning_key=r.meaning_key left join legacy l on l.meaning_key=r.meaning_key
    left join episodes ep on ep.meaning_key=r.meaning_key and ep.episode_id=r.episode_id
    where t.wrong_count+t.missed_count>0 or l.meaning_key is not null
  ) select * from projected
  union all
  select l.meaning_key,l.word_key,md5('legacy-v1/'||p_student_id::text||'/'||l.meaning_key)::uuid,l.unresolved,0,l.lifetime_wrong_count,
    0,l.lifetime_missed_count,l.legacy_wrong_count,'legacy-continuation',0,l.last_question_id,l.last_wrong_at,l.resolved_at
  from legacy l where not exists(select 1 from latest r where r.meaning_key=l.meaning_key);
$$;

create function private.vocabulary_mistake_episode_rows_v1(p_student_id uuid,p_meaning_keys text[],p_upper bigint)
returns table(meaning_key text,episode_id uuid,opened_at timestamptz,resolved_at timestamptz,
  wrong_count integer,missed_count integer,last_sequence bigint,includes_legacy boolean)
language sql stable set search_path='' as $$
  with episodes as(
    select meaning_key,episode_id,min(accepted_at) filter(where outcome<>'correct') opened_at,
      min(accepted_at) filter(where outcome='correct') resolved_at,
      count(*) filter(where outcome='wrong')::integer wrong_count,
      count(*) filter(where outcome in('timeout','unanswered'))::integer missed_count,max(server_sequence) last_sequence
    from private.vocabulary_answer_receipts where student_id=p_student_id and meaning_key=any(p_meaning_keys) and server_sequence<=p_upper and episode_id is not null
    group by meaning_key,episode_id
  ), legacy as(select * from private.legacy_vocabulary_meaning_states_v1(p_student_id) where meaning_key=any(p_meaning_keys)),
  combined as(
    select coalesce(e.meaning_key,l.meaning_key) meaning_key,coalesce(e.episode_id,md5('legacy-v1/'||p_student_id::text||'/'||l.meaning_key)::uuid) episode_id,
      least(e.opened_at,l.first_wrong_at) opened_at,coalesce(e.resolved_at,case when not l.unresolved then l.resolved_at end) resolved_at,
      coalesce(e.wrong_count,0)+coalesce(l.lifetime_wrong_count,0) wrong_count,
      coalesce(e.missed_count,0)+coalesce(l.lifetime_missed_count,0) missed_count,
      coalesce(e.last_sequence,0) last_sequence,l.meaning_key is not null includes_legacy
    from episodes e full join legacy l on e.meaning_key=l.meaning_key and e.episode_id=md5('legacy-v1/'||p_student_id::text||'/'||l.meaning_key)::uuid
  ) select * from combined where opened_at is not null;
$$;

create function private.vocabulary_mistake_episode_cursor_v1(p_student_id uuid,p_meaning_key text,p_upper bigint,
  p_last_sequence bigint,p_opened_at timestamptz,p_episode_id uuid)
returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object('schemaVersion','vocabulary-mistake-episode-cursor-v1','studentId',p_student_id,
    'meaningKey',p_meaning_key,'stateVersion',p_upper::text,'lastSequence',p_last_sequence::text,'openedAt',p_opened_at,'episodeId',p_episode_id);
$$;

create function private.vocabulary_mistake_episode_histories_v1(p_student_id uuid,p_meaning_keys text[],p_upper bigint)
returns table(meaning_key text,history jsonb) language sql stable set search_path='' as $$
  with ranked as(select *,row_number() over(partition by meaning_key order by last_sequence desc,opened_at desc,episode_id desc) position,
      count(*) over(partition by meaning_key) episode_count from private.vocabulary_mistake_episode_rows_v1(p_student_id,p_meaning_keys,p_upper))
  select meaning_key,jsonb_build_object('episodeCount',max(episode_count),
    'episodes',jsonb_agg(jsonb_build_object('episodeId',episode_id,'openedAt',opened_at,'resolvedAt',resolved_at,
      'wrongCount',wrong_count,'missedCount',missed_count,'includesLegacy',includes_legacy) order by last_sequence desc,opened_at desc,episode_id desc),
    'episodeNextCursor',case when max(episode_count)>20 then
      (jsonb_agg(private.vocabulary_mistake_episode_cursor_v1(p_student_id,meaning_key,p_upper,last_sequence,opened_at,episode_id)) filter(where position=20))->0 else null end)
    from ranked where position<=20 group by meaning_key;
$$;

create function private.vocabulary_mistake_episode_page_v1(p_student_id uuid,p_meaning_key text,p_upper bigint,
  p_cursor jsonb default null,p_admin boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare current_version bigint; cursor_sequence bigint; cursor_opened timestamptz; cursor_episode uuid; result jsonb;
begin
  if p_student_id is null or p_meaning_key is null or p_meaning_key !~ '^[a-f0-9]{64}$' or p_upper is null or p_upper<0 then
    raise exception 'invalid_wrong_history_page' using errcode='22023'; end if;
  if not exists(select 1 from public.students where id=p_student_id and deleted_at is null and (p_admin or status='active')) then return null; end if;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into current_version;
  if p_upper>current_version then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' then raise exception 'invalid_wrong_history_cursor' using errcode='22023'; end if;
    if not(p_cursor ?& array['schemaVersion','studentId','meaningKey','stateVersion','lastSequence','openedAt','episodeId'])
      or exists(select 1 from jsonb_each(p_cursor) x where not(x.key=any(array['schemaVersion','studentId','meaningKey','stateVersion','lastSequence','openedAt','episodeId'])) or jsonb_typeof(x.value)<>'string')
      or p_cursor->>'schemaVersion' is distinct from 'vocabulary-mistake-episode-cursor-v1'
      or coalesce(p_cursor->>'lastSequence','') !~ '^(0|[1-9][0-9]{0,18})$'
      or coalesce(p_cursor->>'stateVersion','') !~ '^(0|[1-9][0-9]{0,18})$'
      or coalesce(p_cursor->>'openedAt','') !~ '^\d{4}-\d{2}-\d{2}T' then
      raise exception 'invalid_wrong_history_cursor' using errcode='22023'; end if;
    if p_cursor->>'studentId' is distinct from p_student_id::text or p_cursor->>'meaningKey' is distinct from p_meaning_key
      or p_cursor->>'stateVersion' is distinct from p_upper::text then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    cursor_sequence:=(p_cursor->>'lastSequence')::bigint; cursor_opened:=(p_cursor->>'openedAt')::timestamptz; cursor_episode:=(p_cursor->>'episodeId')::uuid;
    if cursor_sequence>p_upper or not isfinite(cursor_opened) then raise exception 'invalid_wrong_history_cursor' using errcode='22023'; end if;
    if not exists(select 1 from private.vocabulary_mistake_episode_rows_v1(p_student_id,array[p_meaning_key],p_upper)
      where (last_sequence,opened_at,episode_id)=(cursor_sequence,cursor_opened,cursor_episode)) then
      raise exception 'wrong_history_changed' using errcode='40001'; end if;
  end if;
  with history_rows as materialized (
    select * from private.vocabulary_mistake_episode_rows_v1(p_student_id,array[p_meaning_key],p_upper)
  ), page_rows as (
    select * from history_rows where p_cursor is null or (last_sequence,opened_at,episode_id)<(cursor_sequence,cursor_opened,cursor_episode)
    order by last_sequence desc,opened_at desc,episode_id desc limit 21
  ), ranked as (
    select *,row_number() over(order by last_sequence desc,opened_at desc,episode_id desc) position from page_rows
  ) select case when (select count(*) from history_rows)=0 then null else
    jsonb_build_object('meaningKey',p_meaning_key,'stateVersion',p_upper::text,'episodeCount',(select count(*) from history_rows),
      'items',coalesce(jsonb_agg(jsonb_build_object('episodeId',episode_id,'openedAt',opened_at,'resolvedAt',resolved_at,
        'wrongCount',wrong_count,'missedCount',missed_count,'includesLegacy',includes_legacy) order by last_sequence desc,opened_at desc,episode_id desc) filter(where position<=20),'[]'),
      'nextCursor',case when count(*)>20 then
        (jsonb_agg(private.vocabulary_mistake_episode_cursor_v1(p_student_id,meaning_key,p_upper,last_sequence,opened_at,episode_id)) filter(where position=20))->0 else null end)
    end into result from ranked;
  return result;
end;
$$;
create function public.get_student_vocabulary_mistake_episodes_v1(p_student_id uuid,p_meaning_key text,p_upper bigint,p_cursor jsonb default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.vocabulary_mistake_episode_page_v1(p_student_id,p_meaning_key,p_upper,p_cursor,false);
$$;
revoke all on function public.get_student_vocabulary_mistake_episodes_v1(uuid,text,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.get_student_vocabulary_mistake_episodes_v1(uuid,text,bigint,jsonb) to service_role;
create function public.get_admin_vocabulary_mistake_episodes_v1(p_student_id uuid,p_meaning_key text,p_upper bigint,p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return private.vocabulary_mistake_episode_page_v1(p_student_id,p_meaning_key,p_upper,p_cursor,true);
end;
$$;
revoke all on function public.get_admin_vocabulary_mistake_episodes_v1(uuid,text,bigint,jsonb) from public,anon,service_role;
grant execute on function public.get_admin_vocabulary_mistake_episodes_v1(uuid,text,bigint,jsonb) to authenticated;
revoke all on function private.vocabulary_mistake_episode_rows_v1(uuid,text[],bigint),
  private.vocabulary_mistake_episode_cursor_v1(uuid,text,bigint,bigint,timestamptz,uuid),
  private.vocabulary_mistake_episode_page_v1(uuid,text,bigint,jsonb,boolean) from public,anon,authenticated,service_role;

create function private.vocabulary_mistake_sources_v1(p_student_id uuid,p_upper bigint default null)
returns table(meaning_key text,dataset_id uuid,vocab_entry_id bigint,dataset_label text,source_question_id uuid,source_phase text,
  current_wrong_count integer,lifetime_wrong_count integer,current_missed_count integer,lifetime_missed_count integer,last_wrong_at timestamptz)
language sql stable set search_path='' as $$
  with events as materialized (
    select r.meaning_key,r.quiz_question_id,r.phase,r.outcome,r.episode_id,r.accepted_at at,r.server_sequence seq
      from private.vocabulary_answer_receipts r where r.student_id=p_student_id and r.outcome<>'correct' and (p_upper is null or r.server_sequence<=p_upper)
    union all
    select private.quiz_vocabulary_meaning_v1(q.id)->>'meaningKey',q.id,s.phase,
      case when s.choice is not null and not s.timed_out then 'wrong' else 'unanswered' end,null,
      coalesce(case s.phase when 'initial' then qb.initial_wrong_at else qb.retry_wrong_at end,s.answered_at,e.wrong_at,t.completed_at,t.started_at),0
    from public.quiz_attempts t join public.quiz_questions q on q.attempt_id=t.id
    cross join lateral(values('initial',q.initial_choice_index,q.initial_is_correct,q.initial_timed_out,q.initial_answered_at),
      ('retry',q.retry_choice_index,q.retry_is_correct,q.retry_timed_out,q.retry_answered_at)) s(phase,choice,correct,timed_out,answered_at)
    left join public.student_vocab_wrong_events e on e.quiz_question_id=q.id and e.student_id=t.student_id and e.wrong_stage=s.phase
    left join private.vocabulary_legacy_question_baselines qb on qb.quiz_question_id=q.id
    where t.student_id=p_student_id and (s.correct is false or e.id is not null)
      and not exists(select 1 from private.vocabulary_answer_receipts r where r.quiz_question_id=q.id and r.phase=s.phase)
  )
  select ev.meaning_key,e.dataset_id,q.vocab_entry_id,d.title,
    (array_agg(q.id order by ev.seq desc,ev.at desc,q.id,ev.phase desc))[1],
    (array_agg(ev.phase order by ev.seq desc,ev.at desc,q.id,ev.phase desc))[1],
    count(*) filter(where ev.outcome='wrong' and st.unresolved and ev.episode_id=st.episode_id)::integer,
    count(*) filter(where ev.outcome='wrong')::integer,
    count(*) filter(where ev.outcome<>'wrong' and st.unresolved and ev.episode_id=st.episode_id)::integer,
    count(*) filter(where ev.outcome<>'wrong')::integer,max(ev.at)
  from events ev join public.quiz_questions q on q.id=ev.quiz_question_id join public.vocab_entries e on e.id=q.vocab_entry_id
    join public.vocab_datasets d on d.id=e.dataset_id
    left join private.vocabulary_meaning_states_at_v1(p_student_id,coalesce(p_upper,9223372036854775807)) st on st.meaning_key=ev.meaning_key
  group by ev.meaning_key,e.dataset_id,q.vocab_entry_id,d.title;
$$;

-- Read current reservations separately from historical counts; never attach a
-- prior episode's reservation to a newly reopened meaning.
create function private.vocabulary_meaning_scheduling_v1(p_student_id uuid,p_meaning_keys text[])
returns table(meaning_key text,episode_id uuid,queue_id uuid,review_draft_id uuid,active_assignment jsonb,scheduling text)
language sql stable set search_path='' as $$
  with current_states as materialized (
    select s.meaning_key,s.episode_id from private.current_vocabulary_meaning_states_v1(p_student_id) s
      where s.unresolved and s.meaning_key=any(p_meaning_keys)
  ), queue_rows as materialized (
    select q.*,i.value->>'meaningKey' as meaning_key,(i.value->>'episodeId')::uuid as episode_id
    from public.student_vocab_review_queue_read_v1 q cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value) i
    where q.student_id=p_student_id and (q.status='pending' or exists(select 1 from public.assignment_review_targets t
      where t.student_id=p_student_id and t.review_queue_id=q.id and t.released_at is null))
  ), pending as (
    select distinct on(q.meaning_key,q.episode_id) q.meaning_key,q.episode_id,q.id,q.active_review_draft_id
    from queue_rows q join current_states s using(meaning_key,episode_id) where q.status='pending'
    order by q.meaning_key,q.episode_id,(q.active_review_draft_id is not null) desc,q.reason_level desc,q.queued_at,q.id
  ), active as (
    select distinct on(q.meaning_key,q.episode_id) q.meaning_key,q.episode_id,t.review_queue_id,
      jsonb_build_object('assignmentId',a.id,'title',a.title,'assignedAt',recipient.assigned_at) as assignment
    from public.assignment_review_targets t join queue_rows q on q.id=t.review_queue_id
    join current_states s using(meaning_key,episode_id) join public.assignments a on a.id=t.assignment_id
    join public.assignment_students recipient on recipient.assignment_id=t.assignment_id and recipient.student_id=t.student_id
    where t.student_id=p_student_id and t.released_at is null order by q.meaning_key,q.episode_id,recipient.assigned_at desc,a.id,t.id
  ) select s.meaning_key,s.episode_id,coalesce(a.review_queue_id,p.id),
    case when a.review_queue_id is null then p.active_review_draft_id end,a.assignment,
    case when a.review_queue_id is not null then 'assigned' when p.id is not null then 'queued' else 'available' end
    from current_states s left join active a using(meaning_key,episode_id) left join pending p using(meaning_key,episode_id)
$$;
revoke all on function private.vocabulary_meaning_scheduling_v1(uuid,text[]) from public,anon,authenticated,service_role;

create function private.vocabulary_mistake_page_v1(p_student_id uuid,p_filters jsonb default '{}',p_cursor jsonb default null,p_admin boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare view_value text:=coalesce(p_filters->>'view','current'); sort_value text:=coalesce(p_filters->>'sort','count');
  query_value text:=coalesce(p_filters->>'query',''); dataset_value uuid; minimum integer; maximum integer;
  size_value integer:=coalesce((p_filters->>'pageSize')::integer,11); version_value bigint; filter_hash text; source_version text; result jsonb;
begin
  if p_student_id is null or jsonb_typeof(p_filters) is distinct from 'object' or view_value not in ('current','history')
    or sort_value not in ('count','recent') or length(query_value)>200 or size_value not between 1 and 501
    or exists(select 1 from jsonb_object_keys(p_filters) k where not(k=any(array['view','sort','query','datasetId','minWrongCount','maxWrongCount','level','pageSize','key','upperVersion']))) then
    raise exception 'invalid_wrong_history_page' using errcode='22023'; end if;
  dataset_value:=nullif(p_filters->>'datasetId','')::uuid;
  minimum:=(p_filters->>'minWrongCount')::integer; maximum:=(p_filters->>'maxWrongCount')::integer;
  if coalesce(p_filters->>'level','all') not in ('all','once','repeated') or minimum<1 or maximum<1 or minimum>maximum
    or (coalesce(p_filters->>'level','all')<>'all' and (minimum is not null or maximum is not null)) then
    raise exception 'invalid_wrong_history_page' using errcode='22023'; end if;
  if p_filters->>'level'='once' then minimum:=1; maximum:=1; elsif p_filters->>'level'='repeated' then minimum:=2; end if;
  if not exists(select 1 from public.students where id=p_student_id and deleted_at is null and (p_admin or status='active')) then return null; end if;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into version_value;
  if p_filters ? 'upperVersion' then
    if view_value<>'history' or coalesce(p_filters->>'upperVersion','') !~ '^[0-9]{1,19}$'
      then raise exception 'invalid_wrong_history_page' using errcode='22023'; end if;
    if (p_filters->>'upperVersion')::numeric>version_value then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    version_value:=(p_filters->>'upperVersion')::bigint;
  end if;
  select private.reviewed_exam_sha256_v1(jsonb_build_array(p_student_id,coalesce(jsonb_agg(jsonb_build_array(d.id,d.title) order by d.id),'[]'))) into source_version
    from public.vocab_datasets d where exists(select 1 from public.quiz_attempts t join public.quiz_questions q on q.attempt_id=t.id
      join public.vocab_entries e on e.id=q.vocab_entry_id where t.student_id=p_student_id and e.dataset_id=d.id);
  filter_hash:=private.reviewed_exam_sha256_v1(jsonb_build_array(view_value,sort_value,btrim(query_value),dataset_value,minimum,maximum,size_value,p_filters->>'key',p_filters->>'upperVersion'));
  if p_cursor is not null then
    if jsonb_typeof(p_cursor) is distinct from 'object' or p_cursor->>'studentId' is distinct from p_student_id::text
      or p_cursor->>'filtersHash' is distinct from filter_hash or nullif(p_cursor->>'key','') is null
      or not(p_cursor ?& array['studentId','filtersHash','stateVersion','sourceVersion','key','count','lastWrongAt'])
      or exists(select 1 from jsonb_object_keys(p_cursor) k where not(k=any(array['studentId','filtersHash','stateVersion','sourceVersion','key','count','lastWrongAt'])))
      or p_cursor->>'count' is null or p_cursor->>'stateVersion' is null
      or (p_cursor->>'count') !~ '^[0-9]+$' or (p_cursor->>'stateVersion') !~ '^[0-9]+$'
      or p_cursor->>'lastWrongAt' is null then raise exception 'invalid_wrong_history_cursor' using errcode='22023'; end if;
    if p_cursor->>'sourceVersion' is distinct from source_version then raise exception 'wrong_history_changed' using errcode='40001'; end if;
    if (p_cursor->>'stateVersion')::bigint>version_value or (view_value='current' and (p_cursor->>'stateVersion')::bigint<>version_value) then
      raise exception 'wrong_history_changed' using errcode='40001'; end if;
    if view_value='history' then version_value:=(p_cursor->>'stateVersion')::bigint; end if;
  end if;
  with sources as materialized (
    select * from private.vocabulary_mistake_sources_v1(p_student_id,version_value)
  ), source_groups as materialized (
    select meaning_key,array_agg(distinct dataset_id) dataset_ids,string_agg(distinct dataset_label,' ') labels,
      (array_agg(source_question_id order by last_wrong_at desc,source_question_id,source_phase))[1] source_question_id,
      (array_agg(source_phase order by last_wrong_at desc,source_question_id,source_phase))[1] source_phase,
      jsonb_agg(jsonb_build_object('datasetId',dataset_id,'entryId',vocab_entry_id,'label',dataset_label,
        'currentWrongCount',current_wrong_count,'lifetimeWrongCount',lifetime_wrong_count,'currentMissedCount',current_missed_count,
        'lifetimeMissedCount',lifetime_missed_count,'lastWrongAt',last_wrong_at)
        ||case when p_admin then jsonb_build_object('sourceQuestionId',source_question_id,'sourcePhase',source_phase,
          'episodeId',coalesce((select r.episode_id from private.vocabulary_answer_receipts r where r.quiz_question_id=sources.source_question_id and r.phase=sources.source_phase),
            case when private.vocabulary_legacy_failure_evidence_v1(p_student_id,source_question_id,source_phase) is not null
              then md5('legacy-v1/'||p_student_id::text||'/'||meaning_key)::uuid end)) else '{}' end
        order by last_wrong_at desc,dataset_id,vocab_entry_id) items
    from sources group by meaning_key
  ), all_states as materialized (
    select * from private.current_vocabulary_meaning_states_v1(p_student_id) where view_value='current'
    union all select * from private.vocabulary_meaning_states_at_v1(p_student_id,version_value) where view_value='history'
  ), word_totals as materialized (
    select word_key,sum(lifetime_wrong_count)::integer lifetime_wrong_count,
      sum(lifetime_missed_count)::integer lifetime_missed_count,sum(legacy_wrong_count)::integer legacy_wrong_count
    from all_states group by word_key
  ), states as materialized (
    select * from all_states where view_value='history' or unresolved
  ), display as materialized (
    select st.*,q.id source_question_id,q.attempt_id,q.vocab_entry_id,e.dataset_id,d.title dataset_label,
      sg.source_phase,sg.dataset_ids source_datasets,sg.labels source_labels,sg.items source_items,
      coalesce(nullif(aq.headword_snapshot,''),case when q.direction='english_to_korean' then q.prompt else q.choices->>q.correct_choice_index end) headword,
      coalesce(aq.primary_meaning_snapshot,case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end) primary_meaning,
      case when identity.value->>'testedField'='primary_meaning' then case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end
        when aq.eligibility_quiz_mode='canonical_headword_to_definition' then q.choices->>q.correct_choice_index else q.prompt end selected_text,
      coalesce(aq.provenance_status,'legacy_backfill') provenance_status,identity.value
    from states st left join source_groups sg on sg.meaning_key=st.meaning_key
    join private.quiz_question_contents_v1 q on q.id=coalesce(sg.source_question_id,st.last_question_id) join public.vocab_entries e on e.id=q.vocab_entry_id
    join public.vocab_datasets d on d.id=e.dataset_id left join private.assignment_question_contents_v1 aq on aq.id=q.assignment_question_id
    cross join lateral(select private.quiz_vocabulary_meaning_v1(q.id) value) identity
  ), cards as materialized (
    select display.word_key,min(headword) headword,string_agg(distinct primary_meaning,' · ' order by primary_meaning) primary_meaning,
      sum(current_wrong_count)::integer current_wrong_count,min(totals.lifetime_wrong_count) lifetime_wrong_count,
      sum(current_missed_count)::integer current_missed_count,min(totals.lifetime_missed_count) lifetime_missed_count,
      min(totals.legacy_wrong_count) legacy_wrong_count,max(last_wrong_at) last_wrong_at,bool_or(unresolved) unresolved,
      case when view_value='current' then sum(current_wrong_count) else min(totals.lifetime_wrong_count) end::integer filter_count,
      array(select distinct src.dataset_id from sources src where src.meaning_key=any(array_agg(display.meaning_key))) datasets,
      string_agg(distinct source_labels,' ') dataset_labels,
      jsonb_agg(jsonb_build_object('meaningKey',meaning_key,'episodeId',episode_id,'stateVersion',version_value::text,
        'currentWrongCount',current_wrong_count,'lifetimeWrongCount',display.lifetime_wrong_count,'currentMissedCount',current_missed_count,
        'lifetimeMissedCount',display.lifetime_missed_count,'legacyWrongCount',display.legacy_wrong_count,'countQuality',count_quality,
        'unresolved',unresolved,'resolvedAt',resolved_at,'lastWrongAt',last_wrong_at,'testedField',value->>'testedField',
        'identityKind',value->>'identityKind','selectedText',selected_text,'primaryMeaning',primary_meaning,'sourceQuestionId',source_question_id,
        'sourceAttemptId',attempt_id,'sourceEntryId',vocab_entry_id,'sourceDatasetId',dataset_id,'sourceLabel',dataset_label,'sources',coalesce(source_items,'[]'),
        'sourcePhase',source_phase) order by last_wrong_at desc,meaning_key) meanings,
      (array_agg(source_question_id order by last_wrong_at desc,meaning_key))[1] latest_question_id
    from display join word_totals totals on totals.word_key=display.word_key group by display.word_key
  ), filtered as materialized (
    select * from cards where (dataset_value is null or dataset_value=any(datasets))
      and (minimum is null or filter_count>=minimum) and (maximum is null or filter_count<=maximum)
      and (p_filters->>'key' is null or word_key=p_filters->>'key')
      and strpos(lower(concat_ws(' ',headword,primary_meaning,dataset_labels)),lower(btrim(query_value)))>0
  ), page as materialized (
    select * from filtered where p_cursor is null
      or sort_value='recent' and (last_wrong_at,word_key)<((p_cursor->>'lastWrongAt')::timestamptz,p_cursor->>'key')
      or sort_value='count' and (filter_count,last_wrong_at,word_key)<((p_cursor->>'count')::integer,(p_cursor->>'lastWrongAt')::timestamptz,p_cursor->>'key')
    order by case when sort_value='count' then filter_count end desc,last_wrong_at desc,word_key desc limit size_value
  ), scheduling_rows as materialized (
    select * from private.vocabulary_meaning_scheduling_v1(p_student_id,
      array(select distinct m->>'meaningKey' from page cross join lateral jsonb_array_elements(meanings) m)) where p_admin
  ), histories as materialized (
    select * from private.vocabulary_mistake_episode_histories_v1(p_student_id,
      array(select distinct m->>'meaningKey' from page cross join lateral jsonb_array_elements(meanings) m),version_value)
  ) select jsonb_build_object('view',view_value,'stateVersion',version_value::text,'sourceVersion',source_version,'filtersHash',filter_hash,
    'totalCount',case when p_cursor is null then (select count(*) from filtered) end,
    'summary',case when p_cursor is null then (select jsonb_build_object('wordCount',count(*),'currentWrongCount',coalesce(sum(current_wrong_count),0),
      'lifetimeWrongCount',coalesce(sum(lifetime_wrong_count),0),'currentMissedCount',coalesce(sum(current_missed_count),0),'legacyWrongCount',coalesce(sum(legacy_wrong_count),0)) from filtered) end,
    'datasetOptions',case when p_cursor is null then coalesce((select jsonb_agg(jsonb_build_object('id',dataset_id,'label',dataset_label) order by dataset_label,dataset_id)
      from (select distinct s.dataset_id,s.dataset_label from sources s join states st on st.meaning_key=s.meaning_key) d),'[]') end,
    'items',coalesce((select jsonb_agg(jsonb_build_object('key',word_key,'headword',headword,'primaryMeaning',primary_meaning,'sourceVersion',source_version,
      'currentWrongCount',current_wrong_count,'lifetimeWrongCount',lifetime_wrong_count,'currentMissedCount',current_missed_count,
      'lifetimeMissedCount',lifetime_missed_count,'legacyWrongCount',legacy_wrong_count,'lastWrongAt',last_wrong_at,
      'meanings',(select jsonb_agg((case when p_admin then value else value-array['sourceQuestionId','sourceAttemptId','sourcePhase'] end)
        ||coalesce((select history from histories where meaning_key=value->>'meaningKey'),'{"episodeCount":0,"episodes":[],"episodeNextCursor":null}')
        ||case when p_admin then coalesce((select jsonb_build_object('queueId',r.queue_id,'reviewDraftId',r.review_draft_id,
          'activeAssignment',r.active_assignment,'scheduling',r.scheduling,'isCurrentEpisode',true)
          from scheduling_rows r where r.meaning_key=value->>'meaningKey' and r.episode_id=(value->>'episodeId')::uuid),
          jsonb_build_object('queueId',null,'reviewDraftId',null,'activeAssignment',null,'scheduling','none','isCurrentEpisode',false)) else '{}'::jsonb end)
        from jsonb_array_elements(meanings)),
      'studySource',private.vocabulary_meaning_study_source_v1(latest_question_id),
      'cursor',jsonb_build_object('studentId',p_student_id,'filtersHash',filter_hash,'stateVersion',version_value::text,'sourceVersion',source_version,'key',word_key,'count',filter_count,'lastWrongAt',last_wrong_at))
      order by case when sort_value='count' then filter_count end desc,last_wrong_at desc,word_key desc) from page),'[]')) into result;
  if p_admin then
    result:=result||jsonb_build_object('schedulingBasis','current','schedulingAsOf',transaction_timestamp(),
      'reviewDrafts',case when p_cursor is null then coalesce((select jsonb_agg(jsonb_build_object(
        'draftId',draft_id,'datasetId',dataset_id,'questionCount',question_count) order by draft_id)
        from (select q.active_review_draft_id as draft_id,q.dataset_id,count(*)::integer as question_count
          from public.student_vocab_review_queue_read_v1 q where q.student_id=p_student_id and q.status='pending'
            and q.active_review_draft_id is not null group by q.active_review_draft_id,q.dataset_id) d),'[]'::jsonb) else null end);
  end if;
  return result;
end;
$$;
create function public.get_student_vocabulary_mistake_page_v1(p_student_id uuid,p_filters jsonb default '{}',p_cursor jsonb default null)
returns jsonb language sql stable security definer set search_path='' as $$
  select private.vocabulary_mistake_page_v1(p_student_id,p_filters,p_cursor,false)
$$;
revoke all on function public.get_student_vocabulary_mistake_page_v1(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.get_student_vocabulary_mistake_page_v1(uuid,jsonb,jsonb) to service_role;
create function public.get_admin_vocabulary_mistake_page_v1(p_student_id uuid,p_filters jsonb default '{}',p_cursor jsonb default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return private.vocabulary_mistake_page_v1(p_student_id,p_filters,p_cursor,true);
end;
$$;
revoke all on function public.get_admin_vocabulary_mistake_page_v1(uuid,jsonb,jsonb) from public,anon,service_role;
grant execute on function public.get_admin_vocabulary_mistake_page_v1(uuid,jsonb,jsonb) to authenticated;



-- Meaning selections contain no client-supplied question/body IDs. Resolve the
-- student's own fixed source at the requested state before generating a plan.
create function private.mistake_word_practice_source_v1(p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare upper_value bigint; current_value bigint; selected_words jsonb; candidates jsonb; dataset_ids uuid[]; candidate_count integer;
 original_selection jsonb:=p_selection; maximum_selection integer:=500; page jsonb; cursor_value jsonb; selection_words jsonb:='[]'; page_words jsonb;
begin
  perform private.assert_word_practice_student_v1(p_student_id);
  if p_selection->>'mode'='mistake_targets' then
    if jsonb_typeof(p_selection->'targets') is distinct from 'array' or jsonb_array_length(p_selection->'targets') not between 1 and 500
      or exists(select 1 from jsonb_array_elements(p_selection->'targets') t where jsonb_typeof(t)<>'object'
        or not(t ?& array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion'])
        or t-array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion']<>'{}'::jsonb
        or t->>'sourcePhase' not in('initial','retry') or t->>'stateVersion' is distinct from p_selection#>>'{targets,0,stateVersion}')
      then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
    select jsonb_build_object('mode','mistakes','view','current','stateVersion',p_selection#>>'{targets,0,stateVersion}',
      'meanings',jsonb_agg(jsonb_build_object('wordKey',private.quiz_vocabulary_meaning_v1((t->>'sourceQuestionId')::uuid)->>'wordKey',
        'meaningKey',t->>'meaningKey','episodeId',t->'episodeId'))) into p_selection from jsonb_array_elements(p_selection->'targets') t;
  end if;
  if p_selection->>'mode'='mistake_filters' then
    if jsonb_typeof(p_selection) is distinct from 'object' or not(p_selection ?& array['mode','filters','stateVersion'])
      or p_selection-array['mode','filters','stateVersion']<>'{}'::jsonb or jsonb_typeof(p_selection->'filters') is distinct from 'object'
      or coalesce(p_selection->>'stateVersion','') !~ '^[0-9]{1,19}$'
      or exists(select 1 from jsonb_object_keys(p_selection->'filters') k where not(k=any(array['view','sort','query','datasetId','minWrongCount','maxWrongCount','level'])))
      then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
    maximum_selection:=10000;
    loop
      page:=private.vocabulary_mistake_page_v1(p_student_id,(p_selection->'filters')||jsonb_build_object('pageSize',501)
        ||case when p_selection#>>'{filters,view}'='history' then jsonb_build_object('upperVersion',p_selection->>'stateVersion') else '{}'::jsonb end,cursor_value,false);
      if page->>'stateVersion' is distinct from p_selection->>'stateVersion' then raise exception 'wrong_history_changed' using errcode='40001'; end if;
      select coalesce(jsonb_agg(jsonb_build_object('wordKey',w->>'key','meaningKey',m->>'meaningKey','episodeId',m->'episodeId')),'[]') into page_words
        from jsonb_array_elements(page->'items') w cross join lateral jsonb_array_elements(w->'meanings') m
        where nullif(original_selection#>>'{filters,datasetId}','') is null or exists(
          select 1 from jsonb_array_elements(m->'sources') s where s->>'datasetId'=original_selection#>>'{filters,datasetId}');
      selection_words:=selection_words||page_words;
      if jsonb_array_length(selection_words)>maximum_selection then raise exception 'practice_range_too_large' using errcode='22023'; end if;
      exit when jsonb_array_length(page->'items')<501;
      cursor_value:=page->'items'->-1->'cursor';
    end loop;
    if selection_words='[]'::jsonb then return jsonb_build_object('selection',original_selection,'words','[]'::jsonb,'candidates','[]'::jsonb); end if;
    p_selection:=jsonb_build_object('mode','mistakes','view',coalesce(p_selection#>>'{filters,view}','current'),'stateVersion',p_selection->>'stateVersion','meanings',selection_words);
  end if;
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection->>'mode' is distinct from 'mistakes'
    or p_selection->>'view' is null or p_selection->>'view' not in('current','history')
    or not(p_selection ?& array['mode','view','stateVersion','meanings'])
    or p_selection-array['mode','view','stateVersion','meanings']<>'{}'::jsonb
    or coalesce(p_selection->>'stateVersion','') !~ '^[0-9]{1,19}$'
    or jsonb_typeof(p_selection->'meanings') is distinct from 'array'
    then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
  if (p_selection->>'stateVersion')::numeric>9223372036854775807 or jsonb_array_length(p_selection->'meanings') not between 1 and maximum_selection
    then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_selection->'meanings') m where jsonb_typeof(m)<>'object'
      or not(m ?& array['wordKey','meaningKey','episodeId']) or m-array['wordKey','meaningKey','episodeId']<>'{}'::jsonb
      or jsonb_typeof(m->'wordKey')<>'string' or length(m->>'wordKey') not between 1 and 1000
      or coalesce(m->>'meaningKey','') !~ '^[a-f0-9]{64}$'
      or (m->'episodeId'<>'null'::jsonb and coalesce(m->>'episodeId','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'))
    or (select count(distinct m->>'meaningKey') from jsonb_array_elements(p_selection->'meanings') m)<>jsonb_array_length(p_selection->'meanings')
    then raise exception 'invalid_practice_selection' using errcode='22023'; end if;
  upper_value:=(p_selection->>'stateVersion')::bigint;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into current_value;
  if upper_value>current_value or p_selection->>'view'='current' and upper_value<>current_value
    then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  with states as materialized(select * from private.vocabulary_meaning_states_at_v1(p_student_id,upper_value)),
  sources as materialized(
    select * from private.vocabulary_mistake_sources_v1(p_student_id,upper_value) where original_selection->>'mode'<>'mistake_targets'
    union all
    select target->>'meaningKey',e.dataset_id,e.id,d.title,q.id,target->>'sourcePhase',0,0,0,0,
      coalesce(r.accepted_at,(private.vocabulary_legacy_failure_evidence_v1(p_student_id,q.id,target->>'sourcePhase')->>'failureAt')::timestamptz)
    from jsonb_array_elements(case when original_selection->>'mode'='mistake_targets' then original_selection->'targets' else '[]'::jsonb end) target
    join public.quiz_questions q on q.id=(target->>'sourceQuestionId')::uuid
    join public.quiz_attempts t on t.id=q.attempt_id and t.student_id=p_student_id
    join public.vocab_entries e on e.id=q.vocab_entry_id join public.vocab_datasets d on d.id=e.dataset_id
    left join private.vocabulary_answer_receipts r on r.quiz_question_id=q.id and r.phase=target->>'sourcePhase'
    where private.quiz_vocabulary_meaning_v1(q.id)->>'meaningKey'=target->>'meaningKey'
      and (r.outcome<>'correct' or private.vocabulary_legacy_failure_evidence_v1(p_student_id,q.id,target->>'sourcePhase') is not null)
  ),
  selected as(
    select st.*,s.source_question_id,s.source_phase,q.attempt_id,q.vocab_entry_id,q.direction,q.prompt,q.choices,q.correct_choice_index,
      e.dataset_id,e.headword current_headword,e.primary_meaning current_meaning,
      aq.reviewed_exam_release_id_snapshot is not null or exists(select 1 from private.vocabulary_composition_entries c
        where c.version_id=aq.composition_version_id_snapshot and c.vocab_entry_id=aq.vocab_entry_id and c.source_kind='reviewed_exam') reviewed_only,
      private.quiz_vocabulary_meaning_v1(q.id) identity,
      coalesce(nullif(aq.headword_snapshot,''),case when q.direction='english_to_korean' then q.prompt else q.choices->>q.correct_choice_index end) headword,
      coalesce(aq.primary_meaning_snapshot,case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end) primary_meaning,
      case when aq.eligibility_quiz_mode in('canonical_definition_to_headword','canonical_headword_to_definition','canonical_example_to_headword')
        then aq.eligibility_quiz_mode else 'book_meaning_choice' end quiz_mode
    from jsonb_array_elements(p_selection->'meanings') m join states st on st.meaning_key=m->>'meaningKey' and st.word_key=m->>'wordKey'
      and st.episode_id is not distinct from (m->>'episodeId')::uuid and (p_selection->>'view'='history' or st.unresolved)
    join lateral(select src.* from sources src where src.meaning_key=st.meaning_key
      and (original_selection->>'mode'<>'mistake_targets' or exists(select 1 from jsonb_array_elements(original_selection->'targets') pick
        where pick->>'meaningKey'=st.meaning_key and (pick->>'sourceQuestionId')::uuid=src.source_question_id and pick->>'sourcePhase'=src.source_phase))
      and (nullif(original_selection#>>'{filters,datasetId}','') is null or src.dataset_id=(original_selection#>>'{filters,datasetId}')::uuid)
      and (p_selection->>'view'='history' or exists(select 1 from private.vocabulary_answer_receipts r
          where r.quiz_question_id=src.source_question_id and r.phase=src.source_phase and r.episode_id=st.episode_id and r.outcome<>'correct')
        or (st.episode_id=md5('legacy-v1/'||p_student_id::text||'/'||st.meaning_key)::uuid
          and private.vocabulary_legacy_failure_evidence_v1(p_student_id,src.source_question_id,src.source_phase) is not null))
      order by last_wrong_at desc,source_question_id,source_phase limit 1)s on true
    join private.quiz_question_contents_v1 q on q.id=s.source_question_id
    join public.quiz_attempts t on t.id=q.attempt_id and t.student_id=p_student_id
    join public.vocab_entries e on e.id=q.vocab_entry_id
    left join private.assignment_question_contents_v1 aq on aq.id=q.assignment_question_id
  ), picked_values as(select *,case when identity->>'testedField'='primary_meaning' then case when direction='english_to_korean' then choices->>correct_choice_index else prompt end
      when quiz_mode='canonical_headword_to_definition' then choices->>correct_choice_index else prompt end selected_text,
      jsonb_build_object('quizContentMode',quiz_mode,'direction',direction,'prompt',prompt,'choices',choices,'correctChoiceIndex',correct_choice_index) frozen
    from selected)
  select coalesce(jsonb_agg(jsonb_build_object('key',meaning_key,'wordKey',word_key,'meaningKey',meaning_key,'episodeId',episode_id,
      'stateVersion',upper_value::text,
      'headword',headword,'primaryMeaning',case when identity->>'testedField'='primary_meaning' then selected_text else primary_meaning end,
      'selectedText',selected_text,'testedField',identity->>'testedField','latestVocabEntryId',vocab_entry_id,'latestDatasetId',dataset_id,
      'frozenOnly',coalesce(reviewed_only,false) or headword is distinct from current_headword or selected_text is distinct from current_meaning,
      'sourceQuestionId',source_question_id,'sourceAttemptId',attempt_id,'sourcePhase',source_phase,'frozenQuestion',frozen,
      'sourceContentHash',encode(extensions.digest(jsonb_build_array(identity,frozen)::text,'sha256'),'hex'),
      'choiceSafety',private.vocabulary_entry_choice_safety_v1(vocab_entry_id),'studySource',private.vocabulary_meaning_study_source_v1(source_question_id))
      order by meaning_key),'[]'),array_agg(distinct dataset_id) into selected_words,dataset_ids from picked_values;
  if jsonb_array_length(selected_words)<>jsonb_array_length(p_selection->'meanings')
    then raise exception 'practice_source_changed' using errcode='40001'; end if;
  select count(*) into candidate_count from public.vocab_entries e where e.dataset_id=any(dataset_ids);
  if candidate_count>20000 then raise exception 'practice_range_too_large' using errcode='22023'; end if;
  -- Same reviewed eligibility as regular meaning-choice generation. Do not
  -- call the administrator-only RPC with a student's service session.
  with eligible as (
    select e.id,e.dataset_id,e.headword,e.primary_meaning,e.pronunciation_ko,
      array(select distinct direction from (
        select case q.quiz_mode when 'book_meaning_en_to_ko' then 'english_to_korean' else 'korean_to_english' end direction
          from public.vocab_entry_quiz_eligibility q where q.vocab_entry_id=e.id and q.dataset_id=e.dataset_id and q.input_content_hash=e.row_sha256
            and q.quiz_mode in('book_meaning_en_to_ko','book_meaning_ko_to_en')
          and (q.status='eligible' or q.status='review_required' and cardinality(q.reason_codes)>0
            and q.reason_codes <@ array['DUPLICATE_HEADWORD_DIFFERENT_MEANING','DUPLICATE_PRIMARY_MEANING_DIFFERENT_HEADWORD']::text[])
        union select unnest(array['english_to_korean','korean_to_english']) from word_index.app_exam_use_occurrence o
          join word_index.app_exam_use_release r on r.release_id=o.release_id and r.dataset_id=o.dataset_id
          where o.vocab_entry_id=e.id and r.status='active' and r.target_environment='preview' and r.exam_use_import_allowed
          and o.dataset_id=e.dataset_id and o.unit_id=e.unit_id and o.source_row=e.source_row and upper(o.source_projection_row_sha256)=e.row_sha256
          and o.display_headword=e.headword and o.display_gloss_ko=e.primary_meaning
          and not r.common_dictionary_release_allowed and o.include_in_exam and o.exam_use_status='reviewed_for_preview'
        union select unnest(c.eligible_directions) from private.vocabulary_composition_entries c
          join private.vocabulary_compositions pc on pc.version_id=c.version_id and pc.dataset_id=c.dataset_id and pc.state='ready'
          where c.vocab_entry_id=e.id and c.dataset_id=e.dataset_id and upper(c.entry_sha256)=e.row_sha256 and c.source_kind<>'reviewed_exam'
      ) directions order by direction) as directions
    from public.vocab_entries e where e.dataset_id=any(dataset_ids)
  ) select coalesce(jsonb_agg(jsonb_build_object('entryId',id,'datasetId',dataset_id,'headword',headword,'primaryMeaning',primary_meaning,
      'displayKo',pronunciation_ko,'eligibleDirections',directions,'choiceSafety',private.vocabulary_entry_choice_safety_v1(id)) order by id),'[]')
    into candidates from eligible where cardinality(directions)>0;

  return jsonb_build_object('selection',original_selection,'words',selected_words,'candidates',candidates);
end;
$$;

create function private.assert_mistake_practice_plan_v1(source jsonb,p_settings jsonb,p_questions jsonb)
returns void language plpgsql stable set search_path='' as $$
declare item jsonb; word jsonb; choice jsonb; direction text; correct integer;
 count_requested integer:=(p_settings->>'questionCount')::integer; ratio integer:=(p_settings->>'englishToKoreanRatio')::integer;
begin
  if (select count(distinct q->>'meaningKey') from jsonb_array_elements(p_questions) q)<>count_requested
    or (select count(*) from jsonb_array_elements(p_questions) q where q->>'direction'='english_to_korean')<>round(count_requested*ratio/100.0)
    then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    select w into word from jsonb_array_elements(source->'words') w where w->>'meaningKey'=item->>'meaningKey';
    direction:=item->>'direction';correct:=(item->>'correctChoiceIndex')::integer;
    if word is null or not(item ?& array['wordKey','meaningKey','episodeId','sourceQuestionId','sourcePhase','sourceContentHash','quizContentMode'])
      or item->>'wordKey' is distinct from word->>'wordKey' or item->'episodeId' is distinct from word->'episodeId'
      or item->>'sourceQuestionId' is distinct from word->>'sourceQuestionId' or item->>'sourcePhase' is distinct from word->>'sourcePhase'
      or item->>'sourceContentHash' is distinct from word->>'sourceContentHash'
      or item->>'quizContentMode' is distinct from word->'frozenQuestion'->>'quizContentMode'
      then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    if item->'choiceSources' is distinct from '[]'::jsonb then
      if word->>'testedField'<>'primary_meaning' or (word->>'frozenOnly')::boolean
        then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=word->>'latestVocabEntryId'
      and c->>'headword'=word->>'headword' and c->'eligibleDirections' ? direction)
      then raise exception 'practice_target_not_eligible' using errcode='22023'; end if;
    if word is null or direction is null or direction not in('english_to_korean','korean_to_english') or correct is null or correct not between 0 and 3
      or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_array_length(item->'choices')<>4
      or jsonb_typeof(item->'choiceSources') is distinct from 'array' or jsonb_array_length(item->'choiceSources')<>4
      or jsonb_typeof(item->'choicePronunciations') is distinct from 'array' or jsonb_array_length(item->'choicePronunciations')<>4
      or jsonb_typeof(item->'pronunciation') is distinct from 'object'
      or item->>'prompt' is distinct from (case direction when 'english_to_korean' then word->>'headword' else word->>'primaryMeaning' end)
      or item->'choices'->>correct is distinct from (case direction when 'english_to_korean' then word->>'primaryMeaning' else word->>'headword' end)
      or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'choices') v)<>4
      then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    perform private.assert_reviewed_choice_texts_v1(nullif(word->'choiceSafety','null'),direction,item->'choices',correct);
    for choice in select value||jsonb_build_object('index',n-1) from jsonb_array_elements(item->'choiceSources') with ordinality c(value,n) loop
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->'eligibleDirections' ? direction)
        then raise exception 'practice_choice_not_eligible' using errcode='22023'; end if;
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->>'primaryMeaning'=choice->>'primaryMeaning')
        and not exists(select 1 from jsonb_array_elements(source->'words') w where w->>'latestVocabEntryId'=choice->>'entryId'
          and w->>'headword'=choice->>'headword' and w->>'primaryMeaning'=choice->>'primaryMeaning')
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
      if item->'choices'->>((choice->>'index')::integer) is distinct from (case direction when 'english_to_korean' then choice->>'primaryMeaning' else choice->>'headword' end)
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
    end loop;

    else
      if item->>'direction' is distinct from word->'frozenQuestion'->>'direction'
        or item->>'prompt' is distinct from word->'frozenQuestion'->>'prompt'
        or item->'choices' is distinct from word->'frozenQuestion'->'choices'
        or item->'correctChoiceIndex' is distinct from word->'frozenQuestion'->'correctChoiceIndex'
        or jsonb_typeof(item->'pronunciation') is distinct from 'object'
        or jsonb_typeof(item->'choicePronunciations') is distinct from 'array' or jsonb_array_length(item->'choicePronunciations')<>4
        or item->'choiceSources' is distinct from '[]'::jsonb
        then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    end if;
  end loop;
  if exists(select 1 from jsonb_array_elements(p_questions) with ordinality a(q,n)
    join jsonb_array_elements(p_questions) with ordinality b(q,n) on a.n<b.n
    where a.q->>'quizContentMode'=b.q->>'quizContentMode' and a.q->>'direction'=b.q->>'direction'
      and lower(normalize(btrim(a.q->>'prompt'),NFKC))=lower(normalize(btrim(b.q->>'prompt'),NFKC))
      and lower(normalize(btrim(a.q->'choices'->>((a.q->>'correctChoiceIndex')::integer)),NFKC))<>
        lower(normalize(btrim(b.q->'choices'->>((b.q->>'correctChoiceIndex')::integer)),NFKC))
      and (exists(select 1 from jsonb_array_elements_text(a.q->'choices') c
          where lower(normalize(btrim(c),NFKC))=lower(normalize(btrim(b.q->'choices'->>((b.q->>'correctChoiceIndex')::integer)),NFKC)))
        or exists(select 1 from jsonb_array_elements_text(b.q->'choices') c
          where lower(normalize(btrim(c),NFKC))=lower(normalize(btrim(a.q->'choices'->>((a.q->>'correctChoiceIndex')::integer)),NFKC)))))
    then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
end;
$$;

do $practice_meaning_selection$
declare r record; d text; anchor text;
begin
  for r in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in('prepare_student_word_practice_v1','start_student_word_practice_v1') loop
    d:=pg_get_functiondef(r.oid);
    anchor:='source:=private.word_practice_source_v1(p_student_id,p_selection);';
    if (length(d)-length(replace(d,anchor,'')))/length(anchor)<>1 then raise exception 'm03_practice_source_patch_mismatch'; end if;
    d:=replace(d,anchor,$p$source:=case when p_selection->>'mode' in('mistakes','mistake_filters') then private.mistake_word_practice_source_v1(p_student_id,p_selection)
      else private.word_practice_source_v1(p_student_id,p_selection) end;$p$);
    if r.proname='start_student_word_practice_v1' then
      anchor:='  perform pg_advisory_xact_lock(hashtextextended(p_student_id::text||'':''||p_request_key::text,913));';
      if strpos(d,anchor)=0 then raise exception 'm03_practice_lock_patch_mismatch'; end if;
      d:=replace(d,anchor,E'  perform 1 from public.students where id=p_student_id for update;
'||anchor);
      anchor:=$old$  if (select count(distinct q->>'wordKey') from jsonb_array_elements(p_questions) q)<>count_requested
    or (select count(*) from jsonb_array_elements(p_questions) q where q->>'direction'='english_to_korean')<>round(count_requested*ratio/100.0)
    then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    select w into word from jsonb_array_elements(source->'words') w where w->>'key'=item->>'wordKey';
    direction:=item->>'direction';correct:=(item->>'correctChoiceIndex')::integer;
    if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=word->>'latestVocabEntryId'
      and c->>'headword'=word->>'headword' and c->'eligibleDirections' ? direction)
      then raise exception 'practice_target_not_eligible' using errcode='22023'; end if;
    if word is null or direction is null or direction not in('english_to_korean','korean_to_english') or correct is null or correct not between 0 and 3
      or jsonb_typeof(item->'choices') is distinct from 'array' or jsonb_array_length(item->'choices')<>4
      or jsonb_typeof(item->'choiceSources') is distinct from 'array' or jsonb_array_length(item->'choiceSources')<>4
      or jsonb_typeof(item->'choicePronunciations') is distinct from 'array' or jsonb_array_length(item->'choicePronunciations')<>4
      or jsonb_typeof(item->'pronunciation') is distinct from 'object'
      or item->>'prompt' is distinct from (case direction when 'english_to_korean' then word->>'headword' else word->>'primaryMeaning' end)
      or item->'choices'->>correct is distinct from (case direction when 'english_to_korean' then word->>'primaryMeaning' else word->>'headword' end)
      or (select count(distinct lower(btrim(v))) from jsonb_array_elements_text(item->'choices') v)<>4
      then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
    perform private.assert_reviewed_choice_texts_v1(nullif(word->'choiceSafety','null'),direction,item->'choices',correct);
    for choice in select value||jsonb_build_object('index',n-1) from jsonb_array_elements(item->'choiceSources') with ordinality c(value,n) loop
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->'eligibleDirections' ? direction)
        then raise exception 'practice_choice_not_eligible' using errcode='22023'; end if;
      if not exists(select 1 from jsonb_array_elements(source->'candidates') c where c->>'entryId'=choice->>'entryId'
        and c->>'headword'=choice->>'headword' and c->>'primaryMeaning'=choice->>'primaryMeaning')
        and not exists(select 1 from jsonb_array_elements(source->'words') w where w->>'latestVocabEntryId'=choice->>'entryId'
          and w->>'headword'=choice->>'headword' and w->>'primaryMeaning'=choice->>'primaryMeaning')
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
      if item->'choices'->>((choice->>'index')::integer) is distinct from (case direction when 'english_to_korean' then choice->>'primaryMeaning' else choice->>'headword' end)
        then raise exception 'invalid_practice_choice_source' using errcode='22023'; end if;
    end loop;
  end loop;
$old$;
      if strpos(d,anchor)=0 then raise exception 'm03_practice_check_patch_mismatch'; end if;
      d:=replace(d,anchor,$p$  if p_selection->>'mode' in('mistakes','mistake_filters') then
    perform private.assert_mistake_practice_plan_v1(source,p_settings,p_questions);
  else
$p$||anchor||E'  end if;
');
    end if;
    execute d;
  end loop;
end;
$practice_meaning_selection$;

-- Practice version 3 retains personal meaning references without copying bodies.
create function private.practice_question_reference_keys_v3() returns text[] language sql immutable set search_path='' as $$
 select array['wordKey','meaningKey','episodeId','quizContentMode','sourceQuestionId','sourcePhase','sourceContentHash','direction','correctChoiceIndex']::text[];
$$;
create function private.practice_question_reference_valid_v3(p jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and p ?& private.practice_question_reference_keys_v3()
   and jsonb_typeof(p->'wordKey')='string' and length(p->>'wordKey') between 1 and 1000
   and jsonb_typeof(p->'meaningKey')='string' and p->>'meaningKey' ~ '^[a-f0-9]{64}$'
   and (p->'episodeId'='null'::jsonb or jsonb_typeof(p->'episodeId')='string' and p->>'episodeId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$')
   and jsonb_typeof(p->'sourceQuestionId')='string' and p->>'sourceQuestionId' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
   and p->>'sourcePhase' in('initial','retry') and jsonb_typeof(p->'sourceContentHash')='string' and p->>'sourceContentHash' ~ '^[a-f0-9]{64}$'
   and jsonb_typeof(p->'correctChoiceIndex')='number' and p->>'correctChoiceIndex' ~ '^[0-3]$'
   and (p->>'quizContentMode',p->>'direction') in (('book_meaning_choice','english_to_korean'),('book_meaning_choice','korean_to_english'),
     ('canonical_headword_to_definition','english_to_korean'),('canonical_definition_to_headword','korean_to_english'),('canonical_example_to_headword','korean_to_english')),false);
$$;
create or replace function private.resolve_practice_question_v2(p_body jsonb,p_reference uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions; payload jsonb; rule text;
 display_keys text[]:=array['prompt','choices','pronunciation','choicePronunciations','choiceSources'];
begin
 if p_reference is null then return p_body; end if;
 select * into material from private.vocabulary_question_content_versions where id=p_reference;
 if material.id is null or material.kind<>'practice' or material.binding->'direction' is distinct from p_body->'direction'
   or material.binding->'correctChoiceIndex' is distinct from p_body->'correctChoiceIndex'
   then raise exception 'practice_content_binding_mismatch' using errcode='55000'; end if;
 rule:=material.binding->>'storage_rule';
 if rule='practice-display-v2' then
   if p_body ?| array['meaningKey','episodeId','sourceQuestionId','sourcePhase','sourceContentHash']
     then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
 elsif rule='practice-display-v3' then
   if not private.practice_question_reference_valid_v3(p_body) or p_body-private.practice_question_reference_keys_v3()-display_keys-'content_version_id'<>'{}'::jsonb
     or material.binding->'quizContentMode' is distinct from p_body->'quizContentMode'
     then raise exception 'practice_content_binding_mismatch' using errcode='55000'; end if;
 else raise exception 'practice_content_binding_mismatch' using errcode='55000'; end if;
 payload:=private.vocabulary_question_content_payload_v1(material);
 if rule='practice-display-v3' and (not(payload ?& display_keys) or payload-display_keys<>'{}'::jsonb)
   then raise exception 'practice_content_body_mismatch' using errcode='55000'; end if;
 if exists(select 1 from jsonb_each(payload) e where p_body ? e.key and p_body->e.key is distinct from e.value)
   then raise exception 'practice_content_body_mismatch' using errcode='55000'; end if;
 return (p_body-'content_version_id')||payload;
end;
$$;
create function private.compact_practice_questions_v3(p_questions jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; ref_body jsonb; payload jsonb; binding jsonb; result jsonb:='[]'; target_id bigint; choice_ids bigint[]; reference uuid;
 ref_keys text[]:=private.practice_question_reference_keys_v3(); display_keys text[]:=array['prompt','choices','pronunciation','choicePronunciations','choiceSources'];
begin
 for item in select value from jsonb_array_elements(private.resolve_practice_questions_v2(p_questions)) loop
   if not private.practice_question_reference_valid_v3(item) or not(item ?& display_keys) or item-ref_keys-display_keys<>'{}'::jsonb
     then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
   ref_body:=private.vocabulary_question_json_fields_v1(item,ref_keys); payload:=private.vocabulary_question_json_fields_v1(item,display_keys);
   if jsonb_typeof(payload->'choices') is distinct from 'array' or jsonb_typeof(payload->'choicePronunciations') is distinct from 'array'
     or jsonb_typeof(payload->'choiceSources') is distinct from 'array' or jsonb_typeof(payload->'pronunciation') is distinct from 'object'
     or jsonb_typeof(payload->'prompt') is distinct from 'string' then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
   if jsonb_array_length(payload->'choices')<>4 or jsonb_array_length(payload->'choicePronunciations')<>4
     or exists(select 1 from jsonb_array_elements(payload->'choices') c where jsonb_typeof(c)<>'string')
     or exists(select 1 from jsonb_array_elements(payload->'choiceSources') c where jsonb_typeof(c) is distinct from 'object'
       or jsonb_typeof(c->'entryId') is distinct from 'number' or c->>'entryId' !~ '^[1-9][0-9]*$')
     then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
   select vocab_entry_id into target_id from public.quiz_questions where id=(ref_body->>'sourceQuestionId')::uuid;
   if target_id is null then raise exception 'practice_content_source_missing' using errcode='55000'; end if;
   select coalesce(array_agg((c->>'entryId')::bigint order by n),'{}'::bigint[]) into choice_ids
     from jsonb_array_elements(payload->'choiceSources') with ordinality choices(c,n);
   if payload->'choiceSources'='[]'::jsonb then
     select coalesce(aq.choice_vocab_entry_ids,'{}'::bigint[]) into choice_ids from public.quiz_questions q
       left join private.assignment_question_contents_v1 aq on aq.id=q.assignment_question_id where q.id=(ref_body->>'sourceQuestionId')::uuid;
   end if;
   if exists(select 1 from unnest(array[target_id]||choice_ids) id where not exists(select 1 from public.vocab_entries e where e.id=id))
     then raise exception 'practice_content_source_missing' using errcode='55000'; end if;
   binding:=private.vocabulary_question_json_fields_v1(item,array['direction','correctChoiceIndex','quizContentMode'])
     ||jsonb_build_object('storage_rule','practice-display-v3','choice_entry_ids',choice_ids);
   reference:=private.register_vocabulary_question_content_v1('practice',private.vocabulary_question_scope_v1(array[target_id]||choice_ids),binding,payload,null);
   result:=result||jsonb_build_array(ref_body||jsonb_build_object('content_version_id',reference));
 end loop;
 return result;
end;
$$;
alter table private.student_word_practice_questions drop constraint practice_question_reference_body;
alter table private.student_word_practice_questions add constraint practice_question_reference_body check (
 (content_version_id is null and not(body ?| array['meaningKey','episodeId','sourceQuestionId','sourcePhase','sourceContentHash']))
 or content_version_id is not null and (
   body-array['wordKey','direction','correctChoiceIndex']='{}'::jsonb and body ?& array['wordKey','direction','correctChoiceIndex']
   or body-private.practice_question_reference_keys_v3()='{}'::jsonb and private.practice_question_reference_valid_v3(body)));
create function private.resolve_practice_preparation_questions_v3(p_plan jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare version_value text; item jsonb; rule text;
begin
 version_value:=case when p_plan ? 'contentStorageVersion' then p_plan->>'contentStorageVersion' else 'legacy' end;
 if version_value is null or version_value not in('legacy','2','3')
   or coalesce(p_plan#>>'{selection,mode}' in('mistakes','mistake_filters'),false) is distinct from (version_value='3')
   or jsonb_typeof(p_plan->'questions') is distinct from 'array' then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
 for item in select value from jsonb_array_elements(p_plan->'questions') loop
   if version_value='legacy' then
     if item ?| array['meaningKey','episodeId','sourceQuestionId','sourcePhase','sourceContentHash'] then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
   else
     if jsonb_typeof(item->'content_version_id') is distinct from 'string' or item->>'content_version_id'=''
       then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
     select binding->>'storage_rule' into rule from private.vocabulary_question_content_versions where id=(item->>'content_version_id')::uuid and kind='practice';
     if rule is null then raise exception 'practice_content_binding_mismatch' using errcode='55000'; end if;
     if rule is distinct from ('practice-display-v'||version_value) or version_value='3' and (not private.practice_question_reference_valid_v3(item)
       or item-private.practice_question_reference_keys_v3()-'content_version_id'<>'{}'::jsonb)
       then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
   end if;
 end loop;
 return private.resolve_practice_questions_v2(p_plan->'questions');
end;
$$;
do $practice_storage$
declare edit record; definition text; actual integer;
begin
 for edit in select * from (values
  ('public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
   $n$'contentStorageVersion',2,'questions',private.compact_practice_questions_v2(p_questions)$n$,
   $r$'contentStorageVersion',case when p_selection->>'mode' in('mistakes','mistake_filters') then 3 else 2 end,'questions',case when p_selection->>'mode' in('mistakes','mistake_filters') then private.compact_practice_questions_v3(p_questions) else private.compact_practice_questions_v2(p_questions) end$r$),
  ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
   $n$p_questions:=private.compact_practice_questions_v2(p_questions);$n$,
   $r$p_questions:=case when p_selection->>'mode' in('mistakes','mistake_filters') then private.compact_practice_questions_v3(p_questions) else private.compact_practice_questions_v2(p_questions) end;$r$),
  ('private.resolve_quiz_preparation_plan_v2(private.quiz_attempt_preparations,boolean)',
   $n$if p.kind='practice' then
        if p.plan ? 'contentStorageVersion' and (p.plan->>'contentStorageVersion' is distinct from '2' or exists(
          select 1 from jsonb_array_elements(p.plan->'questions') q where not(q ? 'content_version_id')))
          then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;
        return (p.plan-'contentStorageVersion')||jsonb_build_object('questions',private.resolve_practice_questions_v2(p.plan->'questions')); end if;$n$,
   $r$if p.kind='practice' then return (p.plan-'contentStorageVersion')||jsonb_build_object('questions',private.resolve_practice_preparation_questions_v3(p.plan)); end if;$r$),
  ('public.begin_prepared_practice_v1(uuid,uuid)',
   $n$  if p.plan ? 'contentStorageVersion' and (p.plan->>'contentStorageVersion' is distinct from '2' or exists(
        select 1 from jsonb_array_elements(p.plan->'questions') q where not(q ? 'content_version_id')))
        then raise exception 'practice_content_reference_invalid' using errcode='55000'; end if;$n$,
   $r$  p.plan:=jsonb_set(p.plan,'{questions}',private.resolve_practice_preparation_questions_v3(p.plan));$r$),
  ('private.word_practice_read_v1(private.student_word_practice_runs)',
   $n$end) order by q.ordinal),'[]')$n$,
   $r$end) || case when q.body ? 'quizContentMode' then jsonb_build_object('quizContentMode',q.body->>'quizContentMode') else '{}'::jsonb end order by q.ordinal),'[]')$r$),
  ('private.compact_practice_questions_v2(jsonb)',
   $n$    payload:=private.vocabulary_question_json_fields_v1(item,$n$,
   $r$    if item ? 'meaningKey' then raise exception 'practice_content_version_mismatch' using errcode='55000'; end if;
    payload:=private.vocabulary_question_json_fields_v1(item,$r$)
 ) changes(signature,needle,replacement) loop
   definition:=replace(pg_get_functiondef(edit.signature::regprocedure),chr(13),'');
   actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
   if actual<>1 then raise exception 'm03_practice_storage_patch_mismatch: %, %',edit.signature,actual; end if;
   execute replace(definition,edit.needle,edit.replacement);
 end loop;
end;
$practice_storage$;
-- The unchanged service-only entry point now restores private content itself.
alter function public.begin_prepared_practice_v1(uuid,uuid) security definer;
revoke all on function private.practice_question_reference_keys_v3(),private.practice_question_reference_valid_v3(jsonb),
 private.compact_practice_questions_v3(jsonb),private.resolve_practice_preparation_questions_v3(jsonb) from public,anon,authenticated,service_role;


-- Worksheet requests freeze small personal references. Creating/exporting one
-- never accepts an answer or resolves a regular mistake.
alter table public.worksheet_requests drop constraint worksheet_requests_schema_version_check;
alter table public.worksheet_requests add constraint worksheet_requests_schema_version_check
 check(schema_version in('wrong-word-worksheet-request-v1','wrong-word-worksheet-request-v2'));
create table private.worksheet_mistake_items (
 request_id uuid not null references public.worksheet_requests(id) on delete restrict,
 position integer not null check(position between 1 and 50),
 source_question_id uuid not null references public.quiz_questions(id) on delete restrict,
 source_phase text not null check(source_phase in('initial','retry')),
 meaning_key text not null check(meaning_key ~ '^[a-f0-9]{64}$'),
 episode_id uuid not null,
 selected_state_version bigint not null check(selected_state_version>=0),
 content_version_id uuid not null references private.vocabulary_question_content_versions(id) on delete restrict,
 content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
 tested_field text not null check(tested_field in('primary_meaning','definition','example')),
 selected_hash text not null check(selected_hash ~ '^[a-f0-9]{64}$'),
 dataset_id uuid not null references public.vocab_datasets(id),
 vocab_entry_id bigint not null references public.vocab_entries(id),
 identity_kind text not null,
 word_key text not null,
 current_wrong_count integer not null check(current_wrong_count>=0),
 lifetime_wrong_count integer not null check(lifetime_wrong_count>=0),
 legacy_wrong_count integer not null check(legacy_wrong_count>=0),
 current_missed_count integer not null check(current_missed_count>=0),
 count_quality text not null check(count_quality in('exact','legacy-continuation')),
 source_metadata jsonb not null check(jsonb_typeof(source_metadata)='object'),
 primary key(request_id,position),unique(request_id,meaning_key)
);
alter table private.worksheet_mistake_items enable row level security;
revoke all on private.worksheet_mistake_items from public,anon,authenticated,service_role;
create trigger worksheet_mistake_items_immutable before update or delete on private.worksheet_mistake_items
 for each row execute function private.reject_mock_wordbook_history_change();

create function private.worksheet_mistake_item_document_v2(i private.worksheet_mistake_items)
returns jsonb language plpgsql stable set search_path='' as $$
declare m private.vocabulary_question_content_versions; p jsonb; selected_value text; headword_value text; primary_value text;
begin
 select * into m from private.vocabulary_question_content_versions where id=i.content_version_id;
 if m.id is null or m.content_sha256<>i.content_sha256 then raise exception 'worksheet_content_changed' using errcode='55000'; end if;
 p:=private.vocabulary_question_content_payload_v1(m);
 selected_value:=case when i.tested_field='primary_meaning' then
   case when m.binding->>'direction'='english_to_korean' then p->'choices'->>((m.binding->>'correct_choice_index')::integer) else p->>'prompt' end
   when m.binding->>'eligibility_quiz_mode' like '%headword_to_definition%' then p->'choices'->>((m.binding->>'correct_choice_index')::integer) else p->>'prompt' end;
 if private.reviewed_exam_sha256_v1(to_jsonb(selected_value)) is distinct from i.selected_hash
   then raise exception 'worksheet_content_changed' using errcode='55000'; end if;
 headword_value:=coalesce(p->>'headword_snapshot',case when m.binding->>'direction'='english_to_korean' then p->>'prompt' else p->'choices'->>((m.binding->>'correct_choice_index')::integer) end);
 primary_value:=coalesce(p->>'primary_meaning_snapshot',case when i.tested_field='primary_meaning' then selected_value end);
 return jsonb_build_object('position',i.position,'item_id',i.meaning_key||':'||i.episode_id::text,
   'dictionary_id',case when i.word_key like 'dictionary:%' then substring(i.word_key from 12) end,
   'dataset_id',i.dataset_id,'vocab_entry_id',i.vocab_entry_id,'headword',headword_value,
   'testedField',i.tested_field,'selectedText',selected_value,'primaryMeaning',primary_value,
   'meaningKey',i.meaning_key,'episodeId',i.episode_id,'sourceQuestionId',i.source_question_id,'sourcePhase',i.source_phase,
   'stateVersion',i.selected_state_version::text,'contentVersionId',i.content_version_id,'contentSha256',i.content_sha256,
   'currentWrongCount',i.current_wrong_count,'lifetimeWrongCount',i.lifetime_wrong_count,'legacyWrongCount',i.legacy_wrong_count,
   'currentMissedCount',i.current_missed_count,'countQuality',i.count_quality,
   'generation_status',case when i.tested_field='primary_meaning' and i.source_metadata->>'provenanceStatus'='reviewed_for_preview_v1'
       and i.source_metadata->>'dictionaryId'=substring(i.word_key from 12)
       and nullif(i.source_metadata->>'occurrenceId','') is not null and i.source_metadata->>'occurrenceContentHash' ~ '^[a-fA-F0-9]{64}$'
       and i.source_metadata->>'primaryMeaningHash'=i.selected_hash then 'ready'
     when i.word_key not like 'dictionary:%' then 'needs_dictionary_link' else 'needs_meaning_review' end,
   'identityKind',i.identity_kind,'source_metadata',i.source_metadata);
end;
$$;
create function private.worksheet_mistake_document_v2(p_request_id uuid)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('schema_version',r.schema_version,'request_id',r.id,'student_id',r.student_id,
   'request_type',r.request_type,'created_at_utc',r.created_at,
   'target_profile',jsonb_build_object('school_name',r.school_name_snapshot,'grade_label',r.grade_label_snapshot),
   'item_count',r.item_count,'items',(select jsonb_agg(private.worksheet_mistake_item_document_v2(i) order by i.position)
     from private.worksheet_mistake_items i where i.request_id=r.id),'content_sha256',r.content_sha256)
 from public.worksheet_requests r where r.id=p_request_id and r.schema_version='wrong-word-worksheet-request-v2';
$$;
create function public.create_wrong_word_worksheet_request_v2(p_student_id uuid,p_targets jsonb)
returns table(request_id uuid,item_count integer,content_sha256 text,reused boolean)
language plpgsql security definer set search_path='' as $$
declare student public.students; existing public.worksheet_requests; chosen jsonb; ids jsonb; digest_value text; created_id uuid;
 q public.quiz_questions; attempt public.quiz_attempts; identity_value jsonb; material_id uuid; st record; position_value integer:=0;
begin
 if private.is_active_admin() is distinct from true then raise exception 'forbidden' using errcode='42501'; end if;
 if jsonb_typeof(p_targets) is distinct from 'array' or jsonb_array_length(p_targets) not between 1 and 50
   or (select count(distinct value->>'meaningKey') from jsonb_array_elements(p_targets))<>jsonb_array_length(p_targets)
   then raise exception 'invalid_mistake_targets' using errcode='22023'; end if;
 for chosen in select value from jsonb_array_elements(p_targets) loop
   if jsonb_typeof(chosen) is distinct from 'object'
     or not(chosen ?& array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion'])
     or chosen-array['sourceQuestionId','sourcePhase','meaningKey','episodeId','stateVersion']<>'{}'::jsonb
     or coalesce(chosen->>'sourcePhase','') not in('initial','retry')
     or coalesce(chosen->>'meaningKey','') !~ '^[a-f0-9]{64}$'
     or coalesce(chosen->>'stateVersion','') !~ '^[0-9]{1,19}$'
     or coalesce(chosen->>'episodeId','') !~ '^[a-fA-F0-9-]{36}$'
     or coalesce(chosen->>'sourceQuestionId','') !~ '^[a-fA-F0-9-]{36}$'
     then raise exception 'invalid_mistake_targets' using errcode='22023'; end if;
   if not exists(select 1 from public.quiz_questions source_question join public.quiz_attempts a on a.id=source_question.attempt_id
       where source_question.id=(chosen->>'sourceQuestionId')::uuid and a.student_id=p_student_id)
     then raise exception 'review_question_not_available' using errcode='22023'; end if;
 end loop;
 select * into student from public.students where id=p_student_id and status='active' and deleted_at is null for update;
 if not found then raise exception 'student_not_found' using errcode='P0002'; end if;
 select jsonb_agg(jsonb_build_array(value->>'meaningKey',(value->>'episodeId')::uuid) order by value->>'meaningKey') into ids from jsonb_array_elements(p_targets);
 digest_value:=upper(private.reviewed_exam_sha256_v1(jsonb_build_array('worksheet-mistakes-v2',p_student_id,ids)));
 -- Retry the same saved request before looking at current resolution/version.
 select * into existing from public.worksheet_requests r where r.student_id=p_student_id and r.input_sha256=digest_value
   and r.request_type='wrong_word_translation' and r.status in('queued','generated','approved');
 if found then return query select existing.id,existing.item_count,existing.content_sha256,true; return; end if;
 perform private.assert_vocabulary_mistake_targets_v1(p_student_id,p_targets);
 if exists(select 1 from jsonb_array_elements(p_targets) t join public.quiz_questions source_question on source_question.id=(t->>'sourceQuestionId')::uuid
   join public.quiz_attempts a on a.id=source_question.attempt_id where a.status not in('completed','expired'))
   then raise exception 'worksheet_attempt_not_finished' using errcode='22023'; end if;
 insert into public.worksheet_requests(schema_version,student_id,requested_by,school_name_snapshot,grade_label_snapshot,item_count,input_sha256,content_sha256)
 values('wrong-word-worksheet-request-v2',p_student_id,auth.uid(),student.school_name,student.grade_label,jsonb_array_length(p_targets),digest_value,repeat('0',64))
 returning id into created_id;
 for chosen in select value from jsonb_array_elements(p_targets) order by value->>'meaningKey' loop
   position_value:=position_value+1;
   select * into q from private.quiz_question_contents_v1 where id=(chosen->>'sourceQuestionId')::uuid;
   select * into attempt from public.quiz_attempts where id=q.attempt_id;
   identity_value:=private.quiz_vocabulary_meaning_v1(q.id);
   material_id:=coalesce(q.content_version_id,private.register_quiz_question_content_v1(q,attempt.assignment_id));
   select * into st from private.current_vocabulary_meaning_states_v1(p_student_id) where meaning_key=chosen->>'meaningKey';
   insert into private.worksheet_mistake_items(request_id,position,source_question_id,source_phase,meaning_key,episode_id,selected_state_version,
     content_version_id,content_sha256,tested_field,selected_hash,dataset_id,vocab_entry_id,identity_kind,word_key,
     current_wrong_count,lifetime_wrong_count,legacy_wrong_count,current_missed_count,count_quality,source_metadata)
   select created_id,position_value,q.id,chosen->>'sourcePhase',st.meaning_key,st.episode_id,(chosen->>'stateVersion')::bigint,
     m.id,m.content_sha256,identity_value->>'testedField',identity_value->>'selectedHash',e.dataset_id,e.id,identity_value->>'identityKind',st.word_key,
     st.current_wrong_count,st.lifetime_wrong_count,st.legacy_wrong_count,st.current_missed_count,st.count_quality,
     jsonb_build_object('datasetKey',d.dataset_key,'title',d.title,'sourceLabel',d.source_label,'sourceRow',e.source_row,
       'dictionaryId',x.dictionary_id,'senseId',x.sense_id,'occurrenceId',x.occurrence_id,
       'occurrenceContentHash',x.occurrence_content_hash,'provenanceStatus',x.provenance_status,
       'primaryMeaningHash',private.reviewed_exam_sha256_v1(to_jsonb(x.primary_meaning_snapshot)))
   from private.vocabulary_question_content_versions m join public.vocab_entries e on e.id=q.vocab_entry_id
     join public.vocab_datasets d on d.id=e.dataset_id
     left join private.exam_use_question_contents_v1 x on x.assignment_question_id=q.assignment_question_id where m.id=material_id;
 end loop;
 digest_value:=upper(private.reviewed_exam_sha256_v1(private.worksheet_mistake_document_v2(created_id)-array['request_id','created_at_utc','content_sha256']));
 update public.worksheet_requests set content_sha256=digest_value where id=created_id;
 insert into public.audit_events(event_type,actor_admin_id,student_id,details)
 values('worksheet.wrong_word.queued',auth.uid(),p_student_id,jsonb_build_object('requestId',created_id,'itemCount',position_value,'schemaVersion',2));
 return query select created_id,position_value,digest_value,false;
end;
$$;
do $worksheet_export$
declare definition text; needle text:='  select jsonb_build_object('; replacement text;
begin
 definition:=pg_get_functiondef('public.export_wrong_word_worksheet_request_v1(uuid)'::regprocedure);
 replacement:=$r$  if exists(select 1 from public.worksheet_requests where id=p_request_id
       and schema_version='wrong-word-worksheet-request-v2' and status in('queued','generated','approved')) then
     result:=private.worksheet_mistake_document_v2(p_request_id);
     if result->>'content_sha256' is distinct from upper(private.reviewed_exam_sha256_v1(result-array['request_id','created_at_utc','content_sha256']))
       then raise exception 'worksheet_content_changed' using errcode='55000'; end if;
     return result;
   end if;
   select jsonb_build_object($r$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'worksheet_export_boundary'; end if;
 execute replace(definition,needle,replacement);
end;
$worksheet_export$;
revoke all on function public.create_wrong_word_worksheet_request_v2(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.create_wrong_word_worksheet_request_v2(uuid,jsonb) to authenticated;
revoke all on function private.worksheet_mistake_item_document_v2(private.worksheet_mistake_items),private.worksheet_mistake_document_v2(uuid)
 from public,anon,authenticated,service_role;


-- Retry/resume may share a transaction with grading. Keep every mutation of a
-- student's attempts in student -> attempt order, preserving the existing OIDs,
-- invoker/definer modes and grants. These functions already use student tables.
do $student_locks$
declare r record; definition text;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname in ('start_quiz_retry','start_quiz_retry_v2',
      'resume_quiz_after_feedback_v1','resume_quiz_after_feedback_v2') loop
    definition:=pg_get_functiondef(r.oid);
    definition:=regexp_replace(definition,E'\\mbegin\\M',E'begin\n  perform 1 from public.students where id=p_student_id for update;', 'i');
    execute definition;
  end loop;
end;
$student_locks$;

-- Private tables/functions have no direct application-role access.
-- Both practice start protocols must recover the same accepted run. Reads only
-- resolve the receipt; they do not rewrite expired preparations or start clocks.
do $practice_recovery$
declare edit record; definition text; actual integer;
begin
  for edit in select * from (values
    ('private.guard_quiz_preparation_content_v2()',
      $n$old.plan->>'contentStorageVersion'='2'$n$,$r$old.plan->>'contentStorageVersion' in ('2','3')$r$,1),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      $n$  count_requested:=(p_settings->>'questionCount')::integer;$n$,
      $r$  if exists(select 1 from private.quiz_attempt_preparations p where p.student_id=p_student_id and p.kind='practice'
        and p.request_key=p_request_key::text and p.request_hash is distinct from p_request_hash)
        then raise exception 'practice_request_conflict' using errcode='40001'; end if;
  count_requested:=(p_settings->>'questionCount')::integer;$r$,1),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      $n$return private.word_practice_read_v1(run);$n$,
      $r$update private.quiz_attempt_preparations set begun_id=run.id where student_id=run.student_id and kind='practice'
        and request_key=run.request_key::text and request_hash=run.request_hash and begun_id is null;
    return private.word_practice_read_v1(run);$r$,2),
    ('public.get_quiz_preparation_v1(uuid,uuid)',
      $n$  if not found or p.expires_at<=clock_timestamp() and p.begun_id is null then return null; end if;$n$,
      $r$  if not found then return null; end if;
  if p.kind='practice' and p.begun_id is null then
    select r.id into p.begun_id from private.student_word_practice_runs r where r.student_id=p.student_id
      and r.request_key=p.request_key::uuid and r.request_hash=p.request_hash;
  end if;
  if p.expires_at<=clock_timestamp() and p.begun_id is null then return null; end if;$r$,1),
    ('public.find_word_practice_preparation_v1(uuid,uuid,text)',
      $n$  if p.expires_at<=clock_timestamp() and p.begun_id is null then$n$,
      $r$  if p.begun_id is null then p.begun_id:=(public.get_student_word_practice_v1(
    p_student_id,null,p.request_key::uuid,p.request_hash)#>>'{attempt,id}')::uuid; end if;
  if p.expires_at<=clock_timestamp() and p.begun_id is null then$r$,1),
    ('public.begin_prepared_practice_v1(uuid,uuid)',
      $n$  if p.expires_at<=clock_timestamp() then$n$,
      $r$  result:=public.get_student_word_practice_v1(p_student_id,null,p.request_key::uuid,p.request_hash);
  if result is not null then
    update private.quiz_attempt_preparations set begun_id=(result->'attempt'->>'id')::uuid where id=p.id;
    return result;
  end if;
  if p.expires_at<=clock_timestamp() then$r$,1)
  ) edits(signature,needle,replacement,expected) loop
    definition:=pg_get_functiondef(to_regprocedure(edit.signature));
    actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if definition is null or actual<>edit.expected then raise exception 'practice_recovery_boundary: % (% vs %)',edit.signature,actual,edit.expected; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end;
$practice_recovery$;

-- New notebook banks preserve the exact failed meaning and phase. The origin
-- is personal; all display values remain in the shared M02 content store.
create trigger notebook_assignment_requests_immutable
  before update or delete on private.notebook_assignment_requests
  for each row execute function private.reject_mock_wordbook_history_change();
create table private.notebook_question_origins_v2(
  assignment_question_id uuid primary key references public.assignment_questions(id) deferrable initially deferred,
  student_id uuid not null references public.students(id),
  source_question_id uuid not null references public.quiz_questions(id),
  source_phase text not null check(source_phase in('initial','retry')),
  meaning_key text not null check(meaning_key ~ '^[a-f0-9]{64}$'),episode_id uuid not null,state_version bigint not null,
  identity jsonb not null,source_content_id uuid not null references private.vocabulary_question_content_versions(id),
  source_content_hash text not null,body_mode text not null check(body_mode in('frozen','generated')),
  failure_evidence jsonb not null,source_frozen_only boolean not null
);
alter table private.notebook_question_origins_v2 enable row level security;
revoke all on private.notebook_question_origins_v2 from public,anon,authenticated,service_role;
create trigger notebook_origins_immutable before update or delete on private.notebook_question_origins_v2
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.vocabulary_question_requires_original_v1(p_question_id uuid,p_depth integer default 0) returns boolean
language plpgsql stable set search_path='' as $$
declare q public.assignment_questions; original_id uuid; restricted boolean;
begin
  if p_depth>8 then raise exception 'vocabulary_meaning_reference_cycle' using errcode='55000'; end if;
  select a.* into q from public.quiz_questions qq join public.assignment_questions a on a.id=qq.assignment_question_id where qq.id=p_question_id;
  if q.id is null then return false; end if;
  if q.generator_version_snapshot='notebook-bank-v2' then
    select source_frozen_only into restricted from private.notebook_question_origins_v2 where assignment_question_id=q.id;
    if not found then raise exception 'notebook_origin_mismatch' using errcode='55000'; end if;
    return restricted;
  end if;
  if q.notebook_source_event_id is not null then
    select quiz_question_id into original_id from public.student_vocab_wrong_events where id=q.notebook_source_event_id;
    if original_id is not null then return private.vocabulary_question_requires_original_v1(original_id,p_depth+1); end if;
  end if;
  return q.reviewed_exam_release_id_snapshot is not null or exists(select 1 from private.vocabulary_composition_entries c
    where c.version_id=q.composition_version_id_snapshot and c.vocab_entry_id=q.vocab_entry_id and c.source_kind='reviewed_exam');
end;
$$;
revoke all on function private.vocabulary_question_requires_original_v1(uuid,integer) from public,anon,authenticated,service_role;
do $notebook_original_rule$
declare d text; needle text:='aq.reviewed_exam_release_id_snapshot is not null or exists(select 1 from private.vocabulary_composition_entries c
        where c.version_id=aq.composition_version_id_snapshot and c.vocab_entry_id=aq.vocab_entry_id and c.source_kind=''reviewed_exam'') reviewed_only';
begin
  d:=replace(pg_get_functiondef('private.mistake_word_practice_source_v1(uuid,jsonb)'::regprocedure),chr(13),'');
  if position(needle in d)=0 then raise exception 'notebook_original_rule_hook_changed'; end if;
  execute replace(d,needle,'private.vocabulary_question_requires_original_v1(q.id) reviewed_only');
end;
$notebook_original_rule$;

create function public.prepare_notebook_assignment_source_v2(p_admin_id uuid,p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; student public.students; version_value bigint;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  select * into student from public.students where id=p_student_id and status='active' and deleted_at is null;
  if not found then raise exception 'notebook_student_unavailable' using errcode='22023'; end if;
  if nullif(btrim(student.display_name),'') is null or nullif(btrim(student.school_name),'') is null or nullif(btrim(student.grade_label),'') is null
    then raise exception 'notebook_student_profile_required' using errcode='22023'; end if;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into version_value;
  if p_selection->>'mode'='filtered' then
    if coalesce(p_selection#>>'{filters,view}','current')<>'current' then raise exception 'notebook_current_required' using errcode='22023'; end if;
    result:=private.mistake_word_practice_source_v1(p_student_id,jsonb_build_object('mode','mistake_filters',
      'stateVersion',version_value::text,'filters',(p_selection->'filters')||jsonb_build_object('view','current')));
  elsif p_selection->>'mode'='mistake_targets' then
    result:=private.mistake_word_practice_source_v1(p_student_id,p_selection);
  else raise exception 'invalid_practice_selection' using errcode='22023'; end if;
  result:=result||jsonb_build_object('student',jsonb_build_object('id',student.id,'displayName',student.display_name,
      'gradeLabel',student.grade_label,'schoolName',student.school_name),'stateVersion',version_value::text);
  result:=jsonb_set(result,'{words}',coalesce((select jsonb_agg(w||jsonb_build_object('assignmentAvailable',
    coalesce(s.scheduling<>'assigned' and s.review_draft_id is null,true)) order by n)
    from jsonb_array_elements(result->'words') with ordinality v(w,n)
    left join private.vocabulary_meaning_scheduling_v1(p_student_id,array(select x->>'meaningKey' from jsonb_array_elements(result->'words') x)) s
      on s.meaning_key=w->>'meaningKey'),'[]'));
  result:=result||jsonb_build_object('datasets',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,
    'label',concat_ws(' · ',d.title,nullif(d.edition,'')),'gradeCode',c.grade_code,
    'available',d.status='ready' and d.is_active and coalesce(c.is_assignable,false)) order by d.id)
    from public.vocab_datasets d left join public.vocab_dataset_catalog c on c.dataset_id=d.id
    where d.id in(select (w->>'latestDatasetId')::uuid from jsonb_array_elements(result->'words') w)),'[]'));
  return result||jsonb_build_object('sourceHash',encode(extensions.digest(result::text,'sha256'),'hex'));
end;
$$;
revoke all on function public.prepare_notebook_assignment_source_v2(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_notebook_assignment_source_v2(uuid,uuid,jsonb) to service_role;

-- Stable proof of the bank's original meaning. It does not ask whether the
-- episode is still open after the bank has already been assigned.
create function private.assert_notebook_origin_v2(q public.assignment_questions) returns void
language plpgsql stable set search_path='' as $$
declare origin private.notebook_question_origins_v2; original public.quiz_questions; material private.vocabulary_question_content_versions;
  selected text; field_value text; source_dataset uuid; original_identity jsonb; previous_bank public.assignment_questions; previous_origin private.notebook_question_origins_v2;
begin
  select * into origin from private.notebook_question_origins_v2 where assignment_question_id=q.id;
  select qq.* into original from private.quiz_question_contents_v1 qq join public.quiz_attempts t on t.id=qq.attempt_id
    where qq.id=origin.source_question_id and t.student_id=origin.student_id;
  select dataset_id into source_dataset from public.vocab_entries where id=original.vocab_entry_id;
  select * into material from private.vocabulary_question_content_versions where id=origin.source_content_id;
  select * into previous_bank from public.assignment_questions where id=original.assignment_question_id;
  if previous_bank.generator_version_snapshot='notebook-bank-v2' then
    select * into previous_origin from private.notebook_question_origins_v2 where assignment_question_id=previous_bank.id;
    if previous_origin.assignment_question_id is null or previous_origin.student_id is distinct from origin.student_id or previous_bank.id=q.id
      or previous_origin.source_frozen_only and not origin.source_frozen_only then raise exception 'notebook_origin_mismatch' using errcode='23514'; end if;
    original_identity:=previous_origin.identity;
  else original_identity:=private.quiz_vocabulary_meaning_v1(original.id); end if;
  field_value:=case when q.eligibility_quiz_mode like '%definition%' then 'definition' when q.eligibility_quiz_mode like '%example%' then 'example' else 'primary_meaning' end;
  selected:=case when field_value='primary_meaning' then case when q.direction='english_to_korean' then q.choices->>q.correct_choice_index else q.prompt end
    when q.eligibility_quiz_mode='canonical_headword_to_definition' then q.choices->>q.correct_choice_index else q.prompt end;
  if origin.assignment_question_id is null or original.id is null or material.id is null or material.content_sha256 is distinct from origin.source_content_hash
    or origin.identity is distinct from original_identity
    or origin.source_frozen_only and origin.body_mode<>'frozen'
    or origin.identity->>'meaningKey' is distinct from origin.meaning_key
    or origin.identity->>'testedField' is distinct from field_value
    or origin.identity->>'selectedHash' is distinct from private.reviewed_exam_sha256_v1(to_jsonb(selected))
    or q.provenance_status is distinct from 'notebook_snapshot_v1' or q.generator_version_snapshot is distinct from 'notebook-bank-v2'
    or q.notebook_source_event_id is not null or q.vocab_entry_id is distinct from original.vocab_entry_id or q.dataset_id is distinct from source_dataset
    or q.notebook_source_snapshot->>'studentId' is distinct from origin.student_id::text
    or q.notebook_source_snapshot->>'sourceQuestionId' is distinct from origin.source_question_id::text
    or not exists(select 1 from public.assignment_students where assignment_id=q.assignment_id and student_id=origin.student_id)
    or not exists(select 1 from public.assignments where id=q.assignment_id and ((source_kind='notebook' and generator_version='notebook-bank-v2' and points_policy_version='no-points-v1') or (source_kind='book' and generator_version='mistake-book-bank-v1' and points_policy_version='vocab-points-v1')))
    or q.headword_snapshot is null or q.primary_meaning_snapshot is null or q.question_content_sha256 is null
    or q.correct_answer_snapshot is distinct from q.choices->>q.correct_choice_index
    or jsonb_typeof(q.notebook_pronunciation_snapshot->'target') is distinct from 'object'
    or jsonb_typeof(q.notebook_pronunciation_snapshot->'choices') is distinct from 'array'
    or jsonb_array_length(q.notebook_pronunciation_snapshot->'choices')<>4
    then raise exception 'notebook_origin_mismatch' using errcode='23514'; end if;
  if origin.body_mode='frozen' then
    if q.prompt is distinct from original.prompt or q.choices is distinct from original.choices or q.direction is distinct from original.direction
      or q.correct_choice_index is distinct from original.correct_choice_index
      or q.choice_vocab_entry_ids is distinct from (select a.choice_vocab_entry_ids from public.assignment_questions a where a.id=original.assignment_question_id)
      then raise exception 'notebook_original_body_mismatch' using errcode='23514'; end if;
  elsif field_value<>'primary_meaning' or cardinality(q.choice_vocab_entry_ids) is distinct from 4
    or array_position(q.choice_vocab_entry_ids,null) is not null or q.choice_vocab_entry_ids[q.correct_choice_index+1] is distinct from q.vocab_entry_id
    then raise exception 'notebook_generated_body_mismatch' using errcode='23514'; end if;
end;
$$;

-- Reuse prompt and choices by parent reference, with only shared pronunciation
-- and study metadata added. No student/attempt/episode key enters the payload.
create function private.register_notebook_question_content_v2(q public.assignment_questions) returns uuid
language plpgsql set search_path='' as $$
declare origin private.notebook_question_origins_v2; parent private.vocabulary_question_content_versions; payload jsonb; depth integer:=0;
begin
  perform private.assert_notebook_origin_v2(q);
  select * into origin from private.notebook_question_origins_v2 where assignment_question_id=q.id;
  if origin.body_mode='generated' then return private.register_assignment_question_content_v1(q); end if;
  select * into parent from private.vocabulary_question_content_versions where id=origin.source_content_id;
  while parent.payload->>'schemaVersion'='notebook-shared-body-ref-v1' loop
    depth:=depth+1;if depth>8 then raise exception 'notebook_content_cycle' using errcode='55000'; end if;
    select * into parent from private.vocabulary_question_content_versions where id=(parent.payload->>'sourceContentVersionId')::uuid;
  end loop;
  payload:=jsonb_build_object('schemaVersion','notebook-shared-body-ref-v1','sourceContentVersionId',parent.id,
    'sourceContentSha256',parent.content_sha256,'supplement',jsonb_build_object('headword_snapshot',q.headword_snapshot,
    'primary_meaning_snapshot',q.primary_meaning_snapshot,'correct_answer_snapshot',q.correct_answer_snapshot,
    'composition_pronunciation_snapshot',null,'notebook_pronunciation_snapshot',q.notebook_pronunciation_snapshot,
    'notebook_study',q.notebook_source_snapshot->'study'));
  return private.register_vocabulary_question_content_v1('assignment',parent.dataset_ids,private.vocabulary_question_binding_v1(q),payload);
end;
$$;
alter table private.vocabulary_question_content_versions add column notebook_parent_content_id uuid generated always as
  (case when payload->>'schemaVersion'='notebook-shared-body-ref-v1' then (payload->>'sourceContentVersionId')::uuid end) stored
  references private.vocabulary_question_content_versions(id);

create function private.notebook_shared_question_payload_v2(v private.vocabulary_question_content_versions) returns jsonb
language plpgsql stable set search_path='' as $$
declare parent private.vocabulary_question_content_versions; payload jsonb;
begin
  select * into parent from private.vocabulary_question_content_versions where id=(v.payload->>'sourceContentVersionId')::uuid;
  if v.kind<>'assignment' or parent.id is null or parent.kind not in('assignment','standalone')
    or parent.payload->>'schemaVersion'='notebook-shared-body-ref-v1'
    or parent.content_sha256 is distinct from v.payload->>'sourceContentSha256' or parent.dataset_ids is distinct from v.dataset_ids
    or parent.binding->'vocab_entry_id' is distinct from v.binding->'vocab_entry_id'
    or parent.binding->'direction' is distinct from v.binding->'direction'
    or parent.binding->'correct_choice_index' is distinct from v.binding->'correct_choice_index'
    or (parent.kind='assignment' and parent.binding->'choice_vocab_entry_ids' is distinct from v.binding->'choice_vocab_entry_ids')
    or jsonb_typeof(v.payload->'supplement') is distinct from 'object'
    or (v.payload->'supplement')-array['headword_snapshot','primary_meaning_snapshot','correct_answer_snapshot','composition_pronunciation_snapshot','notebook_pronunciation_snapshot','notebook_study']<>'{}'::jsonb
    then raise exception 'notebook_shared_content_mismatch' using errcode='55000'; end if;
  payload:=private.vocabulary_question_content_payload_v1(parent);
  return jsonb_build_object('prompt',payload->'prompt','choices',payload->'choices')||(v.payload->'supplement');
end;
$$;

do $notebook_hooks$
declare d text; needle text; replacement text; edit record;
begin
  for edit in select * from(values
    ('private.vocabulary_question_content_payload_v1(private.vocabulary_question_content_versions)',
      '  if v.source_body_sha256 is null then return v.payload; end if;',
      E'  if v.payload->>''schemaVersion''=''notebook-shared-body-ref-v1'' then return private.notebook_shared_question_payload_v2(v); end if;\n  if v.source_body_sha256 is null then return v.payload; end if;'),
    ('private.freeze_assignment_question_content_v1()',
      'new.content_version_id:=private.register_assignment_question_content_v1(new);',
      'new.content_version_id:=case when new.generator_version_snapshot=''notebook-bank-v2'' then private.register_notebook_question_content_v2(new) else private.register_assignment_question_content_v1(new) end;'),
    ('private.guard_notebook_question_source_v1()',
      '  select * into ev from public.student_vocab_wrong_events where id=new.notebook_source_event_id;',
      E'  if new.generator_version_snapshot=''notebook-bank-v2'' then perform private.assert_notebook_origin_v2(new); return new; end if;\n  select * into ev from public.student_vocab_wrong_events where id=new.notebook_source_event_id;'),
    ('private.guard_assignment_reviewed_choices_v1()',
      '  policy:=private.vocabulary_entry_choice_safety_v1(resolved.vocab_entry_id);',
      E'  if resolved.generator_version_snapshot=''notebook-bank-v2'' then\n    perform private.assert_notebook_origin_v2(resolved);\n    if exists(select 1 from private.notebook_question_origins_v2 where assignment_question_id=resolved.id and body_mode=''frozen'') then return new; end if;\n  end if;\n  policy:=private.vocabulary_entry_choice_safety_v1(resolved.vocab_entry_id);'),
    ('private.assert_assignment_question_body_v1(public.assignment_questions)',
      'if cardinality(failures)>0 then',
      E'if q.generator_version_snapshot=''notebook-bank-v2'' then perform private.assert_notebook_origin_v2(q); failures:=array_remove(failures,''assignment_questions_notebook_proof''); end if;\n      if cardinality(failures)>0 then'),
    ('private.assignment_vocabulary_meaning_v1(uuid,integer)',
      '  if q.provenance_status=''notebook_snapshot_v1'' and q.notebook_source_event_id is not null then',
      E'  if q.generator_version_snapshot=''notebook-bank-v2'' then\n    perform private.assert_notebook_origin_v2(q);\n    return (select identity from private.notebook_question_origins_v2 where assignment_question_id=q.id);\n  end if;\n  if q.provenance_status=''notebook_snapshot_v1'' and q.notebook_source_event_id is not null then')
  ) edits(signature,needle,replacement) loop
    d:=replace(pg_get_functiondef(to_regprocedure(edit.signature)),chr(13),'');
    if d is null or (length(d)-length(replace(d,edit.needle,'')))/length(edit.needle)<>1
      then raise exception 'notebook_v2_hook_changed: %',edit.signature; end if;
    execute replace(d,edit.needle,edit.replacement);
  end loop;
  select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.assignments'::regclass and conname='assignments_notebook_proof';
  if d is null then raise exception 'notebook_v2_header_hook_missing'; end if;
  alter table public.assignments drop constraint assignments_notebook_proof;
  execute 'alter table public.assignments add constraint assignments_notebook_proof check (('||substring(d from 8 for length(d)-8)||') or coalesce((source_kind=''notebook'' and provenance_status=''notebook_snapshot_v1'' and range_basis=''units'' and question_bank_version=6 and generator_version=''notebook-bank-v2'' and quiz_content_mode in(''book_meaning_choice'',''canonical_headword_to_definition'',''canonical_definition_to_headword'',''canonical_example_to_headword'') and question_bank_sha256 is not null),false))';
end;
$notebook_hooks$;

-- The caller holds all student locks and validates the whole source/plan first.
-- This helper is also the common save boundary for direct and mixed review.
do $notebook_queue_writer$
declare d text;
begin
  d:=replace(pg_get_functiondef('private.queue_student_vocabulary_targets_v1(uuid,uuid[],jsonb)'::regprocedure),chr(13),'');
  if position('p_targets jsonb)' in d)=0 or position('if not private.is_active_admin() then' in d)=0 then raise exception 'notebook_queue_hook_changed'; end if;
  d:=replace(d,'private.queue_student_vocabulary_targets_v1(','private.queue_notebook_mistake_targets_v2(');
  d:=replace(d,'p_targets jsonb)','p_targets jsonb, p_admin_id uuid)');
  d:=replace(d,'if not private.is_active_admin() then raise exception ''forbidden'' using errcode=''42501''; end if;',
    'perform private.assert_notebook_admin_v1(p_admin_id);');
  d:=replace(d,'reason,auth.uid(),','reason,p_admin_id,');
  execute d;
end;
$notebook_queue_writer$;
revoke all on function private.queue_notebook_mistake_targets_v2(uuid,uuid[],jsonb,uuid) from public,anon,authenticated,service_role;
create function private.insert_mistake_bank_questions_v2(p_assignment_id uuid,p_student_id uuid,p_source jsonb,p_questions jsonb,p_start_order integer)
returns void language plpgsql set search_path='' as $$
declare aid uuid:=p_assignment_id; qid uuid; item jsonb; word jsonb; original public.quiz_questions; original_bank public.assignment_questions;
  origin_identity jsonb; evidence jsonb; reference uuid; source_hash text; entry public.vocab_entries;
  ordinal integer:=p_start_order; quiz_mode text:=p_questions->0->>'quizContentMode'; source_identity record;
begin
  for item in select value from jsonb_array_elements(p_questions) loop
    ordinal:=ordinal+1;qid:=gen_random_uuid();
    select w into word from jsonb_array_elements(p_source->'words') w where w->>'meaningKey'=item->>'meaningKey';
    select * into original from private.quiz_question_contents_v1 where id=(word->>'sourceQuestionId')::uuid;
    select * into original_bank from private.assignment_question_contents_v1 where id=original.assignment_question_id;
    select * into entry from public.vocab_entries where id=original.vocab_entry_id;
    origin_identity:=private.quiz_vocabulary_meaning_v1(original.id);
    reference:=coalesce(original.content_version_id,private.register_quiz_question_content_v1(original,(select assignment_id from public.quiz_attempts where id=original.attempt_id)));
    select content_sha256 into source_hash from private.vocabulary_question_content_versions where id=reference;
    select jsonb_build_object('receiptId',r.quiz_question_id,'phase',r.phase,'episodeId',r.episode_id,'sequence',r.server_sequence)
      into evidence from private.vocabulary_answer_receipts r where r.quiz_question_id=original.id and r.phase=word->>'sourcePhase' and r.outcome<>'correct';
    evidence:=coalesce(evidence,private.vocabulary_legacy_failure_evidence_v1(p_student_id,original.id,word->>'sourcePhase'));
    if evidence is null then raise exception 'notebook_source_question_mismatch' using errcode='23514'; end if;
    insert into private.notebook_question_origins_v2 values(qid,p_student_id,original.id,word->>'sourcePhase',word->>'meaningKey',
      (word->>'episodeId')::uuid,(word->>'stateVersion')::bigint,origin_identity,reference,source_hash,
      case when item->'choiceSources'='[]'::jsonb then 'frozen' else 'generated' end,evidence,(word->>'frozenOnly')::boolean);
    select * into source_identity from private.assignment_question_word_identity_v1 where assignment_question_id=original.assignment_question_id;
    insert into public.assignment_questions(id,assignment_id,vocab_entry_id,base_order_index,direction,prompt,choices,correct_choice_index,dataset_id,
      entry_row_sha256_snapshot,eligibility_quiz_mode,headword_snapshot,headword_normalized_snapshot,primary_meaning_snapshot,choice_vocab_entry_ids,
      correct_answer_snapshot,content_origin,eligibility_rule_version_snapshot,generator_version_snapshot,question_content_sha256,provenance_status,
      canonical_lexeme_id_snapshot,notebook_source_snapshot,notebook_pronunciation_snapshot)
    values(qid,aid,entry.id,ordinal,(item->>'direction')::public.question_direction,item->>'prompt',item->'choices',(item->>'correctChoiceIndex')::smallint,
      entry.dataset_id,original_bank.entry_row_sha256_snapshot,
      case when quiz_mode='book_meaning_choice' then case when item->>'direction'='english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end else quiz_mode end,
      word->>'headword',private.wrong_history_headword_v1(word->>'headword'),word->>'primaryMeaning',
      case when item->'choiceSources'='[]'::jsonb then original_bank.choice_vocab_entry_ids else array(select (c->>'entryId')::bigint from jsonb_array_elements(item->'choiceSources') c) end,
      item->'choices'->>((item->>'correctChoiceIndex')::integer),'book_occurrence','notebook-meaning-v2','notebook-bank-v2',
      upper(encode(extensions.digest(item::text,'sha256'),'hex')),'notebook_snapshot_v1',original_bank.canonical_lexeme_id_snapshot,
      jsonb_build_object('studentId',p_student_id,'sourceQuestionId',original.id,'wordKey',word->>'wordKey','dictionaryId',source_identity.dictionary_id,
        'releaseId',source_identity.release_id,'occurrenceId',source_identity.occurrence_id,'study',word->'studySource'),
      jsonb_build_object('target',item->'pronunciation','choices',item->'choicePronunciations'));
  end loop;
end;
$$;
revoke all on function private.insert_mistake_bank_questions_v2(uuid,uuid,jsonb,jsonb,integer) from public,anon,authenticated,service_role;

create function private.create_notebook_mistake_bank_v2(p_admin_id uuid,p_student_id uuid,p_source jsonb,p_questions jsonb,p_settings jsonb)
returns uuid language plpgsql set search_path='' as $$
declare aid uuid; qid uuid; item jsonb; word jsonb; original public.quiz_questions; original_bank public.assignment_questions;
  origin_identity jsonb; evidence jsonb; reference uuid; source_hash text; entry public.vocab_entries;
  representative uuid; ordinal integer:=0; quiz_mode text:=p_questions->0->>'quizContentMode'; source_identity record;
  selected_targets jsonb; queue_ids uuid[]; changed integer;
begin
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 500
    or (select count(distinct q->>'quizContentMode') from jsonb_array_elements(p_questions) q)<>1
    or (select count(distinct w->>'latestVocabEntryId') from jsonb_array_elements(p_questions) q
      join jsonb_array_elements(p_source->'words') w on w->>'meaningKey'=q->>'meaningKey')<>jsonb_array_length(p_questions)
    then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
  perform private.assert_mistake_practice_plan_v1(p_source,p_settings,p_questions);
  select jsonb_agg(jsonb_build_object('sourceQuestionId',w->>'sourceQuestionId','sourcePhase',w->>'sourcePhase','meaningKey',w->>'meaningKey',
    'episodeId',w->>'episodeId','stateVersion',w->>'stateVersion') order by n) into selected_targets
    from jsonb_array_elements(p_questions) with ordinality selected(q,n)
    join jsonb_array_elements(p_source->'words') w on w->>'meaningKey'=q->>'meaningKey';
  queue_ids:=private.queue_notebook_mistake_targets_v2(p_student_id,array(select (t->>'sourceQuestionId')::uuid from jsonb_array_elements(selected_targets) t),selected_targets,p_admin_id);
  if cardinality(queue_ids)<>jsonb_array_length(p_questions) or exists(select 1 from public.student_vocab_review_queue q
      where q.id=any(queue_ids) and q.reserved_review_draft_id is not null)
    then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  select (w->>'latestDatasetId')::uuid into representative from jsonb_array_elements(p_source->'words') w where w->>'meaningKey'=p_questions->0->>'meaningKey';
  insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,
    retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,timing_mode,question_time_limit_seconds,assignment_purpose,
    retry_enabled,retry_passing_score,source_kind,points_policy_version,provenance_status,quiz_content_mode,generator_version,question_bank_sha256,
    dataset_source_sha256_snapshot,eligibility_rule_version_snapshot)
  values('개인 오답',representative,1,1,jsonb_array_length(p_questions),(p_settings->>'englishToKoreanRatio')::smallint,
    coalesce((p_settings->>'timeLimitSeconds')::integer,10800),(p_settings->>'passingScore')::smallint,'initial',false,'active',p_admin_id,
    'units','random',6,p_settings->>'timingMode',(p_settings->>'questionTimeLimitSeconds')::integer,'review',
    (p_settings->>'retryEnabled')::boolean,(p_settings->>'retryPassingScore')::smallint,'notebook','no-points-v1','notebook_snapshot_v1',quiz_mode,'notebook-bank-v2',
    upper(encode(extensions.digest(p_questions::text,'sha256'),'hex')),(select upper(source_sha256) from public.vocab_datasets where id=representative),'notebook-meaning-v2') returning id into aid;
  insert into public.assignment_students(assignment_id,student_id,assigned_by) values(aid,p_student_id,p_admin_id);
  insert into public.assignment_sources(assignment_id,dataset_id) select distinct aid,(w->>'latestDatasetId')::uuid
    from jsonb_array_elements(p_source->'words') w join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey' on conflict do nothing;
  insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
    select aid,u.dataset_id,u.id,row_number() over(order by u.dataset_id,u.sort_index,u.id)::integer,false from public.vocab_units u where u.id in(
      select e.unit_id from public.vocab_entries e join jsonb_array_elements(p_source->'words') w on e.id=(w->>'latestVocabEntryId')::bigint
      join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey');
  perform private.insert_mistake_bank_questions_v2(aid,p_student_id,p_source,p_questions,0);
  perform private.assert_vocabulary_review_bank_v1(p_student_id,aid,queue_ids);
  update public.student_vocab_review_queue set status='consumed',consumed_assignment_id=aid,consumed_at=clock_timestamp()
    where student_id=p_student_id and id=any(queue_ids) and status='pending' and reserved_review_draft_id is null;
  get diagnostics changed=row_count;
  if changed<>cardinality(queue_ids) then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  return aid;
end;
$$;

create function public.create_notebook_assignments_v2(p_admin_id uuid,p_request_key uuid,p_request_hash text,p_batches jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch jsonb; source jsonb; settings jsonb; item jsonb; bank jsonb; questions jsonb; targets jsonb; sources jsonb:='{}';
  sid uuid; aid uuid; saved private.notebook_assignment_requests; result jsonb:='[]'; count_value integer; ratio integer; selected_entry_ids bigint[]; selected_dataset_ids uuid[]; content_lock bigint;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_request_key is null or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_batches) is distinct from 'array'
    or jsonb_array_length(p_batches) not between 1 and 210 then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  -- Match the receipt-first lock order used by the legacy writer.
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_request_key::text,914));
  select * into saved from private.notebook_assignment_requests where admin_id=p_admin_id and request_key=p_request_key;
  if found then if saved.request_hash is distinct from p_request_hash then raise exception 'notebook_request_conflict' using errcode='40001'; end if;return saved.result;end if;
  if (select count(distinct b->>'studentId') from jsonb_array_elements(p_batches) b)<>jsonb_array_length(p_batches)
    or (select sum(jsonb_array_length(b->'questions')) from jsonb_array_elements(p_batches) b)>10000
    then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  for sid in select (b->>'studentId')::uuid from jsonb_array_elements(p_batches) b order by (b->>'studentId')::uuid loop
    perform private.lock_vocabulary_student_v1(sid);
  end loop;
  select array_agg(distinct id order by id) into selected_entry_ids from(
    select qq.vocab_entry_id id from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
      join public.quiz_questions qq on qq.id=(q->>'sourceQuestionId')::uuid
    union select (c->>'entryId')::bigint from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
      cross join lateral jsonb_array_elements(q->'choiceSources') c
  ) selected;
  -- Equal notebook content necessarily has the same target entry. Acquire all
  -- actual lock keys in order before any bank writes, including other students.
  for content_lock in select distinct hashtextextended('notebook-v2-content-entry:'||e.vocab_entry_id::text,916) key
    from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
    join public.quiz_questions e on e.id=(q->>'sourceQuestionId')::uuid
    join public.quiz_attempts owned on owned.id=e.attempt_id and owned.student_id=(b->>'studentId')::uuid order by key loop
    perform pg_advisory_xact_lock(content_lock);
  end loop;
  select array_agg(distinct dataset_id order by dataset_id) into selected_dataset_ids from public.vocab_entries where id=any(selected_entry_ids);
  perform 1 from public.vocab_datasets where id=any(selected_dataset_ids) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id=any(selected_dataset_ids) order by dataset_id for share;
  perform 1 from public.vocab_entries where id=any(selected_entry_ids) order by id for share;
  perform 1 from public.vocab_entry_quiz_eligibility where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id,quiz_mode for share;
  perform 1 from word_index.app_exam_use_release where dataset_id=any(selected_dataset_ids) order by release_id for share;
  perform 1 from private.vocabulary_compositions where dataset_id=any(selected_dataset_ids) order by version_id for share;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid;
    source:=public.prepare_notebook_assignment_source_v2(p_admin_id,sid,batch->'selection');
    if source->>'sourceHash' is distinct from batch->>'sourceHash' then raise exception 'notebook_source_changed' using errcode='40001'; end if;
    settings:=batch->'settings';count_value:=(settings->>'questionCount')::integer;ratio:=(settings->>'englishToKoreanRatio')::integer;
    if count_value is null or count_value not between 1 and 500 or ratio is null or ratio not in(0,50,100)
      or jsonb_typeof(batch->'questions') is distinct from 'array' or jsonb_array_length(batch->'questions')<>count_value
      or (select count(distinct q->>'meaningKey') from jsonb_array_elements(batch->'questions') q)<>count_value
      or (select count(*) from jsonb_array_elements(batch->'questions') q where q->>'direction'='english_to_korean')<>round(count_value*ratio/100.0)
      or jsonb_typeof(batch->'banks') is distinct from 'array' or jsonb_array_length(batch->'banks') not between 1 and count_value
      then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
    if batch->>'audienceMode' is null or batch->>'audienceMode' not in('single','bulk')
      or jsonb_array_length(p_batches)>1 and batch->>'audienceMode'<>'bulk' then raise exception 'notebook_invalid_audience' using errcode='22023'; end if;
    select jsonb_agg(jsonb_build_object('sourceQuestionId',w->>'sourceQuestionId','sourcePhase',w->>'sourcePhase','meaningKey',w->>'meaningKey',
      'episodeId',w->>'episodeId','stateVersion',w->>'stateVersion')) into targets from jsonb_array_elements(source->'words') w
      join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey';
    perform private.assert_vocabulary_mistake_targets_v1(sid,targets);
    if exists(select 1 from jsonb_array_elements(source->'words') w join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey'
      where w->'assignmentAvailable' is distinct from 'true'::jsonb or not exists(select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=w->>'latestDatasetId' and d->'available'='true'))
      then raise exception 'notebook_target_unavailable' using errcode='22023'; end if;
    if batch->>'audienceMode'='bulk' and coalesce(batch->'gradeConfirmed','false')<>'true'::jsonb and exists(
      select 1 from jsonb_array_elements(source->'datasets') d join jsonb_array_elements(source->'words') w on w->>'latestDatasetId'=d->>'id'
      join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey'
      where private.notebook_grade_v1(d->>'gradeCode')<>private.notebook_grade_v1(source#>>'{student,gradeLabel}'))
      then raise exception 'notebook_grade_review_required' using errcode='22023'; end if;
    if settings->>'timingMode' is null or settings->>'timingMode' not in('none','total','per_question')
      or (settings->>'passingScore')::integer is null or (settings->>'passingScore')::integer not between 0 and 100
      or jsonb_typeof(settings->'retryEnabled') is distinct from 'boolean'
      or (settings->>'retryEnabled')::boolean and ((settings->>'retryPassingScore')::integer is null or (settings->>'retryPassingScore')::integer not between 0 and 100)
      or not(settings->>'retryEnabled')::boolean and settings->>'retryPassingScore' is not null
      or settings->>'timingMode'='total' and ((settings->>'timeLimitSeconds')::integer is null or (settings->>'timeLimitSeconds')::integer not between 30 and 10800 or settings->>'questionTimeLimitSeconds' is not null)
      or settings->>'timingMode'='per_question' and ((settings->>'questionTimeLimitSeconds')::integer is null or (settings->>'questionTimeLimitSeconds')::integer not between 5 and 600 or settings->>'timeLimitSeconds' is not null)
      or settings->>'timingMode'='none' and (settings->>'timeLimitSeconds' is not null or settings->>'questionTimeLimitSeconds' is not null)
      then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
    if (select array_agg((b->>'index')::integer order by (b->>'index')::integer) from jsonb_array_elements(batch->'banks') b)
      is distinct from array(select generate_series(0,jsonb_array_length(batch->'banks')-1))
      or exists(select 1 from jsonb_array_elements(batch->'questions') q where q->>'bankIndex' is null
        or (q->>'bankIndex')::integer not between 0 and jsonb_array_length(batch->'banks')-1)
      then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
    if settings->>'timingMode'='total' and (select sum((b->>'timeLimitSeconds')::integer) from jsonb_array_elements(batch->'banks') b)
      is distinct from (settings->>'timeLimitSeconds')::integer then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
    for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
      select jsonb_agg(q-'bankIndex' order by n) into questions from jsonb_array_elements(batch->'questions') with ordinality a(q,n) where q->>'bankIndex'=bank->>'index';
      if questions is null or jsonb_array_length(questions) is distinct from (bank->>'questionCount')::integer
        or (bank->>'englishToKoreanRatio')::integer is null or (bank->>'englishToKoreanRatio')::integer not in(0,50,100)
        or settings->>'timingMode'='total' and ((bank->>'timeLimitSeconds')::integer is null or (bank->>'timeLimitSeconds')::integer<30)
        or settings->>'timingMode'<>'total' and bank->>'timeLimitSeconds' is not null
        then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
      perform private.assert_mistake_practice_plan_v1(source,settings||jsonb_build_object('questionCount',bank->'questionCount','englishToKoreanRatio',bank->'englishToKoreanRatio'),questions);
    end loop;
    sources:=sources||jsonb_build_object(sid::text,source);
  end loop;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid;source:=sources->sid::text;
    for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
      select jsonb_agg(q-'bankIndex' order by n) into questions from jsonb_array_elements(batch->'questions') with ordinality a(q,n) where q->>'bankIndex'=bank->>'index';
      settings:=(batch->'settings')||jsonb_build_object('questionCount',bank->'questionCount','englishToKoreanRatio',bank->'englishToKoreanRatio','timeLimitSeconds',bank->'timeLimitSeconds');
      aid:=private.create_notebook_mistake_bank_v2(p_admin_id,sid,source,questions,settings);
      result:=result||jsonb_build_array(jsonb_build_object('studentId',sid,'assignmentId',aid,'questionCount',jsonb_array_length(questions)));
    end loop;
  end loop;
  insert into private.notebook_assignment_requests(admin_id,request_key,request_hash,result) values(p_admin_id,p_request_key,p_request_hash,result);
  return result;
end;
$$;
revoke all on function public.create_notebook_assignments_v2(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_notebook_assignments_v2(uuid,uuid,text,jsonb) to service_role;
revoke all on function private.assert_notebook_origin_v2(public.assignment_questions),private.register_notebook_question_content_v2(public.assignment_questions),
  private.notebook_shared_question_payload_v2(private.vocabulary_question_content_versions),private.create_notebook_mistake_bank_v2(uuid,uuid,jsonb,jsonb,jsonb)
  from public,anon,authenticated,service_role;



create function public.prepare_book_mistake_assignment_source_v1(p_admin_id uuid,p_student_id uuid,p_selection jsonb)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; ds uuid; levels integer[];
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_selection->>'mode' is distinct from 'direct' or (p_selection-array['mode','datasetId','reviewLevels'])<>'{}'
    or jsonb_typeof(p_selection->'reviewLevels') is distinct from 'array' then raise exception 'notebook_invalid_selection' using errcode='22023'; end if;
  ds:=(p_selection->>'datasetId')::uuid;
  select array_agg(v::integer order by v::integer) into levels from jsonb_array_elements_text(p_selection->'reviewLevels') v;
  if ds is null or cardinality(levels) not between 1 and 2 or not(levels<@array[1,2]) or cardinality(levels)<>(select count(distinct v) from unnest(levels) v)
    then raise exception 'notebook_invalid_selection' using errcode='22023'; end if;
  result:=public.prepare_notebook_assignment_source_v2(p_admin_id,p_student_id,jsonb_build_object('mode','filtered',
    'filters',jsonb_build_object('datasetId',ds,'level','all','query','','sort','recent','view','current')));
  result:=jsonb_set(result,'{words}',coalesce((select jsonb_agg(w||jsonb_build_object('reasonLevel',case when s.current_wrong_count>=2 then 2 else 1 end) order by u.sort_index,e.source_row,s.meaning_key)
    from jsonb_array_elements(result->'words') with ordinality x(w,n)
    join private.current_vocabulary_meaning_states_v1(p_student_id) s on s.meaning_key=w->>'meaningKey'
    join public.vocab_entries e on e.id=(w->>'latestVocabEntryId')::bigint
    join public.vocab_units u on u.id=e.unit_id
    where w->>'latestDatasetId'=ds::text and w->'assignmentAvailable'='true'::jsonb
      and (case when s.current_wrong_count>=2 then 2 else 1 end)=any(levels)),'[]'));
  return (result-'sourceHash')||jsonb_build_object('sourceHash',private.reviewed_exam_sha256_v1((result-'sourceHash')||p_selection));
end;
$$;
revoke all on function public.prepare_book_mistake_assignment_source_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_book_mistake_assignment_source_v1(uuid,uuid,jsonb) to service_role;


do $book_mistake_header$
declare d text; needle text;
begin
  select pg_get_constraintdef(oid) into d from pg_constraint where conrelid='public.assignments'::regclass and conname='assignments_notebook_proof';
  if d is null then raise exception 'book_mistake_header_missing'; end if;
  alter table public.assignments drop constraint assignments_notebook_proof;
  execute 'alter table public.assignments add constraint assignments_notebook_proof check (('||substring(d from 8 for length(d)-8)||') or coalesce((source_kind=''book'' and points_policy_version=''vocab-points-v1'' and assignment_purpose in(''review'',''mixed'') and provenance_status=''notebook_snapshot_v1'' and range_basis=''units'' and question_bank_version=6 and generator_version=''mistake-book-bank-v1'' and quiz_content_mode in(''book_meaning_choice'',''canonical_headword_to_definition'',''canonical_definition_to_headword'',''canonical_example_to_headword'') and question_bank_sha256 is not null),false))';
  d:=pg_get_functiondef('private.sync_assignment_primary_source_v1()'::regprocedure);
  needle:='old.source_kind=''notebook'' and';
  if strpos(d,needle)=0 then raise exception 'book_mistake_immutable_header_missing'; end if;
  execute replace(d,needle,'(old.source_kind=''notebook'' or old.generator_version=''mistake-book-bank-v1'') and');
  d:=pg_get_functiondef('private.guard_notebook_question_source_v1()'::regprocedure);
  needle:='where id=old.assignment_id and source_kind=''notebook''';
  if strpos(d,needle)=0 then raise exception 'book_mistake_immutable_question_missing'; end if;
  execute replace(d,needle,'where id=old.assignment_id and (source_kind=''notebook'' or generator_version=''mistake-book-bank-v1'')');
end;
$book_mistake_header$;

create function private.create_book_mistake_bank_v1(p_admin_id uuid,p_student_id uuid,p_source jsonb,p_questions jsonb,p_settings jsonb)
returns uuid language plpgsql set search_path='' as $$
declare aid uuid; qid uuid; item jsonb; word jsonb; original public.quiz_questions; original_bank public.assignment_questions;
  origin_identity jsonb; evidence jsonb; reference uuid; source_hash text; entry public.vocab_entries;
  representative uuid; ordinal integer:=0; quiz_mode text:=p_questions->0->>'quizContentMode'; source_identity record;
  selected_targets jsonb; queue_ids uuid[]; changed integer;
begin
  if (select count(distinct w->>'latestDatasetId') from jsonb_array_elements(p_source->'words') w
    join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey')<>1
    or p_settings->>'questionOrderMode' is null or p_settings->>'questionOrderMode' not in('fixed','ascending','descending','random')
    or length(coalesce(p_settings->>'title',''))>160
    or p_settings->>'availableUntil' is not null and (not isfinite((p_settings->>'availableUntil')::timestamptz)
      or (p_settings->>'availableUntil')::timestamptz<=clock_timestamp())
    or p_settings->>'availableFrom' is not null and (not isfinite((p_settings->>'availableFrom')::timestamptz)
      or p_settings->>'availableUntil' is not null and (p_settings->>'availableFrom')::timestamptz>=(p_settings->>'availableUntil')::timestamptz)
    then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
  if jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 500
    or (select count(distinct q->>'quizContentMode') from jsonb_array_elements(p_questions) q)<>1
    or (select count(distinct w->>'latestVocabEntryId') from jsonb_array_elements(p_questions) q
      join jsonb_array_elements(p_source->'words') w on w->>'meaningKey'=q->>'meaningKey')<>jsonb_array_length(p_questions)
    then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
  perform private.assert_mistake_practice_plan_v1(p_source,p_settings,p_questions);
  select jsonb_agg(jsonb_build_object('sourceQuestionId',w->>'sourceQuestionId','sourcePhase',w->>'sourcePhase','meaningKey',w->>'meaningKey',
    'episodeId',w->>'episodeId','stateVersion',w->>'stateVersion') order by n) into selected_targets
    from jsonb_array_elements(p_questions) with ordinality selected(q,n)
    join jsonb_array_elements(p_source->'words') w on w->>'meaningKey'=q->>'meaningKey';
  queue_ids:=private.queue_notebook_mistake_targets_v2(p_student_id,array(select (t->>'sourceQuestionId')::uuid from jsonb_array_elements(selected_targets) t),selected_targets,p_admin_id);
  if cardinality(queue_ids)<>jsonb_array_length(p_questions) or exists(select 1 from public.student_vocab_review_queue q
      where q.id=any(queue_ids) and q.reserved_review_draft_id is not null)
    then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  select (w->>'latestDatasetId')::uuid into representative from jsonb_array_elements(p_source->'words') w where w->>'meaningKey'=p_questions->0->>'meaningKey';
  insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,passing_basis,
    retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,timing_mode,question_time_limit_seconds,assignment_purpose,
    retry_enabled,retry_passing_score,source_kind,points_policy_version,provenance_status,quiz_content_mode,generator_version,question_bank_sha256,
    dataset_source_sha256_snapshot,eligibility_rule_version_snapshot,available_from,available_until)
  values(coalesce(nullif(btrim(p_settings->>'title'),''),'오답 시험'),representative,1,1,jsonb_array_length(p_questions),(p_settings->>'englishToKoreanRatio')::smallint,
    coalesce((p_settings->>'timeLimitSeconds')::integer,10800),(p_settings->>'passingScore')::smallint,'initial',false,'active',p_admin_id,
    'units',(p_settings->>'questionOrderMode')::public.question_order_mode,6,p_settings->>'timingMode',(p_settings->>'questionTimeLimitSeconds')::integer,'review',
    (p_settings->>'retryEnabled')::boolean,(p_settings->>'retryPassingScore')::smallint,'book','vocab-points-v1','notebook_snapshot_v1',quiz_mode,'mistake-book-bank-v1',
    upper(encode(extensions.digest(p_questions::text,'sha256'),'hex')),(select upper(source_sha256) from public.vocab_datasets where id=representative),'notebook-meaning-v2',(p_settings->>'availableFrom')::timestamptz,(p_settings->>'availableUntil')::timestamptz) returning id into aid;
  insert into public.assignment_students(assignment_id,student_id,assigned_by) values(aid,p_student_id,p_admin_id);
  insert into public.assignment_sources(assignment_id,dataset_id) select distinct aid,(w->>'latestDatasetId')::uuid
    from jsonb_array_elements(p_source->'words') w join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey' on conflict do nothing;
  insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
    select aid,u.dataset_id,u.id,row_number() over(order by u.dataset_id,u.sort_index,u.id)::integer,false from public.vocab_units u where u.id in(
      select e.unit_id from public.vocab_entries e join jsonb_array_elements(p_source->'words') w on e.id=(w->>'latestVocabEntryId')::bigint
      join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey');
  perform private.insert_mistake_bank_questions_v2(aid,p_student_id,p_source,p_questions,0);
  perform private.assert_vocabulary_review_bank_v1(p_student_id,aid,queue_ids);
  update public.student_vocab_review_queue set status='consumed',consumed_assignment_id=aid,consumed_at=clock_timestamp()
    where student_id=p_student_id and id=any(queue_ids) and status='pending' and reserved_review_draft_id is null;
  get diagnostics changed=row_count;
  if changed<>cardinality(queue_ids) then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  return aid;
end;
$$;

create function public.create_book_mistake_assignments_v1(p_admin_id uuid,p_request_key uuid,p_request_hash text,p_batches jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch jsonb; source jsonb; settings jsonb; item jsonb; bank jsonb; questions jsonb; targets jsonb; sources jsonb:='{}';
  sid uuid; aid uuid; saved private.notebook_assignment_requests; result jsonb:='[]'; count_value integer; ratio integer; selected_entry_ids bigint[]; selected_dataset_ids uuid[]; content_lock bigint;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_request_key is null or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_batches) is distinct from 'array'
    or jsonb_array_length(p_batches)<>1 then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  -- Match the receipt-first lock order used by the legacy writer.
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_request_key::text,914));
  select * into saved from private.notebook_assignment_requests where admin_id=p_admin_id and request_key=p_request_key;
  if found then if saved.request_hash is distinct from p_request_hash then raise exception 'notebook_request_conflict' using errcode='40001'; end if;return saved.result;end if;
  if (select count(distinct b->>'studentId') from jsonb_array_elements(p_batches) b)<>jsonb_array_length(p_batches)
    or (select sum(jsonb_array_length(b->'questions')) from jsonb_array_elements(p_batches) b)>10000
    then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  for sid in select (b->>'studentId')::uuid from jsonb_array_elements(p_batches) b order by (b->>'studentId')::uuid loop
    perform private.lock_vocabulary_student_v1(sid);
  end loop;
  select array_agg(distinct id order by id) into selected_entry_ids from(
    select qq.vocab_entry_id id from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
      join public.quiz_questions qq on qq.id=(q->>'sourceQuestionId')::uuid
    union select (c->>'entryId')::bigint from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
      cross join lateral jsonb_array_elements(q->'choiceSources') c
  ) selected;
  -- Equal notebook content necessarily has the same target entry. Acquire all
  -- actual lock keys in order before any bank writes, including other students.
  for content_lock in select distinct hashtextextended('notebook-v2-content-entry:'||e.vocab_entry_id::text,916) key
    from jsonb_array_elements(p_batches) b cross join lateral jsonb_array_elements(b->'questions') q
    join public.quiz_questions e on e.id=(q->>'sourceQuestionId')::uuid
    join public.quiz_attempts owned on owned.id=e.attempt_id and owned.student_id=(b->>'studentId')::uuid order by key loop
    perform pg_advisory_xact_lock(content_lock);
  end loop;
  select array_agg(distinct dataset_id order by dataset_id) into selected_dataset_ids from public.vocab_entries where id=any(selected_entry_ids);
  perform 1 from public.vocab_datasets where id=any(selected_dataset_ids) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id=any(selected_dataset_ids) order by dataset_id for share;
  perform 1 from public.vocab_entries where id=any(selected_entry_ids) order by id for share;
  perform 1 from public.vocab_entry_quiz_eligibility where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id,quiz_mode for share;
  perform 1 from word_index.app_exam_use_release where dataset_id=any(selected_dataset_ids) order by release_id for share;
  perform 1 from private.vocabulary_compositions where dataset_id=any(selected_dataset_ids) order by version_id for share;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid;
    source:=public.prepare_book_mistake_assignment_source_v1(p_admin_id,sid,batch->'selection');
    if source->>'sourceHash' is distinct from batch->>'sourceHash' then raise exception 'notebook_source_changed' using errcode='40001'; end if;
    settings:=batch->'settings';count_value:=(settings->>'questionCount')::integer;ratio:=(settings->>'englishToKoreanRatio')::integer;
    if count_value is null or count_value not between 1 and 500 or ratio is null or ratio not in(0,50,100)
      or jsonb_typeof(batch->'questions') is distinct from 'array' or jsonb_array_length(batch->'questions')<>count_value
      or (select count(distinct q->>'meaningKey') from jsonb_array_elements(batch->'questions') q)<>count_value
      or (select count(*) from jsonb_array_elements(batch->'questions') q where q->>'direction'='english_to_korean')<>round(count_value*ratio/100.0)
      or jsonb_typeof(batch->'banks') is distinct from 'array' or jsonb_array_length(batch->'banks') not between 1 and count_value
      then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
    if batch->>'audienceMode' is null or batch->>'audienceMode' not in('single','bulk')
      or jsonb_array_length(p_batches)>1 and batch->>'audienceMode'<>'bulk' then raise exception 'notebook_invalid_audience' using errcode='22023'; end if;
    select jsonb_agg(jsonb_build_object('sourceQuestionId',w->>'sourceQuestionId','sourcePhase',w->>'sourcePhase','meaningKey',w->>'meaningKey',
      'episodeId',w->>'episodeId','stateVersion',w->>'stateVersion')) into targets from jsonb_array_elements(source->'words') w
      join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey';
    perform private.assert_vocabulary_mistake_targets_v1(sid,targets);
    if exists(select 1 from jsonb_array_elements(source->'words') w join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey'
      where w->'assignmentAvailable' is distinct from 'true'::jsonb or not exists(select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=w->>'latestDatasetId' and d->'available'='true'))
      then raise exception 'notebook_target_unavailable' using errcode='22023'; end if;
    if batch->>'audienceMode'='bulk' and coalesce(batch->'gradeConfirmed','false')<>'true'::jsonb and exists(
      select 1 from jsonb_array_elements(source->'datasets') d join jsonb_array_elements(source->'words') w on w->>'latestDatasetId'=d->>'id'
      join jsonb_array_elements(batch->'questions') q on q->>'meaningKey'=w->>'meaningKey'
      where private.notebook_grade_v1(d->>'gradeCode')<>private.notebook_grade_v1(source#>>'{student,gradeLabel}'))
      then raise exception 'notebook_grade_review_required' using errcode='22023'; end if;
    if settings->>'timingMode' is null or settings->>'timingMode' not in('none','total','per_question')
      or (settings->>'passingScore')::integer is null or (settings->>'passingScore')::integer not between 0 and 100
      or jsonb_typeof(settings->'retryEnabled') is distinct from 'boolean'
      or (settings->>'retryEnabled')::boolean and ((settings->>'retryPassingScore')::integer is null or (settings->>'retryPassingScore')::integer not between 0 and 100)
      or not(settings->>'retryEnabled')::boolean and settings->>'retryPassingScore' is not null
      or settings->>'timingMode'='total' and ((settings->>'timeLimitSeconds')::integer is null or (settings->>'timeLimitSeconds')::integer not between 30 and 10800 or settings->>'questionTimeLimitSeconds' is not null)
      or settings->>'timingMode'='per_question' and ((settings->>'questionTimeLimitSeconds')::integer is null or (settings->>'questionTimeLimitSeconds')::integer not between 5 and 600 or settings->>'timeLimitSeconds' is not null)
      or settings->>'timingMode'='none' and (settings->>'timeLimitSeconds' is not null or settings->>'questionTimeLimitSeconds' is not null)
      then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
    if (select array_agg((b->>'index')::integer order by (b->>'index')::integer) from jsonb_array_elements(batch->'banks') b)
      is distinct from array(select generate_series(0,jsonb_array_length(batch->'banks')-1))
      or exists(select 1 from jsonb_array_elements(batch->'questions') q where q->>'bankIndex' is null
        or (q->>'bankIndex')::integer not between 0 and jsonb_array_length(batch->'banks')-1)
      then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
    if settings->>'timingMode'='total' and (select sum((b->>'timeLimitSeconds')::integer) from jsonb_array_elements(batch->'banks') b)
      is distinct from (settings->>'timeLimitSeconds')::integer then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
    for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
      select jsonb_agg(q-'bankIndex' order by n) into questions from jsonb_array_elements(batch->'questions') with ordinality a(q,n) where q->>'bankIndex'=bank->>'index';
      if questions is null or jsonb_array_length(questions) is distinct from (bank->>'questionCount')::integer
        or (bank->>'englishToKoreanRatio')::integer is null or (bank->>'englishToKoreanRatio')::integer not in(0,50,100)
        or settings->>'timingMode'='total' and ((bank->>'timeLimitSeconds')::integer is null or (bank->>'timeLimitSeconds')::integer<30)
        or settings->>'timingMode'<>'total' and bank->>'timeLimitSeconds' is not null
        then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
      perform private.assert_mistake_practice_plan_v1(source,settings||jsonb_build_object('questionCount',bank->'questionCount','englishToKoreanRatio',bank->'englishToKoreanRatio'),questions);
    end loop;
    sources:=sources||jsonb_build_object(sid::text,source);
  end loop;
  for batch in select value from jsonb_array_elements(p_batches) order by value->>'studentId' loop
    sid:=(batch->>'studentId')::uuid;source:=sources->sid::text;
    for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
      select jsonb_agg(q-'bankIndex' order by n) into questions from jsonb_array_elements(batch->'questions') with ordinality a(q,n) where q->>'bankIndex'=bank->>'index';
      settings:=(batch->'settings')||jsonb_build_object('questionCount',bank->'questionCount','englishToKoreanRatio',bank->'englishToKoreanRatio','timeLimitSeconds',bank->'timeLimitSeconds');
      aid:=private.create_book_mistake_bank_v1(p_admin_id,sid,source,questions,settings);
      result:=result||jsonb_build_array(jsonb_build_object('studentId',sid,'assignmentId',aid,'questionCount',jsonb_array_length(questions)));
    end loop;
  end loop;
  insert into private.notebook_assignment_requests(admin_id,request_key,request_hash,result) values(p_admin_id,p_request_key,p_request_hash,result);
  return result;
end;
$$;
revoke all on function private.create_book_mistake_bank_v1(uuid,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.create_book_mistake_assignments_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_book_mistake_assignments_v1(uuid,uuid,text,jsonb) to service_role;


create function public.list_student_direct_mistake_dataset_summaries_v1(p_student_id uuid)
returns table(dataset_id uuid,level_1_count integer,level_2_count integer,total_count integer,latest_wrong_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'student_not_active' using errcode='22023'; end if;
  return query
  with states as materialized(select * from private.current_vocabulary_meaning_states_v1(p_student_id) where unresolved),
  schedule as materialized(select * from private.vocabulary_meaning_scheduling_v1(p_student_id,array(select meaning_key from states))),
  eligible as(
    select distinct s.meaning_key,src.dataset_id,case when s.current_wrong_count>=2 then 2 else 1 end level_value,
      max(src.last_wrong_at) over(partition by src.dataset_id,s.meaning_key) at
    from states s join private.vocabulary_mistake_sources_v1(p_student_id) src using(meaning_key)
    join schedule sch using(meaning_key)
    where sch.scheduling<>'assigned' and sch.review_draft_id is null
      and (exists(select 1 from private.vocabulary_answer_receipts r where r.quiz_question_id=src.source_question_id
        and r.phase=src.source_phase and r.episode_id=s.episode_id and r.meaning_key=s.meaning_key and r.outcome<>'correct')
        or s.episode_id=md5('legacy-v1/'||p_student_id::text||'/'||s.meaning_key)::uuid
          and private.vocabulary_legacy_failure_evidence_v1(p_student_id,src.source_question_id,src.source_phase) is not null)
  )
  select e.dataset_id,count(*) filter(where level_value=1)::integer,count(*) filter(where level_value=2)::integer,count(*)::integer,max(e.at)
    from eligible e group by e.dataset_id order by max(e.at) desc,e.dataset_id;
end;
$$;
revoke all on function public.list_student_direct_mistake_dataset_summaries_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.list_student_direct_mistake_dataset_summaries_v1(uuid) to authenticated;

-- Current cards are an explicitly new contract; legacy counters retain their meaning.
create function private.admin_student_current_mistake_counts_v1(p_student_ids uuid[])
returns table(student_id uuid,word_count integer,repeated_word_count integer)
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query
  select s.id,count(c.word_key)::integer,count(c.word_key) filter(where c.wrong_count>=2)::integer
  from public.students s
  left join lateral(
    select st.word_key,sum(st.current_wrong_count) wrong_count
    from private.current_vocabulary_meaning_states_v1(s.id) st where st.unresolved group by st.word_key
  ) c on true
  where s.id=any(p_student_ids) and s.deleted_at is null group by s.id;
end;
$$;
revoke all on function private.admin_student_current_mistake_counts_v1(uuid[]) from public,anon,authenticated,service_role;
grant execute on function private.admin_student_current_mistake_counts_v1(uuid[]) to authenticated;

do $current_admin_reads$
declare d text; needle text; signature text;
begin
  d:=pg_get_functiondef('private.admin_student_directory_filtered_rows_v1(timestamptz,text,text,text,text,uuid,text,text)'::regprocedure);
  needle:=E'      or (p_wrong = ''retry'' and student.retry_needed)';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'unexpected_current_mistake_directory'; end if;
  execute replace(d,needle,needle||E'\n      or case when p_wrong in (''current_wrong'',''current_repeated'') then exists(\n        select 1 from private.admin_student_current_mistake_counts_v1(array[student.student_id]) current_count\n        where (p_wrong=''current_wrong'' and current_count.word_count>0)\n          or (p_wrong=''current_repeated'' and current_count.repeated_word_count>0)\n      ) else false end');
  foreach signature in array array[
    'public.get_admin_student_directory_initial_v1(text,text,text,text,uuid,text,text,timestamptz,integer)',
    'public.list_admin_student_directory_page_v1(text,text,text,text,uuid,text,text,timestamptz,timestamptz,uuid,integer)',
    'public.list_admin_assignment_directory_selection_v1(text,text,text,text,uuid,text,text,timestamptz)'
  ] loop
    d:=pg_get_functiondef(signature::regprocedure);
    needle:='or p_wrong not in (''all'', ''wrong'', ''repeated'', ''retry'')';
    if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'unexpected_current_mistake_filter:%',signature; end if;
    execute replace(d,needle,'or p_wrong not in (''all'', ''wrong'', ''repeated'', ''retry'', ''current_wrong'', ''current_repeated'')');
  end loop;
  d:=pg_get_functiondef('public.get_admin_student_detail_initial_v2(uuid,timestamptz)'::regprocedure);
  needle:=E'  return jsonb_set(\n    detail,';
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'unexpected_current_mistake_detail'; end if;
  execute replace(d,needle,E'  return jsonb_set(\n    detail || jsonb_build_object(''currentMistakeSummary'',(select jsonb_build_object(\n      ''basis'',''current_meaning_cards_v1'',''wordCount'',c.word_count,''repeatedWordCount'',c.repeated_word_count)\n      from private.admin_student_current_mistake_counts_v1(array[p_student_id]) c)),');
end;
$current_admin_reads$;


-- Mixed review follows the queue's original question and phase. The general
-- notebook filter intentionally chooses the latest source and is not used here.
create function public.prepare_mixed_mistake_source_v1(p_admin_id uuid,p_student_id uuid,p_selection jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare ds uuid; units uuid[]; levels integer[]; student public.students; version_value bigint;
  chosen jsonb; targets jsonb; result jsonb; blocked jsonb;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  select * into student from public.students where id=p_student_id and status='active' and deleted_at is null;
  if not found then raise exception 'notebook_student_unavailable' using errcode='22023'; end if;
  if nullif(btrim(student.display_name),'') is null or nullif(btrim(student.school_name),'') is null or nullif(btrim(student.grade_label),'') is null
    then raise exception 'notebook_student_profile_required' using errcode='22023'; end if;
  if jsonb_typeof(p_selection) is distinct from 'object' or p_selection->>'mode' is distinct from 'mixed'
    or not(p_selection ?& array['mode','datasetId','primaryUnitIds','reviewScope','reviewLevels'])
    or (p_selection-array['mode','datasetId','primaryUnitIds','reviewScope','reviewLevels'])<>'{}'::jsonb
    or p_selection->>'datasetId' is null or p_selection->>'reviewScope' is null or p_selection->>'reviewScope' not in('dataset','selection')
    or jsonb_typeof(p_selection->'primaryUnitIds') is distinct from 'array' or jsonb_array_length(p_selection->'primaryUnitIds') not between 1 and 500
    or jsonb_typeof(p_selection->'reviewLevels') is distinct from 'array' or jsonb_array_length(p_selection->'reviewLevels') not between 1 and 2
    then raise exception 'invalid_mixed_review_selection' using errcode='22023'; end if;
  ds:=(p_selection->>'datasetId')::uuid;
  select array_agg(v::uuid order by n) into units from jsonb_array_elements_text(p_selection->'primaryUnitIds') with ordinality t(v,n);
  select array_agg(v::integer order by v::integer) into levels from jsonb_array_elements_text(p_selection->'reviewLevels') v;
  if ds is null or cardinality(units)<>(select count(distinct u) from unnest(units) u where u is not null)
    or cardinality(levels)<>(select count(distinct l) from unnest(levels) l where l in(1,2))
    or (select count(*) from public.vocab_units where dataset_id=ds and id=any(units))<>cardinality(units)
    then raise exception 'invalid_mixed_review_selection' using errcode='22023'; end if;
  select coalesce((select version from private.student_vocabulary_versions where student_id=p_student_id),0) into version_value;
  with available as materialized(select * from private.available_vocabulary_review_queues_v1(p_student_id)),
  pending as materialized(
    select q.*,i.value->>'meaningKey' meaning_key,(i.value->>'episodeId')::uuid episode_id,i.value->>'sourcePhase' source_phase
    from public.student_vocab_review_queue q cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value)i
    where q.student_id=p_student_id and q.status='pending'
  ), eligible as(
    select q.id,q.meaning_key,q.episode_id,q.source_phase,q.source_question_id,q.source_attempt_id,q.vocab_entry_id,q.dataset_id,q.reason_level,q.queued_at
    from pending q join available a on a.queue_id=q.id and a.meaning_key=q.meaning_key and a.episode_id=q.episode_id
    join public.quiz_questions original on original.id=q.source_question_id and original.attempt_id=q.source_attempt_id and original.vocab_entry_id=q.vocab_entry_id
    join public.quiz_attempts attempt on attempt.id=original.attempt_id and attempt.student_id=p_student_id
    join public.vocab_entries entry on entry.id=original.vocab_entry_id and entry.dataset_id=q.dataset_id
    where q.dataset_id=ds and q.source_phase in('initial','retry')
      and (p_selection->>'reviewScope'='dataset' or entry.unit_id=any(units))
      and private.quiz_vocabulary_meaning_v1(original.id)->>'meaningKey'=q.meaning_key
      and not exists(select 1 from pending other where other.id<>q.id and other.meaning_key=q.meaning_key
        and other.episode_id=q.episode_id and other.reserved_review_draft_id is not null)
      and (exists(select 1 from private.vocabulary_answer_receipts r where r.quiz_question_id=q.source_question_id and r.phase=q.source_phase
        and r.meaning_key=q.meaning_key and r.episode_id=q.episode_id and r.outcome<>'correct')
        or q.episode_id=md5('legacy-v1/'||p_student_id::text||'/'||q.meaning_key)::uuid
          and private.vocabulary_legacy_failure_evidence_v1(p_student_id,q.source_question_id,q.source_phase) is not null)
  ), deduplicated as(
    select distinct on(meaning_key,episode_id) * from eligible order by meaning_key,episode_id,reason_level desc,queued_at,id
  )
  select coalesce(jsonb_agg(jsonb_build_object('queueId',id,'meaningKey',meaning_key,'episodeId',episode_id,
    'sourceQuestionId',source_question_id,'sourceAttemptId',source_attempt_id,'sourcePhase',source_phase,'vocabEntryId',vocab_entry_id,
    'datasetId',dataset_id,'reasonLevel',reason_level,'queuedAt',queued_at) order by reason_level desc,queued_at,id),'[]') into chosen
    from deduplicated where reason_level=any(levels);
  if jsonb_array_length(chosen)>500 then raise exception 'practice_range_too_large' using errcode='22023'; end if;
  if chosen<>'[]'::jsonb then
    select jsonb_agg(jsonb_build_object('sourceQuestionId',q->>'sourceQuestionId','sourcePhase',q->>'sourcePhase','meaningKey',q->>'meaningKey',
      'episodeId',q->'episodeId','stateVersion',version_value::text) order by n) into targets
      from jsonb_array_elements(chosen) with ordinality x(q,n);
    result:=public.prepare_notebook_assignment_source_v2(p_admin_id,p_student_id,jsonb_build_object('mode','mistake_targets','targets',targets));
    result:=jsonb_set(result,'{words}',coalesce((select jsonb_agg(w||jsonb_build_object('queueId',q->'queueId','reasonLevel',q->'reasonLevel','queuedAt',q->'queuedAt') order by n)
      from jsonb_array_elements(chosen) with ordinality selected(q,n) join jsonb_array_elements(result->'words') w
        on w->>'meaningKey'=q->>'meaningKey' and w->'episodeId'=q->'episodeId' and w->>'sourceQuestionId'=q->>'sourceQuestionId'
        and w->>'sourceAttemptId'=q->>'sourceAttemptId' and w->>'sourcePhase'=q->>'sourcePhase'
        and w->>'latestVocabEntryId'=q->>'vocabEntryId' and w->>'latestDatasetId'=q->>'datasetId'
      where w->'assignmentAvailable'='true'::jsonb),'[]'));
  else
    result:=jsonb_build_object('student',jsonb_build_object('id',student.id,'displayName',student.display_name,
      'schoolName',student.school_name,'gradeLabel',student.grade_label),'stateVersion',version_value::text,
      'words','[]'::jsonb,'candidates','[]'::jsonb,'datasets','[]'::jsonb);
  end if;
  with states as materialized(select meaning_key,episode_id from private.current_vocabulary_meaning_states_v1(p_student_id) where unresolved),
  open_meanings as(
    select distinct s.meaning_key from public.student_vocab_review_queue q
    cross join lateral(select private.vocabulary_queue_identity_v1(q.id) value)i
    join states s on s.meaning_key=i.value->>'meaningKey' and s.episode_id=(i.value->>'episodeId')::uuid
    where q.student_id=p_student_id and (q.status='pending' or exists(select 1 from public.assignment_review_targets t
      where t.student_id=p_student_id and t.review_queue_id=q.id and t.released_at is null))
  ) select coalesce(jsonb_agg(meaning_key order by meaning_key),'[]') into blocked from open_meanings;
  result:=(result-'sourceHash')||jsonb_build_object('schemaVersion','mixed-mistake-source-v1','selection',p_selection,
    'blockedPrimaryMeaningKeys',blocked,'queueIds',coalesce((select jsonb_agg(w->'queueId' order by n)
      from jsonb_array_elements(result->'words') with ordinality x(w,n)),'[]'));
  return result||jsonb_build_object('sourceHash',private.reviewed_exam_sha256_v1(result));
end;
$$;
revoke all on function public.prepare_mixed_mistake_source_v1(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.prepare_mixed_mistake_source_v1(uuid,uuid,jsonb) to service_role;

-- Resolve the meaning of a new primary question without creating assignments,
-- content rows, bindings or INSERT markers. Inputs are identifiers, never an AQ.
create function private.preview_new_primary_meanings_v1(p_dataset_id uuid,p_unit_ids uuid[],p_requests jsonb) returns jsonb
language plpgsql volatile set search_path='' as $$
declare req record; entry public.vocab_entries; eligibility public.vocab_entry_quiz_eligibility;
  capability public.vocab_dataset_capabilities; imported word_index.vocab_link_import_run; link word_index.vocab_entry_link;
  release_row word_index.app_exam_use_release; occurrence word_index.app_exam_use_occurrence;
  q public.assignment_questions; m public.assignment_quiz_mode_snapshots; x public.assignment_question_exam_use_snapshot;
  identity_value jsonb; items jsonb:='[]'; raw_proof jsonb; first_raw_proof jsonb; result jsonb; selected_hash text; word_key text;
begin
  if p_dataset_id is null or p_unit_ids is null or cardinality(p_unit_ids)=0
    or cardinality(p_unit_ids)<>(select count(distinct u) from unnest(p_unit_ids) u where u is not null)
    or jsonb_typeof(p_requests) is distinct from 'array' or jsonb_array_length(p_requests) not between 1 and 20000
    then raise exception 'mixed_primary_invalid_selection' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_requests) v where jsonb_typeof(v)<>'object')
    then raise exception 'mixed_primary_invalid_selection' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_requests) v where (v-array['entryId','direction'])<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(v))<>2 or jsonb_typeof(v->'entryId') is distinct from 'number'
    or (v->>'entryId') !~ '^[1-9][0-9]{0,15}$' or v->>'direction' is null or v->>'direction' not in('english_to_korean','korean_to_english'))
    or (select count(distinct (v->>'entryId',v->>'direction')) from jsonb_array_elements(p_requests) v)<>jsonb_array_length(p_requests)
    then raise exception 'mixed_primary_invalid_selection' using errcode='22023'; end if;
  if exists(select 1 from private.vocabulary_compositions where dataset_id=p_dataset_id)
    or exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id)
    then raise exception 'mixed_primary_source_unsupported' using errcode='0A000'; end if;
  perform 1 from public.vocab_datasets where id=p_dataset_id and status='ready' and is_active for share;
  if not found then raise exception 'dataset_not_ready' using errcode='22023'; end if;
  perform 1 from public.vocab_units where dataset_id=p_dataset_id and id=any(p_unit_ids) order by id for share;
  if (select count(*) from public.vocab_units where dataset_id=p_dataset_id and id=any(p_unit_ids))<>cardinality(p_unit_ids)
    then raise exception 'mixed_primary_scope_changed' using errcode='40001'; end if;
  select * into release_row from word_index.app_exam_use_release where dataset_id=p_dataset_id and status='active' for share;
  if not found then
    if exists(select 1 from word_index.app_exam_use_release where dataset_id=p_dataset_id)
      then raise exception 'exam_use_release_inactive' using errcode='55000'; end if;
  else
    if release_row.target_environment is distinct from 'preview' or release_row.exam_use_import_allowed is distinct from true
      or release_row.common_dictionary_release_allowed is distinct from false
      then raise exception 'active_exam_use_release_not_found' using errcode='55000'; end if;
    if not exists(select 1 from public.vocab_datasets d where d.id=p_dataset_id and d.dataset_key=release_row.dataset_key
      and d.metadata->>'projectionProfile'='exam_scope_candidate_v1' and d.metadata->>'packageVersion'=release_row.package_version)
      then raise exception 'exam_use_dataset_snapshot_mismatch' using errcode='55000'; end if;
  end if;
  for req in select (v->>'entryId')::bigint entry_id,(v->>'direction')::public.question_direction direction
    from jsonb_array_elements(p_requests) v order by (v->>'entryId')::bigint,v->>'direction' loop
    q:=null;m:=null;x:=null;
    select * into entry from public.vocab_entries where id=req.entry_id and dataset_id=p_dataset_id and unit_id=any(p_unit_ids) for share;
    if not found then raise exception 'question_not_eligible_for_direction' using errcode='22023'; end if;
    q:=jsonb_populate_record(null::public.assignment_questions,jsonb_build_object('dataset_id',entry.dataset_id,'vocab_entry_id',entry.id,
      'direction',req.direction,'prompt',case req.direction when 'english_to_korean' then entry.headword else entry.primary_meaning end,
      'choices',jsonb_build_array(case req.direction when 'english_to_korean' then entry.primary_meaning else entry.headword end),'correct_choice_index',0,
      'entry_row_sha256_snapshot',entry.row_sha256,'headword_snapshot',entry.headword,'headword_normalized_snapshot',entry.headword_normalized,
      'primary_meaning_snapshot',entry.primary_meaning,'content_origin','book_occurrence',
      'eligibility_quiz_mode',case req.direction when 'english_to_korean' then 'book_meaning_en_to_ko' else 'book_meaning_ko_to_en' end));
    if release_row.release_id is null then
      select * into capability from public.vocab_dataset_capabilities where dataset_id=p_dataset_id and quiz_mode=q.eligibility_quiz_mode
        and status in('ready','limited') for share;
      if not found then raise exception 'question_not_eligible_for_direction' using errcode='22023'; end if;
      raw_proof:=jsonb_build_array(capability.dataset_source_sha256,capability.canonical_snapshot_sha256,
        capability.rule_version,capability.details->>'packageSnapshotSha256');
      if first_raw_proof is null then first_raw_proof:=raw_proof;
      elsif first_raw_proof is distinct from raw_proof then raise exception 'capability_snapshot_mismatch' using errcode='22023'; end if;
      if capability.dataset_source_sha256 is distinct from (select source_sha256 from public.vocab_datasets where id=p_dataset_id)
        or coalesce(capability.canonical_snapshot_sha256,'') !~ '^[0-9A-F]{64}$'
        or coalesce(capability.details->>'packageSnapshotSha256','') !~ '^[0-9A-F]{64}$'
        then raise exception 'capability_snapshot_mismatch' using errcode='22023'; end if;
      select * into imported from word_index.vocab_link_import_run where dataset_id=p_dataset_id and status='complete'
        and package_snapshot_sha256=capability.details->>'packageSnapshotSha256' for share;
      if not found or imported.source_payload_sha256 is null or imported.capabilities_payload_sha256 is null
        then raise exception 'capability_snapshot_mismatch' using errcode='22023'; end if;
      perform 1 from word_index.dataset_source ds join word_index.index_build ib on ib.build_id=ds.build_id
        where ds.dataset_id=p_dataset_id and ds.source_id=imported.source_id and ds.build_id=imported.build_id
          and ds.dataset_source_sha256=capability.dataset_source_sha256 and ib.status='complete'
          and lower(ib.input_snapshot_sha256)=lower(capability.canonical_snapshot_sha256) for share of ds,ib;
      if not found then raise exception 'capability_snapshot_mismatch' using errcode='22023'; end if;
      select * into link from word_index.vocab_entry_link where vocab_entry_id=entry.id and dataset_id=p_dataset_id
        and source_id=imported.source_id and entry_row_sha256=entry.row_sha256 for share;
      if not found then raise exception 'question_not_eligible_for_direction' using errcode='22023'; end if;
      select * into eligibility from public.vocab_entry_quiz_eligibility where vocab_entry_id=entry.id and dataset_id=p_dataset_id
        and quiz_mode=q.eligibility_quiz_mode and private.quiz_eligibility_runtime_allowed_v1(status,reason_codes)
        and input_content_hash=entry.row_sha256 and rule_version=capability.rule_version
        and canonical_lexeme_id is not distinct from link.lexeme_id
        and lower(canonical_content_hash) is not distinct from lower(link.canonical_content_hash) for share;
      if not found then raise exception 'question_not_eligible_for_direction' using errcode='22023'; end if;
      q:=jsonb_populate_record(q,jsonb_build_object('eligibility_input_hash_snapshot',eligibility.input_content_hash,
        'canonical_lexeme_id_snapshot',eligibility.canonical_lexeme_id,'canonical_content_hash_snapshot',eligibility.canonical_content_hash,
        'content_review_id_snapshot',eligibility.content_review_id,'eligibility_rule_version_snapshot',eligibility.rule_version,
        'generator_version_snapshot','book-choice-cache-v2','provenance_status','verified_v2',
        'provenance',jsonb_build_object('datasetSourceSha256',capability.dataset_source_sha256,'canonicalSnapshotSha256',capability.canonical_snapshot_sha256,
          'linkPackageSnapshotSha256',capability.details->>'packageSnapshotSha256','sourcePayloadSha256',imported.source_payload_sha256,
          'capabilitiesPayloadSha256',imported.capabilities_payload_sha256,'mappingStatus',link.mapping_status,
          'sourceRow',entry.source_row,'unitId',entry.unit_id,'eligibilityStatus',eligibility.status)));
      m:=jsonb_populate_record(null::public.assignment_quiz_mode_snapshots,jsonb_build_object('dataset_id',p_dataset_id,'quiz_mode',capability.quiz_mode,
        'capability_status',capability.status,'eligible_entry_count',capability.eligible_entry_count,'excluded_entry_count',capability.excluded_entry_count,
        'dataset_source_sha256',capability.dataset_source_sha256,'canonical_snapshot_sha256',capability.canonical_snapshot_sha256,
        'link_package_snapshot_sha256',capability.details->>'packageSnapshotSha256','source_id',imported.source_id,'build_id',imported.build_id,
        'source_payload_sha256',imported.source_payload_sha256,'capabilities_payload_sha256',imported.capabilities_payload_sha256,
        'eligibility_rule_version',capability.rule_version,'capability_evaluated_at_utc',capability.evaluated_at_utc));
    else
      select * into occurrence from word_index.app_exam_use_occurrence where release_id=release_row.release_id and dataset_id=p_dataset_id
        and vocab_entry_id=entry.id and unit_id=any(p_unit_ids) and include_in_exam and exam_use_status='reviewed_for_preview'
        and source_projection_row_sha256 is not null for share;
      if not found then raise exception 'exam_use_question_not_eligible_for_direction' using errcode='22023'; end if;
      q:=jsonb_populate_record(q,jsonb_build_object('eligibility_input_hash_snapshot',upper(occurrence.source_projection_row_sha256),
        'canonical_content_hash_snapshot',upper(occurrence.package_entry_content_hash),'eligibility_rule_version_snapshot','exam-use-preview-v1',
        'generator_version_snapshot','dictionary-exam-use-v1','provenance_status','legacy_backfill',
        'provenance',jsonb_build_object('projectionProfile','exam_scope_candidate_v1','releaseId',release_row.release_id,'packageVersion',release_row.package_version,
          'candidateDictionaryVersion',release_row.candidate_dictionary_version,'manifestContentHash',release_row.manifest_content_hash,
          'examReviewLedgerSha256',release_row.exam_review_ledger_sha256,'dictionaryId',occurrence.dictionary_id,'occurrenceId',occurrence.occurrence_id,
          'sourceRow',occurrence.source_row,'unitId',occurrence.unit_id,'sidecar','assignment_question_exam_use_snapshot')));
      x:=jsonb_populate_record(null::public.assignment_question_exam_use_snapshot,jsonb_build_object('dataset_id',p_dataset_id,'vocab_entry_id',entry.id,
        'release_id',release_row.release_id,'dictionary_id',occurrence.dictionary_id,'occurrence_id',occurrence.occurrence_id,'sense_id',occurrence.sense_id,
        'exam_review_id',occurrence.exam_review_id,'headword_snapshot',occurrence.display_headword,'primary_meaning_snapshot',occurrence.display_gloss_ko,
        'occurrence_content_hash',upper(occurrence.occurrence_content_hash),'provenance_status','reviewed_for_preview_v1'));
    end if;
    selected_hash:=private.reviewed_exam_sha256_v1(to_jsonb(entry.primary_meaning));
    word_key:=case when nullif(x.dictionary_id,'') is not null then 'dictionary:'||x.dictionary_id
      when q.canonical_lexeme_id_snapshot is not null then 'canonical:'||q.canonical_lexeme_id_snapshot::text
      else 'headword:'||private.wrong_history_headword_v1(entry.headword) end;
    identity_value:=private.new_assignment_vocabulary_identity_v1(q,m,x,jsonb_build_object('wordKey',word_key,
      'meaningKey',private.frozen_vocabulary_meaning_key_v1('legacy_vocab',p_dataset_id,entry.id,null,entry.row_sha256,'primary_meaning',selected_hash),
      'identityKind','source-occurrence-v1','testedField','primary_meaning','selectedHash',selected_hash));
    items:=items||jsonb_build_array(jsonb_build_object('entryId',entry.id,'direction',req.direction,'wordKey',identity_value->'wordKey',
      'meaningKey',identity_value->'meaningKey','identityKind',identity_value->'identityKind','identity',identity_value,
      'meaningProofHash',private.reviewed_exam_sha256_v1(jsonb_build_array(identity_value,entry.row_sha256,q.provenance,
        q.eligibility_input_hash_snapshot,q.eligibility_rule_version_snapshot,q.canonical_lexeme_id_snapshot,
        q.canonical_content_hash_snapshot,q.content_review_id_snapshot,to_jsonb(m),to_jsonb(x)))));
  end loop;
  result:=jsonb_build_object('schemaVersion','mixed-primary-meanings-v1','datasetId',p_dataset_id,
    'sourceKind',case when release_row.release_id is null then 'raw-v2' else 'exam-use' end,'unitIds',p_unit_ids,'items',items);
  return result||jsonb_build_object('sourceHash',private.reviewed_exam_sha256_v1(result));
end;
$$;
revoke all on function private.preview_new_primary_meanings_v1(uuid,uuid[],jsonb) from public,anon,authenticated,service_role;

create function public.preview_mixed_primary_meanings_v1(p_admin_id uuid,p_dataset_id uuid,p_unit_ids uuid[],p_requests jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  return private.preview_new_primary_meanings_v1(p_dataset_id,p_unit_ids,p_requests);
end;
$$;
revoke all on function public.preview_mixed_primary_meanings_v1(uuid,uuid,uuid[],jsonb) from public,anon,authenticated;
grant execute on function public.preview_mixed_primary_meanings_v1(uuid,uuid,uuid[],jsonb) to service_role;

-- Shared insert boundary for the primary part of a mixed bank. A split bank
-- may have 1..3 questions; the complete mixed request still requires >=4.
create function private.assert_empty_mixed_primary_parent_v1(p_assignment_id uuid,p_admin_id uuid,p_dataset_id uuid,
  p_student_ids uuid[],p_question_count integer,p_expected_english_count integer) returns void
language plpgsql set search_path='' as $$
declare a public.assignments;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_student_ids is null or cardinality(p_student_ids)<>1 or p_student_ids[1] is null
    or p_question_count is null or p_question_count not between 1 and 500
    or p_expected_english_count is null or p_expected_english_count not between 0 and p_question_count
    then raise exception 'mixed_primary_invalid_settings' using errcode='22023'; end if;
  perform 1 from public.students where id=p_student_ids[1] and status='active' and deleted_at is null for update;
  if not found then raise exception 'student_not_active' using errcode='22023'; end if;
  select * into a from public.assignments where id=p_assignment_id for update;
  if not found or a.created_by is distinct from p_admin_id or a.dataset_id is distinct from p_dataset_id
    or a.status::text is distinct from 'draft' or a.deleted_at is not null or a.assignment_purpose is distinct from 'mixed'
    or a.source_kind is distinct from 'book' or a.points_policy_version is distinct from 'vocab-points-v1'
    or a.quiz_content_mode is distinct from 'book_meaning_choice' or a.question_count<p_question_count
    or a.question_count not between 1 and 500 or a.question_bank_sha256 is not null or a.generator_version='mistake-book-bank-v1'
    then raise exception 'mixed_primary_parent_invalid' using errcode='55000'; end if;
  perform 1 from public.assignment_students where assignment_id=p_assignment_id for update;
  if (select count(*) from public.assignment_students where assignment_id=p_assignment_id)<>1
    or not exists(select 1 from public.assignment_students where assignment_id=p_assignment_id and student_id=p_student_ids[1]
      and assigned_by=p_admin_id and cancelled_at is null and missed_at is null)
    or exists(select 1 from public.quiz_attempts where assignment_id=p_assignment_id)
    or exists(select 1 from public.assignment_questions where assignment_id=p_assignment_id)
    or exists(select 1 from public.assignment_quiz_mode_snapshots where assignment_id=p_assignment_id)
    or exists(select 1 from public.assignment_question_exam_use_snapshot where assignment_id=p_assignment_id)
    or exists(select 1 from word_index.assignment_exam_use_release_snapshot where assignment_id=p_assignment_id)
    or not exists(select 1 from public.assignment_sources where assignment_id=p_assignment_id and dataset_id=p_dataset_id)
    or exists(select 1 from public.assignment_sources where assignment_id=p_assignment_id and dataset_id<>p_dataset_id)
    then raise exception 'mixed_primary_parent_not_empty' using errcode='55000'; end if;
end;
$$;
revoke all on function private.assert_empty_mixed_primary_parent_v1(uuid,uuid,uuid,uuid[],integer,integer)
  from public,anon,authenticated,service_role;

-- Clone final validators instead of restoring an obsolete SQL definition.
-- Guard every edit; original public creators and their ACLs remain untouched.
do $mixed_primary_clones$
declare job record; edit record; source_oid regprocedure; definition text; body text; args text; new_oid regprocedure;
  start_at integer; finish_at integer; replacement_tail text;
  auth_block constant text:=$anchor$  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;$anchor$;
  count_block constant text:=$anchor$  expected_english_count := round(
    p_question_count
      * (p_english_to_korean_ratio::numeric / 100)
  );$anchor$;
  terminal constant text:=E'  return created_assignment_id;\nend;\n';
begin
  for job in select * from (values
    ('base','private.create_assignment_with_question_bank(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)',
      'insert_mixed_primary_base_v1','uuid',E'  update public.assignments\n  set status = ''active'''),
    ('raw','private.create_assignment_with_question_bank_v2(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,uuid[],jsonb)',
      'insert_mixed_primary_raw_v1','jsonb',E'  update public.assignments\n  set quiz_content_mode = ''book_meaning_choice'''),
    ('exam','private.create_assignment_with_exam_use_question_bank_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)',
      'insert_mixed_primary_exam_use_v1','jsonb',E'  update public.assignments\n  set dataset_source_sha256_snapshot = upper(dataset_row.source_sha256)')
  ) v(kind,signature,new_name,return_type,tail_anchor) loop
    source_oid:=job.signature::regprocedure;definition:=replace(pg_get_functiondef(source_oid),chr(13),'');
    if (length(definition)-length(replace(definition,'$function$','')))/length('$function$')<>2
      then raise exception 'mixed_clone_body_shape_changed:%',job.signature; end if;
    body:=split_part(definition,'$function$',2);
    for edit in select * from (values
      (auth_block,$replacement$  perform private.assert_empty_mixed_primary_parent_v1(
    p_assignment_id,p_admin_id,p_dataset_id,p_student_ids,p_question_count,p_expected_english_count
  );$replacement$),
      (count_block,'  expected_english_count := p_expected_english_count;')
    ) edits(needle,replacement) loop
      if (length(body)-length(replace(body,edit.needle,'')))/length(edit.needle)<>1
        then raise exception 'mixed_clone_anchor_changed:%:%',job.signature,left(edit.needle,70); end if;
      body:=replace(body,edit.needle,edit.replacement);
    end loop;
    if job.kind='base' then
      for edit in select needle from (values('  insert into public.assignments ('),('  insert into public.assignment_units ('),
        ('  insert into public.assignment_students ('),('  insert into public.assignment_questions (')) anchors(needle) loop
        if (length(body)-length(replace(body,edit.needle,'')))/length(edit.needle)<>1
          then raise exception 'mixed_base_insert_anchor_changed:%',edit.needle; end if;
      end loop;
      start_at:=strpos(body,'  insert into public.assignments (');finish_at:=strpos(body,'  insert into public.assignment_questions (');
      if finish_at<=start_at then raise exception 'mixed_base_insert_order_changed'; end if;
      body:=left(body,start_at-1)||E'  created_assignment_id := p_assignment_id;\n\n'||substr(body,finish_at);
      replacement_tail:=terminal;
    else
      if (length(body)-length(replace(body,'private.create_assignment_with_question_bank(','')))/length('private.create_assignment_with_question_bank(')<>1
        then raise exception 'mixed_clone_base_call_changed:%',job.signature; end if;
      body:=replace(body,'private.create_assignment_with_question_bank(',E'private.insert_mixed_primary_base_v1(\n      p_assignment_id,p_admin_id,p_expected_english_count,');
      if job.kind='raw' then
        replacement_tail:=$replacement$  return jsonb_build_object('sourceKind','raw-v2','assignmentId',created_assignment_id,
    'headerProof',jsonb_build_object('quizContentMode','book_meaning_choice','datasetSourceSha256',selected_source_sha256,
      'canonicalSnapshotSha256',selected_canonical_sha256,'linkPackageSnapshotSha256',selected_package_sha256,
      'eligibilityRuleVersion',selected_rule_version,'generatorVersion','book-choice-cache-v2',
      'questionBankSha256',calculated_bank_sha256,'questionBankVersion',2,'provenanceStatus','verified_v2'));
end;
$replacement$;
      else
        if (length(body)-length(replace(body,'p_question_count not between 4 and 500','')))/length('p_question_count not between 4 and 500')<>1
          then raise exception 'mixed_exam_count_guard_changed'; end if;
        body:=replace(body,'p_question_count not between 4 and 500','p_question_count not between 1 and 500');
        replacement_tail:=$replacement$  if p_available_until is not null and p_available_until<=clock_timestamp()
    then raise exception 'assignment_deadline_elapsed_during_creation' using errcode='22023'; end if;
  return jsonb_build_object('sourceKind','exam-use','assignmentId',created_assignment_id,'releaseId',p_release_id,
    'headerProof',jsonb_build_object('datasetSourceSha256',upper(dataset_row.source_sha256),
      'canonicalSnapshotSha256',upper(release_row.candidate_dictionary_version),'linkPackageSnapshotSha256',upper(release_row.package_version),
      'eligibilityRuleVersion','exam-use-preview-v1','generatorVersion','dictionary-exam-use-v1','questionBankSha256',calculated_bank_sha256));
end;
$replacement$;
      end if;
    end if;
    if (length(body)-length(replace(body,job.tail_anchor,'')))/length(job.tail_anchor)<>1
      or right(body,length(terminal))<>terminal
      or (length(body)-length(replace(body,'  insert into public.audit_events (','')))/length('  insert into public.audit_events (')<>1
      then raise exception 'mixed_clone_tail_changed:%',job.signature; end if;
    body:=left(body,strpos(body,job.tail_anchor)-1)||replacement_tail;
    if body ~* '(insert[[:space:]]+into|update|delete[[:space:]]+from)[[:space:]]+public[.](assignments|assignment_students|assignment_units|audit_events)([[:space:]]|[(])'
      or strpos(body,'auth.uid()')>0 or strpos(body,'private.create_assignment_with_')>0
      then raise exception 'mixed_clone_forbidden_effect_remaining:%',job.signature; end if;
    args:=replace(pg_get_function_arguments(source_oid),'p_question_order_mode question_order_mode','p_question_order_mode public.question_order_mode');
    execute format('create function private.%I(p_assignment_id uuid,p_admin_id uuid,p_expected_english_count integer,%s) returns %s language plpgsql set search_path='''' as %L',
      job.new_name,args,job.return_type,body);
    select p.oid::regprocedure into strict new_oid from pg_proc p where p.pronamespace='private'::regnamespace and p.proname=job.new_name;
    execute format('revoke all on function %s from public,anon,authenticated,service_role',new_oid);
  end loop;
end;
$mixed_primary_clones$;

create function private.insert_mixed_primary_questions_v1(p_assignment_id uuid,p_admin_id uuid,p_student_id uuid,
  p_primary_unit_ids uuid[],p_scope_unit_ids uuid[],p_question_count integer,p_expected_english_count integer,p_questions jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare a public.assignments; proof jsonb; result jsonb; active_release_id uuid; parent_before jsonb;
  selected_entry_ids bigint[]; content_lock bigint;
begin
  select * into a from public.assignments where id=p_assignment_id;
  perform private.assert_empty_mixed_primary_parent_v1(p_assignment_id,p_admin_id,a.dataset_id,array[p_student_id],p_question_count,p_expected_english_count);
  select * into a from public.assignments where id=p_assignment_id;parent_before:=to_jsonb(a);
  if p_questions is null or jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)<>p_question_count
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q)<>'object')
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q
    where (q-array['vocab_entry_id','base_order_index','direction','choice_vocab_entry_ids'])<>'{}'::jsonb
      or (select count(*) from jsonb_object_keys(q))<>4)
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023'; end if;
  if exists(select 1 from private.vocabulary_compositions where dataset_id=a.dataset_id)
    or exists(select 1 from private.reviewed_exam_releases where dataset_id=a.dataset_id)
    then raise exception 'mixed_primary_source_unsupported' using errcode='0A000'; end if;
  if p_primary_unit_ids is null or cardinality(p_primary_unit_ids)=0 or p_scope_unit_ids is null or cardinality(p_scope_unit_ids)=0
    or cardinality(p_primary_unit_ids)<>(select count(distinct u) from unnest(p_primary_unit_ids) u where u is not null)
    or cardinality(p_scope_unit_ids)<>(select count(distinct u) from unnest(p_scope_unit_ids) u where u is not null)
    or not p_primary_unit_ids<@p_scope_unit_ids
    or (select array_agg(unit_id order by position) from public.assignment_units where assignment_id=a.id) is distinct from p_scope_unit_ids
    or exists(select 1 from public.assignment_units where assignment_id=a.id
      and (dataset_id<>a.dataset_id or is_primary is distinct from (unit_id=any(p_primary_unit_ids))))
    then raise exception 'mixed_primary_scope_changed' using errcode='40001'; end if;
  select array_agg(distinct entry_id order by entry_id) into selected_entry_ids from (
    select q.vocab_entry_id entry_id from jsonb_to_recordset(p_questions) q(vocab_entry_id bigint)
    union select c from jsonb_to_recordset(p_questions) q(choice_vocab_entry_ids bigint[]) cross join lateral unnest(q.choice_vocab_entry_ids) c
  ) selected;
  for content_lock in select distinct hashtextextended('notebook-v2-content-entry:'||q.vocab_entry_id::text,916) key
    from jsonb_to_recordset(p_questions) q(vocab_entry_id bigint) order by key loop
    perform pg_advisory_xact_lock(content_lock);
  end loop;
  -- All text, eligibility and source proof used below stays fixed through the
  -- final frozen reference, including distractors rather than only targets.
  perform 1 from public.vocab_datasets where id=a.dataset_id for share;
  perform 1 from public.vocab_units where id=any(p_scope_unit_ids) order by id for share;
  perform 1 from public.vocab_entries where id=any(selected_entry_ids) order by id for share;
  perform 1 from public.vocab_entry_quiz_eligibility where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id,quiz_mode for share;
  perform 1 from word_index.vocab_entry_link where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id for share;
  perform 1 from word_index.dataset_source where dataset_id=a.dataset_id order by source_id,build_id for share;
  perform 1 from word_index.index_build where build_id in(select build_id from word_index.dataset_source where dataset_id=a.dataset_id) order by build_id for share;
  perform 1 from word_index.app_exam_use_release where dataset_id=a.dataset_id order by release_id for share;
  perform 1 from word_index.app_exam_use_occurrence where dataset_id=a.dataset_id and vocab_entry_id=any(selected_entry_ids) order by release_id,vocab_entry_id for share;
  if exists(select 1 from jsonb_to_recordset(p_questions) q(vocab_entry_id bigint) left join public.vocab_entries e on e.id=q.vocab_entry_id
    where e.id is null or e.dataset_id<>a.dataset_id or e.unit_id<>all(p_primary_unit_ids))
    then raise exception 'mixed_primary_target_outside_range' using errcode='22023'; end if;
  if a.available_until is not null and a.available_until<=clock_timestamp()
    then raise exception 'assignment_deadline_must_be_future' using errcode='22023'; end if;
  perform private.assert_assignment_target_prompts_unambiguous_v1(a.dataset_id,p_questions);
  select release_id into active_release_id from word_index.app_exam_use_release where dataset_id=a.dataset_id and status='active' for share;
  if active_release_id is null then
    if exists(select 1 from word_index.app_exam_use_release where dataset_id=a.dataset_id)
      then raise exception 'exam_use_release_inactive' using errcode='55000'; end if;
    proof:=private.insert_mixed_primary_raw_v1(a.id,p_admin_id,p_expected_english_count,a.title,a.dataset_id,p_scope_unit_ids,p_question_count,
      a.english_to_korean_ratio,a.time_limit_seconds,a.passing_score,a.question_order_mode,array[p_student_id],p_questions);
  else
    proof:=private.insert_mixed_primary_exam_use_v1(a.id,p_admin_id,p_expected_english_count,active_release_id,a.title,a.dataset_id,p_scope_unit_ids,p_question_count,
      a.english_to_korean_ratio,a.time_limit_seconds,a.passing_score,a.question_order_mode,a.available_until,array[p_student_id],p_questions);
  end if;
  perform private.finalize_assignment_question_body_refs_v1(a.id);
  if a.available_until is not null and a.available_until<=clock_timestamp()
    then raise exception 'assignment_deadline_elapsed_during_creation' using errcode='22023'; end if;
  if parent_before is distinct from (select to_jsonb(x) from public.assignments x where x.id=a.id)
    then raise exception 'mixed_primary_modified_parent' using errcode='55000'; end if;
  if (select count(*) from public.assignment_questions where assignment_id=a.id)<>p_question_count
    or exists(select 1 from public.assignment_questions q left join private.assignment_vocabulary_meaning_refs r
      on r.assignment_question_id=q.id and r.content_version_id=q.content_version_id where q.assignment_id=a.id
      and (q.content_version_id is null or r.assignment_question_id is null))
    then raise exception 'mixed_primary_freeze_incomplete' using errcode='55000'; end if;
  select jsonb_agg(jsonb_build_object('assignmentQuestionId',q.id,'vocabEntryId',q.vocab_entry_id,'baseOrderIndex',q.base_order_index,
    'direction',q.direction,'questionContentSha256',q.question_content_sha256,'contentVersionId',q.content_version_id,
    'meaningKey',m.identity->>'meaningKey','wordKey',m.identity->>'wordKey') order by q.base_order_index) into result
    from public.assignment_questions q join private.assignment_vocabulary_meaning_refs r on r.assignment_question_id=q.id
    join private.vocabulary_question_meaning_versions m on m.content_version_id=r.content_version_id and m.context_hash=r.context_hash where q.assignment_id=a.id;
  return proof||jsonb_build_object('parentMode',a.quiz_content_mode,'parentQuestionBankVersion',a.question_bank_version,
    'parentProvenanceStatus',a.provenance_status,'questionCount',p_question_count,'englishCount',p_expected_english_count,'questions',result);
end;
$$;
revoke all on function private.insert_mixed_primary_questions_v1(uuid,uuid,uuid,uuid[],uuid[],integer,integer,jsonb)
  from public,anon,authenticated,service_role;

create function private.assert_mixed_review_questions_v1(p_source jsonb,p_settings jsonb,p_questions jsonb,p_expected_english_count integer)
returns void language plpgsql stable set search_path='' as $$
declare n integer;e integer;d text;part jsonb;
begin
  if jsonb_typeof(p_questions) is distinct from 'array' then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  n:=jsonb_array_length(p_questions);
  if n>500 or p_expected_english_count is null or p_expected_english_count not between 0 and n
    then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  if n=0 then return;end if;
  if jsonb_typeof(p_source->'words') is distinct from 'array' or jsonb_typeof(p_settings) is distinct from 'object'
    or exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q) is distinct from 'object'
      or q->>'meaningKey' is null or q->>'direction' is null or q->>'direction' not in('english_to_korean','korean_to_english')
      or q ? 'queueId' or q ? 'bankIndex') then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  select count(*) filter(where q->>'direction'='english_to_korean') into e from jsonb_array_elements(p_questions) q;
  if e<>p_expected_english_count or (select count(distinct q->>'meaningKey') from jsonb_array_elements(p_questions) q)<>n
    then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  -- Partial primary/review quotas need not independently round to 0/50/100.
  -- All existing body/origin/audio checks are reused per exact direction.
  foreach d in array array['english_to_korean','korean_to_english'] loop
    select coalesce(jsonb_agg(q order by ord),'[]') into part from jsonb_array_elements(p_questions) with ordinality x(q,ord) where q->>'direction'=d;
    if jsonb_array_length(part)>0 then
      perform private.assert_mistake_practice_plan_v1(p_source,p_settings||jsonb_build_object('questionCount',jsonb_array_length(part),
        'englishToKoreanRatio',case when d='english_to_korean' then 100 else 0 end),part);
    end if;
  end loop;
end;
$$;
revoke all on function private.assert_mixed_review_questions_v1(jsonb,jsonb,jsonb,integer) from public,anon,authenticated,service_role;

create function private.create_mixed_mistake_bank_v1(p_admin_id uuid,p_student_id uuid,p_source jsonb,p_primary_preview jsonb,
  p_primary_questions jsonb,p_review_questions jsonb,p_queue_ids uuid[],p_settings jsonb) returns uuid
language plpgsql set search_path='' as $$
declare aid uuid;ds uuid;primary_units uuid[];scope_units uuid[];scope_direction smallint;first_sort integer;last_sort integer;
  pn integer;rn integer;n integer;pe integer;re integer;ratio integer;mode_value text;timing text;seconds integer;qseconds integer;
  passing integer;retry boolean;retry_passing integer;available_from_value timestamptz;available_until_value timestamptz;
  item jsonb;word jsonb;expected jsonb;identity jsonb;review_words jsonb:='[]';targets jsonb:='[]';
  primary_result jsonb:=jsonb_build_object('questions','[]'::jsonb,'headerProof','{}'::jsonb);
  expected_meanings text[]:='{}';expected_words text[]:='{}';target_entry_ids bigint[]:='{}';
  entry_ids bigint[];dataset_ids uuid[];unit_ids uuid[];content_lock bigint;queue public.student_vocab_review_queue;qi jsonb;
  review_scope_value text;levels integer[];ord integer:=0;primary_hashes jsonb;review_hashes jsonb;expected_hashes jsonb;actual_hashes jsonb;
  bank_hash text;actual_n integer;actual_e integer;actual_entries integer;actual_meanings integer;actual_words integer;
  first_order integer;last_order integer;actual_meaning_keys text[];changed integer;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_student_id is null or jsonb_typeof(p_source) is distinct from 'object' or jsonb_typeof(p_source->'words') is distinct from 'array'
    or jsonb_typeof(p_source->'datasets') is distinct from 'array' or jsonb_typeof(p_source->'blockedPrimaryMeaningKeys') is distinct from 'array'
    or jsonb_typeof(p_primary_preview->'items') is distinct from 'array' or jsonb_typeof(p_primary_questions) is distinct from 'array'
    or jsonb_typeof(p_review_questions) is distinct from 'array' or jsonb_typeof(p_settings) is distinct from 'object' or p_queue_ids is null
    then raise exception 'notebook_invalid_request' using errcode='22023';end if;
  if p_source->>'schemaVersion' is distinct from 'mixed-mistake-source-v1' or p_source#>>'{selection,mode}' is distinct from 'mixed'
    or p_source#>>'{student,id}' is distinct from p_student_id::text or p_source#>>'{selection,datasetId}' is null
    or jsonb_typeof(p_source#>'{selection,primaryUnitIds}') is distinct from 'array'
    or jsonb_array_length(p_source#>'{selection,primaryUnitIds}') not between 1 and 500
    or jsonb_typeof(p_source#>'{selection,reviewLevels}') is distinct from 'array'
    then raise exception 'invalid_mixed_review_selection' using errcode='22023';end if;
  ds:=(p_source#>>'{selection,datasetId}')::uuid;review_scope_value:=p_source#>>'{selection,reviewScope}';
  select array_agg(value::uuid order by x.ord) into primary_units from jsonb_array_elements_text(p_source#>'{selection,primaryUnitIds}') with ordinality x(value,ord);
  select array_agg(value::integer order by value::integer) into levels from jsonb_array_elements_text(p_source#>'{selection,reviewLevels}') x(value);
  if ds is null or review_scope_value is null or review_scope_value not in('dataset','selection') or primary_units is null
    or cardinality(primary_units)<>(select count(distinct id) from unnest(primary_units) id where id is not null)
    or levels is null or cardinality(levels) not between 1 and 2 or cardinality(levels)<>(select count(distinct level) from unnest(levels) level where level in(1,2))
    then raise exception 'invalid_mixed_review_selection' using errcode='22023';end if;
  pn:=jsonb_array_length(p_primary_questions);rn:=jsonb_array_length(p_review_questions);n:=pn+rn;
  if n not between 1 and 500 or (p_settings->>'questionCount')::integer is distinct from n or cardinality(p_queue_ids)<>rn
    or rn>0 and (array_ndims(p_queue_ids) is distinct from 1 or array_lower(p_queue_ids,1) is distinct from 1)
    or cardinality(p_queue_ids)<>(select count(distinct id) from unnest(p_queue_ids) id where id is not null)
    then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  ratio:=(p_settings->>'englishToKoreanRatio')::integer;mode_value:=p_settings->>'quizContentMode';timing:=p_settings->>'timingMode';
  seconds:=(p_settings->>'timeLimitSeconds')::integer;qseconds:=(p_settings->>'questionTimeLimitSeconds')::integer;
  passing:=(p_settings->>'passingScore')::integer;retry:=(p_settings->>'retryEnabled')::boolean;retry_passing:=(p_settings->>'retryPassingScore')::integer;
  available_from_value:=(p_settings->>'availableFrom')::timestamptz;available_until_value:=(p_settings->>'availableUntil')::timestamptz;
  if ratio is null or ratio not in(0,50,100) or mode_value is null
    or mode_value not in('book_meaning_choice','canonical_headword_to_definition','canonical_definition_to_headword','canonical_example_to_headword')
    or pn>0 and mode_value<>'book_meaning_choice' or p_settings->>'questionOrderMode' is null
    or p_settings->>'questionOrderMode' not in('fixed','ascending','descending','random') or length(coalesce(p_settings->>'title',''))>160
    or timing is null or timing not in('none','total','per_question') or passing is null or passing not between 0 and 100
    or jsonb_typeof(p_settings->'retryEnabled') is distinct from 'boolean' or retry and (retry_passing is null or retry_passing not between 0 and 100)
    or not retry and retry_passing is not null or timing='total' and (seconds is null or seconds not between 30 and 10800 or qseconds is not null)
    or timing='per_question' and (qseconds is null or qseconds not between 5 and 600 or seconds is not null)
    or timing='none' and (seconds is not null or qseconds is not null)
    or available_until_value is not null and (not isfinite(available_until_value) or available_until_value<=clock_timestamp())
    or available_from_value is not null and (not isfinite(available_from_value) or available_until_value is not null and available_from_value>=available_until_value)
    then raise exception 'notebook_invalid_settings' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_primary_questions) q where jsonb_typeof(q) is distinct from 'object'
      or q-array['vocab_entry_id','base_order_index','direction','choice_vocab_entry_ids']<>'{}'::jsonb
      or not(q ?& array['vocab_entry_id','base_order_index','direction','choice_vocab_entry_ids'])
      or jsonb_typeof(q->'vocab_entry_id') is distinct from 'number' or coalesce(q->>'vocab_entry_id','') !~ '^[1-9][0-9]{0,15}$'
      or jsonb_typeof(q->'base_order_index') is distinct from 'number' or coalesce(q->>'base_order_index','') !~ '^[1-9][0-9]*$'
      or q->>'direction' is null or q->>'direction' not in('english_to_korean','korean_to_english')
      or jsonb_typeof(q->'choice_vocab_entry_ids') is distinct from 'array')
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_primary_questions) with ordinality x(q,position)
      where (q->>'base_order_index')::integer<>position or jsonb_array_length(q->'choice_vocab_entry_ids')<>4)
    or exists(select 1 from jsonb_array_elements(p_primary_questions) q cross join lateral jsonb_array_elements(q->'choice_vocab_entry_ids') c
      where jsonb_typeof(c) is distinct from 'number' or coalesce(c#>>'{}','') !~ '^[1-9][0-9]{0,15}$')
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023';end if;
  if exists(select 1 from jsonb_array_elements(p_review_questions) q where jsonb_typeof(q) is distinct from 'object'
    or q->>'quizContentMode' is distinct from mode_value or q ? 'queueId' or q ? 'bankIndex')
    then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  select count(*) filter(where q->>'direction'='english_to_korean') into pe from jsonb_array_elements(p_primary_questions) q;
  select count(*) filter(where q->>'direction'='english_to_korean') into re from jsonb_array_elements(p_review_questions) q;
  if pe+re<>round(n*ratio/100.0) then raise exception 'notebook_invalid_questions' using errcode='22023';end if;
  perform private.lock_vocabulary_student_v1(p_student_id);
  if not exists(select 1 from public.students where id=p_student_id and status='active' and deleted_at is null)
    then raise exception 'notebook_student_unavailable' using errcode='22023';end if;
  if rn>0 then
    perform private.assert_vocabulary_review_queue_current_v1(p_student_id,p_queue_ids);
    if (select count(*) from private.available_vocabulary_review_queues_v1(p_student_id) a where a.queue_id=any(p_queue_ids))<>rn
      then raise exception 'wrong_history_changed' using errcode='40001';end if;
    select coalesce(jsonb_agg(w order by position),'[]') into review_words from jsonb_array_elements(p_review_questions) with ordinality x(q,position)
      join jsonb_array_elements(p_source->'words') w on w->>'meaningKey'=q->>'meaningKey' and w->>'queueId'=p_queue_ids[position::integer]::text;
    if jsonb_array_length(review_words)<>rn or (select count(distinct w->>'meaningKey') from jsonb_array_elements(review_words) w)<>rn
      then raise exception 'wrong_history_changed' using errcode='40001';end if;
    for word in select value from jsonb_array_elements(review_words) loop
      ord:=ord+1;select * into queue from public.student_vocab_review_queue where id=p_queue_ids[ord] and student_id=p_student_id;
      if not found then raise exception 'wrong_history_changed' using errcode='40001';end if;
      qi:=private.vocabulary_queue_identity_v1(queue.id);
      if queue.status<>'pending' or queue.reserved_review_draft_id is not null or queue.source_question_id::text is distinct from word->>'sourceQuestionId'
        or queue.source_attempt_id::text is distinct from word->>'sourceAttemptId' or queue.vocab_entry_id::text is distinct from word->>'latestVocabEntryId'
        or queue.dataset_id is distinct from ds or word->>'latestDatasetId' is distinct from ds::text
        or queue.reason_level is distinct from (word->>'reasonLevel')::integer or not(queue.reason_level=any(levels))
        or queue.queued_at is distinct from (word->>'queuedAt')::timestamptz or qi->>'meaningKey' is distinct from word->>'meaningKey'
        or qi->>'episodeId' is distinct from word->>'episodeId' or qi->>'sourcePhase' is distinct from word->>'sourcePhase'
        or word->'assignmentAvailable' is distinct from 'true'::jsonb
        or not exists(select 1 from jsonb_array_elements(p_source->'datasets') d where d->>'id'=word->>'latestDatasetId' and d->'available'='true')
        or not exists(select 1 from public.quiz_questions qq join public.quiz_attempts a on a.id=qq.attempt_id and a.student_id=p_student_id
          join public.vocab_entries e on e.id=qq.vocab_entry_id and e.dataset_id=ds where qq.id=queue.source_question_id and qq.attempt_id=queue.source_attempt_id
            and qq.vocab_entry_id=queue.vocab_entry_id and (review_scope_value='dataset' or e.unit_id=any(primary_units)))
        then raise exception 'wrong_history_changed' using errcode='40001';end if;
      targets:=targets||jsonb_build_array(jsonb_build_object('sourceQuestionId',word->>'sourceQuestionId','sourcePhase',word->>'sourcePhase',
        'meaningKey',word->>'meaningKey','episodeId',word->>'episodeId','stateVersion',word->>'stateVersion'));
    end loop;
    perform private.assert_vocabulary_mistake_targets_v1(p_student_id,targets);
  end if;
  perform private.assert_mixed_review_questions_v1(p_source,p_settings,p_review_questions,re);
  if pn>0 then
    if p_primary_preview->>'schemaVersion' is distinct from 'mixed-primary-meanings-v1' or p_primary_preview->>'datasetId' is distinct from ds::text
      or p_primary_preview->'unitIds' is distinct from to_jsonb(primary_units) or p_primary_preview->>'sourceKind' is null
      or p_primary_preview->>'sourceKind' not in('raw-v2','exam-use') then raise exception 'mixed_primary_source_changed' using errcode='40001';end if;
    for item in select value from jsonb_array_elements(p_primary_questions) loop
      if (select count(*) from jsonb_array_elements(p_primary_preview->'items') e where e->>'entryId'=item->>'vocab_entry_id' and e->>'direction'=item->>'direction')<>1
        then raise exception 'mixed_primary_source_changed' using errcode='40001';end if;
      select e into expected from jsonb_array_elements(p_primary_preview->'items') e where e->>'entryId'=item->>'vocab_entry_id' and e->>'direction'=item->>'direction';
      if expected->>'meaningKey' is null or expected->>'wordKey' is null or jsonb_typeof(expected->'identity') is distinct from 'object'
        or expected->>'meaningKey' is distinct from expected#>>'{identity,meaningKey}' or expected->>'wordKey' is distinct from expected#>>'{identity,wordKey}'
        or p_source->'blockedPrimaryMeaningKeys' ? (expected->>'meaningKey')
        then raise exception 'mixed_regular_target_already_pending_review' using errcode='22023';end if;
      expected_meanings:=array_append(expected_meanings,expected->>'meaningKey');expected_words:=array_append(expected_words,expected->>'wordKey');
      target_entry_ids:=array_append(target_entry_ids,(item->>'vocab_entry_id')::bigint);
    end loop;
  end if;
  for word in select value from jsonb_array_elements(review_words) loop
    expected_meanings:=array_append(expected_meanings,word->>'meaningKey');expected_words:=array_append(expected_words,word->>'wordKey');
    target_entry_ids:=array_append(target_entry_ids,(word->>'latestVocabEntryId')::bigint);
  end loop;
  if cardinality(expected_meanings)<>n or (select count(distinct x) from unnest(expected_meanings) x where x is not null)<>n
    or (select count(distinct x) from unnest(expected_words) x where x is not null)<>n or (select count(distinct x) from unnest(target_entry_ids) x where x is not null)<>n
    then raise exception 'notebook_invalid_banks' using errcode='22023';end if;
  -- The outer writer holds the union for all banks before any insertion.
  for content_lock in select distinct hashtextextended('notebook-v2-content-entry:'||id::text,916) key from unnest(target_entry_ids) id order by key loop
    perform pg_advisory_xact_lock(content_lock);
  end loop;
  select array_agg(distinct id order by id) into entry_ids from(
    select unnest(target_entry_ids) id
    union select c::bigint from jsonb_array_elements(p_primary_questions) q cross join lateral jsonb_array_elements_text(q->'choice_vocab_entry_ids') c
    union select (c->>'entryId')::bigint from jsonb_array_elements(p_review_questions) q cross join lateral jsonb_array_elements(q->'choiceSources') c
    union select unnest(aq.choice_vocab_entry_ids) from jsonb_array_elements(review_words) w join public.quiz_questions qq on qq.id=(w->>'sourceQuestionId')::uuid
      join public.assignment_questions aq on aq.id=qq.assignment_question_id) entries where id is not null;
  select array_agg(distinct id order by id) into dataset_ids from(select dataset_id id from public.vocab_entries where id=any(entry_ids) union select ds) datasets;
  select array_agg(distinct id order by id) into unit_ids from(select unit_id id from public.vocab_entries where id=any(entry_ids) union select unnest(primary_units)) units;
  perform 1 from public.vocab_datasets where id=any(dataset_ids) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id=any(dataset_ids) order by dataset_id for share;
  perform 1 from public.vocab_units where id=any(unit_ids) order by id for share;
  perform 1 from public.vocab_entries where id=any(entry_ids) order by id for share;
  perform 1 from public.vocab_entry_quiz_eligibility where vocab_entry_id=any(entry_ids) order by vocab_entry_id,quiz_mode for share;
  perform 1 from word_index.vocab_entry_link where vocab_entry_id=any(entry_ids) order by vocab_entry_id for share;
  perform 1 from word_index.dataset_source where dataset_id=any(dataset_ids) order by dataset_id,source_id,build_id for share;
  perform 1 from word_index.index_build where build_id in(select build_id from word_index.dataset_source where dataset_id=any(dataset_ids)) order by build_id for share;
  perform 1 from word_index.app_exam_use_release where dataset_id=any(dataset_ids) order by release_id for share;
  perform 1 from word_index.app_exam_use_occurrence where vocab_entry_id=any(entry_ids) order by release_id,vocab_entry_id for share;
  perform 1 from private.vocabulary_compositions where dataset_id=any(dataset_ids) order by version_id for share;
  if (select count(*) from public.vocab_entries where id=any(target_entry_ids) and dataset_id=ds)<>n
    then raise exception 'review_question_entry_dataset_mismatch' using errcode='22023';end if;
  scope_direction:=private.resolve_contiguous_unit_direction_v1(ds,primary_units);
  select array_agg(u.id order by u.sort_index*scope_direction,u.id),min(u.sort_index),max(u.sort_index) into scope_units,first_sort,last_sort
    from public.vocab_units u where u.dataset_id=ds and (u.id=any(primary_units) or u.id in(select unit_id from public.vocab_entries where id=any(entry_ids) and dataset_id=ds));
  if scope_units is null or cardinality(scope_units)=0 or not(primary_units<@scope_units) or first_sort is null or last_sort is null
    then raise exception 'mixed_primary_scope_changed' using errcode='40001';end if;
  perform private.resolve_contiguous_unit_direction_v1(ds,scope_units);
  insert into public.assignments(title,dataset_id,range_start,range_end,question_count,english_to_korean_ratio,time_limit_seconds,passing_score,
    passing_basis,retake_allowed,status,created_by,range_basis,question_order_mode,question_bank_version,timing_mode,question_time_limit_seconds,
    assignment_purpose,retry_enabled,retry_passing_score,source_kind,points_policy_version,provenance_status,quiz_content_mode,review_scope,available_from,available_until)
  values(coalesce(nullif(btrim(p_settings->>'title'),''),'일반·오답 시험'),ds,first_sort,last_sort,n,ratio::smallint,coalesce(seconds,10800),passing::smallint,
    'initial',false,'draft',p_admin_id,'units',(p_settings->>'questionOrderMode')::public.question_order_mode,2,timing,qseconds,'mixed',retry,retry_passing::smallint,
    'book','vocab-points-v1','legacy_backfill','book_meaning_choice',review_scope_value,available_from_value,available_until_value) returning id into aid;
  insert into public.assignment_units(assignment_id,dataset_id,unit_id,position,is_primary)
    select aid,ds,u.id,u.position::integer,u.id=any(primary_units) from unnest(scope_units) with ordinality u(id,position);
  insert into public.assignment_students(assignment_id,student_id,assigned_by) values(aid,p_student_id,p_admin_id);
  if pn>0 then
    primary_result:=private.insert_mixed_primary_questions_v1(aid,p_admin_id,p_student_id,primary_units,scope_units,pn,pe,p_primary_questions);
    if primary_result->>'sourceKind' is distinct from p_primary_preview->>'sourceKind' or (primary_result->>'questionCount')::integer is distinct from pn
      or (primary_result->>'englishCount')::integer is distinct from pe or jsonb_array_length(primary_result->'questions')<>pn
      then raise exception 'mixed_primary_source_changed' using errcode='40001';end if;
    for item in select value from jsonb_array_elements(primary_result->'questions') loop
      select e into expected from jsonb_array_elements(p_primary_preview->'items') e where e->>'entryId'=item->>'vocabEntryId' and e->>'direction'=item->>'direction';
      identity:=private.assignment_vocabulary_meaning_v1((item->>'assignmentQuestionId')::uuid);
      if expected is null or expected->>'meaningKey' is distinct from item->>'meaningKey' or expected->>'wordKey' is distinct from item->>'wordKey'
        or expected->'identity' is distinct from identity then raise exception 'mixed_primary_meaning_changed' using errcode='40001';end if;
    end loop;
  end if;
  select coalesce(jsonb_agg(q->'questionContentSha256' order by (q->>'baseOrderIndex')::integer),'[]') into primary_hashes from jsonb_array_elements(primary_result->'questions') q;
  select coalesce(jsonb_agg(to_jsonb(upper(encode(extensions.digest(q::text,'sha256'),'hex'))) order by position),'[]') into review_hashes
    from jsonb_array_elements(p_review_questions) with ordinality x(q,position);
  expected_hashes:=primary_hashes||review_hashes;
  bank_hash:=upper(private.reviewed_exam_sha256_v1(jsonb_build_object('schemaVersion','mixed-mistake-bank-hash-v1','questionHashes',expected_hashes)));
  -- Exactly one final immutable header change, after primary freeze and before
  -- review origins require the notebook parent. Only status changes afterward.
  update public.assignments set provenance_status='notebook_snapshot_v1',question_bank_version=6,generator_version='mistake-book-bank-v1',
    quiz_content_mode=mode_value,question_bank_sha256=bank_hash,
    dataset_source_sha256_snapshot=coalesce(primary_result#>>'{headerProof,datasetSourceSha256}',(select upper(source_sha256) from public.vocab_datasets where id=ds)),
    canonical_snapshot_sha256_snapshot=primary_result#>>'{headerProof,canonicalSnapshotSha256}',link_package_snapshot_sha256=primary_result#>>'{headerProof,linkPackageSnapshotSha256}',
    eligibility_rule_version_snapshot=coalesce(primary_result#>>'{headerProof,eligibilityRuleVersion}','notebook-meaning-v2') where id=aid and status='draft';
  get diagnostics changed=row_count;if changed<>1 then raise exception 'mixed_bank_snapshot_changed' using errcode='40001';end if;
  if rn>0 then perform private.insert_mistake_bank_questions_v2(aid,p_student_id,p_source,p_review_questions,pn);end if;
  select count(*),count(*) filter(where q.direction='english_to_korean'),count(distinct q.vocab_entry_id),count(distinct m.value->>'meaningKey'),
    count(distinct m.value->>'wordKey'),min(q.base_order_index),max(q.base_order_index),
    jsonb_agg(to_jsonb(q.question_content_sha256) order by q.base_order_index),array_agg(m.value->>'meaningKey' order by q.base_order_index)
    into actual_n,actual_e,actual_entries,actual_meanings,actual_words,first_order,last_order,actual_hashes,actual_meaning_keys
    from private.assignment_question_contents_v1 q cross join lateral(select private.assignment_vocabulary_meaning_v1(q.id) value) m where q.assignment_id=aid;
  if actual_n<>n or actual_e<>pe+re or actual_entries<>n or actual_meanings<>n or actual_words<>n or first_order is distinct from 1 or last_order is distinct from n
    or actual_hashes is distinct from expected_hashes or actual_meaning_keys is distinct from expected_meanings
    or exists(select 1 from public.assignment_questions where assignment_id=aid and (content_version_id is null or question_content_sha256 is null))
    then raise exception 'mixed_bank_snapshot_changed' using errcode='40001';end if;
  if exists(select 1 from private.assignment_question_contents_v1 q where q.assignment_id=aid
    group by q.direction,lower(normalize(btrim(q.prompt),NFKC)) having count(distinct lower(normalize(btrim(q.choices->>q.correct_choice_index),NFKC)))>1)
    then raise exception 'assignment_target_prompt_ambiguous' using errcode='22023';end if;
  if rn>0 then
    perform private.assert_vocabulary_review_bank_v1(p_student_id,aid,p_queue_ids);
    if (select count(*) from public.assignment_review_targets where assignment_id=aid and student_id=p_student_id and released_at is null)<>rn
      or exists(select 1 from unnest(p_queue_ids) with ordinality s(queue_id,position)
        left join public.student_vocab_review_queue qu on qu.id=s.queue_id
        left join public.assignment_questions q on q.assignment_id=aid and q.base_order_index=pn+s.position
        left join private.notebook_question_origins_v2 o on o.assignment_question_id=q.id
        left join public.assignment_review_targets t on t.assignment_id=aid and t.student_id=p_student_id and t.review_queue_id=s.queue_id and t.assignment_question_id=q.id and t.released_at is null
        where qu.id is null or q.id is null or t.assignment_question_id is null or o.student_id is distinct from p_student_id
          or o.source_question_id is distinct from qu.source_question_id or o.source_phase is distinct from private.vocabulary_queue_identity_v1(qu.id)->>'sourcePhase'
          or o.meaning_key is distinct from private.vocabulary_queue_identity_v1(qu.id)->>'meaningKey'
          or o.episode_id is distinct from (private.vocabulary_queue_identity_v1(qu.id)->>'episodeId')::uuid)
      then raise exception 'review_target_meaning_changed' using errcode='40001';end if;
    update public.student_vocab_review_queue set status='consumed',consumed_assignment_id=aid,consumed_at=clock_timestamp()
      where student_id=p_student_id and id=any(p_queue_ids) and status='pending' and reserved_review_draft_id is null;
    get diagnostics changed=row_count;if changed<>rn then raise exception 'wrong_history_changed' using errcode='40001';end if;
  end if;
  if available_until_value is not null and available_until_value<=clock_timestamp() then raise exception 'assignment_deadline_elapsed_during_creation' using errcode='22023';end if;
  update public.assignments set status='active' where id=aid and status='draft';get diagnostics changed=row_count;
  if changed<>1 then raise exception 'mixed_bank_activation_failed' using errcode='55000';end if;
  return aid;
end;
$$;
revoke all on function private.create_mixed_mistake_bank_v1(uuid,uuid,jsonb,jsonb,jsonb,jsonb,uuid[],jsonb) from public,anon,authenticated,service_role;


create function public.create_mixed_mistake_assignments_v1(p_admin_id uuid,p_request_key uuid,p_request_hash text,p_batches jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare batch jsonb; source jsonb; settings jsonb; bank jsonb; primary_questions jsonb; review_questions jsonb;
  all_primary jsonb; all_review jsonb; preview jsonb; requests jsonb; targets jsonb; result jsonb:='[]';
  sid uuid; ds uuid; aid uuid; queue_ids uuid[]; bank_queue_ids uuid[]; primary_units uuid[];
  selected_entry_ids bigint[]; selected_dataset_ids uuid[]; selected_unit_ids uuid[]; content_lock bigint;
  count_value integer; ratio integer; primary_count integer; review_count integer; actual_count integer; actual_english integer; actual_meanings integer;
  saved private.notebook_assignment_requests;
begin
  perform private.assert_notebook_admin_v1(p_admin_id);
  if p_request_key is null or coalesce(p_request_hash,'') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_batches) is distinct from 'array' or jsonb_array_length(p_batches)<>1
    then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_admin_id::text||':'||p_request_key::text,914));
  select * into saved from private.notebook_assignment_requests where admin_id=p_admin_id and request_key=p_request_key;
  if found then
    if saved.request_hash is distinct from p_request_hash then raise exception 'notebook_request_conflict' using errcode='40001'; end if;
    return saved.result;
  end if;
  batch:=p_batches->0;
  if jsonb_typeof(batch) is distinct from 'object' or
    batch-array['studentId','audienceMode','gradeConfirmed','selection','sourceHash','primaryRequests','primarySourceHash','settings','banks']<>'{}'::jsonb
    or (select count(*) from jsonb_object_keys(batch))<>9
    or jsonb_typeof(batch->'banks') is distinct from 'array' or jsonb_array_length(batch->'banks') not between 1 and 500
    or batch->>'audienceMode' is null or batch->>'audienceMode' not in('single','bulk')
    or jsonb_typeof(batch->'gradeConfirmed') is distinct from 'boolean'
    then raise exception 'notebook_invalid_request' using errcode='22023'; end if;
  settings:=batch->'settings';sid:=(batch->>'studentId')::uuid;ds:=(batch#>>'{selection,datasetId}')::uuid;
  count_value:=(settings->>'questionCount')::integer;ratio:=(settings->>'englishToKoreanRatio')::integer;
  if sid is null or ds is null or count_value is null or count_value not between 4 and 500 or ratio is null or ratio not in(0,50,100)
    or settings->>'timingMode' is null or settings->>'timingMode' not in('none','total','per_question')
    or (settings->>'passingScore')::integer is null or (settings->>'passingScore')::integer not between 0 and 100
    or jsonb_typeof(settings->'retryEnabled') is distinct from 'boolean'
    or (settings->>'retryEnabled')::boolean and ((settings->>'retryPassingScore')::integer is null or (settings->>'retryPassingScore')::integer not between 0 and 100)
    or not(settings->>'retryEnabled')::boolean and settings->>'retryPassingScore' is not null
    or settings->>'timingMode'='total' and ((settings->>'timeLimitSeconds')::integer is null or (settings->>'timeLimitSeconds')::integer not between 30 and 10800 or settings->>'questionTimeLimitSeconds' is not null)
    or settings->>'timingMode'='per_question' and ((settings->>'questionTimeLimitSeconds')::integer is null or (settings->>'questionTimeLimitSeconds')::integer not between 5 and 600 or settings->>'timeLimitSeconds' is not null)
    or settings->>'timingMode'='none' and (settings->>'timeLimitSeconds' is not null or settings->>'questionTimeLimitSeconds' is not null)
    then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
  if (select array_agg((b->>'index')::integer order by (b->>'index')::integer) from jsonb_array_elements(batch->'banks') b)
    is distinct from array(select generate_series(0,jsonb_array_length(batch->'banks')-1))
    or exists(select 1 from jsonb_array_elements(batch->'banks') b where jsonb_typeof(b)<>'object'
      or b-array['index','questionCount','primaryQuestionCount','reviewMeaningCount','quizContentMode','englishToKoreanRatio','timeLimitSeconds','primaryQuestions','reviewQuestions']<>'{}'::jsonb
      or (select count(*) from jsonb_object_keys(b))<>9
      or jsonb_typeof(b->'primaryQuestions') is distinct from 'array' or jsonb_typeof(b->'reviewQuestions') is distinct from 'array')
    then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
  select coalesce(jsonb_agg(q order by (b->>'index')::integer,ord),'[]') into all_primary
    from jsonb_array_elements(batch->'banks') b cross join lateral jsonb_array_elements(b->'primaryQuestions') with ordinality x(q,ord);
  select coalesce(jsonb_agg(q order by (b->>'index')::integer,ord),'[]'),coalesce(array_agg((q->>'queueId')::uuid order by (b->>'index')::integer,ord),'{}')
    into all_review,queue_ids from jsonb_array_elements(batch->'banks') b cross join lateral jsonb_array_elements(b->'reviewQuestions') with ordinality x(q,ord);
  primary_count:=jsonb_array_length(all_primary);review_count:=jsonb_array_length(all_review);
  if review_count<1 or primary_count+review_count<>count_value
    or (select count(distinct q->>'meaningKey') from jsonb_array_elements(all_primary||all_review) q)<>count_value
    or (select count(distinct q->>'vocab_entry_id') from jsonb_array_elements(all_primary) q)<>primary_count
    or (select count(*) from jsonb_array_elements(all_primary||all_review) q where q->>'direction'='english_to_korean')<>round(count_value*ratio/100.0)
    or exists(select 1 from jsonb_array_elements(all_primary) q where jsonb_typeof(q)<>'object'
      or q-array['vocab_entry_id','base_order_index','direction','choice_vocab_entry_ids','meaningKey','wordKey','meaningProofHash']<>'{}'::jsonb
      or (select count(*) from jsonb_object_keys(q))<>7)
    then raise exception 'notebook_invalid_questions' using errcode='22023'; end if;
  perform private.lock_vocabulary_student_v1(sid);
  perform private.assert_vocabulary_review_queue_current_v1(sid,queue_ids);
  if (select count(*) from private.available_vocabulary_review_queues_v1(sid) where queue_id=any(queue_ids))<>review_count
    then raise exception 'wrong_history_changed' using errcode='40001'; end if;
  -- Acquire all shared-content locks before the first bank, including entries
  -- used only by another bank or a retained historical distractor.
  select array_agg(distinct id order by id) into selected_entry_ids from(
    select (q->>'vocab_entry_id')::bigint id from jsonb_array_elements(all_primary) q
    union select c::bigint from jsonb_array_elements(all_primary) q cross join lateral jsonb_array_elements_text(q->'choice_vocab_entry_ids') c
    union select qq.vocab_entry_id from jsonb_array_elements(all_review) q join public.quiz_questions qq on qq.id=(q->>'sourceQuestionId')::uuid
    union select (c->>'entryId')::bigint from jsonb_array_elements(all_review) q cross join lateral jsonb_array_elements(q->'choiceSources') c
    union select unnest(aq.choice_vocab_entry_ids) from jsonb_array_elements(all_review) q
      join public.quiz_questions qq on qq.id=(q->>'sourceQuestionId')::uuid join public.assignment_questions aq on aq.id=qq.assignment_question_id
  ) selected;
  for content_lock in select distinct hashtextextended('notebook-v2-content-entry:'||id::text,916) key from unnest(selected_entry_ids) id order by key loop
    perform pg_advisory_xact_lock(content_lock);
  end loop;
  select array_agg(distinct id order by id) into selected_dataset_ids from(select dataset_id id from public.vocab_entries where id=any(selected_entry_ids) union select ds) d;
  primary_units:=array(select value::uuid from jsonb_array_elements_text(batch#>'{selection,primaryUnitIds}'));
  select array_agg(distinct id order by id) into selected_unit_ids from(select unit_id id from public.vocab_entries where id=any(selected_entry_ids) union select unnest(primary_units)) u;
  perform 1 from public.vocab_datasets where id=any(selected_dataset_ids) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id=any(selected_dataset_ids) order by dataset_id for share;
  perform 1 from public.vocab_units where id=any(selected_unit_ids) order by id for share;
  perform 1 from public.vocab_entries where id=any(selected_entry_ids) order by id for share;
  perform 1 from public.vocab_entry_quiz_eligibility where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id,quiz_mode for share;
  perform 1 from public.vocab_dataset_capabilities where dataset_id=any(selected_dataset_ids) order by dataset_id,quiz_mode for share;
  perform 1 from word_index.vocab_entry_link where vocab_entry_id=any(selected_entry_ids) order by vocab_entry_id for share;
  perform 1 from word_index.dataset_source where dataset_id=any(selected_dataset_ids) order by source_id,build_id for share;
  perform 1 from word_index.index_build where build_id in(select build_id from word_index.dataset_source where dataset_id=any(selected_dataset_ids)) order by build_id for share;
  perform 1 from word_index.app_exam_use_release where dataset_id=any(selected_dataset_ids) order by release_id for share;
  perform 1 from word_index.app_exam_use_occurrence where dataset_id=any(selected_dataset_ids) and vocab_entry_id=any(selected_entry_ids) order by release_id,vocab_entry_id for share;
  perform 1 from private.vocabulary_compositions where dataset_id=any(selected_dataset_ids) order by version_id for share;
  source:=public.prepare_mixed_mistake_source_v1(p_admin_id,sid,batch->'selection');
  if source->>'sourceHash' is distinct from batch->>'sourceHash' then raise exception 'notebook_source_changed' using errcode='40001'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('entryId',(q->>'vocab_entry_id')::bigint,'direction',q->>'direction') order by (q->>'vocab_entry_id')::bigint,q->>'direction'),'[]')
    into requests from jsonb_array_elements(all_primary) q;
  if jsonb_typeof(batch->'primaryRequests') is distinct from 'array' or requests is distinct from
    (select coalesce(jsonb_agg(q order by (q->>'entryId')::bigint,q->>'direction'),'[]') from jsonb_array_elements(batch->'primaryRequests') q)
    then raise exception 'mixed_primary_invalid_plan' using errcode='22023'; end if;
  if primary_count>0 then
    preview:=private.preview_new_primary_meanings_v1(ds,primary_units,batch->'primaryRequests');
    if preview->>'sourceHash' is distinct from batch->>'primarySourceHash'
      or exists(select 1 from jsonb_array_elements(all_primary) q left join jsonb_array_elements(preview->'items') p
        on (p->>'entryId')::bigint=(q->>'vocab_entry_id')::bigint and p->>'direction'=q->>'direction'
        where p is null or p->>'meaningKey' is distinct from q->>'meaningKey' or p->>'wordKey' is distinct from q->>'wordKey'
          or p->>'meaningProofHash' is distinct from q->>'meaningProofHash'
          or exists(select 1 from jsonb_array_elements_text(source->'blockedPrimaryMeaningKeys') blocked where blocked=q->>'meaningKey'))
      then raise exception 'mixed_primary_source_changed' using errcode='40001'; end if;
  else
    if batch->>'primarySourceHash' is not null then raise exception 'mixed_primary_invalid_plan' using errcode='22023'; end if;
    preview:=jsonb_build_object('items','[]'::jsonb);
  end if;
  if exists(select 1 from jsonb_array_elements(all_review) q left join jsonb_array_elements(source->'words') w on w->>'queueId'=q->>'queueId'
    where w is null or w->>'meaningKey' is distinct from q->>'meaningKey' or w->'episodeId' is distinct from q->'episodeId'
      or w->>'sourceQuestionId' is distinct from q->>'sourceQuestionId' or w->>'sourcePhase' is distinct from q->>'sourcePhase'
      or w->>'sourceContentHash' is distinct from q->>'sourceContentHash' or w->>'wordKey' is distinct from q->>'wordKey'
      or w->'assignmentAvailable' is distinct from 'true'::jsonb
      or w->>'latestDatasetId' is distinct from ds::text
      or not exists(select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=w->>'latestDatasetId' and d->'available'='true'::jsonb))
    then raise exception 'notebook_source_changed' using errcode='40001'; end if;
  select jsonb_agg(jsonb_build_object('sourceQuestionId',w->>'sourceQuestionId','sourcePhase',w->>'sourcePhase',
    'meaningKey',w->>'meaningKey','episodeId',w->>'episodeId','stateVersion',w->>'stateVersion')) into targets
    from jsonb_array_elements(all_review) q join jsonb_array_elements(source->'words') w on w->>'queueId'=q->>'queueId';
  perform private.assert_vocabulary_mistake_targets_v1(sid,targets);
  if batch->>'audienceMode'='bulk' and batch->'gradeConfirmed'<>'true'::jsonb and exists(
    select 1 from jsonb_array_elements(source->'datasets') d where d->>'id'=ds::text
      and private.notebook_grade_v1(d->>'gradeCode')<>private.notebook_grade_v1(source#>>'{student,gradeLabel}'))
    then raise exception 'notebook_grade_review_required' using errcode='22023'; end if;
  if settings->>'timingMode'='total' and (select sum((b->>'timeLimitSeconds')::integer) from jsonb_array_elements(batch->'banks') b)
    is distinct from (settings->>'timeLimitSeconds')::integer then raise exception 'notebook_invalid_settings' using errcode='22023'; end if;
  -- Finish every bank's validation before creating any assignment. Reuse the
  -- same source after this point: consuming bank 1 must not invalidate bank 2.
  for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
    primary_questions:=bank->'primaryQuestions';review_questions:=bank->'reviewQuestions';
    if (bank->>'questionCount')::integer is null or (bank->>'questionCount')::integer not between 1 and 500
      or (bank->>'primaryQuestionCount')::integer is distinct from jsonb_array_length(primary_questions)
      or (bank->>'reviewMeaningCount')::integer is distinct from jsonb_array_length(review_questions)
      or (bank->>'questionCount')::integer<>jsonb_array_length(primary_questions)+jsonb_array_length(review_questions)
      or (bank->>'englishToKoreanRatio')::integer is null or (bank->>'englishToKoreanRatio')::integer not in(0,50,100)
      or (select count(*) from jsonb_array_elements(primary_questions||review_questions) q where q->>'direction'='english_to_korean')
        <>round((bank->>'questionCount')::integer*(bank->>'englishToKoreanRatio')::integer/100.0)
      or jsonb_array_length(primary_questions)>0 and bank->>'quizContentMode' is distinct from 'book_meaning_choice'
      or exists(select 1 from jsonb_array_elements(review_questions) q where q->>'quizContentMode' is distinct from bank->>'quizContentMode')
      or (select count(distinct q->>'wordKey') from jsonb_array_elements(primary_questions||review_questions) q)<>(bank->>'questionCount')::integer
      or settings->>'timingMode'='total' and ((bank->>'timeLimitSeconds')::integer is null or (bank->>'timeLimitSeconds')::integer<30)
      or settings->>'timingMode'<>'total' and bank->>'timeLimitSeconds' is not null
      or coalesce((select array_agg((q->>'base_order_index')::integer order by ord) from jsonb_array_elements(primary_questions) with ordinality x(q,ord)),'{}')
        is distinct from array(select generate_series(1,jsonb_array_length(primary_questions)))
      then raise exception 'notebook_invalid_banks' using errcode='22023'; end if;
    select coalesce(jsonb_agg(q-'queueId' order by ord),'[]') into review_questions from jsonb_array_elements(review_questions) with ordinality x(q,ord);
    perform private.assert_mixed_review_questions_v1(source,settings,review_questions,
      (select count(*)::integer from jsonb_array_elements(review_questions) q where q->>'direction'='english_to_korean'));
  end loop;
  for bank in select value from jsonb_array_elements(batch->'banks') order by (value->>'index')::integer loop
    select coalesce(jsonb_agg(q-array['meaningKey','wordKey','meaningProofHash'] order by ord),'[]') into primary_questions
      from jsonb_array_elements(bank->'primaryQuestions') with ordinality x(q,ord);
    select coalesce(jsonb_agg(q-'queueId' order by ord),'[]'),coalesce(array_agg((q->>'queueId')::uuid order by ord),'{}') into review_questions,bank_queue_ids
      from jsonb_array_elements(bank->'reviewQuestions') with ordinality x(q,ord);
    settings:=(batch->'settings')||jsonb_build_object('questionCount',bank->'questionCount','quizContentMode',bank->'quizContentMode',
      'englishToKoreanRatio',bank->'englishToKoreanRatio','timeLimitSeconds',bank->'timeLimitSeconds');
    aid:=private.create_mixed_mistake_bank_v1(p_admin_id,sid,source,preview,primary_questions,review_questions,bank_queue_ids,settings);
    result:=result||jsonb_build_array(jsonb_build_object('studentId',sid,'assignmentId',aid,'questionCount',bank->'questionCount'));
  end loop;
  select count(*),count(*) filter(where q.direction='english_to_korean'),count(distinct m.value->>'meaningKey')
    into actual_count,actual_english,actual_meanings from public.assignment_questions q
    cross join lateral(select private.assignment_vocabulary_meaning_v1(q.id) value) m
    where q.assignment_id in(select (r->>'assignmentId')::uuid from jsonb_array_elements(result) r);
  if actual_count<>count_value or actual_english<>round(count_value*ratio/100.0) or actual_meanings<>count_value
    then raise exception 'mixed_bank_snapshot_changed' using errcode='40001'; end if;
  insert into private.notebook_assignment_requests(admin_id,request_key,request_hash,result) values(p_admin_id,p_request_key,p_request_hash,result);
  return result;
end;
$$;
revoke all on function public.create_mixed_mistake_assignments_v1(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.create_mixed_mistake_assignments_v1(uuid,uuid,text,jsonb) to service_role;


do $acl$
declare r record;
begin
  for r in select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) args from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('preserve_vocabulary_legacy_state_v1','preserve_vocabulary_legacy_questions_v1','lock_vocabulary_student_v1',
    'assignment_vocabulary_meaning_context_v1','assignment_vocabulary_meaning_v1','quiz_vocabulary_meaning_v1','freeze_assignment_vocabulary_meanings_v1','legacy_vocabulary_meaning_states_v1',
    'accept_vocabulary_answer_v1','submit_vocabulary_answer_v1','grade_vocabulary_base','grade_vocabulary_v2','grade_vocabulary_v3','grade_vocabulary_v4',
    'm03_grade_expired_attempt','m03_grade_expired_attempt_at_v2','finalize_vocabulary_expiry_v1','current_vocabulary_meaning_states_v1',
    'vocabulary_meaning_study_source_v1','vocabulary_mistake_sources_v1','vocabulary_mistake_page_v1','vocabulary_meaning_states_at_v1','vocabulary_mistake_episode_histories_v1',
    'vocabulary_queue_identity_v1','assert_vocabulary_mistake_targets_v1','guard_vocabulary_review_queue_v1',
    'guard_vocabulary_review_target_update_v1','resolve_vocabulary_review_episode_v1','reopen_vocabulary_review_episode_v1','reopen_terminal_vocabulary_reviews_v1',
    'assert_vocabulary_review_queue_current_v1','available_vocabulary_review_queues_v1','assert_vocabulary_review_bank_v1',
    'mistake_word_practice_source_v1','assert_mistake_practice_plan_v1') loop
    execute format('revoke all on function %I.%I(%s) from public,anon,authenticated,service_role',r.nspname,r.proname,r.args);
  end loop;
  for r in select unnest(array['vocabulary_question_meaning_versions','student_vocabulary_versions','student_vocabulary_meaning_states',
    'vocabulary_legacy_state_baselines','vocabulary_legacy_question_baselines','vocabulary_answer_receipts','vocabulary_expired_answer_results','assignment_vocabulary_meaning_refs']) name loop
    execute format('alter table private.%I enable row level security',r.name);
    execute format('revoke all on private.%I from public,anon,authenticated,service_role',r.name);
  end loop;
end;
$acl$;

commit;
