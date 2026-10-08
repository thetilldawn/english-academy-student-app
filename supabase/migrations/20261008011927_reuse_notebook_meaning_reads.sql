-- APP-20261008-02. Reuse verified values within a single read only.
-- No dictionary, assignment, answer, or student-state rows are changed.

do $repair$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.quiz_vocabulary_meaning_v1(uuid,integer)'::regprocedure),E'\r\n',E'\n');
  anchor:='declare q public.quiz_questions; selected_value text; headword_value text;';
  if strpos(definition,anchor)=0 then raise exception 'quiz_meaning_read_base_drift'; end if;
  definition:=replace(definition,anchor,anchor||' existing jsonb;');
  anchor:='if q.assignment_question_id is not null then return private.assignment_vocabulary_meaning_v1(q.assignment_question_id,p_depth); end if;';
  if strpos(definition,anchor)=0 then raise exception 'quiz_meaning_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$if q.assignment_question_id is not null then
    -- The quiz resolver above has already checked its material, assignment
    -- binding, source hash, and choices. Reuse only the SAME verified material.
    if q.content_version_id is not null then
      select v.identity into existing
      from public.assignment_questions a
      join private.assignment_vocabulary_meaning_refs r
        on r.assignment_question_id=a.id and r.content_version_id=a.content_version_id
      join private.vocabulary_question_meaning_versions v
        on v.content_version_id=r.content_version_id and v.context_hash=r.context_hash
      where a.id=q.assignment_question_id and a.content_version_id=q.content_version_id;
      if found then return existing; end if;
    end if;
    return private.assignment_vocabulary_meaning_v1(q.assignment_question_id,p_depth);
  end if;$new$);
  execute definition;
end $repair$;

-- Keep one implementation of legacy state interpretation. Its original entry
-- delegates with no precomputed identities; the notebook supplies values that
-- its own latest-question read has already verified in this statement.
do $repair$
declare definition text; core text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.legacy_vocabulary_meaning_states_v1(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
  core:=regexp_replace(definition,
    'CREATE OR REPLACE FUNCTION private\.legacy_vocabulary_meaning_states_v1\([^)]*\)',
    'CREATE OR REPLACE FUNCTION private.legacy_vocabulary_meaning_states_with_identities_v1(p_student_id uuid,p_exclude_question uuid,p_exclude_phase text,p_excluded_phases jsonb,p_question_identities jsonb)');
  if core=definition then raise exception 'legacy_meaning_signature_drift'; end if;
  anchor:='private.quiz_vocabulary_meaning_v1(requested.quiz_question_id) as value';
  if (length(core)-length(replace(core,anchor,'')))/length(anchor)<>1 then raise exception 'legacy_meaning_read_base_drift'; end if;
  core:=replace(core,anchor,$new$case
      when p_question_identities ? requested.quiz_question_id::text then p_question_identities->(requested.quiz_question_id::text)
      else private.quiz_vocabulary_meaning_v1(requested.quiz_question_id)
    end as value$new$);
  execute core;
  if strpos(definition,'AS $function$')=0 then raise exception 'legacy_meaning_body_drift'; end if;
  execute substring(definition from 1 for strpos(definition,'AS $function$')-1)||$wrapper$AS $function$
    select * from private.legacy_vocabulary_meaning_states_with_identities_v1(
      p_student_id,p_exclude_question,p_exclude_phase,p_excluded_phases,'{}'::jsonb)
  $function$;$wrapper$;
end $repair$;
revoke all on function private.legacy_vocabulary_meaning_states_with_identities_v1(uuid,uuid,text,jsonb,jsonb)
  from public,anon,authenticated,service_role;

create function private.notebook_vocabulary_meaning_states_v1(
  p_student_id uuid,p_meaning_keys text[],p_question_identities jsonb
) returns table(meaning_key text,unresolved boolean)
language plpgsql stable security invoker set search_path='' as $function$
declare requested_keys text[]; missing_keys text[];
begin
  select coalesce(array_agg(distinct requested.key),'{}'::text[]) into requested_keys
  from unnest(p_meaning_keys) requested(key) where requested.key is not null;
  if cardinality(requested_keys)=0 then return; end if;
  return query select s.meaning_key,s.unresolved from private.student_vocabulary_meaning_states s
    where s.student_id=p_student_id and s.meaning_key=any(requested_keys);
  select coalesce(array_agg(requested.key),'{}'::text[]) into missing_keys
  from unnest(requested_keys) requested(key) where not exists(
    select 1 from private.student_vocabulary_meaning_states s
    where s.student_id=p_student_id and s.meaning_key=requested.key);
  if cardinality(missing_keys)=0 then return; end if;
  return query select l.meaning_key,l.unresolved
    from private.legacy_vocabulary_meaning_states_with_identities_v1(p_student_id,null,null,'[]'::jsonb,p_question_identities) l
    where l.meaning_key=any(missing_keys);
end $function$;
revoke all on function private.notebook_vocabulary_meaning_states_v1(uuid,text[],jsonb)
  from public,anon,authenticated,service_role;

do $repair$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer,text,integer,text,integer,text[])'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  with current_meanings as materialized (
    select meaning_key,unresolved from private.current_vocabulary_meaning_states_v1(p_student_id)
  ), base as materialized ($old$;
  if strpos(definition,anchor)=0 then raise exception 'notebook_current_meanings_base_drift'; end if;
  definition:=replace(definition,anchor,'  with base as materialized (');
  anchor:=$old$  ), latest_meanings as materialized (
    select l.*,private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey' as meaning_key
    from latest_occurrence l
  ), occurrence_count as materialized ($old$;
  if strpos(definition,anchor)=0 then raise exception 'notebook_latest_meanings_base_drift'; end if;
  definition:=replace(definition,anchor,$new$  ), latest_identities as materialized (
    select requested.quiz_question_id,private.quiz_vocabulary_meaning_v1(requested.quiz_question_id) as identity
    from (select distinct quiz_question_id from latest_occurrence) requested
  ), latest_meanings as materialized (
    select l.*,i.identity->>'meaningKey' as meaning_key
    from latest_occurrence l join latest_identities i using(quiz_question_id)
  ), current_meanings as materialized (
    select s.meaning_key,s.unresolved from private.notebook_vocabulary_meaning_states_v1(
      p_student_id,array(select distinct meaning_key from latest_meanings where meaning_key is not null),
      coalesce((select jsonb_object_agg(quiz_question_id::text,identity) from latest_identities),'{}'::jsonb)
    ) s
  ), occurrence_count as materialized ($new$);
  execute definition;
end $repair$;
