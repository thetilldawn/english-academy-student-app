begin;

-- Only the feedback gap changes. Existing 100ms device answers and mixed
-- sessions remain valid; first-question time, deadlines and receipts do not move.
do $patch$
declare
  target regprocedure := 'public.submit_local_quiz_phase_v1(uuid,uuid,text,text,text,uuid,jsonb,jsonb)'::regprocedure;
  definition text := pg_get_functiondef(target);
  old_condition text := 'if opened<>previous_elapsed+100 or p.limit_ms is not null and elapsed>p.limit_ms';
  new_condition text := 'if (n=1 and opened<>0) or (n>1 and opened not in (previous_elapsed+100,previous_elapsed+250)) or p.limit_ms is not null and elapsed>p.limit_ms';
begin
  if (length(definition)-length(replace(definition,old_condition,'')))/length(old_condition) <> 1 then
    raise exception 'local_quiz_feedback_patch_target_changed';
  end if;
  execute replace(definition,old_condition,new_condition);
end $patch$;

-- This endpoint reads permission and small references, never word/audio bodies.
-- Reuse the exact study release policy, including previously attempted exams.
create or replace function public.get_student_assignment_study_access_v1(p_student_id uuid,p_assignment_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $function$
declare release_value jsonb; header_value jsonb; revision_value text; refs_value jsonb; question_count integer;
begin
  release_value := private.student_assignment_release_v1(p_student_id,p_assignment_id,statement_timestamp());
  if release_value->>'state' = 'unavailable' then return null; end if;
  select jsonb_build_object('assignmentId',a.id,'title',a.title,'mode',a.quiz_content_mode),
    concat_ws('|',a.id,a.updated_at,a.title,a.quiz_content_mode)
    into header_value,revision_value from public.assignments a where a.id=p_assignment_id;
  if release_value->>'state' not in ('open','unrestricted') and not exists (
    select 1 from public.quiz_attempts where student_id=p_student_id and assignment_id=p_assignment_id
  ) then return header_value || jsonb_build_object('release',release_value); end if;
  select count(*)::integer,coalesce(jsonb_agg(jsonb_build_array(
    q.id,q.xmin::text,q.vocab_entry_id,q.dataset_id,q.base_order_index,q.direction,q.content_version_id,
    s.assignment_question_id,s.xmin::text,s.content_version_id,s.release_id,s.occurrence_id
  ) order by q.base_order_index,q.id),'[]'::jsonb)
    into question_count,refs_value
    from public.assignment_questions q left join public.assignment_question_exam_use_snapshot s on s.assignment_question_id=q.id
    where q.assignment_id=p_assignment_id;
  if question_count=0 then return null; end if;
  -- xmin is an invalidation token, never an ordering or audit timestamp.
  return header_value || jsonb_build_object('revision',md5(revision_value || '|' || question_count || '|' || refs_value::text));
end $function$;
revoke all on function public.get_student_assignment_study_access_v1(uuid,uuid) from public,anon,authenticated;
grant execute on function public.get_student_assignment_study_access_v1(uuid,uuid) to service_role;

commit;
