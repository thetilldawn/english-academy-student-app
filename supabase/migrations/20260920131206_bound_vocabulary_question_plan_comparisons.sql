-- Preserve every validation predicate; evaluate the complete violation set
-- so EXISTS startup-cost plans cannot repeatedly scan the entire choice bank.
create or replace function private.validate_vocabulary_composition_question_plan_v1(p_version_id uuid,p_questions jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
  if jsonb_typeof(p_questions) is distinct from 'array' or jsonb_array_length(p_questions)>40000 then
    raise exception 'composition_questions_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_typeof(q) is distinct from 'object') then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where
    not(q ?& array['vocabEntryId','direction','prompt','choices','choiceVocabEntryIds','correctChoiceIndex'])
    or (select count(*) from jsonb_object_keys(q))<>6 or jsonb_typeof(q->'vocabEntryId') is distinct from 'number'
    or q->>'vocabEntryId' !~ '^[1-9][0-9]*$' or jsonb_typeof(q->'correctChoiceIndex') is distinct from 'number'
    or q->>'correctChoiceIndex' !~ '^[0-3]$' or coalesce(q->>'direction','') not in('english_to_korean','korean_to_english')
    or jsonb_typeof(q->'choices') is distinct from 'array' or jsonb_typeof(q->'choiceVocabEntryIds') is distinct from 'array') then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(p_questions) q where jsonb_array_length(q->'choices')<>4 or jsonb_array_length(q->'choiceVocabEntryIds')<>4
    or exists(select 1 from jsonb_array_elements(q->'choices') x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}'))<1)
    or exists(select 1 from jsonb_array_elements(q->'choiceVocabEntryIds') x where jsonb_typeof(x)<>'number' or x::text !~ '^[1-9][0-9]*$')) then
    raise exception 'composition_question_invalid' using errcode='22023'; end if;
  if (select count(distinct (q->>'vocabEntryId',q->>'direction')) from jsonb_array_elements(p_questions) q)<>jsonb_array_length(p_questions) then
    raise exception 'composition_question_plan_invalid' using errcode='22023'; end if;
  -- Check the complete plan before accepting it. Only scalar entry columns are
  -- joined here; the original per-item validator still builds the frozen proof.
  if exists(with documents as materialized (
      select q,(q->>'vocabEntryId')::bigint id,q->>'direction' direction from jsonb_array_elements(p_questions) q
    ) select 1 from documents d left join private.vocabulary_composition_entries l on l.version_id=p_version_id and l.vocab_entry_id=d.id
      left join public.vocab_entries e on e.id=l.vocab_entry_id and lower(e.row_sha256)=l.entry_sha256
      where l.vocab_entry_id is null or l.source_kind='reviewed_exam' or not(d.direction=any(l.eligible_directions)) or e.id is null
        or d.q->>'prompt' is distinct from case d.direction when 'english_to_korean' then e.headword else e.primary_meaning end
        or (d.q->'choiceVocabEntryIds'->>((d.q->>'correctChoiceIndex')::integer))::bigint<>e.id) then
    raise exception 'composition_question_plan_target_invalid' using errcode='22023'; end if;
  if (with documents as materialized (
      select q,ordinality n,(q->>'vocabEntryId')::bigint id,q->>'direction' direction from jsonb_array_elements(p_questions) with ordinality x(q,ordinality)
    ), choices as materialized (
      select d.n,d.direction,d.id,(x.value#>>'{}')::bigint choice_id,d.q->'choices'->>(x.ordinality::integer-1) text
      from documents d cross join lateral jsonb_array_elements(d.q->'choiceVocabEntryIds') with ordinality x
    ) select count(*) from (select 1 from choices d join public.vocab_entries target on target.id=d.id
      left join private.vocabulary_composition_entries l on l.version_id=p_version_id and l.vocab_entry_id=d.choice_id
      left join public.vocab_entries e on e.id=l.vocab_entry_id and lower(e.row_sha256)=l.entry_sha256
      where l.vocab_entry_id is null or l.source_kind='reviewed_exam' or not(d.direction=any(l.eligible_directions)) or e.id is null
        or d.text is distinct from case d.direction when 'english_to_korean' then e.primary_meaning else e.headword end
        or (d.id<>d.choice_id and (lower(normalize(trim(e.headword),NFKC))=lower(normalize(trim(target.headword),NFKC))
          or lower(normalize(trim(e.primary_meaning),NFKC))=lower(normalize(trim(target.primary_meaning),NFKC))))
    union all select 1 from choices group by n having count(distinct choice_id)<>4
      or count(distinct lower(regexp_replace(normalize(trim(text),NFKC),'\s+',' ','g')))<>4) violations)>0 then
    raise exception 'composition_question_plan_choices_invalid' using errcode='22023'; end if;
end;
$$;
