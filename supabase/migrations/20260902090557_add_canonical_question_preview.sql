begin;

-- Preview-only, shadow-derived question releases. These tables are never
-- readable from the browser; public RPCs expose identifiers only.
create table word_index.app_canonical_question_preview_release (
  release_id uuid primary key default extensions.gen_random_uuid(),
  release_key text not null unique,
  dataset_id uuid not null references public.vocab_datasets(id) on delete restrict,
  exam_use_release_id uuid not null,
  contract text not null check (
    contract = 'oewn-app-preview-question-manifest-v1'
  ),
  schema_version text not null check (schema_version = '1.0'),
  policy_version text not null check (
    policy_version = 'g12-2025-oewn-app-preview-question-v1'
  ),
  package_file_sha256 text not null check (
    package_file_sha256 ~ '^[0-9a-f]{64}$'
  ),
  package_content_hash text not null check (
    package_content_hash ~ '^[0-9a-f]{64}$'
  ),
  manifest_content_hash text not null check (
    manifest_content_hash ~ '^[0-9a-f]{64}$'
  ),
  definition_input_sha256 text not null check (
    definition_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  example_input_sha256 text not null check (
    example_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  question_input_sha256 text not null check (
    question_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  occurrence_input_sha256 text not null check (
    occurrence_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  target_environment text not null check (target_environment = 'preview'),
  source_shadow_only boolean not null check (source_shadow_only),
  preview_apply_allowed boolean not null check (preview_apply_allowed),
  canonical_approved boolean not null check (not canonical_approved),
  release_allowed boolean not null check (not release_allowed),
  production_apply_allowed boolean not null check (not production_apply_allowed),
  expected_item_count integer not null check (expected_item_count = 512),
  expected_expanded_count integer not null check (expected_expanded_count = 540),
  expected_source_entry_count integer not null check (
    expected_source_entry_count = 270
  ),
  status text not null check (status in ('loading', 'active', 'retired', 'failed')),
  created_at_utc timestamptz not null default clock_timestamp(),
  activated_at_utc timestamptz,
  retired_at_utc timestamptz,
  failure_detail text,
  unique (release_id, dataset_id),
  unique (release_id, dataset_id, exam_use_release_id),
  foreign key (exam_use_release_id, dataset_id)
    references word_index.app_exam_use_release(release_id, dataset_id)
    on delete restrict
);

create unique index app_canonical_question_preview_release_active_idx
  on word_index.app_canonical_question_preview_release(dataset_id)
  where status = 'active';

create table word_index.app_canonical_question_preview_item (
  release_id uuid not null,
  dataset_id uuid not null,
  exam_use_release_id uuid not null,
  source_entry_id text not null check (source_entry_id ~ '^entry-[0-9a-f]{24}$'),
  source_row integer not null check (source_row > 0),
  vocab_entry_id bigint not null,
  unit_id uuid not null,
  question_item_id text not null check (char_length(trim(question_item_id)) > 0),
  question_item_sha256 text not null check (
    question_item_sha256 ~ '^[0-9a-f]{64}$'
  ),
  target_definition_item_id text not null,
  target_sense_family_id text not null,
  target_family_revision_hash text not null check (
    target_family_revision_hash ~ '^[0-9a-f]{64}$'
  ),
  target_headword text not null check (char_length(trim(target_headword)) > 0),
  target_part_of_speech text not null check (
    target_part_of_speech in ('noun', 'verb', 'adjective', 'adverb', 'preposition', 'conjunction', 'interjection', 'determiner', 'pronoun', 'other')
  ),
  quiz_mode text not null check (
    quiz_mode in (
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
  ),
  prompt_en text not null check (char_length(trim(prompt_en)) > 0),
  choice_headwords text[] not null check (
    cardinality(choice_headwords) = 4
    and array_position(choice_headwords, null) is null
    and char_length(trim(choice_headwords[1])) > 0
    and char_length(trim(choice_headwords[2])) > 0
    and char_length(trim(choice_headwords[3])) > 0
    and char_length(trim(choice_headwords[4])) > 0
    and lower(trim(choice_headwords[1])) <> lower(trim(choice_headwords[2]))
    and lower(trim(choice_headwords[1])) <> lower(trim(choice_headwords[3]))
    and lower(trim(choice_headwords[1])) <> lower(trim(choice_headwords[4]))
    and lower(trim(choice_headwords[2])) <> lower(trim(choice_headwords[3]))
    and lower(trim(choice_headwords[2])) <> lower(trim(choice_headwords[4]))
    and lower(trim(choice_headwords[3])) <> lower(trim(choice_headwords[4]))
  ),
  choice_vocab_entry_ids bigint[] not null check (
    cardinality(choice_vocab_entry_ids) = 4
    and array_position(choice_vocab_entry_ids, null) is null
    and choice_vocab_entry_ids[1] <> choice_vocab_entry_ids[2]
    and choice_vocab_entry_ids[1] <> choice_vocab_entry_ids[3]
    and choice_vocab_entry_ids[1] <> choice_vocab_entry_ids[4]
    and choice_vocab_entry_ids[2] <> choice_vocab_entry_ids[3]
    and choice_vocab_entry_ids[2] <> choice_vocab_entry_ids[4]
    and choice_vocab_entry_ids[3] <> choice_vocab_entry_ids[4]
  ),
  correct_choice_index smallint not null check (correct_choice_index between 0 and 3),
  source_definition_content_hash text not null check (
    source_definition_content_hash ~ '^[0-9a-f]{64}$'
  ),
  source_example_content_hash text not null check (
    source_example_content_hash ~ '^[0-9a-f]{64}$'
  ),
  source_question_content_hash text not null check (
    source_question_content_hash ~ '^[0-9a-f]{64}$'
  ),
  choice_pool_content_hash text not null check (
    choice_pool_content_hash ~ '^[0-9a-f]{64}$'
  ),
  prompt_source_hash text not null check (
    prompt_source_hash ~ '^[0-9a-f]{64}$'
  ),
  review_input_sha256 text not null check (
    review_input_sha256 ~ '^[0-9a-f]{64}$'
  ),
  review_audit_sha256 text not null check (
    review_audit_sha256 ~ '^[0-9a-f]{64}$'
  ),
  review_solver_sha256 text not null check (
    review_solver_sha256 ~ '^[0-9a-f]{64}$'
  ),
  required_gates jsonb not null check (
    required_gates = jsonb_build_object(
      'all_choices_grammar_possible', true,
      'no_pos_only_elimination', true,
      'no_synonym_or_form', true,
      'single_blind_answer', true
    )
  ),
  provenance jsonb not null check (jsonb_typeof(provenance) = 'object'),
  created_at_utc timestamptz not null default clock_timestamp(),
  primary key (release_id, vocab_entry_id, quiz_mode),
  unique (release_id, question_item_id, source_entry_id),
  unique (
    release_id,
    dataset_id,
    vocab_entry_id,
    quiz_mode,
    question_item_id,
    question_item_sha256
  ),
  foreign key (release_id, dataset_id)
    references word_index.app_canonical_question_preview_release(
      release_id, dataset_id
    ) on delete restrict,
  foreign key (release_id, dataset_id, exam_use_release_id)
    references word_index.app_canonical_question_preview_release(
      release_id, dataset_id, exam_use_release_id
    ) on delete restrict,
  foreign key (exam_use_release_id, vocab_entry_id)
    references word_index.app_exam_use_occurrence(release_id, vocab_entry_id)
    on delete restrict,
  foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id) on delete restrict,
  foreign key (unit_id, dataset_id)
    references public.vocab_units(id, dataset_id) on delete restrict,
  check (choice_vocab_entry_ids[correct_choice_index + 1] = vocab_entry_id),
  check (choice_headwords[correct_choice_index + 1] = target_headword),
  check (
    (
      quiz_mode = 'canonical_definition_to_headword'
      and position('_____' in prompt_en) = 0
    )
    or
    (
      quiz_mode = 'canonical_example_to_headword'
      and (char_length(prompt_en) - char_length(replace(prompt_en, '_____', ''))) / 5 = 1
    )
  )
);

create index app_canonical_question_preview_item_lookup_idx
  on word_index.app_canonical_question_preview_item(
    dataset_id, quiz_mode, unit_id, source_row
  );

alter table word_index.app_canonical_question_preview_release enable row level security;
alter table word_index.app_canonical_question_preview_item enable row level security;
revoke all on table word_index.app_canonical_question_preview_release
  from public, anon, authenticated, service_role;
revoke all on table word_index.app_canonical_question_preview_item
  from public, anon, authenticated, service_role;

create table private.bulk_canonical_question_preview_requests (
  idempotency_key uuid primary key,
  request_sha256 text not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  payload_sha256 text not null check (payload_sha256 ~ '^[0-9a-f]{64}$'),
  actor_admin_id uuid not null references auth.users(id) on delete restrict,
  result jsonb,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  check (
    (result is null and completed_at is null)
    or (
      result is not null
      and jsonb_typeof(result) = 'array'
      and completed_at is not null
    )
  )
);
revoke all on table private.bulk_canonical_question_preview_requests
  from public, anon, authenticated, service_role;

alter table public.assignments
  add column canonical_question_release_id_snapshot uuid,
  add column canonical_question_package_sha256_snapshot text;

alter table public.assignments
  add constraint assignments_canonical_question_package_sha_check check (
    canonical_question_package_sha256_snapshot is null
    or canonical_question_package_sha256_snapshot ~ '^[0-9a-f]{64}$'
  ),
  add constraint assignments_canonical_question_release_fkey foreign key (
    canonical_question_release_id_snapshot, dataset_id
  ) references word_index.app_canonical_question_preview_release(
    release_id, dataset_id
  ) on delete restrict;

alter table public.assignments
  drop constraint assignments_quiz_content_mode_check,
  drop constraint assignments_provenance_status_check;

alter table public.assignments
  add constraint assignments_quiz_content_mode_check check (
    quiz_content_mode in (
      'legacy_book_meaning_choice',
      'book_meaning_choice',
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
  ),
  add constraint assignments_provenance_status_check check (
    provenance_status in (
      'legacy_backfill',
      'verified_v2',
      'preview_verified_v1'
    )
  ),
  add constraint assignments_canonical_preview_v1_check check (
    (
      quiz_content_mode in (
        'canonical_definition_to_headword',
        'canonical_example_to_headword'
      )
      and english_to_korean_ratio = 0
      and question_bank_version = 3
      and provenance_status = 'preview_verified_v1'
      and canonical_question_release_id_snapshot is not null
      and canonical_question_package_sha256_snapshot is not null
      and generator_version = 'canonical-question-preview-v1'
    )
    or
    (
      quiz_content_mode not in (
        'canonical_definition_to_headword',
        'canonical_example_to_headword'
      )
      and provenance_status <> 'preview_verified_v1'
      and canonical_question_release_id_snapshot is null
      and canonical_question_package_sha256_snapshot is null
    )
  );

alter table public.assignment_questions
  add column canonical_question_release_id_snapshot uuid,
  add column canonical_question_item_id_snapshot text,
  add column canonical_question_item_sha256_snapshot text,
  add column canonical_question_review_input_sha256_snapshot text,
  add column canonical_question_review_policy_version_snapshot text;

alter table public.assignment_questions
  drop constraint assignment_questions_eligibility_mode_check,
  drop constraint assignment_questions_provenance_status_check;

alter table public.assignment_questions
  add constraint assignment_questions_eligibility_mode_check check (
    eligibility_quiz_mode is null
    or eligibility_quiz_mode in (
      'book_meaning_en_to_ko',
      'book_meaning_ko_to_en',
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
  ),
  add constraint assignment_questions_provenance_status_check check (
    provenance_status in (
      'legacy_backfill',
      'verified_v2',
      'preview_verified_v1'
    )
  ),
  add constraint assignment_questions_canonical_item_sha_check check (
    canonical_question_item_sha256_snapshot is null
    or canonical_question_item_sha256_snapshot ~ '^[0-9a-f]{64}$'
  ),
  add constraint assignment_questions_canonical_review_sha_check check (
    canonical_question_review_input_sha256_snapshot is null
    or canonical_question_review_input_sha256_snapshot ~ '^[0-9a-f]{64}$'
  ),
  add constraint assignment_questions_canonical_preview_v1_check check (
    (
      provenance_status = 'preview_verified_v1'
      and direction = 'korean_to_english'
      and eligibility_quiz_mode in (
        'canonical_definition_to_headword',
        'canonical_example_to_headword'
      )
      and content_origin = 'canonical'
      and cardinality(choice_vocab_entry_ids) = 4
      and array_position(choice_vocab_entry_ids, null) is null
      and cardinality(array_positions(choice_vocab_entry_ids, vocab_entry_id)) = 1
      and choice_vocab_entry_ids[correct_choice_index + 1] = vocab_entry_id
      and correct_answer_snapshot = choices ->> correct_choice_index
      and canonical_question_release_id_snapshot is not null
      and canonical_question_item_id_snapshot is not null
      and canonical_question_item_sha256_snapshot is not null
      and canonical_question_review_input_sha256_snapshot is not null
      and canonical_question_review_policy_version_snapshot is not null
      and generator_version_snapshot = 'canonical-question-preview-v1'
    )
    or
    (
      provenance_status <> 'preview_verified_v1'
      and canonical_question_release_id_snapshot is null
      and canonical_question_item_id_snapshot is null
      and canonical_question_item_sha256_snapshot is null
      and canonical_question_review_input_sha256_snapshot is null
      and canonical_question_review_policy_version_snapshot is null
    )
  ),
  add constraint assignment_questions_canonical_item_fkey foreign key (
    canonical_question_release_id_snapshot,
    dataset_id,
    vocab_entry_id,
    eligibility_quiz_mode,
    canonical_question_item_id_snapshot,
    canonical_question_item_sha256_snapshot
  ) references word_index.app_canonical_question_preview_item(
    release_id,
    dataset_id,
    vocab_entry_id,
    quiz_mode,
    question_item_id,
    question_item_sha256
  ) on delete restrict;

create function private.import_canonical_question_preview_release_v1(
  p_dataset_id uuid,
  p_manifest jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  exam_release word_index.app_exam_use_release%rowtype;
  existing_release word_index.app_canonical_question_preview_release%rowtype;
  created_release_id uuid;
  inserted_count integer;
  source_count integer;
  input_hashes text[];
  item_binding_sha256 text;
begin
  if p_dataset_id is null
    or p_manifest is null
    or jsonb_typeof(p_manifest) <> 'object'
    or p_items is null
    or jsonb_typeof(p_items) <> 'array'
  then
    raise exception 'invalid_canonical_question_preview_package'
      using errcode = '22023';
  end if;

  if p_manifest ->> 'contract' <> 'oewn-app-preview-question-manifest-v1'
    or p_manifest ->> 'schema_version' <> '1.0'
    or p_manifest ->> 'policy_version' <>
      'g12-2025-oewn-app-preview-question-v1'
    or lower(p_manifest ->> 'package_file_sha256') <>
      'e3a170879e18b233fcd6cd5e740bc0c09fd4a42cbf5d694a226d71159602e28a'
    or lower(p_manifest ->> 'package_content_hash') <>
      '45156c1a74b6ffb32694520899b3a9e4ae22840d61e49b049a1650b337b9e1a0'
    or lower(p_manifest ->> 'content_hash') <>
      'b3427ba68fb16f03313ebb5c76a6fe39d2150ac205ab6c917770735124013973'
    or p_manifest #>> '{safety,target_environment}' <> 'preview'
    or p_manifest #>> '{safety,target_project_ref}' <> 'wojxpruvbjzbhrpmsbuy'
    or (p_manifest #>> '{safety,source_shadow_only}')::boolean is distinct from true
    or (p_manifest #>> '{safety,preview_apply_allowed}')::boolean is distinct from true
    or (p_manifest #>> '{safety,canonical_approved}')::boolean is distinct from false
    or (p_manifest #>> '{safety,release_allowed}')::boolean is distinct from false
    or (p_manifest #>> '{safety,production_apply_allowed}')::boolean is distinct from false
    or (p_manifest #>> '{validation,items}')::integer <> 512
    or (p_manifest #>> '{validation,unique_question_items}')::integer <> 512
    or (p_manifest #>> '{validation,unique_target_modes}')::integer <> 512
    or (p_manifest #>> '{validation,unique_source_entries}')::integer <> 270
    or (p_manifest #>> '{validation,mode_counts,canonical_definition_to_headword}')::integer <> 256
    or (p_manifest #>> '{validation,mode_counts,canonical_example_to_headword}')::integer <> 256
  then
    raise exception 'canonical_question_preview_manifest_mismatch'
      using errcode = '22023';
  end if;

  select array_agg(lower(value ->> 'sha256') order by lower(value ->> 'sha256'))
  into input_hashes
  from jsonb_array_elements(p_manifest -> 'input_files') as input(value);
  if input_hashes is distinct from array[
    '034945fd7cb2f8a5aff82532ae66855da0606e7cc2e6bce2461d0d588d567244',
    '048609b211b955891a420a28405c0bf5bdbe6a77420726fb1ca2a32c9a9dc292',
    '2677ac127d53ded7172f70022ba500753ea81a1718bf1a654cfd77732847f0b4',
    '3e7102cdde5d677362014f9a46053d0ea2d2d8e6f08fc92cf9eb048ca85ea2c2'
  ]::text[] then
    raise exception 'canonical_question_preview_input_hash_mismatch'
      using errcode = '22023';
  end if;

  if jsonb_array_length(p_items) <> 512
    or exists (
      select 1
      from jsonb_array_elements(p_items) as input(item)
      where jsonb_typeof(input.item) <> 'object'
        or input.item ->> 'contract' <> 'oewn-app-preview-question-item-v1'
        or input.item ->> 'schema_version' <> '1.0'
        or input.item ->> 'policy_version' <>
          'g12-2025-oewn-app-preview-question-v1'
        or input.item ->> 'quiz_mode' not in (
          'canonical_definition_to_headword',
          'canonical_example_to_headword'
        )
        or jsonb_typeof(input.item -> 'choice_headwords') <> 'array'
        or jsonb_array_length(input.item -> 'choice_headwords') <> 4
        or (input.item ->> 'correct_choice_index')::integer not between 0 and 3
        or input.item #>> array[
          'choice_headwords', input.item ->> 'correct_choice_index'
        ] is distinct from input.item ->> 'target_headword'
        or input.item -> 'required_gates' <> jsonb_build_object(
          'all_choices_grammar_possible', true,
          'no_pos_only_elimination', true,
          'no_synonym_or_form', true,
          'single_blind_answer', true
        )
        or input.item #>> '{safety,target_environment}' <> 'preview'
        or input.item #>> '{safety,target_project_ref}' <> 'wojxpruvbjzbhrpmsbuy'
        or (input.item #>> '{safety,source_shadow_only}')::boolean is distinct from true
        or (input.item #>> '{safety,preview_apply_allowed}')::boolean is distinct from true
        or (input.item #>> '{safety,canonical_approved}')::boolean is distinct from false
        or (input.item #>> '{safety,release_allowed}')::boolean is distinct from false
        or (input.item #>> '{safety,production_apply_allowed}')::boolean is distinct from false
        or input.item ->> 'content_hash' !~ '^[0-9a-f]{64}$'
        or input.item ->> 'prompt_en' is null
        or (
          input.item ->> 'quiz_mode' = 'canonical_definition_to_headword'
          and position('_____' in input.item ->> 'prompt_en') > 0
        )
        or (
          input.item ->> 'quiz_mode' = 'canonical_example_to_headword'
          and (
            char_length(input.item ->> 'prompt_en')
            - char_length(replace(input.item ->> 'prompt_en', '_____', ''))
          ) / 5 <> 1
        )
    )
  then
    raise exception 'invalid_canonical_question_preview_items'
      using errcode = '22023';
  end if;

  if (
    select count(distinct item ->> 'question_item_id') <> 512
      or count(distinct jsonb_build_array(
        item ->> 'target_definition_item_id', item ->> 'quiz_mode'
      )) <> 512
      or count(*) filter (
        where item ->> 'quiz_mode' = 'canonical_definition_to_headword'
      ) <> 256
      or count(*) filter (
        where item ->> 'quiz_mode' = 'canonical_example_to_headword'
      ) <> 256
      or sum(jsonb_array_length(item -> 'source_entry_ids')) <> 540
    from jsonb_array_elements(p_items) as input(item)
  ) then
    raise exception 'canonical_question_preview_item_counts_mismatch'
      using errcode = '22023';
  end if;

  select encode(
    extensions.digest(
      convert_to(
        string_agg(
          (item ->> 'question_item_id') || ':' ||
            lower(item ->> 'content_hash'),
          E'\n' order by item ->> 'question_item_id'
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  )
  into item_binding_sha256
  from jsonb_array_elements(p_items) as input(item);
  if item_binding_sha256 is distinct from
    '3a5db0dc770f5d8143ed4a35f4d18280da91cdab369b3447b014097e8135da5b'
  then
    raise exception 'canonical_question_preview_item_binding_mismatch'
      using errcode = '22023';
  end if;

  select count(distinct source_entry_id)
  into source_count
  from jsonb_array_elements(p_items) as input(item)
  cross join lateral jsonb_array_elements_text(input.item -> 'source_entry_ids')
    as source(source_entry_id);
  if source_count <> 270 then
    raise exception 'canonical_question_preview_source_count_mismatch'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_items) as input(item)
    cross join lateral jsonb_array_elements_text(input.item -> 'choice_headwords')
      as choice(headword)
    where not exists (
      select 1
      from jsonb_array_elements(p_items) as candidate(value)
      where lower(candidate.value ->> 'target_headword') = lower(choice.headword)
        and candidate.value ->> 'target_part_of_speech' =
          input.item ->> 'target_part_of_speech'
    )
  ) then
    raise exception 'canonical_question_preview_choice_mapping_missing'
      using errcode = '22023';
  end if;

  select release.*
  into exam_release
  from word_index.app_exam_use_release as release
  where release.dataset_id = p_dataset_id
    and release.status = 'active'
    and release.target_environment = 'preview'
    and release.exam_use_import_allowed
  for share;
  if not found then
    raise exception 'active_preview_exam_use_release_not_found'
      using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from (
      select distinct source.source_entry_id
      from jsonb_array_elements(p_items) as input(item)
      cross join lateral jsonb_array_elements_text(input.item -> 'source_entry_ids')
        as source(source_entry_id)
    ) as package_source
    left join word_index.app_exam_use_occurrence as occurrence
      on occurrence.release_id = exam_release.release_id
     and occurrence.source_entry_id = package_source.source_entry_id
     and occurrence.include_in_exam
     and occurrence.exam_use_status = 'reviewed_for_preview'
    where occurrence.source_entry_id is null
  ) then
    raise exception 'canonical_question_preview_source_not_exam_eligible'
      using errcode = '22023';
  end if;

  select release.*
  into existing_release
  from word_index.app_canonical_question_preview_release as release
  where release.release_key = p_dataset_id::text || ':' ||
    lower(p_manifest ->> 'package_file_sha256')
  for update;
  if found then
    if existing_release.status = 'active'
      and existing_release.exam_use_release_id = exam_release.release_id
      and existing_release.package_content_hash =
        lower(p_manifest ->> 'package_content_hash')
      and existing_release.manifest_content_hash =
        lower(p_manifest ->> 'content_hash')
    then
      return jsonb_build_object(
        'release_id', existing_release.release_id,
        'status', existing_release.status,
        'item_count', 512,
        'expanded_count', 540,
        'source_entry_count', 270,
        'idempotent', true
      );
    end if;
    raise exception 'canonical_question_preview_release_key_reused'
      using errcode = '23505';
  end if;

  insert into word_index.app_canonical_question_preview_release (
    release_key, dataset_id, exam_use_release_id, contract, schema_version,
    policy_version, package_file_sha256, package_content_hash,
    manifest_content_hash, definition_input_sha256, example_input_sha256,
    question_input_sha256, occurrence_input_sha256, target_environment,
    source_shadow_only, preview_apply_allowed, canonical_approved,
    release_allowed, production_apply_allowed, expected_item_count,
    expected_expanded_count, expected_source_entry_count, status
  ) values (
    p_dataset_id::text || ':' || lower(p_manifest ->> 'package_file_sha256'),
    p_dataset_id, exam_release.release_id,
    'oewn-app-preview-question-manifest-v1', '1.0',
    'g12-2025-oewn-app-preview-question-v1',
    lower(p_manifest ->> 'package_file_sha256'),
    lower(p_manifest ->> 'package_content_hash'),
    lower(p_manifest ->> 'content_hash'),
    '048609b211b955891a420a28405c0bf5bdbe6a77420726fb1ca2a32c9a9dc292',
    '3e7102cdde5d677362014f9a46053d0ea2d2d8e6f08fc92cf9eb048ca85ea2c2',
    '034945fd7cb2f8a5aff82532ae66855da0606e7cc2e6bce2461d0d588d567244',
    '2677ac127d53ded7172f70022ba500753ea81a1718bf1a654cfd77732847f0b4',
    'preview', true, true, false, false, false, 512, 540, 270, 'loading'
  ) returning release_id into created_release_id;

  with parsed as materialized (
    select
      input.item,
      input.item ->> 'question_item_id' as question_item_id,
      input.item ->> 'target_headword' as target_headword,
      input.item ->> 'target_part_of_speech' as target_part_of_speech,
      input.item ->> 'quiz_mode' as quiz_mode,
      (input.item ->> 'correct_choice_index')::smallint as correct_choice_index
    from jsonb_array_elements(p_items) as input(item)
  ),
  active_occurrence as materialized (
    select occurrence.*
    from word_index.app_exam_use_occurrence as occurrence
    where occurrence.release_id = exam_release.release_id
      and occurrence.include_in_exam
      and occurrence.exam_use_status = 'reviewed_for_preview'
  ),
  expanded as (
    select parsed.*, occurrence.source_entry_id, occurrence.source_row,
      occurrence.vocab_entry_id, occurrence.unit_id
    from parsed
    cross join lateral jsonb_array_elements_text(parsed.item -> 'source_entry_ids')
      as source(source_entry_id)
    join active_occurrence as occurrence
      on occurrence.source_entry_id = source.source_entry_id
  ),
  bound as (
    select expanded.*, choice_map.choice_headwords,
      choice_map.choice_vocab_entry_ids
    from expanded
    cross join lateral (
      select
        array_agg(choice.headword order by choice.position)::text[]
          as choice_headwords,
        array_agg(
          case
            when choice.position - 1 = expanded.correct_choice_index
              then expanded.vocab_entry_id
            else mapped.vocab_entry_id
          end
          order by choice.position
        )::bigint[] as choice_vocab_entry_ids
      from jsonb_array_elements_text(expanded.item -> 'choice_headwords')
        with ordinality as choice(headword, position)
      left join lateral (
        select candidate_occurrence.vocab_entry_id
        from parsed as candidate
        cross join lateral jsonb_array_elements_text(
          candidate.item -> 'source_entry_ids'
        ) as candidate_source(source_entry_id)
        join active_occurrence as candidate_occurrence
          on candidate_occurrence.source_entry_id =
            candidate_source.source_entry_id
        where lower(candidate.target_headword) = lower(choice.headword)
          and candidate.target_part_of_speech = expanded.target_part_of_speech
        order by candidate_occurrence.source_row, candidate.question_item_id
        limit 1
      ) as mapped on true
    ) as choice_map
  )
  insert into word_index.app_canonical_question_preview_item (
    release_id, dataset_id, exam_use_release_id, source_entry_id, source_row,
    vocab_entry_id, unit_id, question_item_id, question_item_sha256,
    target_definition_item_id, target_sense_family_id,
    target_family_revision_hash, target_headword, target_part_of_speech,
    quiz_mode, prompt_en, choice_headwords, choice_vocab_entry_ids,
    correct_choice_index, source_definition_content_hash,
    source_example_content_hash, source_question_content_hash,
    choice_pool_content_hash, prompt_source_hash, review_input_sha256,
    review_audit_sha256, review_solver_sha256, required_gates, provenance
  )
  select
    created_release_id, p_dataset_id, exam_release.release_id,
    bound.source_entry_id, bound.source_row, bound.vocab_entry_id,
    bound.unit_id, bound.question_item_id,
    lower(bound.item ->> 'content_hash'),
    bound.item ->> 'target_definition_item_id',
    bound.item ->> 'target_sense_family_id',
    lower(bound.item ->> 'target_family_revision_hash'),
    bound.target_headword, bound.target_part_of_speech, bound.quiz_mode,
    bound.item ->> 'prompt_en', bound.choice_headwords,
    bound.choice_vocab_entry_ids, bound.correct_choice_index,
    lower(bound.item ->> 'source_definition_content_hash'),
    lower(bound.item ->> 'source_example_content_hash'),
    lower(bound.item ->> 'source_question_content_hash'),
    lower(bound.item ->> 'choice_pool_content_hash'),
    lower(bound.item ->> 'prompt_source_hash'),
    lower(bound.item #>> '{review_binding,blind_input_hash}'),
    lower(bound.item #>> '{review_binding,audit_content_hash}'),
    lower(bound.item #>> '{review_binding,solver_content_hash}'),
    bound.item -> 'required_gates',
    jsonb_build_object(
      'targetDefinitionItemId', bound.item ->> 'target_definition_item_id',
      'targetSenseFamilyId', bound.item ->> 'target_sense_family_id',
      'sourceSenseIds', bound.item -> 'source_sense_ids',
      'sourceOccurrenceDecisionHashes',
        bound.item -> 'source_occurrence_decision_hashes',
      'sourceShadowOnly', true,
      'productionApplyAllowed', false
    )
  from bound;

  get diagnostics inserted_count = row_count;
  if inserted_count <> 540 then
    raise exception 'canonical_question_preview_expansion_mismatch'
      using errcode = '21000';
  end if;

  update word_index.app_canonical_question_preview_release
  set status = 'retired', retired_at_utc = clock_timestamp()
  where dataset_id = p_dataset_id
    and status = 'active';

  update word_index.app_canonical_question_preview_release
  set status = 'active', activated_at_utc = clock_timestamp()
  where release_id = created_release_id
    and status = 'loading';
  if not found then
    raise exception 'canonical_question_preview_activation_failed'
      using errcode = '21000';
  end if;

  return jsonb_build_object(
    'release_id', created_release_id,
    'status', 'active',
    'item_count', 512,
    'expanded_count', inserted_count,
    'source_entry_count', source_count,
    'idempotent', false
  );
end;
$$;

create function public.import_canonical_question_preview_release_v1(
  p_dataset_id uuid,
  p_manifest jsonb,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from
    'wojxpruvbjzbhrpmsbuy'
  then
    raise exception 'canonical_question_preview_project_mismatch'
      using errcode = '42501';
  end if;
  return private.import_canonical_question_preview_release_v1(
    p_dataset_id, p_manifest, p_items
  );
end;
$$;

create function public.list_active_canonical_question_preview_v1(
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_quiz_mode text
)
returns table (
  release_id uuid,
  package_sha256 text,
  question_item_id text,
  question_item_sha256 text,
  vocab_entry_id bigint,
  unit_id uuid,
  source_row integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
    or not (select private.is_active_admin())
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_dataset_id is null
    or p_unit_ids is null
    or cardinality(p_unit_ids) < 1
    or cardinality(p_unit_ids) <> (
      select count(distinct unit_id)
      from unnest(p_unit_ids) as selected(unit_id)
      where unit_id is not null
    )
    or p_quiz_mode not in (
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
  then
    raise exception 'invalid_canonical_question_preview_selection'
      using errcode = '22023';
  end if;
  return query
  with ranked as (
    select release.release_id, release.package_file_sha256,
      item.question_item_id, item.question_item_sha256,
      item.vocab_entry_id, item.unit_id, item.source_row,
      row_number() over (
        partition by item.question_item_id
        order by item.source_row, item.vocab_entry_id
      ) as item_rank
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
    where release.dataset_id = p_dataset_id
      and release.status = 'active'
      and release.target_environment = 'preview'
      and release.preview_apply_allowed
      and not release.production_apply_allowed
      and item.quiz_mode = p_quiz_mode
      and item.unit_id = any(p_unit_ids)
  )
  select ranked.release_id, ranked.package_file_sha256,
    ranked.question_item_id, ranked.question_item_sha256,
    ranked.vocab_entry_id, ranked.unit_id, ranked.source_row
  from ranked
  where ranked.item_rank = 1
  order by ranked.source_row, ranked.question_item_id;
end;
$$;

create function private.create_assignment_with_canonical_question_bank_preview_v1(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_retry_enabled boolean,
  p_retry_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_student_id uuid,
  p_timing_mode text,
  p_question_time_limit_seconds integer,
  p_quiz_content_mode text,
  p_release_id uuid,
  p_package_sha256 text,
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  release_row word_index.app_canonical_question_preview_release%rowtype;
  dataset_row public.vocab_datasets%rowtype;
  created_assignment_id uuid;
  selected_range_start integer;
  selected_range_end integer;
  inserted_count integer;
  calculated_bank_sha256 text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 1 and 160
    or p_question_count is null
    or p_question_count not between 4 and 500
    or p_time_limit_seconds is null
    or p_time_limit_seconds not between 30 and 10800
    or p_passing_score is null
    or p_passing_score not between 0 and 100
    or p_retry_enabled is null
    or (p_retry_enabled and p_retry_passing_score is null)
    or (not p_retry_enabled and p_retry_passing_score is not null)
    or (p_retry_passing_score is not null and p_retry_passing_score not between 0 and 100)
    or p_question_order_mode is null
    or p_student_id is null
    or p_dataset_id is null
    or p_release_id is null
    or p_timing_mode is null
    or p_timing_mode not in ('none', 'total', 'per_question')
    or (
      p_timing_mode in ('none', 'total')
      and p_question_time_limit_seconds is not null
    )
    or (
      p_timing_mode = 'per_question'
      and (
        p_question_time_limit_seconds is null
        or p_question_time_limit_seconds not between 5 and 600
      )
    )
    or p_quiz_content_mode not in (
      'canonical_definition_to_headword',
      'canonical_example_to_headword'
    )
    or p_package_sha256 !~ '^[0-9a-f]{64}$'
    or p_unit_ids is null
    or cardinality(p_unit_ids) < 1
    or cardinality(p_unit_ids) <> (
      select count(distinct unit_id)
      from unnest(p_unit_ids) as selected(unit_id)
      where unit_id is not null
    )
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
  then
    raise exception 'invalid_canonical_assignment_settings'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as input(item)
    where jsonb_typeof(input.item) <> 'object'
  ) or exists (
    select 1
    from jsonb_array_elements(p_questions) as input(item)
    cross join lateral jsonb_object_keys(input.item) as key(name)
    where key.name not in (
        'vocab_entry_id', 'base_order_index',
        'question_item_id', 'question_item_sha256'
      )
  ) then
    raise exception 'canonical_assignment_question_payload_not_id_only'
      using errcode = '22023';
  end if;

  if (
    select count(*) <> p_question_count
      or count(distinct question.vocab_entry_id) <> p_question_count
      or count(distinct question.question_item_id) <> p_question_count
      or count(distinct question.base_order_index) <> p_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> p_question_count
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      question_item_id text,
      question_item_sha256 text
    )
  ) then
    raise exception 'invalid_canonical_assignment_question_plan'
      using errcode = '22023';
  end if;

  select release.*
  into release_row
  from word_index.app_canonical_question_preview_release as release
  join word_index.app_exam_use_release as exam_release
    on exam_release.release_id = release.exam_use_release_id
   and exam_release.dataset_id = release.dataset_id
   and exam_release.status = 'active'
   and exam_release.target_environment = 'preview'
   and exam_release.exam_use_import_allowed
  where release.release_id = p_release_id
    and release.dataset_id = p_dataset_id
    and release.status = 'active'
    and release.package_file_sha256 = lower(p_package_sha256)
    and release.target_environment = 'preview'
    and release.preview_apply_allowed
    and not release.production_apply_allowed
  for share of release, exam_release;
  if not found then
    raise exception 'canonical_question_preview_release_unavailable'
      using errcode = '22023';
  end if;

  select dataset.*
  into dataset_row
  from public.vocab_datasets as dataset
  where dataset.id = p_dataset_id
    and dataset.status = 'ready'
    and dataset.is_active
  for share;
  if not found then
    raise exception 'dataset_not_ready' using errcode = '22023';
  end if;

  if (
    select count(*)
    from public.vocab_units as unit
    where unit.dataset_id = p_dataset_id
      and unit.id = any(p_unit_ids)
  ) <> cardinality(p_unit_ids) then
    raise exception 'unit_dataset_mismatch' using errcode = '22023';
  end if;

  perform private.resolve_contiguous_unit_direction_v1(
    p_dataset_id,
    p_unit_ids
  );

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    raise exception 'student_not_active' using errcode = '22023';
  end if;

  if (
    select count(*)
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      question_item_id text,
      question_item_sha256 text
    )
    join word_index.app_canonical_question_preview_item as item
      on item.release_id = p_release_id
     and item.dataset_id = p_dataset_id
     and item.vocab_entry_id = question.vocab_entry_id
     and item.quiz_mode = p_quiz_content_mode
     and item.question_item_id = question.question_item_id
     and item.question_item_sha256 = lower(question.question_item_sha256)
     and item.unit_id = any(p_unit_ids)
  ) <> p_question_count then
    raise exception 'canonical_assignment_question_snapshot_mismatch'
      using errcode = '22023';
  end if;

  select min(entry.source_row), max(entry.source_row)
  into selected_range_start, selected_range_end
  from jsonb_to_recordset(p_questions) as question(vocab_entry_id bigint)
  join public.vocab_entries as entry
    on entry.id = question.vocab_entry_id
   and entry.dataset_id = p_dataset_id;

  with selected_question_hashes as (
    select question.base_order_index,
      upper(encode(
        extensions.digest(
          convert_to(
            jsonb_build_object(
              'releaseId', item.release_id,
              'vocabEntryId', item.vocab_entry_id,
              'baseOrderIndex', question.base_order_index,
              'prompt', item.prompt_en,
              'choices', to_jsonb(item.choice_headwords),
              'choiceVocabEntryIds', to_jsonb(item.choice_vocab_entry_ids),
              'correctChoiceIndex', item.correct_choice_index,
              'questionItemId', item.question_item_id,
              'questionItemSha256', item.question_item_sha256
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )) as question_content_sha256
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      question_item_id text,
      question_item_sha256 text
    )
    join word_index.app_canonical_question_preview_item as item
      on item.release_id = p_release_id
     and item.dataset_id = p_dataset_id
     and item.vocab_entry_id = question.vocab_entry_id
     and item.quiz_mode = p_quiz_content_mode
     and item.question_item_id = question.question_item_id
     and item.question_item_sha256 = lower(question.question_item_sha256)
  )
  select upper(encode(
    extensions.digest(
      convert_to(
        string_agg(
          question_content_sha256,
          '|' order by base_order_index
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  ))
  into calculated_bank_sha256
  from selected_question_hashes;

  insert into public.assignments (
    title, dataset_id, range_start, range_end, question_count,
    english_to_korean_ratio, time_limit_seconds, passing_score, passing_basis,
    retake_allowed, status, created_by, range_basis, question_order_mode,
    question_bank_version
  ) values (
    trim(p_title), p_dataset_id, selected_range_start, selected_range_end,
    p_question_count, 0, p_time_limit_seconds, p_passing_score, 'initial',
    false, 'draft', (select auth.uid()), 'units', p_question_order_mode, 3
  ) returning id into created_assignment_id;

  insert into public.assignment_units (
    assignment_id, dataset_id, unit_id, position
  )
  select created_assignment_id, p_dataset_id, selected.unit_id,
    selected.position::integer
  from unnest(p_unit_ids) with ordinality as selected(unit_id, position);

  insert into public.assignment_students (
    assignment_id, student_id, assigned_by
  ) values (created_assignment_id, p_student_id, (select auth.uid()));

  insert into public.assignment_questions (
    assignment_id, vocab_entry_id, base_order_index, direction, prompt,
    choices, correct_choice_index, dataset_id, entry_row_sha256_snapshot,
    eligibility_quiz_mode, eligibility_input_hash_snapshot,
    canonical_content_hash_snapshot, headword_snapshot,
    headword_normalized_snapshot, primary_meaning_snapshot,
    choice_vocab_entry_ids, correct_answer_snapshot, content_origin,
    eligibility_rule_version_snapshot, generator_version_snapshot,
    question_content_sha256, provenance, provenance_status,
    canonical_question_release_id_snapshot,
    canonical_question_item_id_snapshot,
    canonical_question_item_sha256_snapshot,
    canonical_question_review_input_sha256_snapshot,
    canonical_question_review_policy_version_snapshot
  )
  select created_assignment_id, item.vocab_entry_id,
    question.base_order_index, 'korean_to_english', item.prompt_en,
    to_jsonb(item.choice_headwords), item.correct_choice_index,
    p_dataset_id, upper(entry.row_sha256), item.quiz_mode,
    upper(item.question_item_sha256), item.target_family_revision_hash,
    item.target_headword, lower(normalize(trim(item.target_headword), NFKC)),
    entry.primary_meaning, item.choice_vocab_entry_ids,
    item.choice_headwords[item.correct_choice_index + 1], 'canonical',
    release_row.policy_version, 'canonical-question-preview-v1',
    upper(encode(
      extensions.digest(
        convert_to(
          jsonb_build_object(
            'releaseId', item.release_id,
            'vocabEntryId', item.vocab_entry_id,
            'baseOrderIndex', question.base_order_index,
            'prompt', item.prompt_en,
            'choices', to_jsonb(item.choice_headwords),
            'choiceVocabEntryIds', to_jsonb(item.choice_vocab_entry_ids),
            'correctChoiceIndex', item.correct_choice_index,
            'questionItemId', item.question_item_id,
            'questionItemSha256', item.question_item_sha256
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )),
    item.provenance || jsonb_build_object(
      'canonicalQuestionReleaseId', p_release_id,
      'canonicalQuestionPackageSha256', release_row.package_file_sha256,
      'canonicalQuestionItemId', item.question_item_id,
      'canonicalQuestionItemSha256', item.question_item_sha256,
      'reviewInputSha256', item.review_input_sha256,
      'reviewAuditSha256', item.review_audit_sha256,
      'reviewSolverSha256', item.review_solver_sha256,
      'requiredGates', item.required_gates
    ),
    'preview_verified_v1', p_release_id, item.question_item_id,
    item.question_item_sha256, item.review_input_sha256,
    release_row.policy_version
  from jsonb_to_recordset(p_questions) as question(
    vocab_entry_id bigint,
    base_order_index integer,
    question_item_id text,
    question_item_sha256 text
  )
  join word_index.app_canonical_question_preview_item as item
    on item.release_id = p_release_id
   and item.dataset_id = p_dataset_id
   and item.vocab_entry_id = question.vocab_entry_id
   and item.quiz_mode = p_quiz_content_mode
   and item.question_item_id = question.question_item_id
   and item.question_item_sha256 = lower(question.question_item_sha256)
  join public.vocab_entries as entry
    on entry.id = item.vocab_entry_id
   and entry.dataset_id = item.dataset_id
  order by question.base_order_index;

  get diagnostics inserted_count = row_count;
  if inserted_count <> p_question_count then
    raise exception 'canonical_assignment_question_insert_mismatch'
      using errcode = '21000';
  end if;

  update public.assignments
  set quiz_content_mode = p_quiz_content_mode,
      dataset_source_sha256_snapshot = upper(dataset_row.source_sha256),
      canonical_snapshot_sha256_snapshot =
        upper(release_row.package_content_hash),
      link_package_snapshot_sha256 = upper(release_row.package_file_sha256),
      eligibility_rule_version_snapshot = release_row.policy_version,
      generator_version = 'canonical-question-preview-v1',
      question_bank_sha256 = calculated_bank_sha256,
      provenance_status = 'preview_verified_v1',
      canonical_question_release_id_snapshot = p_release_id,
      canonical_question_package_sha256_snapshot =
        release_row.package_file_sha256,
      status = 'active'
  where id = created_assignment_id;
  if not found then
    raise exception 'canonical_assignment_activation_failed'
      using errcode = '21000';
  end if;

  perform private.configure_assignment_delivery_v1(
    created_assignment_id, p_timing_mode, p_question_time_limit_seconds
  );
  perform private.configure_assignment_retry_v1(
    created_assignment_id, p_retry_enabled, p_retry_passing_score
  );

  insert into public.audit_events(event_type, actor_admin_id, details)
  values (
    'assignment.canonical_question_preview_v1_created',
    (select auth.uid()),
    jsonb_build_object(
      'assignmentId', created_assignment_id,
      'studentId', p_student_id,
      'datasetId', p_dataset_id,
      'quizContentMode', p_quiz_content_mode,
      'releaseId', p_release_id,
      'questionCount', p_question_count
    )
  );
  return created_assignment_id;
end;
$$;

create function public.get_canonical_assignment_preview_result_v1(
  p_idempotency_key uuid,
  p_request_sha256 text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.bulk_canonical_question_preview_requests%rowtype;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
    or not (select private.is_active_admin())
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
  then
    raise exception 'invalid_canonical_assignment_request'
      using errcode = '22023';
  end if;
  select request.* into request_row
  from private.bulk_canonical_question_preview_requests as request
  where request.idempotency_key = p_idempotency_key;
  if not found then return null; end if;
  if request_row.actor_admin_id <> (select auth.uid())
    or request_row.request_sha256 <> p_request_sha256
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  return request_row.result;
end;
$$;

create function public.create_bulk_canonical_assignments_preview_v1(
  p_idempotency_key uuid,
  p_request_sha256 text,
  p_batches jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_row private.bulk_canonical_question_preview_requests%rowtype;
  payload_sha256_value text;
  batch jsonb;
  created_assignment_id uuid;
  results jsonb := '[]'::jsonb;
  distinct_student_ids uuid[];
  total_question_count bigint;
begin
  if private.request_supabase_project_ref_v1() is distinct from
      'wojxpruvbjzbhrpmsbuy'
    or not (select private.is_active_admin())
  then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_idempotency_key is null
    or p_request_sha256 !~ '^[0-9a-f]{64}$'
    or p_batches is null
    or jsonb_typeof(p_batches) <> 'array'
    or jsonb_array_length(p_batches) not between 1 and 210
  then
    raise exception 'invalid_canonical_assignment_batches'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where jsonb_typeof(input.item) <> 'object'
  ) then
    raise exception 'invalid_canonical_assignment_batch_shape'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    cross join lateral jsonb_object_keys(input.item) as key(name)
    where key.name not in (
      'kind', 'student_id', 'dataset_id', 'unit_ids', 'unit_labels',
      'title', 'question_count', 'quiz_content_mode',
      'canonical_release_id', 'canonical_package_sha256',
      'time_limit_seconds', 'passing_score', 'retry_enabled',
      'retry_passing_score', 'question_order_mode', 'available_from',
      'available_until', 'timing_mode', 'question_time_limit_seconds',
      'session_number', 'session_count', 'question_targets'
    )
  ) then
    raise exception 'canonical_assignment_batch_not_id_only'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where jsonb_typeof(input.item -> 'unit_ids') is distinct from 'array'
      or jsonb_typeof(input.item -> 'unit_labels') is distinct from 'array'
      or jsonb_typeof(input.item -> 'question_targets') is distinct from 'array'
      or jsonb_typeof(input.item -> 'question_count') is distinct from 'number'
      or input.item ->> 'question_count' !~ '^[0-9]+$'
      or jsonb_typeof(input.item -> 'session_number') is distinct from 'number'
      or input.item ->> 'session_number' !~ '^[0-9]+$'
      or jsonb_typeof(input.item -> 'session_count') is distinct from 'number'
      or input.item ->> 'session_count' !~ '^[0-9]+$'
      or jsonb_typeof(input.item -> 'time_limit_seconds') is distinct from 'number'
      or input.item ->> 'time_limit_seconds' !~ '^[0-9]+$'
      or jsonb_typeof(input.item -> 'passing_score') is distinct from 'number'
      or input.item ->> 'passing_score' !~ '^[0-9]+$'
      or jsonb_typeof(input.item -> 'retry_enabled') is distinct from 'boolean'
      or (
        input.item -> 'retry_passing_score' <> 'null'::jsonb
        and (
          jsonb_typeof(input.item -> 'retry_passing_score') is distinct from 'number'
          or input.item ->> 'retry_passing_score' !~ '^[0-9]+$'
        )
      )
      or (
        input.item -> 'question_time_limit_seconds' <> 'null'::jsonb
        and (
          jsonb_typeof(input.item -> 'question_time_limit_seconds') is distinct from 'number'
          or input.item ->> 'question_time_limit_seconds' !~ '^[0-9]+$'
        )
      )
  ) then
    raise exception 'invalid_canonical_assignment_batch_types'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    cross join lateral jsonb_array_elements(input.item -> 'question_targets')
      as target(value)
    where jsonb_typeof(target.value) <> 'object'
  ) then
    raise exception 'invalid_canonical_assignment_question_target_type'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_batches) as input(item)
    where input.item ->> 'kind' is distinct from 'canonical_preview'
      or coalesce(input.item ->> 'quiz_content_mode', '') not in (
        'canonical_definition_to_headword',
        'canonical_example_to_headword'
      )
      or coalesce(input.item ->> 'student_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(input.item ->> 'dataset_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(input.item ->> 'canonical_release_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or coalesce(input.item ->> 'canonical_package_sha256', '') !~ '^[0-9a-f]{64}$'
      or char_length(trim(coalesce(input.item ->> 'title', ''))) not between 1 and 160
      or coalesce(input.item ->> 'question_order_mode', '') not in (
        'ascending', 'descending', 'random'
      )
      or coalesce(input.item ->> 'timing_mode', '') not in (
        'none', 'total', 'per_question'
      )
      or jsonb_array_length(input.item -> 'unit_ids') < 1
      or exists (
        select 1
        from jsonb_array_elements_text(input.item -> 'unit_ids') as unit(value)
        where unit.value !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      )
      or jsonb_array_length(input.item -> 'question_targets') < 4
      or (input.item ->> 'question_count')::integer < 4
      or jsonb_array_length(input.item -> 'question_targets') <>
        (input.item ->> 'question_count')::integer
      or (input.item ->> 'session_number')::integer <> 1
      or (input.item ->> 'session_count')::integer <> 1
      or nullif(input.item ->> 'available_from', '') is not null
      or nullif(input.item ->> 'available_until', '') is not null
      or input.item ? 'questions'
      or exists (
        select 1
        from jsonb_array_elements(input.item -> 'question_targets')
          as target(value)
        cross join lateral jsonb_object_keys(target.value) as key(name)
        where key.name not in (
          'vocab_entry_id', 'base_order_index',
          'question_item_id', 'question_item_sha256'
        )
      )
      or exists (
        select 1
        from jsonb_array_elements(input.item -> 'question_targets')
          as target(value)
        where jsonb_typeof(target.value -> 'vocab_entry_id') is distinct from 'number'
          or target.value ->> 'vocab_entry_id' !~ '^[0-9]+$'
          or jsonb_typeof(target.value -> 'base_order_index') is distinct from 'number'
          or target.value ->> 'base_order_index' !~ '^[0-9]+$'
          or nullif(target.value ->> 'question_item_id', '') is null
          or target.value ->> 'question_item_sha256' !~ '^[0-9a-f]{64}$'
      )
  ) then
    raise exception 'invalid_canonical_assignment_batch_shape'
      using errcode = '22023';
  end if;

  if (
    select count(distinct (item ->> 'student_id')::uuid)
    from jsonb_array_elements(p_batches) as input(item)
  ) <> jsonb_array_length(p_batches) then
    raise exception 'duplicate_canonical_assignment_student'
      using errcode = '22023';
  end if;

  select sum((item ->> 'question_count')::bigint)
  into total_question_count
  from jsonb_array_elements(p_batches) as input(item);
  if total_question_count > 10000 then
    raise exception 'bulk_question_count_exceeded' using errcode = '22023';
  end if;

  payload_sha256_value := encode(
    extensions.digest(convert_to(p_batches::text, 'UTF8'), 'sha256'),
    'hex'
  );
  insert into private.bulk_canonical_question_preview_requests (
    idempotency_key, request_sha256, payload_sha256, actor_admin_id
  ) values (
    p_idempotency_key, p_request_sha256, payload_sha256_value,
    (select auth.uid())
  ) on conflict (idempotency_key) do nothing;

  select request.* into request_row
  from private.bulk_canonical_question_preview_requests as request
  where request.idempotency_key = p_idempotency_key
  for update;
  if request_row.actor_admin_id <> (select auth.uid())
    or request_row.request_sha256 <> p_request_sha256
    or request_row.payload_sha256 <> payload_sha256_value
  then
    raise exception 'idempotency_key_reused' using errcode = '23505';
  end if;
  if request_row.result is not null then return request_row.result; end if;

  select array_agg(student_id order by student_id)
  into distinct_student_ids
  from (
    select distinct (item ->> 'student_id')::uuid as student_id
    from jsonb_array_elements(p_batches) as input(item)
  ) as selected;
  perform student.id
  from public.students as student
  where student.id = any(distinct_student_ids)
    and student.status = 'active'
    and student.deleted_at is null
  order by student.id
  for update;
  if (
    select count(*)
    from public.students as student
    where student.id = any(distinct_student_ids)
      and student.status = 'active'
      and student.deleted_at is null
  ) <> cardinality(distinct_student_ids) then
    raise exception 'canonical_assignment_student_not_active'
      using errcode = '22023';
  end if;

  for batch in
    select value
    from jsonb_array_elements(p_batches) with ordinality as input(value, position)
    order by position
  loop
    created_assignment_id :=
      private.create_assignment_with_canonical_question_bank_preview_v1(
        batch ->> 'title',
        (batch ->> 'dataset_id')::uuid,
        array(
          select value::uuid
          from jsonb_array_elements_text(batch -> 'unit_ids')
            with ordinality as unit(value, position)
          order by position
        ),
        (batch ->> 'question_count')::integer,
        (batch ->> 'time_limit_seconds')::integer,
        (batch ->> 'passing_score')::smallint,
        (batch ->> 'retry_enabled')::boolean,
        nullif(batch ->> 'retry_passing_score', '')::smallint,
        (batch ->> 'question_order_mode')::public.question_order_mode,
        (batch ->> 'student_id')::uuid,
        batch ->> 'timing_mode',
        nullif(batch ->> 'question_time_limit_seconds', '')::integer,
        batch ->> 'quiz_content_mode',
        (batch ->> 'canonical_release_id')::uuid,
        lower(batch ->> 'canonical_package_sha256'),
        batch -> 'question_targets'
      );
    results := results || jsonb_build_array(jsonb_build_object(
      'student_id', batch ->> 'student_id',
      'assignment_id', created_assignment_id,
      'session_number', 1,
      'status', 'assigned'
    ));
  end loop;

  update private.bulk_canonical_question_preview_requests
  set result = results, completed_at = clock_timestamp()
  where idempotency_key = p_idempotency_key;

  insert into public.audit_events(event_type, actor_admin_id, details)
  values (
    'assignment.bulk_canonical_question_preview_v1_created',
    (select auth.uid()),
    jsonb_build_object(
      'idempotencyKey', p_idempotency_key,
      'requestSha256', p_request_sha256,
      'studentIds', to_jsonb(distinct_student_ids),
      'assignmentCount', jsonb_array_length(results)
    )
  );
  return results;
end;
$$;

revoke all on function private.import_canonical_question_preview_release_v1(
  uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.import_canonical_question_preview_release_v1(
  uuid, jsonb, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.import_canonical_question_preview_release_v1(
  uuid, jsonb, jsonb
) to service_role;

revoke all on function public.list_active_canonical_question_preview_v1(
  uuid, uuid[], text
) from public, anon, authenticated, service_role;
grant execute on function public.list_active_canonical_question_preview_v1(
  uuid, uuid[], text
) to authenticated;

revoke all on function private.create_assignment_with_canonical_question_bank_preview_v1(
  text, uuid, uuid[], integer, integer, smallint, boolean, smallint,
  public.question_order_mode, uuid, text, integer, text, uuid, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.get_canonical_assignment_preview_result_v1(
  uuid, text
) from public, anon, authenticated, service_role;
grant execute on function public.get_canonical_assignment_preview_result_v1(
  uuid, text
) to authenticated;
revoke all on function public.create_bulk_canonical_assignments_preview_v1(
  uuid, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.create_bulk_canonical_assignments_preview_v1(
  uuid, text, jsonb
) to authenticated;

notify pgrst, 'reload schema';

commit;
