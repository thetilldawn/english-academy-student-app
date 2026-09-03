begin;

-- The canonical question tables predate the Simseok combined handoff. Keep
-- the original OEWN profile valid while making the second profile explicit;
-- never disguise v2 rows as the older reviewed package.
alter table word_index.app_canonical_question_preview_release
  add column release_profile text not null default 'oewn_app_preview_v1',
  add column item_binding_sha256 text,
  add column handoff_manifest_file_sha256 text,
  add column independent_review_ledger_sha256 text,
  add column generator_file_sha256 text;

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select constraint_row.conname
    from pg_catalog.pg_constraint as constraint_row
    where constraint_row.conrelid =
        'word_index.app_canonical_question_preview_release'::regclass
      and constraint_row.contype = 'c'
      and (
        position('contract' in pg_catalog.pg_get_constraintdef(
          constraint_row.oid
        )) > 0
        or position('schema_version' in pg_catalog.pg_get_constraintdef(
          constraint_row.oid
        )) > 0
        or position('policy_version' in pg_catalog.pg_get_constraintdef(
          constraint_row.oid
        )) > 0
        or position('expected_item_count' in pg_catalog.pg_get_constraintdef(
          constraint_row.oid
        )) > 0
        or position('expected_expanded_count' in pg_catalog.pg_get_constraintdef(
          constraint_row.oid
        )) > 0
        or position('expected_source_entry_count' in
          pg_catalog.pg_get_constraintdef(constraint_row.oid)) > 0
      )
  loop
    execute format(
      'alter table word_index.app_canonical_question_preview_release drop constraint %I',
      constraint_name
    );
  end loop;
end;
$$;

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
      and item_binding_sha256 ~ '^[0-9a-f]{64}$'
      and handoff_manifest_file_sha256 ~ '^[0-9a-f]{64}$'
      and independent_review_ledger_sha256 ~ '^[0-9a-f]{64}$'
      and generator_file_sha256 ~ '^[0-9a-f]{64}$'
    )
  );

-- These nullable snapshots retain exact v2 source bindings. Legacy v1 rows
-- remain valid with nulls and continue to use their original review fields.
alter table word_index.app_canonical_question_preview_item
  add column target_pos_signature text[],
  add column choice_source_entry_ids text[],
  add column source_occurrence_content_hash text,
  add constraint app_canonical_question_preview_item_v2_binding_check check (
    (
      target_pos_signature is null
      and choice_source_entry_ids is null
      and source_occurrence_content_hash is null
    )
    or
    (
      cardinality(target_pos_signature) > 0
      and array_position(target_pos_signature, null) is null
      and cardinality(choice_source_entry_ids) = 4
      and array_position(choice_source_entry_ids, null) is null
      and choice_source_entry_ids[1] <> choice_source_entry_ids[2]
      and choice_source_entry_ids[1] <> choice_source_entry_ids[3]
      and choice_source_entry_ids[1] <> choice_source_entry_ids[4]
      and choice_source_entry_ids[2] <> choice_source_entry_ids[3]
      and choice_source_entry_ids[2] <> choice_source_entry_ids[4]
      and choice_source_entry_ids[3] <> choice_source_entry_ids[4]
      and source_occurrence_content_hash ~ '^[0-9a-f]{64}$'
    )
  );

do $$
declare
  constraint_name text;
begin
  select constraint_row.conname
  into constraint_name
  from pg_catalog.pg_constraint as constraint_row
  where constraint_row.conrelid =
      'word_index.app_canonical_question_preview_item'::regclass
    and constraint_row.contype = 'c'
    and position('required_gates' in pg_catalog.pg_get_constraintdef(
      constraint_row.oid
    )) > 0;
  if constraint_name is null then
    raise exception 'canonical_question_required_gates_constraint_not_found'
      using errcode = '42704';
  end if;
  execute format(
    'alter table word_index.app_canonical_question_preview_item drop constraint %I',
    constraint_name
  );
end;
$$;

alter table word_index.app_canonical_question_preview_item
  add constraint app_canonical_question_preview_item_required_gates_check check (
    required_gates = jsonb_build_object(
      'all_choices_grammar_possible', true,
      'no_pos_only_elimination', true,
      'no_synonym_or_form', true,
      'single_blind_answer', true
    )
    or required_gates = jsonb_build_object(
      'bounded_single_answer_heuristic', true,
      'four_unique_choices', true,
      'no_synonym_gloss_or_word_family_conflict', true,
      'prompt_shape_valid', true,
      'same_part_of_speech_signature', true
    )
  );

