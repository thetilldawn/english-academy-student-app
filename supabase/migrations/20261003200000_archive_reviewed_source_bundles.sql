-- APP-20261003-04. One explicitly archived bundle; never automatic cleanup.
begin;
create table private.reviewed_bundle_archives (
  release_id uuid primary key references private.reviewed_mock_source_releases_v1(release_id),
  target_project_ref text not null,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  compacted_sha256 text not null check(compacted_sha256 ~ '^[a-f0-9]{64}$'),
  bundle_sha256 text not null check(bundle_sha256 ~ '^[a-f0-9]{64}$'),
  original_bytes integer not null check(original_bytes between 1 and 16777216),
  state text not null check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp()
);
create table private.reviewed_bundle_archive_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  release_id uuid not null references private.reviewed_bundle_archives(release_id),
  result jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table private.reviewed_bundle_write_permits (
  backend_pid integer not null,
  transaction_id bigint not null,
  release_id uuid not null,
  before_sha256 text not null,
  after_sha256 text not null,
  primary key(backend_pid,transaction_id,release_id)
);
alter table private.reviewed_bundle_archives enable row level security;
alter table private.reviewed_bundle_archive_receipts enable row level security;
alter table private.reviewed_bundle_write_permits enable row level security;
revoke all on private.reviewed_bundle_archives,private.reviewed_bundle_archive_receipts,private.reviewed_bundle_write_permits
  from public,anon,authenticated,service_role;
create trigger reviewed_bundle_receipt_immutable before update or delete on private.reviewed_bundle_archive_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

-- This is the PostgreSQL JSONB representation hash, NOT the approved import
-- file byte hash or its recursive canonical content hash. Callers serialize
-- the complete row under UTC/ISO before hashing or writing beforeText.
create function private.reviewed_bundle_row_sha256_v1(p_value jsonb) returns text
language sql immutable strict set search_path='' as $$
  select encode(extensions.digest(convert_to(p_value::text,'UTF8'),'sha256'),'hex');
$$;
create function private.reviewed_bundle_compacted_row_v1(p_row jsonb) returns jsonb
language sql immutable strict set search_path='' as $$
  select jsonb_set(p_row,'{bundle}',jsonb_build_object(
    'schemaVersion','reviewed-bundle-archive-v1','hashFormat','postgres-jsonb-text-sha256-v1',
    'releaseId',p_row->'release_id','contentHash',p_row->'content_sha256',
    'originalRowHash',private.reviewed_bundle_row_sha256_v1(p_row),
    'bundleHash',private.reviewed_bundle_row_sha256_v1(p_row->'bundle')));
$$;

create function private.check_reviewed_bundle_operator_v1() returns void
language plpgsql set search_path='' as $$
begin
  if current_user<>'postgres' then raise exception 'reviewed_bundle_operator_required' using errcode='42501'; end if;
  if current_setting('transaction_isolation')<>'read committed'
    or (select setting::integer from pg_settings where name='statement_timeout') not between 1 and 30000
    or (select setting::integer from pg_settings where name='lock_timeout') not between 1 and 1000 then
    raise exception 'reviewed_bundle_transaction_limits_required' using errcode='22023'; end if;
end $$;

