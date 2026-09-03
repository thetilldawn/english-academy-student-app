begin;

create function private.guard_simseok_exam_use_release_preview_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1',
    'simseok-g10-sem2-mid-adjective-500-v1',
    'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1',
    'simseok-g11-sem2-mid-mock-v1'
  ]::text[])
    and private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_exam_use_release_preview_only'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger app_exam_use_release_simseok_preview_guard_v1
before insert on word_index.app_exam_use_release
for each row execute function private.guard_simseok_exam_use_release_preview_v1();

create function private.catalog_simseok_sem2_dataset_v1(
  p_dataset_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  dataset_row public.vocab_datasets%rowtype;
  display_name_value text;
  catalog_group_value text := 'high';
  material_kind_value text;
  grade_code_value text;
  publisher_value text;
  series_title_value text;
  sort_index_value integer;
begin
  select dataset.* into dataset_row
  from public.vocab_datasets as dataset
  join word_index.app_exam_use_release as release
    on release.dataset_id = dataset.id
   and release.dataset_key = dataset.dataset_key
   and release.status = 'active'
   and release.target_environment = 'preview'
  where dataset.id = p_dataset_id
    and dataset.status = 'ready'
    and dataset.is_active;
  if not found then
    raise exception 'active_simseok_preview_dataset_not_found'
      using errcode = 'P0002';
  end if;

  case dataset_row.dataset_key
    when 'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1' then
      display_name_value := '[영어 II] 오선영 1과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g11';
      publisher_value := 'NE능률';
      series_title_value := '영어 II 오선영 1과';
      sort_index_value := 110;
    when 'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1' then
      display_name_value := '[영어 II] 오선영 2과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g11';
      publisher_value := 'NE능률';
      series_title_value := '영어 II 오선영 2과';
      sort_index_value := 120;
    when 'simseok-g11-sem2-mid-mock-v1' then
      display_name_value := '[심석 고2] 2-1 모고 단어';
      material_kind_value := 'exam_prep';
      grade_code_value := 'g11';
      publisher_value := null;
      series_title_value := '자이스토리 7·8회';
      sort_index_value := 130;
    when 'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1' then
      display_name_value := '[공통영어 II] 오선영 3과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g10';
      publisher_value := 'NE능률';
      series_title_value := '공통영어 II 오선영 3과';
      sort_index_value := 210;
    when 'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1' then
      display_name_value := '[공통영어 II] 오선영 4과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g10';
      publisher_value := 'NE능률';
      series_title_value := '공통영어 II 오선영 4과';
      sort_index_value := 220;
    when 'simseok-g10-sem2-mid-adjective-500-v1' then
      display_name_value := '[심석 고1] 2-1 필수 형용사 500';
      material_kind_value := 'wordbook';
      grade_code_value := 'g10';
      publisher_value := null;
      series_title_value := '필수 형용사 500';
      sort_index_value := 230;
    else
      raise exception 'not_a_simseok_sem2_dataset' using errcode = '22023';
  end case;

  if dataset_row.title is distinct from display_name_value then
    raise exception 'simseok_dataset_title_mismatch' using errcode = '22023';
  end if;

  insert into public.vocab_dataset_catalog (
    dataset_id, display_name, catalog_group, material_kind, grade_code,
    publisher, series_title, academic_year, curriculum_revision,
    edition_label, is_assignable, sort_index, metadata
  ) values (
    p_dataset_id, display_name_value, catalog_group_value,
    material_kind_value, grade_code_value, publisher_value,
    series_title_value, null, null, null, true, sort_index_value,
    jsonb_build_object(
      'source', dataset_row.dataset_key,
      'school', '심석고등학교',
      'schoolYear', 2026,
      'semester', 2,
      'scopeStatus',
        'user_directed_operational_scope_not_officially_confirmed',
      'bundleManifestSha256',
        '1B197A1066283422F6C30B9A08D0C93CFC986BBF41258443B7A0569EA86F820D',
      'officialSchoolRangeConfirmed', false,
      'targetEnvironment', 'preview',
      'productionAllowed', false
    )
  )
  on conflict (dataset_id) do update set
    display_name = excluded.display_name,
    catalog_group = excluded.catalog_group,
    material_kind = excluded.material_kind,
    grade_code = excluded.grade_code,
    publisher = excluded.publisher,
    series_title = excluded.series_title,
    academic_year = excluded.academic_year,
    curriculum_revision = excluded.curriculum_revision,
    edition_label = excluded.edition_label,
    is_assignable = excluded.is_assignable,
    sort_index = excluded.sort_index,
    metadata = excluded.metadata
  where row(
    public.vocab_dataset_catalog.display_name,
    public.vocab_dataset_catalog.catalog_group,
    public.vocab_dataset_catalog.material_kind,
    public.vocab_dataset_catalog.grade_code,
    public.vocab_dataset_catalog.publisher,
    public.vocab_dataset_catalog.series_title,
    public.vocab_dataset_catalog.academic_year,
    public.vocab_dataset_catalog.curriculum_revision,
    public.vocab_dataset_catalog.edition_label,
    public.vocab_dataset_catalog.is_assignable,
    public.vocab_dataset_catalog.sort_index,
    public.vocab_dataset_catalog.metadata
  ) is distinct from row(
    excluded.display_name,
    excluded.catalog_group,
    excluded.material_kind,
    excluded.grade_code,
    excluded.publisher,
    excluded.series_title,
    excluded.academic_year,
    excluded.curriculum_revision,
    excluded.edition_label,
    excluded.is_assignable,
    excluded.sort_index,
    excluded.metadata
  );

  insert into public.vocab_unit_catalog (
    unit_id, catalog_group, unit_type, display_name, unit_code,
    academic_year, exam_month, agency, item_range, sort_index, metadata
  )
  select
    unit.id,
    'high',
    case
      when unit.unit_label ~ '^DAY [0-9]{2}$' then 'day'
      when dataset_row.dataset_key = 'simseok-g11-sem2-mid-mock-v1'
        then 'exam_scope'
      else 'supplement'
    end,
    unit.unit_label,
    dataset_row.dataset_key || ':' || unit.sort_index::text,
    null,
    null,
    case
      when dataset_row.dataset_key = 'simseok-g11-sem2-mid-mock-v1'
        then '자이스토리'
      else null
    end,
    case
      when dataset_row.dataset_key = 'simseok-g11-sem2-mid-mock-v1'
        then replace(replace(unit.unit_label, '자이 ', ''), '번', '')
      when unit.unit_label ~ '^[0-9]+쪽$' then unit.unit_label
      else null
    end,
    unit.sort_index,
    jsonb_build_object(
      'sourceUnitLabel', unit.unit_label,
      'scopeStatus',
        'user_directed_operational_scope_not_officially_confirmed',
      'officialSchoolRangeConfirmed', false
    )
  from public.vocab_units as unit
  where unit.dataset_id = p_dataset_id
  on conflict (unit_id) do update set
    catalog_group = excluded.catalog_group,
    unit_type = excluded.unit_type,
    display_name = excluded.display_name,
    unit_code = excluded.unit_code,
    academic_year = excluded.academic_year,
    exam_month = excluded.exam_month,
    agency = excluded.agency,
    item_range = excluded.item_range,
    sort_index = excluded.sort_index,
    metadata = excluded.metadata
  where row(
    public.vocab_unit_catalog.catalog_group,
    public.vocab_unit_catalog.unit_type,
    public.vocab_unit_catalog.display_name,
    public.vocab_unit_catalog.unit_code,
    public.vocab_unit_catalog.academic_year,
    public.vocab_unit_catalog.exam_month,
    public.vocab_unit_catalog.agency,
    public.vocab_unit_catalog.item_range,
    public.vocab_unit_catalog.sort_index,
    public.vocab_unit_catalog.metadata
  ) is distinct from row(
    excluded.catalog_group,
    excluded.unit_type,
    excluded.display_name,
    excluded.unit_code,
    excluded.academic_year,
    excluded.exam_month,
    excluded.agency,
    excluded.item_range,
    excluded.sort_index,
    excluded.metadata
  );
end;
$$;

create function public.import_simseok_exam_use_package_preview_v1(
  p_package jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  import_result jsonb;
  created_dataset_id uuid;
  expected_title text;
  expected_package_version text;
  expected_source_sha256 text;
  expected_candidate_dictionary_version text;
  expected_manifest_content_hash text;
  expected_exam_review_ledger_sha256 text;
  expected_wordbook_id text;
  expected_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_preview_project_mismatch'
      using errcode = '42501';
  end if;
  if p_package is null or jsonb_typeof(p_package) <> 'object' then
    raise exception 'invalid_simseok_preview_package' using errcode = '22023';
  end if;

  case p_package ->> 'dataset_key'
    when 'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1' then
      expected_title := '[영어 II] 오선영 1과 단어';
      expected_package_version := '27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb';
      expected_source_sha256 := '6876434435288010c844406c78c1c43b8ac3ab550a3fac4c06a043f84536ebb4';
      expected_candidate_dictionary_version := 'f7791fe880bc8a38c3fb2f626e8c46bcc404812973d04d2e70b88125cdbc732f';
      expected_manifest_content_hash := '6d36a5dcfe56cff53547eeb9e518257fc20a060456b4039d14641f4b0f77be78';
      expected_exam_review_ledger_sha256 := '22743113f3cbc8f74f1691e4cc49b30a38887c0c067b2453a6badad3a163d5af';
      expected_wordbook_id := 'simseok-sem2-2026:g2_l1:v2';
      expected_count := 320;
    when 'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1' then
      expected_title := '[영어 II] 오선영 2과 단어';
      expected_package_version := 'd86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0';
      expected_source_sha256 := '9384c2d8aa8d25c88f87444fc3d78570660b39cd8f2d9c844a7bb4d977eaaf08';
      expected_candidate_dictionary_version := '5bb9ff66348cb0e1cf6b8356872d5a87524431aebaa35aed94cffb07e7d24f5f';
      expected_manifest_content_hash := '7e90a893affb6991d268afda168a7978c617136fcb9809c9dc39fabae529025e';
      expected_exam_review_ledger_sha256 := 'bcaef175075362d5b0f3c1b6f1d72a4e0f5434c6067f3e83dabaac85de8aff7b';
      expected_wordbook_id := 'simseok-sem2-2026:g2_l2:v2';
      expected_count := 189;
    when 'simseok-g11-sem2-mid-mock-v1' then
      expected_title := '[심석 고2] 2-1 모고 단어';
      expected_package_version := '120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c';
      expected_source_sha256 := '22db0ffa49960dcf28c6b612203364a664b4c83378366f26e538a6d42457f17f';
      expected_candidate_dictionary_version := '69fb7be81f16335b3f0778a2d1f8ed143d4bfd76b6b70b443fa133f872a02055';
      expected_manifest_content_hash := '234a702b2266e6a371fe3cf501db5471cde33f6bbc4c0898835d4c6cdcaa5b5e';
      expected_exam_review_ledger_sha256 := '615139f2fd6c242d920c5f4e1285f33d6e75bc5bed75c42aee3e2b67e310eb56';
      expected_wordbook_id := 'simseok-sem2-2026:g2_mock:v2';
      expected_count := 278;
    when 'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1' then
      expected_title := '[공통영어 II] 오선영 3과 단어';
      expected_package_version := 'f7492c56b587917deb535a5da971bbdaa78f4c64f1cd26a0fea73af0c969eca9';
      expected_source_sha256 := '3256625a8b6ca1b8e459570fc4c651eef97ce6931ff9f8e5540f06ef011b5352';
      expected_candidate_dictionary_version := '592a048fa8576172eb496269c0ab1ab079297101525a4a905c3eaace283b7d07';
      expected_manifest_content_hash := '0171eb5119b7569309f164563947ea7949ec3c9fb7f2e4eb0dc334494da3c468';
      expected_exam_review_ledger_sha256 := '9de4e99a060a2a98a4ab1d6c80fd3562270f868ece49e3f62d8eb61bf34dd1e3';
      expected_wordbook_id := 'simseok-sem2-2026:g1_l3:v2';
      expected_count := 169;
    when 'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1' then
      expected_title := '[공통영어 II] 오선영 4과 단어';
      expected_package_version := 'd5895f920dedf4327b4d615d88ccdb52fdf9a6ebcc7435f1eca7cfe6359cdcb3';
      expected_source_sha256 := '9f6eb57c6c1b8dd071fe91f867730536404ba28aeb6b1a787915a51d7ffca4b6';
      expected_candidate_dictionary_version := '6dfe5d3e82f2ff651616392f56c75d96b02c63939ba64d6a1f1e3af3d61eb3e2';
      expected_manifest_content_hash := 'ff03289a83f753a79261a8e22f6dd1f2ca0cbc7fa093ebe24ccada0f1e466805';
      expected_exam_review_ledger_sha256 := '6696e68970a47a82c61209f8203510d20d434d29cd4dfe6ea7e5cd53e7adc81d';
      expected_wordbook_id := 'simseok-sem2-2026:g1_l4:v2';
      expected_count := 128;
    when 'simseok-g10-sem2-mid-adjective-500-v1' then
      expected_title := '[심석 고1] 2-1 필수 형용사 500';
      expected_package_version := '95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e';
      expected_source_sha256 := 'a7891662f732a57c4f9ade87e73d82875db61c44760bcc0c57a863353db428c5';
      expected_candidate_dictionary_version := '62ae183474dc51b0374297d46a8615f16ca41f04b7dc250a8e11b4e14121622d';
      expected_manifest_content_hash := '3937ca58344c5a5e68c1ac3cfb86f50f4df17cca35c0886468e889b091bcfebc';
      expected_exam_review_ledger_sha256 := 'bff7100b4db7221a1a37cca12f930a43fe74a337999e7e8bed6f1be9fe019efa';
      expected_wordbook_id := 'simseok-sem2-2026:g1_adj500:v2';
      expected_count := 500;
    else
      raise exception 'simseok_preview_dataset_not_allowlisted'
        using errcode = '22023';
  end case;

  if p_package ->> 'schema_version' is distinct from '1.0'
    or p_package ->> 'package_type' is distinct from
      'student-app-exam-use-wordbook'
    or p_package ->> 'target_environment' is distinct from 'preview'
    or p_package -> 'common_dictionary_release_allowed' is distinct from
      'false'::jsonb
    or p_package -> 'exam_use_import_allowed' is distinct from 'true'::jsonb
    or p_package ->> 'title' is distinct from expected_title
    or lower(p_package ->> 'package_version') is distinct from expected_package_version
    or lower(p_package ->> 'source_sha256') is distinct from expected_source_sha256
    or lower(p_package ->> 'candidate_dictionary_version') is distinct from
      expected_candidate_dictionary_version
    or lower(p_package ->> 'manifest_content_hash') is distinct from
      expected_manifest_content_hash
    or lower(p_package ->> 'exam_review_ledger_sha256') is distinct from
      expected_exam_review_ledger_sha256
    or p_package ->> 'wordbook_id' is distinct from expected_wordbook_id
    or jsonb_typeof(p_package -> 'entries') is distinct from 'array'
  then
    raise exception 'simseok_preview_package_identity_mismatch'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_package -> 'entries') is distinct from expected_count
    or exists (
      select 1
      from jsonb_array_elements(p_package -> 'entries') as input(entry)
      where input.entry ->> 'exam_use_status' is distinct from 'reviewed_for_preview'
        or input.entry -> 'include_in_exam' is distinct from 'true'::jsonb
        or input.entry #>> '{context_evidence,scope_status}' is distinct from
          'user_directed_operational_scope_not_officially_confirmed'
        or lower(input.entry #>> '{context_evidence,bundle_manifest_sha256}')
          is distinct from
          '1b197a1066283422f6c30b9a08d0c93cfc986bbf41258443b7a0569ea86f820d'
        or (
          input.entry -> 'manual_review_flags'
          @> '["official_school_range_not_locally_confirmed"]'::jsonb
        ) is distinct from true
    )
  then
    raise exception 'simseok_preview_package_identity_mismatch'
      using errcode = '22023';
  end if;

  import_result := private.import_app_exam_use_package_v1(p_package);
  created_dataset_id := (import_result ->> 'datasetId')::uuid;
  perform private.catalog_simseok_sem2_dataset_v1(created_dataset_id);
  return import_result || jsonb_build_object(
    'cataloged', true,
    'targetEnvironment', 'preview',
    'officialSchoolRangeConfirmed', false
  );
end;
$$;

create function public.import_simseok_sem2_preview_bundle_v1(
  p_package_texts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_text text;
  package jsonb;
  imported jsonb;
  expected_package_file_sha256 text;
  results jsonb := '[]'::jsonb;
  imported_occurrence_count integer := 0;
  dataset_keys text[];
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_preview_project_mismatch'
      using errcode = '42501';
  end if;
  if p_package_texts is null
    or jsonb_typeof(p_package_texts) is distinct from 'array'
    or jsonb_array_length(p_package_texts) is distinct from 6
    or exists (
      select 1
      from jsonb_array_elements(p_package_texts) as input(value)
      where jsonb_typeof(input.value) is distinct from 'string'
    )
  then
    raise exception 'invalid_simseok_preview_bundle' using errcode = '22023';
  end if;

  select array_agg(
    (value::jsonb) ->> 'dataset_key'
    order by (value::jsonb) ->> 'dataset_key'
  )
  into dataset_keys
  from jsonb_array_elements_text(p_package_texts) as input(value);
  if dataset_keys is distinct from array[
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1',
    'simseok-g10-sem2-mid-adjective-500-v1',
    'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1',
    'simseok-g11-sem2-mid-mock-v1'
  ]::text[] then
    raise exception 'simseok_preview_bundle_dataset_mismatch'
      using errcode = '22023';
  end if;

  for package_text in
    select value
    from jsonb_array_elements_text(p_package_texts)
      with ordinality as input(value, position)
    order by position
  loop
    package := package_text::jsonb;
    if jsonb_typeof(package) is distinct from 'object' then
      raise exception 'invalid_simseok_preview_package_text'
        using errcode = '22023';
    end if;
    case package ->> 'dataset_key'
      when 'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1' then
        expected_package_file_sha256 :=
          'c50ab74358a9c17f85b45a9f998bb68bf879386f6121817624dc9d3e5dfec5c5';
      when 'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1' then
        expected_package_file_sha256 :=
          '4a0970994423cd9d412c26824a90c1b13fb16a25422d16ca3ee8de843910eba8';
      when 'simseok-g11-sem2-mid-mock-v1' then
        expected_package_file_sha256 :=
          '42a35b8f02be69664d0c9f80d7783b80d0c76f62bce5ad965f94a9b12f355155';
      when 'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1' then
        expected_package_file_sha256 :=
          '9e83c757ea404e14978166458550e106fb648b1e1e9042b93b48bb2c30d9ec99';
      when 'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1' then
        expected_package_file_sha256 :=
          '2ea8d28fb84202964062aeafbf95cd6fecc67f3bc9c23d67c92c9dd3742fa512';
      when 'simseok-g10-sem2-mid-adjective-500-v1' then
        expected_package_file_sha256 :=
          '34f3d61874c971e23ddd971a1b7311c7f37d34e33e28555dec772da3bf811514';
      else
        raise exception 'simseok_preview_dataset_not_allowlisted'
          using errcode = '22023';
    end case;
    if encode(
      extensions.digest(convert_to(package_text, 'UTF8'), 'sha256'),
      'hex'
    ) is distinct from expected_package_file_sha256 then
      raise exception 'simseok_preview_package_file_hash_mismatch'
        using errcode = '22023';
    end if;
    imported := public.import_simseok_exam_use_package_preview_v1(package);
    if imported is null
      or jsonb_typeof(imported) is distinct from 'object'
      or imported ->> 'status' is distinct from 'active'
      or coalesce(imported ->> 'occurrenceCount', '') !~ '^[1-9][0-9]*$'
      or imported -> 'idempotent' not in ('true'::jsonb, 'false'::jsonb)
    then
      raise exception 'invalid_simseok_preview_import_result'
        using errcode = '21000';
    end if;
    results := results || jsonb_build_array(imported);
    imported_occurrence_count := imported_occurrence_count
      + (imported ->> 'occurrenceCount')::integer;
  end loop;
  if jsonb_array_length(results) is distinct from 6
    or imported_occurrence_count is distinct from 1584
  then
    raise exception 'simseok_preview_bundle_result_mismatch'
      using errcode = '21000';
  end if;
  return jsonb_build_object(
    'status', 'active',
    'datasetCount', 6,
    'occurrenceCount', imported_occurrence_count,
    'targetEnvironment', 'preview',
    'officialSchoolRangeConfirmed', false,
    'datasets', results
  );
end;
$$;

create function public.list_assignment_question_mode_availability_v1()
returns table (
  dataset_id uuid,
  definition_count bigint,
  example_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return query
  select
    release.dataset_id,
    count(distinct item.question_item_id) filter (
      where item.quiz_mode = 'canonical_definition_to_headword'
    ) as definition_count,
    count(distinct item.question_item_id) filter (
      where item.quiz_mode = 'canonical_example_to_headword'
    ) as example_count
  from word_index.app_canonical_question_preview_release as release
  join word_index.app_exam_use_release as exam_release
    on exam_release.release_id = release.exam_use_release_id
   and exam_release.dataset_id = release.dataset_id
   and exam_release.status = 'active'
   and exam_release.target_environment = 'preview'
   and exam_release.exam_use_import_allowed
  join word_index.app_canonical_question_preview_item as item
    on item.release_id = release.release_id
   and item.dataset_id = release.dataset_id
   and item.exam_use_release_id = exam_release.release_id
  where release.status = 'active'
    and release.target_environment = 'preview'
    and release.preview_apply_allowed
    and not release.production_apply_allowed
  group by release.dataset_id;
end;
$$;

revoke all on function private.catalog_simseok_sem2_dataset_v1(uuid)
  from public, anon, authenticated, service_role;
revoke all on function private.guard_simseok_exam_use_release_preview_v1()
  from public, anon, authenticated, service_role;
revoke all on function public.import_simseok_exam_use_package_preview_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.import_simseok_sem2_preview_bundle_v1(jsonb)
  from public, anon, authenticated, service_role;
revoke all on function public.list_assignment_question_mode_availability_v1()
  from public, anon, authenticated, service_role;
grant execute on function public.import_simseok_sem2_preview_bundle_v1(jsonb)
  to service_role;
grant execute on function public.list_assignment_question_mode_availability_v1()
  to authenticated;

notify pgrst, 'reload schema';

commit;
