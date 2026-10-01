-- APP-20261001-07 / M02. New writes only; old records and receipts are retained.
begin;

-- This is frozen storage, not an approval or question authoring bank. Source
-- items already containing an identical body remain the only copy of that body.
create table private.vocabulary_question_content_versions (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('assignment','standalone','exam-use','practice')),
  dataset_ids uuid[] not null,
  binding jsonb not null check (jsonb_typeof(binding)='object'),
  payload jsonb not null check (jsonb_typeof(payload)='object'),
  source_body_sha256 text check (source_body_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  dataset_id uuid generated always as ((binding->>'dataset_id')::uuid) stored,
  vocab_entry_id bigint generated always as ((binding->>'vocab_entry_id')::bigint) stored,
  quiz_mode text generated always as (binding->>'eligibility_quiz_mode') stored,
  composition_version_id uuid generated always as ((binding->>'composition_version_id_snapshot')::uuid) stored,
  composition_item_id text generated always as (binding->>'composition_item_id_snapshot') stored,
  composition_item_sha256 text generated always as (binding->>'composition_item_sha256_snapshot') stored,
  reviewed_release_id uuid generated always as ((binding->>'reviewed_exam_release_id_snapshot')::uuid) stored,
  reviewed_item_id text generated always as (binding->>'reviewed_exam_item_id_snapshot') stored,
  reviewed_item_sha256 text generated always as (binding->>'reviewed_exam_item_sha256_snapshot') stored,
  canonical_release_id uuid generated always as ((binding->>'canonical_question_release_id_snapshot')::uuid) stored,
  canonical_item_id text generated always as (binding->>'canonical_question_item_id_snapshot') stored,
  canonical_item_sha256 text generated always as (binding->>'canonical_question_item_sha256_snapshot') stored,
  unique(kind,content_sha256),
  foreign key (vocab_entry_id,dataset_id) references public.vocab_entries(id,dataset_id) on delete restrict,
  foreign key (composition_version_id,composition_item_id,composition_item_sha256)
    references private.vocabulary_composition_items(version_id,item_id,item_sha256) on delete restrict,
  foreign key (reviewed_release_id,reviewed_item_id,reviewed_item_sha256)
    references private.reviewed_exam_items(release_id,item_id,item_sha256) on delete restrict,
  foreign key (canonical_release_id,dataset_id,vocab_entry_id,quiz_mode,canonical_item_id,canonical_item_sha256)
    references word_index.app_canonical_question_preview_item(release_id,dataset_id,vocab_entry_id,quiz_mode,question_item_id,question_item_sha256) on delete restrict
);
alter table private.vocabulary_question_content_versions enable row level security;
revoke all on private.vocabulary_question_content_versions from public,anon,authenticated,service_role;
create trigger vocabulary_question_content_versions_immutable before update or delete
  on private.vocabulary_question_content_versions for each row execute function private.reject_mock_wordbook_history_change();

-- The existing writers only INSERT these items. Unconditional UPDATE protection
-- also closes a stale-transaction race at the first reference; release status
-- remains mutable in its separate table. Used item deletion is covered by FKs.
create trigger canonical_question_content_immutable before update
  on word_index.app_canonical_question_preview_item for each row execute function private.reject_mock_wordbook_history_change();
create trigger reviewed_question_content_immutable before update
  on private.reviewed_exam_items for each row execute function private.reject_mock_wordbook_history_change();

alter table public.assignment_questions add column content_version_id uuid
  references private.vocabulary_question_content_versions(id) on delete restrict;
alter table public.quiz_questions add column content_version_id uuid
  references private.vocabulary_question_content_versions(id) on delete restrict;
alter table public.assignment_question_exam_use_snapshot add column content_version_id uuid
  references private.vocabulary_question_content_versions(id) on delete restrict;
alter table private.student_word_practice_questions add column content_version_id uuid
  references private.vocabulary_question_content_versions(id) on delete restrict;

create function private.vocabulary_question_json_fields_v1(p_value jsonb,p_keys text[])
returns jsonb language sql immutable set search_path='' as $$
  select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) from jsonb_each(p_value) where key=any(p_keys);
$$;

create function private.vocabulary_question_binding_v1(q public.assignment_questions)
returns jsonb language sql immutable set search_path='' as $$
  select private.vocabulary_question_json_fields_v1(to_jsonb(q),array[
    'vocab_entry_id','dataset_id','direction','correct_choice_index','choice_vocab_entry_ids',
    'entry_row_sha256_snapshot','eligibility_quiz_mode','eligibility_input_hash_snapshot',
    'canonical_lexeme_id_snapshot','canonical_content_hash_snapshot','content_review_id_snapshot',
    'headword_normalized_snapshot','content_origin','eligibility_rule_version_snapshot',
    'generator_version_snapshot','provenance_status','composition_target_key_snapshot',
    'canonical_question_release_id_snapshot','canonical_question_item_id_snapshot','canonical_question_item_sha256_snapshot',
    'canonical_question_review_input_sha256_snapshot','canonical_question_review_policy_version_snapshot',
    'reviewed_exam_release_id_snapshot','reviewed_exam_item_id_snapshot','reviewed_exam_item_sha256_snapshot',
    'composition_version_id_snapshot','composition_item_id_snapshot','composition_item_sha256_snapshot']);
$$;

create function private.vocabulary_question_scope_v1(p_entry_ids bigint[])
returns uuid[] language sql stable set search_path='' as $$
  select coalesce(array_agg(distinct dataset_id order by dataset_id),'{}'::uuid[])
  from public.vocab_entries where id=any(p_entry_ids);
$$;

create function private.register_vocabulary_question_content_v1(
  p_kind text,p_dataset_ids uuid[],p_binding jsonb,p_payload jsonb,p_source_body_sha256 text default null)
returns uuid language plpgsql set search_path='' as $$
declare fingerprint text; existing private.vocabulary_question_content_versions; scope_ids uuid[];
begin
  if p_kind is null or p_kind not in ('assignment','standalone','exam-use','practice')
    or p_dataset_ids is null or array_position(p_dataset_ids,null) is not null
    or jsonb_typeof(p_binding) is distinct from 'object' or jsonb_typeof(p_payload) is distinct from 'object'
    then raise exception 'question_content_invalid' using errcode='22023'; end if;
  select coalesce(array_agg(distinct id order by id),'{}'::uuid[]) into scope_ids from unnest(p_dataset_ids) id;
  fingerprint:=encode(extensions.digest(jsonb_build_array(1,p_kind,scope_ids,p_binding,p_payload,p_source_body_sha256)::text,'sha256'),'hex');
  insert into private.vocabulary_question_content_versions(kind,dataset_ids,binding,payload,source_body_sha256,content_sha256)
    values(p_kind,scope_ids,p_binding,p_payload,p_source_body_sha256,fingerprint) on conflict(kind,content_sha256) do nothing;
  -- A separate statement sees the winning concurrent insert at READ COMMITTED.
  select * into existing from private.vocabulary_question_content_versions where kind=p_kind and content_sha256=fingerprint;
  if existing.id is null or existing.dataset_ids is distinct from scope_ids or existing.binding is distinct from p_binding
    or existing.payload is distinct from p_payload or existing.source_body_sha256 is distinct from p_source_body_sha256
    then raise exception 'question_content_conflict' using errcode='40001'; end if;
  return existing.id;
end;
$$;

