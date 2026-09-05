begin;

-- Source files keep their original Preview-only provenance. This separate,
-- immutable allowlist records the user's Production approval, not dictionary approval.
create table private.simseok_production_approvals_v1 (
  dataset_key text primary key,
  exam_file_sha256 text not null check (exam_file_sha256 ~ '^[0-9a-f]{64}$'),
  exam_package_version text not null check (exam_package_version ~ '^[0-9a-f]{64}$'),
  question_file_sha256 text not null check (question_file_sha256 ~ '^[0-9a-f]{64}$'),
  occurrence_count integer not null check (occurrence_count > 0),
  item_count integer not null check (item_count > 0),
  expanded_count integer not null check (expanded_count >= item_count),
  source_version text not null check (source_version in ('v2','v3')),
  approval_id text not null default 'DEPLOY-20260905-01'
    check (approval_id = 'DEPLOY-20260905-01'),
  target_project_ref text not null default 'xdxhswjgksukjmpbzqgz'
    check (target_project_ref = 'xdxhswjgksukjmpbzqgz')
);
insert into private.simseok_production_approvals_v1
(dataset_key, exam_file_sha256, exam_package_version, question_file_sha256,
 occurrence_count, item_count, expanded_count, source_version) values
('simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1', 'c50ab74358a9c17f85b45a9f998bb68bf879386f6121817624dc9d3e5dfec5c5', '27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb', 'f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74', 320, 358, 358, 'v2'),
('simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1', '4a0970994423cd9d412c26824a90c1b13fb16a25422d16ca3ee8de843910eba8', 'd86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0', '5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af', 189, 206, 206, 'v2'),
('simseok-g11-sem2-mid-mock-v1', '42a35b8f02be69664d0c9f80d7783b80d0c76f62bce5ad965f94a9b12f355155', '120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c', 'd64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e', 278, 191, 192, 'v2'),
('simseok-g10-sem2-mid-adjective-500-v1', '34f3d61874c971e23ddd971a1b7311c7f37d34e33e28555dec772da3bf811514', '95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e', '46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed', 500, 766, 766, 'v2'),
('simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1', '2bd1365075c0a7d3c4c0c47f397b385e90c0b5ea7d98e8ebf6798d0b2d110a54', '4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38', '16d754616e2945c603eb0d4c87f68d51ab59b2838bc290363aa23dafc2d98aeb', 111, 117, 119, 'v3'),
('simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1', '744d4f60b2bf9795f319a942f3ff38b2e276fea031867814039e49237a9ce086', '5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf', '536f2beedec9b4a428cd87a11c7c4df310e890905184499e2ce35ffe81088cc5', 111, 128, 130, 'v3');

create table private.simseok_production_receipts_v1 (
  dataset_key text primary key references private.simseok_production_approvals_v1(dataset_key),
  dataset_id uuid not null unique references public.vocab_datasets(id),
  exam_release_id uuid not null references word_index.app_exam_use_release(release_id),
  question_release_id uuid not null references word_index.app_canonical_question_preview_release(release_id),
  status text not null check (status in ('staged','active')),
  staged_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz
);
alter table private.simseok_production_approvals_v1 enable row level security;
alter table private.simseok_production_receipts_v1 enable row level security;
revoke all on private.simseok_production_approvals_v1,
  private.simseok_production_receipts_v1 from public, anon, authenticated, service_role;

create or replace function private.guard_simseok_exam_use_release_preview_v1()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.dataset_key like 'simseok-%'
    and private.request_supabase_project_ref_v1() is distinct from 'wojxpruvbjzbhrpmsbuy'
    and not coalesce((
      private.request_supabase_project_ref_v1() = 'xdxhswjgksukjmpbzqgz'
      and exists (
        select 1 from private.simseok_production_approvals_v1 a
        where a.dataset_key = new.dataset_key
          and a.exam_package_version = new.package_version
          and not new.common_dictionary_release_allowed
      )
    ),false)
  then
    raise exception 'simseok_exam_use_release_not_approved' using errcode = '42501';
  end if;
  return new;
