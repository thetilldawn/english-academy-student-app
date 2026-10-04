-- APP-20261004-03: keep one current meaning state; preserve legacy rows and protocols.
begin;
do $repair$
declare item record; change jsonb; source text; definition text; signature regprocedure;
begin
  for item in select * from jsonb_to_recordset($manifest$[
  {
    "signature": "private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])",
    "before_md5": "2245af16601de34dc9b2717a35d43c61",
    "after_md5": "4638f81a7a7d3666a2bda2ee2d6076ad",
    "changes": [
      {
        "from": "  with base as materialized (",
        "to": "  with current_meanings as materialized (\n    select meaning_key,unresolved from private.current_vocabulary_meaning_states_v1(p_student_id)\n  ), base as materialized ("
      },
      {
        "from": "      case when state.vocab_entry_id is not null",
        "to": "      case when meaning_state.meaning_key is not null\n        then case when meaning_state.unresolved then 'unresolved' else 'resolved' end\n        when state.vocab_entry_id is not null"
      },
      {
        "from": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id",
        "to": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id\n    left join current_meanings meaning_state\n      on meaning_state.meaning_key=(private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey')"
      }
    ]
  },
  {
    "signature": "public.get_admin_student_wrong_word_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text)",
    "before_md5": "7712126a61327d8444105a4fe9bbc7ad",
    "after_md5": "69a1e4ed20d4d3eadaeac394c2ce8580",
    "changes": [
      {
        "from": "  with base as materialized (",
        "to": "  with current_meanings as materialized (\n    select meaning_key,unresolved from private.current_vocabulary_meaning_states_v1(p_student_id)\n  ), base as materialized ("
      },
      {
        "from": "      case when state.vocab_entry_id is not null",
        "to": "      case when meaning_state.meaning_key is not null\n        then case when meaning_state.unresolved then 'unresolved' else 'resolved' end\n        when state.vocab_entry_id is not null"
      },
      {
        "from": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id",
        "to": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id\n    left join current_meanings meaning_state\n      on meaning_state.meaning_key=(private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey')"
      }
    ]
  },
  {
    "signature": "private.wrong_word_notebook_page_v1(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer)",
    "before_md5": "c401cae416b78eeadf033be1f198aafa",
    "after_md5": "3e9384019a6ad3413f3ece3f80ef2538",
    "changes": [
      {
        "from": "  with base as materialized (",
        "to": "  with current_meanings as materialized (\n    select meaning_key,unresolved from private.current_vocabulary_meaning_states_v1(p_student_id)\n  ), base as materialized ("
      },
      {
        "from": "      case when state.vocab_entry_id is not null",
        "to": "      case when meaning_state.meaning_key is not null\n        then case when meaning_state.unresolved then 'unresolved' else 'resolved' end\n        when state.vocab_entry_id is not null"
      },
      {
        "from": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id",
        "to": "    left join public.student_vocab_state state on state.student_id=p_student_id and state.vocab_entry_id=f.vocab_entry_id\n    left join current_meanings meaning_state\n      on meaning_state.meaning_key=(private.quiz_vocabulary_meaning_v1(l.quiz_question_id)->>'meaningKey')"
      }
    ]
  },
  {
    "signature": "public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)",
    "before_md5": "fb34923b88bc1de459d35db0217c0f42",
    "after_md5": "a2aabb0caaf2f95d7bb4776d877d6d49",
    "changes": [
      {
        "from": "  perform private.project_local_quiz_legacy_state_v1(p_student_id,a.id);",
        "to": "  -- The shared meaning state is authoritative for local exams."
      }
    ]
  }
]$manifest$::jsonb)
    as x(signature text,before_md5 text,after_md5 text,changes jsonb) loop
    signature:=item.signature::regprocedure;
    select prosrc,pg_get_functiondef(oid) into strict source,definition from pg_proc where oid=signature;
    if md5(source)=item.after_md5 then continue; end if;
    if md5(source)<>item.before_md5 then raise exception 'shared_state_source_changed: %',item.signature using errcode='55000'; end if;
    for change in select value from jsonb_array_elements(item.changes) loop
      if (length(definition)-length(replace(definition,change->>'from','')))/length(change->>'from')<>1
        then raise exception 'shared_state_anchor_changed: %',item.signature using errcode='55000'; end if;
      definition:=replace(definition,change->>'from',change->>'to');
    end loop;
    execute definition;
    select prosrc into strict source from pg_proc where oid=signature;
    if md5(source)<>item.after_md5 then raise exception 'shared_state_postcondition_failed: %',item.signature using errcode='55000'; end if;
  end loop;
end;
$repair$;
commit;
