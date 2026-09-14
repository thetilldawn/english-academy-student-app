begin;
-- APP-20260914-05. Append reviewed resources to an immutable school release.
create table private.reviewed_entry_resource_approvals_v1 (
  approval_id text primary key,
  target_project_ref text not null,
  dataset_key text not null,
  base_content_sha256 text not null check(base_content_sha256 ~ '^[a-f0-9]{64}$'),
  bundle_file_sha256 text not null check(bundle_file_sha256 ~ '^[a-f0-9]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[a-f0-9]{64}$'),
  review_sha256 text not null check(review_sha256 ~ '^[a-f0-9]{64}$'),
  entry_count int not null check(entry_count>0),
  expected_link_counts jsonb not null check(jsonb_typeof(expected_link_counts)='object'
    and expected_link_counts ?& array['dictionary','pronunciation','definition','example']),
  created_at timestamptz not null default now()
);
create table private.reviewed_entry_resource_releases_v1 (
  release_id uuid primary key default gen_random_uuid(),
  release_key text not null unique,
  approval_id text not null references private.reviewed_entry_resource_approvals_v1,
  base_release_id uuid not null references private.reviewed_exam_releases,
  content_sha256 text not null,
  bundle jsonb not null,
  status text not null check(status in ('active','retired')),
  created_at timestamptz not null default now()
);
create unique index reviewed_entry_resource_one_active_v1
  on private.reviewed_entry_resource_releases_v1(base_release_id) where status='active';
create table private.reviewed_entry_resources_v1 (
  release_id uuid not null references private.reviewed_entry_resource_releases_v1,
  vocab_entry_id bigint not null references public.vocab_entries,
  entry_sha256 text not null,
  pronunciation_identity_id text references public.vocab_pronunciation_identities_v2(identity_id),
  payload jsonb not null,
  primary key(release_id,vocab_entry_id)
);
alter table private.reviewed_entry_resource_approvals_v1 enable row level security;
alter table private.reviewed_entry_resource_releases_v1 enable row level security;
alter table private.reviewed_entry_resources_v1 enable row level security;
revoke all on private.reviewed_entry_resource_approvals_v1,
  private.reviewed_entry_resource_releases_v1,private.reviewed_entry_resources_v1
  from public,anon,authenticated,service_role;

create function private.guard_reviewed_entry_resources_v1() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_table_name='reviewed_entry_resource_releases_v1' and tg_op='UPDATE'
    and to_jsonb(new)-'status'=to_jsonb(old)-'status' then return new; end if;
  raise exception 'reviewed_resources_immutable';
end; $$;
create trigger reviewed_entry_resources_immutable before update or delete
  on private.reviewed_entry_resources_v1 for each row execute function private.guard_reviewed_entry_resources_v1();
create trigger reviewed_entry_resource_release_immutable before update or delete
  on private.reviewed_entry_resource_releases_v1 for each row execute function private.guard_reviewed_entry_resources_v1();