create function private.vocabulary_question_bank_body_v1(b jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare item private.vocabulary_composition_items; reviewed private.reviewed_exam_items;
  canonical word_index.app_canonical_question_preview_item; result jsonb; count_sources integer;
begin
  count_sources:=num_nonnulls(b->>'composition_version_id_snapshot',b->>'reviewed_exam_release_id_snapshot',b->>'canonical_question_release_id_snapshot');
  if count_sources=0 then return null; end if;
  if count_sources<>1 then raise exception 'question_content_source_ambiguous' using errcode='23514'; end if;
  if b->>'composition_version_id_snapshot' is not null then
    select * into item from private.vocabulary_composition_items where version_id=(b->>'composition_version_id_snapshot')::uuid
      and item_id=b->>'composition_item_id_snapshot' and item_sha256=b->>'composition_item_sha256_snapshot';
    if item.item_id is null or item.dataset_id::text is distinct from b->>'dataset_id' or item.vocab_entry_id::text is distinct from b->>'vocab_entry_id'
      or item.direction::text is distinct from b->>'direction' or to_jsonb(item.choice_vocab_entry_ids) is distinct from b->'choice_vocab_entry_ids'
      or item.correct_choice_index::text is distinct from b->>'correct_choice_index'
      or item.quiz_mode is distinct from (case when b->>'eligibility_quiz_mode' in ('book_meaning_en_to_ko','book_meaning_ko_to_en')
        then 'book_meaning_choice' else b->>'eligibility_quiz_mode' end)
      then raise exception 'question_content_source_mismatch' using errcode='23514'; end if;
    result:=jsonb_build_object('prompt',item.prompt,'choices',to_jsonb(item.choice_texts),
      'composition_pronunciation_snapshot',item.pronunciation_snapshot,
      'provenance',item.source_proof||jsonb_build_object('promptRole',item.prompt_role,'choiceRole',item.choice_role));
  elsif b->>'reviewed_exam_release_id_snapshot' is not null then
    select * into reviewed from private.reviewed_exam_items where release_id=(b->>'reviewed_exam_release_id_snapshot')::uuid
      and item_id=b->>'reviewed_exam_item_id_snapshot' and item_sha256=b->>'reviewed_exam_item_sha256_snapshot';
    if reviewed.item_id is null or reviewed.dataset_id::text is distinct from b->>'dataset_id' or reviewed.vocab_entry_id::text is distinct from b->>'vocab_entry_id'
      or reviewed.direction::text is distinct from b->>'direction' or to_jsonb(reviewed.choice_vocab_entry_ids) is distinct from b->'choice_vocab_entry_ids'
      or reviewed.correct_choice_index::text is distinct from b->>'correct_choice_index'
      or reviewed.quiz_mode is distinct from (case when b->>'eligibility_quiz_mode' in ('book_meaning_en_to_ko','book_meaning_ko_to_en')
        then 'book_meaning_choice' else b->>'eligibility_quiz_mode' end)
      then raise exception 'question_content_source_mismatch' using errcode='23514'; end if;
    result:=jsonb_build_object('prompt',reviewed.prompt,'choices',to_jsonb(reviewed.choice_texts));
  else
    select * into canonical from word_index.app_canonical_question_preview_item where release_id=(b->>'canonical_question_release_id_snapshot')::uuid
      and question_item_id=b->>'canonical_question_item_id_snapshot' and question_item_sha256=b->>'canonical_question_item_sha256_snapshot';
    if canonical.question_item_id is null or canonical.dataset_id::text is distinct from b->>'dataset_id' or canonical.vocab_entry_id::text is distinct from b->>'vocab_entry_id'
      or b->>'direction' is distinct from 'korean_to_english' or to_jsonb(canonical.choice_vocab_entry_ids) is distinct from b->'choice_vocab_entry_ids'
      or canonical.correct_choice_index::text is distinct from b->>'correct_choice_index' or canonical.quiz_mode is distinct from b->>'eligibility_quiz_mode'
      then raise exception 'question_content_source_mismatch' using errcode='23514'; end if;
    result:=jsonb_build_object('prompt',canonical.prompt_en,'choices',to_jsonb(canonical.choice_headwords));
  end if;
  return result;
end;
$$;

create function private.vocabulary_question_content_payload_v1(v private.vocabulary_question_content_versions)
returns jsonb language plpgsql stable set search_path='' as $$
declare bank jsonb;
begin
  if v.id is null or v.content_sha256 is distinct from encode(extensions.digest(
    jsonb_build_array(1,v.kind,v.dataset_ids,v.binding,v.payload,v.source_body_sha256)::text,'sha256'),'hex')
    then raise exception 'question_content_unavailable' using errcode='55000'; end if;
  if v.source_body_sha256 is null then return v.payload; end if;
  bank:=private.vocabulary_question_bank_body_v1(v.binding);
  if bank is null or encode(extensions.digest(bank::text,'sha256'),'hex') is distinct from v.source_body_sha256
    or exists(select 1 from jsonb_object_keys(bank) k where v.payload ? k)
    then raise exception 'question_content_source_changed' using errcode='55000'; end if;
  return v.payload||bank;
end;
$$;

create function private.register_assignment_question_content_v1(q public.assignment_questions)
returns uuid language plpgsql set search_path='' as $$
declare binding jsonb; payload jsonb; bank jsonb; source_sha text; keys text[]; study jsonb;
begin
  binding:=private.vocabulary_question_binding_v1(q);
  payload:=private.vocabulary_question_json_fields_v1(to_jsonb(q),array['prompt','choices','headword_snapshot','primary_meaning_snapshot',
    'correct_answer_snapshot','composition_pronunciation_snapshot','notebook_pronunciation_snapshot']);
  if q.provenance_status='notebook_snapshot_v1' then
    study:=q.notebook_source_snapshot->'study';
    if study is not null and (jsonb_typeof(study) is distinct from 'object' or study-array[
      'entryId','currentHeadword','snapshotDisplayKo','dictionaryId','releaseId','displayKo','pronunciationSnapshot',
      'compositionPronunciation','notebookPronunciation','definition','example','exampleKo']<>'{}'::jsonb)
      then raise exception 'question_content_study_invalid' using errcode='22023'; end if;
    payload:=payload||jsonb_build_object('notebook_study',study);
  else payload:=payload||jsonb_build_object('provenance',q.provenance); end if;
  bank:=private.vocabulary_question_bank_body_v1(binding);
  if bank is not null then
    if exists(select 1 from jsonb_each(bank) e where payload->e.key is distinct from e.value)
      then raise exception 'question_content_source_mismatch' using errcode='23514'; end if;
    select array_agg(k) into keys from jsonb_object_keys(bank) k;
    payload:=payload-keys;
    source_sha:=encode(extensions.digest(bank::text,'sha256'),'hex');
  end if;
  return private.register_vocabulary_question_content_v1('assignment',
    private.vocabulary_question_scope_v1(array[q.vocab_entry_id]||coalesce(q.choice_vocab_entry_ids,'{}'::bigint[])),binding,payload,source_sha);
end;
$$;

create function private.resolve_assignment_question_content_v1(q public.assignment_questions)
returns public.assignment_questions language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions; payload jsonb; result public.assignment_questions;
begin
  if q.content_version_id is null then return q; end if;
  select * into material from private.vocabulary_question_content_versions where id=q.content_version_id;
  if material.id is null or material.kind<>'assignment' or material.binding is distinct from private.vocabulary_question_binding_v1(q)
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  payload:=private.vocabulary_question_content_payload_v1(material);
  result:=jsonb_populate_record(q,payload-'notebook_study');
  if q.provenance_status='notebook_snapshot_v1' then
    result.notebook_source_snapshot:=q.notebook_source_snapshot||jsonb_build_object('study',payload->'notebook_study');
  end if;
  return result;
end;
$$;

-- Internal-only compatibility relation. No ownership or row-lock query is
-- replaced by this relation. Public readers check the personal context first.
do $migration$
declare projection text;
begin
  select string_agg(format('%I.%I',case when attname=any(array['prompt','choices','headword_snapshot','primary_meaning_snapshot',
    'correct_answer_snapshot','provenance','composition_pronunciation_snapshot','notebook_pronunciation_snapshot','notebook_source_snapshot'])
    then 'resolved' else 'q' end,attname),',' order by attnum) into projection from pg_attribute
    where attrelid='public.assignment_questions'::regclass and attnum>0 and not attisdropped;
  execute 'create view private.assignment_question_contents_v1 as select '||projection||
    ' from public.assignment_questions q cross join lateral private.resolve_assignment_question_content_v1(q) resolved';
end;
$migration$;
revoke all on private.assignment_question_contents_v1 from public,anon,authenticated,service_role;

revoke all on function
  private.vocabulary_question_json_fields_v1(jsonb,text[]),
  private.vocabulary_question_binding_v1(public.assignment_questions),
  private.vocabulary_question_scope_v1(bigint[]),
  private.register_vocabulary_question_content_v1(text,uuid[],jsonb,jsonb,text),
  private.vocabulary_question_bank_body_v1(jsonb),
  private.vocabulary_question_content_payload_v1(private.vocabulary_question_content_versions),
  private.register_assignment_question_content_v1(public.assignment_questions),
  private.resolve_assignment_question_content_v1(public.assignment_questions)
from public,anon,authenticated,service_role;

-- Move only body-dependent CHECKs to an equivalent check of the resolved row.
-- All original FK/UNIQUE constraints and small-column CHECKs remain in place.
do $migration$
declare spec record; constraint_row record; expressions text[]; condition_columns smallint[]; body text; missing text;
begin
  perform set_config('search_path','',true);
  for spec in select * from (values
    ('public.assignment_questions','assert_assignment_question_body_v1',array['prompt','choices','headword_snapshot','primary_meaning_snapshot','correct_answer_snapshot','provenance','composition_pronunciation_snapshot','notebook_pronunciation_snapshot']),
    ('public.assignment_question_exam_use_snapshot','assert_exam_use_question_body_v1',array['headword_snapshot','primary_meaning_snapshot','display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots'])
  ) t(relation_name,function_name,body_columns) loop
    expressions:='{}';
    select array_agg(attnum) into condition_columns from pg_attribute where attrelid=spec.relation_name::regclass and attname=any(spec.body_columns);
    for constraint_row in select c.conname,pg_get_expr(c.conbin,c.conrelid) expression
      from pg_constraint c where c.conrelid=spec.relation_name::regclass and c.contype='c' order by c.conname loop
      expressions:=array_append(expressions,format('case when (%s) is false then %L::text end',constraint_row.expression,constraint_row.conname));
    end loop;
    select string_agg(format('q.%I is null',attname),' or ') into missing from pg_attribute
      where attrelid=spec.relation_name::regclass and attname=any(spec.body_columns) and attnotnull;
    body:=format('declare failures text[]; begin if %s then raise exception ''question_body_not_null'' using errcode=''23502''; end if;
      select array_remove(array[%s],null::text) into failures from (select (q).*) original_row;
      if cardinality(failures)>0 then raise exception ''question_body_constraint_violation: %%'',failures[1] using errcode=''23514'',constraint=failures[1]; end if; end;',missing,array_to_string(expressions,','));
    execute format('create function private.%I(q %s) returns void language plpgsql set search_path='''' as %L',spec.function_name,spec.relation_name,body);
    execute format('revoke all on function private.%I(%s) from public,anon,authenticated,service_role',spec.function_name,spec.relation_name);
    for constraint_row in select conname from pg_constraint where conrelid=spec.relation_name::regclass and contype='c' and conkey&&condition_columns loop
      execute format('alter table %s drop constraint %I',spec.relation_name,constraint_row.conname);
    end loop;
    for constraint_row in select attname from pg_attribute where attrelid=spec.relation_name::regclass and attname=any(spec.body_columns) and attnotnull loop
      execute format('alter table %s alter column %I drop not null',spec.relation_name,constraint_row.attname);
    end loop;
  end loop;
end;
$migration$;

create function private.exam_use_question_binding_v1(q public.assignment_question_exam_use_snapshot)
returns jsonb language sql stable set search_path='' as $$
  select private.vocabulary_question_json_fields_v1(to_jsonb(q),array['dataset_id','vocab_entry_id','release_id','dictionary_id',
    'occurrence_id','sense_id','pronunciation_variant_id','exam_review_id','occurrence_content_hash','provenance_status'])
    ||jsonb_build_object('question_binding',private.vocabulary_question_binding_v1(a))
  from public.assignment_questions a where a.id=q.assignment_question_id and a.assignment_id=q.assignment_id;
$$;
create function private.resolve_exam_use_question_content_v1(q public.assignment_question_exam_use_snapshot)
returns public.assignment_question_exam_use_snapshot language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions;
begin
  if q.content_version_id is null then return q; end if;
  select * into material from private.vocabulary_question_content_versions where id=q.content_version_id;
  if material.id is null or material.kind<>'exam-use' or material.binding is distinct from private.exam_use_question_binding_v1(q)
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  return jsonb_populate_record(q,private.vocabulary_question_content_payload_v1(material));
end;
$$;
do $migration$
declare projection text;
begin
  select string_agg(format('%I.%I',case when attname=any(array['headword_snapshot','primary_meaning_snapshot',
    'display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots']) then 'resolved' else 'q' end,attname),',' order by attnum)
    into projection from pg_attribute where attrelid='public.assignment_question_exam_use_snapshot'::regclass and attnum>0 and not attisdropped;
  execute 'create view private.exam_use_question_contents_v1 as select '||projection||
    ' from public.assignment_question_exam_use_snapshot q cross join lateral private.resolve_exam_use_question_content_v1(q) resolved';
end;
$migration$;
revoke all on private.exam_use_question_contents_v1 from public,anon,authenticated,service_role;

create function private.freeze_assignment_question_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved public.assignment_questions; fields text[]:=array['prompt','choices','headword_snapshot','primary_meaning_snapshot',
  'correct_answer_snapshot','composition_pronunciation_snapshot','notebook_pronunciation_snapshot'];
begin
  if tg_op='UPDATE' and old.content_version_id is not null and to_jsonb(new) is distinct from to_jsonb(old)
    then raise exception 'question_content_reference_immutable' using errcode='55000'; end if;
  if new.content_version_id is null and tg_op='INSERT' and new.provenance_status='notebook_snapshot_v1' then
    -- Prior choice and private-source triggers have already run on the full row.
    perform private.assert_assignment_question_body_v1(new);
    new.content_version_id:=private.register_assignment_question_content_v1(new);
  end if;
  if new.content_version_id is null then perform private.assert_assignment_question_body_v1(new); return new; end if;
  resolved:=private.resolve_assignment_question_content_v1(new);
  if new.provenance_status<>'notebook_snapshot_v1' then fields:=array_append(fields,'provenance'); end if;
  if exists(select 1 from jsonb_each(private.vocabulary_question_json_fields_v1(to_jsonb(new),fields)) e
    where e.value<>'null'::jsonb and e.value is distinct from to_jsonb(resolved)->e.key)
    then raise exception 'question_content_body_mismatch' using errcode='23514'; end if;
  perform private.assert_assignment_question_body_v1(resolved);
  new.prompt:=null; new.choices:=null; new.headword_snapshot:=null; new.primary_meaning_snapshot:=null;
  new.correct_answer_snapshot:=null; new.composition_pronunciation_snapshot:=null; new.notebook_pronunciation_snapshot:=null;
  if new.provenance_status='notebook_snapshot_v1' then new.notebook_source_snapshot:=new.notebook_source_snapshot-'study';
  else new.provenance:=null; end if;
  return new;
end;
$$;
create trigger zzz_freeze_assignment_question_content before insert or update on public.assignment_questions
  for each row execute function private.freeze_assignment_question_content_v1();
alter table public.assignment_questions add constraint assignment_question_content_storage check(
  (content_version_id is null and prompt is not null and choices is not null) or
  (content_version_id is not null and prompt is null and choices is null and headword_snapshot is null and primary_meaning_snapshot is null
    and correct_answer_snapshot is null and composition_pronunciation_snapshot is null and notebook_pronunciation_snapshot is null
    and (provenance_status='notebook_snapshot_v1' or provenance is null)));

create function private.freeze_exam_use_question_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved public.assignment_question_exam_use_snapshot;
begin
  if tg_op='UPDATE' and old.content_version_id is not null and to_jsonb(new) is distinct from to_jsonb(old)
    then raise exception 'question_content_reference_immutable' using errcode='55000'; end if;
  resolved:=private.resolve_exam_use_question_content_v1(new);
  perform private.assert_exam_use_question_body_v1(resolved);
  if new.content_version_id is null then return new; end if;
  if exists(select 1 from jsonb_each(private.vocabulary_question_json_fields_v1(to_jsonb(new),array[
    'headword_snapshot','primary_meaning_snapshot','display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots'])) e
    where e.value<>'null'::jsonb and e.value is distinct from to_jsonb(resolved)->e.key)
    then raise exception 'question_content_body_mismatch' using errcode='23514'; end if;
  new.headword_snapshot:=null; new.primary_meaning_snapshot:=null; new.display_pronunciation_ko_snapshot:=null;
  new.pronunciation_snapshot:=null; new.choice_dictionary_snapshots:=null;
  return new;
end;
$$;
create trigger zzz_freeze_exam_use_question_content before insert or update on public.assignment_question_exam_use_snapshot
  for each row execute function private.freeze_exam_use_question_content_v1();
alter table public.assignment_question_exam_use_snapshot add constraint exam_use_question_content_storage check(
  (content_version_id is null and headword_snapshot is not null and primary_meaning_snapshot is not null
    and pronunciation_snapshot is not null and choice_dictionary_snapshots is not null) or
  (content_version_id is not null and headword_snapshot is null and primary_meaning_snapshot is null
    and display_pronunciation_ko_snapshot is null and pronunciation_snapshot is null and choice_dictionary_snapshots is null));

create function private.finalize_assignment_question_body_refs_v1(p_assignment_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare question public.assignment_questions; snapshot public.assignment_question_exam_use_snapshot; reference uuid;
begin
  -- Only newly created banks call this function, after all creation checks. No
  -- scan/backfill of historical assignments occurs in this migration.
  for question in select * from public.assignment_questions where assignment_id=p_assignment_id and content_version_id is null order by base_order_index for update loop
    if question.provenance_status='notebook_snapshot_v1' then raise exception 'notebook_content_requires_insert' using errcode='55000'; end if;
    perform private.assert_assignment_question_body_v1(question);
    reference:=private.register_assignment_question_content_v1(question);
    update public.assignment_questions set content_version_id=reference where id=question.id;
  end loop;
  for snapshot in select * from public.assignment_question_exam_use_snapshot where assignment_id=p_assignment_id and content_version_id is null order by assignment_question_id for update loop
    perform private.assert_exam_use_question_body_v1(snapshot);
    reference:=private.register_vocabulary_question_content_v1('exam-use',array[snapshot.dataset_id],private.exam_use_question_binding_v1(snapshot),
      private.vocabulary_question_json_fields_v1(to_jsonb(snapshot),array['headword_snapshot','primary_meaning_snapshot',
        'display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots']));
    update public.assignment_question_exam_use_snapshot set content_version_id=reference where assignment_question_id=snapshot.assignment_question_id;
  end loop;
  return p_assignment_id;
end;
$$;

-- Direct inserts containing an already frozen reference must still pass the
-- original reviewed-choice policy using the reconstructed values.
create or replace function private.guard_assignment_reviewed_choices_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy jsonb; resolved public.assignment_questions;
begin
  resolved:=private.resolve_assignment_question_content_v1(new);
  policy:=private.vocabulary_entry_choice_safety_v1(resolved.vocab_entry_id);
  if policy is not null and resolved.prompt is distinct from (case resolved.direction when 'english_to_korean' then policy#>>'{target,headword}' else policy#>>'{target,primaryMeaning}' end)
    then raise exception 'reviewed_choice_prompt_mismatch' using errcode='22023'; end if;
  perform private.assert_reviewed_choice_texts_v1(policy,resolved.direction::text,resolved.choices,resolved.correct_choice_index);
  return new;
end;
$$;

revoke all on function
  private.exam_use_question_binding_v1(public.assignment_question_exam_use_snapshot),
  private.resolve_exam_use_question_content_v1(public.assignment_question_exam_use_snapshot),
  private.freeze_assignment_question_content_v1(),private.freeze_exam_use_question_content_v1(),
  private.finalize_assignment_question_body_refs_v1(uuid)
from public,anon,authenticated,service_role;

create function private.register_quiz_question_content_v1(q public.quiz_questions,p_assignment_id uuid)
returns uuid language plpgsql set search_path='' as $$
declare bank public.assignment_questions; frozen public.assignment_questions; dataset uuid; binding jsonb;
begin
  if q.prompt is null or char_length(btrim(q.prompt))=0 or jsonb_typeof(q.choices) is distinct from 'array'
    or jsonb_array_length(q.choices)<>4 or q.direction is null or q.correct_choice_index is null or q.correct_choice_index not between 0 and 3
    then raise exception 'question_content_body_invalid' using errcode='23514'; end if;
  if q.assignment_question_id is not null then
    select * into bank from public.assignment_questions where id=q.assignment_question_id and assignment_id=p_assignment_id;
    if bank.id is null then raise exception 'question_content_assignment_mismatch' using errcode='23514'; end if;
    frozen:=private.resolve_assignment_question_content_v1(bank);
    if (frozen.vocab_entry_id,frozen.direction,frozen.correct_choice_index,frozen.prompt,frozen.choices)
      is distinct from (q.vocab_entry_id,q.direction,q.correct_choice_index,q.prompt,q.choices)
      then raise exception 'question_content_body_mismatch' using errcode='23514'; end if;
    return coalesce(bank.content_version_id,private.register_assignment_question_content_v1(frozen));
  end if;
  select dataset_id into dataset from public.vocab_entries where id=q.vocab_entry_id;
  if dataset is null then raise exception 'question_content_entry_unavailable' using errcode='23514'; end if;
  binding:=jsonb_build_object('dataset_id',dataset,'vocab_entry_id',q.vocab_entry_id,'direction',q.direction,
    'correct_choice_index',q.correct_choice_index,'storage_rule','legacy-quiz-body-v1');
  return private.register_vocabulary_question_content_v1('standalone',array[dataset],binding,jsonb_build_object('prompt',q.prompt,'choices',q.choices));
end;
$$;

create function private.resolve_quiz_question_content_v1(q public.quiz_questions)
returns public.quiz_questions language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions; payload jsonb; bank public.assignment_questions;
begin
  if q.content_version_id is null then return q; end if;
  select * into material from private.vocabulary_question_content_versions where id=q.content_version_id;
  if material.id is null or material.kind not in ('assignment','standalone')
    or material.binding->>'vocab_entry_id' is distinct from q.vocab_entry_id::text
    or material.binding->>'direction' is distinct from q.direction::text
    or material.binding->>'correct_choice_index' is distinct from q.correct_choice_index::text
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  if q.assignment_question_id is not null then
    select * into bank from public.assignment_questions where id=q.assignment_question_id;
    if bank.id is null or (bank.content_version_id is not null and bank.content_version_id is distinct from q.content_version_id)
      or material.kind<>'assignment' or material.binding is distinct from private.vocabulary_question_binding_v1(bank)
      then raise exception 'question_content_assignment_mismatch' using errcode='55000'; end if;
  elsif material.kind<>'standalone' then raise exception 'question_content_assignment_mismatch' using errcode='55000'; end if;
  payload:=private.vocabulary_question_content_payload_v1(material);
  q.prompt:=payload->>'prompt'; q.choices:=payload->'choices';
  if q.prompt is null or jsonb_typeof(q.choices) is distinct from 'array' or jsonb_array_length(q.choices)<>4
    then raise exception 'question_content_unavailable' using errcode='55000'; end if;
  return q;
end;
$$;

create function private.freeze_quiz_question_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare resolved public.quiz_questions; assignment uuid; bank public.assignment_questions;
begin
  if tg_op='UPDATE' then
    if old.content_version_id is not null and (new.content_version_id,new.assignment_question_id,new.attempt_id,new.vocab_entry_id,
      new.order_index,new.direction,new.prompt,new.choices,new.correct_choice_index)
      is distinct from (old.content_version_id,old.assignment_question_id,old.attempt_id,old.vocab_entry_id,
      old.order_index,old.direction,old.prompt,old.choices,old.correct_choice_index)
      then raise exception 'question_content_reference_immutable' using errcode='55000'; end if;
    -- Do not migrate any existing inline question through an unrelated update.
    if old.content_version_id is null and new.content_version_id is null then return new; end if;
  end if;
  select assignment_id into assignment from public.quiz_attempts where id=new.attempt_id;
  if assignment is null then raise exception 'question_content_attempt_unavailable' using errcode='23503'; end if;
  if new.assignment_question_id is not null and not exists(select 1 from public.assignment_questions
    where id=new.assignment_question_id and assignment_id=assignment)
    then raise exception 'question_content_assignment_mismatch' using errcode='23514'; end if;
  if new.content_version_id is null then new.content_version_id:=private.register_quiz_question_content_v1(new,assignment); end if;
  resolved:=private.resolve_quiz_question_content_v1(new);
  -- A supplied reference must also match an inline historical bank's body;
  -- equal word/direction/choice IDs alone do not prove equal display values.
  if tg_op='INSERT' and new.assignment_question_id is not null then
    select * into bank from public.assignment_questions where id=new.assignment_question_id;
    if bank.content_version_id is null and (bank.prompt,bank.choices) is distinct from (resolved.prompt,resolved.choices)
      then raise exception 'question_content_body_mismatch' using errcode='23514'; end if;
  end if;
  if (new.prompt is not null and new.prompt is distinct from resolved.prompt)
    or (new.choices is not null and new.choices is distinct from resolved.choices)
    then raise exception 'question_content_body_mismatch' using errcode='23514'; end if;
  new.prompt:=null; new.choices:=null;
  return new;
end;
$$;
alter table public.quiz_questions alter column prompt drop not null,alter column choices drop not null;
create trigger zzz_freeze_quiz_question_content before insert or update of content_version_id,assignment_question_id,attempt_id,vocab_entry_id,order_index,direction,prompt,choices,correct_choice_index
  on public.quiz_questions for each row execute function private.freeze_quiz_question_content_v1();
alter table public.quiz_questions add constraint quiz_question_content_storage check(
  (content_version_id is null and prompt is not null and choices is not null) or
  (content_version_id is not null and prompt is null and choices is null));
do $migration$
declare projection text;
begin
  select string_agg(format('%I.%I',case when attname=any(array['prompt','choices']) then 'resolved' else 'q' end,attname),',' order by attnum)
    into projection from pg_attribute where attrelid='public.quiz_questions'::regclass and attnum>0 and not attisdropped;
  execute 'create view private.quiz_question_contents_v1 as select '||projection||
    ' from public.quiz_questions q cross join lateral private.resolve_quiz_question_content_v1(q) resolved';
end;
$migration$;
revoke all on private.quiz_question_contents_v1 from public,anon,authenticated,service_role;

-- Preserve the exact pre-M02 JSON shape used in old prepared receipts and
-- signed wrong-review confirmations. All keys except the new column remain.
create or replace function private.quiz_preparation_fingerprint(a public.assignments)
returns text language sql stable security definer set search_path='' as $$
  select encode(extensions.digest((to_jsonb(a)||jsonb_build_object('source',
    case when a.range_basis='units' and a.question_bank_version is not null then
      (select coalesce(jsonb_agg(to_jsonb(private.resolve_assignment_question_content_v1(q))-'content_version_id' order by q.id),'[]')
       from public.assignment_questions q where q.assignment_id=a.id)
    else (select coalesce(jsonb_agg(jsonb_build_array(e.id,e.source_row,e.headword,e.headword_normalized,e.primary_meaning) order by e.id),'[]')
      from public.vocab_entries e where e.dataset_id=a.dataset_id and e.source_row between a.range_start and a.range_end)
    end))::text,'sha256'),'hex');
$$;
do $migration$
declare definition text; changed text; signature regprocedure;
begin
  signature:='private.current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[])'::regprocedure;
  definition:=pg_get_functiondef(signature);
  changed:=replace(definition,'jsonb_agg(to_jsonb(q) order by q.id)','jsonb_agg(to_jsonb(private.resolve_quiz_question_content_v1(q))-''content_version_id'' order by q.id)');
  if changed=definition or (length(definition)-length(replace(definition,'jsonb_agg(to_jsonb(q) order by q.id)','')))/length('jsonb_agg(to_jsonb(q) order by q.id)')<>1
    then raise exception 'm02_wrong_review_fingerprint_contract_changed'; end if;
  execute changed;
end;
$migration$;

revoke all on function private.register_quiz_question_content_v1(public.quiz_questions,uuid),
  private.resolve_quiz_question_content_v1(public.quiz_questions),private.freeze_quiz_question_content_v1()
from public,anon,authenticated,service_role;

create function private.compact_initial_quiz_plan_v2(p_assignment_id uuid,p_plan jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; question public.quiz_questions; reference uuid; result jsonb:='[]';
begin
  if jsonb_typeof(p_plan)='object' and p_plan->>'contentStorageVersion'='2' then return p_plan; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' then raise exception 'question_preparation_format_invalid' using errcode='55000'; end if;
  for item in select value from jsonb_array_elements(p_plan) loop
    question:=jsonb_populate_record(null::public.quiz_questions,item);
    reference:=private.register_quiz_question_content_v1(question,p_assignment_id);
    result:=result||jsonb_build_array((item-array['prompt','choices'])||jsonb_build_object('content_version_id',reference));
  end loop;
  return jsonb_build_object('contentStorageVersion',2,'questions',result);
end;
$$;

create function private.resolve_quiz_preparation_plan_v2(p private.quiz_attempt_preparations,p_include_storage_ref boolean default false)
returns jsonb language plpgsql stable set search_path='' as $$
declare item jsonb; question public.quiz_questions; result jsonb:='[]';
begin
  if p.kind='practice' then return p.plan; end if;
  if jsonb_typeof(p.plan)='array' then return p.plan; end if;
  if p.plan->>'contentStorageVersion' is distinct from '2' or jsonb_typeof(p.plan->'questions') is distinct from 'array'
    then raise exception 'question_preparation_format_invalid' using errcode='55000'; end if;
  for item in select value from jsonb_array_elements(p.plan->'questions') loop
    question:=jsonb_populate_record(null::public.quiz_questions,item);
    if question.content_version_id is null or (question.assignment_question_id is not null and not exists(select 1
      from public.assignment_questions where id=question.assignment_question_id and assignment_id=p.assignment_id))
      then raise exception 'question_preparation_binding_mismatch' using errcode='55000'; end if;
    question:=private.resolve_quiz_question_content_v1(question);
    if not p_include_storage_ref then item:=item-'content_version_id'; end if;
    result:=result||jsonb_build_array(item||jsonb_build_object('prompt',question.prompt,'choices',question.choices));
  end loop;
  return result;
end;
$$;

create function private.guard_quiz_preparation_content_v2()
returns trigger language plpgsql set search_path='' as $$
begin
  if old.plan->>'contentStorageVersion'='2' and (new.student_id,new.assignment_id,new.kind,new.request_key,new.request_hash,new.fingerprint,new.plan)
    is distinct from (old.student_id,old.assignment_id,old.kind,old.request_key,old.request_hash,old.fingerprint,old.plan)
    then raise exception 'question_preparation_immutable' using errcode='55000'; end if;
  return new;
end;
$$;
create trigger quiz_preparation_content_immutable before update on private.quiz_attempt_preparations
  for each row execute function private.guard_quiz_preparation_content_v2();

do $migration$
declare edit record; definition text; changed text; actual integer;
begin
  for edit in select * from (values
    ('public.prepare_quiz_attempt_v1(uuid,uuid,jsonb)','from public.assignment_questions b','from private.assignment_question_contents_v1 b',1),
    ('public.prepare_quiz_attempt_v1(uuid,uuid,jsonb)','fingerprint,plan) returning id into existing','fingerprint,private.compact_initial_quiz_plan_v2(p_assignment_id,plan)) returning id into existing',1),
    ('public.get_quiz_preparation_v1(uuid,uuid)', '''plan'',p.plan,''begunId''', '''plan'',private.resolve_quiz_preparation_plan_v2(p),''begunId''',2),
    ('public.begin_prepared_quiz_v1(uuid,uuid)','  select coalesce(max(attempt_number),0)+1 into next_number',E'  p.plan:=private.compact_initial_quiz_plan_v2(p.assignment_id,p.plan);\n  select coalesce(max(attempt_number),0)+1 into next_number',1),
    ('public.begin_prepared_quiz_v1(uuid,uuid)','insert into public.quiz_questions(id,attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index)',
      'insert into public.quiz_questions(id,attempt_id,vocab_entry_id,assignment_question_id,order_index,direction,prompt,choices,correct_choice_index,content_version_id)',1),
    ('public.begin_prepared_quiz_v1(uuid,uuid)',
      '(q->>''correct_choice_index'')::smallint from jsonb_array_elements(p.plan) q',
      '(q->>''correct_choice_index'')::smallint,(q->>''content_version_id'')::uuid from jsonb_array_elements(private.resolve_quiz_preparation_plan_v2(p,true)) q',1)
  ) changes(signature,needle,replacement,expected) loop
    definition:=pg_get_functiondef(edit.signature::regprocedure);
    actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if actual<>edit.expected then raise exception 'm02_preparation_contract_changed: %, %',edit.signature,actual; end if;
    changed:=replace(definition,edit.needle,edit.replacement);
    execute changed;
  end loop;
end;
$migration$;
-- These three service-only entrypoints already assert the active student and
-- assignment relationship before reading any private content. Their ACLs stay
-- unchanged; do not grant the private storage to service_role to fix access.
alter function public.prepare_quiz_attempt_v1(uuid,uuid,jsonb) security definer;
alter function public.get_quiz_preparation_v1(uuid,uuid) security definer;
alter function public.begin_prepared_quiz_v1(uuid,uuid) security definer;
revoke all on function private.compact_initial_quiz_plan_v2(uuid,jsonb),
  private.resolve_quiz_preparation_plan_v2(private.quiz_attempt_preparations,boolean),private.guard_quiz_preparation_content_v2()
from public,anon,authenticated,service_role;

create function private.attach_quiz_question_content_refs_v1(p_assignment_id uuid,p_questions jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; question public.quiz_questions; result jsonb:='[]';
begin
  for item in select value from jsonb_array_elements(p_questions) loop
    question:=jsonb_populate_record(null::public.quiz_questions,item);
    result:=result||jsonb_build_array(item||jsonb_build_object('content_version_id',private.register_quiz_question_content_v1(question,p_assignment_id)));
  end loop;
  return result;
end;
$$;
revoke all on function private.attach_quiz_question_content_refs_v1(uuid,jsonb) from public,anon,authenticated,service_role;

-- Compatibility starts still use their original admission, locks, order and
-- clock policy. Register bodies before inserting the timed attempt, and keep
-- post-insert payload validation on the reconstructed body.
do $migration$
declare edit record; definition text; actual integer;
begin
  for edit in select * from (values
    ('public.create_quiz_attempt(uuid,uuid,jsonb)',E'begin\n  if p_questions',E'begin\n  if auth.role() is distinct from ''service_role'' then raise exception ''service_required'' using errcode=''42501''; end if;\n  if p_questions',1),
    ('public.create_quiz_attempt(uuid,uuid,jsonb)','  insert into public.quiz_attempts (',E'  p_questions:=private.attach_quiz_question_content_refs_v1(p_assignment_id,p_questions);\n  insert into public.quiz_attempts (',1),
    ('public.create_quiz_attempt(uuid,uuid,jsonb)',E'    correct_choice_index\n  )\n  select',E'    correct_choice_index,\n    content_version_id\n  )\n  select',1),
    ('public.create_quiz_attempt(uuid,uuid,jsonb)',E'    question.correct_choice_index\n  from jsonb_to_recordset',E'    question.correct_choice_index,\n    question.content_version_id\n  from jsonb_to_recordset',1),
    ('public.create_quiz_attempt(uuid,uuid,jsonb)',E'    correct_choice_index smallint\n  );',E'    correct_choice_index smallint,\n    content_version_id uuid\n  );',1),
    ('public.create_quiz_attempt(uuid,uuid,jsonb)','from public.quiz_questions as quiz_question','from private.quiz_question_contents_v1 as quiz_question',1),
    ('public.create_quiz_attempt_from_bank(uuid,uuid)',E'begin\n  perform 1',E'begin\n  if auth.role() is distinct from ''service_role'' then raise exception ''service_required'' using errcode=''42501''; end if;\n  perform 1',1),
    ('public.create_quiz_attempt_from_bank(uuid,uuid)','  inserted_question_count integer;',E'  inserted_question_count integer;\n  bank_refs jsonb;',1),
    ('public.create_quiz_attempt_from_bank(uuid,uuid)','  insert into public.quiz_attempts (',E'  select jsonb_object_agg(q.id,coalesce(q.content_version_id,private.register_assignment_question_content_v1(private.resolve_assignment_question_content_v1(q))))\n    into bank_refs from public.assignment_questions q where q.assignment_id=p_assignment_id;\n  insert into public.quiz_attempts (',1),
    ('public.create_quiz_attempt_from_bank(uuid,uuid)',E'    correct_choice_index\n  )\n  select',E'    correct_choice_index,\n    content_version_id\n  )\n  select',1),
    ('public.create_quiz_attempt_from_bank(uuid,uuid)',E'    question.correct_choice_index\n  from ordered_bank as question;',E'    question.correct_choice_index,\n    (bank_refs->>question.id::text)::uuid\n  from ordered_bank as question;',1)
  ) changes(signature,needle,replacement,expected) loop
    definition:=pg_get_functiondef(edit.signature::regprocedure);
    actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if actual<>edit.expected then raise exception 'm02_compatibility_start_contract_changed: %, %',edit.signature,actual; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end;
$migration$;
alter function public.create_quiz_attempt(uuid,uuid,jsonb) security definer;
alter function public.create_quiz_attempt_from_bank(uuid,uuid) security definer;

-- Connect the final validated writer boundaries and body-only SQL readers.
-- Each edit is pinned to its exact old context. Locks, admission, scoring and
-- the small-column active CTEs continue reading the original relations.
do $migration$
declare edit record; definition text; actual integer;
begin
  for edit in select * from (values
    ('private.create_assignment_with_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)','return private.create_assignment_with_question_bank_v3(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );','return private.finalize_assignment_question_body_refs_v1(private.create_assignment_with_question_bank_v3(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    ));',1),
    ('private.create_assignment_with_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)','return private.create_assignment_with_exam_use_question_bank_v1(
    active_release_id,
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  );','return private.finalize_assignment_question_body_refs_v1(private.create_assignment_with_exam_use_question_bank_v1(
    active_release_id,
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  ));',1),
    ('private.create_assignment_with_question_bank_dispatch_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)','return private.create_assignment_with_question_bank_v3_system_v1(
      p_actor_admin_id,
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    );','return private.finalize_assignment_question_body_refs_v1(private.create_assignment_with_question_bank_v3_system_v1(
      p_actor_admin_id,
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_available_until,
      p_student_ids,
      p_questions
    ));',1),
    ('private.create_assignment_with_question_bank_dispatch_system_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)','return private.create_assignment_with_exam_use_question_bank_system_v1(
    p_actor_admin_id,
    active_release_id,
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  );','return private.finalize_assignment_question_body_refs_v1(private.create_assignment_with_exam_use_question_bank_system_v1(
    p_actor_admin_id,
    active_release_id,
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_available_until,
    p_student_ids,
    p_questions
  ));',1),
    ('private.create_exact_review_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],jsonb)','return created_assignment_id;','return private.finalize_assignment_question_body_refs_v1(created_assignment_id);',1),
    ('private.create_reviewed_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb,boolean)','return assignment_value;','return private.finalize_assignment_question_body_refs_v1(assignment_value);',2),
    ('private.create_composition_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb,boolean)','return assignment_value;','return private.finalize_assignment_question_body_refs_v1(assignment_value);',1),
    ('private.create_assignment_with_canonical_question_bank_preview_v1(text,uuid,uuid[],integer,integer,smallint,boolean,smallint,public.question_order_mode,uuid,text,integer,text,uuid,text,jsonb)','return created_assignment_id;','return private.finalize_assignment_question_body_refs_v1(created_assignment_id);',1),
    ('private.student_assignment_study_content_v1(uuid,uuid)','    from permitted a
    join public.assignment_questions q on q.assignment_id = a.id
    join public.vocab_entries e on e.id = q.vocab_entry_id','    from permitted a
    join private.assignment_question_contents_v1 q on q.assignment_id = a.id
    join public.vocab_entries e on e.id = q.vocab_entry_id',1),
    ('private.student_assignment_study_content_v1(uuid,uuid)','    left join public.assignment_question_exam_use_snapshot s
      on s.assignment_question_id = q.id and s.provenance_status = ''reviewed_for_preview_v1''','    left join private.exam_use_question_contents_v1 s
      on s.assignment_question_id = q.id and s.provenance_status = ''reviewed_for_preview_v1''',1),
    ('public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text)','    left join public.assignment_questions aq on aq.id = q.assignment_question_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id','    left join private.assignment_question_contents_v1 aq on aq.id = q.assignment_question_id
    left join private.exam_use_question_contents_v1 exam on exam.assignment_question_id = aq.id',1),
    ('private.wrong_word_notebook_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer)','    left join public.assignment_questions aq on aq.id = q.assignment_question_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id','    left join private.assignment_question_contents_v1 aq on aq.id = q.assignment_question_id
    left join private.exam_use_question_contents_v1 exam on exam.assignment_question_id = aq.id',1),
    ('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])','    left join public.assignment_questions aq on aq.id = q.assignment_question_id
    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id','    left join private.assignment_question_contents_v1 aq on aq.id = q.assignment_question_id
    left join private.exam_use_question_contents_v1 exam on exam.assignment_question_id = aq.id',1),
    ('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])','    from public.student_vocab_wrong_events ev
    join public.quiz_questions q on q.id = ev.quiz_question_id
    join public.vocab_entries e on e.id = ev.vocab_entry_id','    from public.student_vocab_wrong_events ev
    join private.quiz_question_contents_v1 q on q.id = ev.quiz_question_id
    join public.vocab_entries e on e.id = ev.vocab_entry_id',1),
    ('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])','      from public.quiz_questions q join public.vocab_entries e on e.id=q.vocab_entry_id
      left join public.assignment_questions aq on aq.id=q.assignment_question_id
      left join private.reviewed_exam_entries reviewed','      from public.quiz_questions q join public.vocab_entries e on e.id=q.vocab_entry_id
      left join private.assignment_question_contents_v1 aq on aq.id=q.assignment_question_id
      left join private.reviewed_exam_entries reviewed',1),
    ('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])','      left join public.assignment_question_exam_use_snapshot s on s.assignment_question_id=aq.id and s.provenance_status=''reviewed_for_preview_v1''
      left join word_index.app_canonical_question_preview_release r','      left join private.exam_use_question_contents_v1 s on s.assignment_question_id=aq.id and s.provenance_status=''reviewed_for_preview_v1''
      left join word_index.app_canonical_question_preview_release r',1),
    ('public.create_wrong_word_worksheet_request_v1(uuid,uuid[])','    left join public.assignment_questions as bank_question
      on bank_question.id = question.assignment_question_id
    left join public.assignment_question_exam_use_snapshot as exam_snapshot
      on exam_snapshot.assignment_question_id = question.assignment_question_id','    left join private.assignment_question_contents_v1 as bank_question
      on bank_question.id = question.assignment_question_id
    left join private.exam_use_question_contents_v1 as exam_snapshot
      on exam_snapshot.assignment_question_id = question.assignment_question_id',1),
    ('private.record_vocab_quiz_point_events(uuid,uuid,text,timestamp with time zone)','    left join public.assignment_questions as bank_question
      on bank_question.id = question.assignment_question_id
    cross join lateral (','    left join private.assignment_question_contents_v1 as bank_question
      on bank_question.id = question.assignment_question_id
    cross join lateral (',1)
  ) changes(signature,needle,replacement,expected) loop
    definition:=replace(pg_get_functiondef(edit.signature::regprocedure),chr(13),'');
    actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if actual<>edit.expected then raise exception 'm02_writer_reader_contract_changed: %, %',edit.signature,actual; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end;
$migration$;
-- The existing execute ACL permits only service_role; the function retains
-- its active-student check while its private body reader needs definer access.
alter function public.get_student_wrong_word_notebook_page_v1(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer) security definer;

-- Practice content is only frozen display storage. Its presence never replaces
-- the source, eligibility, choice and settings checks in the existing start.
create function private.resolve_practice_question_v2(p_body jsonb,p_reference uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions; payload jsonb;
begin
  if p_reference is null then return p_body; end if;
  select * into material from private.vocabulary_question_content_versions where id=p_reference;
  if material.id is null or material.kind<>'practice'
    or material.binding->>'storage_rule' is distinct from 'practice-display-v2'
    or material.binding->'direction' is distinct from p_body->'direction'
    or material.binding->'correctChoiceIndex' is distinct from p_body->'correctChoiceIndex'
    then raise exception 'practice_content_binding_mismatch' using errcode='55000'; end if;
  payload:=private.vocabulary_question_content_payload_v1(material);
  if exists(select 1 from jsonb_each(payload) e where p_body ? e.key and p_body->e.key is distinct from e.value)
    then raise exception 'practice_content_body_mismatch' using errcode='55000'; end if;
  return (p_body-'content_version_id')||payload;
end;
$$;

create function private.resolve_practice_questions_v2(p_questions jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare item jsonb; result jsonb:='[]';
begin
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions) not between 1 and 500
    then raise exception 'invalid_practice_questions' using errcode='22023'; end if;
  for item in select value from jsonb_array_elements(p_questions) loop
    if jsonb_typeof(item) is distinct from 'object' or (item ? 'content_version_id' and
      (jsonb_typeof(item->'content_version_id') is distinct from 'string' or item->>'content_version_id'=''))
      then raise exception 'practice_content_reference_invalid' using errcode='22023'; end if;
    result:=result||jsonb_build_array(private.resolve_practice_question_v2(item,(item->>'content_version_id')::uuid));
  end loop;
  return result;
end;
$$;

create function private.compact_practice_questions_v2(p_questions jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare item jsonb; payload jsonb; binding jsonb; result jsonb:='[]'; ids bigint[]; reference uuid;
begin
  for item in select value from jsonb_array_elements(private.resolve_practice_questions_v2(p_questions)) loop
    payload:=private.vocabulary_question_json_fields_v1(item,array['prompt','choices','pronunciation','choicePronunciations','choiceSources']);
    binding:=private.vocabulary_question_json_fields_v1(item,array['direction','correctChoiceIndex'])
      ||jsonb_build_object('storage_rule','practice-display-v2');
    select array_agg((c->>'entryId')::bigint order by n) into ids
      from jsonb_array_elements(item->'choiceSources') with ordinality choices(c,n);
    binding:=binding||jsonb_build_object('choice_entry_ids',ids);
    reference:=private.register_vocabulary_question_content_v1('practice',private.vocabulary_question_scope_v1(ids),binding,payload);
    result:=result||jsonb_build_array(private.vocabulary_question_json_fields_v1(item,array['wordKey','direction','correctChoiceIndex'])
      ||jsonb_build_object('content_version_id',reference));
  end loop;
  return result;
end;
$$;

create function private.freeze_practice_question_content_v2()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op='UPDATE' and old.content_version_id is not null and (new.run_id,new.ordinal,new.body,new.content_version_id)
    is distinct from (old.run_id,old.ordinal,old.body,old.content_version_id)
    then raise exception 'practice_content_reference_immutable' using errcode='55000'; end if;
  if new.content_version_id is not null then
    perform private.resolve_practice_question_v2(new.body,new.content_version_id);
  end if;
  return new;
end;
$$;
create trigger practice_question_content_immutable before insert or update of run_id,ordinal,body,content_version_id
  on private.student_word_practice_questions for each row execute function private.freeze_practice_question_content_v2();
alter table private.student_word_practice_questions add constraint practice_question_reference_body check(
  content_version_id is null or (body-array['wordKey','direction','correctChoiceIndex']='{}'::jsonb
    and body ?& array['wordKey','direction','correctChoiceIndex']));
do $migration$
declare projection text;
begin
  select string_agg(case when attname='body' then 'private.resolve_practice_question_v2(q.body,q.content_version_id) as body'
    else format('q.%I',attname) end,',' order by attnum) into projection from pg_attribute
    where attrelid='private.student_word_practice_questions'::regclass and attnum>0 and not attisdropped;
  execute 'create view private.practice_question_contents_v2 as select '||projection||' from private.student_word_practice_questions q';
end;
$migration$;
revoke all on private.practice_question_contents_v2 from public,anon,authenticated,service_role;

do $migration$
declare edit record; definition text; actual integer;
begin
  for edit in select * from (values
    ('public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      '''questions'',p_questions);','''contentStorageVersion'',2,''questions'',private.compact_practice_questions_v2(p_questions));',1),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      '  count_requested:=',E'  p_questions:=private.resolve_practice_questions_v2(p_questions);\n  count_requested:=',1),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      '  at_time:=clock_timestamp();',E'  p_questions:=private.compact_practice_questions_v2(p_questions);\n  at_time:=clock_timestamp();',1),
    ('public.start_student_word_practice_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb)',
      'insert into private.student_word_practice_questions(run_id,ordinal,body) values(run.id,ordinal,item);',
      'insert into private.student_word_practice_questions(run_id,ordinal,body,content_version_id) values(run.id,ordinal,item-''content_version_id'',(item->>''content_version_id'')::uuid);',1),
    ('private.word_practice_read_v1(private.student_word_practice_runs)',
      'into questions from private.student_word_practice_questions q where q.run_id=p_run.id;',
      'into questions from private.practice_question_contents_v2 q where q.run_id=p_run.id;',1),
    ('private.resolve_quiz_preparation_plan_v2(private.quiz_attempt_preparations,boolean)',
      'if p.kind=''practice'' then return p.plan; end if;',
      'if p.kind=''practice'' then
        if p.plan ? ''contentStorageVersion'' and (p.plan->>''contentStorageVersion'' is distinct from ''2'' or exists(
          select 1 from jsonb_array_elements(p.plan->''questions'') q where not(q ? ''content_version_id'')))
          then raise exception ''practice_content_reference_invalid'' using errcode=''55000''; end if;
        return (p.plan-''contentStorageVersion'')||jsonb_build_object(''questions'',private.resolve_practice_questions_v2(p.plan->''questions'')); end if;',1),
    ('public.begin_prepared_practice_v1(uuid,uuid)','  result:=public.start_student_word_practice_v1',
      '  if p.plan ? ''contentStorageVersion'' and (p.plan->>''contentStorageVersion'' is distinct from ''2'' or exists(
        select 1 from jsonb_array_elements(p.plan->''questions'') q where not(q ? ''content_version_id'')))
        then raise exception ''practice_content_reference_invalid'' using errcode=''55000''; end if;
  result:=public.start_student_word_practice_v1',1),
    ('public.begin_prepared_quiz_v1(uuid,uuid)','  p.plan:=private.compact_initial_quiz_plan_v2(p.assignment_id,p.plan);',
      E'  p.plan:=private.compact_initial_quiz_plan_v2(p.assignment_id,p.plan);\n  p.plan:=jsonb_build_object(''contentStorageVersion'',2,''questions'',private.resolve_quiz_preparation_plan_v2(p,true));',1),
    ('public.begin_prepared_quiz_v1(uuid,uuid)','from jsonb_array_elements(private.resolve_quiz_preparation_plan_v2(p,true)) q',
      'from jsonb_array_elements(p.plan->''questions'') q',1)
  ) changes(signature,needle,replacement,expected) loop
    definition:=replace(pg_get_functiondef(edit.signature::regprocedure),chr(13),'');
    actual:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if actual<>edit.expected then raise exception 'm02_practice_contract_changed: %, %',edit.signature,actual; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end;