create function private.import_simseok_combined_question_preview_release_v2(
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
    when 'simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1' then
      expected_set_key := 'g2_l1';
      expected_package_file_sha256 :=
        'f45a7ca5825a0b56b0fe52d9a08e2a2062a20bcf8f542f8c8bd46d14e0fa5a74';
      expected_package_content_hash :=
        'e1084903fe604e8768392e49bd681228818cec793a8607667c580cd49443c8e6';
      expected_item_binding_sha256 :=
        '7856e9ebc2d7e91b419b4fc330afe156a13661a3241c8f67f7fd2309f603c84b';
      expected_exam_package_file_sha256 :=
        'c50ab74358a9c17f85b45a9f998bb68bf879386f6121817624dc9d3e5dfec5c5';
      expected_exam_package_version :=
        '27c2f468eb54089bf21c15e927d200e856791afd42e8f3d8a95f12e69d32dfbb';
      expected_item_count := 358;
      expected_expanded_count := 358;
      expected_source_entry_count := 215;
      expected_definition_count := 188;
      expected_example_count := 170;
    when 'simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1' then
      expected_set_key := 'g2_l2';
      expected_package_file_sha256 :=
        '5d0d372258af7ece72a01d76f8b736c7ba18fad6b4bd9c1f6e586902888871af';
      expected_package_content_hash :=
        'e127f5ac601944b486c26676000d7cc5fe49a6526bbce16da049bfeabfa4f90d';
      expected_item_binding_sha256 :=
        '0dfdba61a8f61c155986421f57435ee000f366e1a51b3763bdf3559155805d73';
      expected_exam_package_file_sha256 :=
        '4a0970994423cd9d412c26824a90c1b13fb16a25422d16ca3ee8de843910eba8';
      expected_exam_package_version :=
        'd86fab7e25387740cb0ab37269301c6fdb3894103d17572da8aebdafd5853bd0';
      expected_item_count := 206;
      expected_expanded_count := 206;
      expected_source_entry_count := 129;
      expected_definition_count := 108;
      expected_example_count := 98;
    when 'simseok-g11-sem2-mid-mock-v1' then
      expected_set_key := 'g2_mock';
      expected_package_file_sha256 :=
        'd64564c96b01c49237cbc496a21d5246154d58e241af73e09be8285ac244cb7e';
      expected_package_content_hash :=
        '370ece43b11fc0da2647513e10968aa4930a2fdcadc86a26f94a43c8bce8021c';
      expected_item_binding_sha256 :=
        '26b194dfa3b2159ed412261604ca61ca300b2b1a2b9f902a44f3cdad7fb0930c';
      expected_exam_package_file_sha256 :=
        '42a35b8f02be69664d0c9f80d7783b80d0c76f62bce5ad965f94a9b12f355155';
      expected_exam_package_version :=
        '120b72270326702cbeff4294e097ee9ee45e7e678e564b18bb6db2ac52c0fa9c';
      expected_item_count := 191;
      expected_expanded_count := 192;
      expected_source_entry_count := 122;
      expected_definition_count := 109;
      expected_example_count := 82;
    when 'simseok-g10-common-english2-ohseonyeong-l3-2026-sem2-v1' then
      expected_set_key := 'g1_l3';
      expected_package_file_sha256 :=
        '7e048e336d70dfa26282e7a6a5993326a519d04a78521475d3f26acabf557807';
      expected_package_content_hash :=
        '95ed65a1fc8c71d89282cf15e6dc2d4d20067db3fe7cb199cfd7206db7ae297d';
      expected_item_binding_sha256 :=
        '57377db5dabe9687385349ead741a1072e4cb975ad7506333834587c4c755aa0';
      expected_exam_package_file_sha256 :=
        '9e83c757ea404e14978166458550e106fb648b1e1e9042b93b48bb2c30d9ec99';
      expected_exam_package_version :=
        'f7492c56b587917deb535a5da971bbdaa78f4c64f1cd26a0fea73af0c969eca9';
      expected_item_count := 260;
      expected_expanded_count := 260;
      expected_source_entry_count := 151;
      expected_definition_count := 137;
      expected_example_count := 123;
    when 'simseok-g10-common-english2-ohseonyeong-l4-2026-sem2-v1' then
      expected_set_key := 'g1_l4';
      expected_package_file_sha256 :=
        'd3a4a9cb1fa422fc9a32c397bb94a5894ccaa259e0afdc5394ecbc5599b92c13';
      expected_package_content_hash :=
        'afddb005bbaf9c1185239673523d50379498b8f6ef4750290f5a623ad5ae7638';
      expected_item_binding_sha256 :=
        '686a257a31f01c3e8dbfbc39052f5611917e873bc102e24e7a1b3d68b33b16e7';
      expected_exam_package_file_sha256 :=
        '2ea8d28fb84202964062aeafbf95cd6fecc67f3bc9c23d67c92c9dd3742fa512';
      expected_exam_package_version :=
        'd5895f920dedf4327b4d615d88ccdb52fdf9a6ebcc7435f1eca7cfe6359cdcb3';
      expected_item_count := 214;
      expected_expanded_count := 214;
      expected_source_entry_count := 118;
      expected_definition_count := 103;
      expected_example_count := 111;
    when 'simseok-g10-sem2-mid-adjective-500-v1' then
      expected_set_key := 'g1_adj500';
      expected_package_file_sha256 :=
        '46c5e9c4c808b0fc35795399fe9c390b0cf3dbe067a59e972418d96c4fea7bed';
      expected_package_content_hash :=
        '6ccb895b972897a72043393b3e1ef859d2eb03c8184d874bddd205596692dd57';
      expected_item_binding_sha256 :=
        'cc76f759312703c0f3ea5f9f71d835d3b3b5eb55d873a24621b5e11649df9301';
      expected_exam_package_file_sha256 :=
        '34f3d61874c971e23ddd971a1b7311c7f37d34e33e28555dec772da3bf811514';
      expected_exam_package_version :=
        '95e4e029e33e15930cbe84fe64be91d3d2b9ca8b64027373adfd26e6fe717a4e';
      expected_item_count := 766;
      expected_expanded_count := 766;
      expected_source_entry_count := 483;
      expected_definition_count := 297;
      expected_example_count := 469;
    else
      raise exception 'simseok_combined_question_dataset_not_allowlisted'
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
      'simseok-sem2-combined-preview-v2'
    or package ->> 'set_key' is distinct from expected_set_key
    or lower(package ->> 'content_hash') is distinct from
      expected_package_content_hash
    or lower(package ->> 'item_binding_sha256') is distinct from
      expected_item_binding_sha256
    or lower(package ->> 'exam_handoff_content_hash') is distinct from
      'de83b9b0a17de2f4d3869c9bddc231dcf77cea15c0839dedcf283a2e6f8d8951'
    or lower(package ->> 'exam_use_package_file_sha256') is distinct from
      expected_exam_package_file_sha256
    or lower(package ->> 'exam_use_package_version') is distinct from
      expected_exam_package_version
    or lower(package ->> 'source_bundle_manifest_sha256') is distinct from
      '1b197a1066283422f6c30b9a08d0c93cfc986bbf41258443b7a0569ea86f820d'
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
        'simseok-sem2-combined-preview-v2'
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
    if existing_release.status = 'active'
      and existing_release.release_profile = 'simseok_sem2_combined_v2'
      and existing_release.exam_use_release_id = exam_release.release_id
      and existing_release.package_content_hash = expected_package_content_hash
      and existing_release.manifest_content_hash =
        '4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff'
      and existing_release.item_binding_sha256 =
        expected_item_binding_sha256
      and existing_release.handoff_manifest_file_sha256 =
        '625c212c1f2a695bd0878bed9e5ea28bd50338b2692fe055e317a78df51a8ab3'
      and existing_release.independent_review_ledger_sha256 =
        'ccb1a8c22424c4b7f11b4eb243f2019200bda4709017b0e6f3b82fa45cbd2910'
      and existing_release.generator_file_sha256 =
        'a26d8d4e24455b9c41b033a0e84b604486dca1f586acad147bdd259dd5a2ff95'
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
        'status', 'active',
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
    'simseok_sem2_combined_v2',
    'simseok-combined-app-preview-question-package-v2',
    '2.0', 'simseok-sem2-combined-preview-v2',
    expected_package_file_sha256, expected_package_content_hash,
    '4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff',
    expected_item_binding_sha256,
    '625c212c1f2a695bd0878bed9e5ea28bd50338b2692fe055e317a78df51a8ab3',
    'ccb1a8c22424c4b7f11b4eb243f2019200bda4709017b0e6f3b82fa45cbd2910',
    'a26d8d4e24455b9c41b033a0e84b604486dca1f586acad147bdd259dd5a2ff95',
    expected_package_content_hash, expected_package_content_hash,
    expected_item_binding_sha256,
    'de83b9b0a17de2f4d3869c9bddc231dcf77cea15c0839dedcf283a2e6f8d8951',
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

  update word_index.app_canonical_question_preview_release
  set status = 'retired', retired_at_utc = clock_timestamp()
  where dataset_id = dataset_id_value
    and status = 'active';

  update word_index.app_canonical_question_preview_release
  set status = 'active', activated_at_utc = clock_timestamp()
  where release_id = created_release_id
    and status = 'loading';
  if not found then
    raise exception 'simseok_combined_question_activation_failed'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'releaseId', created_release_id,
    'datasetId', dataset_id_value,
    'datasetKey', expected_dataset_key,
    'status', 'active',
    'itemCount', expected_item_count,
    'expandedCount', inserted_count,
    'sourceEntryCount', expected_source_entry_count,
    'definitionCount', expected_definition_count,
    'exampleCount', expected_example_count,
    'idempotent', false
  );
