-- APP-20261008-02: share interpretation inside one read. No stored data changes.
do $repair$ declare definition text; anchor text; begin
  definition:=replace(pg_get_functiondef('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer,text,integer,text,integer,text[])'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  ), occurrence_count as materialized ($old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$  ), latest_meanings as materialized (
    select l.*,private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey' as meaning_key
    from latest_occurrence l
  ), occurrence_count as materialized ($new$);
  anchor:=$old$    from occurrence_keys f join latest_occurrence l using(word_key,vocab_entry_id)$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$    from occurrence_keys f join latest_meanings l using(word_key,vocab_entry_id)$new$);
  anchor:=$old$      on meaning_state.meaning_key=(private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey')$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$      on meaning_state.meaning_key=l.meaning_key$new$);
  anchor:=$old$  ), filtered as materialized ($old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$  ), selection_datasets as materialized (
    select requested.word_key,private.vocabulary_question_selection_dataset_v3(requested.quiz_question_id) as selection_dataset_id
    from (select distinct b.word_key,b.quiz_question_id from base b join grouped g on g.word_key=b.word_key
      where p_dataset_id is not null and (p_dataset_id=any(g.datasets)) is not true) requested
  ), filtered as materialized ($new$);
  anchor:=$old$      and (p_dataset_id is null or p_dataset_id=any(datasets) or exists(select 1 from base b
        where b.word_key=grouped.word_key and private.vocabulary_question_selection_dataset_v3(b.quiz_question_id)=p_dataset_id))$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$      and (p_dataset_id is null or p_dataset_id=any(datasets) or exists(select 1 from selection_datasets selected
        where selected.word_key=grouped.word_key and selected.selection_dataset_id=p_dataset_id))$new$);
  anchor:=$old$      left join private.vocabulary_composition_entries composition on composition.version_id=aq.composition_version_id_snapshot and composition.vocab_entry_id=aq.vocab_entry_id$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$      left join private.vocabulary_composition_entries composition on composition.version_id=aq.composition_version_id_snapshot and composition.vocab_entry_id=aq.vocab_entry_id
      left join lateral (
        with resource_value as materialized (
          select private.vocabulary_composition_resource_v1(composition.resources) as document
          where aq.provenance_status='composition_verified_v1'
        ) select document from resource_value
      ) resolved_composition on true$new$);
  anchor:=$old$(private.vocabulary_composition_resource_v1(composition.resources))->>'definitionEn'$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$resolved_composition.document->>'definitionEn'$new$);
  anchor:=$old$(private.vocabulary_composition_resource_v1(composition.resources))->>'exampleEn'$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$resolved_composition.document->>'exampleEn'$new$);
  anchor:=$old$(private.vocabulary_composition_resource_v1(composition.resources))->>'exampleKo'$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$resolved_composition.document->>'exampleKo'$new$);
  execute definition;
end $repair$;

do $repair$ declare definition text; anchor text; begin
  definition:=replace(pg_get_functiondef('private.legacy_vocabulary_meaning_states_v1(uuid,uuid,text,jsonb)'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$  ), events as materialized ($old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$  ), question_identities as materialized (
    select requested.quiz_question_id,private.quiz_vocabulary_meaning_v1(requested.quiz_question_id) as value
    from (select distinct quiz_question_id from old_phases) requested
  ), events as materialized ($new$);
  anchor:=$old$    cross join lateral (select private.quiz_vocabulary_meaning_v1(q.id) value) identity$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then raise exception 'notebook_read_base_drift'; end if;
  definition:=replace(definition,anchor,$new$    join question_identities identity on identity.quiz_question_id=q.id$new$);
  execute definition;
end $repair$;
