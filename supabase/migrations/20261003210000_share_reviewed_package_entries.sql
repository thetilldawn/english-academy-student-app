-- APP-20261003-05: reconstruct a reviewed package's entries from immutable occurrences.
-- This migration installs tools only; no existing package is compacted here.
begin;
create table private.exam_use_package_archives (
  release_id uuid primary key references private.reviewed_mock_source_releases_v1(release_id),
  target_project_ref text not null,
  source_rows integer[] not null check(cardinality(source_rows) between 4 and 2000),
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  identity_sha256 text not null check(identity_sha256 ~ '^[a-f0-9]{64}$'),
  package_sha256 text not null check(package_sha256 ~ '^[a-f0-9]{64}$'),
  header_sha256 text not null check(header_sha256 ~ '^[a-f0-9]{64}$'),
  reference_sha256 text not null check(reference_sha256 ~ '^[a-f0-9]{64}$'),
  original_lifecycle jsonb not null check(jsonb_typeof(original_lifecycle)='object'
    and original_lifecycle ?& array['status','retired_at_utc']
    and original_lifecycle-array['status','retired_at_utc']='{}'::jsonb),
  original_bytes integer not null check(original_bytes between 1 and 16777216),
  state text not null check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp()
);
create table private.exam_use_package_archive_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  release_id uuid not null references private.exam_use_package_archives(release_id),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.exam_use_package_write_permits (
  backend_pid integer not null, transaction_id bigint not null, release_id uuid not null,
  before_sha256 text not null, after_sha256 text not null,
  primary key(backend_pid,transaction_id,release_id)
);
alter table private.exam_use_package_archives enable row level security;
alter table private.exam_use_package_archive_receipts enable row level security;
alter table private.exam_use_package_write_permits enable row level security;
revoke all on private.exam_use_package_archives,private.exam_use_package_archive_receipts,private.exam_use_package_write_permits
  from public,anon,authenticated,service_role;
create trigger exam_use_package_receipt_immutable before update or delete on private.exam_use_package_archive_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.exam_use_package_reference_v1(p_release_id uuid,p_package jsonb,p_source_rows integer[]) returns jsonb
language sql immutable strict set search_path='' as $$
  select (p_package-'entries')||jsonb_build_object('__exam_use_entries_ref_v1',jsonb_build_object(
    'releaseId',p_release_id,'packageHash',private.reviewed_bundle_row_sha256_v1(p_package),
    'headerHash',private.reviewed_bundle_row_sha256_v1(p_package-'entries'),
    'sourceRowsHash',private.reviewed_bundle_row_sha256_v1(to_jsonb(p_source_rows))));
$$;

create function private.reassemble_exam_use_entries_v1(p_release_id uuid,p_header jsonb,p_source_rows integer[]) returns jsonb
language plpgsql stable set search_path='' as $$
declare entries jsonb; found_count integer;
begin
  if p_release_id is null or jsonb_typeof(p_header) is distinct from 'object'
    or p_header ?| array['entries','__exam_use_entries_ref_v1']
    or p_source_rows is null or cardinality(p_source_rows) not between 4 and 2000
    or (select count(distinct k) from unnest(p_source_rows) k)<>cardinality(p_source_rows) then
    raise exception 'exam_package_reference_invalid' using errcode='40001'; end if;
  select jsonb_agg(o.package_entry_json order by k.ordinal),count(o.source_row)
    into entries,found_count from unnest(p_source_rows) with ordinality k(source_row,ordinal)
    left join word_index.app_exam_use_occurrence o on o.release_id=p_release_id and o.source_row=k.source_row;
  if found_count<>cardinality(p_source_rows)
    or (select count(*) from word_index.app_exam_use_occurrence where release_id=p_release_id)<>found_count then
    raise exception 'exam_package_occurrences_changed' using errcode='40001'; end if;
  return p_header||jsonb_build_object('entries',entries);
end $$;

