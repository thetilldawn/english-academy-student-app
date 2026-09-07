begin;
create function private.activate_reviewed_exam_release_v1(p_release_id uuid,p_content_sha256 text)
returns void language plpgsql security definer set search_path='' as $$
declare release_row private.reviewed_exam_releases%rowtype; approval private.reviewed_exam_import_approvals%rowtype;
begin
  select * into release_row from private.reviewed_exam_releases where release_id=p_release_id and content_sha256=p_content_sha256 for update;
  if not found then raise exception 'reviewed_exam_release_mismatch'; end if;
  select * into approval from private.reviewed_exam_import_approvals where target_project_ref=private.request_supabase_project_ref_v1()
    and bundle_file_sha256=release_row.file_sha256 and content_sha256=release_row.content_sha256 for share;
  if not found then raise exception 'reviewed_exam_activation_not_approved' using errcode='42501'; end if;
  if (select count(*) from private.reviewed_exam_entries where release_id=p_release_id)<>approval.entry_count
    or (select count(*) from private.reviewed_exam_items where release_id=p_release_id)<>approval.question_count
    or exists(select 1 from private.reviewed_exam_entries s join public.vocab_entries e on e.id=s.vocab_entry_id
      where s.release_id=p_release_id and lower(e.row_sha256)<>s.entry_sha256)
  then raise exception 'reviewed_exam_activation_incomplete'; end if;
  update private.reviewed_exam_releases set status='active',activated_at=coalesce(activated_at,clock_timestamp()) where release_id=p_release_id;
  update public.vocab_datasets set status='ready' where id=release_row.dataset_id;
  update public.vocab_dataset_catalog set is_assignable=true where dataset_id=release_row.dataset_id;
  if not found then raise exception 'reviewed_exam_catalog_missing'; end if;
end;
$$;
revoke all on function private.activate_reviewed_exam_release_v1(uuid,text) from public,anon,authenticated,service_role;

do $migration$
declare definition text; old_fragment text; new_fragment text;
begin
  definition:=replace(pg_get_functiondef('private.student_assignment_study_content_v1(uuid,uuid)'::regprocedure),chr(13),'');
  definition:=replace(definition,'''reviewed_for_preview_v1'',''preview_verified_v1''','''reviewed_for_preview_v1'',''preview_verified_v1'',''exam_reviewed_v1''');
  old_fragment:='''definition'', case when q.eligibility_quiz_mode = ''canonical_definition_to_headword'' then q.prompt end,';
  new_fragment:='''definition'', case when q.provenance_status=''exam_reviewed_v1'' and q.eligibility_quiz_mode in (''canonical_definition_to_headword'',''canonical_headword_to_definition'') then reviewed.payload->>''english_definition'' when q.eligibility_quiz_mode = ''canonical_definition_to_headword'' then q.prompt end,';
  if position(old_fragment in definition)=0 then raise exception 'reviewed_study_definition_anchor_changed'; end if;
  definition:=replace(definition,old_fragment,new_fragment);
  old_fragment:='left join public.assignment_question_exam_use_snapshot s';
  new_fragment:=E'left join private.reviewed_exam_entries reviewed on reviewed.release_id=q.reviewed_exam_release_id_snapshot and reviewed.vocab_entry_id=q.vocab_entry_id and upper(reviewed.entry_sha256)=q.entry_row_sha256_snapshot\n    left join public.assignment_question_exam_use_snapshot s';
  if position(old_fragment in definition)=0 then raise exception 'reviewed_study_source_anchor_changed'; end if;
  execute replace(definition,old_fragment,new_fragment);
end;
$migration$;
notify pgrst,'reload schema';
commit;
