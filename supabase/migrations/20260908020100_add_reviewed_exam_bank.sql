begin;

-- Exam-only reviewed content is not a canonical dictionary release.
create function private.reviewed_exam_canonical_json_v1(p_value jsonb)
returns text language plpgsql immutable strict set search_path = '' as $$
declare result text;
begin
  case jsonb_typeof(p_value)
    when 'object' then select '{' || coalesce(string_agg(to_jsonb(key)::text || ':' || private.reviewed_exam_canonical_json_v1(value), ',' order by key collate "C"),'') || '}' into result from jsonb_each(p_value);
    when 'array' then select '[' || coalesce(string_agg(private.reviewed_exam_canonical_json_v1(value), ',' order by ordinal),'') || ']' into result from jsonb_array_elements(p_value) with ordinality v(value,ordinal);
    else result := p_value::text;
  end case;
  return result;
end;
$$;
create function private.reviewed_exam_sha256_v1(p_value jsonb)
returns text language sql immutable strict set search_path = '' as $$
  select encode(extensions.digest(convert_to(private.reviewed_exam_canonical_json_v1(p_value),'UTF8'),'sha256'),'hex');
$$;

create table private.reviewed_exam_import_approvals (
  target_project_ref text not null,
  bundle_file_sha256 text not null check(bundle_file_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  dataset_key text not null,
  entry_count integer not null check(entry_count > 0),
  question_count integer not null check(question_count > 0),
  approval_id text not null,
  primary key(target_project_ref,bundle_file_sha256)
);
create table private.reviewed_exam_releases (
  release_id uuid primary key default extensions.gen_random_uuid(),
  dataset_id uuid not null references public.vocab_datasets(id),
  content_sha256 text not null unique check(content_sha256 ~ '^[0-9a-f]{64}$'),
  file_sha256 text not null check(file_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check(status in ('staged','active','retired')),
  reviews jsonb not null check(jsonb_typeof(reviews)='array' and jsonb_array_length(reviews)=2),
  source_inputs jsonb not null,
  approval_id text not null,
  imported_at timestamptz not null default clock_timestamp(),
  activated_at timestamptz,
  unique(release_id,dataset_id)
);
create unique index reviewed_exam_one_active_release on private.reviewed_exam_releases(dataset_id) where status='active';
create table private.reviewed_exam_entries (
  release_id uuid not null,
  dataset_id uuid not null,
  vocab_entry_id bigint not null,
  source_row integer not null,
  predecessor_entry_id bigint not null references public.vocab_entries(id),
  pronunciation_identity_id text not null references public.vocab_pronunciation_identities_v2(identity_id),
  entry_sha256 text not null check(entry_sha256 ~ '^[0-9a-f]{64}$'),
  payload jsonb not null,
  primary key(release_id,vocab_entry_id),
  unique(release_id,source_row),
  foreign key(release_id,dataset_id) references private.reviewed_exam_releases(release_id,dataset_id),
  foreign key(vocab_entry_id,dataset_id) references public.vocab_entries(id,dataset_id)
);
create table private.reviewed_exam_items (
  release_id uuid not null,
  dataset_id uuid not null,
  vocab_entry_id bigint not null,
  item_id text not null,
  item_sha256 text not null check(item_sha256 ~ '^[0-9a-f]{64}$'),
  quiz_mode text not null,
  direction public.question_direction not null,
  prompt_role text not null,
  choice_role text not null,
  prompt text not null check(char_length(trim(prompt))>0),
  choice_texts text[] not null check(cardinality(choice_texts)=4 and array_position(choice_texts,null) is null),
  choice_vocab_entry_ids bigint[] not null check(cardinality(choice_vocab_entry_ids)=4 and array_position(choice_vocab_entry_ids,null) is null),
  correct_choice_index smallint not null check(correct_choice_index between 0 and 3),
  payload jsonb not null,
  primary key(release_id,item_id),
  unique(release_id,vocab_entry_id,quiz_mode,direction),
  foreign key(release_id,dataset_id) references private.reviewed_exam_releases(release_id,dataset_id),
  foreign key(release_id,vocab_entry_id) references private.reviewed_exam_entries(release_id,vocab_entry_id),
  check(choice_vocab_entry_ids[correct_choice_index+1]=vocab_entry_id),
  check(cardinality(array_positions(choice_vocab_entry_ids,vocab_entry_id))=1),
  check(
    (quiz_mode='book_meaning_choice' and direction='english_to_korean' and prompt_role='headword' and choice_role='korean_meaning') or
    (quiz_mode='book_meaning_choice' and direction='korean_to_english' and prompt_role='korean_meaning' and choice_role='headword') or
    (quiz_mode='canonical_definition_to_headword' and direction='korean_to_english' and prompt_role='english_definition' and choice_role='headword') or
    (quiz_mode='canonical_headword_to_definition' and direction='english_to_korean' and prompt_role='headword' and choice_role='english_definition')
  )
);
alter table private.reviewed_exam_import_approvals enable row level security;
alter table private.reviewed_exam_releases enable row level security;
alter table private.reviewed_exam_entries enable row level security;
alter table private.reviewed_exam_items enable row level security;
revoke all on private.reviewed_exam_import_approvals,private.reviewed_exam_releases,private.reviewed_exam_entries,private.reviewed_exam_items from public,anon,authenticated,service_role;

create function private.import_reviewed_exam_bundle_v1(p_text text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  bundle jsonb; file_sha text; content_sha text;
  approval private.reviewed_exam_import_approvals%rowtype;
  prior_dataset public.vocab_datasets%rowtype;
  dataset_value uuid; release_value uuid; unit_value uuid; entry_value bigint;
  entry_json jsonb; question_json jsonb; unit_json jsonb; prior_entry public.vocab_entries%rowtype;
  identity_value text; choice_ids bigint[]; choice_values text[]; target_entry private.reviewed_exam_entries%rowtype;
begin
  if p_text is null or octet_length(p_text)>20000000 then raise exception 'reviewed_exam_import_size_invalid'; end if;
  bundle := p_text::jsonb;
  file_sha := encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
  select * into approval from private.reviewed_exam_import_approvals
    where target_project_ref=private.request_supabase_project_ref_v1() and bundle_file_sha256=file_sha for share;
  if not found then raise exception 'reviewed_exam_import_not_approved' using errcode='42501'; end if;
  content_sha := private.reviewed_exam_sha256_v1(jsonb_build_object('dataset',bundle->'dataset','inputs',bundle->'inputs','units',bundle->'units','entries',bundle->'entries','questions',bundle->'questions'));
  if bundle->>'format' is distinct from 'reviewed-exam-bundle-v1' or bundle->>'schema_version' is distinct from '1'
    or bundle#>>'{permissions,canonical_approved}' is distinct from 'false'
    or bundle#>>'{permissions,release_allowed}' is distinct from 'true'
    or content_sha is distinct from approval.content_sha256 or content_sha is distinct from bundle->>'content_sha256'
    or bundle#>>'{dataset,key}' is distinct from approval.dataset_key
    or jsonb_array_length(bundle->'entries')<>approval.entry_count or jsonb_array_length(bundle->'questions')<>approval.question_count
    or jsonb_array_length(bundle->'reviews')<>2
  then raise exception 'reviewed_exam_bundle_invalid' using errcode='22023'; end if;
  if (select count(distinct r->>'reviewer') from jsonb_array_elements(bundle->'reviews') r
      where r->>'input_content_sha256'=content_sha and r->>'status'='passed' and r->>'report_sha256' ~ '^[0-9a-f]{64}$')<>2
  then raise exception 'reviewed_exam_review_incomplete'; end if;
  select release_id,dataset_id into release_value,dataset_value from private.reviewed_exam_releases where content_sha256=content_sha;
  if found then return jsonb_build_object('release_id',release_value,'dataset_id',dataset_value,'reused',true); end if;
  perform pg_advisory_xact_lock(hashtextextended(approval.dataset_key,0));
  if exists(select 1 from public.vocab_datasets where dataset_key=approval.dataset_key) then raise exception 'reviewed_exam_dataset_exists'; end if;
  select * into prior_dataset from public.vocab_datasets where dataset_key=bundle#>>'{dataset,predecessor_key}'
    and lower(source_sha256)=bundle#>>'{dataset,predecessor_source_sha256}' and row_count=approval.entry_count for share;
  if not found then raise exception 'reviewed_exam_predecessor_mismatch'; end if;
  insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active,metadata)
    values(approval.dataset_key,bundle#>>'{dataset,title}',prior_dataset.source_label,upper(bundle#>>'{dataset,source_sha256}'),approval.entry_count,'pending_review',true,
      jsonb_build_object('questionBankKind','reviewed_exam_v1','predecessorDatasetId',prior_dataset.id,'reviewedContentSha256',content_sha,'canonicalApproved',false)) returning id into dataset_value;
  insert into private.reviewed_exam_releases(dataset_id,content_sha256,file_sha256,status,reviews,source_inputs,approval_id)
    values(dataset_value,content_sha,file_sha,'staged',bundle->'reviews',bundle->'inputs',approval.approval_id) returning release_id into release_value;
  for unit_json in select value from jsonb_array_elements(bundle->'units') loop
    insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values(dataset_value,unit_json->>'label',unit_json->>'key','supplement',null,(unit_json->>'sort_index')::int,(unit_json->>'entry_count')::int)
      returning id into unit_value;
    insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,academic_year,exam_month,item_range,sort_index)
      values(unit_value,(select catalog_group from public.vocab_dataset_catalog where dataset_id=prior_dataset.id),'exam_scope',unit_json->>'label',(unit_json->>'academic_year')::int,(unit_json->>'exam_month')::int,unit_json->>'item_range',(unit_json->>'sort_index')::int);
  end loop;
  for entry_json in select value from jsonb_array_elements(bundle->'entries') loop
    if private.reviewed_exam_sha256_v1(entry_json-'entry_row_sha256') is distinct from entry_json->>'entry_row_sha256' then raise exception 'reviewed_exam_entry_hash_mismatch'; end if;
    select * into prior_entry from public.vocab_entries where dataset_id=prior_dataset.id and source_row=(entry_json->>'source_row')::int
      and lower(row_sha256)=entry_json->>'predecessor_entry_row_sha256' for share;
    if not found then raise exception 'reviewed_exam_source_row_mismatch'; end if;
    select b.identity_id into identity_value from public.vocab_entry_pronunciation_bindings_v2 b
      join public.vocab_pronunciation_releases_v2 r on r.release_id=b.release_id and r.status='active'
      join public.vocab_pronunciation_identities_v2 i on i.identity_id=b.identity_id and i.playback_enabled and i.display_enabled
      where b.vocab_entry_id=prior_entry.id and b.dataset_id=prior_dataset.id and b.is_entry_default
        and b.entry_row_sha256=upper(prior_entry.row_sha256) and b.identity_id=entry_json->>'pronunciation_identity_id'
        and r.release_id=entry_json->>'pronunciation_source_release_id';
    if not found then raise exception 'reviewed_exam_pronunciation_source_mismatch'; end if;
    select id into unit_value from public.vocab_units where dataset_id=dataset_value and normalized_label=entry_json->>'unit_key';
    if not found then raise exception 'reviewed_exam_unit_missing'; end if;
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      values(dataset_value,(entry_json->>'source_row')::int,entry_json->>'headword',lower(normalize(trim(entry_json->>'headword'),NFKC)),entry_json->>'pronunciation_ko',
        array[entry_json->>'korean_meaning'],entry_json->>'korean_meaning',entry_json->>'english_definition',entry_json#>>'{source_locator,source_code}',upper(entry_json->>'entry_row_sha256'),
        unit_value,(entry_json->>'position_in_unit')::int,prior_entry.entry_type) returning id into entry_value;
    insert into private.reviewed_exam_entries values(release_value,dataset_value,entry_value,(entry_json->>'source_row')::int,prior_entry.id,identity_value,entry_json->>'entry_row_sha256',entry_json);
  end loop;
  for question_json in select value from jsonb_array_elements(bundle->'questions') loop
    if private.reviewed_exam_sha256_v1(question_json-'item_sha256') is distinct from question_json->>'item_sha256' then raise exception 'reviewed_exam_item_hash_mismatch'; end if;
    select * into target_entry from private.reviewed_exam_entries where release_id=release_value and source_row=(question_json->>'source_row')::int;
    if not found or target_entry.entry_sha256 is distinct from question_json->>'entry_row_sha256'
      or target_entry.payload->>(question_json->>'prompt_role') is distinct from question_json->>'prompt' then raise exception 'reviewed_exam_prompt_mismatch'; end if;
    select array_agg(e.vocab_entry_id order by c.n),array_agg(e.payload->>(question_json->>'choice_role') order by c.n)
      into choice_ids,choice_values from jsonb_array_elements_text(question_json->'choice_source_rows') with ordinality c(value,n)
      join private.reviewed_exam_entries e on e.release_id=release_value and e.source_row=c.value::int;
    if cardinality(choice_ids)<>4 or (select count(distinct v) from unnest(choice_ids) v)<>4
      or (select count(distinct lower(regexp_replace(normalize(btrim(v),NFKC),'\s+',' ','g'))) from unnest(choice_values) v)<>4
      or to_jsonb(choice_values) is distinct from question_json->'choice_texts'
      or exists(select 1 from private.reviewed_exam_entries e where e.release_id=release_value and e.vocab_entry_id=any(choice_ids)
        and e.payload->>'lexical_pos' is distinct from target_entry.payload->>'lexical_pos')
    then raise exception 'reviewed_exam_choices_mismatch'; end if;
    insert into private.reviewed_exam_items values(release_value,dataset_value,target_entry.vocab_entry_id,question_json->>'item_id',question_json->>'item_sha256',
      question_json->>'mode',(question_json->>'direction')::public.question_direction,question_json->>'prompt_role',question_json->>'choice_role',question_json->>'prompt',
      choice_values,choice_ids,(question_json->>'correct_choice_index')::smallint,question_json);
  end loop;
  if (select count(*) from private.reviewed_exam_entries where release_id=release_value)<>approval.entry_count or
    (select count(*) from private.reviewed_exam_items where release_id=release_value)<>approval.question_count or
    exists(select 1 from public.vocab_units u where u.dataset_id=dataset_value and u.entry_count<>(select count(*) from public.vocab_entries e where e.unit_id=u.id))
  then raise exception 'reviewed_exam_import_count_mismatch'; end if;
  insert into public.vocab_dataset_catalog(dataset_id,catalog_group,material_kind,display_name,grade_code,publisher,series_title,academic_year,curriculum_revision,edition_label,is_assignable,sort_index,metadata)
    select dataset_value,catalog_group,material_kind,bundle#>>'{dataset,title}',grade_code,publisher,series_title,academic_year,curriculum_revision,edition_label,false,sort_index+1,
      metadata || jsonb_build_object('reviewedExamReleaseId',release_value) from public.vocab_dataset_catalog where dataset_id=prior_dataset.id;
  return jsonb_build_object('release_id',release_value,'dataset_id',dataset_value,'entries',approval.entry_count,'questions',approval.question_count,'status','staged');
end;
$$;

create function public.list_active_reviewed_exam_questions_v1(p_dataset_id uuid,p_unit_ids uuid[],p_quiz_mode text)
returns table(release_id uuid,package_sha256 text,vocab_entry_id bigint,unit_id uuid,source_row integer,question_item_id text,question_item_sha256 text,direction public.question_direction)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  if p_unit_ids is null or cardinality(p_unit_ids)>1000 then raise exception 'reviewed_exam_range_invalid'; end if;
  return query select r.release_id,r.file_sha256,i.vocab_entry_id,e.unit_id,e.source_row,i.item_id,i.item_sha256,i.direction
    from private.reviewed_exam_releases r join private.reviewed_exam_items i on i.release_id=r.release_id
    join public.vocab_entries e on e.id=i.vocab_entry_id
    where r.dataset_id=p_dataset_id and r.status='active' and i.quiz_mode=p_quiz_mode and e.unit_id=any(p_unit_ids)
    order by e.source_row,i.direction;
end;
$$;
create function public.list_assignment_question_mode_availability_v2()
returns table(dataset_id uuid,definition_count bigint,example_count bigint,reverse_definition_count bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not private.is_active_admin() then raise exception 'forbidden' using errcode='42501'; end if;
  return query select x.dataset_id,sum(x.definition_count)::bigint,sum(x.example_count)::bigint,sum(x.reverse_definition_count)::bigint from (
    select a.dataset_id,a.definition_count,a.example_count,0::bigint reverse_definition_count from public.list_assignment_question_mode_availability_v1() a
    union all select r.dataset_id,count(*) filter(where i.quiz_mode='canonical_definition_to_headword'),0::bigint,
      count(*) filter(where i.quiz_mode='canonical_headword_to_definition')
      from private.reviewed_exam_releases r join private.reviewed_exam_items i on i.release_id=r.release_id where r.status='active' group by r.dataset_id
  ) x group by x.dataset_id;
end;
$$;
create function public.list_active_vocab_pronunciation_bindings_v3(p_vocab_entry_ids bigint[])
returns table(release_id text,vocab_entry_id bigint,identity_id text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400 or exists(select 1 from unnest(p_vocab_entry_ids) v where v is null or v<1) then raise exception 'pronunciation_binding_input_invalid'; end if;
  return query select b.release_id,b.vocab_entry_id,b.identity_id from public.vocab_entry_pronunciation_bindings_v2 b
    join public.vocab_pronunciation_releases_v2 r on r.release_id=b.release_id and r.status='active'
    where b.vocab_entry_id=any(p_vocab_entry_ids) and b.is_entry_default
  union all select 'reviewed-exam:'||r.release_id::text,e.vocab_entry_id,e.pronunciation_identity_id
    from private.reviewed_exam_entries e join private.reviewed_exam_releases r on r.release_id=e.release_id
    join public.vocab_entries v on v.id=e.vocab_entry_id
    where e.vocab_entry_id=any(p_vocab_entry_ids) and (
      (r.status='active' and lower(v.row_sha256)=e.entry_sha256)
      -- Existing questions keep their immutable pronunciation even after retirement.
        -- These columns are introduced in the following migration; PL/pgSQL defers
      -- planning until the RPC is invoked after the full migration set is installed.
      or exists(select 1 from public.assignment_questions aq
        where aq.reviewed_exam_release_id_snapshot=r.release_id
          and (aq.vocab_entry_id=e.vocab_entry_id or e.vocab_entry_id=any(aq.choice_vocab_entry_ids)))
    );
end;
$$;
revoke all on function private.reviewed_exam_canonical_json_v1(jsonb),private.reviewed_exam_sha256_v1(jsonb),private.import_reviewed_exam_bundle_v1(text) from public,anon,authenticated,service_role;
revoke all on function public.list_active_reviewed_exam_questions_v1(uuid,uuid[],text),public.list_assignment_question_mode_availability_v2(),public.list_active_vocab_pronunciation_bindings_v3(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.list_active_reviewed_exam_questions_v1(uuid,uuid[],text),public.list_assignment_question_mode_availability_v2() to authenticated;
grant execute on function public.list_active_vocab_pronunciation_bindings_v3(bigint[]) to service_role;
notify pgrst,'reload schema';
commit;
