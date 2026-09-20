create function private.vocabulary_library_source_states_v1(p_scope_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
  with headers as materialized (
    select s.id,s.dataset_id,s.unit_id,s.source_kind,s.source_release_id,
      case when d.id is null or d.status<>'ready' or not d.is_active
        or not coalesce(cat.is_assignable,s.source_kind='legacy_vocab') then 'retired'
      when (case s.source_kind when 'exam_use' then er.status='active' when 'reviewed_exam' then rr.status='active' else true end) is distinct from true then 'retired'
      when (case s.source_kind when 'exam_use' then lower(er.package_version) when 'reviewed_exam' then rr.content_sha256 else lower(d.source_sha256) end) is distinct from s.source_version then 'changed'
      else null end preliminary_state
    from private.vocabulary_library_scopes s left join public.vocab_datasets d on d.id=s.dataset_id
      left join public.vocab_dataset_catalog cat on cat.dataset_id=d.id
      left join word_index.app_exam_use_release er on s.source_kind='exam_use' and er.release_id=s.source_release_id and er.dataset_id=d.id
      left join private.reviewed_exam_releases rr on s.source_kind='reviewed_exam' and rr.release_id=s.source_release_id and rr.dataset_id=d.id
    where s.id=any(p_scope_ids)
  ), changed as materialized (
    select r.scope_id from headers h join private.vocabulary_library_scope_rows r on r.scope_id=h.id
      left join public.vocab_entries e on e.id=r.source_entry_id
      left join word_index.app_exam_use_occurrence o on h.source_kind='exam_use' and o.release_id=h.source_release_id and o.source_row=r.source_row
      left join private.reviewed_exam_entries re on h.source_kind='reviewed_exam' and re.release_id=h.source_release_id and re.source_row=r.source_row
    where case when h.preliminary_state is null then
      (r.state='included' and (to_jsonb(e) is distinct from r.entry_snapshot or e.dataset_id is distinct from h.dataset_id or e.unit_id is distinct from h.unit_id))
      or (h.source_kind='exam_use' and to_jsonb(o) is distinct from r.occurrence_snapshot)
      or (h.source_kind='reviewed_exam' and to_jsonb(re) is distinct from r.occurrence_snapshot)
    else false end group by r.scope_id
  ) select coalesce(jsonb_object_agg(h.id,coalesce(h.preliminary_state,case when c.scope_id is not null then 'changed' else 'available' end)),'{}'::jsonb)
    from headers h left join changed c on c.scope_id=h.id;
$$;
revoke all on function private.vocabulary_library_source_states_v1(uuid[]) from public,anon,authenticated,service_role;

create or replace function private.validate_vocabulary_library_recipe_sources_v1(r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.vocabulary_library_scopes; picked jsonb; ranges jsonb:='[]'; states jsonb;
begin
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>4 or not(r ?& array['filters','scopes','excludedOccurrenceKeys','scopeStatus'])
    or jsonb_typeof(r->'filters') is distinct from 'object' or octet_length((r->'filters')::text)>20000
    or jsonb_typeof(r->'scopes') is distinct from 'array' or jsonb_array_length(r->'scopes')>2000
    or jsonb_typeof(r->'excludedOccurrenceKeys') is distinct from 'array' or jsonb_array_length(r->'excludedOccurrenceKeys')>20000
    or coalesce(r->>'scopeStatus','') not in ('confirmed','unconfirmed') or
    (r->>'scopeStatus'='unconfirmed' and jsonb_array_length(r->'scopes')<>0) then raise exception 'invalid_library_recipe' using errcode='22023'; end if;
  perform private.validate_vocabulary_library_filters_v1(r->'filters');
  if (select count(distinct x->>'id') from jsonb_array_elements(r->'scopes') x)<>jsonb_array_length(r->'scopes') or
    (select count(distinct x) from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x)<>jsonb_array_length(r->'excludedOccurrenceKeys') or
    exists(select 1 from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x where x !~ '^[a-f0-9]{64}$' or x is null) then
    raise exception 'invalid_library_duplicates' using errcode='22023'; end if;
  perform 1 from public.vocab_datasets where id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by dataset_id for share;
  perform 1 from word_index.app_exam_use_release where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='exam_use' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from private.reviewed_exam_releases where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='reviewed_exam' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from public.vocab_entries where id in(select source_entry_id from private.vocabulary_library_scope_rows where scope_id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  states:=private.vocabulary_library_source_states_v1(array(select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x));
  for picked in select value from jsonb_array_elements(r->'scopes') loop
    if jsonb_typeof(picked)<>'object' or (select count(*) from jsonb_object_keys(picked))<>2 then raise exception 'invalid_library_pick' using errcode='22023'; end if;
    select * into s from private.vocabulary_library_scopes where id=(picked->>'id')::uuid;
    if not found then raise exception 'library_scope_missing' using errcode='40001'; end if;
    if s.version is distinct from picked->>'version' or states->>s.id::text is distinct from 'available' then
      raise exception 'library_scope_changed' using errcode='40001'; end if;
    ranges:=ranges||jsonb_build_array(jsonb_build_object('id',s.id,'version',s.version,'source',s.payload->'source','classification',s.payload->'classification','references',s.review_references));
  end loop;
  return ranges;
end;
$$;
