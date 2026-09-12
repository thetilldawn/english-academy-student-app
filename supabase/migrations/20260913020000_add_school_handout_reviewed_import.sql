begin;

-- School source approvals are separate from predecessor-based approvals.
create table private.school_handout_import_approvals_v1 (
  approval_id text primary key,
  target_project_ref text not null,
  dataset_key text not null,
  bundle_file_sha256 text not null check(bundle_file_sha256 ~ '^[0-9a-f]{64}$'),
  content_sha256 text not null check(content_sha256 ~ '^[0-9a-f]{64}$'),
  source_file_sha256 text not null check(source_file_sha256 ~ '^[0-9a-f]{64}$'),
  scope_sha256 text not null check(scope_sha256 ~ '^[0-9a-f]{64}$'),
  inputs_sha256 text not null check(inputs_sha256 ~ '^[0-9a-f]{64}$'),
  reviews_sha256 text not null check(reviews_sha256 ~ '^[0-9a-f]{64}$'),
  source_layout text not null check(source_layout in ('school_compact_v1','school_expanded_v1')),
  entry_count integer not null check(entry_count between 4 and 20000),
  question_count integer not null check(question_count=entry_count*4),
  catalog_template_key text not null,
  hide_dataset_keys text[] not null check(cardinality(hide_dataset_keys)>0 and array_position(hide_dataset_keys,null) is null),
  unique(target_project_ref,bundle_file_sha256)
);
alter table private.school_handout_import_approvals_v1 enable row level security;
revoke all on private.school_handout_import_approvals_v1 from public,anon,authenticated,service_role;

alter table private.reviewed_exam_releases
  add column provenance_kind text not null default 'reviewed_predecessor_v1',
  add column school_approval_id text references private.school_handout_import_approvals_v1(approval_id),
  add column school_source jsonb,
  add column school_source_text text,
  add column school_bundle jsonb,
  add constraint reviewed_release_source_kind_check check (
    (provenance_kind='reviewed_predecessor_v1' and school_approval_id is null and school_source is null and school_source_text is null and school_bundle is null)
    or (provenance_kind='school_handout_direct_v1' and school_approval_id is not null and school_source is not null and school_bundle is not null and school_source_text is not null
      and school_source=school_source_text::jsonb and jsonb_typeof(school_source)='object' and jsonb_typeof(school_bundle)='object')
  ),
  add unique(release_id,provenance_kind);
-- Append only: the old importer inserts its original eight columns positionally.
alter table private.reviewed_exam_entries
  alter column predecessor_entry_id drop not null,
  alter column pronunciation_identity_id drop not null,
  add column provenance_kind text not null default 'reviewed_predecessor_v1',
  add constraint reviewed_entry_source_kind_check check (
    (provenance_kind='reviewed_predecessor_v1' and predecessor_entry_id is not null and pronunciation_identity_id is not null)
    or (provenance_kind='school_handout_direct_v1' and predecessor_entry_id is null)
  ),
  add foreign key(release_id,provenance_kind) references private.reviewed_exam_releases(release_id,provenance_kind);

