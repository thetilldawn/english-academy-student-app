begin;

create function public.list_reviewed_exam_review_choices_v1(p_dataset_id uuid,p_vocab_entry_ids bigint[],p_quiz_mode text default 'book_meaning_choice')
returns table(vocab_entry_id bigint,direction public.question_direction,choice_vocab_entry_ids bigint[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>500 or exists(select 1 from unnest(p_vocab_entry_ids) v where v is null or v<1) then raise exception 'reviewed_review_selection_invalid' using errcode='22023'; end if;
  return query select i.vocab_entry_id,i.direction,i.choice_vocab_entry_ids from private.reviewed_exam_items i
    join private.reviewed_exam_releases r on r.release_id=i.release_id and r.status='active'
    join public.vocab_entries e on e.id=i.vocab_entry_id
    join private.reviewed_exam_entries s on s.release_id=i.release_id and s.vocab_entry_id=i.vocab_entry_id and lower(e.row_sha256)=s.entry_sha256
    where i.dataset_id=p_dataset_id and i.quiz_mode=p_quiz_mode and i.vocab_entry_id=any(p_vocab_entry_ids)
    order by i.vocab_entry_id,i.direction;
end;
$$;
revoke all on function public.list_reviewed_exam_review_choices_v1(uuid,bigint[],text) from public,anon,authenticated,service_role;
grant execute on function public.list_reviewed_exam_review_choices_v1(uuid,bigint[],text) to authenticated;

-- Resolve only stored choices. Clients cannot submit prompt/answer text or choose
-- an unreviewed source by adding fields to the existing four-field edit plan.
create function private.reviewed_exam_plan_from_choices_v1(p_dataset_id uuid,p_questions jsonb,p_mode text default 'book_meaning_choice')
returns jsonb language plpgsql security definer set search_path='' as $$
declare q jsonb; item_row private.reviewed_exam_items%rowtype; release_row private.reviewed_exam_releases%rowtype; result_value jsonb:='[]';
begin
  if p_questions is null or jsonb_typeof(p_questions)<>'array' or jsonb_array_length(p_questions) not between 1 and 500 then raise exception 'reviewed_assignment_plan_invalid' using errcode='22023'; end if;
  select * into release_row from private.reviewed_exam_releases where dataset_id=p_dataset_id and status='active' for share;
  if not found then raise exception 'reviewed_exam_release_unavailable' using errcode='55000'; end if;
  for q in select value from jsonb_array_elements(p_questions) order by (value->>'base_order_index')::int loop
    select * into item_row from private.reviewed_exam_items where release_id=release_row.release_id and vocab_entry_id=(q->>'vocab_entry_id')::bigint
      and quiz_mode=p_mode and direction::text=q->>'direction' and to_jsonb(choice_vocab_entry_ids)=q->'choice_vocab_entry_ids';
    if not found then raise exception 'reviewed_assignment_snapshot_mismatch' using errcode='55000'; end if;
    result_value:=result_value||jsonb_build_array(jsonb_build_object('vocab_entry_id',item_row.vocab_entry_id,'direction',item_row.direction,'base_order_index',q->'base_order_index',
      'reviewed_bank',jsonb_build_object('source','reviewed_exam_v1','mode',p_mode,'release_id',release_row.release_id,'package_sha256',release_row.file_sha256,'question_item_id',item_row.item_id,'question_item_sha256',item_row.item_sha256)));
  end loop;
  return result_value;
end;
$$;
revoke all on function private.reviewed_exam_plan_from_choices_v1(uuid,jsonb,text) from public,anon,authenticated,service_role;

do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  definition:=replace(pg_get_functiondef('private.list_student_direct_review_candidates_v1(uuid,uuid)'::regprocedure),chr(13),'');
  old_fragment:=E'      and (\n        exists (\n          select 1\n          from word_index.app_exam_use_release as release';
  new_fragment:=E'      and (\n        exists(select 1 from private.reviewed_exam_releases r join private.reviewed_exam_items i on i.release_id=r.release_id\n          join private.reviewed_exam_entries s on s.release_id=i.release_id and s.vocab_entry_id=i.vocab_entry_id\n          where r.status=''active'' and i.dataset_id=entry.dataset_id and i.vocab_entry_id=entry.id\n            and i.quiz_mode=''book_meaning_choice'' and s.entry_sha256=lower(entry.row_sha256))\n        or exists (\n          select 1\n          from word_index.app_exam_use_release as release';
  if position(old_fragment in definition)=0 then raise exception 'reviewed_wrong_candidate_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('private.create_exact_review_question_bank_exam_use_dispatch_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],jsonb)'::regprocedure),chr(13),'');
  old_fragment:=E'begin\n';
  new_fragment:=E'begin\n  if exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then\n    return private.create_reviewed_bank_for_delivery_v1((select auth.uid()),p_title,p_dataset_id,p_unit_ids,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,p_available_until,p_student_ids,''total'',null,private.reviewed_exam_plan_from_choices_v1(p_dataset_id,p_questions,''book_meaning_choice''),true);\n  end if;\n';
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'reviewed_exact_dispatch_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('private.create_exact_review_assignment_with_delivery_v1(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)'::regprocedure),chr(13),'');
  old_fragment:=E'  perform private.assert_assignment_target_prompts_unambiguous_v1(\n    p_dataset_id,\n    p_questions\n  );';
  new_fragment:=E'  if not exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then\n    perform private.assert_assignment_target_prompts_unambiguous_v1(p_dataset_id,p_questions);\n  end if;';
  if position(old_fragment in definition)=0 then raise exception 'reviewed_exact_prompt_guard_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('public.replace_student_assignment_v7(uuid,uuid,uuid,text,text,text,text,uuid,uuid[],integer,smallint,integer,smallint,boolean,smallint,public.question_order_mode,timestamptz,timestamptz,text,integer,smallint[],text,uuid[],jsonb)'::regprocedure),chr(13),'');
  old_fragment:='  result_value := private.replace_student_assignment_v4(';
  new_fragment:=E'  if source_purpose=''regular'' then\n    if exists(select 1 from private.reviewed_exam_releases where dataset_id=p_dataset_id) then\n      p_questions:=private.reviewed_exam_plan_from_choices_v1(p_dataset_id,p_questions,coalesce((select case when provenance_status=''exam_reviewed_v1'' then quiz_content_mode else ''book_meaning_choice'' end from public.assignments where id=p_source_assignment_id),''book_meaning_choice''));\n    elsif exists(select 1 from public.assignments where id=p_source_assignment_id and provenance_status=''exam_reviewed_v1'' and quiz_content_mode<>''book_meaning_choice'') then\n      raise exception ''reviewed_assignment_mode_unavailable'' using errcode=''22023'';\n    end if;\n  end if;\n\n  result_value := private.replace_student_assignment_v4(';
  if position(old_fragment in definition)=0 then raise exception 'reviewed_replacement_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);

  definition:=replace(pg_get_functiondef('private.create_assignment_with_delivery_v6(text,uuid,uuid[],integer,smallint,integer,smallint,public.question_order_mode,timestamptz,uuid[],text,integer,jsonb)'::regprocedure),chr(13),'');
  old_fragment:=E'begin\n';
  new_fragment:=E'begin\n  if jsonb_typeof(p_questions)=''array'' and exists(select 1 from jsonb_array_elements(p_questions) q where q?''reviewed_bank'') then\n    created_assignment_id:=private.create_reviewed_bank_for_delivery_v1((select auth.uid()),p_title,p_dataset_id,p_unit_ids,p_question_count,p_english_to_korean_ratio,p_time_limit_seconds,p_passing_score,p_question_order_mode,p_available_until,p_student_ids,p_timing_mode,p_question_time_limit_seconds,p_questions);\n    perform private.link_pending_review_targets_v2(created_assignment_id,p_student_ids,null);\n    return created_assignment_id;\n  end if;\n';
  if (length(definition)-length(replace(definition,old_fragment,'')))/length(old_fragment)<>1 then raise exception 'reviewed_edit_delivery_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
notify pgrst,'reload schema';
commit;