end;
$$;

-- Clone the already-tested content validators. Only the function name and the
-- entry-point project guard change; byte hashes, source safety flags, row joins
-- and count/grammar checks are unchanged. No Preview entry point is relaxed.
do $migration$
declare
  source_name text;
  target_name text;
  definition text;
  old_guard text := E'if private.request_supabase_project_ref_v1() is distinct from\n      ''wojxpruvbjzbhrpmsbuy''';
begin
  for source_name, target_name in select * from (values
    ('private.import_simseok_combined_question_preview_release_v2',
     'private.import_simseok_production_question_v2'),
    ('private.stage_simseok_g10_scope_correction_question_release_v3',
     'private.import_simseok_production_question_v3')
  ) as names(source_name,target_name)
  loop
    definition := replace(pg_get_functiondef((source_name || '(text)')::regprocedure), E'\r\n', E'\n');
    if (length(definition) - length(replace(definition,old_guard,''))) / length(old_guard) <> 1 then
      raise exception 'production_import_clone_guard_changed: %', source_name;
    end if;
    definition := replace(definition, source_name || '(', target_name || '(');
    definition := replace(definition,old_guard,
      E'if private.request_supabase_project_ref_v1() is distinct from\n      ''xdxhswjgksukjmpbzqgz''');
    execute definition;
    execute format('revoke all on function %s(text) from public, anon, authenticated, service_role',target_name);
  end loop;
end;
$migration$;

create function public.import_approved_simseok_production_pair_v1(
  p_exam_text text, p_question_text text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  approval private.simseok_production_approvals_v1%rowtype;
  receipt private.simseok_production_receipts_v1%rowtype;
  dataset_id_value uuid;
  exam_release_id_value uuid;
  question_release_id_value uuid;
  imported jsonb;
  package jsonb;
begin
  if private.request_supabase_project_ref_v1() is distinct from 'xdxhswjgksukjmpbzqgz' then
    raise exception 'production_project_mismatch' using errcode = '42501';
  end if;
  if p_exam_text is null or p_question_text is null then
    raise exception 'missing_production_package' using errcode = '22023';
  end if;
  package := p_exam_text::jsonb;
  select * into approval from private.simseok_production_approvals_v1 a
    where a.dataset_key = package ->> 'dataset_key';
  if not found
    or encode(extensions.digest(convert_to(p_exam_text,'UTF8'),'sha256'),'hex')
       is distinct from approval.exam_file_sha256
    or encode(extensions.digest(convert_to(p_question_text,'UTF8'),'sha256'),'hex')
       is distinct from approval.question_file_sha256
    or lower(package ->> 'package_version') is distinct from approval.exam_package_version
    or (p_question_text::jsonb ->> 'dataset_key') is distinct from approval.dataset_key
  then
    raise exception 'production_package_not_approved' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('DEPLOY-20260905-01',0));
  select * into receipt from private.simseok_production_receipts_v1 r
    where r.dataset_key=approval.dataset_key;
  if found then
    return jsonb_build_object('datasetId',receipt.dataset_id,'status',receipt.status,
      'idempotent',true,'writes',0,'targetEnvironment','production');
  end if;
  -- Never take over a pre-existing dataset without this import receipt.
  if exists(select 1 from public.vocab_datasets where dataset_key=approval.dataset_key) then
    raise exception 'production_dataset_already_exists_without_receipt' using errcode='55000';
  end if;
  imported := private.import_app_exam_use_package_v1(package);
  dataset_id_value := (imported ->> 'datasetId')::uuid;
  select release_id into strict exam_release_id_value from word_index.app_exam_use_release
    where dataset_id=dataset_id_value and package_version=approval.exam_package_version and status='active';
  if approval.source_version='v3' then
    perform private.catalog_simseok_g10_scope_correction_dataset_v3(dataset_id_value,false);
    perform private.import_simseok_production_question_v3(p_question_text);
  else
    perform private.catalog_simseok_sem2_dataset_v1(dataset_id_value);
    perform private.import_simseok_production_question_v2(p_question_text);
  end if;
  select release_id into strict question_release_id_value
    from word_index.app_canonical_question_preview_release
    where dataset_id=dataset_id_value and package_file_sha256=approval.question_file_sha256;
  if (select count(*) from word_index.app_exam_use_occurrence where release_id=exam_release_id_value)
      <> approval.occurrence_count
    or (select count(*) from word_index.app_canonical_question_preview_item
      where release_id=question_release_id_value) <> approval.expanded_count
  then raise exception 'production_import_count_mismatch'; end if;
  update public.vocab_datasets set status='pending_review',is_active=false where id=dataset_id_value;
  update public.vocab_dataset_catalog set is_assignable=false where dataset_id=dataset_id_value;
  update word_index.app_canonical_question_preview_release set status='loading'
    where release_id=question_release_id_value;
  insert into private.simseok_production_receipts_v1
    (dataset_key,dataset_id,exam_release_id,question_release_id,status)
    values (approval.dataset_key,dataset_id_value,exam_release_id_value,question_release_id_value,'staged');
  return jsonb_build_object('datasetId',dataset_id_value,'status','staged',
    'occurrences',approval.occurrence_count,'expanded',approval.expanded_count,
    'targetEnvironment','production','approvalId',approval.approval_id,'idempotent',false);
