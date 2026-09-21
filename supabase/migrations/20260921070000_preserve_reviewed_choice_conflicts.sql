begin;

-- Keep existing entry/scope snapshots byte-for-byte. Reviewed policy lives in
-- the already hashed, immutable source occurrence, not a new vocab_entries column.
create function private.reviewed_choice_key_v1(p_value text,p_direction text)
returns text language sql immutable strict set search_path='' as $$
  select lower(case when p_direction='korean_to_english' then replace(t.value,'*','') else t.value end)
  from (select btrim(normalize(p_value,NFKC),E' \t\n\r\f\013'||U&'\00a0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200a\2028\2029\202f\205f\3000\feff') value) t;
$$;

create function private.validate_reviewed_choice_safety_v1(p_policy jsonb,p_headword text,p_meaning text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare x jsonb; seen text[]:='{}'; k text;
begin
  if p_policy is null then return null; end if;
  if jsonb_typeof(p_policy) is distinct from 'object' then raise exception 'invalid_reviewed_choice_policy' using errcode='22023'; end if;
  if not(p_policy ?& array['version','evidenceSha256','target','exclusions']) or (select count(*) from jsonb_object_keys(p_policy))<>4
    or p_policy->>'version' is distinct from 'reviewed-choice-conflicts-v1'
    or jsonb_typeof(p_policy->'evidenceSha256') is distinct from 'string' or p_policy->>'evidenceSha256' !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_policy->'target') is distinct from 'object' or jsonb_typeof(p_policy->'exclusions') is distinct from 'array'
    then raise exception 'invalid_reviewed_choice_policy' using errcode='22023'; end if;
  if not(p_policy->'target' ?& array['headword','primaryMeaning']) or (select count(*) from jsonb_object_keys(p_policy->'target'))<>2
    or jsonb_typeof(p_policy#>'{target,headword}') is distinct from 'string' or jsonb_typeof(p_policy#>'{target,primaryMeaning}') is distinct from 'string'
    or p_policy#>>'{target,headword}' is distinct from p_headword or p_policy#>>'{target,primaryMeaning}' is distinct from p_meaning
    or jsonb_array_length(p_policy->'exclusions')>2000 then raise exception 'reviewed_choice_target_mismatch' using errcode='22023'; end if;
  for x in select value from jsonb_array_elements(p_policy->'exclusions') loop
    if jsonb_typeof(x) is distinct from 'object' then raise exception 'invalid_reviewed_choice_exclusion' using errcode='22023'; end if;
    if not(x ?& array['direction','choice']) or (select count(*) from jsonb_object_keys(x))<>2
      or coalesce(x->>'direction','') not in('english_to_korean','korean_to_english')
      or jsonb_typeof(x->'choice') is distinct from 'string' or length(x->>'choice') not between 1 and 500
      or btrim(x->>'choice') is distinct from x->>'choice' then raise exception 'invalid_reviewed_choice_exclusion' using errcode='22023'; end if;
    k:=private.reviewed_choice_key_v1(x->>'choice',x->>'direction');
    if k='' or k=private.reviewed_choice_key_v1(case x->>'direction' when 'english_to_korean' then p_meaning else p_headword end,x->>'direction')
      or (x->>'direction')||':'||k=any(seen) then raise exception 'invalid_reviewed_choice_exclusion' using errcode='22023'; end if;
    seen:=array_append(seen,(x->>'direction')||':'||k);
  end loop;
  return p_policy;
end;
$$;

create function private.guard_source_choice_safety_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy jsonb; source_key text;
begin
  policy:=private.validate_reviewed_choice_safety_v1(new.context_evidence->'choice_safety',new.display_headword,new.display_gloss_ko);
  select r.dataset_key into source_key from word_index.app_exam_use_release r where r.release_id=new.release_id;
  if source_key ~ '^g12-csat-' and policy is null then raise exception 'csat_choice_review_required' using errcode='22023'; end if;
  return new;
end;
$$;
create trigger reviewed_source_choice_safety before insert on word_index.app_exam_use_occurrence
  for each row execute function private.guard_source_choice_safety_v1();

create function private.vocabulary_entry_choice_safety_v1(p_entry_id bigint,p_seen bigint[] default '{}')
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare policy jsonb; e public.vocab_entries; l private.vocabulary_composition_entries; policies jsonb[];
begin
  if p_entry_id=any(p_seen) or cardinality(p_seen)>=32 then raise exception 'reviewed_choice_lineage_invalid' using errcode='22023'; end if;
  select * into e from public.vocab_entries where id=p_entry_id;
  if not found then raise exception 'reviewed_choice_entry_missing' using errcode='22023'; end if;
  select array_agg(distinct o.context_evidence->'choice_safety') into policies
    from word_index.app_exam_use_occurrence o where o.vocab_entry_id=p_entry_id and o.context_evidence ? 'choice_safety';
  if cardinality(policies)>1 then raise exception 'reviewed_choice_policy_conflict' using errcode='22023'; end if;
  policy:=policies[1];
  if policy is null then
    select * into l from private.vocabulary_composition_entries where vocab_entry_id=p_entry_id;
    if found then
      policy:=l.source_snapshot#>'{occurrence,context_evidence,choice_safety}';
      if policy is null and l.source_entry_id<>p_entry_id then
        policy:=private.vocabulary_entry_choice_safety_v1(l.source_entry_id,array_append(p_seen,p_entry_id));
      end if;
    end if;
  end if;
  return private.validate_reviewed_choice_safety_v1(policy,e.headword,e.primary_meaning);
end;
$$;

create function public.list_vocabulary_choice_safety_v1(p_dataset_id uuid,p_after_entry_id bigint default 0,p_limit integer default 1000)
returns table(vocab_entry_id bigint,choice_safety jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if not (select private.is_active_admin()) then raise exception 'admin_required' using errcode='42501'; end if;
  if p_dataset_id is null or p_after_entry_id is null or p_after_entry_id<0 or p_limit is null or p_limit not between 1 and 1000
    then raise exception 'invalid_reviewed_choice_page' using errcode='22023'; end if;
  return query with page as materialized (select e.id from public.vocab_entries e
    where e.dataset_id=p_dataset_id and e.id>p_after_entry_id order by e.id limit p_limit)
    select page.id,private.vocabulary_entry_choice_safety_v1(page.id) from page order by page.id;
end;
$$;
revoke all on function public.list_vocabulary_choice_safety_v1(uuid,bigint,integer) from public,anon,service_role;
grant execute on function public.list_vocabulary_choice_safety_v1(uuid,bigint,integer) to authenticated;

create or replace function private.vocabulary_composition_question_input_v1(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('versionId',c.version_id,'datasetId',c.dataset_id,'contentHash',c.content_sha256,'state',c.state,
    'entries',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'unitId',e.unit_id,'sourceRow',e.source_row,
      'headword',e.headword,'primaryMeaning',e.primary_meaning,'sourceKind',l.source_kind,'sourceEntryId',l.source_entry_id,
      'eligibleDirections',l.eligible_directions,'compositionTargetKey',l.identity_key)||
      case when policy.value is null then '{}'::jsonb else jsonb_build_object('choiceSafety',policy.value) end order by e.source_row)
      from private.vocabulary_composition_entries l join public.vocab_entries e on e.id=l.vocab_entry_id
      cross join lateral (select private.vocabulary_entry_choice_safety_v1(e.id) value offset 0) policy
      where l.version_id=c.version_id),'[]'::jsonb))
  from private.vocabulary_compositions c where c.version_id=p_version_id;
