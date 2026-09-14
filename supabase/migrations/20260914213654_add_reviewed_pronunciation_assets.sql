begin;

-- APP-20260915-01. Source-reviewed stress is explicit, never relabelled as MW/CMU raw.
alter table public.vocab_pronunciation_identities_v2
  drop constraint vocab_pronunciation_identities_v2_stress_evidence_check,
  add constraint vocab_pronunciation_identities_v2_stress_evidence_check check (
    stress_evidence in ('selected_webster_lexical_stress','cmudict_lexical_stress',
      'cmudict_phrase_stress_rule_v1','reviewed_source_lexical_stress_v1'));

create table private.reviewed_pronunciation_asset_approvals_v1 (
  approval_id text primary key references private.reviewed_entry_resource_approvals_v1,
  previous_resource_sha256 text not null check(previous_resource_sha256 ~ '^[a-f0-9]{64}$'),
  assets_file_sha256 text not null check(assets_file_sha256 ~ '^[a-f0-9]{64}$'),
  assets_content_sha256 text not null check(assets_content_sha256 ~ '^[a-f0-9]{64}$'),
  asset_entry_count int not null check(asset_entry_count>0),
  missing_entry_count int not null check(missing_entry_count>=0),
  trimmed_entry_count int not null check(trimmed_entry_count>=0),
  check(asset_entry_count=missing_entry_count+trimmed_entry_count)
);
create table private.reviewed_pronunciation_assets_v1 (
  approval_id text not null references private.reviewed_pronunciation_asset_approvals_v1,
  source_row int not null check(source_row>0),
  entry_sha256 text not null check(entry_sha256 ~ '^[a-f0-9]{64}$'),
  asset_sha256 text not null check(asset_sha256 ~ '^[a-f0-9]{64}$'),
  identity_id text not null references public.vocab_pronunciation_identities_v2,
  payload jsonb not null,
  primary key(approval_id,source_row)
);
alter table private.reviewed_pronunciation_asset_approvals_v1 enable row level security;
alter table private.reviewed_pronunciation_assets_v1 enable row level security;
revoke all on private.reviewed_pronunciation_asset_approvals_v1,private.reviewed_pronunciation_assets_v1
  from public,anon,authenticated,service_role;
create trigger reviewed_pronunciation_assets_immutable before update or delete
  on private.reviewed_pronunciation_assets_v1 for each row execute function private.guard_reviewed_entry_resources_v1();