create function private.resolve_exam_use_package_json_v1(p_release_id uuid) returns jsonb
language plpgsql stable set search_path='' as $$
declare stored jsonb; rebuilt jsonb; m private.exam_use_package_archives;
begin
  select package_json into stored from word_index.app_exam_use_release where release_id=p_release_id;
  if not found then raise exception 'exam_package_missing' using errcode='P0002'; end if;
  select * into m from private.exam_use_package_archives where release_id=p_release_id;
  if not(stored ? '__exam_use_entries_ref_v1') then
    if m.state='compacted' then raise exception 'exam_package_reference_changed' using errcode='40001'; end if;
    return stored;
  end if;
  if m.release_id is null or m.state<>'compacted' or stored ? 'entries'
    or private.reviewed_bundle_row_sha256_v1(stored) is distinct from m.reference_sha256
    or private.reviewed_bundle_row_sha256_v1(stored-'__exam_use_entries_ref_v1') is distinct from m.header_sha256
    or stored->'__exam_use_entries_ref_v1' is distinct from jsonb_build_object(
      'releaseId',p_release_id,'packageHash',m.package_sha256,'headerHash',m.header_sha256,
      'sourceRowsHash',private.reviewed_bundle_row_sha256_v1(to_jsonb(m.source_rows))) then
    raise exception 'exam_package_reference_changed' using errcode='40001'; end if;
  rebuilt:=private.reassemble_exam_use_entries_v1(p_release_id,stored-'__exam_use_entries_ref_v1',m.source_rows);
  if private.reviewed_bundle_row_sha256_v1(rebuilt) is distinct from m.package_sha256 then
    raise exception 'exam_package_content_changed' using errcode='40001'; end if;
  return rebuilt;
end $$;

-- Preserve the current definitions (including M02 restoration), OIDs and ACLs.
do $consumers$
declare definition text; needle text; replacement text;
begin
  definition:=pg_get_functiondef('private.import_app_exam_use_package_core_v1(jsonb)'::regprocedure);
  needle:='existing_release.package_json <> p_package';
  replacement:='private.resolve_exam_use_package_json_v1(existing_release.release_id) <> p_package';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'exam_package_import_consumer_drift'; end if;
  execute replace(definition,needle,replacement);
  definition:=pg_get_functiondef('private.current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[])'::regprocedure);
  needle:='select to_jsonb(r) from word_index.app_exam_use_release r where r.release_id=active_release';
  replacement:='select jsonb_set(to_jsonb(r),''{package_json}'',private.resolve_exam_use_package_json_v1(r.release_id)) from word_index.app_exam_use_release r where r.release_id=active_release';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
    raise exception 'exam_package_fingerprint_consumer_drift'; end if;
  execute replace(definition,needle,replacement);
end $consumers$;

create function private.lock_exam_use_package_v1(p_release_id uuid,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare v_dataset_id uuid; v_dataset_key text; v_project_ref text; doc jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_release_id is null or p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'exam_package_identity_invalid' using errcode='22023'; end if;
  select r.dataset_id,a.dataset_key,r.target_project_ref into v_dataset_id,v_dataset_key,v_project_ref
    from private.reviewed_mock_source_releases_v1 r join private.reviewed_mock_source_approvals_v1 a
      on a.approval_id=r.approval_id and a.target_project_ref=r.target_project_ref where r.release_id=p_release_id;
  if not found then raise exception 'exam_package_reviewed_source_required' using errcode='P0002'; end if;
  if v_project_ref<>p_target_project_ref then raise exception 'exam_package_project_mismatch' using errcode='22023'; end if;
  if v_dataset_key='g12-long-reading-2025-exam-scope-v1' then raise exception 'exam_package_catalog_source_excluded' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(v_dataset_key,9129)) then
    raise exception 'exam_package_busy' using errcode='55P03'; end if;
  -- Same parent order as wrong-review fingerprint/save, with immediate failure.
  perform id from public.vocab_datasets where id=v_dataset_id for update nowait;
  select to_jsonb(r) into doc from word_index.app_exam_use_release r
    where r.release_id=p_release_id and r.dataset_id=v_dataset_id for update nowait;
  if not found then raise exception 'exam_package_missing' using errcode='P0002'; end if;
  perform source_row from word_index.app_exam_use_occurrence where release_id=p_release_id order by source_row for share nowait;
  return doc;
