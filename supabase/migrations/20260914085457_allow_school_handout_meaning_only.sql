begin;

-- Existing four-direction approvals retain their original requirements.
alter table private.school_handout_import_approvals_v1
  drop constraint school_handout_import_approvals_v1_check,
  drop constraint school_handout_import_approvals_v1_hide_dataset_keys_check,
  add constraint school_handout_import_approvals_v1_question_count_check
    check (question_count in (entry_count*2,entry_count*4)),
  add constraint school_handout_import_approvals_v1_hide_dataset_keys_check
    check (array_position(hide_dataset_keys,null) is null and
      ((question_count=entry_count*2 and cardinality(hide_dataset_keys)=0)
       or (question_count=entry_count*4 and cardinality(hide_dataset_keys)>0)));

create function private.validate_school_handout_meaning_entry_v1(p_entry jsonb,p_source jsonb,p_layout text,p_row integer)
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
    or (s->'school_english_definition'<>'null'::jsonb and (nullif(btrim(p_entry->>'english_definition'),'') is null
      or jsonb_typeof(p_entry->'english_definition') is distinct from 'string'))
    or jsonb_typeof(p_entry->'lexical_pos') is distinct from 'string'
    or p_entry->>'lexical_pos' not in ('noun','verb','adjective','adverb','preposition','conjunction','interjection','pronoun','other')
  then raise exception 'school_entry_source_mismatch'; end if;
  if s->'school_english_definition'<>'null'::jsonb then
    if p_entry->'english_definition' is distinct from s->'school_english_definition'
      or p_entry#>>'{definition_provenance,kind}' is distinct from 'school_handout'
    then raise exception 'school_definition_mismatch'; end if;
  elsif p_entry->'english_definition' is distinct from 'null'::jsonb
    or p_entry#>>'{definition_provenance,kind}' is distinct from 'school_not_provided'
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

create or replace function private.validate_school_handout_release_v1(p_release_id uuid)
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
  if ap.question_count=ap.entry_count*2 and not exists(select 1 from public.vocab_dataset_catalog c
    where c.dataset_id=r.dataset_id and c.material_kind='exam_prep' and c.publisher is null
      and c.academic_year is null and c.edition_label is null and c.curriculum_revision is null
      and c.series_title=r.school_bundle#>>'{dataset,title}'
      and c.metadata=jsonb_build_object('school',r.school_source#>>'{scope,school}',
        'semester',r.school_source#>'{scope,semester}','schoolYear',r.school_source#>'{scope,school_year}',
        'source',ap.dataset_key,'purpose','exam_prep','sourceKind','school_handout',
        'sourcePriority',jsonb_build_array('school_handout','provided_wordbook','requested_cefr'),
        'schoolScope',r.school_source->'scope','reviewedExamReleaseId',r.release_id))
  then raise exception 'school_meaning_catalog_mismatch'; end if;
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
    if ap.question_count=ap.entry_count*2 then
      perform private.validate_school_handout_meaning_entry_v1(e.payload,r.school_source->'entries'->(e.source_row-1),ap.source_layout,e.source_row);
    else
    perform private.validate_school_handout_entry_v1(e.payload,r.school_source->'entries'->(e.source_row-1),ap.source_layout,e.source_row);
    end if;
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
      or (select count(*) from private.reviewed_exam_items where release_id=r.release_id and vocab_entry_id=e.vocab_entry_id)<>(ap.question_count/ap.entry_count)
    then raise exception 'school_registered_entry_mismatch'; end if;
  end loop;
  for q in select * from private.reviewed_exam_items where release_id=r.release_id loop
    select * into strict e from private.reviewed_exam_entries where release_id=r.release_id and vocab_entry_id=q.vocab_entry_id;
    select array_agg(ce.vocab_entry_id order by c.n),array_agg(ce.payload->>q.choice_role order by c.n)
      into ids,vals from jsonb_array_elements_text(q.payload->'choice_source_rows') with ordinality c(value,n)
      join private.reviewed_exam_entries ce on ce.release_id=r.release_id and ce.source_row=c.value::int;
    if (ap.question_count=ap.entry_count*2 and q.quiz_mode<>'book_meaning_choice')
      or private.reviewed_exam_sha256_v1(q.payload-'item_sha256') is distinct from q.item_sha256
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

create or replace function private.import_school_handout_reviewed_bundle_v1(p_text text,p_source_text text)
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
    if ap.question_count=ap.entry_count*2 then
      perform private.validate_school_handout_meaning_entry_v1(ej,src->'entries'->(source_index-1),ap.source_layout,source_index);
    else
    perform private.validate_school_handout_entry_v1(ej,src->'entries'->(source_index-1),ap.source_layout,source_index);
    end if;
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
    values(dataset_value,template.catalog_group,case when ap.question_count=ap.entry_count*2 then 'exam_prep' else template.material_kind end,b#>>'{dataset,title}',template.grade_code,
      case when ap.question_count=ap.entry_count*2 then null else template.publisher end,
      case when ap.question_count=ap.entry_count*2 then b#>>'{dataset,title}' else template.series_title end,
      case when ap.question_count=ap.entry_count*2 then null else template.academic_year end,case when ap.question_count=ap.entry_count*2 then null else template.curriculum_revision end,
      case when ap.question_count=ap.entry_count*2 then null else template.edition_label end,false,template.sort_index,
      (case when ap.question_count=ap.entry_count*2 then jsonb_build_object('school',src#>>'{scope,school}',
        'semester',src#>'{scope,semester}','schoolYear',src#>'{scope,school_year}','source',ap.dataset_key) else template.metadata end)||jsonb_build_object('purpose','exam_prep','sourceKind','school_handout','sourcePriority',jsonb_build_array('school_handout','provided_wordbook','requested_cefr'),
        'schoolScope',src->'scope','reviewedExamReleaseId',release_value));
  perform private.validate_school_handout_release_v1(release_value);
  return jsonb_build_object('release_id',release_value,'dataset_id',dataset_value,'entries',ap.entry_count,'questions',ap.question_count,'status','staged');
end;
$$;

revoke all on function private.validate_school_handout_meaning_entry_v1(jsonb,jsonb,text,integer) from public,anon,authenticated,service_role;
commit;
