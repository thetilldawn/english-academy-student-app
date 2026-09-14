begin;

-- Reserve monthly sources for the reviewed importer. Keep all existing book
-- imports on their existing interface; only this private core accepts the new keys.
alter function private.import_app_exam_use_package_v1(jsonb) rename to import_app_exam_use_package_core_v1;
revoke all on function private.import_app_exam_use_package_core_v1(jsonb) from public,anon,authenticated,service_role;
create function private.import_app_exam_use_package_v1(p_package jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  if p_package->>'dataset_key' like 'g12-mock-%' then raise exception 'reviewed_mock_import_required'; end if;
  return private.import_app_exam_use_package_core_v1(p_package);
end; $$;
revoke all on function private.import_app_exam_use_package_v1(jsonb) from public,anon,authenticated;
grant execute on function private.import_app_exam_use_package_v1(jsonb) to service_role;
create or replace function public.import_app_exam_use_package_v1(p_package jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select private.import_app_exam_use_package_v1(p_package); $$;

-- Reviewed monthly sources have an approval separate from the legacy preview
-- importer. No original dictionary, school release, or student row is changed.
create table private.reviewed_mock_source_approvals_v1 (
  approval_id text not null,
  target_project_ref text not null,
  dataset_key text not null,
  bundle_file_sha256 text not null check(bundle_file_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  package_version text not null check(package_version ~ '^[a-f0-9]{64}$'),
  occurrence_count int not null check(occurrence_count between 4 and 2000),
  included_count int not null check(included_count between 4 and occurrence_count),
  scope_count int not null check(scope_count between 1 and 25),
  expected_link_counts jsonb not null,
  review_evidence_sha256 text not null check(review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key(approval_id,target_project_ref),
  unique(target_project_ref,dataset_key)
);
create table private.reviewed_mock_source_releases_v1 (
  release_id uuid primary key references word_index.app_exam_use_release(release_id),
  dataset_id uuid not null unique references public.vocab_datasets(id),
  approval_id text not null,
  target_project_ref text not null,
  content_sha256 text not null unique,
  bundle jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(approval_id,target_project_ref) references private.reviewed_mock_source_approvals_v1
);
create table private.reviewed_mock_source_resources_v1 (
  release_id uuid not null references private.reviewed_mock_source_releases_v1(release_id) deferrable initially deferred,
  source_row int not null,
  vocab_entry_id bigint unique references public.vocab_entries(id),
  exam_input_hash text not null check(exam_input_hash ~ '^[a-f0-9]{64}$'),
  payload jsonb not null,
  primary key(release_id,source_row),
  foreign key(release_id,source_row) references word_index.app_exam_use_occurrence(release_id,source_row)
);
alter table private.reviewed_mock_source_approvals_v1 enable row level security;
alter table private.reviewed_mock_source_releases_v1 enable row level security;
alter table private.reviewed_mock_source_resources_v1 enable row level security;
revoke all on private.reviewed_mock_source_approvals_v1,private.reviewed_mock_source_releases_v1,
  private.reviewed_mock_source_resources_v1 from public,anon,authenticated,service_role;

create function private.guard_reviewed_mock_source_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare d uuid; r uuid;
begin
  if tg_table_schema='private' then raise exception 'reviewed_mock_source_immutable'; end if;
  if tg_table_name='vocab_datasets' then
    d:=old.id;
    if tg_op='UPDATE' and to_jsonb(new)-array['is_active','status']=to_jsonb(old)-array['is_active','status'] then return new; end if;
  elsif tg_table_name='app_exam_use_release' then
    r:=old.release_id;
    if tg_op='UPDATE' and to_jsonb(new)-array['status','retired_at_utc']=to_jsonb(old)-array['status','retired_at_utc'] then return new; end if;
  else
    if tg_op='INSERT' then d:=new.dataset_id; else d:=old.dataset_id; end if;
    if tg_op='UPDATE' and exists(select 1 from private.reviewed_mock_source_releases_v1 s where s.dataset_id=new.dataset_id) then
      raise exception 'reviewed_mock_source_immutable';
    end if;
  end if;
  if exists(select 1 from private.reviewed_mock_source_releases_v1 s where s.dataset_id=d or s.release_id=r) then
    raise exception 'reviewed_mock_source_immutable';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end; $$;
create trigger reviewed_mock_approval_immutable before update or delete on private.reviewed_mock_source_approvals_v1
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_release_immutable before update or delete on private.reviewed_mock_source_releases_v1
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_resource_immutable before update or delete on private.reviewed_mock_source_resources_v1
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_entry_immutable before insert or update or delete on public.vocab_entries
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_unit_immutable before insert or update or delete on public.vocab_units
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_occurrence_immutable before insert or update or delete on word_index.app_exam_use_occurrence
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_dataset_immutable before update or delete on public.vocab_datasets
  for each row execute function private.guard_reviewed_mock_source_v1();
create trigger reviewed_mock_source_release_immutable before update or delete on word_index.app_exam_use_release
  for each row execute function private.guard_reviewed_mock_source_v1();

create function private.import_reviewed_mock_wordbook_v1(p_bundle_text text)
returns jsonb language plpgsql security definer set search_path='' set statement_timeout='180s' as $$
declare b jsonb; p jsonb; ap private.reviewed_mock_source_approvals_v1%rowtype;
  old_release private.reviewed_mock_source_releases_v1%rowtype; e jsonb; x jsonb; f jsonb; rv jsonb; s jsonb;
  field_name text; entry_hash text; expected_hash text; d uuid; r uuid; u uuid; answer jsonb; scopes_json jsonb:='[]';
  counts jsonb; project_ref text; scope_answer jsonb; source_row int; count_value int;
begin
  if octet_length(p_bundle_text)>25000000 then raise exception 'reviewed_mock_bundle_too_large'; end if;
  b:=p_bundle_text::jsonb; p:=b->'package'; project_ref:=private.request_supabase_project_ref_v1();
  select * into ap from private.reviewed_mock_source_approvals_v1
    where approval_id=b->>'approval_id' and target_project_ref=project_ref
      and dataset_key=p->>'dataset_key' and package_version=p->>'package_version'
      and bundle_file_sha256=encode(extensions.digest(convert_to(p_bundle_text,'UTF8'),'sha256'),'hex')
      and content_sha256=b->>'content_sha256'
      and content_sha256=private.reviewed_exam_sha256_v1(b-'content_sha256') for share;
  if not found then raise exception 'reviewed_mock_not_approved' using errcode='42501'; end if;
  if b->>'schema_version' is distinct from 'reviewed_mock_wordbook_v1'
    or p->>'dataset_key' !~ '^g12-mock-(2024|2025|2026)-(03|05|06|07|09|10)-v[1-9][0-9]*$'
    or p->>'package_version' is distinct from private.reviewed_exam_sha256_v1(p-'package_version')
    or jsonb_typeof(b->'resources') is distinct from 'array' or jsonb_typeof(b->'scopes') is distinct from 'array'
    or jsonb_typeof(b->'inputs') is distinct from 'array' or jsonb_array_length(b->'inputs')=0
    or jsonb_typeof(p->'entries') is distinct from 'array'
    or jsonb_array_length(b->'resources')<>ap.occurrence_count or jsonb_array_length(p->'entries')<>ap.occurrence_count
    or jsonb_array_length(b->'scopes')<>ap.scope_count
    or (select count(*) from jsonb_array_elements(p->'entries') j where (j->>'include_in_exam')::boolean)<>ap.included_count
    or (select count(distinct j->>'source_row') from jsonb_array_elements(p->'entries') j)<>ap.occurrence_count
    or (select count(distinct j->>'source_row') from jsonb_array_elements(b->'resources') j)<>ap.occurrence_count
    or (select count(distinct j->>'unit') from jsonb_array_elements(p->'entries') j)<>ap.scope_count
    or (select count(distinct j->>'unit_label') from jsonb_array_elements(b->'scopes') j)<>ap.scope_count
  then raise exception 'reviewed_mock_bundle_invalid'; end if;
  if private.reviewed_exam_sha256_v1((select jsonb_agg(j->'review_records' order by (j->>'source_row')::int)
      from jsonb_array_elements(b->'resources') j))<>ap.review_evidence_sha256
    or p->>'exam_review_ledger_sha256' is distinct from ap.review_evidence_sha256
    or p->>'manifest_content_hash' is distinct from private.reviewed_exam_sha256_v1(b->'scopes')
  then raise exception 'reviewed_mock_review_changed'; end if;
  counts:='{"dictionary":0,"pos":0,"pronunciation":0,"definition":0,"example":0}';
  for x in select value from jsonb_array_elements(b->'resources') loop
    source_row:=(x->>'source_row')::int;
    select value into strict e from jsonb_array_elements(p->'entries') where (value->>'source_row')::int=source_row;
    entry_hash:=private.reviewed_exam_sha256_v1(e-'content_hash');
    expected_hash:=private.reviewed_exam_sha256_v1(jsonb_build_object('entry',e-array['content_hash','exam_input_hash'],
      'resources',x-array['exam_input_hash','review_records']));
    if entry_hash is distinct from e->>'content_hash' or expected_hash is distinct from e->>'exam_input_hash'
      or expected_hash is distinct from x->>'exam_input_hash' or jsonb_typeof(x->'review_records') is distinct from 'array'
      or jsonb_array_length(x->'review_records')<2
      or (select count(distinct j->>'reviewer') from jsonb_array_elements(x->'review_records') j)<2
      or (select count(distinct j->>'review_run_id') from jsonb_array_elements(x->'review_records') j)<2
      or nullif(x->>'inclusion_reason','') is null or not (x ? 'original_pos')
      or nullif(x->>'original_headword','') is null or nullif(x->>'original_gloss','') is null
      or ((x->>'original_gloss') is distinct from (e->>'display_gloss_ko') and e->>'context_evidence_status'<>'manual_context_correction')
    then raise exception 'reviewed_mock_entry_invalid'; end if;
    for rv in select value from jsonb_array_elements(x->'review_records') loop
      if rv->>'stage' is distinct from 'exam_scope' or rv->>'decision' is distinct from 'pass'
        or rv->>'input_hash' is distinct from expected_hash or nullif(rv->>'reviewer','') is null
        or nullif(rv->>'reviewer_version','') is null or nullif(rv->>'review_run_id','') is null
        or nullif(rv->>'reviewed_at','') is null or (rv->>'reviewed_at')::timestamptz>now()+interval '5 minutes'
        or jsonb_typeof(rv->'evidence') is distinct from 'array' or jsonb_array_length(rv->'evidence')=0
      then raise exception 'reviewed_mock_independent_review_required'; end if;
    end loop;
    foreach field_name in array array['dictionary','pos','pronunciation','definition','example'] loop
      f:=x->field_name;
      if jsonb_typeof(f) is distinct from 'object' or (f->>'status') not in ('linked','missing','review_required','excluded')
        or nullif(f->>'reason','') is null or not (f ? 'value') or jsonb_typeof(f->'evidence') is distinct from 'array'
        or ((f->>'status'='linked') is distinct from (f->'value'<>'null'::jsonb))
        or (f->>'status'='linked' and jsonb_array_length(f->'evidence')=0)
      then raise exception 'reviewed_mock_field_invalid'; end if;
      if f->>'status'='linked' then counts:=jsonb_set(counts,array[field_name],to_jsonb((counts->>field_name)::int+1)); end if;
      for rv in select value from jsonb_array_elements(f->'evidence') loop
        if nullif(rv->>'path','') is null or nullif(rv->>'locator','') is null
          or coalesce(rv->>'sha256','') !~ '^[a-f0-9]{64}$' then raise exception 'reviewed_mock_field_evidence_invalid'; end if;
      end loop;
    end loop;
    f:=x#>'{dictionary,value}';
    if f<>'null'::jsonb and (f->>'dictionary_id' is distinct from e->>'dictionary_id'
      or f->>'sense_id' is distinct from e->>'sense_id' or f->>'canonical_approved' is distinct from 'false'
      or (f->>'legacy_id' is not null and not exists(select 1 from jsonb_array_elements(e->'legacy_ids') j where j->>'id'=f->>'legacy_id'))) then
      raise exception 'reviewed_mock_dictionary_mismatch';
    end if;
    f:=x#>'{pronunciation,value}';
    if ((e#>>'{audio,status}'='raw_attached') is distinct from (f<>'null'::jsonb))
      or (f<>'null'::jsonb and (f->>'audio_url' is distinct from e#>>'{audio,audio_url}'
        or x#>>'{pos,status}' is distinct from 'linked' or f->>'variant_pos' is distinct from x#>>'{pos,value}'
        or f->>'variant_id' is distinct from e#>>'{audio,variant_id}' or f->>'variant_pos' is distinct from e#>>'{audio,variant_pos}'
        or f->>'raw_sha256' is distinct from e#>>'{audio,raw_response_sha256}'
        or f->>'sound_audio' is distinct from e#>>'{audio,sound_audio}' or f->>'notation' is distinct from e#>>'{audio,mw_notation}'
        or not exists(select 1 from jsonb_array_elements(x#>'{pronunciation,evidence}') proof
          where proof->>'source'='preserved_raw' and proof->>'path'=e#>>'{audio,raw_relative_path}'
            and proof->>'sha256'=f->>'raw_sha256' and proof->>'locator'=e#>>'{audio,source_locator}')))
    then raise exception 'reviewed_mock_pronunciation_mismatch'; end if;
  end loop;
  if counts is distinct from ap.expected_link_counts then raise exception 'reviewed_mock_link_count_mismatch'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ap.dataset_key,9129));
  select * into old_release from private.reviewed_mock_source_releases_v1 where content_sha256=ap.content_sha256;
  if found then return old_release.result || '{"idempotent":true}'::jsonb; end if;
  if exists(select 1 from public.vocab_datasets where dataset_key=ap.dataset_key) then raise exception 'reviewed_mock_dataset_exists'; end if;
  answer:=private.import_app_exam_use_package_core_v1(p);
  d:=(answer->>'datasetId')::uuid; r:=(answer->>'releaseId')::uuid;
  for x in select value from jsonb_array_elements(b->'resources') loop
    update public.vocab_entries set english_definition=x#>>'{definition,value}',
      example_en=x#>>'{example,value,english}', example_ko=x#>>'{example,value,korean}'
      where dataset_id=d and vocab_entries.source_row=(x->>'source_row')::int;
    insert into private.reviewed_mock_source_resources_v1(release_id,source_row,vocab_entry_id,exam_input_hash,payload)
      select r,o.source_row,o.vocab_entry_id,x->>'exam_input_hash',x from word_index.app_exam_use_occurrence o
      where o.release_id=r and o.source_row=(x->>'source_row')::int;
  end loop;
  insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,publisher,
    series_title,academic_year,is_assignable,sort_index,metadata)
    values(d,p->>'title','high_mock','exam_collection','g12','제공 단어장','모의고사 유형별 단어',
      (b#>>'{scopes,0,metadata,executionYear}')::smallint,true,30,
      jsonb_build_object('source',ap.dataset_key,'reviewRequired',false,'reviewedMockSourceVersion',ap.content_sha256));
  for s in select value from jsonb_array_elements(b->'scopes') loop
    if (s#>>'{metadata,executionYear}') is distinct from split_part(ap.dataset_key,'-',3)
      or (s#>>'{metadata,examMonth}')::int is distinct from split_part(ap.dataset_key,'-',4)::int
      or s#>>'{metadata,examKind}' is distinct from 'mock' then raise exception 'reviewed_mock_scope_mismatch'; end if;
    select id into strict u from public.vocab_units where dataset_id=d and unit_label=s->>'unit_label';
    insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,unit_code,academic_year,exam_month,
      agency,item_range,sort_index,metadata)
      select u,'high_mock','exam_scope',s->>'display_name',ap.dataset_key||':'||v.sort_index,
        (s#>>'{metadata,executionYear}')::smallint,(s#>>'{metadata,examMonth}')::smallint,s#>>'{metadata,agency}',
        (select string_agg(value#>>'{}',',' order by n) from jsonb_array_elements(s#>'{metadata,questionNumbers}') with ordinality q(value,n)),
        v.sort_index,s->'metadata' from public.vocab_units v where v.id=u;
    select count(*) into count_value from word_index.app_exam_use_occurrence where release_id=r and unit_id=u and include_in_exam;
    if count_value>0 then scopes_json:=scopes_json||jsonb_build_array(jsonb_build_object('sourceReleaseId',r,'sourceUnitId',u,
      'displayName',s->>'display_name','reviewEvidenceSha256',s->>'review_evidence_sha256','metadata',s->'metadata')); end if;
  end loop;
  scope_answer:=public.register_mock_wordbook_scopes_v1(scopes_json);
  answer:=answer||jsonb_build_object('scopeCount',ap.scope_count,'registeredScopeCount',jsonb_array_length(scopes_json),'links',counts,'scopeResult',scope_answer);
  insert into private.reviewed_mock_source_releases_v1(release_id,dataset_id,approval_id,target_project_ref,content_sha256,bundle,result)
    values(r,d,ap.approval_id,project_ref,ap.content_sha256,b,answer);
  return answer;
end; $$;
create function public.import_reviewed_mock_wordbook_v1(p_bundle_text text) returns jsonb
language sql security invoker set search_path='' as $$ select private.import_reviewed_mock_wordbook_v1(p_bundle_text); $$;
revoke all on function private.import_reviewed_mock_wordbook_v1(text),public.import_reviewed_mock_wordbook_v1(text)
  from public,anon,authenticated;
grant execute on function private.import_reviewed_mock_wordbook_v1(text),public.import_reviewed_mock_wordbook_v1(text) to service_role;

create function public.list_reviewed_mock_source_resources_v1(p_entry_ids bigint[]) returns table(vocab_entry_id bigint,payload jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if cardinality(p_entry_ids)>400 then raise exception 'reviewed_mock_resource_limit'; end if;
  return query select x.vocab_entry_id,x.payload from private.reviewed_mock_source_resources_v1 x
    join private.reviewed_mock_source_releases_v1 s on s.release_id=x.release_id
    where x.vocab_entry_id=any(p_entry_ids);
end; $$;
revoke all on function public.list_reviewed_mock_source_resources_v1(bigint[]) from public,anon,authenticated;
grant execute on function public.list_reviewed_mock_source_resources_v1(bigint[]) to service_role;
revoke all on function private.guard_reviewed_mock_source_v1() from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