end $$;

create function private.list_exam_use_package_candidates_v1(p_target_project_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'exam_package_identity_invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('releaseId',r.release_id,'packageVersion',r.package_version) order by r.release_id),'[]')
    into result from word_index.app_exam_use_release r join private.reviewed_mock_source_releases_v1 s on s.release_id=r.release_id
    left join private.exam_use_package_archives m on m.release_id=r.release_id
    where s.target_project_ref=p_target_project_ref and r.dataset_key<>'g12-long-reading-2025-exam-scope-v1'
      and (m.release_id is null or m.state<>'compacted') and jsonb_typeof(r.package_json->'entries')='array';
  return result;
end $$;

create function private.prepare_exam_use_package_archive_v1(p_release_id uuid,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare doc jsonb; p jsonb; ordered_rows integer[]; rebuilt jsonb; reference jsonb; original_text text; approved_version text;
  m private.exam_use_package_archives;
begin
  doc:=private.lock_exam_use_package_v1(p_release_id,p_target_project_ref);
  select * into m from private.exam_use_package_archives where release_id=p_release_id for update nowait;
  if found then
    if m.state='compacted' then raise exception 'exam_package_archive_file_required' using errcode='22023'; end if;
    if m.target_project_ref<>p_target_project_ref
      or private.reviewed_bundle_row_sha256_v1(doc-array['package_json','status','retired_at_utc']) is distinct from m.identity_sha256
      or private.reviewed_bundle_row_sha256_v1(doc->'package_json') is distinct from m.package_sha256 then
      raise exception 'exam_package_row_changed' using errcode='40001'; end if;
    -- A committed prepare whose reply/file write was lost can be retried.
    -- Recreate its exact original row without reverting live retirement state.
    doc:=doc||m.original_lifecycle;
    if private.reviewed_bundle_row_sha256_v1(doc) is distinct from m.original_sha256 then
      raise exception 'exam_package_archive_changed' using errcode='40001'; end if;
    return jsonb_build_object('id',p_release_id,'projectRef',p_target_project_ref,'beforeText',doc::text);
  end if;
  p:=doc->'package_json';
  if p ? '__exam_use_entries_ref_v1' or p->>'package_type' is distinct from 'student-app-exam-use-wordbook'
    or p->>'schema_version' is distinct from '1.0' or jsonb_typeof(p->'entries') is distinct from 'array'
    or jsonb_array_length(p->'entries') not between 4 and 2000 then
    raise exception 'exam_package_source_invalid' using errcode='22023'; end if;
  original_text:=doc::text;
  if octet_length(original_text)>16777216 then raise exception 'exam_package_row_too_large' using errcode='22023'; end if;
  select a.package_version into approved_version from private.reviewed_mock_source_releases_v1 r
    join private.reviewed_mock_source_approvals_v1 a on a.approval_id=r.approval_id and a.target_project_ref=r.target_project_ref
    where r.release_id=p_release_id;
  if p->>'package_version' is distinct from approved_version or doc->>'package_version' is distinct from approved_version
    or private.reviewed_exam_sha256_v1(p-'package_version') is distinct from approved_version then
    raise exception 'exam_package_approval_changed' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements(p->'entries') e
      where jsonb_typeof(e->'source_row') is distinct from 'number' or e->>'source_row' !~ '^[1-9][0-9]{0,8}$') then
    raise exception 'exam_package_source_rows_invalid' using errcode='22023'; end if;
  select array_agg((e.value->>'source_row')::integer order by e.ordinal)
    into ordered_rows from jsonb_array_elements(p->'entries') with ordinality e(value,ordinal);
  rebuilt:=private.reassemble_exam_use_entries_v1(p_release_id,p-'entries',ordered_rows);
  if rebuilt is distinct from p then raise exception 'exam_package_occurrences_changed' using errcode='40001'; end if;
  reference:=private.exam_use_package_reference_v1(p_release_id,p,ordered_rows);
  insert into private.exam_use_package_archives(release_id,target_project_ref,source_rows,original_sha256,identity_sha256,
    package_sha256,header_sha256,reference_sha256,original_lifecycle,original_bytes,state)
    values(p_release_id,p_target_project_ref,ordered_rows,private.reviewed_bundle_row_sha256_v1(doc),
      private.reviewed_bundle_row_sha256_v1(doc-array['package_json','status','retired_at_utc']),
      private.reviewed_bundle_row_sha256_v1(p),private.reviewed_bundle_row_sha256_v1(p-'entries'),
      private.reviewed_bundle_row_sha256_v1(reference),jsonb_build_object('status',doc->'status','retired_at_utc',doc->'retired_at_utc'),
      octet_length(original_text),'prepared');
  return jsonb_build_object('id',p_release_id,'projectRef',p_target_project_ref,'beforeText',original_text);
end $$;

create function private.guard_exam_use_package_write_v1() returns trigger
language plpgsql security definer set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
begin
  -- Preserve the former release-specific branch of the common source guard.
  if tg_op='UPDATE' then
    if to_jsonb(new)-array['status','retired_at_utc']=to_jsonb(old)-array['status','retired_at_utc'] then return new; end if;
    if to_jsonb(new)-'package_json'=to_jsonb(old)-'package_json' then
      delete from private.exam_use_package_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()
        and release_id=old.release_id and before_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(old))
        and after_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(new));
      if found then return new; end if;
    end if;
  end if;
  if exists(select 1 from private.reviewed_mock_source_releases_v1 where release_id=old.release_id) then
    raise exception 'reviewed_mock_source_immutable' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
