begin;

-- Reviewed scope tags are attached to a specific source release/unit. They are
-- not global dictionary tags and cannot turn candidate rows into exam material.
create table word_index.mock_wordbook_scope (
  id uuid primary key default extensions.gen_random_uuid(),
  revision bigint generated always as identity unique,
  source_release_id uuid not null references word_index.app_exam_use_release(release_id),
  source_unit_id uuid not null references public.vocab_units(id),
  display_name text not null check (length(display_name) between 1 and 160),
  metadata jsonb not null check (jsonb_typeof(metadata) = 'object'),
  review_evidence_sha256 text not null check (review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  source_version text not null check (source_version ~ '^[a-f0-9]{64}$'),
  unique (source_release_id, source_unit_id, source_version)
);

-- Optional, separately reviewed lexical identity. A dictionary ID alone is
-- deliberately insufficient. With no review, each occurrence stays separate.
create table word_index.mock_wordbook_identity_review (
  source_release_id uuid not null references word_index.app_exam_use_release(release_id),
  source_entry_id bigint not null references public.vocab_entries(id),
  source_row_sha256 text not null check (source_row_sha256 ~ '^[A-F0-9]{64}$'),
  reviewed_headword text not null check (length(trim(reviewed_headword)) between 1 and 160),
  reviewed_gloss text not null check (length(trim(reviewed_gloss)) between 1 and 500),
  lexical_pos text not null check (length(trim(lexical_pos)) between 1 and 80),
  sense_id text not null check (length(trim(sense_id)) between 1 and 200),
  review_evidence_sha256 text not null check (review_evidence_sha256 ~ '^[a-f0-9]{64}$'),
  primary key (source_release_id, source_entry_id),
  foreign key (source_release_id, source_entry_id) references word_index.app_exam_use_occurrence(release_id, vocab_entry_id)
);

create table word_index.mock_wordbook_composition (
  dataset_id uuid primary key references public.vocab_datasets(id),
  release_id uuid not null unique references word_index.app_exam_use_release(release_id),
  created_by uuid not null references auth.users(id),
  request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[a-f0-9]{64}$'),
  manifest jsonb not null check (jsonb_typeof(manifest) = 'object'),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  created_at timestamptz not null default now(),
  unique (created_by, request_id)
);

create table word_index.mock_wordbook_lineage (
  release_id uuid not null references word_index.app_exam_use_release(release_id),
  source_row integer not null,
  vocab_entry_id bigint unique references public.vocab_entries(id),
  row_sha256 text check (row_sha256 ~ '^[A-F0-9]{64}$'),
  source_scope_id uuid not null references word_index.mock_wordbook_scope(id),
  source_release_id uuid not null,
  source_occurrence_row integer not null,
  source_entry_id bigint references public.vocab_entries(id),
  source_row_sha256 text,
  source_occurrence_hash text not null,
  source_package_version text not null,
  included boolean not null,
  identity_key text check (identity_key ~ '^[a-f0-9]{64}$'),
  source_entry_snapshot jsonb,
  source_occurrence_snapshot jsonb not null,
  identity_review_snapshot jsonb,
  primary key (release_id, source_row),
  foreign key (release_id, source_row) references word_index.app_exam_use_occurrence(release_id, source_row),
  foreign key (source_release_id, source_occurrence_row) references word_index.app_exam_use_occurrence(release_id, source_row),
  check ((included and vocab_entry_id is not null and source_entry_id is not null and row_sha256 is not null and source_row_sha256 is not null)
    or (not included and vocab_entry_id is null and source_entry_id is null and identity_key is null))
);
create index mock_wordbook_lineage_source_idx on word_index.mock_wordbook_lineage(source_entry_id);

alter table word_index.mock_wordbook_scope enable row level security;
alter table word_index.mock_wordbook_identity_review enable row level security;
alter table word_index.mock_wordbook_composition enable row level security;
alter table word_index.mock_wordbook_lineage enable row level security;
revoke all on word_index.mock_wordbook_scope, word_index.mock_wordbook_identity_review,
  word_index.mock_wordbook_composition, word_index.mock_wordbook_lineage from public, anon, authenticated;
grant select on word_index.mock_wordbook_scope, word_index.mock_wordbook_identity_review,
  word_index.mock_wordbook_composition, word_index.mock_wordbook_lineage to service_role;
grant insert on word_index.mock_wordbook_identity_review to service_role;

create function private.reject_mock_wordbook_history_change()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'mock_wordbook_history_is_immutable' using errcode = '22023';
end;
$$;
create trigger mock_scope_immutable before update or delete on word_index.mock_wordbook_scope
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger mock_identity_immutable before update or delete on word_index.mock_wordbook_identity_review
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger mock_composition_immutable before update or delete on word_index.mock_wordbook_composition
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger mock_lineage_immutable before update or delete on word_index.mock_wordbook_lineage
  for each row execute function private.reject_mock_wordbook_history_change();

create function private.mock_wordbook_source_version(p_release uuid, p_unit uuid, p_metadata jsonb, p_evidence text)
returns text language sql stable security definer set search_path = '' as $$
  select encode(extensions.digest(jsonb_build_object(
    'release', r.release_id, 'package', r.package_version, 'metadata', p_metadata, 'evidence', p_evidence,
    'rows', (select jsonb_agg(jsonb_build_object('occurrence', to_jsonb(o), 'entry', to_jsonb(e), 'identity', to_jsonb(i)) order by o.source_row)
      from word_index.app_exam_use_occurrence o left join public.vocab_entries e on e.id = o.vocab_entry_id
      left join word_index.mock_wordbook_identity_review i on i.source_release_id = o.release_id and i.source_entry_id = e.id
      where o.release_id = r.release_id and o.unit_id = p_unit)
  )::text, 'sha256'), 'hex')
  from word_index.app_exam_use_release r where r.release_id = p_release;
$$;

create function public.register_mock_wordbook_scopes_v1(p_scopes jsonb)
returns integer language plpgsql security definer set search_path = '' as $$
declare s jsonb; m jsonb; rid uuid; uid uuid; ver text; old word_index.mock_wordbook_scope; n integer := 0; nums text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_scopes) is distinct from 'array' or jsonb_array_length(p_scopes) not between 1 and 2000 then
    raise exception 'invalid_mock_scopes' using errcode = '22023'; end if;
  for s in select value from jsonb_array_elements(p_scopes) loop
    rid := (s->>'sourceReleaseId')::uuid; uid := (s->>'sourceUnitId')::uuid; m := s->'metadata';
    if jsonb_typeof(m) is distinct from 'object' or not (m ?& array['executionYear','examMonth','examKind','academicYear','agency','typeCode','typeLabel','questionNumbers','sharedPassage'])
      or (select count(*) from jsonb_object_keys(m)) <> 9
      or jsonb_typeof(m->'executionYear') is distinct from 'number' or jsonb_typeof(m->'examMonth') is distinct from 'number'
      or jsonb_typeof(m->'examKind') is distinct from 'string' or jsonb_typeof(m->'agency') is distinct from 'string'
      or jsonb_typeof(m->'typeCode') is distinct from 'string' or jsonb_typeof(m->'typeLabel') is distinct from 'string'
      or (m->'academicYear' <> 'null'::jsonb and (jsonb_typeof(m->'academicYear') <> 'number' or (m->>'academicYear')::integer not between 2000 and 2101))
      or (m->>'executionYear')::integer not between 2000 and 2100
      or (m->>'examMonth')::integer not between 1 and 12 or m->>'examKind' not in ('mock','csat')
      or length(trim(coalesce(m->>'agency',''))) not between 1 and 80 or length(trim(coalesce(m->>'typeLabel',''))) not between 1 and 80
      or coalesce(m->>'typeCode','') !~ '^[a-z0-9_]{1,80}$'
      or jsonb_typeof(m->'questionNumbers') is distinct from 'array'
      or jsonb_array_length(m->'questionNumbers') not between 1 and 3
      or jsonb_typeof(m->'sharedPassage') is distinct from 'boolean'
      or coalesce(s->>'reviewEvidenceSha256','') !~ '^[a-f0-9]{64}$'
      or length(coalesce(s->>'displayName','')) not between 1 and 160 then
      raise exception 'invalid_mock_scope_metadata' using errcode = '22023'; end if;
    select string_agg(value, ',' order by ord) into nums from jsonb_array_elements_text(m->'questionNumbers') with ordinality t(value,ord);
    if exists (select 1 from jsonb_array_elements_text(m->'questionNumbers') t(v) where v::integer not between 1 and 45)
      or exists (select 1 from (select v::integer n,lag(v::integer) over(order by ord) previous from jsonb_array_elements_text(m->'questionNumbers') with ordinality t(v,ord)) q where q.n <= q.previous)
      or (select count(distinct v) from jsonb_array_elements_text(m->'questionNumbers') t(v)) <> jsonb_array_length(m->'questionNumbers')
      or (m->>'sharedPassage')::boolean and nums not in ('41,42','43,44,45')
      or exists (select 1 from jsonb_array_elements_text(m->'questionNumbers') t(v) where v::integer >= 41)
         and (not (m->>'sharedPassage')::boolean or nums not in ('41,42','43,44,45')) then
      raise exception 'invalid_mock_passage_group' using errcode = '22023'; end if;
    if not exists (select 1 from word_index.app_exam_use_release r join public.vocab_datasets d on d.id = r.dataset_id
      join public.vocab_dataset_catalog c on c.dataset_id = d.id join public.vocab_units u on u.dataset_id = d.id and u.id = uid
      where r.release_id = rid and r.status = 'active' and r.exam_use_import_allowed and not r.common_dictionary_release_allowed
        and d.status = 'ready' and d.is_active and c.is_assignable and c.grade_code = 'g12'
        and d.metadata->>'projectionProfile' = 'exam_scope_candidate_v1'
        and not (d.metadata ? 'compositionVersion')
        and exists (select 1 from word_index.app_exam_use_occurrence o where o.release_id = rid and o.unit_id = uid and o.include_in_exam)) then
      raise exception 'unreviewed_mock_source' using errcode = '22023'; end if;
    ver := private.mock_wordbook_source_version(rid, uid, m, s->>'reviewEvidenceSha256');
    select * into old from word_index.mock_wordbook_scope where source_release_id = rid and source_unit_id = uid and source_version = ver;
    if found then
      if old.source_version <> ver or old.display_name <> s->>'displayName' then raise exception 'mock_scope_conflict' using errcode = '40001'; end if;
    else
      insert into word_index.mock_wordbook_scope(source_release_id,source_unit_id,display_name,metadata,review_evidence_sha256,source_version)
      values(rid,uid,s->>'displayName',m,s->>'reviewEvidenceSha256',ver);
    end if;
    n := n + 1;
  end loop;
  return n;
