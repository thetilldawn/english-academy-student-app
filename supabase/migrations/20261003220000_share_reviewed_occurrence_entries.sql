-- APP-20261003-06: share a reviewed occurrence's duplicate entry through its fixed columns.
-- Installs tools only. Existing source rows are not changed by this migration.
begin;
create table private.exam_use_occurrence_archives (
  release_id uuid not null, source_row integer not null,
  target_project_ref text not null,
  original_sha256 text not null check(original_sha256 ~ '^[a-f0-9]{64}$'),
  identity_sha256 text not null check(identity_sha256 ~ '^[a-f0-9]{64}$'),
  entry_sha256 text not null check(entry_sha256 ~ '^[a-f0-9]{64}$'),
  reference_sha256 text not null check(reference_sha256 ~ '^[a-f0-9]{64}$'),
  original_bytes integer not null check(original_bytes between 1 and 1048576),
  state text not null check(state in ('prepared','compacted','restored')),
  created_at timestamptz not null default clock_timestamp(),
  primary key(release_id,source_row),
  foreign key(release_id,source_row) references word_index.app_exam_use_occurrence(release_id,source_row)
);
create table private.exam_use_occurrence_archive_receipts (
  request_id uuid primary key,
  request_sha256 text not null check(request_sha256 ~ '^[a-f0-9]{64}$'),
  archive_sha256 text not null check(archive_sha256 ~ '^[a-f0-9]{64}$'),
  result jsonb not null, created_at timestamptz not null default clock_timestamp()
);
create table private.exam_use_occurrence_write_permits (
  backend_pid integer not null, transaction_id bigint not null,
  release_id uuid not null, source_row integer not null,
  before_sha256 text not null, after_sha256 text not null,
  primary key(backend_pid,transaction_id,release_id,source_row)
);
alter table private.exam_use_occurrence_archives enable row level security;
alter table private.exam_use_occurrence_archive_receipts enable row level security;
alter table private.exam_use_occurrence_write_permits enable row level security;
revoke all on private.exam_use_occurrence_archives,private.exam_use_occurrence_archive_receipts,private.exam_use_occurrence_write_permits from public,anon,authenticated,service_role;
create trigger exam_use_occurrence_receipt_immutable before update or delete on private.exam_use_occurrence_archive_receipts
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.exam_use_occurrence_entry_fields_v1() returns text[]
language sql immutable set search_path='' as $$ select array['source_row','position_in_unit','dictionary_id','legacy_ids','sense_id','pronunciation_variant_id','display_headword','display_gloss_ko','display_pronunciation_ko','display_pronunciation_review_status','audio','occurrence_id','occurrence_content_hash','content_hash','exam_review_id','exam_input_hash','exam_use_status','context_evidence_status','context_evidence','entry_row_sha256','source_entry_id','source_entry_sha256','include_in_exam','manual_review_flags']; $$;

create function private.exam_use_occurrence_entry_candidates_v1(p_row jsonb) returns jsonb
language sql immutable strict set search_path='' as $$
  select jsonb_build_object('source_row',p_row->'source_row',
    'position_in_unit',p_row->'position_in_unit',
    'dictionary_id',p_row->'dictionary_id',
    'legacy_ids',p_row->'legacy_ids',
    'sense_id',p_row->'sense_id',
    'pronunciation_variant_id',p_row->'pronunciation_variant_id',
    'display_headword',p_row->'display_headword',
    'display_gloss_ko',p_row->'display_gloss_ko',
    'display_pronunciation_ko',p_row->'display_pronunciation_ko',
    'display_pronunciation_review_status',p_row->'display_pronunciation_review_status',
    'audio',p_row->'audio_json',
    'occurrence_id',p_row->'occurrence_id',
    'occurrence_content_hash',p_row->'occurrence_content_hash',
    'content_hash',p_row->'package_entry_content_hash',
    'exam_review_id',p_row->'exam_review_id',
    'exam_input_hash',p_row->'exam_input_hash',
    'exam_use_status',p_row->'exam_use_status',
    'context_evidence_status',p_row->'context_evidence_status',
    'context_evidence',p_row->'context_evidence',
    'entry_row_sha256',p_row->'source_projection_row_sha256',
    'source_entry_id',p_row->'source_entry_id',
    'source_entry_sha256',p_row->'source_entry_sha256',
    'include_in_exam',p_row->'include_in_exam',
    'manual_review_flags',p_row->'manual_review_flags');
