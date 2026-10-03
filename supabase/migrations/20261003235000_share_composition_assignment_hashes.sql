-- APP-20261003-10. New composition rows only. Keep IDs, FKs and old rows.
begin;

create function private.resolve_composition_assignment_hashes_v1(q public.assignment_questions)
returns public.assignment_questions language plpgsql stable set search_path='' as $$
declare material private.vocabulary_question_content_versions; expected jsonb;
begin
  -- This null pair could not be produced by the original composition writer.
  -- A half-missing pair is not the new storage form and must still fail the
  -- existing complete binding comparison. Do not fill other missing columns.
  if q.provenance_status is distinct from 'composition_verified_v1'
    or q.content_version_id is null or q.entry_row_sha256_snapshot is not null
    or q.eligibility_input_hash_snapshot is not null then return q; end if;
  select * into material from private.vocabulary_question_content_versions where id=q.content_version_id;
  if q.prompt is not null or q.choices is not null or material.id is null
    or material.kind is distinct from 'assignment'
    or material.binding->>'provenance_status' is distinct from 'composition_verified_v1'
    or (material.binding->>'entry_row_sha256_snapshot' ~ '^[0-9A-F]{64}$') is distinct from true
    or (material.binding->>'eligibility_input_hash_snapshot' ~ '^[0-9A-F]{64}$') is distinct from true
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  expected:=private.vocabulary_question_binding_v1(q)||jsonb_build_object(
    'entry_row_sha256_snapshot',material.binding->'entry_row_sha256_snapshot',
    'eligibility_input_hash_snapshot',material.binding->'eligibility_input_hash_snapshot');
  if material.binding is distinct from expected
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  q.entry_row_sha256_snapshot:=material.binding->>'entry_row_sha256_snapshot';
  q.eligibility_input_hash_snapshot:=material.binding->>'eligibility_input_hash_snapshot';
  return q;
end $$;
revoke all on function private.resolve_composition_assignment_hashes_v1(public.assignment_questions)
  from public,anon,authenticated,service_role;

-- Preserve existing function identity, ACLs and all original body/source
-- validation. Only hydrate the two omitted fields before the existing checks.
do $migration$
declare edit record; definition text; hits integer;
begin
  for edit in select * from(values
    ('private.resolve_assignment_question_content_v1(public.assignment_questions)',
     '  if q.content_version_id is null then return q; end if;',
     E'  q:=private.resolve_composition_assignment_hashes_v1(q);\n  if q.content_version_id is null then return q; end if;'),
    ('private.resolve_quiz_question_content_v1(public.quiz_questions)',
     '    select * into bank from public.assignment_questions where id=q.assignment_question_id;',
     E'    select * into bank from public.assignment_questions where id=q.assignment_question_id;\n    bank:=private.resolve_composition_assignment_hashes_v1(bank);'),
    ('private.exam_use_question_binding_v1(public.assignment_question_exam_use_snapshot)',
     'private.vocabulary_question_binding_v1(a)',
     'private.vocabulary_question_binding_v1(private.resolve_composition_assignment_hashes_v1(a))')
  ) t(signature,needle,replacement) loop
    definition:=pg_get_functiondef(edit.signature::regprocedure);
    hits:=(length(definition)-length(replace(definition,edit.needle,'')))/length(edit.needle);
    if hits<>1 then raise exception 'composition_hash_reader_contract_changed: %, %',edit.signature,hits; end if;
    execute replace(definition,edit.needle,edit.replacement);
  end loop;
end $migration$;

do $migration$
declare projection text;
begin
  select string_agg(format('%I.%I',case when attname=any(array[
    'prompt','choices','headword_snapshot','primary_meaning_snapshot','correct_answer_snapshot','provenance',
    'composition_pronunciation_snapshot','notebook_pronunciation_snapshot','notebook_source_snapshot',
    'entry_row_sha256_snapshot','eligibility_input_hash_snapshot'])then 'resolved' else 'q' end,attname),',' order by attnum)
    into projection from pg_attribute where attrelid='public.assignment_questions'::regclass and attnum>0 and not attisdropped;
  execute 'create or replace view private.assignment_question_contents_v1 as select '||projection||
    ' from public.assignment_questions q cross join lateral private.resolve_assignment_question_content_v1(q) resolved';
end $migration$;

create function private.compact_composition_assignment_hashes_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare original_binding jsonb; compacted public.assignment_questions;
begin
  if new.provenance_status is distinct from 'composition_verified_v1' or new.content_version_id is null then return new; end if;
  -- Source guards, APP09 registration and zzz_freeze must have run first.
  -- Keep the original validator and compare the entire logical binding again.
  original_binding:=private.vocabulary_question_binding_v1(private.resolve_assignment_question_content_v1(new));
  compacted:=new;
  compacted.entry_row_sha256_snapshot:=null;
  compacted.eligibility_input_hash_snapshot:=null;
  if private.vocabulary_question_binding_v1(private.resolve_composition_assignment_hashes_v1(compacted)) is distinct from original_binding
    then raise exception 'question_content_binding_mismatch' using errcode='55000'; end if;
  return compacted;
end $$;
revoke all on function private.compact_composition_assignment_hashes_v1() from public,anon,authenticated,service_role;
create trigger zzzz_compact_composition_assignment_hashes before insert on public.assignment_questions
  for each row execute function private.compact_composition_assignment_hashes_v1();

commit;
