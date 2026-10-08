-- APP-20261008-02. Read identity metadata from the student's selected questions.
-- Keep the existing view's notebook-first semantics, including null/empty IDs.
-- No dictionary, assignment, attempt, answer, or student-state rows are changed.
do $repair$
declare definition text; anchor text;
begin
  definition:=replace(pg_get_functiondef('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamptz,text,integer,integer,text,integer,text,integer,text[])'::regprocedure),E'\r\n',E'\n');
  anchor:=$old$        exam.dictionary_id,aq.canonical_lexeme_id_snapshot,aq.headword_normalized_snapshot,true) as review_key$old$;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'notebook_active_identity_base_drift';
  end if;
  definition:=replace(definition,anchor,$new$        case when aq.provenance_status='notebook_snapshot_v1'
          then aq.notebook_source_snapshot->>'dictionaryId'
          else exam.dictionary_id end,
        aq.canonical_lexeme_id_snapshot,aq.headword_normalized_snapshot,true) as review_key$new$);
  anchor:='    left join private.assignment_question_word_identity_v1 exam on exam.assignment_question_id = aq.id';
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 then
    raise exception 'notebook_active_join_base_drift';
  end if;
  definition:=replace(definition,anchor,
    '    left join public.assignment_question_exam_use_snapshot exam on exam.assignment_question_id = aq.id');
  execute definition;
end $repair$;
