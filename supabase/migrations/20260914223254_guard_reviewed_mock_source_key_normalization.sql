begin;

create or replace function private.import_app_exam_use_package_v1(p_package jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if trim(p_package->>'dataset_key') like 'g12-mock-%' then
    raise exception 'reviewed_mock_import_required';
  end if;
  return private.import_app_exam_use_package_core_v1(p_package);
end; $$;

revoke all on function private.import_app_exam_use_package_v1(jsonb) from public,anon,authenticated;
grant execute on function private.import_app_exam_use_package_v1(jsonb) to service_role;
notify pgrst,'reload schema';
commit;