create function private.school_handout_source_row_v1(p_row jsonb,p_layout text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare v jsonb;
begin
  if p_layout='school_compact_v1' then
    if not p_row ?& array['source_row','w','p','k','d','src','source_jsonl_line','source_locator'] then
      raise exception 'school_source_keys_missing';
    end if;
    v:=jsonb_build_object('source_row',p_row->'source_row','headword',p_row->'w','source_pos',p_row->'p',
      'source_meaning',p_row->'k','school_english_definition',p_row->'d','source_code',p_row->'src','jsonl_line',p_row->'source_jsonl_line');
    if p_row->'source_jsonl_line' is distinct from p_row#>'{source_locator,jsonl_line}' then raise exception 'school_source_line_mismatch'; end if;
  elsif p_layout='school_expanded_v1' then
    if not p_row ?& array['source_row','headword','source_pos','korean_meaning','school_english_definition','source_code','source_locator'] then
      raise exception 'school_source_keys_missing';
    end if;
    v:=jsonb_build_object('source_row',p_row->'source_row','headword',p_row->'headword','source_pos',p_row->'source_pos',
      'source_meaning',p_row->'korean_meaning','school_english_definition',p_row->'school_english_definition',
      'source_code',p_row->'source_code','jsonl_line',p_row#>'{source_locator,jsonl_line}');
  else raise exception 'school_source_layout_invalid';
  end if;
  if jsonb_typeof(v->'source_row') is distinct from 'number' or jsonb_typeof(v->'jsonl_line') is distinct from 'number'
    or jsonb_typeof(v->'headword') is distinct from 'string' or nullif(btrim(v->>'headword'),'') is null
    or jsonb_typeof(v->'source_meaning') is distinct from 'string' or nullif(btrim(v->>'source_meaning'),'') is null
    or jsonb_typeof(v->'source_code') is distinct from 'string' or nullif(btrim(v->>'source_code'),'') is null
    or jsonb_typeof(v->'source_pos') not in ('null','string')
    or jsonb_typeof(v->'school_english_definition') not in ('null','string')
  then raise exception 'school_source_fields_invalid'; end if;
  return v;
end;
$$;

create function private.validate_school_handout_entry_v1(p_entry jsonb,p_source jsonb,p_layout text,p_row integer)
returns void language plpgsql immutable set search_path='' as $$
declare s jsonb;
begin
  s:=private.school_handout_source_row_v1(p_source,p_layout);
  if not p_entry ?& array['source_row','headword','source_pos','source_meaning','school_english_definition','source_code','jsonl_line',
      'korean_meaning','english_definition','lexical_pos','definition_provenance','pronunciation_donor','pronunciation_ko','entry_row_sha256']
    or (s->>'source_row')::int<>p_row or (p_entry->>'source_row')::int<>p_row
    or exists(select 1 from jsonb_each(s) f where p_entry->f.key is distinct from f.value)
    or p_entry->'korean_meaning' is distinct from s->'source_meaning'
    or private.reviewed_exam_sha256_v1(p_entry-'entry_row_sha256') is distinct from p_entry->>'entry_row_sha256'
    or nullif(btrim(p_entry->>'english_definition'),'') is null
    or jsonb_typeof(p_entry->'english_definition') is distinct from 'string'
    or jsonb_typeof(p_entry->'lexical_pos') is distinct from 'string'
    or p_entry->>'lexical_pos' not in ('noun','verb','adjective','adverb','preposition','conjunction','interjection','pronoun','other')
  then raise exception 'school_entry_source_mismatch'; end if;
  if s->'school_english_definition'<>'null'::jsonb then
    if p_entry->'english_definition' is distinct from s->'school_english_definition'
      or p_entry#>>'{definition_provenance,kind}' is distinct from 'school_handout'
    then raise exception 'school_definition_mismatch'; end if;
  elsif p_entry#>>'{definition_provenance,kind}' is distinct from 'author_created_supplement'
    or p_entry#>'{definition_provenance,provided_definition_found}' is distinct from 'false'::jsonb
  then raise exception 'school_definition_origin_invalid'; end if;
  if s->'source_pos'='null'::jsonb and nullif(btrim(p_entry->>'lexical_classification_note'),'') is null then
    raise exception 'school_unstated_pos_note_required';
  end if;
  if s->>'source_pos' in ('명','동','형','부') and p_entry->>'lexical_pos' is distinct from
    (case s->>'source_pos' when '명' then 'noun' when '동' then 'verb' when '형' then 'adjective' when '부' then 'adverb' end)
  then raise exception 'school_stated_pos_mismatch'; end if;
end;
$$;

-- A donor is a pronunciation source, never a fictitious predecessor row.
create function private.school_handout_pronunciation_v1(p_entry jsonb)
returns text language plpgsql stable set search_path='' as $$
declare p jsonb:=p_entry->'pronunciation_donor'; e public.vocab_entries%rowtype;
  i public.vocab_pronunciation_identities_v2%rowtype; s jsonb; a record; found_binding boolean:=false;
begin
  if p='null'::jsonb then
    if p_entry->'pronunciation_ko' is distinct from 'null'::jsonb then raise exception 'school_pronunciation_missing_donor'; end if;
    return null;
  end if;
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'school_pronunciation_invalid'; end if;
  select v.* into e from public.vocab_entries v join public.vocab_datasets d on d.id=v.dataset_id
    where d.dataset_key=p->>'dataset_key' and v.source_row=(p->>'source_row')::int
      and lower(v.row_sha256)=p->>'entry_row_sha256' and v.headword=p_entry->>'headword';
  if not found then raise exception 'school_pronunciation_donor_mismatch'; end if;
  select * into i from public.vocab_pronunciation_identities_v2
    where identity_id=p->>'identity_id' and lower(identity_content_sha256)=p->>'identity_content_sha256'
      and headword=p->>'identity_headword' and lexical_pos=p->>'identity_lexical_pos'
      and pronunciation_variant_id=p->>'variant_id' and playback_enabled and display_enabled
      and case when audio_provider='merriam_webster' then official_audio_url
          else '/storage/v1/object/public/'||storage_bucket||'/'||storage_object_key end=p->>'audio_key';
  if not found then raise exception 'school_pronunciation_identity_mismatch'; end if;
  select to_jsonb(x)-'vocab_entry_id' into s from public.list_entry_source_pronunciations_v1(array[e.id]) x
    where x.variant_id=i.pronunciation_variant_id and x.audio_key=p->>'audio_key';
  if coalesce(s,'null'::jsonb) is distinct from p->'display_override' then raise exception 'school_pronunciation_display_mismatch'; end if;
  if i.headword is distinct from e.headword and s is null then raise exception 'school_pronunciation_headword_mismatch'; end if;
  if i.lexical_pos is distinct from p_entry->>'lexical_pos' then
    if nullif(btrim(p_entry->>'pronunciation_classification_note'),'') is null or not coalesce((
      s is not null and exists(select 1 from private.entry_source_pronunciations_v1 proof
        where proof.vocab_entry_id=e.id and proof.source_kind='identity' and proof.identity_id=i.identity_id
          and proof.lexical_pos=p_entry->>'lexical_pos'
          and proof.identity_content_sha256=lower(i.identity_content_sha256)
          and coalesce(proof.identity_lexical_pos,proof.lexical_pos)=i.lexical_pos)
      or p_entry->'source_pos'='null'::jsonb and i.lexical_pos='other' and i.headword=e.headword
        and p_entry->>'grammatical_form' in ('verb_expression','adverbial_prepositional_expression','adjectival_prepositional_expression')
    ),false) then raise exception 'school_pronunciation_pos_mismatch'; end if;
  end if;
  for a in select * from public.list_active_vocab_pronunciation_bindings_v3(array[e.id]) loop
    if a.identity_id<>i.identity_id then continue; end if;
    if exists(select 1 from public.vocab_entry_pronunciation_bindings_v2 b
      join public.vocab_pronunciation_releases_v2 r on r.release_id=b.release_id and r.status='active'
      join public.vocab_datasets d on d.id=e.dataset_id and d.id=r.dataset_id and lower(d.source_sha256)=lower(r.dataset_source_sha256)
      where b.release_id=a.release_id and b.vocab_entry_id=e.id and b.dataset_id=e.dataset_id and b.source_row=e.source_row
        and b.is_entry_default and lower(b.entry_row_sha256)=lower(e.row_sha256)
        and b.headword=e.headword and b.headword_normalized=e.headword_normalized
        and b.identity_id=i.identity_id and b.lexical_pos=i.lexical_pos and i.headword=e.headword)
      or exists(select 1 from private.reviewed_exam_entries re join private.reviewed_exam_releases rr on rr.release_id=re.release_id and rr.status='active'
        where 'reviewed-exam:'||rr.release_id::text=a.release_id and re.vocab_entry_id=e.id and re.dataset_id=e.dataset_id
          and re.pronunciation_identity_id=i.identity_id and re.entry_sha256=lower(e.row_sha256)
          and re.payload->>'headword'=e.headword and private.reviewed_exam_sha256_v1(re.payload-'entry_row_sha256')=re.entry_sha256
          and (i.headword=e.headword or s is not null)
          and (i.lexical_pos=re.payload->>'lexical_pos' or s is not null))
    then found_binding:=true; end if;
  end loop;
  if not found_binding then raise exception 'school_pronunciation_binding_mismatch'; end if;
  if p_entry->>'pronunciation_ko' is distinct from coalesce(s->>'display_ko',i.display_pronunciation_ko) then
    raise exception 'school_pronunciation_text_mismatch';
  end if;
  return i.identity_id;
end;
$$;

create function private.validate_school_handout_release_v1(p_release_id uuid)
returns void language plpgsql set search_path='' as $$
declare r private.reviewed_exam_releases%rowtype; ap private.school_handout_import_approvals_v1%rowtype;
  e private.reviewed_exam_entries%rowtype; v public.vocab_entries%rowtype; q private.reviewed_exam_items%rowtype;
  ids bigint[]; vals text[]; donor_identity text;
begin
  select * into strict r from private.reviewed_exam_releases where release_id=p_release_id and provenance_kind='school_handout_direct_v1';
  select * into strict ap from private.school_handout_import_approvals_v1 where approval_id=r.school_approval_id
    and target_project_ref=private.request_supabase_project_ref_v1();
  if encode(extensions.digest(convert_to(r.school_source_text,'UTF8'),'sha256'),'hex') is distinct from ap.source_file_sha256
    or r.school_source is distinct from r.school_source_text::jsonb
    or private.reviewed_exam_sha256_v1(jsonb_build_object('dataset',r.school_bundle->'dataset','scope',r.school_bundle->'scope',
      'source_file_sha256',r.school_bundle->'source_file_sha256','inputs',r.school_bundle->'inputs','units',r.school_bundle->'units',
      'entries',r.school_bundle->'entries','questions',r.school_bundle->'questions')) is distinct from ap.content_sha256
    or (select jsonb_agg(x.payload order by x.source_row) from private.reviewed_exam_entries x where x.release_id=r.release_id) is distinct from r.school_bundle->'entries'
    or private.reviewed_exam_sha256_v1(r.school_source->'scope') is distinct from ap.scope_sha256
    or private.reviewed_exam_sha256_v1(r.school_source->'inputs') is distinct from ap.inputs_sha256
    or private.reviewed_exam_sha256_v1(r.reviews) is distinct from ap.reviews_sha256
    or r.content_sha256<>ap.content_sha256 or r.file_sha256<>ap.bundle_file_sha256
    or jsonb_array_length(r.school_source->'entries')<>ap.entry_count
    or (select count(*) from private.reviewed_exam_entries where release_id=r.release_id)<>ap.entry_count
    or (select count(*) from private.reviewed_exam_items where release_id=r.release_id)<>ap.question_count
  then raise exception 'school_release_approval_mismatch'; end if;
  if not exists(select 1 from public.vocab_datasets d join public.vocab_dataset_catalog c on c.dataset_id=d.id
    where d.id=r.dataset_id and d.dataset_key=ap.dataset_key and d.title=r.school_bundle#>>'{dataset,title}'
      and d.source_label=r.school_bundle#>>'{dataset,source_label}' and lower(d.source_sha256)=ap.source_file_sha256
      and d.row_count=ap.entry_count and d.is_active and d.status in ('pending_review','ready')
      and d.metadata->>'questionBankKind'='reviewed_exam_v1' and d.metadata->'schoolScope'=r.school_source->'scope'
      and c.display_name=d.title and c.metadata->>'school'=r.school_source#>>'{scope,school}'
      and c.metadata->>'purpose'='exam_prep' and c.metadata->'schoolScope'=r.school_source->'scope'
      and c.metadata->'semester'=r.school_source#>'{scope,semester}'
      and c.metadata->'schoolYear'=r.school_source#>'{scope,school_year}'
      and c.grade_code=case r.school_source#>>'{scope,grade}' when '중1' then 'g7' when '중2' then 'g8' when '중3' then 'g9'
        when '고1' then 'g10' when '고2' then 'g11' when '고3' then 'g12' end)
  then raise exception 'school_registered_catalog_mismatch'; end if;
  if (select count(*) from public.vocab_units where dataset_id=r.dataset_id) is distinct from jsonb_array_length(r.school_bundle->'units')
    or exists(select 1 from jsonb_array_elements(r.school_bundle->'units') u where not exists(
      select 1 from public.vocab_units unit_row join public.vocab_unit_catalog c on c.unit_id=unit_row.id
      where unit_row.dataset_id=r.dataset_id and unit_row.normalized_label=u->>'key' and unit_row.unit_label=u->>'label'
        and unit_row.sort_index=(u->>'sort_index')::int and unit_row.entry_count=(u->>'entry_count')::int
        and c.unit_type=u->>'unit_type' and c.display_name=u->>'label'
        and c.academic_year is not distinct from (u->>'academic_year')::int
        and c.exam_month is not distinct from (u->>'exam_month')::int and c.item_range is not distinct from u->>'item_range'))
  then raise exception 'school_registered_unit_content_mismatch'; end if;
  for e in select * from private.reviewed_exam_entries where release_id=r.release_id order by source_row loop
    perform private.validate_school_handout_entry_v1(e.payload,r.school_source->'entries'->(e.source_row-1),ap.source_layout,e.source_row);
    select * into strict v from public.vocab_entries where id=e.vocab_entry_id and dataset_id=r.dataset_id;
    donor_identity:=private.school_handout_pronunciation_v1(e.payload);
    if e.entry_sha256<>e.payload->>'entry_row_sha256' or lower(v.row_sha256)<>e.entry_sha256
      or v.headword is distinct from e.payload->>'headword' or v.primary_meaning is distinct from e.payload->>'korean_meaning'
      or v.meanings is distinct from array[e.payload->>'korean_meaning'] or v.english_definition is distinct from e.payload->>'english_definition'
      or v.pronunciation_ko is distinct from e.payload->>'pronunciation_ko'
      or v.source_row<>e.source_row or v.position_in_unit<>(e.payload->>'position_in_unit')::int
      or v.source_ref is distinct from e.payload->>'source_code'
      or e.pronunciation_identity_id is distinct from donor_identity
      or not exists(select 1 from public.vocab_units u where u.id=v.unit_id and u.dataset_id=r.dataset_id and u.normalized_label=e.payload->>'unit_key')
      or (select count(*) from private.reviewed_exam_items where release_id=r.release_id and vocab_entry_id=e.vocab_entry_id)<>4
    then raise exception 'school_registered_entry_mismatch'; end if;
  end loop;
  for q in select * from private.reviewed_exam_items where release_id=r.release_id loop
    select * into strict e from private.reviewed_exam_entries where release_id=r.release_id and vocab_entry_id=q.vocab_entry_id;
    select array_agg(ce.vocab_entry_id order by c.n),array_agg(ce.payload->>q.choice_role order by c.n)
      into ids,vals from jsonb_array_elements_text(q.payload->'choice_source_rows') with ordinality c(value,n)
      join private.reviewed_exam_entries ce on ce.release_id=r.release_id and ce.source_row=c.value::int;
    if private.reviewed_exam_sha256_v1(q.payload-'item_sha256') is distinct from q.item_sha256
      or q.item_sha256 is distinct from q.payload->>'item_sha256' or e.entry_sha256 is distinct from q.payload->>'entry_row_sha256'
      or e.source_row is distinct from (q.payload->>'source_row')::int
      or q.item_id is distinct from q.payload->>'item_id'
      or q.payload is distinct from (select value from jsonb_array_elements(r.school_bundle->'questions') where value->>'item_id'=q.item_id)
      or q.quiz_mode is distinct from q.payload->>'mode' or q.direction::text is distinct from q.payload->>'direction'
      or q.prompt_role is distinct from q.payload->>'prompt_role' or q.choice_role is distinct from q.payload->>'choice_role'
      or q.prompt is distinct from e.payload->>q.prompt_role or q.prompt is distinct from q.payload->>'prompt'
      or q.correct_choice_index is distinct from (q.payload->>'correct_choice_index')::smallint
      or jsonb_array_length(q.payload->'choice_source_rows') is distinct from 4
      or jsonb_array_length(q.payload->'choice_texts') is distinct from 4
      or cardinality(ids)<>4 or q.choice_vocab_entry_ids is distinct from ids or q.choice_texts is distinct from vals
      or to_jsonb(vals) is distinct from q.payload->'choice_texts'
      or (select count(distinct n) from unnest(ids) n)<>4
      or (select count(distinct lower(regexp_replace(normalize(btrim(t),NFKC),'\s+',' ','g'))) from unnest(vals) t)<>4
      or exists(select 1 from private.reviewed_exam_entries ce where ce.release_id=r.release_id and ce.vocab_entry_id=any(ids)
        and ce.payload->>'lexical_pos' is distinct from e.payload->>'lexical_pos')
    then raise exception 'school_registered_question_mismatch'; end if;
  end loop;
  if exists(select 1 from public.vocab_units u where u.dataset_id=r.dataset_id and (
      u.entry_count<>(select count(*) from public.vocab_entries ve where ve.unit_id=u.id)
      or u.entry_count<>(select count(distinct ve.position_in_unit) from public.vocab_entries ve where ve.unit_id=u.id)
      or u.entry_count<>(select max(ve.position_in_unit) from public.vocab_entries ve where ve.unit_id=u.id)))
  then raise exception 'school_registered_unit_mismatch'; end if;
end;
$$;

create function private.import_school_handout_reviewed_bundle_v1(p_text text,p_source_text text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b jsonb; src jsonb; fs text; cs text; ap private.school_handout_import_approvals_v1%rowtype;
  template public.vocab_dataset_catalog%rowtype; dataset_value uuid; release_value uuid; unit_value uuid; entry_value bigint;
  ej jsonb; qj jsonb; uj jsonb; ov jsonb; pron_id text; target_entry private.reviewed_exam_entries%rowtype; ids bigint[]; vals text[];
  source_index integer:=0;
begin
  if p_text is null or p_source_text is null or octet_length(p_text)>20000000 or octet_length(p_source_text)>20000000 then
    raise exception 'school_import_size_invalid';
  end if;
  b:=p_text::jsonb; src:=p_source_text::jsonb;
  fs:=encode(extensions.digest(convert_to(p_text,'UTF8'),'sha256'),'hex');
  select * into ap from private.school_handout_import_approvals_v1
    where target_project_ref=private.request_supabase_project_ref_v1() and bundle_file_sha256=fs for share;
  if not found then raise exception 'school_import_not_approved' using errcode='42501'; end if;
  cs:=private.reviewed_exam_sha256_v1(jsonb_build_object('dataset',b->'dataset','scope',b->'scope','source_file_sha256',b->'source_file_sha256',
    'inputs',b->'inputs','units',b->'units','entries',b->'entries','questions',b->'questions'));
  if b->>'format' is distinct from 'school-handout-reviewed-bundle-v1' or b->>'schema_version' is distinct from '1'
    or b#>'{permissions,canonical_approved}' is distinct from 'false'::jsonb
    or b#>'{permissions,release_allowed}' is distinct from 'true'::jsonb
    or cs is distinct from ap.content_sha256 or cs is distinct from b->>'content_sha256'
    or b#>>'{dataset,key}' is distinct from ap.dataset_key
    or b#>>'{dataset,catalog_template_key}' is distinct from ap.catalog_template_key
    or b->>'source_file_sha256' is distinct from ap.source_file_sha256
    or encode(extensions.digest(convert_to(p_source_text,'UTF8'),'sha256'),'hex')<>ap.source_file_sha256
    or private.reviewed_exam_sha256_v1(src->'scope') is distinct from ap.scope_sha256
    or b->'scope' is distinct from src->'scope'
    or private.reviewed_exam_sha256_v1(src->'inputs') is distinct from ap.inputs_sha256
    or b->'inputs' is distinct from src->'inputs'
    or jsonb_array_length(src->'entries') is distinct from ap.entry_count
    or jsonb_array_length(b->'entries') is distinct from ap.entry_count
    or jsonb_array_length(b->'questions') is distinct from ap.question_count
    or jsonb_array_length(b->'reviews') is distinct from 2
    or private.reviewed_exam_sha256_v1(b->'reviews') is distinct from ap.reviews_sha256
    or jsonb_array_length(b->'units') not between 1 and ap.entry_count
  then raise exception 'school_bundle_invalid'; end if;
  if (select count(distinct x->>'reviewer') from jsonb_array_elements(b->'reviews') x
    where x->>'input_content_sha256'=cs and x->>'status'='passed' and x->>'report_sha256' ~ '^[0-9a-f]{64}$')<>2
  then raise exception 'school_review_incomplete'; end if;
  perform pg_advisory_xact_lock(hashtextextended(ap.dataset_key,0));
  select release_id,dataset_id into release_value,dataset_value from private.reviewed_exam_releases
    where content_sha256=cs and school_approval_id=ap.approval_id;
  if found then
    perform private.validate_school_handout_release_v1(release_value);
    return jsonb_build_object('release_id',release_value,'dataset_id',dataset_value,'reused',true);
  end if;
  if exists(select 1 from public.vocab_datasets where dataset_key=ap.dataset_key) then raise exception 'school_dataset_exists'; end if;
  select c.* into template from public.vocab_dataset_catalog c join public.vocab_datasets d on d.id=c.dataset_id
    where d.dataset_key=ap.catalog_template_key for share of c;
  if not found or template.metadata->>'school' is distinct from src#>>'{scope,school}'
    or template.metadata->'semester' is distinct from src#>'{scope,semester}'
    or template.metadata->'schoolYear' is distinct from src#>'{scope,school_year}'
  then raise exception 'school_catalog_scope_mismatch'; end if;
  if (select count(distinct d.dataset_key) from public.vocab_datasets d join public.vocab_dataset_catalog c on c.dataset_id=d.id
    where d.dataset_key=any(ap.hide_dataset_keys) and c.metadata->>'school'=src#>>'{scope,school}'
      and c.grade_code=template.grade_code and c.metadata->'semester'=src#>'{scope,semester}')<>cardinality(ap.hide_dataset_keys)
  then raise exception 'school_hide_scope_mismatch'; end if;
  insert into public.vocab_datasets(dataset_key,title,source_label,source_sha256,row_count,status,is_active,metadata)
    values(ap.dataset_key,b#>>'{dataset,title}',b#>>'{dataset,source_label}',upper(ap.source_file_sha256),ap.entry_count,'pending_review',true,
      jsonb_build_object('questionBankKind','reviewed_exam_v1','sourceKind','school_handout','sourcePriority',jsonb_build_array('school_handout','provided_wordbook','requested_cefr'),
        'schoolScope',src->'scope','reviewedContentSha256',cs,'canonicalApproved',false)) returning id into dataset_value;
  insert into private.reviewed_exam_releases(dataset_id,content_sha256,file_sha256,status,reviews,source_inputs,approval_id,provenance_kind,school_approval_id,school_source,school_source_text,school_bundle)
    values(dataset_value,cs,fs,'staged',b->'reviews',b->'inputs',ap.approval_id,'school_handout_direct_v1',ap.approval_id,src,p_source_text,b) returning release_id into release_value;
  for uj in select value from jsonb_array_elements(b->'units') loop
    if (uj->>'entry_count')::int<1 then raise exception 'school_empty_unit_invalid'; end if;
    insert into public.vocab_units(dataset_id,unit_label,normalized_label,unit_kind,unit_number,sort_index,entry_count)
      values(dataset_value,uj->>'label',uj->>'key','supplement',null,(uj->>'sort_index')::int,(uj->>'entry_count')::int) returning id into unit_value;
    insert into public.vocab_unit_catalog(unit_id,catalog_group,unit_type,display_name,academic_year,exam_month,item_range,sort_index)
      values(unit_value,template.catalog_group,uj->>'unit_type',uj->>'label',(uj->>'academic_year')::int,(uj->>'exam_month')::int,uj->>'item_range',(uj->>'sort_index')::int);
  end loop;
  for ej in select value from jsonb_array_elements(b->'entries') loop
    source_index:=source_index+1;
    perform private.validate_school_handout_entry_v1(ej,src->'entries'->(source_index-1),ap.source_layout,source_index);
    pron_id:=private.school_handout_pronunciation_v1(ej);
    select id into unit_value from public.vocab_units where dataset_id=dataset_value and normalized_label=ej->>'unit_key';
    if not found then raise exception 'school_unit_missing'; end if;
    insert into public.vocab_entries(dataset_id,source_row,headword,headword_normalized,pronunciation_ko,meanings,primary_meaning,english_definition,source_ref,row_sha256,unit_id,position_in_unit,entry_type)
      values(dataset_value,source_index,ej->>'headword',lower(normalize(trim(ej->>'headword'),NFKC)),ej->>'pronunciation_ko',
        array[ej->>'korean_meaning'],ej->>'korean_meaning',ej->>'english_definition',ej->>'source_code',upper(ej->>'entry_row_sha256'),
        unit_value,(ej->>'position_in_unit')::int,'word') returning id into entry_value;
    insert into private.reviewed_exam_entries(release_id,dataset_id,vocab_entry_id,source_row,predecessor_entry_id,pronunciation_identity_id,entry_sha256,payload,provenance_kind)
      values(release_value,dataset_value,entry_value,source_index,null,pron_id,ej->>'entry_row_sha256',ej,'school_handout_direct_v1');
    ov:=ej#>'{pronunciation_donor,display_override}';
    if ov is not null and ov<>'null'::jsonb then
      insert into private.entry_source_pronunciations_v1(vocab_entry_id,entry_row_sha256,headword,lexical_pos,source_kind,identity_id,identity_content_sha256,
        variant_id,audio_key,display_ko,segments,source_file_sha256,manifest_sha256,review_work,identity_lexical_pos,identity_headword)
      values(entry_value,ej->>'entry_row_sha256',ej->>'headword',ej->>'lexical_pos','identity',pron_id,ej#>>'{pronunciation_donor,identity_content_sha256}',
        ov->>'variant_id',ov->>'audio_key',ov->>'display_ko',ov->'segments',ov->>'source_file_sha256',ov->>'manifest_sha256',
        b#>>'{dataset,review_work}',nullif(ej#>>'{pronunciation_donor,identity_lexical_pos}',ej->>'lexical_pos'),
        nullif(ej#>>'{pronunciation_donor,identity_headword}',ej->>'headword'));
    end if;
  end loop;
  for qj in select value from jsonb_array_elements(b->'questions') loop
    select * into target_entry from private.reviewed_exam_entries where release_id=release_value and source_row=(qj->>'source_row')::int;
    if not found then raise exception 'school_question_source_missing'; end if;
    select array_agg(e.vocab_entry_id order by c.n),array_agg(e.payload->>(qj->>'choice_role') order by c.n)
      into ids,vals from jsonb_array_elements_text(qj->'choice_source_rows') with ordinality c(value,n)
      join private.reviewed_exam_entries e on e.release_id=release_value and e.source_row=c.value::int;
    insert into private.reviewed_exam_items values(release_value,dataset_value,target_entry.vocab_entry_id,qj->>'item_id',qj->>'item_sha256',
      qj->>'mode',(qj->>'direction')::public.question_direction,qj->>'prompt_role',qj->>'choice_role',qj->>'prompt',vals,ids,(qj->>'correct_choice_index')::smallint,qj);
  end loop;
  insert into public.vocab_dataset_catalog(dataset_id,catalog_group,material_kind,display_name,grade_code,publisher,series_title,academic_year,curriculum_revision,edition_label,is_assignable,sort_index,metadata)
    values(dataset_value,template.catalog_group,template.material_kind,b#>>'{dataset,title}',template.grade_code,template.publisher,template.series_title,
      template.academic_year,template.curriculum_revision,template.edition_label,false,template.sort_index,
      template.metadata||jsonb_build_object('purpose','exam_prep','sourceKind','school_handout','sourcePriority',jsonb_build_array('school_handout','provided_wordbook','requested_cefr'),
        'schoolScope',src->'scope','reviewedExamReleaseId',release_value));
  perform private.validate_school_handout_release_v1(release_value);
  return jsonb_build_object('release_id',release_value,'dataset_id',dataset_value,'entries',ap.entry_count,'questions',ap.question_count,'status','staged');
end;
$$;

create function private.activate_school_handout_reviewed_release_v1(p_release_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.reviewed_exam_releases%rowtype; ap private.school_handout_import_approvals_v1%rowtype; changed_count integer;
begin
  select * into strict r from private.reviewed_exam_releases where release_id=p_release_id and provenance_kind='school_handout_direct_v1' for update;
  select * into strict ap from private.school_handout_import_approvals_v1 where approval_id=r.school_approval_id
    and target_project_ref=private.request_supabase_project_ref_v1() for share;
  perform pg_advisory_xact_lock(hashtextextended(ap.dataset_key,0));
  perform 1 from public.vocab_dataset_catalog c where c.dataset_id=r.dataset_id or c.dataset_id in (
    select id from public.vocab_datasets where dataset_key=any(ap.hide_dataset_keys)) order by c.dataset_id for update;
  if (select count(*) from public.vocab_dataset_catalog c join public.vocab_datasets d on d.id=c.dataset_id
    where d.dataset_key=any(ap.hide_dataset_keys) and c.metadata->>'school'=r.school_source#>>'{scope,school}'
      and c.metadata->'semester'=r.school_source#>'{scope,semester}'
      and c.grade_code=(select grade_code from public.vocab_dataset_catalog where dataset_id=r.dataset_id))<>cardinality(ap.hide_dataset_keys)
  then raise exception 'school_hide_scope_mismatch'; end if;
  if r.status='retired' then raise exception 'school_release_retired'; end if;
  perform private.validate_school_handout_release_v1(r.release_id);
  update private.reviewed_exam_releases set status='active',activated_at=coalesce(activated_at,clock_timestamp()) where release_id=r.release_id;
  update public.vocab_datasets set status='ready' where id=r.dataset_id;
  update public.vocab_dataset_catalog set is_assignable=false where dataset_id in (
    select d.id from public.vocab_datasets d where d.dataset_key=any(ap.hide_dataset_keys));
  update public.vocab_dataset_catalog set is_assignable=true where dataset_id=r.dataset_id;
  get diagnostics changed_count = row_count;
  if changed_count<>1 then raise exception 'school_catalog_missing'; end if;
  return jsonb_build_object('dataset_id',r.dataset_id,'release_id',r.release_id,'status','active','hidden_dataset_keys',to_jsonb(ap.hide_dataset_keys));
end;
$$;

-- Active school payloads are immutable: a correction requires a new release.
create function private.guard_school_reviewed_content_v1()
returns trigger language plpgsql security definer set search_path='' as $$
declare protected_release uuid;
begin
  if tg_table_schema='public' then
    select re.release_id into protected_release from private.reviewed_exam_entries re
      join private.reviewed_exam_releases rr on rr.release_id=re.release_id
      where re.vocab_entry_id=old.id and rr.provenance_kind='school_handout_direct_v1' and rr.status in ('active','retired');
  elsif tg_table_name='reviewed_exam_releases' then
    if old.provenance_kind='school_handout_direct_v1' and old.status in ('active','retired')
      and (tg_op='DELETE' or (to_jsonb(new)-'status'-'activated_at') is distinct from (to_jsonb(old)-'status'-'activated_at')
        or new.status='staged') then protected_release:=old.release_id; end if;
  else
    select rr.release_id into protected_release from private.reviewed_exam_releases rr
      where rr.release_id=old.release_id and rr.provenance_kind='school_handout_direct_v1' and rr.status in ('active','retired');
  end if;
  if protected_release is not null then raise exception 'school_active_content_immutable'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
create trigger guard_school_reviewed_entry before update or delete on private.reviewed_exam_entries for each row execute function private.guard_school_reviewed_content_v1();
create trigger guard_school_reviewed_item before update or delete on private.reviewed_exam_items for each row execute function private.guard_school_reviewed_content_v1();
create trigger guard_school_reviewed_release before update or delete on private.reviewed_exam_releases for each row execute function private.guard_school_reviewed_content_v1();
create trigger guard_school_public_entry before update or delete on public.vocab_entries for each row execute function private.guard_school_reviewed_content_v1();

create or replace function public.list_active_vocab_pronunciation_bindings_v3(p_vocab_entry_ids bigint[])
returns table(release_id text,vocab_entry_id bigint,identity_id text)
language plpgsql stable security definer set search_path='' as $$
begin
  if p_vocab_entry_ids is null or cardinality(p_vocab_entry_ids)>400 or exists(select 1 from unnest(p_vocab_entry_ids) v where v is null or v<1) then raise exception 'pronunciation_binding_input_invalid'; end if;
  return query select b.release_id,b.vocab_entry_id,b.identity_id from public.vocab_entry_pronunciation_bindings_v2 b
    join public.vocab_pronunciation_releases_v2 r on r.release_id=b.release_id and r.status='active'
    where b.vocab_entry_id=any(p_vocab_entry_ids) and b.is_entry_default
  union all select 'reviewed-exam:'||r.release_id::text,e.vocab_entry_id,e.pronunciation_identity_id
    from private.reviewed_exam_entries e join private.reviewed_exam_releases r on r.release_id=e.release_id
    join public.vocab_entries v on v.id=e.vocab_entry_id
    where e.vocab_entry_id=any(p_vocab_entry_ids) and e.pronunciation_identity_id is not null and (
      (r.status='active' and lower(v.row_sha256)=e.entry_sha256)
      or exists(select 1 from public.assignment_questions aq where aq.reviewed_exam_release_id_snapshot=r.release_id
          and (aq.vocab_entry_id=e.vocab_entry_id or e.vocab_entry_id=any(aq.choice_vocab_entry_ids)))
    );
end;
$$;
revoke all on function private.school_handout_source_row_v1(jsonb,text),
  private.validate_school_handout_entry_v1(jsonb,jsonb,text,integer),private.school_handout_pronunciation_v1(jsonb),
  private.validate_school_handout_release_v1(uuid),private.import_school_handout_reviewed_bundle_v1(text,text),
  private.activate_school_handout_reviewed_release_v1(uuid),private.guard_school_reviewed_content_v1()
  from public,anon,authenticated,service_role;
revoke all on function public.list_active_vocab_pronunciation_bindings_v3(bigint[]) from public,anon,authenticated,service_role;
grant execute on function public.list_active_vocab_pronunciation_bindings_v3(bigint[]) to service_role;
notify pgrst,'reload schema';
commit;