$$;

create function private.exam_use_occurrence_entry_reference_v1(p_row jsonb) returns jsonb
language plpgsql immutable strict set search_path='' as $$
declare original jsonb:=p_row->'package_entry_json'; candidates jsonb; extra jsonb; result jsonb;
  field_names text[]:=private.exam_use_occurrence_entry_fields_v1(); field_name text; mask integer:=0; i integer;
begin
  if jsonb_typeof(original) is distinct from 'object' or original ? '__exam_use_entry_ref_v1'
    or not(p_row ?& array['release_id','source_row']) then
    raise exception 'occurrence_entry_original_invalid' using errcode='22023'; end if;
  candidates:=private.exam_use_occurrence_entry_candidates_v1(p_row);extra:=original;
  for i in 1..cardinality(field_names) loop
    field_name:=field_names[i];
    -- jsonb equality treats 1 and 1.0 as equal; the legacy text SHA does not.
    if original ? field_name and (original->field_name)::text=(candidates->field_name)::text then
      mask:=mask | (1 << (i-1));extra:=extra-field_name;
    end if;
  end loop;
  if octet_length(extra::text)>4096 then raise exception 'occurrence_entry_residual_too_large' using errcode='22023'; end if;
  result:=jsonb_build_object('__exam_use_entry_ref_v1',jsonb_build_object(
    'releaseId',p_row->'release_id','sourceRow',p_row->'source_row','fields',mask),'extra',extra);
  if octet_length(result::text)>=octet_length(original::text) then
    raise exception 'occurrence_entry_not_smaller' using errcode='22023'; end if;
  return result;
end $$;

create function private.restore_exam_use_occurrence_v1(p_row jsonb) returns jsonb
language plpgsql stable strict set search_path='' as $$
declare stored jsonb:=p_row->'package_entry_json'; m private.exam_use_occurrence_archives; rebuilt jsonb; original jsonb;
  candidates jsonb; field_names text[]:=private.exam_use_occurrence_entry_fields_v1(); mask integer; i integer;
