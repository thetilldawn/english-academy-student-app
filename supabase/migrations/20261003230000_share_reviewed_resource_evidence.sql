-- APP-20261003-07: share identical reviewed evidence; install tools without changing source rows.
begin;
create table private.reviewed_evidence_objects (
  sha256 text primary key check(sha256 ~ '^[a-f0-9]{64}$'),
  evidence jsonb not null check(jsonb_typeof(evidence)='object'),
  check(sha256=private.reviewed_bundle_row_sha256_v1(evidence))
);
create table private.reviewed_resource_archives (
  release_id uuid not null, source_row integer not null,
  target_project_ref text not null,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  identity_sha256 text not null check(identity_sha256 ~ '^[a-f0-9]{64}$'),
  entry_sha256 text not null check(entry_sha256 ~ '^[a-f0-9]{64}$'),
  reference_sha256 text not null check(reference_sha256 ~ '^[a-f0-9]{64}$'),
  evidence_hashes text[] not null check(cardinality(evidence_hashes)>0),
  original_bytes integer not null check(original_bytes between 1 and 1048576),
  state text not null check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(release_id,source_row),
  foreign key(release_id,source_row) references private.reviewed_mock_source_resources_v1(release_id,source_row)
);
create table private.reviewed_resource_archive_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table private.reviewed_resource_write_permits (
  backend_pid integer not null, transaction_id bigint not null,
  release_id uuid not null, source_row integer not null,
  before_sha256 text not null, after_sha256 text not null,
  primary key(backend_pid,transaction_id,release_id,source_row)
);
alter table private.reviewed_evidence_objects enable row level security;
alter table private.reviewed_resource_archives enable row level security;
alter table private.reviewed_resource_archive_receipts enable row level security;
alter table private.reviewed_resource_write_permits enable row level security;
revoke all on private.reviewed_evidence_objects,private.reviewed_resource_archives,private.reviewed_resource_archive_receipts,private.reviewed_resource_write_permits from public,anon,authenticated,service_role;
create trigger reviewed_evidence_object_immutable before update or delete on private.reviewed_evidence_objects
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger reviewed_resource_receipt_immutable before update or delete on private.reviewed_resource_archive_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