end;
$$;

create function public.list_mock_wordbook_scopes_v1()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  return jsonb_build_object('scopes', coalesce((select jsonb_agg(jsonb_build_object(
    'id', s.id, 'version', s.source_version, 'displayName', s.display_name, 'metadata', s.metadata,
    'sourceTitle', r.title, 'sourceEntryCount', counts.all_rows, 'includedEntryCount', counts.included_rows)
    order by (s.metadata->>'executionYear')::integer desc, (s.metadata->>'examMonth')::integer, s.display_name, s.id)
    from word_index.mock_wordbook_scope s join word_index.app_exam_use_release r on r.release_id = s.source_release_id
    join public.vocab_datasets d on d.id = r.dataset_id join public.vocab_dataset_catalog c on c.dataset_id = d.id
    cross join lateral (select count(*) all_rows, count(*) filter(where o.include_in_exam) included_rows
      from word_index.app_exam_use_occurrence o where o.release_id = r.release_id and o.unit_id = s.source_unit_id) counts
    where r.status = 'active' and d.status = 'ready' and d.is_active and c.is_assignable and c.grade_code = 'g12'
      and r.exam_use_import_allowed and not r.common_dictionary_release_allowed and counts.included_rows > 0
      and not exists(select 1 from word_index.mock_wordbook_scope newer where newer.source_release_id=s.source_release_id and newer.source_unit_id=s.source_unit_id and newer.revision>s.revision)
      and s.source_version = private.mock_wordbook_source_version(s.source_release_id,s.source_unit_id,s.metadata,s.review_evidence_sha256)
  ),'[]'::jsonb));