$migration$;
revoke all on function private.resolve_practice_question_v2(jsonb,uuid),private.resolve_practice_questions_v2(jsonb),
  private.compact_practice_questions_v2(jsonb),private.freeze_practice_question_content_v2()
from public,anon,authenticated,service_role;
alter function public.prepare_word_practice_start_v1(uuid,uuid,text,jsonb,jsonb,text,jsonb) security definer;

create function private.assignment_question_display_v1(p_question_id uuid)
returns jsonb language plpgsql stable set search_path='' as $$
declare q public.assignment_questions; s public.assignment_question_exam_use_snapshot; exam jsonb;
begin
  if p_question_id is null then return null; end if;
  select * into q from public.assignment_questions where id=p_question_id;
  if q.id is null then raise exception 'question_content_unavailable' using errcode='55000'; end if;
  q:=private.resolve_assignment_question_content_v1(q);
  select * into s from public.assignment_question_exam_use_snapshot where assignment_question_id=q.id;
  if s.assignment_question_id is not null then
    s:=private.resolve_exam_use_question_content_v1(s);
    exam:=private.vocabulary_question_json_fields_v1(to_jsonb(s),array['release_id','occurrence_id','dictionary_id','pronunciation_variant_id',
      'headword_snapshot','primary_meaning_snapshot','display_pronunciation_ko_snapshot','pronunciation_snapshot','choice_dictionary_snapshots','provenance_status']);
  end if;
  return private.vocabulary_question_json_fields_v1(to_jsonb(q),array['vocab_entry_id','choice_vocab_entry_ids','headword_snapshot','primary_meaning_snapshot',
    'provenance_status','composition_pronunciation_snapshot','notebook_pronunciation_snapshot'])||jsonb_build_object('exam_use_snapshot',exam);