-- Fixed locations only: do not recursively rewrite arbitrary future fields.
create function private.reviewed_resource_evidence_items_v1(p_payload jsonb)
returns table(item_path text[],object_value jsonb) language plpgsql immutable strict set search_path='' as $$
declare field_name text; entry record; review record;
begin
  if jsonb_typeof(p_payload->'source_evidence')='object' then
    item_path:=array['source_evidence'];object_value:=p_payload->'source_evidence';return next;
  end if;
  foreach field_name in array array['dictionary','pos','pronunciation','definition','example'] loop
    if jsonb_typeof(p_payload#>array[field_name,'evidence'])='array' then
      for entry in select value,ordinality from jsonb_array_elements(p_payload#>array[field_name,'evidence']) with ordinality loop
        if jsonb_typeof(entry.value)='object' then
          item_path:=array[field_name,'evidence',(entry.ordinality-1)::text];object_value:=entry.value;return next;
        end if;
      end loop;
    end if;
  end loop;
  if jsonb_typeof(p_payload->'review_records')='array' then
    for review in select value,ordinality from jsonb_array_elements(p_payload->'review_records') with ordinality loop
      if jsonb_typeof(review.value->'evidence')='array' then
        for entry in select value,ordinality from jsonb_array_elements(review.value->'evidence') with ordinality loop
          if jsonb_typeof(entry.value)='object' then
            item_path:=array['review_records',(review.ordinality-1)::text,'evidence',(entry.ordinality-1)::text];object_value:=entry.value;return next;
          end if;
        end loop;
      end if;
    end loop;
  end if;
end $$;

create function private.reviewed_resource_shared_hashes_v1(p_rows jsonb) returns text[]
language plpgsql stable strict set search_path='' as $$
declare result text[];
begin
  if exists(select 1 from jsonb_array_elements(p_rows) r cross join lateral private.reviewed_resource_evidence_items_v1(r->'payload') i
    left join private.reviewed_evidence_objects e on e.sha256=private.reviewed_bundle_row_sha256_v1(i.object_value)
    where i.object_value ? '__evidence_ref_v1' or (e.sha256 is not null and e.evidence::text<>i.object_value::text)) then
    raise exception 'reviewed_resource_evidence_collision' using errcode='40001'; end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r cross join lateral private.reviewed_resource_evidence_items_v1(r->'payload') i
    group by private.reviewed_bundle_row_sha256_v1(i.object_value) having count(distinct i.object_value::text)>1) then
    raise exception 'reviewed_resource_evidence_collision' using errcode='40001'; end if;
  with objects as (
    select r.ordinality row_no,i.object_value,private.reviewed_bundle_row_sha256_v1(i.object_value) sha
    from jsonb_array_elements(p_rows) with ordinality r(value,ordinality)
    cross join lateral private.reviewed_resource_evidence_items_v1(r.value->'payload') i
  ), grouped as (
    select sha,min(object_value::text) body,count(*) uses,count(distinct row_no) row_count from objects group by sha
  ) select coalesce(array_agg(g.sha order by g.sha),'{}') into result from grouped g
    left join private.reviewed_evidence_objects e on e.sha256=g.sha
    where (g.uses>=2 or e.sha256 is not null)
      and g.uses*(octet_length(g.body)-octet_length(jsonb_build_object('__evidence_ref_v1',g.sha)::text))
        > g.row_count*192 + case when e.sha256 is null then octet_length(g.body)+256 else 0 end;
  return result;
end $$;

create function private.reviewed_resource_reference_v1(p_row jsonb,p_hashes text[]) returns jsonb
language plpgsql immutable strict set search_path='' as $$
declare payload jsonb:=p_row->'payload'; item record; sha text; seen text[]:='{}'; result jsonb;
begin
  if jsonb_typeof(payload) is distinct from 'object' or payload ? '__reviewed_resource_ref_v1' or cardinality(p_hashes)=0
    or cardinality(p_hashes)<>(select count(distinct h) from unnest(p_hashes) h) then
    raise exception 'reviewed_resource_original_invalid' using errcode='22023'; end if;
  for item in select * from private.reviewed_resource_evidence_items_v1(payload) loop
    if item.object_value ? '__evidence_ref_v1' then raise exception 'reviewed_resource_reserved_marker' using errcode='22023'; end if;
    sha:=private.reviewed_bundle_row_sha256_v1(item.object_value);
    if sha=any(p_hashes) then
      payload:=jsonb_set(payload,item.item_path,jsonb_build_object('__evidence_ref_v1',sha));
      if not(sha=any(seen)) then seen:=array_append(seen,sha); end if;
    end if;
  end loop;
  if not(p_hashes <@ seen) then raise exception 'reviewed_resource_hash_not_in_row' using errcode='22023'; end if;
  result:=jsonb_build_object('__reviewed_resource_ref_v1',payload);
  if octet_length((p_row->'payload')::text)-octet_length(result::text)<=256+64*cardinality(p_hashes) then
    raise exception 'reviewed_resource_not_smaller: %/%',p_row->>'release_id',p_row->>'source_row' using errcode='22023'; end if;
  return result;
end $$;

create function private.restore_reviewed_resource_v1(p_row jsonb) returns jsonb
language plpgsql stable strict set search_path='' as $$
declare stored jsonb:=p_row->'payload'; m private.reviewed_resource_archives; payload jsonb; item record;
  sha text; seen text[]:='{}'; object jsonb; original jsonb;
begin
  select * into m from private.reviewed_resource_archives where release_id=(p_row->>'release_id')::uuid and source_row=(p_row->>'source_row')::integer;
  if not(stored ? '__reviewed_resource_ref_v1') then
    if m.state='compacted' then raise exception 'reviewed_resource_reference_changed' using errcode='40001'; end if;
    return p_row;
  end if;
  if m.release_id is null or m.state<>'compacted'
    or private.reviewed_bundle_row_sha256_v1(p_row-'payload') is distinct from m.identity_sha256
    or private.reviewed_bundle_row_sha256_v1(stored) is distinct from m.reference_sha256 then
    raise exception 'reviewed_resource_reference_changed' using errcode='40001'; end if;
  payload:=stored->'__reviewed_resource_ref_v1';
  for item in select * from private.reviewed_resource_evidence_items_v1(payload) loop
    if item.object_value ? '__evidence_ref_v1' then
      sha:=item.object_value->>'__evidence_ref_v1';
      if item.object_value-'__evidence_ref_v1'<>'{}' or sha !~ '^[a-f0-9]{64}$' or not(sha=any(m.evidence_hashes)) then
        raise exception 'reviewed_resource_reference_invalid' using errcode='40001'; end if;
      select evidence into object from private.reviewed_evidence_objects where sha256=sha;
      if not found or private.reviewed_bundle_row_sha256_v1(object) is distinct from sha then
        raise exception 'reviewed_resource_evidence_missing' using errcode='40001'; end if;
      payload:=jsonb_set(payload,item.item_path,object);seen:=array_append(seen,sha);
    end if;
  end loop;
  original:=jsonb_set(p_row,'{payload}',payload);
  if not(m.evidence_hashes <@ seen) or private.reviewed_bundle_row_sha256_v1(payload) is distinct from m.entry_sha256
    or private.reviewed_bundle_row_sha256_v1(original) is distinct from m.original_sha256
    or private.reviewed_bundle_row_sha256_v1(private.reviewed_resource_reference_v1(original,m.evidence_hashes)) is distinct from m.reference_sha256 then
    raise exception 'reviewed_resource_content_changed' using errcode='40001'; end if;
  return original;
end $$;

-- Recheck the actual compact packet, including partial packets. Preparation is not a savings promise.
create function private.install_reviewed_resource_evidence_v1(p_packet jsonb) returns void
language plpgsql set search_path='' as $$
declare p jsonb; original jsonb; reference jsonb; m private.reviewed_resource_archives; item record;
  savings bigint:=0; new_cost bigint:=0; objects jsonb:='{}'; sha text; stored jsonb;
begin
  for p in select value from jsonb_array_elements(p_packet->'rows') loop
    original:=(p->>'beforeText')::jsonb;
    select * into m from private.reviewed_resource_archives where release_id=(p->>'releaseId')::uuid and source_row=(p->>'sourceRow')::int;
    if not found or private.reviewed_bundle_row_sha256_v1(original) is distinct from m.original_sha256 then
      raise exception 'reviewed_resource_archive_changed' using errcode='40001'; end if;
    reference:=private.reviewed_resource_reference_v1(original,m.evidence_hashes);
    if private.reviewed_bundle_row_sha256_v1(reference) is distinct from m.reference_sha256 then
      raise exception 'reviewed_resource_reference_changed' using errcode='40001'; end if;
    if m.state<>'compacted' then
      savings:=savings+octet_length((original->'payload')::text)-octet_length(reference::text)-256-64*cardinality(m.evidence_hashes);
      for item in select * from private.reviewed_resource_evidence_items_v1(original->'payload') loop
        sha:=private.reviewed_bundle_row_sha256_v1(item.object_value);
        if sha=any(m.evidence_hashes) then
          if objects ? sha and (objects->sha)::text<>item.object_value::text then
            raise exception 'reviewed_resource_evidence_collision' using errcode='40001'; end if;
          objects:=objects||jsonb_build_object(sha,item.object_value);
        end if;
      end loop;
    end if;
  end loop;
  for item in select key,value from jsonb_each(objects) order by key loop
    select evidence into stored from private.reviewed_evidence_objects where sha256=item.key;
    if found then
      if stored::text<>item.value::text then raise exception 'reviewed_resource_evidence_collision' using errcode='40001'; end if;
    else new_cost:=new_cost+octet_length(item.value::text)+256;
    end if;
  end loop;
  if savings<=new_cost and objects<>'{}' then raise exception 'reviewed_resource_batch_not_smaller' using errcode='22023'; end if;
  for item in select key,value from jsonb_each(objects) order by key loop
    insert into private.reviewed_evidence_objects(sha256,evidence) values(item.key,item.value) on conflict(sha256) do nothing;
    -- A separate statement gets the committed row under READ COMMITTED after an insert conflict.
    select evidence into stored from private.reviewed_evidence_objects where sha256=item.key;
    if not found or stored::text<>item.value::text then raise exception 'reviewed_resource_evidence_collision' using errcode='40001'; end if;
  end loop;
end $$;

create function private.lock_reviewed_resources_v1(p_keys jsonb,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare item record; result jsonb; key_count integer;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$'
    or jsonb_typeof(p_keys) is distinct from 'array' or jsonb_array_length(p_keys) not between 1 and 100
    or exists(select 1 from jsonb_array_elements(p_keys) k where jsonb_typeof(k) is distinct from 'object'
      or not(k ?& array['releaseId','sourceRow']) or k-array['releaseId','sourceRow']<>'{}'
      or jsonb_typeof(k->'releaseId') is distinct from 'string'
      or jsonb_typeof(k->'sourceRow') is distinct from 'number' or k->>'sourceRow' !~ '^[1-9][0-9]{0,8}$') then
    raise exception 'reviewed_resource_keys_invalid' using errcode='22023'; end if;
  key_count:=jsonb_array_length(p_keys);
  if (select count(distinct ((k->>'releaseId')::uuid,(k->>'sourceRow')::integer)) from jsonb_array_elements(p_keys) k)<>key_count then
    raise exception 'reviewed_resource_duplicate_key' using errcode='22023'; end if;
  if (select count(*) from jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer)
    join private.reviewed_mock_source_resources_v1 o on o.release_id=k."releaseId" and o.source_row=k."sourceRow"
    join private.reviewed_mock_source_releases_v1 s on s.release_id=o.release_id
    join private.reviewed_mock_source_approvals_v1 a on a.approval_id=s.approval_id and a.target_project_ref=s.target_project_ref
    where s.target_project_ref=p_target_project_ref and a.package_version=(select package_version from word_index.app_exam_use_release where release_id=s.release_id)
      and a.dataset_key<>'g12-long-reading-2025-exam-scope-v1')<>key_count then
    raise exception 'reviewed_resource_reviewed_source_required' using errcode='P0002'; end if;
  for item in select distinct r.dataset_key,r.dataset_id,r.release_id from word_index.app_exam_use_release r
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=r.release_id
    order by r.dataset_key,r.release_id loop
    if not pg_try_advisory_xact_lock(hashtextextended(item.dataset_key,9129)) then raise exception 'reviewed_resource_busy' using errcode='55P03'; end if;
    perform 1 from public.vocab_datasets where id=item.dataset_id for update nowait;
    perform 1 from word_index.app_exam_use_release where release_id=item.release_id for update nowait;
  end loop;
  perform 1 from private.reviewed_mock_source_resources_v1 o
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=o.release_id and k."sourceRow"=o.source_row
    order by o.release_id,o.source_row for update of o nowait;
  select jsonb_agg(to_jsonb(o) order by o.release_id,o.source_row) into result from private.reviewed_mock_source_resources_v1 o
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=o.release_id and k."sourceRow"=o.source_row;
  if jsonb_array_length(result) is distinct from key_count then raise exception 'reviewed_resource_row_changed' using errcode='40001'; end if;
  return result;
end $$;

create function private.list_reviewed_resource_candidates_v1(p_target_project_ref text,p_release_id uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then raise exception 'reviewed_resource_project_invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('releaseId',o.release_id,'sourceRow',o.source_row) order by o.release_id,o.source_row),'[]') into result
    from private.reviewed_mock_source_resources_v1 o join private.reviewed_mock_source_releases_v1 s on s.release_id=o.release_id
    join word_index.app_exam_use_release r on r.release_id=o.release_id
    left join private.reviewed_resource_archives m on m.release_id=o.release_id and m.source_row=o.source_row
    where s.target_project_ref=p_target_project_ref and (p_release_id is null or o.release_id=p_release_id)
      and r.dataset_key<>'g12-long-reading-2025-exam-scope-v1' and (m.release_id is null or m.state<>'compacted');
  return result;
end $$;

create function private.prepare_reviewed_resource_archive_v1(p_keys jsonb,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare rows jsonb; row_doc jsonb; original_text text; reference jsonb; m private.reviewed_resource_archives; packets jsonb:='[]'; answer jsonb; all_hashes text[]; row_hashes text[];
begin
  rows:=private.lock_reviewed_resources_v1(p_keys,p_target_project_ref);
  if exists(select 1 from jsonb_array_elements(rows) r join private.reviewed_resource_archives a
    on a.release_id=(r->>'release_id')::uuid and a.source_row=(r->>'source_row')::int where a.state='compacted') then
    raise exception 'reviewed_resource_archive_file_required' using errcode='22023'; end if;
  all_hashes:=private.reviewed_resource_shared_hashes_v1(rows);
  for row_doc in select value from jsonb_array_elements(rows) loop
    select * into m from private.reviewed_resource_archives where release_id=(row_doc->>'release_id')::uuid and source_row=(row_doc->>'source_row')::int for update nowait;
    original_text:=row_doc::text;
    if found then
      if m.target_project_ref<>p_target_project_ref then raise exception 'reviewed_resource_project_mismatch' using errcode='22023'; end if;
      if m.state='compacted' then raise exception 'reviewed_resource_archive_file_required' using errcode='22023'; end if;
      if private.reviewed_bundle_row_sha256_v1(row_doc) is distinct from m.original_sha256 then raise exception 'reviewed_resource_row_changed' using errcode='40001'; end if;
    else
      if octet_length(original_text)>1048576 then raise exception 'reviewed_resource_row_too_large' using errcode='22023'; end if;
      select coalesce(array_agg(distinct private.reviewed_bundle_row_sha256_v1(object_value) order by private.reviewed_bundle_row_sha256_v1(object_value)),'{}') into row_hashes
        from private.reviewed_resource_evidence_items_v1(row_doc->'payload') where private.reviewed_bundle_row_sha256_v1(object_value)=any(all_hashes);
      if cardinality(row_hashes)=0 then raise exception 'reviewed_resource_not_smaller: %/%',row_doc->>'release_id',row_doc->>'source_row' using errcode='22023'; end if;
      reference:=private.reviewed_resource_reference_v1(row_doc,row_hashes);
      insert into private.reviewed_resource_archives(release_id,source_row,target_project_ref,original_sha256,identity_sha256,entry_sha256,reference_sha256,evidence_hashes,original_bytes,state)
      values((row_doc->>'release_id')::uuid,(row_doc->>'source_row')::int,p_target_project_ref,
        private.reviewed_bundle_row_sha256_v1(row_doc),private.reviewed_bundle_row_sha256_v1(row_doc-'payload'),
        private.reviewed_bundle_row_sha256_v1(row_doc->'payload'),private.reviewed_bundle_row_sha256_v1(reference),row_hashes,octet_length(original_text),'prepared');
    end if;
    packets:=packets||jsonb_build_array(jsonb_build_object('releaseId',row_doc->'release_id','sourceRow',row_doc->'source_row','beforeText',original_text));
  end loop;
  answer:=jsonb_build_object('projectRef',p_target_project_ref,'rows',packets);
  if octet_length(answer::text)>16777216 then raise exception 'reviewed_resource_batch_too_large' using errcode='22023'; end if;
  return answer;
end $$;

create function private.guard_reviewed_resource_write_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='INSERT' then
    if new.payload ? '__reviewed_resource_ref_v1' or exists(select 1 from private.reviewed_resource_evidence_items_v1(new.payload) where object_value ? '__evidence_ref_v1') then
      raise exception 'reviewed_resource_reserved_marker' using errcode='22023'; end if;
    return new;
  end if;
  if tg_op='UPDATE' and to_jsonb(new)-'payload'=to_jsonb(old)-'payload' then
    delete from private.reviewed_resource_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and release_id=old.release_id and source_row=old.source_row
      and before_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(old)) and after_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(new));
    if found then return new; end if;
  end if;
  raise exception 'reviewed_mock_source_immutable';
end $$;
do $$begin
  if exists(select 1 from private.reviewed_mock_source_resources_v1 r where r.payload ? '__reviewed_resource_ref_v1'
    or exists(select 1 from private.reviewed_resource_evidence_items_v1(r.payload) where object_value ? '__evidence_ref_v1')) then
    raise exception 'reviewed_resource_reserved_marker_exists'; end if;
end $$;
drop trigger reviewed_mock_resource_immutable on private.reviewed_mock_source_resources_v1;
create trigger reviewed_mock_resource_immutable before insert or update or delete on private.reviewed_mock_source_resources_v1
  for each row execute function private.guard_reviewed_resource_write_v1();
create function private.apply_reviewed_resource_archive_v1(p_request_id uuid,p_action text,p_target_project_ref text,p_archive_sha256 text,p_packet jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare request_hash text; receipt private.reviewed_resource_archive_receipts; keys jsonb; locked_rows jsonb; packet_row jsonb;
  original jsonb; current_doc jsonb; next_doc jsonb; reference jsonb; m private.reviewed_resource_archives; result jsonb; changed integer:=0;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_request_id is null or p_action is null or p_action not in ('compact','restore')
    or p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$'
    or p_archive_sha256 is null or p_archive_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_packet) is distinct from 'object' or not(p_packet ?& array['projectRef','rows']) or p_packet-array['projectRef','rows']<>'{}'
    or p_packet->>'projectRef' is distinct from p_target_project_ref
    or jsonb_typeof(p_packet->'rows') is distinct from 'array' or jsonb_array_length(p_packet->'rows') not between 1 and 100
    or octet_length(p_packet::text)>16777216 or exists(select 1 from jsonb_array_elements(p_packet->'rows') x where jsonb_typeof(x) is distinct from 'object'
      or not(x ?& array['releaseId','sourceRow','beforeText']) or x-array['releaseId','sourceRow','beforeText']<>'{}'
      or jsonb_typeof(x->'beforeText') is distinct from 'string' or octet_length(x->>'beforeText')>1048576) then
    raise exception 'reviewed_resource_packet_invalid' using errcode='22023'; end if;
  request_hash:=private.reviewed_bundle_row_sha256_v1(jsonb_build_array(p_action,p_target_project_ref,p_archive_sha256,p_packet));
  select * into receipt from private.reviewed_resource_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'reviewed_resource_request_reused' using errcode='40001'; end if;return receipt.result;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('reviewed-resource-request:'||p_request_id,64007)) then raise exception 'reviewed_resource_busy' using errcode='55P03'; end if;
  select jsonb_agg(x-'beforeText') into keys from jsonb_array_elements(p_packet->'rows') x;
  locked_rows:=private.lock_reviewed_resources_v1(keys,p_target_project_ref);
  select * into receipt from private.reviewed_resource_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'reviewed_resource_request_reused' using errcode='40001'; end if;return receipt.result;
  end if;
  if p_action='compact' then perform private.install_reviewed_resource_evidence_v1(p_packet); end if;
  for packet_row in select x from jsonb_array_elements(p_packet->'rows') x order by (x->>'releaseId')::uuid,(x->>'sourceRow')::int loop
    original:=(packet_row->>'beforeText')::jsonb;
    select * into m from private.reviewed_resource_archives where release_id=(packet_row->>'releaseId')::uuid and source_row=(packet_row->>'sourceRow')::int for update nowait;
    if not found then raise exception 'reviewed_resource_preparation_missing' using errcode='P0002'; end if;
    if m.target_project_ref<>p_target_project_ref or original->>'release_id' is distinct from m.release_id::text
      or (original->>'source_row')::int is distinct from m.source_row
      or private.reviewed_bundle_row_sha256_v1(original) is distinct from m.original_sha256
      or private.reviewed_bundle_row_sha256_v1(original->'payload') is distinct from m.entry_sha256 then
      raise exception 'reviewed_resource_archive_changed' using errcode='40001'; end if;
    select d into current_doc from jsonb_array_elements(locked_rows) d where d->>'release_id'=m.release_id::text and (d->>'source_row')::int=m.source_row;
    if private.reviewed_bundle_row_sha256_v1(current_doc-'payload') is distinct from m.identity_sha256
      or private.reviewed_bundle_row_sha256_v1(current_doc->'payload') is distinct from
        (case when m.state='compacted' then m.reference_sha256 else m.entry_sha256 end) then
      raise exception 'reviewed_resource_row_changed' using errcode='40001'; end if;
    reference:=private.reviewed_resource_reference_v1(original,m.evidence_hashes);
    if private.reviewed_bundle_row_sha256_v1(reference) is distinct from m.reference_sha256 then raise exception 'reviewed_resource_reference_changed' using errcode='40001'; end if;
    next_doc:=jsonb_set(current_doc,'{payload}',case when p_action='compact' then reference else original->'payload' end);
    if current_doc is distinct from next_doc then
      insert into private.reviewed_resource_write_permits(backend_pid,transaction_id,release_id,source_row,before_sha256,after_sha256)
      values(pg_backend_pid(),txid_current(),m.release_id,m.source_row,private.reviewed_bundle_row_sha256_v1(current_doc),private.reviewed_bundle_row_sha256_v1(next_doc));
      update private.reviewed_mock_source_resources_v1 set payload=next_doc->'payload' where release_id=m.release_id and source_row=m.source_row;
      if exists(select 1 from private.reviewed_resource_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current() and release_id=m.release_id and source_row=m.source_row) then
        raise exception 'reviewed_resource_permit_not_consumed' using errcode='40001'; end if;
      changed:=changed+1;
    end if;
    update private.reviewed_resource_archives set state=case when p_action='compact' then 'compacted' else 'restored' end where release_id=m.release_id and source_row=m.source_row;
    select to_jsonb(o) into current_doc from private.reviewed_mock_source_resources_v1 o where release_id=m.release_id and source_row=m.source_row;
    if private.reviewed_bundle_row_sha256_v1(current_doc) is distinct from private.reviewed_bundle_row_sha256_v1(next_doc)
      or private.reviewed_bundle_row_sha256_v1(private.restore_reviewed_resource_v1(current_doc)) is distinct from m.original_sha256 then
      raise exception 'reviewed_resource_roundtrip_failed' using errcode='40001'; end if;
  end loop;
  result:=jsonb_build_object('requestId',p_request_id,'action',p_action,'rows',jsonb_array_length(p_packet->'rows'),'changed',changed,'archiveHash',p_archive_sha256,'keysHash',private.reviewed_bundle_row_sha256_v1(keys));
  insert into private.reviewed_resource_archive_receipts(request_id,request_sha256,archive_sha256,result) values(p_request_id,request_hash,p_archive_sha256,result);
  return result;