begin
  select * into m from private.exam_use_occurrence_archives where release_id=(p_row->>'release_id')::uuid and source_row=(p_row->>'source_row')::integer;
  if not(stored ? '__exam_use_entry_ref_v1') then
    if m.state='compacted' then raise exception 'occurrence_entry_reference_changed' using errcode='40001'; end if;
    return p_row;
  end if;
  if m.release_id is null or m.state<>'compacted'
    or private.reviewed_bundle_row_sha256_v1(p_row-'package_entry_json') is distinct from m.identity_sha256
    or private.reviewed_bundle_row_sha256_v1(stored) is distinct from m.reference_sha256 then
    raise exception 'occurrence_entry_reference_changed' using errcode='40001'; end if;
  if jsonb_typeof(stored->'extra') is distinct from 'object'
    or stored#>'{__exam_use_entry_ref_v1,releaseId}' is distinct from p_row->'release_id'
    or stored#>'{__exam_use_entry_ref_v1,sourceRow}' is distinct from p_row->'source_row'
    or jsonb_typeof(stored#>'{__exam_use_entry_ref_v1,fields}') is distinct from 'number'
    or stored#>>'{__exam_use_entry_ref_v1,fields}' !~ '^[0-9]{1,8}$' then
    raise exception 'occurrence_entry_reference_invalid' using errcode='40001'; end if;
  mask:=(stored#>>'{__exam_use_entry_ref_v1,fields}')::integer;
  if mask<0 or mask>=(1 << cardinality(field_names)) then raise exception 'occurrence_entry_reference_invalid' using errcode='40001'; end if;
  candidates:=private.exam_use_occurrence_entry_candidates_v1(p_row);rebuilt:=stored->'extra';
  for i in 1..cardinality(field_names) loop
    if (mask & (1 << (i-1)))<>0 then
      if rebuilt ? field_names[i] then raise exception 'occurrence_entry_reference_invalid' using errcode='40001'; end if;
      rebuilt:=rebuilt||jsonb_build_object(field_names[i],candidates->field_names[i]);
    end if;
  end loop;
  original:=jsonb_set(p_row,'{package_entry_json}',rebuilt);
  if private.reviewed_bundle_row_sha256_v1(rebuilt) is distinct from m.entry_sha256
    or private.reviewed_bundle_row_sha256_v1(original) is distinct from m.original_sha256
    or private.exam_use_occurrence_entry_reference_v1(original) is distinct from stored then
    raise exception 'occurrence_entry_content_changed' using errcode='40001'; end if;
  return original;
end $$;

create function private.lock_exam_use_occurrences_v1(p_keys jsonb,p_target_project_ref text) returns jsonb
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
    raise exception 'occurrence_entry_keys_invalid' using errcode='22023'; end if;
  key_count:=jsonb_array_length(p_keys);
  if (select count(distinct ((k->>'releaseId')::uuid,(k->>'sourceRow')::integer)) from jsonb_array_elements(p_keys) k)<>key_count then
    raise exception 'occurrence_entry_duplicate_key' using errcode='22023'; end if;
  if (select count(*) from jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer)
    join word_index.app_exam_use_occurrence o on o.release_id=k."releaseId" and o.source_row=k."sourceRow"
    join private.reviewed_mock_source_releases_v1 s on s.release_id=o.release_id
    join private.reviewed_mock_source_approvals_v1 a on a.approval_id=s.approval_id and a.target_project_ref=s.target_project_ref
    where s.target_project_ref=p_target_project_ref and a.package_version=(select package_version from word_index.app_exam_use_release where release_id=s.release_id)
      and a.dataset_key<>'g12-long-reading-2025-exam-scope-v1')<>key_count then
    raise exception 'occurrence_entry_reviewed_source_required' using errcode='P0002'; end if;
  for item in select distinct r.dataset_key,r.dataset_id,r.release_id from word_index.app_exam_use_release r
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=r.release_id
    order by r.dataset_key,r.release_id loop
    if not pg_try_advisory_xact_lock(hashtextextended(item.dataset_key,9129)) then raise exception 'occurrence_entry_busy' using errcode='55P03'; end if;
    perform 1 from public.vocab_datasets where id=item.dataset_id for update nowait;
    perform 1 from word_index.app_exam_use_release where release_id=item.release_id for update nowait;
  end loop;
  perform 1 from word_index.app_exam_use_occurrence o
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=o.release_id and k."sourceRow"=o.source_row
    order by o.release_id,o.source_row for update of o nowait;
  select jsonb_agg(to_jsonb(o) order by o.release_id,o.source_row) into result from word_index.app_exam_use_occurrence o
    join jsonb_to_recordset(p_keys) k("releaseId" uuid,"sourceRow" integer) on k."releaseId"=o.release_id and k."sourceRow"=o.source_row;
  if jsonb_array_length(result) is distinct from key_count then raise exception 'occurrence_entry_row_changed' using errcode='40001'; end if;
  return result;
end $$;

create function private.list_exam_use_occurrence_candidates_v1(p_target_project_ref text,p_release_id uuid default null) returns jsonb
language plpgsql set search_path='' as $$
declare result jsonb;
begin
  perform private.check_reviewed_bundle_operator_v1();
  if p_target_project_ref is null or p_target_project_ref !~ '^[a-z0-9]{20}$' then raise exception 'occurrence_entry_project_invalid' using errcode='22023'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('releaseId',o.release_id,'sourceRow',o.source_row) order by o.release_id,o.source_row),'[]') into result
    from word_index.app_exam_use_occurrence o join private.reviewed_mock_source_releases_v1 s on s.release_id=o.release_id
    join word_index.app_exam_use_release r on r.release_id=o.release_id
    left join private.exam_use_occurrence_archives m on m.release_id=o.release_id and m.source_row=o.source_row
    where s.target_project_ref=p_target_project_ref and (p_release_id is null or o.release_id=p_release_id)
      and r.dataset_key<>'g12-long-reading-2025-exam-scope-v1' and (m.release_id is null or m.state<>'compacted');
  return result;
end $$;

