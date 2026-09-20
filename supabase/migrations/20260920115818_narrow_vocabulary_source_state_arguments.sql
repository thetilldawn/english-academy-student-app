create function private.vocabulary_library_source_state_values_v1(p_scope_id uuid,p_dataset_id uuid,p_unit_id uuid,p_source_kind text,p_release_id uuid,p_source_version text)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.vocab_datasets; actual_version text; active boolean;
begin
  select * into d from public.vocab_datasets where id=p_dataset_id;
  if not found or d.status<>'ready' or not d.is_active or not private.vocabulary_library_catalog_available_v1(d.id,p_source_kind)
    then return 'retired'; end if;
  if p_source_kind='exam_use' then
    select lower(package_version),status='active' into actual_version,active
      from word_index.app_exam_use_release where release_id=p_release_id and dataset_id=d.id;
  elsif p_source_kind='reviewed_exam' then
    select content_sha256,status='active' into actual_version,active
      from private.reviewed_exam_releases where release_id=p_release_id and dataset_id=d.id;
  else
    actual_version:=lower(d.source_sha256); active:=true;
  end if;
  if active is distinct from true then return 'retired'; end if;
  if actual_version is distinct from p_source_version then return 'changed'; end if;
  if exists(select 1 from private.vocabulary_library_scope_rows r
    left join public.vocab_entries e on e.id=r.source_entry_id
    left join word_index.app_exam_use_occurrence o on p_source_kind='exam_use'
      and o.release_id=p_release_id and o.source_row=r.source_row
    left join private.reviewed_exam_entries re on p_source_kind='reviewed_exam'
      and re.release_id=p_release_id and re.source_row=r.source_row
    where r.scope_id=p_scope_id and (
      (r.state='included' and (to_jsonb(e) is distinct from r.entry_snapshot or e.dataset_id is distinct from p_dataset_id
        or e.unit_id is distinct from p_unit_id)) or
      (p_source_kind='exam_use' and to_jsonb(o) is distinct from r.occurrence_snapshot) or
      (p_source_kind='reviewed_exam' and to_jsonb(re) is distinct from r.occurrence_snapshot))) then return 'changed'; end if;
  return 'available';
end;
$$;
create or replace function private.vocabulary_library_source_state_v1(p_scope private.vocabulary_library_scopes)
returns text language sql stable security definer set search_path='' as $$
  select private.vocabulary_library_source_state_values_v1(p_scope.id,p_scope.dataset_id,p_scope.unit_id,p_scope.source_kind,p_scope.source_release_id,p_scope.source_version);
$$;
revoke all on function private.vocabulary_library_source_state_values_v1(uuid,uuid,uuid,text,uuid,text) from public,anon,authenticated,service_role;