end $$;

-- Patch exactly one payload read and preserve the RPC's OID, ACL, settings and retired-source behavior.
do $consumer$
declare definition text; needle text:='select x.vocab_entry_id,x.payload from private.reviewed_mock_source_resources_v1 x';
begin
  definition:=pg_get_functiondef('public.list_reviewed_mock_source_resources_v1(bigint[])'::regprocedure);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'reviewed_resource_consumer_drift'; end if;
  execute replace(definition,needle,'select x.vocab_entry_id,private.restore_reviewed_resource_v1(to_jsonb(x))->''payload'' from private.reviewed_mock_source_resources_v1 x');
end $consumer$;
revoke all on function private.reviewed_resource_evidence_items_v1(jsonb),private.reviewed_resource_shared_hashes_v1(jsonb),
  private.reviewed_resource_reference_v1(jsonb,text[]),private.restore_reviewed_resource_v1(jsonb),
  private.install_reviewed_resource_evidence_v1(jsonb),private.lock_reviewed_resources_v1(jsonb,text),
  private.list_reviewed_resource_candidates_v1(text,uuid),private.prepare_reviewed_resource_archive_v1(jsonb,text),
  private.guard_reviewed_resource_write_v1(),private.apply_reviewed_resource_archive_v1(uuid,text,text,text,jsonb)
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

