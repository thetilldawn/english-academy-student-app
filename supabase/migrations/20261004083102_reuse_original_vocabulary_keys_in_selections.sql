begin;
-- APP-20261004-04: retain existing word IDs. Selection headers/positions remain
-- metadata; no vocabulary or learning-value body is copied for a new selection.
alter table private.vocabulary_composition_items drop constraint vocabulary_composition_items_vocab_entry_id_fkey;
alter table private.vocabulary_composition_items drop constraint vocabulary_composition_items_version_id_vocab_entry_id_fkey;
alter table private.vocabulary_composition_entries drop constraint vocabulary_composition_entries_pkey;
alter table private.vocabulary_composition_entries drop constraint vocabulary_composition_entries_version_id_vocab_entry_id_key;
alter table private.vocabulary_composition_entries add primary key(version_id,vocab_entry_id);
alter table private.vocabulary_composition_entries drop constraint vocabulary_composition_entries_vocab_entry_id_dataset_id_fkey;
alter table private.vocabulary_composition_items add constraint vocabulary_composition_items_version_id_vocab_entry_id_fkey
  foreign key(version_id,vocab_entry_id) references private.vocabulary_composition_entries(version_id,vocab_entry_id);
alter table private.vocabulary_composition_storage_formats drop constraint vocabulary_composition_storage_formats_format_check;
alter table private.vocabulary_composition_storage_formats add constraint vocabulary_composition_storage_formats_format_check
  check(format in ('learning-values-v2','source-keys-v3'));

