-- Transport fragments contain exact text, never separately approved JSON bundles.
create table private.vocabulary_library_import_chunks (
  project_ref text not null,
  file_sha256 text not null,
  chunk_index integer not null check(chunk_index between 1 and 200),
  chunk_count integer not null check(chunk_count between 1 and 200 and chunk_index<=chunk_count),
  payload text not null check(octet_length(payload) between 1 and 500000),
  primary key(project_ref,file_sha256,chunk_index),
  foreign key(project_ref,file_sha256) references private.vocabulary_library_import_approvals(target_project_ref,file_sha256)
);
alter table private.vocabulary_library_import_chunks enable row level security;
revoke all on private.vocabulary_library_import_chunks from public,anon,authenticated,service_role;

create function private.stage_vocabulary_library_import_chunk_v1(p_project_ref text,p_file_sha256 text,p_index integer,p_count integer,p_text text)
returns void language plpgsql security invoker set search_path='' as $$
declare existing private.vocabulary_library_import_chunks;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-transfer:'||p_project_ref||':'||p_file_sha256,0));
  insert into private.vocabulary_library_import_chunks(project_ref,file_sha256,chunk_index,chunk_count,payload)
    values(p_project_ref,p_file_sha256,p_index,p_count,p_text) on conflict do nothing;
  select * into existing from private.vocabulary_library_import_chunks where project_ref=p_project_ref and file_sha256=p_file_sha256 and chunk_index=p_index;
  if existing.chunk_count is distinct from p_count or existing.payload is distinct from p_text then
    raise exception 'library_transfer_chunk_changed' using errcode='40001'; end if;
end;
$$;
create function private.finish_vocabulary_library_import_chunks_v1(p_project_ref text,p_file_sha256 text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare raw_text text; actual_count integer; expected_min integer; expected_max integer; result jsonb;
begin
  if current_user<>'postgres' or session_user<>'postgres' then raise exception 'database_management_required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-transfer:'||p_project_ref||':'||p_file_sha256,0));
  select string_agg(payload,'' order by chunk_index),count(*)::integer,min(chunk_count),max(chunk_count)
    into raw_text,actual_count,expected_min,expected_max from private.vocabulary_library_import_chunks where project_ref=p_project_ref and file_sha256=p_file_sha256;
  if actual_count=0 or actual_count<>expected_min or expected_min<>expected_max then
    raise exception 'library_transfer_incomplete' using errcode='22023'; end if;
  if encode(extensions.digest(convert_to(raw_text,'UTF8'),'sha256'),'hex') is distinct from p_file_sha256 then
    raise exception 'library_transfer_hash_mismatch' using errcode='40001'; end if;
  result:=private.import_vocabulary_library_management_v1(raw_text,p_project_ref);
  delete from private.vocabulary_library_import_chunks where project_ref=p_project_ref and file_sha256=p_file_sha256;
  return result;
end;
$$;
revoke all on function private.stage_vocabulary_library_import_chunk_v1(text,text,integer,integer,text),private.finish_vocabulary_library_import_chunks_v1(text,text)
  from public,anon,authenticated,service_role;