create function private.lock_reviewed_bundle_v1(p_release_id uuid,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare dataset_key text; project_ref text; doc jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_release_id is null or p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'reviewed_bundle_identity_invalid' using errcode='22023'; end if;
  select a.dataset_key,r.target_project_ref into dataset_key,project_ref
    from private.reviewed_mock_source_releases_v1 r join private.reviewed_mock_source_approvals_v1 a
      on a.approval_id=r.approval_id and a.target_project_ref=r.target_project_ref where r.release_id=p_release_id;
  if not found then raise exception 'reviewed_bundle_missing' using errcode='P0002'; end if;
  if project_ref<>p_target_project_ref then raise exception 'reviewed_bundle_project_mismatch' using errcode='22023'; end if;
  if not pg_try_advisory_xact_lock(hashtextextended(dataset_key,9129)) then
    raise exception 'reviewed_bundle_busy' using errcode='55P03'; end if;
  select to_jsonb(r) into doc from private.reviewed_mock_source_releases_v1 r where r.release_id=p_release_id for update nowait;
  if doc is null then raise exception 'reviewed_bundle_missing' using errcode='P0002'; end if;
  return doc;
end $$;

create function private.list_reviewed_bundle_candidates_v1(p_target_project_ref text) returns jsonb
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare result jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'reviewed_bundle_identity_invalid' using errcode='22023'; end if;
  -- No maximum-ID cursor. A newly committed smaller key remains discoverable.
  select coalesce(jsonb_agg(jsonb_build_object('releaseId',r.release_id,'contentHash',r.content_sha256)
    order by r.release_id),'[]') into result from private.reviewed_mock_source_releases_v1 r
    left join private.reviewed_bundle_archives a on a.release_id=r.release_id
    where r.target_project_ref=p_target_project_ref and (a.release_id is null or a.state<>'compacted');
  return result;
end $$;

create function private.prepare_reviewed_bundle_archive_v1(p_release_id uuid,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare doc jsonb; next_doc jsonb; original_hash text; m private.reviewed_bundle_archives; body_text text; approved_hash text;
begin
  doc:=private.lock_reviewed_bundle_v1(p_release_id,p_target_project_ref);
  if doc#>>'{bundle,schemaVersion}'='reviewed-bundle-archive-v1' then
    raise exception 'reviewed_bundle_archive_file_required' using errcode='22023'; end if;
  if doc#>>'{bundle,schema_version}' is distinct from 'reviewed_mock_wordbook_v1' then
    raise exception 'reviewed_bundle_source_invalid' using errcode='22023'; end if;
  body_text:=doc::text;
  if octet_length(body_text)>16777216 then raise exception 'reviewed_bundle_row_too_large' using errcode='22023'; end if;
  select a.content_sha256 into approved_hash from private.reviewed_mock_source_approvals_v1 a
    where a.approval_id=doc->>'approval_id' and a.target_project_ref=p_target_project_ref;
  if doc#>>'{bundle,content_sha256}' is distinct from approved_hash or doc->>'content_sha256' is distinct from approved_hash
    or private.reviewed_exam_sha256_v1((doc->'bundle')-'content_sha256') is distinct from approved_hash then
    raise exception 'reviewed_bundle_content_changed' using errcode='40001'; end if;
  original_hash:=private.reviewed_bundle_row_sha256_v1(doc);
  next_doc:=private.reviewed_bundle_compacted_row_v1(doc);
  select * into m from private.reviewed_bundle_archives where release_id=p_release_id for update nowait;
  if found then
    if m.original_sha256<>original_hash or m.compacted_sha256<>private.reviewed_bundle_row_sha256_v1(next_doc)
      or m.target_project_ref<>p_target_project_ref or m.state='compacted' then
      raise exception 'reviewed_bundle_row_changed' using errcode='40001'; end if;
  else
    insert into private.reviewed_bundle_archives(release_id,target_project_ref,original_sha256,compacted_sha256,bundle_sha256,original_bytes,state)
      values(p_release_id,p_target_project_ref,original_hash,private.reviewed_bundle_row_sha256_v1(next_doc),
        private.reviewed_bundle_row_sha256_v1(doc->'bundle'),octet_length(body_text),'prepared');
  end if;
  return jsonb_build_object('id',p_release_id,'beforeText',body_text);
end $$;

create function private.guard_reviewed_bundle_write_v1() returns trigger
language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
begin
  if tg_op='UPDATE' and to_jsonb(new)-'bundle'=to_jsonb(old)-'bundle' then
    delete from private.reviewed_bundle_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and release_id=old.release_id and before_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(old))
      and after_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(new));
    if found then return new; end if;
  end if;
  raise exception 'reviewed_mock_source_immutable' using errcode='22023';
end $$;
drop trigger reviewed_mock_release_immutable on private.reviewed_mock_source_releases_v1;
create trigger reviewed_mock_release_immutable before update or delete on private.reviewed_mock_source_releases_v1
  for each row execute function private.guard_reviewed_bundle_write_v1();