end;
$$;

create function public.create_mock_wordbook_composition_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  request_id uuid; title text; request_hash text; source_request jsonb; manifest jsonb;
  prior word_index.mock_wordbook_composition; scope word_index.mock_wordbook_scope; src_release word_index.app_exam_use_release;
  original word_index.app_exam_use_occurrence; derived word_index.app_exam_use_occurrence; entry public.vocab_entries;
  identity_review word_index.mock_wordbook_identity_review;
  new_dataset uuid := extensions.gen_random_uuid(); new_release uuid := extensions.gen_random_uuid(); new_unit uuid;
  new_entry bigint; row_hash text; version text; dataset_key text; identity_key text; result jsonb;
  scope_count integer; source_count integer := 0; included_count integer := 0; unit_count integer; unit_rank integer := 0; new_row integer := 0;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode = '42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or jsonb_typeof(p_request->'scopes') is distinct from 'array'
    or jsonb_array_length(p_request->'scopes') not between 1 and 500
    or length(trim(coalesce(p_request->>'title',''))) not between 1 and 100
    or (select count(*) from jsonb_object_keys(p_request)) <> 3 then
    raise exception 'invalid_composition_request' using errcode = '22023'; end if;
  request_id := (p_request->>'requestId')::uuid; title := trim(p_request->>'title');
  if request_id is null then raise exception 'invalid_composition_request' using errcode = '22023'; end if;
  scope_count := jsonb_array_length(p_request->'scopes');
  if (select count(distinct value->>'id') from jsonb_array_elements(p_request->'scopes')) <> scope_count
    or exists (select 1 from jsonb_array_elements(p_request->'scopes') x where jsonb_typeof(x) <> 'object'
      or coalesce(x->>'version','') !~ '^[a-f0-9]{64}$' or (select count(*) from jsonb_object_keys(x)) <> 2) then
    raise exception 'invalid_composition_scopes' using errcode = '22023'; end if;
  request_hash := encode(extensions.digest((p_request - 'requestId')::text,'sha256'),'hex');
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || ':' || request_id::text, 0));
  select * into prior from word_index.mock_wordbook_composition where created_by = auth.uid() and mock_wordbook_composition.request_id = (p_request->>'requestId')::uuid;
  if found then
    if prior.request_hash <> request_hash then raise exception 'composition_request_conflict' using errcode = '40001'; end if;
    return prior.result;
  end if;
  if exists(select 1 from word_index.mock_wordbook_scope s where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v)
    group by s.source_release_id,s.source_unit_id having count(*)>1) then
    raise exception 'invalid_composition_scopes' using errcode='22023'; end if;
  if exists(select 1 from word_index.mock_wordbook_scope s join word_index.mock_wordbook_scope newer
    on newer.source_release_id=s.source_release_id and newer.source_unit_id=s.source_unit_id and newer.revision>s.revision
    where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v)) then
    raise exception 'composition_scope_changed' using errcode='40001'; end if;
  -- Lock every selected scope and source before hashing or copying. Stable source
  -- order avoids cross-request deadlocks; the user's unit order is stored below.
  perform 1 from word_index.mock_wordbook_scope s where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v) order by s.id for share;
  perform 1 from word_index.app_exam_use_release r where r.release_id in (select s.source_release_id from word_index.mock_wordbook_scope s
    where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v)) order by r.release_id for share;
  perform 1 from public.vocab_datasets d where d.id in (select r.dataset_id from word_index.app_exam_use_release r join word_index.mock_wordbook_scope s on s.source_release_id = r.release_id
    where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v)) order by d.id for share;
  perform 1 from public.vocab_entries e join word_index.app_exam_use_occurrence o on o.vocab_entry_id = e.id
    join word_index.mock_wordbook_scope s on s.source_release_id = o.release_id and s.source_unit_id = o.unit_id
    where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v) order by e.id for share of e;
  manifest := jsonb_build_object('kind','mock_wordbook_composition_v1','request',p_request,'sources','[]'::jsonb);
  for source_request in select value from jsonb_array_elements(p_request->'scopes') loop
    select * into scope from word_index.mock_wordbook_scope where id = (source_request->>'id')::uuid;
    if not found or scope.source_version <> source_request->>'version' then raise exception 'composition_scope_changed' using errcode = '40001'; end if;
    select r.* into src_release from word_index.app_exam_use_release r join public.vocab_datasets d on d.id = r.dataset_id
      join public.vocab_dataset_catalog c on c.dataset_id = d.id
      where r.release_id = scope.source_release_id and r.status = 'active' and r.exam_use_import_allowed and not r.common_dictionary_release_allowed
        and d.status = 'ready' and d.is_active and c.is_assignable and c.grade_code = 'g12'
        and d.metadata->>'packageVersion' = r.package_version and not (d.metadata ? 'compositionVersion');
    if not found or scope.source_version <> private.mock_wordbook_source_version(scope.source_release_id,scope.source_unit_id,scope.metadata,scope.review_evidence_sha256) then
      raise exception 'composition_source_changed' using errcode = '40001'; end if;
    select count(*), count(*) filter(where include_in_exam) into unit_count, new_row from word_index.app_exam_use_occurrence
      where release_id = scope.source_release_id and unit_id = scope.source_unit_id;
    if new_row < 1 then raise exception 'composition_empty_scope' using errcode = '22023'; end if;
    source_count := source_count + unit_count; included_count := included_count + new_row;
    manifest := jsonb_set(manifest,'{sources}', (manifest->'sources') || jsonb_build_array(jsonb_build_object(
      'scope',to_jsonb(scope),'release',to_jsonb(src_release)-'package_json','sourceCount',unit_count,'includedCount',new_row)));
  end loop;
  if included_count < 4 or source_count > 20000 then raise exception 'composition_size_invalid' using errcode = '22023'; end if;
  version := encode(extensions.digest(manifest::text,'sha256'),'hex'); dataset_key := 'mock-composed-' || new_dataset::text;
  insert into public.vocab_datasets(id,dataset_key,title,edition,source_label,source_sha256,row_count,status,is_active,imported_by,metadata)
    values(new_dataset,dataset_key,title,'composition-v1','선택한 모의고사 범위',upper(version),included_count,'ready',true,auth.uid(),
      jsonb_build_object('projectionProfile','exam_scope_candidate_v1','targetEnvironment','preview','packageVersion',version,
        'compositionVersion','mock_wordbook_composition_v1','totalOccurrenceCount',source_count,'includedOccurrenceCount',included_count));
  insert into word_index.app_exam_use_release(release_id,release_key,dataset_id,dataset_key,schema_version,package_version,source_sha256,
    candidate_dictionary_version,manifest_content_hash,exam_review_ledger_sha256,wordbook_id,title,target_environment,
    common_dictionary_release_allowed,exam_use_import_allowed,expected_occurrence_count,expected_dictionary_count,expected_included_count,status,package_json)
    values(new_release,dataset_key||':'||version,new_dataset,dataset_key,'1.0',version,version,version,version,version,dataset_key,title,'preview',
      false,true,source_count,1,included_count,'loading',manifest);
  new_row := 0;
  for source_request in select value from jsonb_array_elements(p_request->'scopes') loop
    select * into scope from word_index.mock_wordbook_scope where id = (source_request->>'id')::uuid;
    unit_rank := unit_rank + 1; new_unit := extensions.gen_random_uuid();
    select count(*) into unit_count from word_index.app_exam_use_occurrence where release_id = scope.source_release_id and unit_id = scope.source_unit_id and include_in_exam;
    insert into public.vocab_units(id,dataset_id,unit_label,normalized_label,unit_kind,sort_index,entry_count)
      values(new_unit,new_dataset,scope.display_name,'composition:'||scope.id::text,'supplement',unit_rank,unit_count);
    insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,academic_year,exam_month,agency,item_range,sort_index,metadata)
      values(new_unit,case when scope.metadata->>'examKind'='csat' then 'csat' else 'high_mock' end,'exam_scope',scope.display_name,
        (scope.metadata->>'executionYear')::smallint,(scope.metadata->>'examMonth')::smallint,scope.metadata->>'agency',
        (select string_agg(n,'–' order by ord) from jsonb_array_elements_text(scope.metadata->'questionNumbers') with ordinality t(n,ord)),unit_rank,
        jsonb_build_object('mockScope',scope.metadata,'sourceScopeId',scope.id,'sourceVersion',scope.source_version));
    for original in select * from word_index.app_exam_use_occurrence where release_id=scope.source_release_id and unit_id=scope.source_unit_id order by source_row loop
      new_row := new_row+1; new_entry := null; identity_key := null; entry := null; identity_review := null;
      row_hash := upper(encode(extensions.digest(version || ':' || scope.id::text || ':' || original.source_row::text,'sha256'),'hex'));
      if original.include_in_exam then
        select * into entry from public.vocab_entries where id=original.vocab_entry_id;
        if not found or entry.dataset_id <> original.dataset_id or entry.unit_id <> original.unit_id
          or entry.headword <> original.display_headword or entry.primary_meaning <> original.display_gloss_ko
          or original.exam_use_status <> 'reviewed_for_preview' then
          raise exception 'composition_entry_mismatch' using errcode = '40001'; end if;
        select * into identity_review from word_index.mock_wordbook_identity_review
          where source_release_id = original.release_id and source_entry_id = entry.id;
        if found then
          if identity_review.source_row_sha256 <> entry.row_sha256 or identity_review.reviewed_headword <> entry.headword
            or identity_review.reviewed_gloss <> entry.primary_meaning then raise exception 'composition_identity_mismatch' using errcode = '40001'; end if;
          identity_key := encode(extensions.digest(jsonb_build_array(lower(normalize(entry.headword,NFKC)),identity_review.lexical_pos,
            identity_review.sense_id,entry.primary_meaning)::text,'sha256'),'hex');
        else
          -- No semantic review: a distinct occurrence key prevents any merging.
          identity_key := encode(extensions.digest('unreviewed-occurrence-v1:' || new_release::text || ':' || new_row::text,'sha256'),'hex');
        end if;
        insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,
          english_definition,example_en,example_ko,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
          values(new_dataset,new_row,entry.headword,entry.headword_normalized,entry.pronunciation_ko,entry.meanings,entry.primary_meaning,
            entry.english_definition,entry.example_en,entry.example_ko,entry.source_ref,row_hash,new_unit,original.position_in_unit,entry.entry_type)
          returning id into new_entry;
      end if;
      derived := original;
      derived.release_id := new_release; derived.dataset_id := new_dataset; derived.source_row := new_row;
      derived.vocab_entry_id := new_entry; derived.unit_id := new_unit;
      derived.occurrence_id := 'occ:composition-' || lower(row_hash);
      derived.occurrence_content_hash := lower(row_hash); derived.package_entry_content_hash := lower(row_hash);
      derived.source_projection_row_sha256 := row_hash;
      derived.package_entry_json := original.package_entry_json || jsonb_build_object('compositionSourceScopeId',scope.id,'compositionSourceRow',original.source_row);
      insert into word_index.app_exam_use_occurrence select (derived).*;
      insert into word_index.mock_wordbook_lineage(release_id,source_row,vocab_entry_id,row_sha256,source_scope_id,source_release_id,
        source_occurrence_row,source_entry_id,source_row_sha256,source_occurrence_hash,source_package_version,included,identity_key,
        source_entry_snapshot,source_occurrence_snapshot,identity_review_snapshot)
        values(new_release,new_row,new_entry,case when new_entry is not null then row_hash end,scope.id,original.release_id,original.source_row,
          original.vocab_entry_id,entry.row_sha256,original.occurrence_content_hash,
          (select r.package_version from word_index.app_exam_use_release r where r.release_id=original.release_id),original.include_in_exam,
          identity_key,case when new_entry is not null then to_jsonb(entry) end,to_jsonb(original),case when identity_review.source_entry_id is not null then to_jsonb(identity_review) end);
    end loop;
  end loop;
  if (select count(*) from word_index.app_exam_use_occurrence where release_id=new_release) <> source_count
    or (select count(*) from public.vocab_entries where dataset_id=new_dataset) <> included_count
    or (select count(*) from public.vocab_units where dataset_id=new_dataset) <> scope_count
    or (select count(*) from word_index.mock_wordbook_lineage where release_id=new_release) <> source_count
    or exists (select 1 from word_index.mock_wordbook_scope s where s.id in (select (v->>'id')::uuid from jsonb_array_elements(p_request->'scopes') v)
      and s.source_version <> private.mock_wordbook_source_version(s.source_release_id,s.source_unit_id,s.metadata,s.review_evidence_sha256)) then
    raise exception 'composition_source_changed_during_save' using errcode='40001'; end if;
  update word_index.app_exam_use_release set status='active',expected_dictionary_count=(select count(distinct dictionary_id)
    from word_index.app_exam_use_occurrence where release_id=new_release) where release_id=new_release;
  insert into public.vocab_dataset_catalog(dataset_id,display_name,catalog_group,material_kind,grade_code,is_assignable,metadata)
    values(new_dataset,title,'high_mock','wordbook','g12',true,jsonb_build_object('audience','common','compositionVersion','mock_wordbook_composition_v1'));
  result := jsonb_build_object('datasetId',new_dataset,'title',title,'scopeCount',scope_count,'sourceEntryCount',source_count,'includedEntryCount',included_count);
  insert into word_index.mock_wordbook_composition(dataset_id,release_id,created_by,request_id,request_hash,manifest,result)
    values(new_dataset,new_release,auth.uid(),request_id,request_hash,manifest,result);
  return result;