create function private.import_reviewed_pronunciation_assets_v1(p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_text::jsonb; ap private.reviewed_pronunciation_asset_approvals_v1%rowtype;
  approved private.reviewed_entry_resource_approvals_v1%rowtype;
  previous private.reviewed_entry_resource_releases_v1%rowtype;
  base private.reviewed_exam_releases%rowtype; target private.reviewed_exam_entries%rowtype;
  prior private.reviewed_entry_resources_v1%rowtype; prior_identity jsonb;
  x jsonb; i jsonb; q jsonb; ov jsonb; previous_ov jsonb; selected_audio text;
  ids int[]:='{}'; new_count int:=0; trim_count int:=0;
  audio_fields text[]:=array['identity_id','pronunciation_variant_id','request_sha256','audio_sha256',
    'byte_count','storage_object_key','identity_content_sha256','approval_evidence'];
begin
  select a.* into ap from private.reviewed_pronunciation_asset_approvals_v1 a
    join private.reviewed_entry_resource_approvals_v1 r using(approval_id)
    where a.approval_id=b->>'approval_id' and r.target_project_ref=private.request_supabase_project_ref_v1()
      and a.assets_file_sha256=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex')
      and a.assets_content_sha256=private.reviewed_exam_sha256_v1(b-'content_sha256')
      and a.assets_content_sha256=b->>'content_sha256';
  if not found then raise exception 'reviewed_audio_not_approved' using errcode='42501'; end if;
  select * into strict approved from private.reviewed_entry_resource_approvals_v1 where approval_id=ap.approval_id;
  select r.* into strict base from private.reviewed_exam_releases r join public.vocab_datasets d on d.id=r.dataset_id
    where d.dataset_key=approved.dataset_key and r.content_sha256=approved.base_content_sha256 and r.status='active';
  perform pg_advisory_xact_lock(hashtextextended('reviewed-resources:'||base.release_id::text,0));
  select * into strict previous from private.reviewed_entry_resource_releases_v1
    where base_release_id=base.release_id and content_sha256=ap.previous_resource_sha256 and status='active';
  if b->>'schema_version' is distinct from 'reviewed_pronunciation_assets_v1'
    or jsonb_typeof(b->'entries') is distinct from 'array'
    or jsonb_array_length(b->'entries')<>ap.asset_entry_count
    or nullif(b#>>'{review,evidence_sha256}','') is null
    or nullif(b#>>'{review,reviewer}','') is null
  then raise exception 'reviewed_audio_bundle_invalid'; end if;
  for x in select value from jsonb_array_elements(b->'entries') loop
    if (x->>'source_row')::int=any(ids) or x->>'asset_sha256' is distinct from private.reviewed_exam_sha256_v1(x-'asset_sha256')
    then raise exception 'reviewed_audio_asset_hash_invalid'; end if;
    ids:=array_append(ids,(x->>'source_row')::int);
    select * into strict target from private.reviewed_exam_entries where release_id=base.release_id and source_row=(x->>'source_row')::int;
    select * into strict prior from private.reviewed_entry_resources_v1 where release_id=previous.release_id and vocab_entry_id=target.vocab_entry_id;
    if target.entry_sha256 is distinct from x->>'entry_sha256'
      or x->>'headword' is distinct from target.payload->>'headword'
      or not exists(select 1 from public.vocab_entries v where v.id=target.vocab_entry_id
        and lower(v.row_sha256)=target.entry_sha256 and v.headword=x->>'headword')
    then raise exception 'reviewed_audio_target_mismatch'; end if;
    i:=x->'identity'; q:=x->'quality'; ov:=x->'display_override';
    previous_ov:=prior.payload#>'{pronunciation,donor,display_override}';
    selected_audio:=case when i->>'audio_provider'='merriam_webster' then i->>'official_audio_url'
      else '/storage/v1/object/public/'||(i->>'storage_bucket')||'/'||(i->>'storage_object_key') end;
    if jsonb_typeof(i) is distinct from 'object'
      or i->>'identity_content_sha256' is distinct from upper(private.reviewed_exam_sha256_v1(i-'identity_content_sha256'))
      or i->'playback_enabled' is distinct from 'true'::jsonb or i->'display_enabled' is distinct from 'true'::jsonb
      or nullif(x#>>'{source,evidence_sha256}','') is null
      or nullif(x#>>'{source,review_reason}','') is null
    then raise exception 'reviewed_audio_identity_invalid'; end if;
    if x->>'kind'='fill_missing' then
      new_count:=new_count+1;
      if prior.pronunciation_identity_id is not null or prior.payload#>>'{pronunciation,status}'<>'unavailable'
        or i->>'headword' is distinct from x->>'headword'
        or i->>'lexical_pos' is distinct from target.payload->>'lexical_pos'
        or x->>'resource_lexical_pos' is distinct from target.payload->>'lexical_pos'
        or x->>'prior_identity_id' is not null or x->'display_override' is distinct from 'null'::jsonb
        or x->>'display_ko' is distinct from i->>'display_pronunciation_ko'
      then raise exception 'reviewed_audio_missing_scope_invalid'; end if;
    elsif x->>'kind'='trim_existing' then
      trim_count:=trim_count+1;
      select to_jsonb(p)-'imported_at' into strict prior_identity from public.vocab_pronunciation_identities_v2 p
        where p.identity_id=prior.pronunciation_identity_id;
      if x->>'prior_identity_id' is distinct from prior.pronunciation_identity_id
        or prior_identity->>'audio_provider' is distinct from 'google_cloud_text_to_speech'
        or (i-audio_fields) is distinct from (prior_identity-audio_fields)
        or q->>'raw_sha256' is distinct from prior_identity->>'audio_sha256'
        or x->>'display_ko' is distinct from prior.payload#>>'{pronunciation,display_ko}'
        or coalesce((q->>'trim_start_ms')::numeric,0)<=0
        or x->>'resource_lexical_pos' is distinct from prior.payload#>>'{pronunciation,lexical_pos}'
        or (case when jsonb_typeof(ov)='object' then ov-array['variant_id','audio_key','source_file_sha256','manifest_sha256'] else ov end)
           is distinct from (case when jsonb_typeof(previous_ov)='object' then previous_ov-array['variant_id','audio_key','source_file_sha256','manifest_sha256'] else previous_ov end)
      then raise exception 'reviewed_audio_trim_content_changed'; end if;
    else raise exception 'reviewed_audio_kind_invalid'; end if;
    if ov is distinct from 'null'::jsonb and (jsonb_typeof(ov) is distinct from 'object'
      or ov->>'variant_id' is distinct from i->>'pronunciation_variant_id'
      or ov->>'audio_key' is distinct from selected_audio
      or ov->>'display_ko' is distinct from x->>'display_ko'
      or not coalesce(private.valid_vocab_pronunciation_segments_v2(ov->>'display_ko',ov->'segments'),false)
      or not coalesce(ov->>'source_file_sha256' ~ '^[a-f0-9]{64}$',false)
      or not coalesce(ov->>'manifest_sha256' ~ '^[a-f0-9]{64}$',false))
    then raise exception 'reviewed_audio_display_override_invalid'; end if;
    if i->>'audio_provider'='google_cloud_text_to_speech' then
      if q->>'processing_version' is distinct from 'leading-silence-guard-v1'
        or q->>'status' is distinct from 'passed'
        or q->>'audio_sha256' is distinct from i->>'audio_sha256'
        or q->'byte_count' is distinct from i->'byte_count'
        or q->'min_frequency_hz' is distinct from '150'::jsonb
        or q->'threshold_dbfs' is distinct from '-60'::jsonb
        or q->'frame_ms' is distinct from '20'::jsonb or q->'hop_ms' is distinct from '10'::jsonb
        or q->'consecutive_frames' is distinct from '2'::jsonb
        or q->'analysis_only_filter' is distinct from 'true'::jsonb
        or q->'keep_ms' is distinct from '80'::jsonb or q->'end_trim_ms' is distinct from '0'::jsonb
        or q->'max_leading_ms' is distinct from '160'::jsonb
        or jsonb_typeof(q#>'{after,leading_ms}') is distinct from 'number'
        or (q#>>'{after,leading_ms}')::numeric not between 0 and 160
        or jsonb_typeof(q#>'{before,leading_ms}') is distinct from 'number'
        or jsonb_typeof(q->'trim_start_ms') is distinct from 'number'
        or (q#>>'{before,leading_ms}')::numeric < 0
        or (q->>'trim_start_ms')::numeric is distinct from (case when (q#>>'{before,leading_ms}')::numeric>160 then (q#>>'{before,leading_ms}')::numeric-80 else 0 end)
      then raise exception 'reviewed_audio_quality_invalid'; end if;
      perform private.register_vocab_pronunciation_tts_asset_batch_v2(jsonb_build_array(jsonb_build_object(
        'request_sha256',i->'request_sha256','audio_sha256',i->'audio_sha256','byte_count',i->'byte_count',
        'storage_bucket',i->'storage_bucket','storage_object_key',i->'storage_object_key','profile_id',i->'profile_id',
        'model',i->'model','voice',i->'voice','storage_verified',true)));
    elsif i->>'audio_provider'='merriam_webster' then
      if x->>'kind'<>'fill_missing' or x#>>'{source,official_audio_url}' is distinct from i->>'official_audio_url'
        or nullif(x#>>'{source,raw_sha256}','') is null or nullif(x#>>'{source,locator}','') is null
      then raise exception 'reviewed_audio_official_source_invalid'; end if;
    else raise exception 'reviewed_audio_provider_invalid'; end if;
    insert into public.vocab_pronunciation_identities_v2
      select r.* from jsonb_populate_record(null::public.vocab_pronunciation_identities_v2,
        i||jsonb_build_object('imported_at',now())) r on conflict(identity_id) do nothing;
    if not exists(select 1 from public.vocab_pronunciation_identities_v2 p
      where p.identity_id=i->>'identity_id' and to_jsonb(p)-'imported_at'=i)
    then raise exception 'reviewed_audio_identity_conflict'; end if;
    insert into private.reviewed_pronunciation_assets_v1 values(ap.approval_id,(x->>'source_row')::int,
      x->>'entry_sha256',x->>'asset_sha256',i->>'identity_id',x) on conflict do nothing;
    if not exists(select 1 from private.reviewed_pronunciation_assets_v1 a where a.approval_id=ap.approval_id
      and a.source_row=(x->>'source_row')::int and a.payload=x)
    then raise exception 'reviewed_audio_asset_conflict'; end if;
  end loop;
  if new_count<>ap.missing_entry_count or trim_count<>ap.trimmed_entry_count then raise exception 'reviewed_audio_count_mismatch'; end if;
  return jsonb_build_object('entries',cardinality(ids),'missing',new_count,'trimmed',trim_count);
end; $$;

create function private.reviewed_resource_pronunciation_v2(c jsonb)
returns text language plpgsql stable security definer set search_path='' as $$
declare d jsonb:=c->'pronunciation_donor'; x private.reviewed_pronunciation_assets_v1%rowtype;
  i public.vocab_pronunciation_identities_v2%rowtype;
begin
  if d->>'kind' is distinct from 'reviewed_asset' then return private.school_handout_pronunciation_v1(c); end if;
  select * into strict x from private.reviewed_pronunciation_assets_v1
    where approval_id=d->>'approval_id' and source_row=(d->>'asset_source_row')::int
      and asset_sha256=d->>'asset_sha256' and entry_sha256=c->>'entry_row_sha256';
  select * into strict i from public.vocab_pronunciation_identities_v2 where identity_id=x.identity_id;
  if x.payload->>'headword' is distinct from c->>'headword'
    or d->>'identity_id' is distinct from i.identity_id
    or d->>'identity_content_sha256' is distinct from lower(i.identity_content_sha256)
    or d->>'identity_headword' is distinct from i.headword
    or d->>'identity_lexical_pos' is distinct from i.lexical_pos
    or c->>'lexical_pos' is distinct from x.payload->>'resource_lexical_pos'
    or d->>'variant_id' is distinct from i.pronunciation_variant_id
    or d->>'audio_key' is distinct from (case when i.audio_provider='merriam_webster' then i.official_audio_url
      else '/storage/v1/object/public/'||i.storage_bucket||'/'||i.storage_object_key end)
    or d->'display_override' is distinct from x.payload->'display_override'
    or c->>'pronunciation_ko' is distinct from x.payload->>'display_ko'
    or not i.playback_enabled or not i.display_enabled
  then raise exception 'reviewed_audio_reference_mismatch'; end if;
  return i.identity_id;
end; $$;

-- Only this resource importer admits new assets. Original school imports keep their donor rules.
do $migration$
declare fn text; old_fragment text;
begin
  fn:=pg_get_functiondef('private.import_reviewed_entry_resources_v1(text)'::regprocedure);
  old_fragment:='if p->>''lexical_pos'' is distinct from c->>''lexical_pos'' then';
  if position(old_fragment in fn)=0 or position('identity_value:=private.school_handout_pronunciation_v1(c);' in fn)=0
  then raise exception 'reviewed_audio_importer_anchor_changed'; end if;
  fn:=replace(fn,old_fragment,'if p#>>''{donor,kind}'' is distinct from ''reviewed_asset'' and p->>''lexical_pos'' is distinct from c->>''lexical_pos'' then');
  fn:=replace(fn,'identity_value:=private.school_handout_pronunciation_v1(c);',
    'if p#>>''{donor,kind}''=''reviewed_asset'' and p#>>''{donor,approval_id}'' is distinct from b->>''approval_id'' then raise exception ''reviewed_audio_approval_scope_mismatch''; end if; identity_value:=private.reviewed_resource_pronunciation_v2(c);');
  execute fn;
end; $migration$;

create function private.replace_reviewed_entry_resources_with_assets_v1(p_resources text,p_assets text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_resources::jsonb; a jsonb:=p_assets::jsonb;
  ap private.reviewed_pronunciation_asset_approvals_v1%rowtype;
  approved private.reviewed_entry_resource_approvals_v1%rowtype;
  previous private.reviewed_entry_resource_releases_v1%rowtype;
  base private.reviewed_exam_releases%rowtype; prior private.reviewed_entry_resources_v1%rowtype;
  x jsonb; asset private.reviewed_pronunciation_assets_v1%rowtype; result jsonb; changed_count int:=0;
begin
  select xap.* into ap from private.reviewed_pronunciation_asset_approvals_v1 xap
    join private.reviewed_entry_resource_approvals_v1 r using(approval_id)
    where xap.approval_id=b->>'approval_id' and xap.approval_id=a->>'approval_id'
      and r.target_project_ref=private.request_supabase_project_ref_v1()
      and xap.assets_file_sha256=encode(extensions.digest(convert_to(p_assets,'UTF8'),'sha256'),'hex')
      and xap.assets_content_sha256=private.reviewed_exam_sha256_v1(a-'content_sha256');
  if not found then raise exception 'reviewed_audio_not_approved' using errcode='42501'; end if;
  select * into strict approved from private.reviewed_entry_resource_approvals_v1 where approval_id=ap.approval_id;
  select r.* into strict base from private.reviewed_exam_releases r join public.vocab_datasets d on d.id=r.dataset_id
    where d.dataset_key=approved.dataset_key and r.content_sha256=approved.base_content_sha256 and r.status='active';
  perform pg_advisory_xact_lock(hashtextextended('reviewed-resources:'||base.release_id::text,0));
  if exists(select 1 from private.reviewed_entry_resource_releases_v1 r where r.release_key=b->>'release_key'
    and r.content_sha256=approved.content_sha256 and r.status='active') then
    return private.import_reviewed_entry_resources_v1(p_resources);
  end if;
  select * into strict previous from private.reviewed_entry_resource_releases_v1
    where base_release_id=base.release_id and content_sha256=ap.previous_resource_sha256 and status='active';
  perform private.import_reviewed_pronunciation_assets_v1(p_assets);
  if jsonb_array_length(b->'entries')<>approved.entry_count then raise exception 'reviewed_audio_resource_count_changed'; end if;
  for prior in select * from private.reviewed_entry_resources_v1 where release_id=previous.release_id loop
    select value into strict x from jsonb_array_elements(b->'entries') where (value->>'source_row')::int=(prior.payload->>'source_row')::int;
    if x=prior.payload then continue; end if;
    changed_count:=changed_count+1;
    select * into strict asset from private.reviewed_pronunciation_assets_v1 where approval_id=ap.approval_id
      and source_row=(x->>'source_row')::int and entry_sha256=prior.entry_sha256;
    if x-array['pronunciation','availability'] is distinct from prior.payload-array['pronunciation','availability']
      or (x->'availability')-'pronunciation' is distinct from (prior.payload->'availability')-'pronunciation'
      or x#>'{availability,pronunciation}' is distinct from 'true'::jsonb
      or x#>>'{pronunciation,status}' is distinct from 'linked'
      or x#>>'{pronunciation,donor,kind}' is distinct from 'reviewed_asset'
      or x#>>'{pronunciation,donor,asset_sha256}' is distinct from asset.asset_sha256
      or (asset.payload->>'kind'='trim_existing' and (x->'pronunciation')-'donor' is distinct from (prior.payload->'pronunciation')-'donor')
    then raise exception 'reviewed_audio_resource_content_changed'; end if;
  end loop;
  if changed_count<>ap.asset_entry_count then raise exception 'reviewed_audio_change_count_mismatch'; end if;
  update private.reviewed_entry_resource_releases_v1 set status='retired' where release_id=previous.release_id;
  result:=private.import_reviewed_entry_resources_v1(p_resources);
  return result||jsonb_build_object('changed',changed_count,'previous_release_id',previous.release_id);
end; $$;
revoke all on function private.import_reviewed_pronunciation_assets_v1(text),
  private.reviewed_resource_pronunciation_v2(jsonb),private.replace_reviewed_entry_resources_with_assets_v1(text,text)
  from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