end;
$$;
alter function public.import_approved_simseok_production_pair_v1(text,text) set statement_timeout = '60s';
revoke all on function public.import_approved_simseok_production_pair_v1(text,text)
  from public, anon, authenticated, service_role;
grant execute on function public.import_approved_simseok_production_pair_v1(text,text) to service_role;

create function public.import_approved_simseok_production_audio_v1(p_package_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  package jsonb;
  expected_count integer;
  file_sha text;
  receipt private.simseok_production_receipts_v1%rowtype;
  inserted_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from 'xdxhswjgksukjmpbzqgz' then
    raise exception 'production_project_mismatch' using errcode='42501';
  end if;
  file_sha := encode(extensions.digest(convert_to(p_package_text,'UTF8'),'sha256'),'hex');
  case file_sha
    when '45d10b6dbbc968859e33cf55a217de2a8ff80c654c38d46ea1c3b06e7f2fe190' then expected_count:=12;
    when '0cb5b75d3f74a64df2aa813a34e38709396863477f2f4152c776867c199e7422' then expected_count:=19;
    else raise exception 'production_audio_package_not_approved' using errcode='22023';
  end case;
  package := p_package_text::jsonb;
  perform pg_advisory_xact_lock(hashtextextended('DEPLOY-20260905-01',0));
  select * into strict receipt from private.simseok_production_receipts_v1
    where dataset_key=package->>'dataset_key';
  if (select count(*) from jsonb_array_elements(package->'entries') input(item)
      join word_index.app_exam_use_occurrence o on o.release_id=receipt.exam_release_id
        and o.occurrence_id=item->>'occurrence_id' and o.dictionary_id=item->>'dictionary_id'
        and o.source_row=(item->>'source_row')::integer
      join public.vocab_entries e on e.id=o.vocab_entry_id and e.dataset_id=receipt.dataset_id
        and e.row_sha256=item->>'entry_row_sha256' and e.headword_normalized=item->>'headword_normalized'
    ) <> expected_count then raise exception 'production_audio_binding_mismatch'; end if;
  if exists (select 1 from jsonb_array_elements(package->'entries') input(item)
      join public.vocab_entry_pronunciations p on p.dataset_id=receipt.dataset_id
        and p.source_row=(item->>'source_row')::integer
      where p.content_sha256 is distinct from item->>'content_sha256'
        or p.source_package_version is distinct from package->>'package_version'
        or p.selected_audio_url is distinct from item->>'selected_audio_url'
        or not p.listening_enabled
    ) then raise exception 'production_audio_existing_row_conflict'; end if;
  insert into public.vocab_entry_pronunciations (
    vocab_entry_id,dataset_id,source_row,entry_row_sha256,headword_normalized,
    provider,status,review_status,needs_review,listening_enabled,selected_variant_id,
    selected_audio_url,selected_sound_audio,selected_pos,selected_mw_notation,
    variants,raw_provenance,source_package_version,content_sha256
  ) select o.vocab_entry_id,receipt.dataset_id,o.source_row,item->>'entry_row_sha256',
    item->>'headword_normalized','merriam_webster','raw_first_variant_unreviewed',
    'raw_unreviewed',true,true,item->>'selected_variant_id',item->>'selected_audio_url',
    item->>'selected_sound_audio',item->>'selected_pos',item->>'selected_mw_notation',
    item->'variants',item->'raw_provenance',package->>'package_version',item->>'content_sha256'
  from jsonb_array_elements(package->'entries') input(item)
  join word_index.app_exam_use_occurrence o on o.release_id=receipt.exam_release_id
    and o.occurrence_id=item->>'occurrence_id'
  on conflict(vocab_entry_id) do nothing;
  get diagnostics inserted_count = row_count;
  if (select count(*) from public.vocab_entry_pronunciations where dataset_id=receipt.dataset_id
    and source_package_version=package->>'package_version' and listening_enabled) <> expected_count
  then raise exception 'production_audio_readback_mismatch'; end if;
  return jsonb_build_object('verifiedRows',expected_count,'writes',inserted_count,'approvalId','DEPLOY-20260905-01');
end;
$$;
revoke all on function public.import_approved_simseok_production_audio_v1(text) from public,anon,authenticated,service_role;
grant execute on function public.import_approved_simseok_production_audio_v1(text) to service_role;

create function public.activate_approved_simseok_production_v1()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from 'xdxhswjgksukjmpbzqgz' then
    raise exception 'production_project_mismatch' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('DEPLOY-20260905-01',0));
  if (select count(*) from private.simseok_production_receipts_v1) <> 6 or exists (
    select 1 from private.simseok_production_receipts_v1 r
    join private.simseok_production_approvals_v1 a using(dataset_key)
    join word_index.app_exam_use_release e on e.release_id=r.exam_release_id
    join word_index.app_canonical_question_preview_release q on q.release_id=r.question_release_id
    where e.dataset_id<>r.dataset_id or q.dataset_id<>r.dataset_id
      or e.package_version<>a.exam_package_version or q.package_file_sha256<>a.question_file_sha256
      or q.exam_use_release_id<>e.release_id or e.status<>'active'
      or (select count(*) from word_index.app_exam_use_occurrence o where o.release_id=e.release_id)<>a.occurrence_count
      or (select count(*) from word_index.app_canonical_question_preview_item i where i.release_id=q.release_id)<>a.expanded_count
      or (select count(distinct i.question_item_id) from word_index.app_canonical_question_preview_item i
        where i.release_id=q.release_id)<>a.item_count
  ) then raise exception 'production_release_readback_mismatch'; end if;
  if (select count(*) from public.vocab_entry_pronunciations p
    join private.simseok_production_receipts_v1 r on r.dataset_id=p.dataset_id
    where r.dataset_key='simseok-g11-sem2-mid-mock-v1' and p.listening_enabled
      and p.source_package_version in (
        '9CCB9A45F2FAA93F095AD9FBEE51DB7F9CDC0ED4F344ED64B423C14253F7D232',
        'BCA0F059C35015DA3203AD1DD139EBC007E58E6C0734D5341F0801F56AEBA20D'
      )) <> 31 then raise exception 'production_audio_not_ready'; end if;
  update public.vocab_datasets set status='ready',is_active=true
    where id in(select dataset_id from private.simseok_production_receipts_v1) and (status<>'ready' or not is_active);
  update public.vocab_dataset_catalog c set is_assignable=true,
    metadata=c.metadata || jsonb_build_object('targetEnvironment','production','productionAllowed',true,
      'productionApprovalId','DEPLOY-20260905-01','sourceTargetEnvironment','preview',
      'commonDictionaryApproved',false)
    where c.dataset_id in(select dataset_id from private.simseok_production_receipts_v1)
      and (not c.is_assignable or c.metadata->>'productionApprovalId' is distinct from 'DEPLOY-20260905-01');
  update word_index.app_canonical_question_preview_release set status='active',activated_at_utc=clock_timestamp()
    where release_id in(select question_release_id from private.simseok_production_receipts_v1)
      and status<>'active';
  update private.simseok_production_receipts_v1 set status='active',activated_at=clock_timestamp()
    where status<>'active';
  return jsonb_build_object('sets',6,'occurrences',1509,'questions',1766,'expanded',1771,
    'targetEnvironment','production','approvalId','DEPLOY-20260905-01');