create function private.prepare_exam_use_occurrence_archive_v1(p_keys jsonb,p_target_project_ref text) returns jsonb
language plpgsql set search_path='' as $$
declare rows jsonb; row_doc jsonb; original_text text; reference jsonb; m private.exam_use_occurrence_archives; packets jsonb:='[]'; answer jsonb;
begin
  rows:=private.lock_exam_use_occurrences_v1(p_keys,p_target_project_ref);
  for row_doc in select value from jsonb_array_elements(rows) loop
    select * into m from private.exam_use_occurrence_archives where release_id=(row_doc->>'release_id')::uuid and source_row=(row_doc->>'source_row')::int for update nowait;
    original_text:=row_doc::text;
    if found then
      if m.target_project_ref<>p_target_project_ref then raise exception 'occurrence_entry_project_mismatch' using errcode='22023'; end if;
      if m.state='compacted' then raise exception 'occurrence_entry_archive_file_required' using errcode='22023'; end if;
      if private.reviewed_bundle_row_sha256_v1(row_doc) is distinct from m.original_sha256 then raise exception 'occurrence_entry_row_changed' using errcode='40001'; end if;
    else
      if octet_length(original_text)>1048576 then raise exception 'occurrence_entry_row_too_large' using errcode='22023'; end if;
      reference:=private.exam_use_occurrence_entry_reference_v1(row_doc);
      insert into private.exam_use_occurrence_archives(release_id,source_row,target_project_ref,original_sha256,identity_sha256,entry_sha256,reference_sha256,original_bytes,state)
      values((row_doc->>'release_id')::uuid,(row_doc->>'source_row')::int,p_target_project_ref,
        private.reviewed_bundle_row_sha256_v1(row_doc),private.reviewed_bundle_row_sha256_v1(row_doc-'package_entry_json'),
        private.reviewed_bundle_row_sha256_v1(row_doc->'package_entry_json'),private.reviewed_bundle_row_sha256_v1(reference),octet_length(original_text),'prepared');
    end if;
    packets:=packets||jsonb_build_array(jsonb_build_object('releaseId',row_doc->'release_id','sourceRow',row_doc->'source_row','beforeText',original_text));
  end loop;
  answer:=jsonb_build_object('projectRef',p_target_project_ref,'rows',packets);
  if octet_length(answer::text)>16777216 then raise exception 'occurrence_entry_batch_too_large' using errcode='22023'; end if;
  return answer;
end $$;

create function private.guard_exam_use_occurrence_write_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare dataset uuid;
begin
  if tg_op='UPDATE' and to_jsonb(new)-'package_entry_json'=to_jsonb(old)-'package_entry_json' then
    delete from private.exam_use_occurrence_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current()
      and release_id=old.release_id and source_row=old.source_row
      and before_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(old)) and after_sha256=private.reviewed_bundle_row_sha256_v1(to_jsonb(new));
    if found then return new; end if;
  end if;
  -- Exact original occurrence branch of the shared reviewed-source guard.
  if tg_op='INSERT' then dataset:=new.dataset_id; else dataset:=old.dataset_id; end if;
  if tg_op='UPDATE' and exists(select 1 from private.reviewed_mock_source_releases_v1 where dataset_id=new.dataset_id) then
    raise exception 'reviewed_mock_source_immutable'; end if;
  if exists(select 1 from private.reviewed_mock_source_releases_v1 where dataset_id=dataset) then raise exception 'reviewed_mock_source_immutable'; end if;
  if tg_op<>'DELETE' and new.package_entry_json ? '__exam_use_entry_ref_v1' then raise exception 'occurrence_entry_reserved_marker' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end $$;
-- Refuse to reinterpret pre-existing arbitrary input as the new storage format.
do $$begin
  if exists(select 1 from word_index.app_exam_use_occurrence where package_entry_json ? '__exam_use_entry_ref_v1') then
    raise exception 'occurrence_entry_reserved_marker_exists'; end if;
end$$;
drop trigger reviewed_mock_occurrence_immutable on word_index.app_exam_use_occurrence;
create trigger reviewed_mock_occurrence_immutable before insert or update or delete on word_index.app_exam_use_occurrence
  for each row execute function private.guard_exam_use_occurrence_write_v1();