end;
$$;

create function public.import_simseok_sem2_combined_question_preview_bundle_v2(
  p_package_texts jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  package_text text;
  imported jsonb;
  results jsonb := '[]'::jsonb;
  dataset_keys text[];
  imported_item_count integer := 0;
  imported_expanded_count integer := 0;
  imported_definition_count integer := 0;
  imported_example_count integer := 0;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'simseok_combined_question_preview_project_mismatch'
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
    raise exception 'invalid_simseok_combined_question_bundle'
      using errcode = '22023';
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
    raise exception 'simseok_combined_question_bundle_dataset_mismatch'
      using errcode = '22023';
  end if;

  for package_text in
    select value
    from jsonb_array_elements_text(p_package_texts)
      with ordinality as input(value, position)
    order by position
  loop
    imported :=
      private.import_simseok_combined_question_preview_release_v2(package_text);
    if imported is null
      or jsonb_typeof(imported) is distinct from 'object'
      or imported ->> 'status' is distinct from 'active'
      or imported -> 'idempotent' not in ('true'::jsonb, 'false'::jsonb)
      or coalesce(imported ->> 'itemCount', '') !~ '^[1-9][0-9]*$'
      or coalesce(imported ->> 'expandedCount', '') !~ '^[1-9][0-9]*$'
      or coalesce(imported ->> 'definitionCount', '') !~ '^[1-9][0-9]*$'
      or coalesce(imported ->> 'exampleCount', '') !~ '^[1-9][0-9]*$'
    then
      raise exception 'invalid_simseok_combined_question_import_result'
        using errcode = '21000';
    end if;
    results := results || jsonb_build_array(imported);
    imported_item_count := imported_item_count
      + (imported ->> 'itemCount')::integer;
    imported_expanded_count := imported_expanded_count
      + (imported ->> 'expandedCount')::integer;
    imported_definition_count := imported_definition_count
      + (imported ->> 'definitionCount')::integer;
    imported_example_count := imported_example_count
      + (imported ->> 'exampleCount')::integer;
  end loop;

  if jsonb_array_length(results) is distinct from 6
    or imported_item_count is distinct from 1995
    or imported_expanded_count is distinct from 1996
    or imported_definition_count is distinct from 942
    or imported_example_count is distinct from 1053
  then
    raise exception 'simseok_combined_question_bundle_result_mismatch'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'status', 'active',
    'datasetCount', 6,
    'itemCount', imported_item_count,
    'expandedCount', imported_expanded_count,
    'definitionCount', imported_definition_count,
    'exampleCount', imported_example_count,
    'targetEnvironment', 'preview',
    'manifestContentHash',
      '4482b3379b9f4641d18136ccfab25fa6db206763824813a61aebf68621a8e6ff',
    'datasets', results
  );
end;
$$;

revoke all on function
  private.import_simseok_combined_question_preview_release_v2(text)
  from public, anon, authenticated, service_role;
revoke all on function
  public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)
  from public, anon, authenticated, service_role;
grant execute on function
  public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)
  to service_role;

notify pgrst, 'reload schema';

commit;