$$;

create or replace function private.vocabulary_composition_preparation_v1(p_version_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select input.value || jsonb_build_object('entries',coalesce((select jsonb_agg(e.value||jsonb_build_object('resources',l.resources->'selected') order by e.n)
    from jsonb_array_elements(input.value->'entries') with ordinality e(value,n)
    join private.vocabulary_composition_entries l on l.version_id=p_version_id and l.vocab_entry_id=(e.value->>'id')::bigint),'[]'::jsonb))
  from (select private.vocabulary_composition_question_input_v1(p_version_id) value) input;
$$;

create function private.assert_reviewed_choice_texts_v1(p_policy jsonb,p_direction text,p_choices jsonb,p_correct integer)
returns void language plpgsql immutable set search_path='' as $$
begin
  if p_policy is null then return; end if;
  if jsonb_typeof(p_choices) is distinct from 'array' or jsonb_array_length(p_choices)<>4 or p_correct not between 0 and 3
    or p_correct is null or p_direction is null or p_direction not in('english_to_korean','korean_to_english') then
    raise exception 'reviewed_choice_question_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_choices) x where jsonb_typeof(x)<>'string')
    or p_choices->>p_correct is distinct from (case p_direction when 'english_to_korean' then p_policy#>>'{target,primaryMeaning}' else p_policy#>>'{target,headword}' end)
    then raise exception 'reviewed_choice_answer_mismatch' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(p_choices) with ordinality c(value,n)
    join jsonb_array_elements(p_policy->'exclusions') x on x->>'direction'=p_direction
      and private.reviewed_choice_key_v1(x->>'choice',p_direction)=private.reviewed_choice_key_v1(c.value,p_direction)
    where c.n<>p_correct+1) then raise exception 'reviewed_choice_ambiguous' using errcode='22023'; end if;
end;
$$;

-- This boundary covers regular, exact, system and copied question writers.
-- Existing rows are untouched. Updates of schedules, scores and provenance do
-- not run this trigger; newly supplied question contents always do.
create function private.guard_assignment_reviewed_choices_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy jsonb;
begin
  policy:=private.vocabulary_entry_choice_safety_v1(new.vocab_entry_id);
  if policy is not null and new.prompt is distinct from (case new.direction when 'english_to_korean' then policy#>>'{target,headword}' else policy#>>'{target,primaryMeaning}' end)
    then raise exception 'reviewed_choice_prompt_mismatch' using errcode='22023'; end if;
  perform private.assert_reviewed_choice_texts_v1(policy,new.direction::text,new.choices,new.correct_choice_index);
  return new;
end;
$$;
create trigger assignment_reviewed_choices before insert or update of vocab_entry_id,direction,prompt,choices,correct_choice_index
  on public.assignment_questions for each row execute function private.guard_assignment_reviewed_choices_v1();

create function private.guard_composition_reviewed_choices_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare policy jsonb; doc jsonb;
begin
  if new.source_kind<>'generated_meaning' then return new; end if;
  policy:=private.vocabulary_entry_choice_safety_v1(new.vocab_entry_id);
  if policy is not null and new.prompt is distinct from (case new.direction when 'english_to_korean' then policy#>>'{target,headword}' else policy#>>'{target,primaryMeaning}' end)
    then raise exception 'reviewed_choice_prompt_mismatch' using errcode='22023'; end if;
  perform private.assert_reviewed_choice_texts_v1(policy,new.direction::text,to_jsonb(new.choice_texts),new.correct_choice_index);
  if policy is not null then
    new.source_proof:=new.source_proof||jsonb_build_object('choicePolicy',jsonb_build_object(
      'version',policy->>'version','evidenceSha256',policy->>'evidenceSha256','policySha256',private.reviewed_exam_sha256_v1(policy)));
    doc:=jsonb_build_object('vocabEntryId',new.vocab_entry_id,'direction',new.direction,'prompt',new.prompt,'choices',to_jsonb(new.choice_texts),
      'choiceVocabEntryIds',to_jsonb(new.choice_vocab_entry_ids),'correctChoiceIndex',new.correct_choice_index,
      'versionId',new.version_id,'proof',new.source_proof,'pronunciation',new.pronunciation_snapshot);
    new.item_sha256:=private.reviewed_exam_sha256_v1(doc); new.item_id:=new.item_sha256;
  end if;
  return new;
end;
$$;
create trigger composition_reviewed_choices before insert on private.vocabulary_composition_items
  for each row execute function private.guard_composition_reviewed_choices_v1();

create function private.assert_composition_reviewed_plan_v1(p_questions jsonb)
returns void language plpgsql stable security definer set search_path='' as $$
declare q jsonb;
begin
  for q in select value from jsonb_array_elements(p_questions) loop
    perform private.assert_reviewed_choice_texts_v1(private.vocabulary_entry_choice_safety_v1((q->>'vocabEntryId')::bigint),
      q->>'direction',q->'choices',(q->>'correctChoiceIndex')::integer);
  end loop;
end;
$$;
-- Reject a bad complete plan before persisting a resumable plan. Per-item
-- insertion triggers above also protect both legacy and batched finalizers.
do $migration$
declare body text; anchor text:=E'\nend;\n';
begin
  body:=replace(pg_get_functiondef('private.validate_vocabulary_composition_question_plan_v1(uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
  if position(anchor in body)=0 then raise exception 'choice_plan_patch_anchor_missing'; end if;
  body:=replace(body,anchor,E'\n  perform private.assert_composition_reviewed_plan_v1(p_questions);\nend;\n');
  execute body;
end;
$migration$;

revoke all on function private.reviewed_choice_key_v1(text,text),private.validate_reviewed_choice_safety_v1(jsonb,text,text),
  private.guard_source_choice_safety_v1(),private.vocabulary_entry_choice_safety_v1(bigint,bigint[]),
  private.assert_reviewed_choice_texts_v1(jsonb,text,jsonb,integer),private.guard_assignment_reviewed_choices_v1(),
  private.guard_composition_reviewed_choices_v1(),private.assert_composition_reviewed_plan_v1(jsonb)
  from public,anon,authenticated,service_role;
commit;
