-- Validate only new version inserts; preserve reads and completed-request retries.
create function private.guard_new_vocabulary_library_version_v1()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.recipe->>'scopeStatus'='confirmed' and
    (jsonb_array_length(new.recipe->'scopes')=0 or coalesce(jsonb_array_length(new.fixed_composition->'includedKeys'),0)=0) then
    raise exception 'library_confirmed_range_empty' using errcode='22023';
  end if;
  return new;
end;
$$;
revoke all on function private.guard_new_vocabulary_library_version_v1() from public,anon,authenticated,service_role;
create trigger guard_new_vocabulary_library_version_v1 before insert on private.vocabulary_library_versions
for each row execute function private.guard_new_vocabulary_library_version_v1();

create or replace function public.save_vocabulary_library_template_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<library_save>>
declare action text; request_id uuid; request_hash text; cached private.vocabulary_library_requests;
  t private.vocabulary_library_templates; previous private.vocabulary_library_versions; tid uuid; recipe jsonb; fixed jsonb; result jsonb; next_number integer:=1;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000 then raise exception 'invalid_library_request' using errcode='22023'; end if;
  action:=p_request->>'action'; request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or coalesce(action,'') not in ('create','metadata','version','copy') then raise exception 'invalid_library_action' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_request))<>(case action when 'create' then 4 when 'metadata' then 5 when 'version' then case when p_request ? 'metadata' then 7 else 6 end else 4 end) or
    not(p_request ?& (case action when 'create' then array['action','requestId','metadata','recipe'] when 'metadata' then array['action','requestId','templateId','expectedRevision','metadata']
      when 'version' then array['action','requestId','templateId','expectedRevision','expectedContentHash','recipe'] else array['action','requestId','sourceVersionId','metadata'] end)) then
    raise exception 'invalid_library_request_fields' using errcode='22023'; end if;
  request_hash:=private.reviewed_exam_sha256_v1(p_request);
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_id::text,0));
  select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and vocabulary_library_requests.request_id=library_save.request_id;
  if found then
    if cached.request_hash<>request_hash then raise exception 'library_request_reused' using errcode='40001'; end if;
    return cached.result;
  end if;
  if action in ('create','copy') then
    perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-template-capacity',0));
    if (select count(*) from private.vocabulary_library_templates)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  end if;
  if action in ('metadata','version') then
    select * into t from private.vocabulary_library_templates where id=(p_request->>'templateId')::uuid for update;
    if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
    if t.revision is distinct from (p_request->>'expectedRevision')::integer then raise exception 'library_template_changed' using errcode='40001'; end if;
    tid:=t.id;
  end if;
  if action in ('metadata','create','copy') or (action='version' and p_request ? 'metadata') then perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata'); end if;
  if action='metadata' then
    update private.vocabulary_library_templates set metadata=p_request->'metadata',revision=revision+1,updated_at=now() where id=tid;
  else
    if action='copy' then
      select * into previous from private.vocabulary_library_versions where id=(p_request->>'sourceVersionId')::uuid;
      if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      fixed:=previous.fixed_composition; recipe:=previous.recipe;
    else
      recipe:=p_request->'recipe'; fixed:=private.resolve_vocabulary_library_recipe_compact_v1(recipe);
    end if;
    if action in ('create','copy') then
      insert into private.vocabulary_library_templates(metadata,created_by) values(p_request->'metadata',auth.uid()) returning id into tid;
    else
      select * into previous from private.vocabulary_library_versions where template_id=tid order by number desc limit 1;
      if previous.content_sha256 is distinct from p_request->>'expectedContentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
      next_number:=previous.number+1;
      if next_number>1000 then raise exception 'library_version_limit' using errcode='22023'; end if;
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now(),
        metadata=case when p_request ? 'metadata' then p_request->'metadata' else metadata end where id=tid;
    end if;
    insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,source_version_id,created_by)
      values(tid,next_number,case when action='copy' then previous.content_sha256 else private.reviewed_exam_sha256_v1(fixed) end,recipe,fixed,previous.id,auth.uid());
  end if;
  perform private.sync_vocabulary_template_metadata_v1(tid);
  result:=jsonb_build_object('template',private.vocabulary_library_template_json_v1(tid));
  insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
  return result;
end;
$$;
alter function public.save_vocabulary_library_template_v1(jsonb) set statement_timeout='55s';