end;
$$;
revoke all on function private.assignment_question_display_v1(uuid) from public,anon,authenticated,service_role;

-- Read only through a personal, owned question. No global content ID API.
create function public.read_question_contents_v1(p_context text,p_actor_id uuid,p_context_id uuid,p_question_ids uuid[])
returns jsonb language plpgsql volatile security definer set search_path='' as $$
declare prep private.quiz_attempt_preparations; assignment public.assignments; release_value jsonb; allowed boolean;
  requested uuid; bank public.assignment_questions; question public.quiz_questions; snapshot jsonb; item jsonb; result jsonb:='[]'; plan jsonb;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_required' using errcode='42501'; end if;
  if p_context is null or p_context not in ('student_attempt','student_preparation','student_assignment','admin_attempt','admin_wrong_history')
    or p_actor_id is null or p_context_id is null or coalesce(array_ndims(p_question_ids),0)<>1
    or cardinality(p_question_ids) not between 1 and 200 or array_position(p_question_ids,null) is not null
    or cardinality(p_question_ids)<>(select count(distinct id) from unnest(p_question_ids) id)
    then raise exception 'question_content_request_invalid' using errcode='22023'; end if;
  if p_context in ('student_attempt','student_preparation','student_assignment') then
    if not exists(select 1 from public.students where id=p_actor_id and status='active' and deleted_at is null)
      then raise exception 'student_not_found' using errcode='42501'; end if;
  elsif not exists(select 1 from public.admin_profiles where user_id=p_actor_id and is_active) then
    raise exception 'admin_required' using errcode='42501';
  end if;
  if p_context in ('student_attempt','admin_attempt') then
    if not exists(select 1 from public.quiz_attempts where id=p_context_id and (p_context='admin_attempt' or student_id=p_actor_id))
      then raise exception 'question_not_owned' using errcode='42501'; end if;
  elsif p_context='student_preparation' then
    select * into prep from private.quiz_attempt_preparations where id=p_context_id and student_id=p_actor_id;
    if prep.id is null or prep.kind<>'initial' or prep.begun_id is not null or prep.expires_at<=clock_timestamp()
      then raise exception 'preparation_unavailable' using errcode='40001'; end if;
    assignment:=private.quiz_preparation_assignment(p_actor_id,prep.assignment_id);
    if private.quiz_preparation_fingerprint(assignment) is distinct from prep.fingerprint
      then raise exception 'preparation_changed' using errcode='40001'; end if;
    plan:=case when jsonb_typeof(prep.plan)='array' then prep.plan else prep.plan->'questions' end;
  elsif p_context='student_assignment' then
    if not exists(select 1 from public.assignments a join public.assignment_students recipient on recipient.assignment_id=a.id
      where a.id=p_context_id and recipient.student_id=p_actor_id and recipient.cancelled_at is null and recipient.assigned_at<=now()
        and a.deleted_at is null and a.status in ('active','closed'))
      then raise exception 'question_not_owned' using errcode='42501'; end if;
    release_value:=private.student_assignment_release_v1(p_actor_id,p_context_id,statement_timestamp());
    if release_value->>'state' is null or release_value->>'state'='unavailable' or (release_value->>'state' not in ('open','unrestricted')
      and not exists(select 1 from public.quiz_attempts where student_id=p_actor_id and assignment_id=p_context_id))
      then raise exception 'question_not_owned' using errcode='42501'; end if;
  elsif not exists(select 1 from public.students where id=p_context_id) then
    raise exception 'question_not_owned' using errcode='42501';
  end if;
  -- Check the entire requested set before reconstructing any content.
  foreach requested in array p_question_ids loop
    if p_context in ('student_attempt','admin_attempt') then
      allowed:=exists(select 1 from public.quiz_questions where id=requested and attempt_id=p_context_id);
    elsif p_context='student_preparation' then
      allowed:=exists(select 1 from public.assignment_questions q where q.id=requested and q.assignment_id=prep.assignment_id
        and exists(select 1 from jsonb_array_elements(plan) e where e->>'assignment_question_id'=q.id::text));
    elsif p_context='student_assignment' then
      allowed:=exists(select 1 from public.assignment_questions where id=requested and assignment_id=p_context_id
        and eligibility_quiz_mode='canonical_example_to_headword');
    else
      allowed:=exists(select 1 from public.quiz_questions q join public.quiz_attempts a on a.id=q.attempt_id
        where q.id=requested and a.student_id=p_context_id and exists(select 1 from public.student_vocab_wrong_events ev
          where ev.student_id=p_context_id and ev.quiz_question_id=q.id and ev.quiz_attempt_id=q.attempt_id and ev.wrong_stage='initial'));
    end if;
    if not coalesce(allowed,false) then raise exception 'question_not_owned' using errcode='42501'; end if;
  end loop;
  foreach requested in array p_question_ids loop
    if p_context in ('student_preparation','student_assignment') then
      select * into bank from public.assignment_questions where id=requested;
      if p_context='student_assignment' then
        bank:=private.resolve_assignment_question_content_v1(bank);
        item:=jsonb_build_object('id',bank.id,'vocab_entry_id',bank.vocab_entry_id,'prompt',bank.prompt);
      else item:=jsonb_build_object('id',bank.id,'assignment_question',private.assignment_question_display_v1(bank.id)); end if;
    else
      select * into question from public.quiz_questions where id=requested;
      snapshot:=private.assignment_question_display_v1(question.assignment_question_id);
      if p_context='admin_wrong_history' then
        if snapshot is not null then
          snapshot:=private.vocabulary_question_json_fields_v1(snapshot,array['headword_snapshot','primary_meaning_snapshot','provenance_status'])
            ||jsonb_build_object('exam_use_snapshot',case when jsonb_typeof(snapshot->'exam_use_snapshot')='object'
              then private.vocabulary_question_json_fields_v1(snapshot->'exam_use_snapshot',array['headword_snapshot','primary_meaning_snapshot','provenance_status']) end);
        end if;
        item:=jsonb_build_object('id',question.id,'assignment_question',snapshot);
      else
        question:=private.resolve_quiz_question_content_v1(question);
        item:=jsonb_build_object('id',question.id,'prompt',question.prompt,'choices',question.choices,'assignment_question',snapshot);
      end if;
    end if;
    result:=result||jsonb_build_array(item);
  end loop;
  return jsonb_build_object('schemaVersion','question-content-read-v1','context',p_context,'items',result);
end;
$$;
revoke all on function public.read_question_contents_v1(text,uuid,uuid,uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.read_question_contents_v1(text,uuid,uuid,uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
