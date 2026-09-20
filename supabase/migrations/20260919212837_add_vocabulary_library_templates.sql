begin;

-- These are source-bound selections, not new dictionary approvals.
create table private.vocabulary_library_import_approvals (
  target_project_ref text not null,
  file_sha256 text not null check(file_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  scope_count integer not null check(scope_count between 1 and 5000),
  approval_id text not null,
  primary key(target_project_ref,file_sha256)
);
create table private.vocabulary_library_scopes (
  id uuid primary key default extensions.gen_random_uuid(),
  revision bigint generated always as identity unique,
  scope_key text not null check(length(scope_key) between 1 and 200),
  version text not null check(version ~ '^[a-f0-9]{64}$'),
  dataset_id uuid not null references public.vocab_datasets(id),
  unit_id uuid not null references public.vocab_units(id),
  source_kind text not null check(source_kind in ('legacy_vocab','exam_use','reviewed_exam')),
  source_release_id uuid,
  source_version text not null check(source_version ~ '^[a-f0-9]{64}$'),
  source_file_sha256 text not null check(source_file_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check(jsonb_typeof(payload)='object'),
  review_references jsonb not null check(jsonb_typeof(review_references)='object'),
  import_file_sha256 text not null,
  unique(scope_key,version),
  check((source_kind='legacy_vocab')=(source_release_id is null))
);
create table private.vocabulary_library_scope_rows (
  scope_id uuid not null references private.vocabulary_library_scopes(id),
  occurrence_key text not null check(occurrence_key ~ '^[a-f0-9]{64}$'),
  source_row integer not null check(source_row>0),
  source_entry_id bigint references public.vocab_entries(id),
  row_sha256 text not null check(row_sha256 ~ '^[a-f0-9]{64}$'),
  state text not null check(state in ('included','held','excluded')),
  entry_snapshot jsonb,
  occurrence_snapshot jsonb,
  resources jsonb not null check(jsonb_typeof(resources)='object'),
  primary key(scope_id,occurrence_key), unique(scope_id,source_row),
  check((state='included')=(source_entry_id is not null)),
  check((state='included')=(entry_snapshot is not null))
);
create index vocabulary_library_rows_entry on private.vocabulary_library_scope_rows(source_entry_id);
create table private.vocabulary_library_templates (
  id uuid primary key default extensions.gen_random_uuid(),
  revision integer not null default 1 check(revision>0),
  metadata jsonb not null check(jsonb_typeof(metadata)='object'),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table private.vocabulary_library_versions (
  id uuid primary key default extensions.gen_random_uuid(),
  template_id uuid not null references private.vocabulary_library_templates(id),
  number integer not null check(number>0),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  recipe jsonb not null check(jsonb_typeof(recipe)='object'),
  fixed_composition jsonb not null check(jsonb_typeof(fixed_composition)='object'),
  source_version_id uuid references private.vocabulary_library_versions(id),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  unique(template_id,number)
);
create table private.vocabulary_library_requests (
  actor_id uuid not null references auth.users(id),
  request_id uuid not null,
  request_hash text not null check(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb not null,
  primary key(actor_id,request_id)
);

alter table private.vocabulary_library_import_approvals enable row level security;
alter table private.vocabulary_library_scopes enable row level security;
alter table private.vocabulary_library_scope_rows enable row level security;
alter table private.vocabulary_library_templates enable row level security;
alter table private.vocabulary_library_versions enable row level security;
alter table private.vocabulary_library_requests enable row level security;
revoke all on private.vocabulary_library_import_approvals,private.vocabulary_library_scopes,
  private.vocabulary_library_scope_rows,private.vocabulary_library_templates,
  private.vocabulary_library_versions,private.vocabulary_library_requests from public,anon,authenticated,service_role;

create trigger vocabulary_library_scope_immutable before update or delete on private.vocabulary_library_scopes
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger vocabulary_library_rows_immutable before update or delete on private.vocabulary_library_scope_rows
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger vocabulary_library_version_immutable before update or delete on private.vocabulary_library_versions
  for each row execute function private.reject_mock_wordbook_history_change();
create trigger vocabulary_library_request_immutable before update or delete on private.vocabulary_library_requests
  for each row execute function private.reject_mock_wordbook_history_change();

-- Boundaries are rechecked against the actual source, including partial units.
create function private.vocabulary_library_source_state_v1(p_scope private.vocabulary_library_scopes)
returns text language plpgsql stable security definer set search_path='' as $$
declare d public.vocab_datasets; actual_version text; active boolean;
begin
  select * into d from public.vocab_datasets where id=p_scope.dataset_id;
  if not found or d.status<>'ready' or not d.is_active or not exists(
    select 1 from public.vocab_dataset_catalog c where c.dataset_id=d.id and c.is_assignable)
    then return 'retired'; end if;
  if p_scope.source_kind='exam_use' then
    select lower(package_version),status='active' into actual_version,active
      from word_index.app_exam_use_release where release_id=p_scope.source_release_id and dataset_id=d.id;
  elsif p_scope.source_kind='reviewed_exam' then
    select content_sha256,status='active' into actual_version,active
      from private.reviewed_exam_releases where release_id=p_scope.source_release_id and dataset_id=d.id;
  else
    actual_version:=lower(d.source_sha256); active:=true;
  end if;
  if active is distinct from true then return 'retired'; end if;
  if actual_version is distinct from p_scope.source_version then return 'changed'; end if;
  if exists(select 1 from private.vocabulary_library_scope_rows r
    left join public.vocab_entries e on e.id=r.source_entry_id
    left join word_index.app_exam_use_occurrence o on p_scope.source_kind='exam_use'
      and o.release_id=p_scope.source_release_id and o.source_row=r.source_row
    left join private.reviewed_exam_entries re on p_scope.source_kind='reviewed_exam'
      and re.release_id=p_scope.source_release_id and re.source_row=r.source_row
    where r.scope_id=p_scope.id and (
      (r.state='included' and (to_jsonb(e) is distinct from r.entry_snapshot or e.dataset_id is distinct from p_scope.dataset_id
        or e.unit_id is distinct from p_scope.unit_id)) or
      (p_scope.source_kind='exam_use' and to_jsonb(o) is distinct from r.occurrence_snapshot) or
      (p_scope.source_kind='reviewed_exam' and to_jsonb(re) is distinct from r.occurrence_snapshot))) then return 'changed'; end if;
  return 'available';
end;
$$;

create function private.validate_vocabulary_library_classification_v1(c jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare k text; value_node jsonb; exam jsonb; nums text;
begin
  if jsonb_typeof(c) is distinct from 'object' or (select count(*) from jsonb_object_keys(c))<>12
    or not(c ?& array['kind','sourceGrade','exam','lesson','day','publisher','school','targetGrade','schoolYear','semester','assessment','purpose'])
    or coalesce(c->>'kind','') not in ('textbook','wordbook','mock','csat','school','unclassified') then
    raise exception 'invalid_library_classification' using errcode='22023'; end if;
  foreach k in array array['sourceGrade','targetGrade','publisher','school','assessment','purpose'] loop
    value_node:=c->k;
    if value_node<>'null'::jsonb and (jsonb_typeof(value_node)<>'string' or length(trim(c->>k)) not between 1 and
      case when k in ('sourceGrade','targetGrade') then 40 else 240 end) then
      raise exception 'invalid_library_label' using errcode='22023'; end if;
  end loop;
  foreach k in array array['lesson','day','schoolYear','semester'] loop
    value_node:=c->k;
    if value_node<>'null'::jsonb and (jsonb_typeof(value_node)<>'number' or value_node::text !~ '^[0-9]+$' or
      (c->>k)::integer not between case when k='schoolYear' then 2000 else 1 end
      and case when k='schoolYear' then 2100 when k='semester' then 2 else 999 end) then
      raise exception 'invalid_library_number' using errcode='22023'; end if;
  end loop;
  exam:=c->'exam';
  if exam<>'null'::jsonb then
    if jsonb_typeof(exam)<>'object' or (select count(*) from jsonb_object_keys(exam))<>9 or
      not(exam ?& array['executionYear','examMonth','examKind','academicYear','agency','typeCode','typeLabel','questionNumbers','sharedPassage']) or
      coalesce(exam->>'examKind','') not in ('mock','csat') or
      jsonb_typeof(exam->'executionYear')<>'number' or coalesce(exam->>'executionYear','') !~ '^[0-9]{4}$' or (exam->>'executionYear')::integer not between 2000 and 2100 or
      jsonb_typeof(exam->'examMonth')<>'number' or coalesce(exam->>'examMonth','') !~ '^[0-9]{1,2}$' or (exam->>'examMonth')::integer not between 1 and 12 or
      (exam->'academicYear'<>'null'::jsonb and (jsonb_typeof(exam->'academicYear')<>'number' or coalesce(exam->>'academicYear','') !~ '^[0-9]{4}$' or (exam->>'academicYear')::integer not between 2000 and 2101)) or
      jsonb_typeof(exam->'agency')<>'string' or jsonb_typeof(exam->'typeLabel')<>'string' or jsonb_typeof(exam->'typeCode')<>'string' or
      length(trim(coalesce(exam->>'agency',''))) not between 1 and 80 or
      length(trim(coalesce(exam->>'typeLabel',''))) not between 1 and 80 or
      coalesce(exam->>'typeCode','') !~ '^[a-z0-9_]{1,80}$' or jsonb_typeof(exam->'sharedPassage') is distinct from 'boolean' or
      jsonb_typeof(exam->'questionNumbers') is distinct from 'array' or jsonb_array_length(exam->'questionNumbers') not between 1 and 3 then
      raise exception 'invalid_library_exam' using errcode='22023'; end if;
    if exists(select 1 from jsonb_array_elements(exam->'questionNumbers') x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]+$' or x::text::integer not between 1 and 45)
      or exists(select 1 from (select value::integer n,lag(value::integer) over(order by ord) previous from
        jsonb_array_elements_text(exam->'questionNumbers') with ordinality q(value,ord)) x where n<=previous) then
      raise exception 'invalid_library_questions' using errcode='22023'; end if;
    select string_agg(value,',' order by ord) into nums from jsonb_array_elements_text(exam->'questionNumbers') with ordinality q(value,ord);
    if ((exam->>'sharedPassage')::boolean and nums not in ('41,42','43,44,45')) or
      (not(exam->>'sharedPassage')::boolean and exists(select 1 from jsonb_array_elements_text(exam->'questionNumbers') x where x::integer>=41)) then
      raise exception 'invalid_library_long_reading' using errcode='22023'; end if;
  end if;
  if c->>'kind' in ('mock','csat') and c->>'kind' is distinct from exam->>'examKind' then
    raise exception 'invalid_library_exam_kind' using errcode='22023'; end if;
end;
$$;

create function public.import_vocabulary_library_v1(p_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; approval private.vocabulary_library_import_approvals; file_hash text; s jsonb; src jsonb; rr jsonb;
  d public.vocab_datasets; e public.vocab_entries; o word_index.app_exam_use_occurrence; re private.reviewed_exam_entries;
  rid uuid; uid uuid; kind text; actual_version text; source_active boolean; eid bigint; rh text; state text;
  row_doc jsonb; rows_doc jsonb; public_rows jsonb; occurrence jsonb; proof jsonb; ver text; sid uuid; result jsonb:='[]'; key text;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'service_role_required' using errcode='42501'; end if;
  if octet_length(p_text)>100000000 then raise exception 'library_import_too_large' using errcode='22023'; end if;
  file_hash:=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex'); b:=p_text::jsonb;
  select * into approval from private.vocabulary_library_import_approvals
    where target_project_ref=private.request_supabase_project_ref_v1() and file_sha256=file_hash for update;
  if not found or approval.content_sha256<>private.reviewed_exam_sha256_v1(b) then
    raise exception 'library_import_not_approved' using errcode='42501'; end if;
  if jsonb_typeof(b)<>'object' or (select count(*) from jsonb_object_keys(b))<>5 or
    not(b ?& array['schemaVersion','sourceCatalogHash','linksHash','referenceCatalogHash','scopes']) or
    b->>'schemaVersion' is distinct from 'vocabulary-library-import-v1' or jsonb_typeof(b->'scopes') is distinct from 'array'
    or jsonb_array_length(b->'scopes')<>approval.scope_count then raise exception 'invalid_library_import' using errcode='22023'; end if;
  proof:=jsonb_build_object('sourceCatalogHash',b->'sourceCatalogHash','linksHash',b->'linksHash','referenceCatalogHash',b->'referenceCatalogHash');
  if exists(select 1 from jsonb_each_text(proof) where value !~ '^[a-f0-9]{64}$' or value is null)
    or (select count(distinct x->>'key') from jsonb_array_elements(b->'scopes') x)<>approval.scope_count then
    raise exception 'invalid_library_references' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-scope-capacity',0));
  if (select count(*) from (select scope_key from private.vocabulary_library_scopes union select x->>'key' from jsonb_array_elements(b->'scopes') x) k)>5000 then
    raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  -- Source locks close status/entry changes during import and composition save.
  perform 1 from public.vocab_datasets where id in(select (x->'source'->>'datasetId')::uuid from jsonb_array_elements(b->'scopes') x) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id in(select (x->'source'->>'datasetId')::uuid from jsonb_array_elements(b->'scopes') x) order by dataset_id for share;
  for s in select value from jsonb_array_elements(b->'scopes') loop
    if jsonb_typeof(s)<>'object' or (select count(*) from jsonb_object_keys(s))<>6 or not(s ?& array['key','name','sourceTitle','source','classification','rows'])
      or jsonb_typeof(s->'source')<>'object' or (select count(*) from jsonb_object_keys(s->'source'))<>7
      or not(s->'source' ?& array['datasetId','unitId','kind','releaseId','releaseVersion','fileHash','locator'])
      or jsonb_typeof(s->'name')<>'string' or jsonb_typeof(s->'key')<>'string' or jsonb_typeof(s->'sourceTitle')<>'string' then
      raise exception 'invalid_library_scope_shape' using errcode='22023'; end if;
    src:=s->'source'; kind:=src->>'kind'; rid:=(src->>'releaseId')::uuid; uid:=(src->>'unitId')::uuid;
    if exists(select 1 from jsonb_each(src) q where q.key<>'releaseId' and jsonb_typeof(q.value)<>'string') or
      (jsonb_typeof(src->'releaseId') not in ('string','null')) then raise exception 'invalid_library_source_shape' using errcode='22023'; end if;
    select * into d from public.vocab_datasets where id=(src->>'datasetId')::uuid;
    if not found or d.status<>'ready' or not d.is_active or d.metadata ? 'compositionVersion'
      or not exists(select 1 from public.vocab_dataset_catalog c where c.dataset_id=d.id and c.is_assignable)
      or not exists(select 1 from public.vocab_units u where u.id=uid and u.dataset_id=d.id) then
      raise exception 'library_source_unavailable' using errcode='22023'; end if;
    actual_version:=null; source_active:=false;
    if kind='exam_use' and rid is not null then
      select lower(package_version),status='active' and exam_use_import_allowed and not common_dictionary_release_allowed
        into actual_version,source_active from word_index.app_exam_use_release where release_id=rid and dataset_id=d.id for share;
    elsif kind='reviewed_exam' and rid is not null then
      select content_sha256,status='active' into actual_version,source_active from private.reviewed_exam_releases where release_id=rid and dataset_id=d.id for share;
    elsif kind='legacy_vocab' and rid is null and not exists(select 1 from word_index.app_exam_use_release where dataset_id=d.id)
      and not exists(select 1 from private.reviewed_exam_releases where dataset_id=d.id) then
      actual_version:=lower(d.source_sha256); source_active:=true;
    end if;
    if source_active is distinct from true or actual_version is distinct from src->>'releaseVersion' then
      raise exception 'library_source_version_changed' using errcode='40001'; end if;
    perform private.validate_vocabulary_library_classification_v1(s->'classification');
    if length(trim(coalesce(s->>'name',''))) not between 1 and 240 or length(trim(coalesce(s->>'sourceTitle',''))) not between 1 and 240
      or length(trim(coalesce(s->>'key',''))) not between 1 and 200 or src->>'fileHash' !~ '^[a-f0-9]{64}$'
      or length(trim(coalesce(src->>'locator',''))) not between 1 and 240
      or jsonb_typeof(s->'rows') is distinct from 'array' or jsonb_array_length(s->'rows') not between 1 and 20000
      or (select count(distinct x->>'sourceRow') from jsonb_array_elements(s->'rows') x)<>jsonb_array_length(s->'rows') then
      raise exception 'invalid_library_scope' using errcode='22023'; end if;
    rows_doc:='[]'; public_rows:='[]';
    for rr in select value from jsonb_array_elements(s->'rows') order by (value->>'sourceRow')::integer loop
      if jsonb_typeof(rr)<>'object' or (select count(*) from jsonb_object_keys(rr))<>3 or not(rr ?& array['sourceRow','rowHash','resources'])
        or jsonb_typeof(rr->'sourceRow')<>'number' or rr->>'sourceRow' !~ '^[0-9]+$' or (rr->>'sourceRow')::integer<1
        or jsonb_typeof(rr->'resources')<>'object' or (select count(*) from jsonb_object_keys(rr->'resources'))<>3
        or not(rr->'resources' ?& array['entryHash','linkRecordHash','selected']) then raise exception 'invalid_library_row_shape' using errcode='22023'; end if;
      e:=null; o:=null; re:=null; eid:=null; occurrence:=null; rh:=null; state:='included';
      if kind='exam_use' then
        select * into o from word_index.app_exam_use_occurrence where release_id=rid and source_row=(rr->>'sourceRow')::integer and unit_id=uid for share;
        if not found then raise exception 'library_source_row_missing' using errcode='40001'; end if;
        eid:=o.vocab_entry_id; occurrence:=to_jsonb(o);
        state:=case when o.include_in_exam then 'included' when o.exam_use_status='excluded' then 'excluded' else 'held' end;
        rh:=lower(o.occurrence_content_hash);
      elsif kind='reviewed_exam' then
        select * into re from private.reviewed_exam_entries where release_id=rid and source_row=(rr->>'sourceRow')::integer for share;
        if not found then raise exception 'library_source_row_missing' using errcode='40001'; end if;
        eid:=re.vocab_entry_id; occurrence:=to_jsonb(re);
      else
        select id into eid from public.vocab_entries where dataset_id=d.id and source_row=(rr->>'sourceRow')::integer and unit_id=uid;
      end if;
      if state='included' then
        select * into e from public.vocab_entries where id=eid and dataset_id=d.id and unit_id=uid for share;
        if not found then raise exception 'library_entry_mismatch' using errcode='40001'; end if;
        rh:=lower(e.row_sha256);
        if rr->'resources'->>'entryHash' is distinct from rh then raise exception 'library_resource_entry_mismatch' using errcode='40001'; end if;
      elsif rr->'resources'->'entryHash' is distinct from 'null'::jsonb then
        raise exception 'library_nonincluded_resource_entry' using errcode='22023';
      end if;
      if rh is distinct from rr->>'rowHash' or jsonb_typeof(rr->'resources') is distinct from 'object'
        or coalesce(rr->'resources'->>'linkRecordHash','') !~ '^[a-f0-9]{64}$'
        or jsonb_typeof(rr->'resources'->'selected') is distinct from 'object' then
        raise exception 'library_row_or_reference_changed' using errcode='40001'; end if;
      key:=private.reviewed_exam_sha256_v1(jsonb_build_array(kind,d.id,rid,actual_version,src->>'fileHash',(rr->>'sourceRow')::integer));
      row_doc:=jsonb_build_object('key',key,'sourceRow',(rr->>'sourceRow')::integer,'sourceEntryId',eid,'rowHash',rh,'state',state,'headword',e.headword,'meaning',e.primary_meaning);
      public_rows:=public_rows||jsonb_build_array(row_doc);
      rows_doc:=rows_doc||jsonb_build_array(row_doc||jsonb_build_object('entry',case when eid is not null then to_jsonb(e) end,'occurrence',occurrence,'resources',rr->'resources'));
    end loop;
    ver:=private.reviewed_exam_sha256_v1(jsonb_build_object('key',s->'key','source',src,'classification',s->'classification','rows',rows_doc,'references',proof));
    select id into sid from private.vocabulary_library_scopes where scope_key=s->>'key' and version=ver;
    if sid is null then
      insert into private.vocabulary_library_scopes(scope_key,version,dataset_id,unit_id,source_kind,source_release_id,source_version,source_file_sha256,payload,review_references,import_file_sha256)
        values(s->>'key',ver,d.id,uid,kind,rid,actual_version,src->>'fileHash',
          jsonb_build_object('name',s->'name','sourceTitle',s->'sourceTitle','source',src,'classification',s->'classification','occurrences',public_rows),proof,file_hash)
        on conflict(scope_key,version) do nothing returning id into sid;
      if sid is null then
        select id into sid from private.vocabulary_library_scopes where scope_key=s->>'key' and version=ver;
      else
        insert into private.vocabulary_library_scope_rows(scope_id,occurrence_key,source_row,source_entry_id,row_sha256,state,entry_snapshot,occurrence_snapshot,resources)
          select sid,x->>'key',(x->>'sourceRow')::integer,(x->>'sourceEntryId')::bigint,x->>'rowHash',x->>'state',nullif(x->'entry','null'),nullif(x->'occurrence','null'),x->'resources'
          from jsonb_array_elements(rows_doc) x;
      end if;
    end if;
    result:=result||jsonb_build_array(jsonb_build_object('key',s->'key','id',sid,'version',ver));
  end loop;
  return jsonb_build_object('scopes',result);
end;
$$;

create function private.validate_vocabulary_library_metadata_v1(m jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare k text;
begin
  if jsonb_typeof(m) is distinct from 'object' or (select count(*) from jsonb_object_keys(m))<>8 or
    not(m ?& array['title','tags','school','targetGrade','schoolYear','semester','assessment','purpose']) or
    jsonb_typeof(m->'title') is distinct from 'string' or length(trim(coalesce(m->>'title',''))) not between 1 and 100 or
    jsonb_typeof(m->'tags') is distinct from 'array' or jsonb_array_length(m->'tags')>30 then
    raise exception 'invalid_library_metadata' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements(m->'tags') t where jsonb_typeof(t)<>'string' or length(trim(t#>>'{}')) not between 1 and 40) or
    (select count(distinct trim(t)) from jsonb_array_elements_text(m->'tags') t)<>jsonb_array_length(m->'tags') then
    raise exception 'invalid_library_tags' using errcode='22023'; end if;
  foreach k in array array['school','targetGrade','assessment','purpose'] loop
    if m->k<>'null'::jsonb and (jsonb_typeof(m->k)<>'string' or length(trim(m->>k)) not between 1 and case when k='targetGrade' then 40 else 240 end) then
      raise exception 'invalid_library_metadata_label' using errcode='22023'; end if;
  end loop;
  if (m->'schoolYear'<>'null'::jsonb and (jsonb_typeof(m->'schoolYear')<>'number' or m->>'schoolYear' !~ '^[0-9]{4}$' or (m->>'schoolYear')::integer not between 2000 and 2100)) or
    (m->'semester'<>'null'::jsonb and m->'semester' not in ('1'::jsonb,'2'::jsonb)) then raise exception 'invalid_library_metadata_number' using errcode='22023'; end if;
end;
$$;

create function private.validate_vocabulary_library_filters_v1(f jsonb)
returns void language plpgsql immutable set search_path='' as $$
declare k text; val jsonb; max_count integer; max_length integer; low integer; high integer;
begin
  if jsonb_typeof(f) is distinct from 'object' or (select count(*) from jsonb_object_keys(f))<>17
    or not(f ?& array['search','kinds','years','yearFrom','yearTo','months','types','questions','sourceGrades','dayFrom','dayTo','lessons','schools','targetGrades','semesters','assessments','purposes'])
    or jsonb_typeof(f->'search') is distinct from 'string' or length(f->>'search')>240 then raise exception 'invalid_library_filters' using errcode='22023'; end if;
  foreach k in array array['yearFrom','yearTo','dayFrom','dayTo'] loop
    val:=f->k; low:=case when k like 'year%' then 2000 else 1 end; high:=case when k like 'year%' then 2100 else 999 end;
    if val<>'null'::jsonb and (jsonb_typeof(val)<>'number' or val::text !~ '^[0-9]+$' or val::text::integer not between low and high) then
      raise exception 'invalid_library_filter_range' using errcode='22023'; end if;
  end loop;
  if (f->>'yearFrom')::integer>(f->>'yearTo')::integer or (f->>'dayFrom')::integer>(f->>'dayTo')::integer then
    raise exception 'invalid_library_filter_order' using errcode='22023'; end if;
  foreach k in array array['kinds','years','months','types','questions','sourceGrades','lessons','schools','targetGrades','semesters','assessments','purposes'] loop
    val:=f->k;
    max_count:=case k when 'kinds' then 6 when 'years' then 101 when 'months' then 12 when 'questions' then 45 when 'semesters' then 2
      when 'sourceGrades' then 20 when 'targetGrades' then 20 when 'assessments' then 50 when 'purposes' then 50 else 100 end;
    if jsonb_typeof(val)<>'array' or jsonb_array_length(val)>max_count or
      (select count(distinct x) from jsonb_array_elements(val) x)<>jsonb_array_length(val) then raise exception 'invalid_library_filter_array' using errcode='22023'; end if;
    if k in ('years','months','questions','lessons','semesters') then
      low:=case when k='years' then 2000 else 1 end;
      high:=case k when 'years' then 2100 when 'months' then 12 when 'questions' then 45 when 'semesters' then 2 else 999 end;
      if exists(select 1 from jsonb_array_elements(val) x where jsonb_typeof(x)<>'number' or x::text !~ '^[0-9]+$' or x::text::integer not between low and high) then
        raise exception 'invalid_library_filter_numbers' using errcode='22023'; end if;
    else
      max_length:=case when k in ('sourceGrades','targetGrades') then 40 when k='types' then 80 else 240 end;
      if k in ('schools','assessments','purposes') and (select count(distinct trim(x)) from jsonb_array_elements_text(val) x)<>jsonb_array_length(val) then
        raise exception 'invalid_library_filter_labels' using errcode='22023'; end if;
      if exists(select 1 from jsonb_array_elements(val) x where jsonb_typeof(x)<>'string' or length(trim(x#>>'{}')) not between 1 and max_length
        or (k='kinds' and x#>>'{}' not in ('textbook','wordbook','mock','csat','school','unclassified'))) then
        raise exception 'invalid_library_filter_labels' using errcode='22023'; end if;
    end if;
  end loop;
end;
$$;

create function private.resolve_vocabulary_library_recipe_v1(r jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.vocabulary_library_scopes; picked jsonb;
  membership_map jsonb; row_list jsonb; included jsonb; ranges jsonb:='[]'; total integer; conflicting boolean;
begin
  if jsonb_typeof(r) is distinct from 'object' or (select count(*) from jsonb_object_keys(r))<>4 or not(r ?& array['filters','scopes','excludedOccurrenceKeys','scopeStatus'])
    or jsonb_typeof(r->'filters') is distinct from 'object' or octet_length((r->'filters')::text)>20000
    or jsonb_typeof(r->'scopes') is distinct from 'array' or jsonb_array_length(r->'scopes')>2000
    or jsonb_typeof(r->'excludedOccurrenceKeys') is distinct from 'array' or jsonb_array_length(r->'excludedOccurrenceKeys')>20000
    or coalesce(r->>'scopeStatus','') not in ('confirmed','unconfirmed') or
    (r->>'scopeStatus'='unconfirmed' and jsonb_array_length(r->'scopes')<>0) then raise exception 'invalid_library_recipe' using errcode='22023'; end if;
  perform private.validate_vocabulary_library_filters_v1(r->'filters');
  if (select count(distinct x->>'id') from jsonb_array_elements(r->'scopes') x)<>jsonb_array_length(r->'scopes') or
    (select count(distinct x) from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x)<>jsonb_array_length(r->'excludedOccurrenceKeys') or
    exists(select 1 from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x where x !~ '^[a-f0-9]{64}$' or x is null) then
    raise exception 'invalid_library_duplicates' using errcode='22023'; end if;
  perform 1 from public.vocab_datasets where id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  perform 1 from public.vocab_dataset_catalog where dataset_id in(select dataset_id from private.vocabulary_library_scopes where id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by dataset_id for share;
  perform 1 from word_index.app_exam_use_release where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='exam_use' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from private.reviewed_exam_releases where release_id in(select source_release_id from private.vocabulary_library_scopes where source_kind='reviewed_exam' and id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by release_id for share;
  perform 1 from public.vocab_entries where id in(select source_entry_id from private.vocabulary_library_scope_rows where scope_id in
    (select (x->>'id')::uuid from jsonb_array_elements(r->'scopes') x)) order by id for share;
  for picked in select value from jsonb_array_elements(r->'scopes') loop
    if jsonb_typeof(picked)<>'object' or (select count(*) from jsonb_object_keys(picked))<>2 then raise exception 'invalid_library_pick' using errcode='22023'; end if;
    select * into s from private.vocabulary_library_scopes where id=(picked->>'id')::uuid;
    if not found then raise exception 'library_scope_missing' using errcode='40001'; end if;
    if s.version is distinct from picked->>'version' or private.vocabulary_library_source_state_v1(s)<>'available' then
      raise exception 'library_scope_changed' using errcode='40001'; end if;
    ranges:=ranges||jsonb_build_array(jsonb_build_object('id',s.id,'version',s.version,'source',s.payload->'source','classification',s.payload->'classification','references',s.review_references));
  end loop;
  -- Aggregate the immutable rows once. Repeatedly concatenating a growing JSON
  -- object copies the complete snapshot per word and becomes quadratic.
  with selected as materialized (
    select (value->>'id')::uuid id, ordinality as scope_order
      from jsonb_array_elements(r->'scopes') with ordinality
  ), documents as materialized (
    select sr.occurrence_key key,sr.source_row,sr.state,selected.scope_order,selected.id scope_id,sr.resources->'linkRecordHash' link_hash,
      jsonb_build_object('key',sr.occurrence_key,'sourceRow',sr.source_row,'sourceEntryId',sr.source_entry_id,'rowHash',sr.row_sha256,
        'sourceClassification',(scope_record.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'],
        'state',sr.state,'entry',sr.entry_snapshot,'occurrence',sr.occurrence_snapshot,'resources',sr.resources-'linkRecordHash') doc
    from selected join private.vocabulary_library_scopes scope_record on scope_record.id=selected.id
      join private.vocabulary_library_scope_rows sr on sr.scope_id=selected.id
  ), merged as (
    select key,min(scope_order) first_scope,min(source_row) source_row,min(state) state,
      (array_agg(doc order by scope_order))[1] doc,count(distinct doc)>1 conflict,
      jsonb_agg(scope_id order by scope_order) scope_ids,jsonb_agg(distinct link_hash order by link_hash) hashes
      from documents group by key
  ) select coalesce(jsonb_agg(jsonb_set(doc,'{resources,linkRecordHashes}',hashes) order by first_scope,source_row),'[]'::jsonb),
      coalesce(jsonb_object_agg(key,scope_ids),'{}'::jsonb),
      coalesce(jsonb_agg(key order by first_scope,source_row) filter(where state='included' and not(r->'excludedOccurrenceKeys' ? key)),'[]'::jsonb),
      count(*)::int,coalesce(bool_or(conflict),false)
    into row_list,membership_map,included,total,conflicting from merged;
  if conflicting then raise exception 'library_overlapping_rows_conflict' using errcode='40001'; end if;
  if total>20000 then raise exception 'library_composition_too_large' using errcode='22023'; end if;
  if exists(select 1 from jsonb_array_elements_text(r->'excludedOccurrenceKeys') x where not(membership_map ? x)) then
    raise exception 'library_exclusion_outside_scope' using errcode='22023'; end if;
  return jsonb_build_object('scopes',ranges,'occurrences',row_list,'rowScopes',membership_map,'includedKeys',included,'sourceCount',total,
    'excludedOccurrenceKeys',r->'excludedOccurrenceKeys','scopeStatus',r->'scopeStatus');
end;
$$;

create function private.vocabulary_library_template_json_v1(p_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('id',t.id,'revision',t.revision,'metadata',t.metadata,
    'versions',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'number',v.number,'contentHash',v.content_sha256,'recipe',v.recipe,
      'includedKeys',v.fixed_composition->'includedKeys','sourceCount',v.fixed_composition->'sourceCount',
      'sourceVersionId',v.source_version_id,'datasetId',null,'createdAt',v.created_at) order by v.number desc)
      from private.vocabulary_library_versions v where v.template_id=t.id),'[]'::jsonb))
    from private.vocabulary_library_templates t where t.id=p_id;
$$;

create function public.list_vocabulary_library_v1()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  return jsonb_build_object('viewerId',auth.uid(),'scopes',coalesce((select jsonb_agg(s.payload||jsonb_build_object('id',s.id,'version',s.version,
    'availability',private.vocabulary_library_source_state_v1(s)) order by s.revision) from private.vocabulary_library_scopes s
    where not exists(select 1 from private.vocabulary_library_scopes newer where newer.scope_key=s.scope_key and newer.revision>s.revision)),'[]'::jsonb),
    'templates',coalesce((select jsonb_agg(private.vocabulary_library_template_json_v1(t.id) order by t.updated_at desc,t.id)
      from private.vocabulary_library_templates t),'[]'::jsonb));
end;
$$;

create function public.save_vocabulary_library_template_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
<<library_save>>
declare action text; request_id uuid; request_hash text; cached private.vocabulary_library_requests;
  t private.vocabulary_library_templates; previous private.vocabulary_library_versions; tid uuid; recipe jsonb; fixed jsonb; result jsonb; next_number integer:=1;
begin
  if not private.is_active_admin() then raise exception 'admin_required' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>3000000 then raise exception 'invalid_library_request' using errcode='22023'; end if;
  action:=p_request->>'action'; request_id:=(p_request->>'requestId')::uuid;
  if request_id is null or coalesce(action,'') not in ('create','metadata','version','copy') then raise exception 'invalid_library_action' using errcode='22023'; end if;
  if (select count(*) from jsonb_object_keys(p_request))<>(case action when 'create' then 4 when 'metadata' then 5 when 'version' then 6 else 4 end) or
    not(p_request ?& (case action when 'create' then array['action','requestId','metadata','recipe'] when 'metadata' then array['action','requestId','templateId','expectedRevision','metadata']
      when 'version' then array['action','requestId','templateId','expectedRevision','expectedContentHash','recipe'] else array['action','requestId','sourceVersionId','metadata'] end)) then
    raise exception 'invalid_library_request_fields' using errcode='22023'; end if;
  request_hash:=private.reviewed_exam_sha256_v1(p_request);
  perform pg_advisory_xact_lock(hashtextextended('vocabulary-library:'||auth.uid()::text||':'||request_id::text,0));
  select * into cached from private.vocabulary_library_requests where actor_id=auth.uid() and vocabulary_library_requests.request_id=library_save.request_id;
  if found then
    if cached.request_hash<>request_hash then raise exception 'library_request_reused' using errcode='40001'; end if;
    return cached.result;
  end if;
  if action in ('create','copy') then
    perform pg_advisory_xact_lock(hashtextextended('vocabulary-library-template-capacity',0));
    if (select count(*) from private.vocabulary_library_templates)>=5000 then raise exception 'invalid_library_capacity' using errcode='22023'; end if;
  end if;
  if action in ('metadata','version') then
    select * into t from private.vocabulary_library_templates where id=(p_request->>'templateId')::uuid for update;
    if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
    if t.revision is distinct from (p_request->>'expectedRevision')::integer then raise exception 'library_template_changed' using errcode='40001'; end if;
    tid:=t.id;
  end if;
  if action in ('metadata','create','copy') then perform private.validate_vocabulary_library_metadata_v1(p_request->'metadata'); end if;
  if action='metadata' then
    update private.vocabulary_library_templates set metadata=p_request->'metadata',revision=revision+1,updated_at=now() where id=tid;
  else
    if action='copy' then
      select * into previous from private.vocabulary_library_versions where id=(p_request->>'sourceVersionId')::uuid;
      if not found then raise exception 'library_template_not_found' using errcode='P0002'; end if;
      fixed:=previous.fixed_composition; recipe:=previous.recipe;
    else
      recipe:=p_request->'recipe'; fixed:=private.resolve_vocabulary_library_recipe_v1(recipe);
    end if;
    if action in ('create','copy') then
      insert into private.vocabulary_library_templates(metadata,created_by) values(p_request->'metadata',auth.uid()) returning id into tid;
    else
      select * into previous from private.vocabulary_library_versions where template_id=tid order by number desc limit 1;
      if previous.content_sha256 is distinct from p_request->>'expectedContentHash' then raise exception 'library_content_changed' using errcode='40001'; end if;
      next_number:=previous.number+1;
      if next_number>1000 then raise exception 'library_version_limit' using errcode='22023'; end if;
      update private.vocabulary_library_templates set revision=revision+1,updated_at=now() where id=tid;
    end if;
    insert into private.vocabulary_library_versions(template_id,number,content_sha256,recipe,fixed_composition,source_version_id,created_by)
      values(tid,next_number,private.reviewed_exam_sha256_v1(fixed),recipe,fixed,previous.id,auth.uid());
  end if;
  result:=jsonb_build_object('template',private.vocabulary_library_template_json_v1(tid));
  insert into private.vocabulary_library_requests(actor_id,request_id,request_hash,result) values(auth.uid(),request_id,request_hash,result);
  return result;
end;
$$;

revoke all on function private.vocabulary_library_source_state_v1(private.vocabulary_library_scopes),
  private.validate_vocabulary_library_classification_v1(jsonb),private.validate_vocabulary_library_metadata_v1(jsonb),
  private.validate_vocabulary_library_filters_v1(jsonb),private.resolve_vocabulary_library_recipe_v1(jsonb),private.vocabulary_library_template_json_v1(uuid) from public,anon,authenticated,service_role;
revoke all on function public.import_vocabulary_library_v1(text),public.list_vocabulary_library_v1(),public.save_vocabulary_library_template_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.import_vocabulary_library_v1(text) to service_role;
grant execute on function public.list_vocabulary_library_v1(),public.save_vocabulary_library_template_v1(jsonb) to authenticated;

commit;