create function private.apply_exam_use_occurrence_archive_v1(p_request_id uuid,p_action text,p_target_project_ref text,p_archive_sha256 text,p_packet jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare request_hash text; receipt private.exam_use_occurrence_archive_receipts; keys jsonb; locked_rows jsonb; packet_row jsonb;
  original jsonb; current_doc jsonb; next_doc jsonb; reference jsonb; m private.exam_use_occurrence_archives; result jsonb; changed integer:=0;
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
    raise exception 'occurrence_entry_packet_invalid' using errcode='22023'; end if;
  request_hash:=private.reviewed_bundle_row_sha256_v1(jsonb_build_array(p_action,p_target_project_ref,p_archive_sha256,p_packet));
  select * into receipt from private.exam_use_occurrence_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'occurrence_entry_request_reused' using errcode='40001'; end if;return receipt.result;
  end if;
  if not pg_try_advisory_xact_lock(hashtextextended('occurrence-entry-request:'||p_request_id,64006)) then raise exception 'occurrence_entry_busy' using errcode='55P03'; end if;
  select jsonb_agg(x-'beforeText') into keys from jsonb_array_elements(p_packet->'rows') x;
  locked_rows:=private.lock_exam_use_occurrences_v1(keys,p_target_project_ref);
  select * into receipt from private.exam_use_occurrence_archive_receipts where request_id=p_request_id;
  if found then
    if receipt.request_sha256<>request_hash then raise exception 'occurrence_entry_request_reused' using errcode='40001'; end if;return receipt.result;
  end if;
  for packet_row in select x from jsonb_array_elements(p_packet->'rows') x order by (x->>'releaseId')::uuid,(x->>'sourceRow')::int loop
    original:=(packet_row->>'beforeText')::jsonb;
    select * into m from private.exam_use_occurrence_archives where release_id=(packet_row->>'releaseId')::uuid and source_row=(packet_row->>'sourceRow')::int for update nowait;
    if not found then raise exception 'occurrence_entry_preparation_missing' using errcode='P0002'; end if;
    if m.target_project_ref<>p_target_project_ref or original->>'release_id' is distinct from m.release_id::text
      or (original->>'source_row')::int is distinct from m.source_row
      or private.reviewed_bundle_row_sha256_v1(original) is distinct from m.original_sha256
      or private.reviewed_bundle_row_sha256_v1(original->'package_entry_json') is distinct from m.entry_sha256 then
      raise exception 'occurrence_entry_archive_changed' using errcode='40001'; end if;
    select d into current_doc from jsonb_array_elements(locked_rows) d where d->>'release_id'=m.release_id::text and (d->>'source_row')::int=m.source_row;
    if private.reviewed_bundle_row_sha256_v1(current_doc-'package_entry_json') is distinct from m.identity_sha256
      or private.reviewed_bundle_row_sha256_v1(current_doc->'package_entry_json') is distinct from
        (case when m.state='compacted' then m.reference_sha256 else m.entry_sha256 end) then
      raise exception 'occurrence_entry_row_changed' using errcode='40001'; end if;
    reference:=private.exam_use_occurrence_entry_reference_v1(original);
    if private.reviewed_bundle_row_sha256_v1(reference) is distinct from m.reference_sha256 then raise exception 'occurrence_entry_reference_changed' using errcode='40001'; end if;
    next_doc:=jsonb_set(current_doc,'{package_entry_json}',case when p_action='compact' then reference else original->'package_entry_json' end);
    if current_doc is distinct from next_doc then
      insert into private.exam_use_occurrence_write_permits(backend_pid,transaction_id,release_id,source_row,before_sha256,after_sha256)
      values(pg_backend_pid(),txid_current(),m.release_id,m.source_row,private.reviewed_bundle_row_sha256_v1(current_doc),private.reviewed_bundle_row_sha256_v1(next_doc));
      update word_index.app_exam_use_occurrence set package_entry_json=next_doc->'package_entry_json' where release_id=m.release_id and source_row=m.source_row;
      if exists(select 1 from private.exam_use_occurrence_write_permits where backend_pid=pg_backend_pid() and transaction_id=txid_current() and release_id=m.release_id and source_row=m.source_row) then
        raise exception 'occurrence_entry_permit_not_consumed' using errcode='40001'; end if;
      changed:=changed+1;
    end if;
    update private.exam_use_occurrence_archives set state=case when p_action='compact' then 'compacted' else 'restored' end where release_id=m.release_id and source_row=m.source_row;
    select to_jsonb(o) into current_doc from word_index.app_exam_use_occurrence o where release_id=m.release_id and source_row=m.source_row;
    if private.reviewed_bundle_row_sha256_v1(current_doc) is distinct from private.reviewed_bundle_row_sha256_v1(next_doc)
      or private.reviewed_bundle_row_sha256_v1(private.restore_exam_use_occurrence_v1(current_doc)) is distinct from m.original_sha256 then
      raise exception 'occurrence_entry_roundtrip_failed' using errcode='40001'; end if;
  end loop;
  result:=jsonb_build_object('requestId',p_request_id,'action',p_action,'rows',jsonb_array_length(p_packet->'rows'),'changed',changed,'archiveHash',p_archive_sha256,'keysHash',private.reviewed_bundle_row_sha256_v1(keys));
  insert into private.exam_use_occurrence_archive_receipts(request_id,request_sha256,archive_sha256,result) values(p_request_id,request_hash,p_archive_sha256,result);
  return result;
end $$;

-- Preserve every current function contract and all earlier M01/M02/APP03/APP05 fixes.
do $consumers$
declare patch record; definition text;
begin
  for patch in select * from (values
    ('private.reassemble_exam_use_entries_v1(uuid,jsonb,integer[])','jsonb_agg(o.package_entry_json order by k.ordinal)','jsonb_agg(private.restore_exam_use_occurrence_v1(to_jsonb(o))->''package_entry_json'' order by k.ordinal)'),
    ('private.current_wrong_review_material_fingerprint_v1(uuid,jsonb,uuid[])','jsonb_agg(to_jsonb(o) order by o.vocab_entry_id)','jsonb_agg(private.restore_exam_use_occurrence_v1(to_jsonb(o)) order by o.vocab_entry_id)'),
    ('private.mock_wordbook_source_version(uuid,uuid,jsonb,text)','''occurrence'', to_jsonb(o), ''entry'', to_jsonb(e)','''occurrence'', private.restore_exam_use_occurrence_v1(to_jsonb(o)), ''entry'', to_jsonb(e)'),
    ('private.vocabulary_library_source_state_values_v1(uuid,uuid,uuid,text,uuid,text)','private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,to_jsonb(o))','private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,private.restore_exam_use_occurrence_v1(to_jsonb(o)))'),
    ('private.vocabulary_library_source_states_v1(uuid[])','private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,to_jsonb(o))','private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,private.restore_exam_use_occurrence_v1(to_jsonb(o)))'),
    ('private.import_vocabulary_library_core_v1(text,text)','eid:=o.vocab_entry_id; occurrence:=to_jsonb(o);','eid:=o.vocab_entry_id; occurrence:=private.restore_exam_use_occurrence_v1(to_jsonb(o));'),
    ('public.create_mock_wordbook_composition_v1(jsonb)','for original in select * from word_index.app_exam_use_occurrence where release_id=scope.source_release_id and unit_id=scope.source_unit_id order by source_row loop','for original in select * from word_index.app_exam_use_occurrence where release_id=scope.source_release_id and unit_id=scope.source_unit_id order by source_row loop
      original:=jsonb_populate_record(null::word_index.app_exam_use_occurrence,private.restore_exam_use_occurrence_v1(to_jsonb(original)));')
  ) v(signature,needle,replacement) loop
    definition:=pg_get_functiondef(patch.signature::regprocedure);
    if (length(definition)-length(replace(definition,patch.needle,'')))/length(patch.needle)<>1 then
      raise exception 'occurrence_entry_consumer_drift: %',patch.signature; end if;
    execute replace(definition,patch.needle,patch.replacement);
  end loop;
end $consumers$;

revoke all on function private.exam_use_occurrence_entry_fields_v1(),private.exam_use_occurrence_entry_candidates_v1(jsonb),
  private.exam_use_occurrence_entry_reference_v1(jsonb),private.restore_exam_use_occurrence_v1(jsonb),
  private.lock_exam_use_occurrences_v1(jsonb,text),private.list_exam_use_occurrence_candidates_v1(text,uuid),
  private.prepare_exam_use_occurrence_archive_v1(jsonb,text),private.guard_exam_use_occurrence_write_v1(),
  private.apply_exam_use_occurrence_archive_v1(uuid,text,text,text,jsonb) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;

