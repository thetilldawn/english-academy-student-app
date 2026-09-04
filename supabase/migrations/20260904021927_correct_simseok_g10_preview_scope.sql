begin;

alter table word_index.app_canonical_question_preview_release
  drop constraint app_canonical_question_preview_release_profile_check;

alter table word_index.app_canonical_question_preview_release
  add constraint app_canonical_question_preview_release_profile_check check (
    (
      release_profile = 'oewn_app_preview_v1'
      and contract = 'oewn-app-preview-question-manifest-v1'
      and schema_version = '1.0'
      and policy_version = 'g12-2025-oewn-app-preview-question-v1'
      and expected_item_count = 512
      and expected_expanded_count = 540
      and expected_source_entry_count = 270
      and item_binding_sha256 is null
      and handoff_manifest_file_sha256 is null
      and independent_review_ledger_sha256 is null
      and generator_file_sha256 is null
    )
    or
    (
      release_profile = 'simseok_sem2_combined_v2'
      and contract = 'simseok-combined-app-preview-question-package-v2'
      and schema_version = '2.0'
      and policy_version = 'simseok-sem2-combined-preview-v2'
      and expected_item_count > 0
      and expected_expanded_count >= expected_item_count
      and expected_source_entry_count > 0
      and expected_source_entry_count <= expected_expanded_count
      and coalesce(item_binding_sha256 ~ '^[0-9a-f]{64}$', false)
      and coalesce(
        handoff_manifest_file_sha256 ~ '^[0-9a-f]{64}$', false
      )
      and coalesce(
        independent_review_ledger_sha256 ~ '^[0-9a-f]{64}$', false
      )
      and coalesce(generator_file_sha256 ~ '^[0-9a-f]{64}$', false)
    )
    or
    (
      release_profile = 'simseok_g10_scope_correction_v3'
      and contract = 'simseok-combined-app-preview-question-package-v2'
      and schema_version = '2.0'
      and policy_version =
        'simseok-sem2-combined-preview-v3-g1-lessons-1-2'
      and expected_item_count > 0
      and expected_expanded_count >= expected_item_count
      and expected_source_entry_count > 0
      and expected_source_entry_count <= expected_expanded_count
      and coalesce(item_binding_sha256 ~ '^[0-9a-f]{64}$', false)
      and coalesce(
        handoff_manifest_file_sha256 ~ '^[0-9a-f]{64}$', false
      )
      and coalesce(
        independent_review_ledger_sha256 ~ '^[0-9a-f]{64}$', false
      )
      and coalesce(generator_file_sha256 ~ '^[0-9a-f]{64}$', false)
    )
  );

create or replace function private.guard_simseok_exam_use_release_preview_v1()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1',
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