end;
$$;

-- Empty for legacy books; the loader adds this identity only to composed books.
create function public.list_active_exam_use_eligibility_v2(p_dataset_id uuid)
returns table(vocab_entry_id bigint,quiz_mode text,canonical_lexeme_id uuid,canonical_dictionary_id text,composition_identity_key text)
language sql stable security definer set search_path = '' as $$
  select e.vocab_entry_id,e.quiz_mode,e.canonical_lexeme_id,e.canonical_dictionary_id,l.identity_key
  from public.list_active_exam_use_eligibility_v1(p_dataset_id) e
  left join word_index.mock_wordbook_lineage l on l.vocab_entry_id=e.vocab_entry_id
  order by e.vocab_entry_id,e.quiz_mode;
$$;
revoke all on function public.list_active_exam_use_eligibility_v2(uuid) from public,anon;
grant execute on function public.list_active_exam_use_eligibility_v2(uuid) to authenticated;

create function public.list_mock_composition_targets_v1(p_dataset_id uuid)
returns table(vocab_entry_id bigint,identity_key text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  return query select l.vocab_entry_id,l.identity_key from word_index.mock_wordbook_composition c
    join word_index.mock_wordbook_lineage l on l.release_id=c.release_id
    where c.dataset_id=p_dataset_id and l.included order by l.vocab_entry_id;
end;
$$;

-- Existing server readers use service_role for student sessions, or an active
-- administrator. Return only the identity mapping, never source text/answers.
create function public.list_mock_composition_lineage_v1(p_entry_ids bigint[])
returns table(vocab_entry_id bigint,source_entry_id bigint,source_release_id uuid,composition_release_id uuid)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'reader_required' using errcode='42501'; end if;
  if cardinality(p_entry_ids)>400 or exists(select 1 from unnest(p_entry_ids) n where n is null or n <= 0 or n > 9007199254740991)
    then raise exception 'invalid_entries' using errcode='22023'; end if;
  if exists (select 1 from word_index.mock_wordbook_lineage l
    left join public.vocab_entries d on d.id=l.vocab_entry_id left join public.vocab_entries s on s.id=l.source_entry_id
    left join word_index.app_exam_use_occurrence o on o.release_id=l.source_release_id and o.source_row=l.source_occurrence_row
    left join word_index.app_exam_use_release r on r.release_id=l.source_release_id
    where l.vocab_entry_id=any(p_entry_ids) and (d.row_sha256 is distinct from l.row_sha256 or s.row_sha256 is distinct from l.source_row_sha256
      or o.occurrence_content_hash is distinct from l.source_occurrence_hash or o.vocab_entry_id is distinct from l.source_entry_id
      or r.package_version is distinct from l.source_package_version
      or d.headword is distinct from s.headword or d.primary_meaning is distinct from s.primary_meaning)) then
    raise exception 'composition_lineage_changed' using errcode='40001'; end if;
  return query select l.vocab_entry_id,l.source_entry_id,l.source_release_id,l.release_id from word_index.mock_wordbook_lineage l
    where l.vocab_entry_id=any(p_entry_ids) and l.included;
end;
$$;

alter table public.assignment_questions add column composition_target_key_snapshot text;
create unique index assignment_composition_target_once on public.assignment_questions(assignment_id,composition_target_key_snapshot)
  where composition_target_key_snapshot is not null;
create function private.set_composition_question_identity()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  new.composition_target_key_snapshot := (select l.identity_key from word_index.mock_wordbook_lineage l where l.vocab_entry_id=new.vocab_entry_id);
  return new;
end;
$$;
create trigger assignment_composition_identity before insert or update on public.assignment_questions
  for each row execute function private.set_composition_question_identity();

revoke all on function private.reject_mock_wordbook_history_change(), private.mock_wordbook_source_version(uuid,uuid,jsonb,text),
  private.set_composition_question_identity(), public.register_mock_wordbook_scopes_v1(jsonb), public.list_mock_wordbook_scopes_v1(),
  public.create_mock_wordbook_composition_v1(jsonb),public.list_mock_composition_targets_v1(uuid),public.list_mock_composition_lineage_v1(bigint[]) from public,anon,authenticated;
grant execute on function public.register_mock_wordbook_scopes_v1(jsonb) to service_role;
grant execute on function public.list_mock_wordbook_scopes_v1(),public.create_mock_wordbook_composition_v1(jsonb),public.list_mock_composition_targets_v1(uuid) to authenticated;
grant execute on function public.list_mock_composition_lineage_v1(bigint[]) to service_role;

-- Contents are fixed once the composition is published. Retirement can change
-- dataset/release availability, but never the saved wording, scope or lineage.
create function private.protect_mock_composition_content()
returns trigger language plpgsql security definer set search_path = '' as $$
declare composed boolean; before_row jsonb; after_row jsonb;
begin
  before_row := case when tg_op <> 'INSERT' then to_jsonb(old) end;
  after_row := case when tg_op <> 'DELETE' then to_jsonb(new) end;
  if tg_table_name='vocab_unit_catalog' then
    select exists(select 1 from word_index.mock_wordbook_composition c join public.vocab_units u on u.dataset_id=c.dataset_id
      where u.id in ((before_row->>'unit_id')::uuid,(after_row->>'unit_id')::uuid)) into composed;
  else
    select exists(select 1 from word_index.mock_wordbook_composition c where c.dataset_id in ((before_row->>'dataset_id')::uuid,(after_row->>'dataset_id')::uuid)) into composed;
  end if;
  if composed then raise exception 'mock_composition_content_is_immutable' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger mock_composed_entries_immutable before insert or update or delete on public.vocab_entries
  for each row execute function private.protect_mock_composition_content();
create trigger mock_composed_units_immutable before insert or update or delete on public.vocab_units
  for each row execute function private.protect_mock_composition_content();
create trigger mock_composed_unit_catalog_immutable before insert or update or delete on public.vocab_unit_catalog
  for each row execute function private.protect_mock_composition_content();
create trigger mock_composed_occurrences_immutable before insert or update or delete on word_index.app_exam_use_occurrence
  for each row execute function private.protect_mock_composition_content();
revoke all on function private.protect_mock_composition_content() from public,anon,authenticated;

create function private.protect_mock_composition_metadata()
returns trigger language plpgsql security definer set search_path = '' as $$
declare before_row jsonb:=to_jsonb(old); after_row jsonb; composed boolean; mutable_keys text[];
begin
  if tg_op<>'DELETE' then after_row:=to_jsonb(new); end if;
  if tg_table_name='app_exam_use_release' then
    select exists(select 1 from word_index.mock_wordbook_composition c where c.release_id=(before_row->>'release_id')::uuid) into composed;
    mutable_keys:=array['status','activated_at_utc','retired_at_utc','failure_detail'];
  elsif tg_table_name='vocab_datasets' then
    select exists(select 1 from word_index.mock_wordbook_composition c where c.dataset_id=(before_row->>'id')::uuid) into composed;
    mutable_keys:=array['status','is_active','updated_at'];
  else
    select exists(select 1 from word_index.mock_wordbook_composition c where c.dataset_id=(before_row->>'dataset_id')::uuid) into composed;
    mutable_keys:=array['is_assignable','updated_at'];
  end if;
  if composed and (tg_op='DELETE' or (before_row-mutable_keys) is distinct from (after_row-mutable_keys)) then
    raise exception 'mock_composition_content_is_immutable' using errcode='22023'; end if;
  if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
create trigger mock_composed_dataset_metadata_immutable before update or delete on public.vocab_datasets
  for each row execute function private.protect_mock_composition_metadata();
create trigger mock_composed_release_metadata_immutable before update or delete on word_index.app_exam_use_release
  for each row execute function private.protect_mock_composition_metadata();
create trigger mock_composed_catalog_metadata_immutable before update or delete on public.vocab_dataset_catalog
  for each row execute function private.protect_mock_composition_metadata();
revoke all on function private.protect_mock_composition_metadata() from public,anon,authenticated;

commit;
