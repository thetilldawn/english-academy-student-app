-- APP-20261004-02: preinstall before compact content to keep the legacy app readable.
-- No new table access: the future canonical reader still checks ownership and scope.
begin;
create function public.read_m10_transition_question_contents_v1(
  p_context text, p_actor_id uuid, p_context_id uuid, p_question_ids uuid[]
)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
  if p_context is null or p_context not in ('student_preparation','student_assignment') then
    raise exception 'transition_content_context_invalid' using errcode='22023';
  end if;
  execute 'select public.read_question_contents_v1($1,$2,$3,$4)'
    into result using p_context,p_actor_id,p_context_id,p_question_ids;
  return result;
end;
$$;
revoke all on function public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])
  from public,anon,authenticated,service_role;
grant execute on function public.read_m10_transition_question_contents_v1(text,uuid,uuid,uuid[])
  to service_role;
notify pgrst,'reload schema';
commit;