create function private.catalog_simseok_g10_scope_correction_dataset_v3(
  p_dataset_id uuid,
  p_assignable boolean
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
;
  if not found then
    raise exception 'simseok_g10_scope_correction_dataset_not_found'
      using errcode = 'P0002';
  end if;

  case dataset_row.dataset_key
    when 'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1' then
      display_name_value := '[공통영어 II] 오선영 1과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g10';
      publisher_value := 'NE능률';
      series_title_value := '공통영어 II 오선영 1과';
      sort_index_value := 210;
    when 'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1' then
      display_name_value := '[공통영어 II] 오선영 2과 단어';
      material_kind_value := 'textbook';
      grade_code_value := 'g10';
      publisher_value := 'NE능률';
      series_title_value := '공통영어 II 오선영 2과';
      sort_index_value := 220;
    else
      raise exception 'not_a_simseok_g10_scope_correction_dataset'
        using errcode = '22023';
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
    series_title_value, null, null, null, p_assignable, sort_index_value,
    jsonb_build_object(
      'source', dataset_row.dataset_key,
      'school', '심석고등학교',
      'schoolYear', 2026,
      'semester', 2,
      'scopeStatus',
        'user_directed_operational_scope_not_officially_confirmed',
      'bundleManifestSha256',
        '97732D475FAB33C175A47A9B441227C38DADC2F8A5B3C2C3665D9994846F5D72',
      'officialSchoolRangeConfirmed', false,
      'targetEnvironment', 'preview',
      'productionAllowed', false,
      'scopeCorrectionVersion', 'v3',
      'scopeCorrectionPendingCutover', not p_assignable
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

create function private.stage_simseok_g10_scope_correction_exam_package_v3(
  p_package_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package jsonb;
  imported jsonb;
  dataset_id_value uuid;
  expected_file_sha256 text;
  expected_title text;
  expected_package_version text;
  expected_count integer;
  dataset_status text;
  dataset_active boolean;
  catalog_assignable boolean;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_g10_scope_correction_preview_project_mismatch'
      using errcode = '42501';
  end if;
  if p_package_text is null or btrim(p_package_text) = '' then
    raise exception 'invalid_simseok_g10_scope_correction_exam_package_text'
      using errcode = '22023';
  end if;

  package := p_package_text::jsonb;
  if jsonb_typeof(package) is distinct from 'object' then
    raise exception 'invalid_simseok_g10_scope_correction_exam_package_text'
      using errcode = '22023';
  end if;

  case package ->> 'dataset_key'
    when 'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1' then
      expected_file_sha256 :=
        '2bd1365075c0a7d3c4c0c47f397b385e90c0b5ea7d98e8ebf6798d0b2d110a54';
      expected_title := '[공통영어 II] 오선영 1과 단어';
      expected_package_version :=
        '4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38';
      expected_count := 111;
    when 'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1' then
      expected_file_sha256 :=
        '744d4f60b2bf9795f319a942f3ff38b2e276fea031867814039e49237a9ce086';
      expected_title := '[공통영어 II] 오선영 2과 단어';
      expected_package_version :=
        '5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf';
      expected_count := 111;
    else
      raise exception 'simseok_g10_scope_correction_exam_dataset_not_allowlisted'
        using errcode = '22023';
  end case;

  if encode(
    extensions.digest(convert_to(p_package_text, 'UTF8'), 'sha256'),
    'hex'
  ) is distinct from expected_file_sha256
    or package ->> 'schema_version' is distinct from '1.0'
    or package ->> 'package_type' is distinct from
      'student-app-exam-use-wordbook'
    or package ->> 'target_environment' is distinct from 'preview'
    or package -> 'common_dictionary_release_allowed' is distinct from
      'false'::jsonb
    or package -> 'exam_use_import_allowed' is distinct from 'true'::jsonb
    or package ->> 'title' is distinct from expected_title
    or lower(package ->> 'package_version') is distinct from
      expected_package_version
    or jsonb_typeof(package -> 'entries') is distinct from 'array'
    or jsonb_array_length(package -> 'entries') is distinct from expected_count
    or exists (
      select 1
      from jsonb_array_elements(package -> 'entries') as input(entry)
      where input.entry ->> 'exam_use_status' is distinct from
          'reviewed_for_preview'
        or input.entry -> 'include_in_exam' is distinct from 'true'::jsonb
        or input.entry #>> '{context_evidence,scope_status}' is distinct from
          'user_directed_operational_scope_not_officially_confirmed'
        or lower(input.entry #>> '{context_evidence,bundle_manifest_sha256}')
          is distinct from
          '97732d475fab33c175a47a9b441227c38dadc2f8a5b3c2c3665d9994846f5d72'
        or (
          input.entry -> 'manual_review_flags'
          @> '["official_school_range_not_locally_confirmed"]'::jsonb
        ) is distinct from true
    )
  then
    raise exception 'simseok_g10_scope_correction_exam_identity_mismatch'
      using errcode = '22023';
  end if;

  imported := private.import_app_exam_use_package_v1(package);
  dataset_id_value := (imported ->> 'datasetId')::uuid;

  select dataset.status::text, dataset.is_active, catalog.is_assignable
  into dataset_status, dataset_active, catalog_assignable
  from public.vocab_datasets as dataset
  left join public.vocab_dataset_catalog as catalog
    on catalog.dataset_id = dataset.id
  where dataset.id = dataset_id_value
  for update of dataset;

  if dataset_status = 'ready'
    and dataset_active
    and catalog_assignable is true
  then
    return imported || jsonb_build_object(
      'status', 'active',
      'cataloged', true,
      'targetEnvironment', 'preview',
      'officialSchoolRangeConfirmed', false
    );
  end if;
  if dataset_status not in ('ready', 'pending_review')
    or catalog_assignable is true
  then
    raise exception 'simseok_g10_scope_correction_exam_stage_state_mismatch'
      using errcode = '55000';
  end if;

  perform private.catalog_simseok_g10_scope_correction_dataset_v3(
    dataset_id_value,
    false
  );
  update public.vocab_datasets
  set status = 'pending_review',
      is_active = false
  where id = dataset_id_value;

  return imported || jsonb_build_object(
    'status', 'staged',
    'cataloged', true,
    'targetEnvironment', 'preview',
    'officialSchoolRangeConfirmed', false
  );
end;
$$;

create function private.stage_simseok_g10_scope_correction_question_release_v3(
  p_package_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package jsonb;
  exam_release word_index.app_exam_use_release%rowtype;
  existing_release word_index.app_canonical_question_preview_release%rowtype;
  created_release_id uuid;
  dataset_id_value uuid;
  expected_dataset_key text;
  expected_set_key text;
  expected_package_file_sha256 text;
  expected_package_content_hash text;
  expected_item_binding_sha256 text;
  expected_exam_package_file_sha256 text;
  expected_exam_package_version text;
  expected_item_count integer;
  expected_expanded_count integer;
  expected_source_entry_count integer;
  expected_definition_count integer;
  expected_example_count integer;
  calculated_item_binding_sha256 text;
  calculated_source_entry_count integer;
  inserted_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_combined_question_preview_project_mismatch'
      using errcode = '42501';
  end if;
  if p_package_text is null or btrim(p_package_text) = '' then
    raise exception 'invalid_simseok_combined_question_package_text'
      using errcode = '22023';
  end if;

  package := p_package_text::jsonb;
  if jsonb_typeof(package) is distinct from 'object' then
    raise exception 'invalid_simseok_combined_question_package_text'
      using errcode = '22023';
  end if;
  expected_dataset_key := package ->> 'dataset_key';

  case expected_dataset_key
    when 'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1' then
      expected_set_key := 'g1_l1';
      expected_package_file_sha256 :=
        '16d754616e2945c603eb0d4c87f68d51ab59b2838bc290363aa23dafc2d98aeb';
      expected_package_content_hash :=
        '33496efb466d4c969da2e44de66921638168a7088f11d21c0ad70eebadd64b5a';
      expected_item_binding_sha256 :=
        '2de8bbcde065ccd0322ea3a0d57af3bed5f518d9588710dbc97b297bcb3252d3';
      expected_exam_package_file_sha256 :=
        '2bd1365075c0a7d3c4c0c47f397b385e90c0b5ea7d98e8ebf6798d0b2d110a54';
      expected_exam_package_version :=
        '4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38';
      expected_item_count := 117;
      expected_expanded_count := 119;
      expected_source_entry_count := 82;
      expected_definition_count := 68;
      expected_example_count := 49;
    when 'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1' then
      expected_set_key := 'g1_l2';
      expected_package_file_sha256 :=
        '536f2beedec9b4a428cd87a11c7c4df310e890905184499e2ce35ffe81088cc5';
      expected_package_content_hash :=
        '76385cb902e0352389ec958d75b948d4460a1f79ac97204895a978646791cd54';
      expected_item_binding_sha256 :=
        '4ffc47956d1f3e02514389c8194ded87f22cf91886298d392f09fadcee6a1693';
      expected_exam_package_file_sha256 :=
        '744d4f60b2bf9795f319a942f3ff38b2e276fea031867814039e49237a9ce086';
      expected_exam_package_version :=
        '5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf';
      expected_item_count := 128;
      expected_expanded_count := 130;
      expected_source_entry_count := 86;
      expected_definition_count := 70;
      expected_example_count := 58;
    else
      raise exception 'simseok_g10_scope_correction_question_dataset_not_allowlisted'
        using errcode = '22023';
  end case;

  if encode(
    extensions.digest(convert_to(p_package_text, 'UTF8'), 'sha256'),
    'hex'
  ) is distinct from expected_package_file_sha256 then
    raise exception 'simseok_combined_question_package_file_hash_mismatch'
      using errcode = '22023';
  end if;

  if package ->> 'contract' is distinct from
      'simseok-combined-app-preview-question-package-v2'
    or package ->> 'schema_version' is distinct from '2.0'
    or package ->> 'policy_version' is distinct from
      'simseok-sem2-combined-preview-v3-g1-lessons-1-2'
    or package ->> 'set_key' is distinct from expected_set_key
    or lower(package ->> 'content_hash') is distinct from
      expected_package_content_hash
    or lower(package ->> 'item_binding_sha256') is distinct from
      expected_item_binding_sha256
    or lower(package ->> 'exam_handoff_content_hash') is distinct from
      '4ffc2e1bc3c1fd62747b2564dd948a8520b8693bb7ce965e891b790b7652c977'
    or lower(package ->> 'exam_use_package_file_sha256') is distinct from
      expected_exam_package_file_sha256
    or lower(package ->> 'exam_use_package_version') is distinct from
      expected_exam_package_version
    or lower(package ->> 'source_bundle_manifest_sha256') is distinct from
      '97732d475fab33c175a47a9b441227c38dadc2f8a5b3c2c3665d9994846f5d72'
    or package #>> '{safety,target_environment}' is distinct from 'preview'
    or package #>> '{safety,target_project_ref}' is distinct from
      'wojxpruvbjzbhrpmsbuy'
    or package #> '{safety,source_shadow_only}' is distinct from 'true'::jsonb
    or package #> '{safety,preview_apply_allowed}' is distinct from 'true'::jsonb
    or package #> '{safety,canonical_approved}' is distinct from 'false'::jsonb
    or package #> '{safety,release_allowed}' is distinct from 'false'::jsonb
    or package #> '{safety,production_apply_allowed}' is distinct from
      'false'::jsonb
    or jsonb_typeof(package -> 'items') is distinct from 'array'
    or jsonb_typeof(package -> 'validation') is distinct from 'object'
  then
    raise exception 'simseok_combined_question_package_identity_mismatch'
      using errcode = '22023';
  end if;

  if jsonb_array_length(package -> 'items') is distinct from expected_item_count
    or (package #>> '{validation,items}')::integer is distinct from
      expected_item_count
    or (package #>> '{validation,unique_question_items}')::integer is distinct
      from expected_item_count
    or (package #>> '{validation,expanded_items}')::integer is distinct from
      expected_expanded_count
    or (package #>> '{validation,unique_target_source_entries}')::integer
      is distinct from expected_source_entry_count
    or (package #>>
      '{validation,mode_counts,canonical_definition_to_headword}')::integer
      is distinct from expected_definition_count
    or (package #>>
      '{validation,mode_counts,canonical_example_to_headword}')::integer
      is distinct from expected_example_count
  then
    raise exception 'simseok_combined_question_package_count_mismatch'
      using errcode = '22023';
  end if;

  -- Validate types before expanding nested arrays, so malformed JSON always
  -- fails with the package contract error rather than a partial write.
  if exists (
    select 1
    from jsonb_array_elements(package -> 'items') as input(item)
    where jsonb_typeof(input.item) is distinct from 'object'
      or input.item ->> 'contract' is distinct from
        'simseok-combined-app-preview-question-item-v2'
      or input.item ->> 'schema_version' is distinct from '2.0'
      or input.item ->> 'policy_version' is distinct from
        'simseok-sem2-combined-preview-v3-g1-lessons-1-2'
      or coalesce(input.item ->> 'question_item_id', '') = ''
      or coalesce(input.item ->> 'content_hash', '') !~ '^[0-9a-f]{64}$'
      or input.item ->> 'quiz_mode' not in (
        'canonical_definition_to_headword',
        'canonical_example_to_headword'
      )
      or coalesce(input.item ->> 'target_definition_item_id', '') = ''
      or coalesce(input.item ->> 'target_sense_family_id', '') = ''
      or coalesce(input.item ->> 'target_family_revision_hash', '')
        !~ '^[0-9a-f]{64}$'
      or coalesce(input.item ->> 'target_headword', '') = ''
      or input.item ->> 'target_part_of_speech' not in (
        'noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction',
        'interjection', 'determiner', 'pronoun', 'other'
      )
      or jsonb_typeof(input.item -> 'target_pos_signature') is distinct from
        'array'
      or jsonb_typeof(input.item -> 'choice_headwords') is distinct from 'array'
      or jsonb_typeof(input.item -> 'choice_source_entry_ids') is distinct from
        'array'
      or coalesce(input.item ->> 'correct_choice_index', '') !~ '^[0-3]$'
      or jsonb_typeof(input.item -> 'source_entry_ids') is distinct from 'array'
      or jsonb_typeof(input.item -> 'source_occurrence_hashes') is distinct from
        'array'
      or coalesce(input.item ->> 'prompt_en', '') = ''
      or coalesce(input.item ->> 'prompt_source_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(input.item ->> 'source_definition_content_hash', '')
        !~ '^[0-9a-f]{64}$'
      or coalesce(input.item ->> 'source_example_content_hash', '')
        !~ '^[0-9a-f]{64}$'
      or coalesce(input.item ->> 'source_question_content_hash', '')
        !~ '^[0-9a-f]{64}$'
      or coalesce(input.item ->> 'choice_pool_content_hash', '')
        !~ '^[0-9a-f]{64}$'
      or input.item ->> 'review_level' is distinct from
        'source_or_user_authorized_webster_raw_preview_temporary_v1'
      or jsonb_typeof(input.item -> 'provenance') is distinct from 'object'
      or input.item #>> '{provenance,source_bundle_release_boundary}'
        is distinct from 'preview_temporary_only'
      or input.item -> 'required_gates' is distinct from jsonb_build_object(
        'bounded_single_answer_heuristic', true,
        'four_unique_choices', true,
        'no_synonym_gloss_or_word_family_conflict', true,
        'prompt_shape_valid', true,
        'same_part_of_speech_signature', true
      )
      or input.item #>> '{safety,target_environment}' is distinct from 'preview'
      or input.item #>> '{safety,target_project_ref}' is distinct from
        'wojxpruvbjzbhrpmsbuy'
      or input.item #> '{safety,source_shadow_only}' is distinct from
        'true'::jsonb
      or input.item #> '{safety,preview_apply_allowed}' is distinct from
        'true'::jsonb
      or input.item #> '{safety,canonical_approved}' is distinct from
        'false'::jsonb
      or input.item #> '{safety,release_allowed}' is distinct from
        'false'::jsonb
      or input.item #> '{safety,production_apply_allowed}' is distinct from
        'false'::jsonb
  ) then
    raise exception 'invalid_simseok_combined_question_items'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(package -> 'items') as input(item)
    where jsonb_array_length(input.item -> 'target_pos_signature') < 1
      or jsonb_array_length(input.item -> 'choice_headwords') <> 4
      or jsonb_array_length(input.item -> 'choice_source_entry_ids') <> 4
      or jsonb_array_length(input.item -> 'source_entry_ids') < 1
      or jsonb_array_length(input.item -> 'source_entry_ids') <>
        jsonb_array_length(input.item -> 'source_occurrence_hashes')
      or exists (
        select 1
        from jsonb_array_elements_text(input.item -> 'target_pos_signature')
          as signature(value)
        where btrim(signature.value) = ''
      )
      or (
        select count(*) <> count(distinct lower(btrim(choice.value)))
        from jsonb_array_elements_text(input.item -> 'choice_headwords')
          as choice(value)
      )
      or (
        select count(*) <> count(distinct choice.value)
        from jsonb_array_elements_text(input.item -> 'choice_source_entry_ids')
          as choice(value)
      )
      or (
        select count(*) <> count(distinct source.value)
        from jsonb_array_elements_text(input.item -> 'source_entry_ids')
          as source(value)
      )
      or exists (
        select 1
        from jsonb_array_elements_text(input.item -> 'choice_source_entry_ids')
          as choice(value)
        where choice.value !~ '^entry-[0-9a-f]{24}$'
      )
      or exists (
        select 1
        from jsonb_array_elements_text(input.item -> 'source_entry_ids')
          as source(value)
        where source.value !~ '^entry-[0-9a-f]{24}$'
      )
      or exists (
        select 1
        from jsonb_array_elements_text(input.item -> 'source_occurrence_hashes')
          as occurrence(value)
        where occurrence.value !~ '^[0-9a-f]{64}$'
      )
      or input.item #>> array[
        'choice_headwords', input.item ->> 'correct_choice_index'
      ] is distinct from input.item ->> 'target_headword'
      or not (
        input.item -> 'source_entry_ids' @> jsonb_build_array(
          input.item #>> array[
            'choice_source_entry_ids', input.item ->> 'correct_choice_index'
          ]
        )
      )
      or (
        input.item ->> 'quiz_mode' = 'canonical_definition_to_headword'
        and position('_____' in input.item ->> 'prompt_en') <> 0
      )
      or (
        input.item ->> 'quiz_mode' = 'canonical_example_to_headword'
        and (
          char_length(input.item ->> 'prompt_en')
          - char_length(replace(input.item ->> 'prompt_en', '_____', ''))
        ) / 5 <> 1
      )
  ) then
    raise exception 'invalid_simseok_combined_question_item_shape'
      using errcode = '22023';
  end if;

  if (
    select count(*) <> expected_item_count
      or count(distinct input.item ->> 'question_item_id') <>
        expected_item_count
      or count(distinct jsonb_build_array(
        input.item ->> 'quiz_mode', input.item ->> 'question_item_id'
      )) <> expected_item_count
      or sum(jsonb_array_length(input.item -> 'source_entry_ids')) <>
        expected_expanded_count
      or count(*) filter (
        where input.item ->> 'quiz_mode' =
          'canonical_definition_to_headword'
      ) <> expected_definition_count
      or count(*) filter (
        where input.item ->> 'quiz_mode' =
          'canonical_example_to_headword'
      ) <> expected_example_count
    from jsonb_array_elements(package -> 'items') as input(item)
  ) then
    raise exception 'simseok_combined_question_item_count_mismatch'
      using errcode = '22023';
  end if;

  select encode(
    extensions.digest(
      convert_to(
        string_agg(
          (input.item ->> 'question_item_id') || '|' ||
            lower(input.item ->> 'content_hash'),
          E'\n' order by input.item ->> 'quiz_mode',
            input.item ->> 'question_item_id'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into calculated_item_binding_sha256
  from jsonb_array_elements(package -> 'items') as input(item);
  if calculated_item_binding_sha256 is distinct from
      expected_item_binding_sha256 then
    raise exception 'simseok_combined_question_item_binding_mismatch'
      using errcode = '22023';
  end if;

  select count(distinct source.value)
  into calculated_source_entry_count
  from jsonb_array_elements(package -> 'items') as input(item)
  cross join lateral jsonb_array_elements_text(input.item -> 'source_entry_ids')
    as source(value);
  if calculated_source_entry_count is distinct from expected_source_entry_count
  then
    raise exception 'simseok_combined_question_source_count_mismatch'
      using errcode = '22023';
  end if;

  select release.*
  into exam_release
  from word_index.app_exam_use_release as release
  join public.vocab_datasets as dataset
    on dataset.id = release.dataset_id
   and dataset.dataset_key = release.dataset_key
  where release.dataset_key = expected_dataset_key
    and release.status = 'active'
    and release.target_environment = 'preview'
    and release.exam_use_import_allowed
    and not release.common_dictionary_release_allowed
    and lower(release.package_version) = expected_exam_package_version
  for share of release;
  if not found then
    raise exception 'active_simseok_preview_exam_release_not_found'
      using errcode = 'P0002';
  end if;
  dataset_id_value := exam_release.dataset_id;

  -- source_occurrence_hashes bind to the exact package entry content hash,
  -- not merely to a matching display headword.
  if exists (
    select 1
    from jsonb_array_elements(package -> 'items') as input(item)
    cross join lateral jsonb_array_elements_text(
      input.item -> 'source_entry_ids'
    ) with ordinality as source(source_entry_id, position)
    join lateral jsonb_array_elements_text(
      input.item -> 'source_occurrence_hashes'
    ) with ordinality as source_hash(value, position)
      on source_hash.position = source.position
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = exam_release.release_id
     and occurrence.source_entry_id = source.source_entry_id
     and lower(occurrence.package_entry_content_hash) = lower(source_hash.value)
     and lower(btrim(occurrence.display_headword)) =
       lower(btrim(input.item ->> 'target_headword'))
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    where occurrence.source_entry_id is null
  ) then
    raise exception 'simseok_combined_question_occurrence_binding_mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(package -> 'items') as input(item)
    cross join lateral jsonb_array_elements_text(
      input.item -> 'choice_source_entry_ids'
    ) with ordinality as choice_source(source_entry_id, position)
    join lateral jsonb_array_elements_text(
      input.item -> 'choice_headwords'
    ) with ordinality as choice_headword(value, position)
      on choice_headword.position = choice_source.position
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = exam_release.release_id
     and occurrence.source_entry_id = choice_source.source_entry_id
     and lower(btrim(occurrence.display_headword)) =
       lower(btrim(choice_headword.value))
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    where occurrence.source_entry_id is null
  ) then
    raise exception 'simseok_combined_question_choice_binding_mismatch'
      using errcode = '22023';
  end if;

  select release.*
  into existing_release
  from word_index.app_canonical_question_preview_release as release
  where release.release_key = dataset_id_value::text || ':' ||
    expected_package_file_sha256
  for update;
  if found then
    if existing_release.status in ('loading', 'active')
      and existing_release.release_profile = 'simseok_g10_scope_correction_v3'
      and existing_release.exam_use_release_id = exam_release.release_id
      and existing_release.package_content_hash = expected_package_content_hash
      and existing_release.manifest_content_hash =
        'adb5acfe4d1abb8d69be11c04ef56c820e50598bbed8ac8fe2ad02d6f2fc35af'
      and existing_release.item_binding_sha256 =
        expected_item_binding_sha256
      and existing_release.handoff_manifest_file_sha256 =
        '49c2ddc367cc04e2eb27b9ea7454a667f9ad75fe2e85ca7c2c4b9c8def7ea2c0'
      and existing_release.independent_review_ledger_sha256 =
        '84e027b5854b1239b55ec62a8ba6100cf4f83e53cde040aecafec0d3b29be6b1'
      and existing_release.generator_file_sha256 =
        'c6ed1ce86eab6aaf1186e721650832d9e6cd7440ca2c3f99568ef04aec9ced41'
      and existing_release.expected_item_count = expected_item_count
      and existing_release.expected_expanded_count = expected_expanded_count
      and existing_release.expected_source_entry_count =
        expected_source_entry_count
      and (
        select count(*)
        from word_index.app_canonical_question_preview_item as item
        where item.release_id = existing_release.release_id
      ) = expected_expanded_count
      and (
        select count(distinct item.question_item_id)
        from word_index.app_canonical_question_preview_item as item
        where item.release_id = existing_release.release_id
      ) = expected_item_count
    then
      return jsonb_build_object(
        'releaseId', existing_release.release_id,
        'datasetId', dataset_id_value,
        'datasetKey', expected_dataset_key,
        'status', existing_release.status,
        'itemCount', expected_item_count,
        'expandedCount', expected_expanded_count,
        'sourceEntryCount', expected_source_entry_count,
        'definitionCount', expected_definition_count,
        'exampleCount', expected_example_count,
        'idempotent', true
      );
    end if;
    raise exception 'simseok_combined_question_release_key_reused'
      using errcode = '23505';
  end if;

  insert into word_index.app_canonical_question_preview_release (
    release_key, dataset_id, exam_use_release_id, release_profile, contract,
    schema_version, policy_version, package_file_sha256,
    package_content_hash, manifest_content_hash, item_binding_sha256,
    handoff_manifest_file_sha256, independent_review_ledger_sha256,
    generator_file_sha256,
    definition_input_sha256, example_input_sha256, question_input_sha256,
    occurrence_input_sha256, target_environment, source_shadow_only,
    preview_apply_allowed, canonical_approved, release_allowed,
    production_apply_allowed, expected_item_count, expected_expanded_count,
    expected_source_entry_count, status
  ) values (
    dataset_id_value::text || ':' || expected_package_file_sha256,
    dataset_id_value, exam_release.release_id,
    'simseok_g10_scope_correction_v3',
    'simseok-combined-app-preview-question-package-v2',
    '2.0', 'simseok-sem2-combined-preview-v3-g1-lessons-1-2',
    expected_package_file_sha256, expected_package_content_hash,
    'adb5acfe4d1abb8d69be11c04ef56c820e50598bbed8ac8fe2ad02d6f2fc35af',
    expected_item_binding_sha256,
    '49c2ddc367cc04e2eb27b9ea7454a667f9ad75fe2e85ca7c2c4b9c8def7ea2c0',
    '84e027b5854b1239b55ec62a8ba6100cf4f83e53cde040aecafec0d3b29be6b1',
    'c6ed1ce86eab6aaf1186e721650832d9e6cd7440ca2c3f99568ef04aec9ced41',
    expected_package_content_hash, expected_package_content_hash,
    expected_item_binding_sha256,
    '4ffc2e1bc3c1fd62747b2564dd948a8520b8693bb7ce965e891b790b7652c977',
    'preview', true, true, false, false, false,
    expected_item_count, expected_expanded_count,
    expected_source_entry_count, 'loading'
  ) returning release_id into created_release_id;

  with parsed as materialized (
    select input.item,
      input.item ->> 'question_item_id' as question_item_id,
      input.item ->> 'target_headword' as target_headword,
      input.item ->> 'target_part_of_speech' as target_part_of_speech,
      input.item ->> 'quiz_mode' as quiz_mode,
      (input.item ->> 'correct_choice_index')::smallint as correct_choice_index
    from jsonb_array_elements(package -> 'items') as input(item)
  ),
  active_occurrence as materialized (
    select occurrence.*
    from word_index.app_exam_use_occurrence as occurrence
    where occurrence.release_id = exam_release.release_id
      and occurrence.include_in_exam
      and occurrence.exam_use_status = 'reviewed_for_preview'
  ),
  expanded as (
    select parsed.*, source.source_entry_id,
      lower(source_hash.value) as source_occurrence_content_hash,
      target_occurrence.source_row, target_occurrence.vocab_entry_id,
      target_occurrence.unit_id
    from parsed
    cross join lateral jsonb_array_elements_text(
      parsed.item -> 'source_entry_ids'
    ) with ordinality as source(source_entry_id, position)
    join lateral jsonb_array_elements_text(
      parsed.item -> 'source_occurrence_hashes'
    ) with ordinality as source_hash(value, position)
      on source_hash.position = source.position
    join active_occurrence as target_occurrence
      on target_occurrence.source_entry_id = source.source_entry_id
     and lower(target_occurrence.package_entry_content_hash) =
       lower(source_hash.value)
  ),
  bound as (
    select expanded.*, choice_map.choice_headwords,
      choice_map.choice_source_entry_ids,
      choice_map.choice_vocab_entry_ids
    from expanded
    cross join lateral (
      select
        array_agg(choice_headword.value order by choice_headword.position)::text[]
          as choice_headwords,
        array_agg(choice_source.source_entry_id order by choice_source.position)::text[]
          as choice_source_entry_ids,
        array_agg(
          case
            when choice_source.position - 1 = expanded.correct_choice_index
              then expanded.vocab_entry_id
            else choice_occurrence.vocab_entry_id
          end
          order by choice_source.position
        )::bigint[] as choice_vocab_entry_ids
      from jsonb_array_elements_text(expanded.item -> 'choice_source_entry_ids')
        with ordinality as choice_source(source_entry_id, position)
      join jsonb_array_elements_text(expanded.item -> 'choice_headwords')
        with ordinality as choice_headword(value, position)
        on choice_headword.position = choice_source.position
      join active_occurrence as choice_occurrence
        on choice_occurrence.source_entry_id = choice_source.source_entry_id
    ) as choice_map
  )
  insert into word_index.app_canonical_question_preview_item (
    release_id, dataset_id, exam_use_release_id, source_entry_id, source_row,
    vocab_entry_id, unit_id, question_item_id, question_item_sha256,
    target_definition_item_id, target_sense_family_id,
    target_family_revision_hash, target_headword, target_part_of_speech,
    target_pos_signature, quiz_mode, prompt_en, choice_headwords,
    choice_source_entry_ids, choice_vocab_entry_ids, correct_choice_index,
    source_occurrence_content_hash, source_definition_content_hash,
    source_example_content_hash, source_question_content_hash,
    choice_pool_content_hash, prompt_source_hash, review_input_sha256,
    review_audit_sha256, review_solver_sha256, required_gates, provenance
  )
  select
    created_release_id, dataset_id_value, exam_release.release_id,
    bound.source_entry_id, bound.source_row, bound.vocab_entry_id,
    bound.unit_id, bound.question_item_id,
    lower(bound.item ->> 'content_hash'),
    bound.item ->> 'target_definition_item_id',
    bound.item ->> 'target_sense_family_id',
    lower(bound.item ->> 'target_family_revision_hash'),
    bound.target_headword, bound.target_part_of_speech,
    array(
      select signature.value
      from jsonb_array_elements_text(bound.item -> 'target_pos_signature')
        with ordinality as signature(value, position)
      order by signature.position
    )::text[],
    bound.quiz_mode, bound.item ->> 'prompt_en', bound.choice_headwords,
    bound.choice_source_entry_ids, bound.choice_vocab_entry_ids,
    bound.correct_choice_index, bound.source_occurrence_content_hash,
    lower(bound.item ->> 'source_definition_content_hash'),
    lower(bound.item ->> 'source_example_content_hash'),
    lower(bound.item ->> 'source_question_content_hash'),
    lower(bound.item ->> 'choice_pool_content_hash'),
    lower(bound.item ->> 'prompt_source_hash'),
    -- Explicit compatibility mapping for the legacy non-null review columns.
    lower(bound.item ->> 'source_question_content_hash'),
    lower(bound.item ->> 'content_hash'),
    lower(bound.item ->> 'choice_pool_content_hash'),
    bound.item -> 'required_gates',
    bound.item -> 'provenance' || jsonb_build_object(
      'reviewLevel', bound.item ->> 'review_level',
      'targetPosSignature', bound.item -> 'target_pos_signature',
      'choiceSourceEntryIds', bound.item -> 'choice_source_entry_ids',
      'sourceOccurrenceContentHash', bound.source_occurrence_content_hash,
      'legacyReviewHashMapping', jsonb_build_object(
        'reviewInputSha256', 'source_question_content_hash',
        'reviewAuditSha256', 'content_hash',
        'reviewSolverSha256', 'choice_pool_content_hash'
      ),
      'sourceShadowOnly', true,
      'productionApplyAllowed', false
    )
  from bound;

  get diagnostics inserted_count = row_count;
  if inserted_count is distinct from expected_expanded_count then
    raise exception 'simseok_combined_question_expansion_mismatch'
      using errcode = '21000';
  end if;


  return jsonb_build_object(
    'releaseId', created_release_id,
    'datasetId', dataset_id_value,
    'datasetKey', expected_dataset_key,
    'status', 'loading',
    'itemCount', expected_item_count,
    'expandedCount', inserted_count,
    'sourceEntryCount', expected_source_entry_count,
    'definitionCount', expected_definition_count,
    'exampleCount', expected_example_count,
    'idempotent', false
  );
end;
$$;

create function private.inspect_simseok_g10_scope_correction_preview_v3()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_dataset_ids uuid[];
  reference_count integer;
  unaffected_count integer;
  old_active_count integer;
  old_retired_count integer;
  new_staged_count integer;
  new_active_count integer;
  state_value text;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_g10_scope_correction_preview_project_mismatch'
      using errcode = '42501';
  end if;

  select array_agg(dataset.id order by dataset.dataset_key)
  into old_dataset_ids
  from public.vocab_datasets as dataset
  where dataset.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]);
  if cardinality(old_dataset_ids) is distinct from 2 then
    raise exception 'simseok_g10_scope_correction_old_dataset_count_mismatch'
      using errcode = '21000';
  end if;

  select coalesce(sum(reference_rows), 0)::integer
  into reference_count
  from (
    select count(*)::integer as reference_rows
    from public.students
    where current_vocab_dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.assignments
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer
    from public.student_vocab_state as state
    join public.vocab_entries as entry on entry.id = state.vocab_entry_id
    where entry.dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.student_vocab_wrong_events
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.student_vocab_review_queue
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.student_vocab_review_assignment_drafts
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.assignment_review_targets
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.worksheet_request_items
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from public.student_learning_sources
    where vocab_dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer
    from private.current_wrong_review_assignment_requests
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer from private.vocab_assignment_series
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer
    from public.assignment_question_exam_use_snapshot
    where dataset_id = any(old_dataset_ids)
    union all
    select count(*)::integer
    from word_index.assignment_exam_use_release_snapshot
    where dataset_id = any(old_dataset_ids)
  ) as references_by_table;
  if reference_count is distinct from 0 then
    raise exception 'simseok_g10_scope_correction_old_dataset_references_exist:%',
      reference_count using errcode = '55000';
  end if;

  select count(*)::integer
  into unaffected_count
  from (
    values
      ('simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1',
       '27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb',
       320, 'f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74',
       358, 358, 188, 170),
      ('simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1',
       'd86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0',
       189, '5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af',
       206, 206, 108, 98),
      ('simseok-g11-sem2-mid-mock-v1',
       '120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c',
       278, 'd64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e',
       191, 192, 109, 82),
      ('simseok-g10-sem2-mid-adjective-500-v1',
       '95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e',
       500, '46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed',
       766, 766, 297, 469)
  ) as expected(dataset_key, exam_package_version, occurrence_count,
    question_package_file_sha256, item_count, expanded_count,
    definition_count, example_count)
  join public.vocab_datasets as dataset
    on dataset.dataset_key = expected.dataset_key
   and dataset.status = 'ready' and dataset.is_active
  join public.vocab_dataset_catalog as catalog
    on catalog.dataset_id = dataset.id and catalog.is_assignable
  join word_index.app_exam_use_release as exam_release
    on exam_release.dataset_id = dataset.id
   and exam_release.dataset_key = dataset.dataset_key
   and exam_release.status = 'active'
   and exam_release.package_version = expected.exam_package_version
   and exam_release.expected_occurrence_count = expected.occurrence_count
  join word_index.app_canonical_question_preview_release as question_release
    on question_release.dataset_id = dataset.id
    and question_release.exam_use_release_id = exam_release.release_id
   and question_release.status = 'active'
   and question_release.release_profile = 'simseok_sem2_combined_v2'
   and question_release.package_file_sha256 =
      expected.question_package_file_sha256
    and question_release.expected_item_count = expected.item_count
    and question_release.expected_expanded_count = expected.expanded_count
  where (select count(*) from word_index.app_exam_use_occurrence occurrence
         where occurrence.release_id = exam_release.release_id) =
        expected.occurrence_count
    and (select count(*) from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) = expected.expanded_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) = expected.item_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_definition_to_headword') =
        expected.definition_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_example_to_headword') =
        expected.example_count;
  if unaffected_count is distinct from 4 then
    raise exception 'simseok_g10_scope_correction_unaffected_release_mismatch'
      using errcode = '21000';
  end if;

  select count(*)::integer into old_active_count
  from (
    values
      ('simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
       'f7492c56b587917deb535a5da971bbdaa78f4c64f1cd26a0fea73af0c969eca9',
       169, '7e048e336d70dfa26282e7a6a5993326a519d04a78521475d3f26acabf557807',
       260, 260, 137, 123),
      ('simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1',
       'd5895f920dedf4327b4d615d88ccdb52fdf9a6ebcc7435f1eca7cfe6359cdcb3',
       128, 'd3a4a9cb1fa422fc9a32c397bb94a5894ccaa259e0afdc5394ecbc5599b92c13',
       214, 214, 103, 111)
  ) as expected(dataset_key, exam_package_version, occurrence_count,
    question_package_file_sha256, item_count, expanded_count,
    definition_count, example_count)
  join public.vocab_datasets dataset
    on dataset.dataset_key = expected.dataset_key
   and dataset.status = 'ready' and dataset.is_active
  join public.vocab_dataset_catalog catalog
    on catalog.dataset_id = dataset.id and catalog.is_assignable
  join word_index.app_exam_use_release exam_release
    on exam_release.dataset_id = dataset.id
   and exam_release.status = 'active'
   and exam_release.package_version = expected.exam_package_version
   and exam_release.expected_occurrence_count = expected.occurrence_count
  join word_index.app_canonical_question_preview_release question_release
    on question_release.dataset_id = dataset.id
   and question_release.exam_use_release_id = exam_release.release_id
    and question_release.status = 'active'
   and question_release.release_profile = 'simseok_sem2_combined_v2'
    and question_release.package_file_sha256 = expected.question_package_file_sha256
    and question_release.expected_item_count = expected.item_count
    and question_release.expected_expanded_count = expected.expanded_count
  where (select count(*) from word_index.app_exam_use_occurrence occurrence
         where occurrence.release_id = exam_release.release_id) =
        expected.occurrence_count
    and (select count(*) from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.expanded_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.item_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_definition_to_headword') =
        expected.definition_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_example_to_headword') =
        expected.example_count;

  select count(*)::integer into old_retired_count
  from (
    values
      ('simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
       'f7492c56b587917deb535a5da971bbdaa78f4c64f1cd26a0fea73af0c969eca9',
       169, '7e048e336d70dfa26282e7a6a5993326a519d04a78521475d3f26acabf557807',
       260, 260, 137, 123),
      ('simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1',
       'd5895f920dedf4327b4d615d88ccdb52fdf9a6ebcc7435f1eca7cfe6359cdcb3',
       128, 'd3a4a9cb1fa422fc9a32c397bb94a5894ccaa259e0afdc5394ecbc5599b92c13',
       214, 214, 103, 111)
  ) as expected(dataset_key, exam_package_version, occurrence_count,
    question_package_file_sha256, item_count, expanded_count,
    definition_count, example_count)
  join public.vocab_datasets dataset
    on dataset.dataset_key = expected.dataset_key
   and dataset.status = 'retired' and not dataset.is_active
  join public.vocab_dataset_catalog catalog
    on catalog.dataset_id = dataset.id and not catalog.is_assignable
  join word_index.app_exam_use_release exam_release
    on exam_release.dataset_id = dataset.id
   and exam_release.status = 'retired'
   and exam_release.package_version = expected.exam_package_version
  join word_index.app_canonical_question_preview_release question_release
    on question_release.dataset_id = dataset.id
   and question_release.exam_use_release_id = exam_release.release_id
    and question_release.status = 'retired'
   and question_release.release_profile = 'simseok_sem2_combined_v2'
    and question_release.package_file_sha256 = expected.question_package_file_sha256
    and question_release.expected_item_count = expected.item_count
    and question_release.expected_expanded_count = expected.expanded_count
  where (select count(*) from word_index.app_exam_use_occurrence occurrence
         where occurrence.release_id = exam_release.release_id) =
        expected.occurrence_count
    and (select count(*) from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.expanded_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.item_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_definition_to_headword') =
        expected.definition_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_example_to_headword') =
        expected.example_count;

  select count(*) filter (
      where dataset.status = 'pending_review' and not dataset.is_active
        and not catalog.is_assignable and exam_release.status = 'active'
        and question_release.status = 'loading'
    )::integer,
    count(*) filter (
      where dataset.status = 'ready' and dataset.is_active
        and catalog.is_assignable and exam_release.status = 'active'
        and question_release.status = 'active'
    )::integer
  into new_staged_count, new_active_count
  from (
    values
      ('simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
       '4e7289e2d750614b057c83e0fef7c503a56f6bf7b80b211ce47621f12906af38',
       111, '16d754616e2945c603eb0d4c87f68d51ab59b2838bc290363aa23dafc2d98aeb',
       117, 119, 68, 49),
      ('simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1',
       '5a3d3460bf435c8f6cb3a54934319ebbf89435b864ba9b7ec77b9ca0ce6e28cf',
       111, '536f2beedec9b4a428cd87a11c7c4df310e890905184499e2ce35ffe81088cc5',
       128, 130, 70, 58)
  ) as expected(dataset_key, exam_package_version, occurrence_count,
    question_package_file_sha256, item_count, expanded_count,
    definition_count, example_count)
  join public.vocab_datasets dataset
    on dataset.dataset_key = expected.dataset_key
  join public.vocab_dataset_catalog catalog on catalog.dataset_id = dataset.id
  join word_index.app_exam_use_release exam_release
    on exam_release.dataset_id = dataset.id
   and exam_release.package_version = expected.exam_package_version
   and exam_release.expected_occurrence_count = expected.occurrence_count
  join word_index.app_canonical_question_preview_release question_release
    on question_release.dataset_id = dataset.id
   and question_release.exam_use_release_id = exam_release.release_id
   and question_release.release_profile = 'simseok_g10_scope_correction_v3'
   and question_release.package_file_sha256 = expected.question_package_file_sha256
   and question_release.expected_item_count = expected.item_count
   and question_release.expected_expanded_count = expected.expanded_count
  where (select count(*) from public.vocab_entries entry
         where entry.dataset_id = dataset.id) = 111
    and (select count(*) from public.vocab_units unit
         where unit.dataset_id = dataset.id) = 6
    and (select count(*) from word_index.app_exam_use_occurrence occurrence
         where occurrence.release_id = exam_release.release_id) =
        expected.occurrence_count
    and (select count(*) from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.expanded_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id) =
        expected.item_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_definition_to_headword') =
        expected.definition_count
    and (select count(distinct item.question_item_id)
         from word_index.app_canonical_question_preview_item item
         where item.release_id = question_release.release_id
           and item.quiz_mode = 'canonical_example_to_headword') =
        expected.example_count;

  if old_active_count = 2 and new_staged_count = 2 then
    state_value := 'staged';
  elsif old_retired_count = 2 and new_active_count = 2 then
    state_value := 'active';
  else
    raise exception
      'simseok_g10_scope_correction_state_mismatch:old_active=% old_retired=% new_staged=% new_active=%',
      old_active_count, old_retired_count, new_staged_count, new_active_count
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', state_value, 'oldReferenceCount', reference_count,
    'unaffectedDatasetCount', unaffected_count, 'correctedDatasetCount', 2,
    'correctedOccurrenceCount', 222, 'correctedItemCount', 245,
    'correctedExpandedCount', 249, 'correctedDefinitionCount', 138,
    'correctedExampleCount', 107, 'activeDatasetCount', 6,
    'activeOccurrenceCount', 1509, 'activeItemCount', 1766,
    'activeExpandedCount', 1771, 'activeDefinitionCount', 840,
    'activeExampleCount', 926, 'targetEnvironment', 'preview'
  );
end;
$$;

create function public.stage_simseok_g10_scope_correction_preview_v3(
  p_exam_package_texts jsonb,
  p_question_package_texts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_text text;
  package_keys text[];
  result jsonb;
  exam_results jsonb := '[]'::jsonb;
  question_results jsonb := '[]'::jsonb;
  state_result jsonb;
  question_item_count integer := 0;
  question_expanded_count integer := 0;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_g10_scope_correction_preview_project_mismatch'
      using errcode = '42501';
  end if;
  if p_exam_package_texts is null
    or jsonb_typeof(p_exam_package_texts) is distinct from 'array'
    or jsonb_array_length(p_exam_package_texts) is distinct from 2
    or p_question_package_texts is null
    or jsonb_typeof(p_question_package_texts) is distinct from 'array'
    or jsonb_array_length(p_question_package_texts) is distinct from 2
    or exists (select 1 from jsonb_array_elements(p_exam_package_texts) input(value)
               where jsonb_typeof(input.value) is distinct from 'string')
    or exists (select 1 from jsonb_array_elements(p_question_package_texts) input(value)
               where jsonb_typeof(input.value) is distinct from 'string')
  then
    raise exception 'invalid_simseok_g10_scope_correction_bundle'
      using errcode = '22023';
  end if;

  select array_agg((value::jsonb) ->> 'dataset_key'
    order by (value::jsonb) ->> 'dataset_key')
  into package_keys
  from jsonb_array_elements_text(p_exam_package_texts) input(value);
  if package_keys is distinct from array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
  ]::text[] then
    raise exception 'simseok_g10_scope_correction_exam_bundle_mismatch'
      using errcode = '22023';
  end if;

  select array_agg((value::jsonb) ->> 'dataset_key'
    order by (value::jsonb) ->> 'dataset_key')
  into package_keys
  from jsonb_array_elements_text(p_question_package_texts) input(value);
  if package_keys is distinct from array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
  ]::text[] then
    raise exception 'simseok_g10_scope_correction_question_bundle_mismatch'
      using errcode = '22023';
  end if;

  for package_text in select value
    from jsonb_array_elements_text(p_exam_package_texts)
      with ordinality as input(value, position) order by position
  loop
    result := private.stage_simseok_g10_scope_correction_exam_package_v3(
      package_text
    );
    exam_results := exam_results || jsonb_build_array(result);
  end loop;

  for package_text in select value
    from jsonb_array_elements_text(p_question_package_texts)
      with ordinality as input(value, position) order by position
  loop
    result := private.stage_simseok_g10_scope_correction_question_release_v3(
      package_text
    );
    question_results := question_results || jsonb_build_array(result);
    question_item_count := question_item_count +
      (result ->> 'itemCount')::integer;
    question_expanded_count := question_expanded_count +
      (result ->> 'expandedCount')::integer;
  end loop;

  if jsonb_array_length(exam_results) is distinct from 2
    or jsonb_array_length(question_results) is distinct from 2
    or question_item_count is distinct from 245
    or question_expanded_count is distinct from 249
  then
    raise exception 'simseok_g10_scope_correction_stage_result_mismatch'
      using errcode = '21000';
  end if;

  state_result := private.inspect_simseok_g10_scope_correction_preview_v3();
  return state_result || jsonb_build_object(
    'idempotent',
      (state_result ->> 'status') = 'active'
      or (select bool_and((value ->> 'idempotent')::boolean)
          from jsonb_array_elements(exam_results || question_results)),
    'examDatasets', exam_results,
    'questionDatasets', question_results
  );
end;
$$;

create function public.preflight_simseok_g10_scope_correction_preview_v3()
returns jsonb
language sql
security definer
set search_path = ''
as $$
  select private.inspect_simseok_g10_scope_correction_preview_v3();
$$;

create function public.cutover_simseok_g10_scope_correction_preview_v3()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  before_state jsonb;
  after_state jsonb;
  changed_count integer;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_g10_scope_correction_preview_project_mismatch'
      using errcode = '42501';
  end if;

  perform 1 from public.vocab_datasets dataset
  where dataset.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]) order by dataset.dataset_key for update;
  perform 1 from word_index.app_exam_use_release release
  where release.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]) order by release.dataset_key for update;
  perform 1 from word_index.app_canonical_question_preview_release release
  join public.vocab_datasets dataset on dataset.id = release.dataset_id
  where dataset.dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]) order by dataset.dataset_key for update of release;

  before_state := private.inspect_simseok_g10_scope_correction_preview_v3();
  if before_state ->> 'status' = 'active' then
    return before_state || jsonb_build_object('idempotent', true);
  end if;

  update public.vocab_dataset_catalog catalog
  set is_assignable = false,
      metadata = catalog.metadata || jsonb_build_object(
        'scopeCorrectionRetired', true,
        'replacedBy', jsonb_build_array(
          'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
          'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'))
  from public.vocab_datasets dataset
  where dataset.id = catalog.dataset_id
    and dataset.dataset_key = any(array[
      'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
      'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
    ]::text[]);
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_old_catalog_update_mismatch'
    using errcode = '21000'; end if;

  update word_index.app_canonical_question_preview_release release
  set status = 'retired', retired_at_utc = clock_timestamp()
  from public.vocab_datasets dataset
  where dataset.id = release.dataset_id
    and dataset.dataset_key = any(array[
      'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
      'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
    ]::text[]) and release.status = 'active';
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_old_question_update_mismatch'
    using errcode = '21000'; end if;

  update word_index.app_exam_use_release
  set status = 'retired', retired_at_utc = clock_timestamp()
  where dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]) and status = 'active';
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_old_exam_update_mismatch'
    using errcode = '21000'; end if;

  update public.vocab_datasets set status = 'retired', is_active = false
  where dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1'
  ]::text[]);
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_old_dataset_update_mismatch'
    using errcode = '21000'; end if;

  update public.vocab_datasets set status = 'ready', is_active = true
  where dataset_key = any(array[
    'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
    'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
  ]::text[]) and status = 'pending_review' and not is_active;
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_new_dataset_update_mismatch'
    using errcode = '21000'; end if;

  update public.vocab_dataset_catalog catalog
  set is_assignable = true,
      metadata = catalog.metadata || jsonb_build_object(
        'scopeCorrectionPendingCutover', false,
        'scopeCorrectionActivated', true)
  from public.vocab_datasets dataset
  where dataset.id = catalog.dataset_id
    and dataset.dataset_key = any(array[
      'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
      'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
    ]::text[]) and not catalog.is_assignable;
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_new_catalog_update_mismatch'
    using errcode = '21000'; end if;

  update word_index.app_canonical_question_preview_release release
  set status = 'active', activated_at_utc = clock_timestamp()
  from public.vocab_datasets dataset
  where dataset.id = release.dataset_id
    and dataset.dataset_key = any(array[
      'simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1',
      'simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1'
    ]::text[])
    and release.release_profile = 'simseok_g10_scope_correction_v3'
    and release.status = 'loading';
  get diagnostics changed_count = row_count;
  if changed_count is distinct from 2 then raise exception
    'simseok_g10_scope_correction_new_question_update_mismatch'
    using errcode = '21000'; end if;

  after_state := private.inspect_simseok_g10_scope_correction_preview_v3();
  if after_state ->> 'status' is distinct from 'active' then
    raise exception 'simseok_g10_scope_correction_cutover_verification_failed'
      using errcode = '21000';
  end if;
  return after_state || jsonb_build_object('idempotent', false);
end;
$$;

revoke all on function private.catalog_simseok_g10_scope_correction_dataset_v3(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function private.stage_simseok_g10_scope_correction_exam_package_v3(text) from public, anon, authenticated, service_role;
revoke all on function private.stage_simseok_g10_scope_correction_question_release_v3(text) from public, anon, authenticated, service_role;
revoke all on function private.inspect_simseok_g10_scope_correction_preview_v3() from public, anon, authenticated, service_role;
revoke all on function public.stage_simseok_g10_scope_correction_preview_v3(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.preflight_simseok_g10_scope_correction_preview_v3() from public, anon, authenticated, service_role;
revoke all on function public.cutover_simseok_g10_scope_correction_preview_v3() from public, anon, authenticated, service_role;
grant execute on function public.stage_simseok_g10_scope_correction_preview_v3(jsonb, jsonb) to service_role;
grant execute on function public.preflight_simseok_g10_scope_correction_preview_v3() to service_role;
grant execute on function public.cutover_simseok_g10_scope_correction_preview_v3() to service_role;
alter function public.stage_simseok_g10_scope_correction_preview_v3(jsonb, jsonb)
  set statement_timeout = '60s';

notify pgrst, 'reload schema';
commit;