create function private.import_reviewed_entry_resources_v1(p_bundle_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb:=p_bundle_text::jsonb; ap private.reviewed_entry_resource_approvals_v1%rowtype;
  base private.reviewed_exam_releases%rowtype; target private.reviewed_exam_entries%rowtype;
  old_source private.reviewed_exam_entries%rowtype; current_entry public.vocab_entries%rowtype;
  x jsonb; d jsonb; p jsonb; c jsonb; f jsonb; ref jsonb; identity_value text;
  selected_ids text[]:='{}'; source_rows int[]:='{}'; existing_id uuid; new_id uuid; field_name text;
begin
  select * into ap from private.reviewed_entry_resource_approvals_v1
    where approval_id=b->>'approval_id' and target_project_ref=private.request_supabase_project_ref_v1()
      and dataset_key=b->>'dataset_key' and base_content_sha256=b->>'base_content_sha256'
      and content_sha256=private.reviewed_exam_sha256_v1(b-'content_sha256')
      and content_sha256=b->>'content_sha256'
      and bundle_file_sha256=encode(extensions.digest(convert_to(p_bundle_text,'UTF8'),'sha256'),'hex')
      and review_sha256=private.reviewed_exam_sha256_v1(b->'review');
  if not found then raise exception 'reviewed_resources_not_approved' using errcode='42501'; end if;
  if b->>'schema_version'<>'reviewed_entry_resources_v1'
    or jsonb_typeof(b->'entries') is distinct from 'array'
    or jsonb_array_length(b->'entries')<>ap.entry_count
    or jsonb_typeof(b->'inputs') is distinct from 'array'
    or jsonb_array_length(b->'inputs')=0
    or nullif(b#>>'{review,reviewer}','') is null
    or nullif(b#>>'{review,evidence_sha256}','') is null
  then raise exception 'reviewed_resources_bundle_invalid'; end if;
  select r.* into strict base from private.reviewed_exam_releases r
    join public.vocab_datasets ds on ds.id=r.dataset_id
    where ds.dataset_key=ap.dataset_key and r.content_sha256=ap.base_content_sha256
      and r.status='active' and r.provenance_kind='school_handout_direct_v1';
  perform pg_advisory_xact_lock(hashtextextended('reviewed-resources:'||base.release_id::text,0));
  if (select count(*) from private.reviewed_exam_entries where release_id=base.release_id)<>ap.entry_count then
    raise exception 'reviewed_resources_scope_mismatch'; end if;
  -- Counts come from the independently reviewed inventory, never from the importer payload.
  foreach field_name in array array['dictionary','pronunciation','definition','example'] loop
    if jsonb_typeof(ap.expected_link_counts->field_name) is distinct from 'number'
      or (ap.expected_link_counts->>field_name)::int not between 0 and ap.entry_count
      or (select count(*) from jsonb_array_elements(b->'entries') item
          where item->field_name->>'status'='linked')<>(ap.expected_link_counts->>field_name)::int
    then raise exception 'reviewed_resources_inventory_count_mismatch'; end if;
  end loop;
  for x in select value from jsonb_array_elements(b->'entries') loop
    if not (x ?& array['source_row','entry_sha256','headword','selection','availability','dictionary','pronunciation','definition','example'])
      or (x->>'source_row')::int=any(source_rows) then raise exception 'reviewed_resources_entry_invalid'; end if;
    source_rows:=array_append(source_rows,(x->>'source_row')::int);
    select * into strict target from private.reviewed_exam_entries
      where release_id=base.release_id and source_row=(x->>'source_row')::int;
    select * into strict current_entry from public.vocab_entries where id=target.vocab_entry_id;
    if target.entry_sha256 is distinct from x->>'entry_sha256'
      or lower(current_entry.row_sha256)<>target.entry_sha256
      or target.entry_sha256<>private.reviewed_exam_sha256_v1(target.payload-'entry_row_sha256')
      or x->>'headword' is distinct from current_entry.headword
      or x->'selection' is distinct from jsonb_build_object('meaning',target.payload->'korean_meaning',
          'source_pos',target.payload->'source_pos','source_code',target.payload->'source_code')
    then raise exception 'reviewed_resources_target_mismatch'; end if;
    foreach field_name in array array['dictionary','pronunciation','definition','example'] loop
      f:=x->field_name;
      if jsonb_typeof(f) is distinct from 'object'
        or f->>'status' is null or f->>'status' not in ('linked','unavailable')
        or jsonb_typeof(x->'availability'->field_name) is distinct from 'boolean'
        or (x->'availability'->>field_name)::boolean is distinct from (f->>'status'='linked')
        or f->>'status'='unavailable' and nullif(btrim(f->>'reason'),'') is null
      then raise exception 'reviewed_resources_availability_mismatch'; end if;
    end loop;
    d:=x->'dictionary';
    if d->>'status'='linked' then
      if d->>'usage' is distinct from 'headword_reference_school_meaning'
        or d->'selection' is distinct from x->'selection'
        or d->>'sense_id' is not null
        or nullif(btrim(d->>'review_reason'),'') is null
        or not exists(select 1 from jsonb_array_elements(b->'dictionary_scopes') scope
          where scope->>'dataset_key'=d->>'dataset_key'
            and scope->'source_group'=target.payload->'source_group')
      then raise exception 'reviewed_resources_dictionary_selection_mismatch'; end if;
      if d->>'kind'='exam_occurrence' then
        if not exists(select 1 from word_index.app_exam_use_occurrence o
          join word_index.app_exam_use_release r on r.release_id=o.release_id
          join public.vocab_entries v on v.id=o.vocab_entry_id
          join public.vocab_datasets ds on ds.id=v.dataset_id
          where ds.dataset_key=d->>'dataset_key' and v.source_row=(d->>'source_row')::int
            and lower(v.row_sha256)=d->>'entry_sha256' and v.headword=current_entry.headword
            and v.source_ref is not distinct from d->>'source_ref'
            and o.display_gloss_ko is not distinct from d->>'source_meaning'
            and r.status='active' and r.exam_use_import_allowed and o.include_in_exam
            and o.dictionary_id=d->>'dictionary_id' and o.occurrence_id=d->>'occurrence_id'
            and o.sense_id is not distinct from d->>'sense_id'
            and o.occurrence_content_hash=d->>'occurrence_content_hash')
        then raise exception 'reviewed_resources_dictionary_mismatch'; end if;
      elsif d->>'kind'='reviewed_entry' then
        if not exists(select 1 from private.reviewed_exam_entries e
          join private.reviewed_exam_releases r on r.release_id=e.release_id
          join public.vocab_datasets ds on ds.id=e.dataset_id
          where ds.dataset_key=d->>'dataset_key' and e.source_row=(d->>'source_row')::int
            and r.status='active' and e.entry_sha256=d->>'entry_sha256'
            and e.payload->>'headword'=current_entry.headword
            and e.payload->>'dictionary_id'=d->>'dictionary_id'
            and e.payload->>'occurrence_id'=d->>'occurrence_id'
            and e.payload->>'sense_id' is not distinct from d->>'sense_id'
            and e.payload->'source_pos'=target.payload->'source_pos'
            and e.payload->'korean_meaning'=target.payload->'korean_meaning'
            and e.payload->'source_code'=target.payload->'source_code')
        then raise exception 'reviewed_resources_dictionary_mismatch'; end if;
      else raise exception 'reviewed_resources_dictionary_kind_invalid'; end if;
    elsif coalesce(d->>'dictionary_id',d->>'sense_id',d->>'occurrence_id') is not null then
      raise exception 'reviewed_resources_unavailable_reference';
    elsif exists(select 1 from word_index.app_exam_use_occurrence o
      join word_index.app_exam_use_release r on r.release_id=o.release_id and r.status='active'
      join public.vocab_entries v on v.id=o.vocab_entry_id
      join public.vocab_datasets ds on ds.id=v.dataset_id
      where v.headword=current_entry.headword and r.exam_use_import_allowed and o.include_in_exam
        and exists(select 1 from jsonb_array_elements(b->'dictionary_scopes') scope
          where scope->>'dataset_key'=ds.dataset_key and scope->'source_group'=target.payload->'source_group'))
      or exists(select 1 from private.reviewed_exam_entries e
        join private.reviewed_exam_releases r on r.release_id=e.release_id and r.status='active'
        join public.vocab_datasets ds on ds.id=e.dataset_id
        where e.payload->>'dictionary_id' is not null and e.payload->>'occurrence_id' is not null
          and e.payload->'headword'=target.payload->'headword'
          and e.payload->'source_pos'=target.payload->'source_pos'
          and e.payload->'korean_meaning'=target.payload->'korean_meaning'
          and e.payload->'source_code'=target.payload->'source_code'
          and exists(select 1 from jsonb_array_elements(b->'dictionary_scopes') scope
            where scope->>'dataset_key'=ds.dataset_key and scope->'source_group'=target.payload->'source_group'))
    then raise exception 'reviewed_resources_available_dictionary_omitted'; end if;
    p:=x->'pronunciation'; identity_value:=null;
    if p->>'status'='linked' then
      c:=target.payload;
      if p->>'lexical_pos' is distinct from c->>'lexical_pos' then
        ref:=p->'classification_source';
        select e.* into old_source from private.reviewed_exam_entries e
          join private.reviewed_exam_releases r on r.release_id=e.release_id and r.status='active'
          join public.vocab_datasets ds on ds.id=e.dataset_id
          where ds.dataset_key=ref->>'dataset_key' and e.source_row=(ref->>'source_row')::int
            and e.entry_sha256=ref->>'entry_sha256';
        if not found or c->'source_pos' is distinct from 'null'::jsonb
          or old_source.payload->'source_pos' is distinct from 'null'::jsonb
          or old_source.payload->'headword' is distinct from c->'headword'
          or old_source.payload->'korean_meaning' is distinct from c->'korean_meaning'
          or old_source.payload->'source_code' is distinct from c->'source_code'
          or old_source.payload->>'lexical_pos' is distinct from p->>'lexical_pos'
          or old_source.payload->'pronunciation_donor' is distinct from p->'donor'
        then raise exception 'reviewed_resources_classification_mismatch'; end if;
      end if;
      c:=c||jsonb_build_object('lexical_pos',p->'lexical_pos',
        'pronunciation_donor',p->'donor','pronunciation_ko',p->'display_ko',
        'pronunciation_classification_note',p->'classification_note','grammatical_form',p->'grammatical_form');
      identity_value:=private.school_handout_pronunciation_v1(c);
      if identity_value is null then raise exception 'reviewed_resources_pronunciation_missing'; end if;
      -- Do not silently replace an existing active pronunciation choice.
      if exists(select 1 from public.list_active_vocab_pronunciation_bindings_v3(array[target.vocab_entry_id]) a
        where a.identity_id<>identity_value) then raise exception 'reviewed_resources_existing_binding_conflict'; end if;
    elsif p->'donor' is distinct from 'null'::jsonb then raise exception 'reviewed_resources_unavailable_reference';
    elsif exists(select 1 from public.vocab_entries available
      cross join lateral public.list_active_vocab_pronunciation_bindings_v3(array[available.id]) binding
      join public.vocab_pronunciation_identities_v2 identity_row on identity_row.identity_id=binding.identity_id
      where available.headword=current_entry.headword and available.id<>target.vocab_entry_id
        and identity_row.headword=current_entry.headword and identity_row.lexical_pos=target.payload->>'lexical_pos'
        and identity_row.playback_enabled and identity_row.display_enabled)
      or exists(
        select 1 from private.reviewed_exam_entries prior
        join private.reviewed_exam_releases r on r.release_id=prior.release_id and r.status='active'
        where prior.vocab_entry_id<>target.vocab_entry_id and prior.pronunciation_identity_id is not null
          and prior.payload->'source_pos'=target.payload->'source_pos'
          and prior.payload->'headword'=target.payload->'headword'
          and prior.payload->'korean_meaning'=target.payload->'korean_meaning'
          and prior.payload->'source_code'=target.payload->'source_code')
    then raise exception 'reviewed_resources_available_pronunciation_omitted'; end if;
    selected_ids:=array_append(selected_ids,identity_value);
    foreach field_name in array array['definition','example'] loop
      f:=x->field_name;
      if field_name='definition' and nullif(target.payload->>'school_english_definition','') is not null
        and (f->>'status' is distinct from 'linked' or f->>'kind' is distinct from 'school_definition')
      then raise exception 'reviewed_resources_school_definition_omitted'; end if;
      if f->>'status'='linked' then
        if nullif(btrim(f->>'value'),'') is null then raise exception 'reviewed_resources_text_missing'; end if;
        if f->>'kind'='school_definition' then
          if field_name<>'definition' or f->'value' is distinct from target.payload->'school_english_definition'
            then raise exception 'reviewed_resources_school_definition_mismatch'; end if;
        elsif f->>'kind'='reviewed_definition' then
          ref:=f->'source';
          if field_name<>'definition' or not exists(select 1 from private.reviewed_exam_entries e
            join private.reviewed_exam_releases r on r.release_id=e.release_id and r.status='active'
            join public.vocab_datasets ds on ds.id=e.dataset_id
            where ds.dataset_key=ref->>'dataset_key' and e.source_row=(ref->>'source_row')::int
              and e.entry_sha256=ref->>'entry_sha256' and e.payload->'headword'=target.payload->'headword'
              and e.payload->'source_pos'=target.payload->'source_pos'
              and e.payload->'korean_meaning'=target.payload->'korean_meaning'
              and e.payload->'source_code'=target.payload->'source_code'
              and e.payload->'english_definition'=f->'value'
              and e.payload->'definition_provenance'=f->'provenance')
          then raise exception 'reviewed_resources_definition_source_mismatch'; end if;
        elsif f->>'kind'='supplied_example' then
          ref:=f->'source';
          if field_name<>'example' or position('__' in f->>'value')>0
            or nullif(ref->>'locator','') is null
            or ref->>'value_sha256' is distinct from encode(extensions.digest(convert_to(f->>'value','UTF8'),'sha256'),'hex')
            or not exists(select 1 from jsonb_array_elements(b->'inputs') i
               where i->>'path'=ref->>'path' and i->>'sha256'=ref->>'sha256'
                 and i->>'sha256' ~ '^[a-f0-9]{64}$')
          then raise exception 'reviewed_resources_example_source_mismatch'; end if;
        else raise exception 'reviewed_resources_text_kind_invalid'; end if;
      elsif f->>'value' is not null then raise exception 'reviewed_resources_unavailable_reference'; end if;
    end loop;
  end loop;
  select release_id into existing_id from private.reviewed_entry_resource_releases_v1
    where release_key=b->>'release_key' and content_sha256=b->>'content_sha256'
      and base_release_id=base.release_id and status='active';
  if found then return jsonb_build_object('release_id',existing_id,'reused',true,'entries',ap.entry_count); end if;
  if exists(select 1 from private.reviewed_entry_resource_releases_v1
    where base_release_id=base.release_id and status='active') then raise exception 'reviewed_resources_active_conflict'; end if;
  insert into private.reviewed_entry_resource_releases_v1(release_key,approval_id,base_release_id,content_sha256,bundle,status)
    values(b->>'release_key',ap.approval_id,base.release_id,b->>'content_sha256',b,'active') returning release_id into new_id;
  insert into private.reviewed_entry_resources_v1(release_id,vocab_entry_id,entry_sha256,pronunciation_identity_id,payload)
    select new_id,e.vocab_entry_id,e.entry_sha256,selected_ids[j.n::int],j.value
    from jsonb_array_elements(b->'entries') with ordinality j(value,n)
    join private.reviewed_exam_entries e on e.release_id=base.release_id and e.source_row=(j.value->>'source_row')::int;
  return jsonb_build_object('release_id',new_id,'reused',false,'entries',ap.entry_count);
end; $$;
revoke all on function private.guard_reviewed_entry_resources_v1(),
  private.import_reviewed_entry_resources_v1(text) from public,anon,authenticated,service_role;

-- Preserve the current source-bound routes without weakening their checks.
do $migration$
declare fn text;
begin
  fn:=pg_get_functiondef('public.list_active_vocab_pronunciation_bindings_v3(bigint[])'::regprocedure);
  if position('reviewed-exam:' in fn)=0 then raise exception 'reviewed_resources_binding_anchor_changed'; end if;
  execute replace(fn,'public.list_active_vocab_pronunciation_bindings_v3','private.list_pronunciation_bindings_before_resources_v1');
  fn:=pg_get_functiondef('public.list_entry_source_pronunciations_v1(bigint[])'::regprocedure);
  if position('identity_headword' in fn)=0 then raise exception 'reviewed_resources_source_anchor_changed'; end if;
  execute replace(fn,'public.list_entry_source_pronunciations_v1','private.list_source_pronunciations_before_resources_v1');
end; $migration$;
revoke all on function private.list_pronunciation_bindings_before_resources_v1(bigint[]),
  private.list_source_pronunciations_before_resources_v1(bigint[]) from public,anon,authenticated,service_role;

create function private.active_reviewed_entry_resources_v1(p_vocab_entry_ids bigint[])
returns setof private.reviewed_entry_resources_v1
language sql stable set search_path='' as $$
  select x.* from private.reviewed_entry_resources_v1 x
  join private.reviewed_entry_resource_releases_v1 r on r.release_id=x.release_id and r.status='active'
  join private.reviewed_exam_releases b on b.release_id=r.base_release_id
  join private.reviewed_exam_entries e on e.release_id=b.release_id and e.vocab_entry_id=x.vocab_entry_id
  join public.vocab_entries v on v.id=x.vocab_entry_id
  where x.vocab_entry_id=any(p_vocab_entry_ids) and x.entry_sha256=e.entry_sha256
    and lower(v.row_sha256)=x.entry_sha256 and v.headword=x.payload->>'headword'
    and (b.status='active' or exists(select 1 from public.assignment_questions q
      where q.reviewed_exam_release_id_snapshot=b.release_id
        and (q.vocab_entry_id=v.id or v.id=any(q.choice_vocab_entry_ids))));
$$;
revoke all on function private.active_reviewed_entry_resources_v1(bigint[]) from public,anon,authenticated,service_role;

create or replace function public.list_active_vocab_pronunciation_bindings_v3(p_vocab_entry_ids bigint[])
returns table(release_id text,vocab_entry_id bigint,identity_id text)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400
    or exists(select 1 from unnest(p_vocab_entry_ids) id where id is null or id<1)
  then raise exception 'pronunciation_binding_input_invalid' using errcode='22023'; end if;
  return query
  select * from private.list_pronunciation_bindings_before_resources_v1(p_vocab_entry_ids)
  union all
  select 'reviewed-resources:'||x.release_id::text,x.vocab_entry_id,x.pronunciation_identity_id
  from private.active_reviewed_entry_resources_v1(p_vocab_entry_ids) x
  join public.vocab_pronunciation_identities_v2 i on i.identity_id=x.pronunciation_identity_id
  where i.playback_enabled and i.display_enabled
    and lower(i.identity_content_sha256)=x.payload#>>'{pronunciation,donor,identity_content_sha256}'
    and i.headword=x.payload#>>'{pronunciation,donor,identity_headword}'
    and i.lexical_pos=x.payload#>>'{pronunciation,donor,identity_lexical_pos}'
    and i.pronunciation_variant_id=x.payload#>>'{pronunciation,donor,variant_id}'
    and case when i.audio_provider='merriam_webster' then i.official_audio_url
      else '/storage/v1/object/public/'||i.storage_bucket||'/'||i.storage_object_key end=x.payload#>>'{pronunciation,donor,audio_key}'
    and not exists(select 1 from private.list_pronunciation_bindings_before_resources_v1(array[x.vocab_entry_id]) prior);
end; $$;
create or replace function public.list_entry_source_pronunciations_v1(p_vocab_entry_ids bigint[])
returns table(vocab_entry_id bigint,headword text,entry_row_sha256 text,variant_id text,audio_key text,
  display_ko text,segments jsonb,source_file_sha256 text,manifest_sha256 text)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400
    or exists(select 1 from unnest(p_vocab_entry_ids) id where id is null or id<1)
  then raise exception 'entry_source_input_invalid' using errcode='22023'; end if;
  return query
  select * from private.list_source_pronunciations_before_resources_v1(p_vocab_entry_ids)
  union all
  select x.vocab_entry_id,x.payload->>'headword',x.entry_sha256,
    d.val->>'variant_id',d.val->>'audio_key',d.val->>'display_ko',d.val->'segments',
    d.val->>'source_file_sha256',d.val->>'manifest_sha256'
  from private.active_reviewed_entry_resources_v1(p_vocab_entry_ids) x
  cross join lateral (select x.payload#>'{pronunciation,donor,display_override}' val) d
  join public.list_active_vocab_pronunciation_bindings_v3(p_vocab_entry_ids) a
    on a.vocab_entry_id=x.vocab_entry_id and a.identity_id=x.pronunciation_identity_id
    and a.release_id='reviewed-resources:'||x.release_id::text
  where jsonb_typeof(d.val)='object'
    and not exists(select 1 from private.list_source_pronunciations_before_resources_v1(array[x.vocab_entry_id]));
end; $$;

create function public.list_reviewed_entry_resources_v1(p_vocab_entry_ids bigint[])
returns table(vocab_entry_id bigint,entry_row_sha256 text,dictionary_id text,sense_id text,occurrence_id text,resources jsonb)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400
    or exists(select 1 from unnest(p_vocab_entry_ids) id where id is null or id<1)
  then raise exception 'reviewed_resources_input_invalid' using errcode='22023'; end if;
  return query select x.vocab_entry_id,x.entry_sha256,
    x.payload#>>'{dictionary,dictionary_id}',x.payload#>>'{dictionary,sense_id}',x.payload#>>'{dictionary,occurrence_id}',
    x.payload from private.active_reviewed_entry_resources_v1(p_vocab_entry_ids) x;
end; $$;
revoke all on function public.list_active_vocab_pronunciation_bindings_v3(bigint[]),
  public.list_entry_source_pronunciations_v1(bigint[]),public.list_reviewed_entry_resources_v1(bigint[])
  from public,anon,authenticated,service_role;
grant execute on function public.list_active_vocab_pronunciation_bindings_v3(bigint[]),
  public.list_entry_source_pronunciations_v1(bigint[]),public.list_reviewed_entry_resources_v1(bigint[]) to service_role;

-- A linked dictionary supplements only matching, already authorized study rows.
do $migration$
declare fn text; old_fragment text; new_fragment text;
begin
  fn:=replace(pg_get_functiondef('private.student_assignment_study_content_v1(uuid,uuid)'::regprocedure),chr(13),'');
  old_fragment:='''dictionaryId'', s.dictionary_id,';
  new_fragment:='''dictionaryId'', coalesce(s.dictionary_id,resources.payload#>>''{dictionary,dictionary_id}''),';
  if position(old_fragment in fn)=0 then raise exception 'reviewed_resources_study_dictionary_anchor_changed'; end if;
  fn:=replace(fn,old_fragment,new_fragment);
  old_fragment:='left join public.assignment_question_exam_use_snapshot s';
  new_fragment:=E'left join lateral (select x.payload from private.active_reviewed_entry_resources_v1(array[q.vocab_entry_id]) x join private.reviewed_entry_resource_releases_v1 r on r.release_id=x.release_id where r.base_release_id=q.reviewed_exam_release_id_snapshot and upper(x.entry_sha256)=q.entry_row_sha256_snapshot) resources on true\n    left join public.assignment_question_exam_use_snapshot s';
  if position(old_fragment in fn)=0 then raise exception 'reviewed_resources_study_join_anchor_changed'; end if;
  execute replace(fn,old_fragment,new_fragment);
end; $migration$;
notify pgrst,'reload schema';
commit;