end;
$$;
revoke all on function public.activate_approved_simseok_production_v1() from public,anon,authenticated,service_role;
grant execute on function public.activate_approved_simseok_production_v1() to service_role;

create function private.canonical_question_release_runtime_allowed_v1(p_release_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    private.request_supabase_project_ref_v1()='wojxpruvbjzbhrpmsbuy'
    or (private.request_supabase_project_ref_v1()='xdxhswjgksukjmpbzqgz' and exists(
      select 1 from private.simseok_production_receipts_v1 r
      join private.simseok_production_approvals_v1 a using(dataset_key)
      join word_index.app_canonical_question_preview_release q on q.release_id=r.question_release_id
      join word_index.app_exam_use_release e on e.release_id=r.exam_release_id
      where r.status='active' and r.question_release_id=p_release_id
        and q.dataset_id=r.dataset_id and e.dataset_id=r.dataset_id
        and q.exam_use_release_id=e.release_id
        and q.package_file_sha256=a.question_file_sha256
        and e.package_version=a.exam_package_version
    )),false);
$$;
revoke all on function private.canonical_question_release_runtime_allowed_v1(uuid)
  from public,anon,authenticated,service_role;

-- Preserve existing API names so Preview and old source IDs remain compatible.
-- Every question read and final writer must pass the deployment approval join.
do $migration$
declare
  signature text;
  definition text;
  changed text;
  old_guard text := E'private.request_supabase_project_ref_v1() is distinct from\n      ''wojxpruvbjzbhrpmsbuy''';
  filter_text text := 'and not release.production_apply_allowed';