drop trigger reviewed_mock_source_release_immutable on word_index.app_exam_use_release;
create trigger reviewed_mock_source_release_immutable before update or delete on word_index.app_exam_use_release
  for each row execute function private.guard_exam_use_package_write_v1();

create function private.apply_exam_use_package_archive_v1(p_request_id uuid,p_action text,p_target_project_ref text,p_archive_sha256 text,p_packet jsonb)
returns jsonb language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare request_hash text; receipt private.exam_use_package_archive_receipts; m private.exam_use_package_archives;
  v_release_id uuid; before_doc jsonb; current_doc jsonb; next_doc jsonb; reference jsonb; rebuilt jsonb; result jsonb; changed integer:=0;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_request_id is null or p_action is null or p_action not in ('compact','restore')
    or p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$'
    or p_archive_sha256 is null or p_archive_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_packet) is distinct from 'object' or not(p_packet ?& array['id','projectRef','beforeText'])
    or p_packet-array['id','projectRef','beforeText']<>'{}'::jsonb
    or jsonb_typeof(p_packet->'beforeText') is distinct from 'string'
    or octet_length(p_packet->>'beforeText')>16777216 then
    raise exception 'exam_package_packet_invalid' using errcode='22023'; end if;
  v_release_id:=(p_packet->>'id')::uuid;
  if v_release_id is null or p_packet->>'projectRef' is distinct from p_target_project_ref then
    raise exception 'exam_package_project_mismatch' using errcode='22023'; end if;
  request_hash:=private.reviewed_bundle_row_sha256_v1(jsonb_build_array(p_action,p_target_project_ref,p_archive_sha256,p_packet));
  select * into receipt from private.exam_use_package_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'exam_package_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('exam-package-request:'||p_request_id,64005)) then
    raise exception 'exam_package_busy' using errcode='55P03'; end if;
  current_doc:=private.lock_exam_use_package_v1(v_release_id,p_target_project_ref);
  select * into receipt from private.exam_use_package_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'exam_package_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  select * into m from private.exam_use_package_archives where release_id=v_release_id for update nowait;
  if not found then raise exception 'exam_package_preparation_missing' using errcode='P0002'; end if;
  before_doc:=(p_packet->>'beforeText')::jsonb;
  if m.target_project_ref<>p_target_project_ref or before_doc->>'release_id' is distinct from v_release_id::text
    or private.reviewed_bundle_row_sha256_v1(before_doc) is distinct from m.original_sha256
    or private.reviewed_bundle_row_sha256_v1(before_doc->'package_json') is distinct from m.package_sha256 then
    raise exception 'exam_package_archive_changed' using errcode='40001'; end if;
  reference:=private.exam_use_package_reference_v1(v_release_id,before_doc->'package_json',m.source_rows);
  if private.reviewed_bundle_row_sha256_v1(reference) is distinct from m.reference_sha256
    or private.reviewed_bundle_row_sha256_v1((before_doc->'package_json')-'entries') is distinct from m.header_sha256 then
    raise exception 'exam_package_reference_changed' using errcode='40001'; end if;
  if private.reviewed_bundle_row_sha256_v1(current_doc-array['package_json','status','retired_at_utc']) is distinct from m.identity_sha256
    or private.reviewed_bundle_row_sha256_v1(current_doc->'package_json') is distinct from
      (case when m.state='compacted' then m.reference_sha256 else m.package_sha256 end) then
    raise exception 'exam_package_row_changed' using errcode='40001'; end if;
  if p_action='compact' then
    rebuilt:=private.reassemble_exam_use_entries_v1(v_release_id,(before_doc->'package_json')-'entries',m.source_rows);
    if private.reviewed_bundle_row_sha256_v1(rebuilt) is distinct from m.package_sha256 then
      raise exception 'exam_package_occurrences_changed' using errcode='40001'; end if;
    next_doc:=jsonb_set(current_doc,'{package_json}',reference);
  else
    -- Restore the saved body only; preserve current retirement/status values.
    next_doc:=jsonb_set(current_doc,'{package_json}',before_doc->'package_json');
  end if;
  if current_doc is distinct from next_doc then
    insert into private.exam_use_package_write_permits values(pg_backend_pid(),txid_current(),v_release_id,
      private.reviewed_bundle_row_sha256_v1(current_doc),private.reviewed_bundle_row_sha256_v1(next_doc));
    update word_index.app_exam_use_release set package_json=next_doc->'package_json' where release_id=v_release_id;
    if exists(select 1 from private.exam_use_package_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()) then
      raise exception 'exam_package_permit_not_consumed' using errcode='55000'; end if;
    changed:=1;
  end if;
  update private.exam_use_package_archives set state=case when p_action='compact' then 'compacted' else 'restored' end where release_id=v_release_id;
  if (select private.reviewed_bundle_row_sha256_v1(to_jsonb(r)) from word_index.app_exam_use_release r where release_id=v_release_id)
      is distinct from private.reviewed_bundle_row_sha256_v1(next_doc)
    or private.resolve_exam_use_package_json_v1(v_release_id) is distinct from before_doc->'package_json' then
    raise exception 'exam_package_write_mismatch' using errcode='40001'; end if;
  result:=jsonb_build_object('requestId',p_request_id,'releaseId',v_release_id,'action',p_action,'changed',changed,'archiveHash',p_archive_sha256);
  insert into private.exam_use_package_archive_receipts(request_id,request_sha256,archive_sha256,release_id,result)
    values(p_request_id,request_hash,p_archive_sha256,v_release_id,result);
  return result;
end $$;

do $acl$
declare f record;
begin
  for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('exam_use_package_reference_v1','reassemble_exam_use_entries_v1',
      'resolve_exam_use_package_json_v1','lock_exam_use_package_v1','list_exam_use_package_candidates_v1',
      'prepare_exam_use_package_archive_v1','guard_exam_use_package_write_v1','apply_exam_use_package_archive_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  end loop;
end $acl$;
commit;