create function private.apply_reviewed_bundle_archive_v1(p_request_id uuid,p_action text,p_target_project_ref text,p_archive_sha256 text,p_packet jsonb)
returns jsonb language plpgsql set search_path='' set TimeZone='UTC' set DateStyle='ISO, MDY' as $$
declare request_hash text; receipt private.reviewed_bundle_archive_receipts; m private.reviewed_bundle_archives;
  before_doc jsonb; current_doc jsonb; next_doc jsonb; v_release_id uuid; current_hash text; result jsonb; changed integer:=0;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_request_id is null or p_action is null or p_action not in ('compact','restore')
    or p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$'
    or p_archive_sha256 is null or p_archive_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_packet) is distinct from 'object' or not(p_packet ?& array['id','beforeText'])
    or p_packet-array['id','beforeText']<>'{}'::jsonb or jsonb_typeof(p_packet->'beforeText') is distinct from 'string'
    or octet_length(p_packet->>'beforeText')>16777216 then
    raise exception 'reviewed_bundle_packet_invalid' using errcode='22023'; end if;
  v_release_id:=(p_packet->>'id')::uuid;
  if v_release_id is null then raise exception 'reviewed_bundle_identity_invalid' using errcode='22023'; end if;
  request_hash:=private.reviewed_bundle_row_sha256_v1(jsonb_build_array(p_action,p_target_project_ref,p_archive_sha256,p_packet));
  select * into receipt from private.reviewed_bundle_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'reviewed_bundle_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('reviewed-bundle-request:'||p_request_id,64004)) then
    raise exception 'reviewed_bundle_busy' using errcode='55P03'; end if;
  current_doc:=private.lock_reviewed_bundle_v1(v_release_id,p_target_project_ref);
  select * into receipt from private.reviewed_bundle_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'reviewed_bundle_request_reused' using errcode='40001'; end if;
    return receipt.result;
  end if;
  select * into m from private.reviewed_bundle_archives a where a.release_id=v_release_id for update nowait;
  if not found then raise exception 'reviewed_bundle_preparation_missing' using errcode='P0002'; end if;
  before_doc:=(p_packet->>'beforeText')::jsonb;
  if private.reviewed_bundle_row_sha256_v1(before_doc) is distinct from m.original_sha256
    or before_doc->>'release_id' is distinct from v_release_id::text
    or before_doc->>'target_project_ref' is distinct from p_target_project_ref
    or private.reviewed_bundle_row_sha256_v1(before_doc->'bundle') is distinct from m.bundle_sha256 then
    raise exception 'reviewed_bundle_archive_changed' using errcode='40001'; end if;
  next_doc:=private.reviewed_bundle_compacted_row_v1(before_doc);
  if private.reviewed_bundle_row_sha256_v1(next_doc) is distinct from m.compacted_sha256 then
    raise exception 'reviewed_bundle_reference_changed' using errcode='40001'; end if;
  current_hash:=private.reviewed_bundle_row_sha256_v1(current_doc);
  if current_hash is distinct from (case when m.state='compacted' then m.compacted_sha256 else m.original_sha256 end) then
    raise exception 'reviewed_bundle_row_changed' using errcode='40001'; end if;
  if p_action='restore' then next_doc:=before_doc; end if;
  if current_doc is distinct from next_doc then
    insert into private.reviewed_bundle_write_permits values(pg_backend_pid(),txid_current(),v_release_id,current_hash,private.reviewed_bundle_row_sha256_v1(next_doc));
    update private.reviewed_mock_source_releases_v1 r set bundle=next_doc->'bundle' where r.release_id=v_release_id;
    if exists(select 1 from private.reviewed_bundle_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()) then
      raise exception 'reviewed_bundle_permit_not_consumed' using errcode='55000'; end if;
    changed:=1;
  end if;
  update private.reviewed_bundle_archives a set state=case when p_action='compact' then 'compacted' else 'restored' end
    where a.release_id=v_release_id;
  if (select private.reviewed_bundle_row_sha256_v1(to_jsonb(r)) from private.reviewed_mock_source_releases_v1 r
      where r.release_id=v_release_id) is distinct from private.reviewed_bundle_row_sha256_v1(next_doc) then
    raise exception 'reviewed_bundle_write_mismatch' using errcode='40001'; end if;
  result:=jsonb_build_object('requestId',p_request_id,'releaseId',v_release_id,'action',p_action,'changed',changed,'archiveHash',p_archive_sha256);
  insert into private.reviewed_bundle_archive_receipts(request_id,request_sha256,archive_sha256,release_id,result)
    values(p_request_id,request_hash,p_archive_sha256,v_release_id,result);
  return result;
end $$;

do $acl$
declare r record;
begin
  for r in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' and p.proname in ('reviewed_bundle_row_sha256_v1','reviewed_bundle_compacted_row_v1',
      'check_reviewed_bundle_operator_v1','lock_reviewed_bundle_v1','list_reviewed_bundle_candidates_v1',
      'prepare_reviewed_bundle_archive_v1','guard_reviewed_bundle_write_v1','apply_reviewed_bundle_archive_v1') loop
    execute format('revoke all on function %s from public,anon,authenticated,service_role',r.signature);
  end loop;
end $acl$;
commit;