begin
  for signature in select unnest(array[
    'public.list_active_canonical_question_preview_v1(uuid,uuid[],text)',
    'public.get_canonical_assignment_preview_result_v1(uuid,text)',
    'public.create_bulk_canonical_assignments_preview_v1(uuid,text,jsonb)'
  ]) loop
    definition := replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    if (length(definition)-length(replace(definition,old_guard,''))) / length(old_guard) <> 1 then
      raise exception 'canonical_runtime_project_guard_changed: %',signature;
    end if;
    changed := replace(definition,old_guard,
      'coalesce(private.request_supabase_project_ref_v1(),'''') not in (''wojxpruvbjzbhrpmsbuy'',''xdxhswjgksukjmpbzqgz'')');
    execute changed;
  end loop;
  for signature in
    select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where (n.nspname,p.proname) in (
      ('public','list_active_canonical_question_preview_v1'),
      ('private','create_assignment_with_canonical_question_bank_preview_v1'),
      ('public','list_assignment_question_mode_availability_v1')
    )
  loop
    definition := replace(pg_get_functiondef(signature::regprocedure),E'\r\n',E'\n');
    if (length(definition)-length(replace(definition,filter_text,''))) / length(filter_text) <> 1 then
      raise exception 'canonical_runtime_approval_filter_changed: %',signature;
    end if;
    execute replace(definition,filter_text,filter_text ||
      E'\n      and private.canonical_question_release_runtime_allowed_v1(release.release_id)');
  end loop;
end;
$migration$;
commit;