-- Resolve an existing immutable scope. Projection is in memory only: these
-- helpers do not register value/binding rows or introduce dictionary identities.
create function private.vocabulary_source_key_values_v3(p_scope_id uuid,p_key text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s private.vocabulary_library_scopes; r private.vocabulary_library_scope_rows;
  v jsonb; b jsonb; source_doc jsonb;
begin
  select * into s from private.vocabulary_library_scopes where id=p_scope_id;
  if not found then raise exception 'library_scope_missing' using errcode='40001'; end if;
  select * into r from private.vocabulary_library_scope_rows where scope_id=p_scope_id and occurrence_key=p_key;
  if not found or r.state<>'included' or r.source_entry_id is null then raise exception 'library_source_row_missing' using errcode='40001'; end if;
  if r.resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    v:=private.resolve_vocabulary_learning_value_v1(r.resources->'selected');
    b:=private.resolve_vocabulary_learning_binding_v1(r.resources);
  else
    v:=private.project_vocabulary_learning_value_v1(r.entry_snapshot,r.resources->'selected');
    source_doc:=jsonb_build_object('kind',s.source_kind,'datasetId',s.dataset_id,'unitId',s.unit_id,'releaseId',s.source_release_id,'version',s.source_version,
      'fileHash',s.source_file_sha256,'locator',s.payload#>'{source,locator}','sourceRow',r.source_row,'occurrenceKey',r.occurrence_key,'state',r.state);
    b:=private.project_vocabulary_learning_binding_v1(r.entry_snapshot,r.occurrence_snapshot,r.resources,source_doc,private.reviewed_exam_sha256_v1(v));
  end if;
  return jsonb_build_object('value',v,'binding',b,'entryHash',r.row_sha256);
end;
$$;
create function private.resolve_vocabulary_source_key_v3(p_ref jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare resolved jsonb;
begin
  if p_ref->>'schemaVersion' is distinct from 'vocabulary-source-key-v3' or not(p_ref ?& array['scopeId','occurrenceKey','entryHash','valueHash','bindingHash']) then
    raise exception 'vocabulary_source_key_invalid' using errcode='22023'; end if;
  resolved:=private.vocabulary_source_key_values_v3((p_ref->>'scopeId')::uuid,p_ref->>'occurrenceKey');
  if resolved->>'entryHash' is distinct from p_ref->>'entryHash' or private.reviewed_exam_sha256_v1(resolved->'value') is distinct from p_ref->>'valueHash'
    or private.reviewed_exam_sha256_v1(resolved->'binding') is distinct from p_ref->>'bindingHash' then
    raise exception 'vocabulary_source_content_mismatch' using errcode='40001'; end if;
  return resolved;
end;
$$;
revoke all on function private.vocabulary_source_key_values_v3(uuid,text),private.resolve_vocabulary_source_key_v3(jsonb) from public,anon,authenticated,service_role;

create function private.insert_vocabulary_source_key_batch_v3(p_version_id uuid,p_dataset_id uuid,p_first integer,p_last integer)
returns integer language plpgsql security invoker set search_path='' as $$
declare written integer;
begin
  with positions as materialized (
    select * from private.vocabulary_composition_build_positions
    where version_id=p_version_id and row_no between p_first and p_last
  ), source_rows as materialized (
    select p.*,s.source_kind,s.source_release_id,s.dataset_id source_dataset_id,r.source_entry_id,r.source_row,r.row_sha256,
      private.vocabulary_source_key_values_v3(p.scope_id,p.occurrence_key) resolved
    from positions p join private.vocabulary_library_scopes s on s.id=p.scope_id
    join private.vocabulary_library_scope_rows r on r.scope_id=p.scope_id and r.occurrence_key=p.occurrence_key and r.state='included'
    join public.vocab_entries e on e.id=r.source_entry_id and e.dataset_id=s.dataset_id and lower(e.row_sha256)=r.row_sha256
  ), selected as materialized (
    select r.*,jsonb_build_object('selected',jsonb_build_object('schemaVersion','vocabulary-source-key-v3',
      'scopeId',scope_id,'occurrenceKey',occurrence_key,'entryHash',row_sha256,'valueHash',private.reviewed_exam_sha256_v1(resolved->'value'),'bindingHash',private.reviewed_exam_sha256_v1(resolved->'binding'))) resources,
      private.vocabulary_source_eligibility_v1(source_kind,source_release_id,source_entry_id,source_dataset_id,row_sha256) eligibility
    from source_rows r
  ) insert into private.vocabulary_composition_entries(version_id,dataset_id,vocab_entry_id,unit_id,occurrence_key,source_entry_id,source_scope_ids,
      source_kind,source_release_id,entry_sha256,identity_key,source_snapshot,resources,eligible_directions,eligibility_snapshot)
    select p_version_id,p_dataset_id,r.source_entry_id,r.unit_id,r.occurrence_key,r.source_entry_id,r.scope_ids,
      r.source_kind,r.source_release_id,r.row_sha256,
      private.reviewed_exam_sha256_v1(jsonb_build_array('unreviewed-occurrence-v1',p_version_id,r.occurrence_key)),
      jsonb_build_object('key',r.occurrence_key,'sourceRow',r.source_row,'sourceEntryId',r.source_entry_id,'rowHash',r.row_sha256,'state','included',
        'entry',jsonb_build_object('id',r.source_entry_id,'dataset_id',r.source_dataset_id,'row_sha256',upper(r.row_sha256))),
      r.resources,array(select value from jsonb_array_elements_text(r.eligibility->'directions')),r.eligibility
    from selected r order by r.row_no;
  get diagnostics written=row_count;
  if written<>p_last-p_first+1 then raise exception 'composition_entry_batch_incomplete' using errcode='40001'; end if;
  return written;
end;
$$;
revoke all on function private.insert_vocabulary_source_key_batch_v3(uuid,uuid,integer,integer) from public,anon,authenticated,service_role;

-- Keep source IDs in student records; use the existing assignment header when
-- filtering by the named selection that actually produced a wrong answer.
create function private.vocabulary_question_selection_dataset_v3(p_question_id uuid)
returns uuid language sql stable security invoker set search_path='' as $$
  select coalesce(c.dataset_id,e.dataset_id) from public.quiz_questions q join public.quiz_attempts t on t.id=q.attempt_id
  join public.assignments a on a.id=t.assignment_id join public.vocab_entries e on e.id=q.vocab_entry_id
  left join private.vocabulary_compositions c on c.dataset_id=a.dataset_id and (c.version_id=a.composition_version_id_snapshot
    or a.source_kind='book' and a.assignment_purpose='review' and a.generator_version='mistake-book-bank-v1' and a.provenance_status='notebook_snapshot_v1')
  where q.id=p_question_id;
$$;
revoke all on function private.vocabulary_question_selection_dataset_v3(uuid) from public,anon,authenticated,service_role;

-- Amend only inspected clauses; an unknown function body aborts the migration.
create function pg_temp.app04_replace(p_signature text,p_edits jsonb)
returns void language plpgsql set search_path='' as $$
declare definition text; edit jsonb; old_text text;
begin
  definition:=replace(pg_get_functiondef(p_signature::regprocedure),chr(13),'');
  for edit in select value from jsonb_array_elements(p_edits) loop
    old_text:=edit->>'oldText';
    if (length(definition)-length(replace(definition,old_text,'')))/length(old_text)<>(edit->>'count')::integer then
      raise exception 'source_key_function_changed: %',p_signature;
    end if;
    definition:=replace(definition,old_text,edit->>'newText');
  end loop;
  execute definition;
end;
$$;

select pg_temp.app04_replace($sig$private.initialize_vocabulary_composition_before_delete_v1(uuid,text,uuid,uuid)$sig$,$edits$[
  {
    "oldText": "values(p_version_id,'learning-values-v2')",
    "newText": "values(p_version_id,'source-keys-v3')",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.insert_vocabulary_composition_entry_batch_v1(uuid,text,uuid,integer,integer)$sig$,$edits$[
  {
    "oldText": "begin\n",
    "newText": "begin\n  if exists(select 1 from private.vocabulary_composition_storage_formats where version_id=p_version_id and format='source-keys-v3') then\n    return private.insert_vocabulary_source_key_batch_v3(p_version_id,p_dataset_id,p_first,p_last);\n  end if;\n",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.resolve_vocabulary_learning_value_v1(jsonb)$sig$,$edits$[
  {
    "oldText": "begin\n",
    "newText": "begin\n  if p_ref->>'schemaVersion'='vocabulary-source-key-v3' then return private.resolve_vocabulary_source_key_v3(p_ref)->'value'; end if;\n",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.resolve_vocabulary_learning_binding_v1(jsonb)$sig$,$edits$[
  {
    "oldText": "begin\n",
    "newText": "begin\n  if p_resources#>>'{selected,schemaVersion}'='vocabulary-source-key-v3' then return private.resolve_vocabulary_source_key_v3(p_resources->'selected')->'binding'; end if;\n",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_composition_resource_v1(jsonb)$sig$,$edits$[
  {
    "oldText": "p_resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2'",
    "newText": "p_resources#>>'{selected,schemaVersion}' in ('vocabulary-resource-ref-v2','vocabulary-source-key-v3')",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.assignment_vocabulary_meaning_v1(uuid,integer)$sig$,$edits$[
  {
    "oldText": "c.resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2'",
    "newText": "c.resources#>>'{selected,schemaVersion}' in ('vocabulary-resource-ref-v2','vocabulary-source-key-v3')",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_composition_question_input_v1(uuid)$sig$,$edits$[
  {
    "oldText": "'unitId',e.unit_id,'sourceRow',e.source_row",
    "newText": "'unitId',l.unit_id,'sourceRow',coalesce(p.row_no,e.source_row)",
    "count": 1
  },
  {
    "oldText": "order by e.source_row)",
    "newText": "order by coalesce(p.row_no,e.source_row))",
    "count": 1
  },
  {
    "oldText": "join public.vocab_entries e on e.id=l.vocab_entry_id",
    "newText": "join public.vocab_entries e on e.id=l.vocab_entry_id\n      left join private.vocabulary_composition_build_positions p on p.version_id=l.version_id and p.occurrence_key=l.occurrence_key",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.set_composition_question_identity()$sig$,$edits$[
  {
    "oldText": "from private.vocabulary_composition_entries l where l.vocab_entry_id=new.vocab_entry_id",
    "newText": "from private.vocabulary_composition_entries l where l.version_id=new.composition_version_id_snapshot and l.vocab_entry_id=new.vocab_entry_id",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_entry_choice_safety_v1(bigint,bigint[])$sig$,$edits$[
  {
    "oldText": "where vocab_entry_id=p_entry_id;",
    "newText": "where vocab_entry_id=p_entry_id and source_entry_id<>vocab_entry_id;",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$public.list_active_vocabulary_composition_questions_v1(uuid,uuid[],text)$sig$,$edits$[
  {
    "oldText": "on l.vocab_entry_id=i.vocab_entry_id",
    "newText": "on l.version_id=i.version_id and l.vocab_entry_id=i.vocab_entry_id",
    "count": 1
  },
  {
    "oldText": "i.vocab_entry_id,e.unit_id,e.source_row",
    "newText": "i.vocab_entry_id,l.unit_id,coalesce(p.row_no,e.source_row)",
    "count": 1
  },
  {
    "oldText": "and lower(e.row_sha256)=l.entry_sha256",
    "newText": "and lower(e.row_sha256)=l.entry_sha256\n    left join private.vocabulary_composition_build_positions p on p.version_id=l.version_id and p.occurrence_key=l.occurrence_key",
    "count": 1
  },
  {
    "oldText": "and e.unit_id=any(p_unit_ids)",
    "newText": "and l.unit_id=any(p_unit_ids)",
    "count": 1
  },
  {
    "oldText": "order by e.source_row,i.direction",
    "newText": "order by coalesce(p.row_no,e.source_row),i.direction",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_composition_question_in_scope_v1(uuid,text,uuid[])$sig$,$edits$[
  {
    "oldText": "join public.vocab_entries e on e.id=i.vocab_entry_id",
    "newText": "join private.vocabulary_composition_entries e on e.version_id=i.version_id and e.vocab_entry_id=i.vocab_entry_id",
    "count": 1
  },
  {
    "oldText": "join public.vocab_entries oe on oe.id=other.vocab_entry_id",
    "newText": "join private.vocabulary_composition_entries oe on oe.version_id=other.version_id and oe.vocab_entry_id=other.vocab_entry_id",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.copy_vocabulary_reviewed_batch_v1(uuid,uuid,integer)$sig$,$edits$[
  {
    "oldText": "where l.version_id=p_version_id and l.source_kind='reviewed_exam' and e.source_row>p_after_row order by e.source_row limit 100",
    "newText": "left join private.vocabulary_composition_build_positions p on p.version_id=l.version_id and p.occurrence_key=l.occurrence_key\n    where l.version_id=p_version_id and l.source_kind='reviewed_exam' and coalesce(p.row_no,e.source_row)>p_after_row order by coalesce(p.row_no,e.source_row) limit 100",
    "count": 1
  },
  {
    "oldText": "select source_row into last_row from public.vocab_entries where id=target_entry.vocab_entry_id;",
    "newText": "select coalesce(p.row_no,e.source_row) into last_row from public.vocab_entries e\n      left join private.vocabulary_composition_build_positions p on p.version_id=p_version_id and p.occurrence_key=target_entry.occurrence_key\n      where e.id=target_entry.vocab_entry_id;",
    "count": 1
  },
  {
    "oldText": "storage_v2 boolean:=private.vocabulary_composition_uses_learning_values_v1(p_version_id);",
    "newText": "storage_v2 boolean:=private.vocabulary_composition_uses_learning_values_v1(p_version_id) or exists(select 1 from private.vocabulary_composition_storage_formats where version_id=p_version_id and format='source-keys-v3');",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.advance_vocabulary_composition_build_v1(uuid,text,uuid,uuid)$sig$,$edits$[
  {
    "oldText": "where l.version_id=b.version_id and l.source_kind='reviewed_exam' and e.source_row>last_row",
    "newText": "left join private.vocabulary_composition_build_positions p on p.version_id=l.version_id and p.occurrence_key=l.occurrence_key\n    where l.version_id=b.version_id and l.source_kind='reviewed_exam' and coalesce(p.row_no,e.source_row)>last_row",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.assert_vocabulary_composition_build_complete_v1(uuid)$sig$,$edits$[
  {
    "oldText": "    or (select count(*) from public.vocab_entries where dataset_id=b.dataset_id)<>b.total_count\n",
    "newText": "",
    "count": 1
  },
  {
    "oldText": "left join public.vocab_entries e on e.dataset_id=b.dataset_id and e.source_row=p.row_no\n      left join private.vocabulary_composition_entries l on l.version_id=b.version_id and l.vocab_entry_id=e.id",
    "newText": "left join private.vocabulary_composition_entries l on l.version_id=b.version_id and l.occurrence_key=p.occurrence_key\n      left join public.vocab_entries e on e.id=l.vocab_entry_id",
    "count": 1
  },
  {
    "oldText": " or e.unit_id is distinct from p.unit_id\n        or e.position_in_unit is distinct from p.position_no",
    "newText": "",
    "count": 1
  },
  {
    "oldText": "u.entry_count<>(select count(*) from public.vocab_entries e where e.unit_id=u.id and e.dataset_id=b.dataset_id)",
    "newText": "u.entry_count<>(select count(*) from private.vocabulary_composition_entries e where e.version_id=b.version_id and e.unit_id=u.id and e.dataset_id=b.dataset_id)",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.create_composition_bank_for_delivery_v1(uuid,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,uuid[],text,integer,jsonb,boolean)$sig$,$edits$[
  {
    "oldText": "select min(e.source_row),max(e.source_row) into min_row,max_row from public.vocab_entries e join jsonb_array_elements(p_questions)q on e.id=(q->>'vocab_entry_id')::bigint where e.dataset_id=p_dataset_id;",
    "newText": "select min(coalesce(p.row_no,e.source_row)),max(coalesce(p.row_no,e.source_row)) into min_row,max_row\n    from private.vocabulary_composition_entries l join public.vocab_entries e on e.id=l.vocab_entry_id\n    left join private.vocabulary_composition_build_positions p on p.version_id=l.version_id and p.occurrence_key=l.occurrence_key\n    join jsonb_array_elements(p_questions)q on e.id=(q->>'vocab_entry_id')::bigint where l.version_id=version_value;",
    "count": 1
  },
  {
    "oldText": "  insert into public.assignment_units",
    "newText": "  insert into public.assignment_sources(assignment_id,dataset_id)\n    select distinct assignment_value,e.dataset_id from public.vocab_entries e\n    join jsonb_array_elements(p_questions)q on e.id=(q->>'vocab_entry_id')::bigint on conflict do nothing;\n  insert into public.assignment_units",
    "count": 1
  },
  {
    "oldText": "private.vocabulary_composition_items i join public.vocab_entries e on e.id=i.vocab_entry_id",
    "newText": "private.vocabulary_composition_items i join private.vocabulary_composition_entries e on e.version_id=i.version_id and e.vocab_entry_id=i.vocab_entry_id",
    "count": 1
  },
  {
    "oldText": "where vocab_entry_id=source_item.vocab_entry_id;",
    "newText": "where version_id=version_value and vocab_entry_id=source_item.vocab_entry_id;",
    "count": 1
  },
  {
    "oldText": "source_item.correct_choice_index,p_dataset_id,upper(source_entry.entry_sha256)",
    "newText": "source_item.correct_choice_index,entry_row.dataset_id,upper(source_entry.entry_sha256)",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.check_assignment_source_relation_v1()$sig$,$edits$[
  {
    "oldText": "or a.source_kind='book' and exists(select 1 from public.assignment_sources where assignment_id=aid and dataset_id<>a.dataset_id)",
    "newText": "or a.source_kind='book' and exists(select 1 from public.assignment_sources s where s.assignment_id=aid and s.dataset_id<>a.dataset_id\n      and not ((a.composition_version_id_snapshot is not null and exists(select 1 from private.vocabulary_compositions c\n        where c.version_id=a.composition_version_id_snapshot and c.dataset_id=a.dataset_id)\n        and exists(select 1 from public.assignment_questions q where q.assignment_id=aid and q.dataset_id=s.dataset_id\n          and q.composition_version_id_snapshot=a.composition_version_id_snapshot)))",
    "count": 1
  },
  {
    "oldText": "and q.composition_version_id_snapshot=a.composition_version_id_snapshot)))",
    "newText": "and q.composition_version_id_snapshot=a.composition_version_id_snapshot))\n        or (a.assignment_purpose='review' and a.generator_version='mistake-book-bank-v1' and a.provenance_status='notebook_snapshot_v1'\n          and exists(select 1 from private.vocabulary_compositions co where co.dataset_id=a.dataset_id)\n          and exists(select 1 from public.assignment_questions q where q.assignment_id=aid and q.dataset_id=s.dataset_id)\n          and not exists(select 1 from public.assignment_questions q left join private.notebook_question_origins_v2 origin on origin.assignment_question_id=q.id\n            where q.assignment_id=aid and (origin.source_question_id is null\n              or private.vocabulary_question_selection_dataset_v3(origin.source_question_id) is distinct from a.dataset_id)))))",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$public.list_vocabulary_composition_review_choices_v1(uuid,bigint[],text,uuid[])$sig$,$edits$[
  {
    "oldText": "from public.vocab_entries e where e.dataset_id=p_dataset_id and e.id=any(p_vocab_entry_ids)",
    "newText": "from private.vocabulary_composition_entries e where e.dataset_id=p_dataset_id and e.vocab_entry_id=any(p_vocab_entry_ids)",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.word_practice_source_v1(uuid,jsonb)$sig$,$edits$[
  {
    "oldText": "where c.vocab_entry_id=e.id",
    "newText": "where c.vocab_entry_id=e.id and c.source_entry_id<>c.vocab_entry_id",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_composition_target_units_v1(uuid,jsonb)$sig$,$edits$[
  {
    "oldText": "join public.vocab_entries e on e.id=(q->>'vocab_entry_id')::bigint",
    "newText": "join private.vocabulary_composition_entries e on e.vocab_entry_id=(q->>'vocab_entry_id')::bigint",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])$sig$,$edits$[
  {
    "oldText": "(p_dataset_id is null or p_dataset_id=any(datasets))",
    "newText": "(p_dataset_id is null or p_dataset_id=any(datasets) or exists(select 1 from base b\n        where b.word_key=grouped.word_key and private.vocabulary_question_selection_dataset_v3(b.quiz_question_id)=p_dataset_id))",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.create_exact_review_assignment_v5(uuid,uuid,uuid[],text,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,jsonb)$sig$,$edits$[
  {
    "oldText": "and queue.dataset_id = p_dataset_id",
    "newText": "and (queue.dataset_id = p_dataset_id or private.vocabulary_question_selection_dataset_v3(queue.source_question_id)=p_dataset_id)",
    "count": 1
  },
  {
    "oldText": "and question_entry.dataset_id = p_dataset_id",
    "newText": "and question_entry.dataset_id = queue.dataset_id",
    "count": 1
  },
  {
    "oldText": "and eligibility.dataset_id = p_dataset_id",
    "newText": "and eligibility.dataset_id = question_entry.dataset_id",
    "count": 1
  },
  {
    "oldText": "        p_dataset_id,\n        question.vocab_entry_id,",
    "newText": "        question_entry.dataset_id,\n        question.vocab_entry_id,",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.replace_student_assignment_v4(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamp with time zone,text,integer,smallint[],uuid[],jsonb)$sig$,$edits$[
  {
    "oldText": "and queue.dataset_id = p_dataset_id",
    "newText": "and (queue.dataset_id = p_dataset_id or private.vocabulary_question_selection_dataset_v3(queue.source_question_id)=p_dataset_id)",
    "count": 3
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.enforce_review_assignment_draft_item()$sig$,$edits$[
  {
    "oldText": "and queue.dataset_id = draft.dataset_id",
    "newText": "and (queue.dataset_id = draft.dataset_id or private.vocabulary_question_selection_dataset_v3(queue.source_question_id)=draft.dataset_id)",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.persist_exact_review_assignment_exam_use_v7_compat(uuid,uuid,uuid[],uuid,text,uuid[],smallint,integer,smallint,public.question_order_mode,timestamp with time zone,jsonb)$sig$,$edits$[
  {
    "oldText": "and queue.dataset_id = p_dataset_id",
    "newText": "and (queue.dataset_id = p_dataset_id or private.vocabulary_question_selection_dataset_v3(queue.source_question_id)=p_dataset_id)",
    "count": 2
  },
  {
    "oldText": "and eligibility.dataset_id = p_dataset_id",
    "newText": "and eligibility.dataset_id = queue.dataset_id",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_mistake_sources_v1(uuid,bigint)$sig$,$edits$[
  {
    "oldText": "select ev.meaning_key,e.dataset_id,q.vocab_entry_id,d.title",
    "newText": "select ev.meaning_key,d.id,q.vocab_entry_id,d.title",
    "count": 1
  },
  {
    "oldText": "join public.vocab_datasets d on d.id=e.dataset_id",
    "newText": "join public.vocab_datasets d on d.id=private.vocabulary_question_selection_dataset_v3(q.id)",
    "count": 1
  },
  {
    "oldText": "group by ev.meaning_key,e.dataset_id,q.vocab_entry_id,d.title",
    "newText": "group by ev.meaning_key,d.id,q.vocab_entry_id,d.title",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$public.prepare_book_mistake_assignment_source_v1(uuid,uuid,jsonb)$sig$,$edits$[
  {
    "oldText": "where w->>'latestDatasetId'=ds::text",
    "newText": "where (w->>'latestDatasetId'=ds::text or private.vocabulary_question_selection_dataset_v3((w->>'sourceQuestionId')::uuid)=ds)",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$public.create_book_mistake_assignments_v1(uuid,uuid,text,jsonb)$sig$,$edits$[
  {
    "oldText": "select array_agg(distinct dataset_id order by dataset_id) into selected_dataset_ids from public.vocab_entries where id=any(selected_entry_ids);",
    "newText": "select array_agg(distinct dataset_id order by dataset_id) into selected_dataset_ids from (\n    select dataset_id from public.vocab_entries where id=any(selected_entry_ids)\n    union select (b#>>'{selection,datasetId}')::uuid from jsonb_array_elements(p_batches) b\n  ) selected;",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.create_book_mistake_bank_v1(uuid,uuid,jsonb,jsonb,jsonb)$sig$,$edits$[
  {
    "oldText": "  selected_targets jsonb; queue_ids uuid[]; changed integer;",
    "newText": "  selected_targets jsonb; queue_ids uuid[]; changed integer;\n  selection_dataset uuid:=(p_source#>>'{selection,filters,datasetId}')::uuid; selection_matches boolean;",
    "count": 1
  },
  {
    "oldText": "begin\n  if (select count(distinct w->>'latestDatasetId')",
    "newText": "begin\n  selection_matches:=exists(select 1 from private.vocabulary_compositions where dataset_id=selection_dataset and state='ready')\n    and not exists(select 1 from jsonb_array_elements(p_source->'words') w join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey'\n      where private.vocabulary_question_selection_dataset_v3((w->>'sourceQuestionId')::uuid) is distinct from selection_dataset);\n  if (not selection_matches and (select count(distinct w->>'latestDatasetId')",
    "count": 1
  },
  {
    "oldText": "join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey')<>1",
    "newText": "join jsonb_array_elements(p_questions) q on q->>'meaningKey'=w->>'meaningKey')<>1)",
    "count": 1
  },
  {
    "oldText": "  insert into public.assignments(title,dataset_id",
    "newText": "  if selection_matches then representative:=selection_dataset; end if;\n  insert into public.assignments(title,dataset_id",
    "count": 1
  },
  {
    "oldText": "  insert into public.assignment_sources(assignment_id,dataset_id) select distinct aid",
    "newText": "  insert into public.assignment_sources(assignment_id,dataset_id) values(aid,representative) on conflict do nothing;\n  insert into public.assignment_sources(assignment_id,dataset_id) select distinct aid",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$public.prepare_notebook_assignment_source_v2(uuid,uuid,jsonb)$sig$,$edits$[
  {
    "oldText": "'available',d.status='ready' and d.is_active and coalesce(c.is_assignable,false)",
    "newText": "'available',(d.status='ready' and d.is_active and coalesce(c.is_assignable,false)) or not exists(\n      select 1 from jsonb_array_elements(result->'words') w where w->>'latestDatasetId'=d.id::text and not exists(\n        select 1 from public.quiz_questions q join public.quiz_attempts t on t.id=q.attempt_id\n        join public.assignments a on a.id=t.assignment_id\n        join private.vocabulary_compositions co on co.dataset_id=private.vocabulary_question_selection_dataset_v3(q.id) and co.state='ready'\n        join private.vocabulary_composition_entries ce on ce.version_id=co.version_id and ce.vocab_entry_id=q.vocab_entry_id\n        join public.vocab_entries e on e.id=ce.vocab_entry_id and lower(e.row_sha256)=ce.entry_sha256\n        join public.vocab_datasets sd on sd.id=co.dataset_id and sd.status='ready' and sd.is_active\n        join public.vocab_dataset_catalog sc on sc.dataset_id=sd.id and sc.is_assignable\n        where q.id=(w->>'sourceQuestionId')::uuid and t.student_id=p_student_id and ce.vocab_entry_id=(w->>'latestVocabEntryId')::bigint))",
    "count": 1
  }
]$edits$::jsonb);

select pg_temp.app04_replace($sig$private.vocabulary_question_bank_body_v1(jsonb)$sig$,$edits$[
  {
    "oldText": "item.dataset_id::text is distinct from b->>'dataset_id'",
    "newText": "not exists(select 1 from private.vocabulary_composition_entries ce join public.vocab_entries e on e.id=ce.vocab_entry_id\n        where ce.version_id=item.version_id and ce.vocab_entry_id=item.vocab_entry_id and ce.dataset_id=item.dataset_id and e.dataset_id::text=b->>'dataset_id')",
    "count": 1
  }
]$edits$::jsonb);

-- Existing compatibility entrypoint delegates to the same writer.
CREATE OR REPLACE FUNCTION private.prepare_vocabulary_composition_data_before_delete_v1(p_version_id uuid,p_content_sha256 text,p_actor_id uuid,p_management_request_id uuid)
RETURNS jsonb LANGUAGE plpgsql SET search_path='' AS $$
declare c private.vocabulary_compositions; step jsonb;
begin
  if p_version_id is null or p_content_sha256 is null then raise exception 'composition_version_invalid' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-composition:'||p_version_id::text,0));
  select * into c from private.vocabulary_compositions where version_id=p_version_id for update;
  if found then
    if c.content_sha256 is distinct from p_content_sha256 then raise exception 'composition_changed' using errcode='40001'; end if;
    if exists(select 1 from private.vocabulary_composition_builds where version_id=p_version_id and not preparation_complete) then
      raise exception 'composition_preparation_incomplete' using errcode='40001'; end if;
    return private.vocabulary_composition_response_v1(p_version_id,true);
  end if;
  loop
    step:=private.advance_vocabulary_composition_build_v1(p_version_id,p_content_sha256,p_actor_id,p_management_request_id);
    exit when step->>'stage' in ('prepared','complete');
  end loop;
  return private.vocabulary_composition_response_v1(p_version_id,true);
end;
$$;

commit;
