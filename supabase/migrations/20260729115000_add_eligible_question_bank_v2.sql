alter table public.assignments
  add column quiz_content_mode text
    not null default 'legacy_book_meaning_choice',
  add column dataset_source_sha256_snapshot text,
  add column canonical_snapshot_sha256_snapshot text,
  add column link_package_snapshot_sha256 text,
  add column eligibility_rule_version_snapshot text
    not null default 'legacy-unverified-v1',
  add column generator_version text
    not null default 'legacy-on-attempt-v1',
  add column question_bank_sha256 text,
  add column provenance_status text
    not null default 'legacy_backfill';

alter table public.assignments
  add constraint assignments_quiz_content_mode_check check (
    quiz_content_mode in (
      'legacy_book_meaning_choice',
      'book_meaning_choice'
    )
  ),
  add constraint assignments_dataset_source_sha_check check (
    dataset_source_sha256_snapshot is null
    or dataset_source_sha256_snapshot ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignments_canonical_snapshot_sha_check check (
    canonical_snapshot_sha256_snapshot is null
    or canonical_snapshot_sha256_snapshot ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignments_link_package_sha_check check (
    link_package_snapshot_sha256 is null
    or link_package_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignments_question_bank_sha_check check (
    question_bank_sha256 is null
    or question_bank_sha256 ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignments_provenance_status_check check (
    provenance_status in ('legacy_backfill', 'verified_v2')
  ),
  add constraint assignments_verified_v2_provenance_check check (
    provenance_status <> 'verified_v2'
    or coalesce((
      quiz_content_mode = 'book_meaning_choice'
      and dataset_source_sha256_snapshot is not null
      and canonical_snapshot_sha256_snapshot is not null
      and link_package_snapshot_sha256 is not null
      and char_length(trim(eligibility_rule_version_snapshot)) > 0
      and char_length(trim(generator_version)) > 0
      and question_bank_sha256 is not null
      and question_bank_version is not null
      and question_bank_version = 2
    ), false)
  );

update public.assignments as assignment
set dataset_source_sha256_snapshot = dataset.source_sha256,
    generator_version = case
      when assignment.question_bank_version is null
        then 'legacy-on-attempt-v1'
      else 'legacy-question-bank-v1'
    end
from public.vocab_datasets as dataset
where dataset.id = assignment.dataset_id;

alter table public.assignment_questions
  add column dataset_id uuid,
  add column entry_row_sha256_snapshot text,
  add column eligibility_quiz_mode text,
  add column eligibility_input_hash_snapshot text,
  add column canonical_lexeme_id_snapshot uuid,
  add column canonical_content_hash_snapshot text,
  add column content_review_id_snapshot uuid,
  add column headword_snapshot text,
  add column headword_normalized_snapshot text,
  add column primary_meaning_snapshot text,
  add column choice_vocab_entry_ids bigint[],
  add column correct_answer_snapshot text,
  add column content_origin text,
  add column eligibility_rule_version_snapshot text,
  add column generator_version_snapshot text,
  add column question_content_sha256 text,
  add column provenance jsonb,
  add column provenance_status text
    not null default 'legacy_backfill';

update public.assignment_questions as question
set dataset_id = assignment.dataset_id,
    entry_row_sha256_snapshot = entry.row_sha256,
    eligibility_quiz_mode = case question.direction
      when 'english_to_korean'
        then 'book_meaning_en_to_ko'
      else 'book_meaning_ko_to_en'
    end,
    eligibility_input_hash_snapshot = entry.row_sha256,
    canonical_lexeme_id_snapshot = null,
    canonical_content_hash_snapshot = null,
    content_review_id_snapshot = null,
    headword_snapshot = entry.headword,
    headword_normalized_snapshot = entry.headword_normalized,
    primary_meaning_snapshot = entry.primary_meaning,
    choice_vocab_entry_ids = null,
    correct_answer_snapshot =
      question.choices ->> question.correct_choice_index,
    content_origin = 'book_occurrence',
    eligibility_rule_version_snapshot = 'legacy-unverified-v1',
    generator_version_snapshot = 'legacy-question-bank-v1',
    question_content_sha256 = upper(encode(
      extensions.digest(
        convert_to(
          jsonb_build_array(
            question.direction,
            question.prompt,
            question.choices,
            question.correct_choice_index,
            entry.row_sha256,
            entry.headword,
            entry.primary_meaning
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )),
    provenance = jsonb_build_object(
      'status', 'legacy_backfill',
      'backfilledAtUtc', now()
    )
from public.assignments as assignment,
  public.vocab_entries as entry
where assignment.id = question.assignment_id
  and entry.id = question.vocab_entry_id;

with complete_banks as (
  select
    assignment.id as assignment_id,
    upper(encode(
      extensions.digest(
        convert_to(
          string_agg(
            question.question_content_sha256,
            '|' order by question.base_order_index
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    )) as bank_sha256
  from public.assignments as assignment
  join public.assignment_questions as question
    on question.assignment_id = assignment.id
  where assignment.question_bank_version is not null
  group by assignment.id, assignment.question_count
  having count(*) = assignment.question_count
    and count(question.question_content_sha256)
      = assignment.question_count
)
update public.assignments as assignment
set question_bank_sha256 = complete_banks.bank_sha256
from complete_banks
where complete_banks.assignment_id = assignment.id;

alter table public.assignment_questions
  add constraint assignment_questions_dataset_fkey
    foreign key (assignment_id, dataset_id)
    references public.assignments(id, dataset_id)
    on delete cascade
    not valid,
  add constraint assignment_questions_entry_dataset_fkey
    foreign key (vocab_entry_id, dataset_id)
    references public.vocab_entries(id, dataset_id)
    on delete restrict
    not valid,
  add constraint assignment_questions_canonical_lexeme_fkey
    foreign key (canonical_lexeme_id_snapshot)
    references word_index.lexeme(lexeme_id)
    on delete restrict
    not valid,
  add constraint assignment_questions_content_review_fkey
    foreign key (content_review_id_snapshot)
    references word_index.review(review_id)
    on delete restrict
    not valid,
  add constraint assignment_questions_id_entry_unique
    unique (id, vocab_entry_id),
  add constraint assignment_questions_entry_sha_check check (
    entry_row_sha256_snapshot is null
    or entry_row_sha256_snapshot ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignment_questions_eligibility_hash_check check (
    eligibility_input_hash_snapshot is null
    or eligibility_input_hash_snapshot ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignment_questions_canonical_hash_check check (
    canonical_content_hash_snapshot is null
    or canonical_content_hash_snapshot ~ '^[0-9A-Fa-f]{64}$'
  ),
  add constraint assignment_questions_content_hash_check check (
    question_content_sha256 is null
    or question_content_sha256 ~ '^[0-9A-F]{64}$'
  ),
  add constraint assignment_questions_eligibility_mode_check check (
    eligibility_quiz_mode is null
    or eligibility_quiz_mode in (
      'book_meaning_en_to_ko',
      'book_meaning_ko_to_en'
    )
  ),
  add constraint assignment_questions_content_origin_check check (
    content_origin is null
    or content_origin in ('book_occurrence', 'canonical')
  ),
  add constraint assignment_questions_provenance_status_check check (
    provenance_status in ('legacy_backfill', 'verified_v2')
  ),
  add constraint assignment_questions_verified_v2_check check (
    provenance_status <> 'verified_v2'
    or coalesce((
      dataset_id is not null
      and entry_row_sha256_snapshot is not null
      and eligibility_quiz_mode is not null
      and eligibility_input_hash_snapshot is not null
      and headword_snapshot is not null
      and headword_normalized_snapshot is not null
      and primary_meaning_snapshot is not null
      and choice_vocab_entry_ids is not null
      and cardinality(choice_vocab_entry_ids) = 4
      and correct_answer_snapshot is not null
      and correct_answer_snapshot =
        choices ->> correct_choice_index
      and content_origin is not null
      and content_origin = 'book_occurrence'
      and eligibility_rule_version_snapshot is not null
      and generator_version_snapshot is not null
      and question_content_sha256 is not null
      and provenance is not null
      and jsonb_typeof(provenance) = 'object'
    ), false)
  );

alter table public.assignment_questions
  validate constraint assignment_questions_dataset_fkey;
alter table public.assignment_questions
  validate constraint assignment_questions_entry_dataset_fkey;
alter table public.assignment_questions
  validate constraint assignment_questions_canonical_lexeme_fkey;
alter table public.assignment_questions
  validate constraint assignment_questions_content_review_fkey;

create index assignment_questions_assignment_dataset_idx
  on public.assignment_questions(assignment_id, dataset_id);
create index assignment_questions_entry_dataset_idx
  on public.assignment_questions(vocab_entry_id, dataset_id);
create unique index assignment_questions_normalized_headword_unique
  on public.assignment_questions(
    assignment_id,
    headword_normalized_snapshot
  )
  where provenance_status = 'verified_v2';
create unique index assignment_questions_canonical_lexeme_unique
  on public.assignment_questions(
    assignment_id,
    canonical_lexeme_id_snapshot
  )
  where provenance_status = 'verified_v2'
    and canonical_lexeme_id_snapshot is not null;

alter table public.quiz_questions
  add constraint quiz_questions_bank_entry_fkey
    foreign key (assignment_question_id, vocab_entry_id)
    references public.assignment_questions(id, vocab_entry_id)
    on delete restrict
    not valid;

alter table public.quiz_questions
  validate constraint quiz_questions_bank_entry_fkey;

create index quiz_questions_bank_entry_idx
  on public.quiz_questions(assignment_question_id, vocab_entry_id)
  where assignment_question_id is not null;

create table public.assignment_quiz_mode_snapshots (
  assignment_id uuid not null,
  dataset_id uuid not null,
  quiz_mode text not null check (
    quiz_mode in (
      'book_meaning_en_to_ko',
      'book_meaning_ko_to_en'
    )
  ),
  capability_status text not null check (
    capability_status in ('ready', 'limited')
  ),
  eligible_entry_count integer not null check (
    eligible_entry_count > 0
  ),
  excluded_entry_count integer not null check (
    excluded_entry_count >= 0
  ),
  dataset_source_sha256 text not null check (
    dataset_source_sha256 ~ '^[0-9A-F]{64}$'
  ),
  canonical_snapshot_sha256 text not null check (
    canonical_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  link_package_snapshot_sha256 text not null check (
    link_package_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  source_id uuid not null
    references word_index.source(source_id) on delete restrict,
  build_id uuid not null
    references word_index.index_build(build_id) on delete restrict,
  source_payload_sha256 text not null check (
    source_payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  capabilities_payload_sha256 text not null check (
    capabilities_payload_sha256 ~ '^[0-9A-F]{64}$'
  ),
  eligibility_rule_version text not null check (
    char_length(trim(eligibility_rule_version)) > 0
  ),
  capability_evaluated_at_utc timestamptz not null,
  capability_snapshot_sha256 text not null check (
    capability_snapshot_sha256 ~ '^[0-9A-F]{64}$'
  ),
  primary key (assignment_id, quiz_mode),
  foreign key (assignment_id, dataset_id)
    references public.assignments(id, dataset_id)
    on delete cascade
);

create index assignment_quiz_mode_snapshots_dataset_idx
  on public.assignment_quiz_mode_snapshots(dataset_id);
create index assignment_quiz_mode_snapshots_source_idx
  on public.assignment_quiz_mode_snapshots(source_id);
create index assignment_quiz_mode_snapshots_build_idx
  on public.assignment_quiz_mode_snapshots(build_id);

alter table public.assignment_quiz_mode_snapshots
  enable row level security;

create policy "active admins can read assignment quiz mode snapshots"
on public.assignment_quiz_mode_snapshots
for select
to authenticated
using ((select private.is_active_admin()));

revoke all on table public.assignment_quiz_mode_snapshots
  from public, anon, authenticated;
grant select on table public.assignment_quiz_mode_snapshots
  to authenticated;
grant all on table public.assignment_quiz_mode_snapshots
  to service_role;

create function private.create_assignment_with_question_bank_v2(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  created_assignment_id uuid;
  dataset_row public.vocab_datasets%rowtype;
  english_capability public.vocab_dataset_capabilities%rowtype;
  korean_capability public.vocab_dataset_capabilities%rowtype;
  import_run_row word_index.vocab_link_import_run%rowtype;
  expected_english_count integer;
  expected_korean_count integer;
  selected_source_sha256 text;
  selected_canonical_sha256 text;
  selected_package_sha256 text;
  selected_rule_version text;
  trusted_questions jsonb;
  plan_invalid boolean;
  inserted_mode_count integer;
  updated_question_count integer;
  calculated_bank_sha256 text;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_question_count is null
    or p_question_count not between 4 and 500
    or p_english_to_korean_ratio is null
    or p_english_to_korean_ratio not between 0 and 100
    or p_unit_ids is null
    or cardinality(p_unit_ids) = 0
    or p_questions is null
    or jsonb_typeof(p_questions) <> 'array'
    or jsonb_array_length(p_questions) <> p_question_count
  then
    raise exception 'invalid_v2_question_settings'
      using errcode = '22023';
  end if;

  expected_english_count := round(
    p_question_count
      * (p_english_to_korean_ratio::numeric / 100)
  );
  expected_korean_count := p_question_count - expected_english_count;

  select *
  into dataset_row
  from public.vocab_datasets
  where id = p_dataset_id
    and status = 'ready'
    and is_active
  for share;
  if not found then
    raise exception 'dataset_not_ready' using errcode = '22023';
  end if;

  if expected_english_count > 0 then
    select *
    into english_capability
    from public.vocab_dataset_capabilities
    where dataset_id = p_dataset_id
      and quiz_mode = 'book_meaning_en_to_ko'
      and status in ('ready', 'limited')
    for share;
    if not found then
      raise exception 'english_to_korean_capability_unavailable'
        using errcode = '22023';
    end if;
  end if;

  if expected_korean_count > 0 then
    select *
    into korean_capability
    from public.vocab_dataset_capabilities
    where dataset_id = p_dataset_id
      and quiz_mode = 'book_meaning_ko_to_en'
      and status in ('ready', 'limited')
    for share;
    if not found then
      raise exception 'korean_to_english_capability_unavailable'
        using errcode = '22023';
    end if;
  end if;

  selected_source_sha256 := coalesce(
    english_capability.dataset_source_sha256,
    korean_capability.dataset_source_sha256
  );
  selected_canonical_sha256 := coalesce(
    english_capability.canonical_snapshot_sha256,
    korean_capability.canonical_snapshot_sha256
  );
  selected_rule_version := coalesce(
    english_capability.rule_version,
    korean_capability.rule_version
  );
  selected_package_sha256 := coalesce(
    english_capability.details ->> 'packageSnapshotSha256',
    korean_capability.details ->> 'packageSnapshotSha256'
  );

  if selected_source_sha256 is distinct from dataset_row.source_sha256
    or selected_canonical_sha256 is null
    or selected_canonical_sha256 !~ '^[0-9A-F]{64}$'
    or selected_package_sha256 is null
    or selected_package_sha256 !~ '^[0-9A-F]{64}$'
    or (
      expected_english_count > 0
      and expected_korean_count > 0
      and (
        english_capability.dataset_source_sha256
          is distinct from korean_capability.dataset_source_sha256
        or english_capability.canonical_snapshot_sha256
          is distinct from korean_capability.canonical_snapshot_sha256
        or english_capability.rule_version
          is distinct from korean_capability.rule_version
        or english_capability.details ->> 'packageSnapshotSha256'
          is distinct from
            korean_capability.details ->> 'packageSnapshotSha256'
      )
    )
  then
    raise exception 'vocab_capability_snapshot_mismatch'
      using errcode = '55000';
  end if;

  select *
  into import_run_row
  from word_index.vocab_link_import_run
  where dataset_id = p_dataset_id
    and status = 'complete'
    and package_snapshot_sha256 = selected_package_sha256
  for share;

  if not found
    or import_run_row.source_payload_sha256 is null
    or import_run_row.capabilities_payload_sha256 is null
  then
    raise exception 'vocab_link_snapshot_not_complete'
      using errcode = '55000';
  end if;

  if not exists (
    select 1
    from word_index.dataset_source as dataset_source
    join word_index.index_build as build
      on build.build_id = dataset_source.build_id
    where dataset_source.dataset_id = p_dataset_id
      and dataset_source.source_id = import_run_row.source_id
      and dataset_source.build_id = import_run_row.build_id
      and dataset_source.dataset_source_sha256 =
        selected_source_sha256
      and build.status = 'complete'
      and lower(build.input_snapshot_sha256) =
        lower(selected_canonical_sha256)
  ) then
    raise exception 'vocab_source_or_build_snapshot_mismatch'
      using errcode = '55000';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_questions) as item(value)
    where jsonb_typeof(item.value) <> 'object'
  ) then
    raise exception 'invalid_v2_question_plan'
      using errcode = '22023';
  end if;

  if (
    select
      count(*) <> p_question_count
      or count(distinct question.base_order_index)
        <> p_question_count
      or min(question.base_order_index) <> 1
      or max(question.base_order_index) <> p_question_count
      or count(distinct question.vocab_entry_id)
        <> p_question_count
      or count(*) filter (
        where question.direction = 'english_to_korean'
      ) <> expected_english_count
      or count(*) filter (
        where question.direction = 'korean_to_english'
      ) <> expected_korean_count
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  ) then
    raise exception 'invalid_v2_question_plan'
      using errcode = '22023';
  end if;

  select exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    where question.vocab_entry_id is null
      or question.base_order_index is null
      or question.direction not in (
        'english_to_korean',
        'korean_to_english'
      )
      or question.choice_vocab_entry_ids is null
      or cardinality(question.choice_vocab_entry_ids) <> 4
      or (
        select count(distinct choice_entry_id)
        from unnest(question.choice_vocab_entry_ids)
          as choice(choice_entry_id)
      ) <> 4
      or (
        select count(*)
        from unnest(question.choice_vocab_entry_ids)
          as choice(choice_entry_id)
        where choice.choice_entry_id = question.vocab_entry_id
      ) <> 1
  )
  into plan_invalid;

  if plan_invalid then
    raise exception 'invalid_v2_question_choices'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    left join public.vocab_entries as entry
      on entry.id = question.vocab_entry_id
     and entry.dataset_id = p_dataset_id
    left join word_index.vocab_entry_link as link
      on link.vocab_entry_id = entry.id
     and link.dataset_id = entry.dataset_id
    left join public.vocab_entry_quiz_eligibility as eligibility
      on eligibility.vocab_entry_id = entry.id
     and eligibility.dataset_id = entry.dataset_id
     and eligibility.quiz_mode = case question.direction
       when 'english_to_korean'
         then 'book_meaning_en_to_ko'
       when 'korean_to_english'
         then 'book_meaning_ko_to_en'
       else null
     end
    left join public.vocab_dataset_capabilities as capability
      on capability.dataset_id = entry.dataset_id
     and capability.quiz_mode = eligibility.quiz_mode
    where entry.id is null
      or not (entry.unit_id = any(p_unit_ids))
      or link.vocab_entry_id is null
      or link.entry_row_sha256 is distinct from entry.row_sha256
      or link.source_id is distinct from import_run_row.source_id
      or eligibility.status is distinct from 'eligible'
      or eligibility.input_content_hash
        is distinct from entry.row_sha256
      or eligibility.rule_version
        is distinct from capability.rule_version
      or eligibility.canonical_lexeme_id
        is distinct from link.lexeme_id
      or lower(eligibility.canonical_content_hash)
        is distinct from lower(link.canonical_content_hash)
      or capability.status not in ('ready', 'limited')
      or capability.dataset_source_sha256
        is distinct from selected_source_sha256
      or capability.canonical_snapshot_sha256
        is distinct from selected_canonical_sha256
      or capability.details ->> 'packageSnapshotSha256'
        is distinct from selected_package_sha256
  ) then
    raise exception 'question_not_eligible_for_direction'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral unnest(question.choice_vocab_entry_ids)
      as selected_choice(vocab_entry_id)
    left join public.vocab_entries as choice_entry
      on choice_entry.id = selected_choice.vocab_entry_id
     and choice_entry.dataset_id = p_dataset_id
    left join word_index.vocab_entry_link as choice_link
      on choice_link.vocab_entry_id = choice_entry.id
     and choice_link.dataset_id = choice_entry.dataset_id
    left join public.vocab_entry_quiz_eligibility
      as choice_eligibility
      on choice_eligibility.vocab_entry_id = choice_entry.id
     and choice_eligibility.dataset_id = choice_entry.dataset_id
     and choice_eligibility.quiz_mode = case question.direction
       when 'english_to_korean'
         then 'book_meaning_en_to_ko'
       when 'korean_to_english'
         then 'book_meaning_ko_to_en'
       else null
     end
    left join public.vocab_dataset_capabilities as choice_capability
      on choice_capability.dataset_id = choice_entry.dataset_id
     and choice_capability.quiz_mode =
       choice_eligibility.quiz_mode
    where choice_entry.id is null
      or not (choice_entry.unit_id = any(p_unit_ids))
      or choice_link.vocab_entry_id is null
      or choice_link.entry_row_sha256
        is distinct from choice_entry.row_sha256
      or choice_link.source_id
        is distinct from import_run_row.source_id
      or choice_eligibility.status is distinct from 'eligible'
      or choice_eligibility.input_content_hash
        is distinct from choice_entry.row_sha256
      or choice_eligibility.rule_version
        is distinct from choice_capability.rule_version
      or choice_eligibility.canonical_lexeme_id
        is distinct from choice_link.lexeme_id
      or lower(choice_eligibility.canonical_content_hash)
        is distinct from lower(choice_link.canonical_content_hash)
      or choice_capability.status not in ('ready', 'limited')
      or choice_capability.dataset_source_sha256
        is distinct from selected_source_sha256
      or choice_capability.canonical_snapshot_sha256
        is distinct from selected_canonical_sha256
      or choice_capability.details ->> 'packageSnapshotSha256'
        is distinct from selected_package_sha256
  ) then
    raise exception 'choice_not_eligible_for_direction'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_questions) as question(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
    cross join lateral (
      select
        count(*) as choice_count,
        count(distinct lower(normalize(
          trim(case question.direction
            when 'english_to_korean'
              then choice_entry.primary_meaning
            else choice_entry.headword
          end),
          NFKC
        ))) as distinct_display_count,
        count(*) filter (
          where trim(case question.direction
            when 'english_to_korean'
              then choice_entry.primary_meaning
            else choice_entry.headword
          end) = ''
        ) as blank_display_count
      from unnest(question.choice_vocab_entry_ids)
        as selected_choice(vocab_entry_id)
      join public.vocab_entries as choice_entry
        on choice_entry.id = selected_choice.vocab_entry_id
       and choice_entry.dataset_id = p_dataset_id
    ) as display_check
    where display_check.choice_count <> 4
      or display_check.distinct_display_count <> 4
      or display_check.blank_display_count <> 0
  ) then
    raise exception 'choice_display_values_not_distinct'
      using errcode = '22023';
  end if;

  select jsonb_agg(
    jsonb_build_object(
      'vocab_entry_id', question.vocab_entry_id,
      'base_order_index', question.base_order_index,
      'direction', question.direction,
      'prompt', case question.direction
        when 'english_to_korean' then target_entry.headword
        else target_entry.primary_meaning
      end,
      'choices', choice_values.choices,
      'correct_choice_index',
        array_position(
          question.choice_vocab_entry_ids,
          question.vocab_entry_id
        ) - 1
    )
    order by question.base_order_index
  )
  into trusted_questions
  from jsonb_to_recordset(p_questions) as question(
    vocab_entry_id bigint,
    base_order_index integer,
    direction text,
    choice_vocab_entry_ids bigint[]
  )
  join public.vocab_entries as target_entry
    on target_entry.id = question.vocab_entry_id
   and target_entry.dataset_id = p_dataset_id
  cross join lateral (
    select jsonb_agg(
      case question.direction
        when 'english_to_korean'
          then choice_entry.primary_meaning
        else choice_entry.headword
      end
      order by selected_choice.position
    ) as choices
    from unnest(question.choice_vocab_entry_ids)
      with ordinality
      as selected_choice(vocab_entry_id, position)
    join public.vocab_entries as choice_entry
      on choice_entry.id = selected_choice.vocab_entry_id
     and choice_entry.dataset_id = p_dataset_id
  ) as choice_values;

  if trusted_questions is null
    or jsonb_array_length(trusted_questions) <> p_question_count
  then
    raise exception 'trusted_question_build_mismatch'
      using errcode = '21000';
  end if;

  created_assignment_id :=
    private.create_assignment_with_question_bank(
      p_title,
      p_dataset_id,
      p_unit_ids,
      p_question_count,
      p_english_to_korean_ratio,
      p_time_limit_seconds,
      p_passing_score,
      p_question_order_mode,
      p_student_ids,
      trusted_questions
    );

  insert into public.assignment_quiz_mode_snapshots (
    assignment_id,
    dataset_id,
    quiz_mode,
    capability_status,
    eligible_entry_count,
    excluded_entry_count,
    dataset_source_sha256,
    canonical_snapshot_sha256,
    link_package_snapshot_sha256,
    source_id,
    build_id,
    source_payload_sha256,
    capabilities_payload_sha256,
    eligibility_rule_version,
    capability_evaluated_at_utc,
    capability_snapshot_sha256
  )
  select
    created_assignment_id,
    capability.dataset_id,
    capability.quiz_mode,
    capability.status,
    capability.eligible_entry_count,
    capability.excluded_entry_count,
    capability.dataset_source_sha256,
    capability.canonical_snapshot_sha256,
    capability.details ->> 'packageSnapshotSha256',
    import_run_row.source_id,
    import_run_row.build_id,
    import_run_row.source_payload_sha256,
    import_run_row.capabilities_payload_sha256,
    capability.rule_version,
    capability.evaluated_at_utc,
    upper(encode(
      extensions.digest(
        convert_to(
          jsonb_build_array(
            capability.dataset_id,
            capability.quiz_mode,
            capability.status,
            capability.eligible_entry_count,
            capability.excluded_entry_count,
            capability.reason_code,
            capability.dataset_source_sha256,
            capability.canonical_snapshot_sha256,
            capability.details ->> 'packageSnapshotSha256',
            import_run_row.source_id,
            import_run_row.build_id,
            import_run_row.source_payload_sha256,
            import_run_row.capabilities_payload_sha256,
            capability.rule_version,
            capability.evaluated_at_utc
          )::text,
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ))
  from public.vocab_dataset_capabilities as capability
  where capability.dataset_id = p_dataset_id
    and (
      (
        expected_english_count > 0
        and capability.quiz_mode = 'book_meaning_en_to_ko'
      )
      or (
        expected_korean_count > 0
        and capability.quiz_mode = 'book_meaning_ko_to_en'
      )
    )
    and capability.status in ('ready', 'limited');

  get diagnostics inserted_mode_count = row_count;
  if inserted_mode_count <>
    (case when expected_english_count > 0 then 1 else 0 end)
    + (case when expected_korean_count > 0 then 1 else 0 end)
  then
    raise exception 'v2_capability_snapshot_count_mismatch'
      using errcode = '21000';
  end if;

  with question_plan as (
    select
      plan.*,
      (
        select jsonb_agg(
          jsonb_build_object(
            'choiceIndex', selected_choice.position - 1,
            'vocabEntryId', choice_entry.id,
            'entryRowSha256', choice_entry.row_sha256,
            'mappingStatus', choice_link.mapping_status,
            'canonicalLexemeId',
              choice_eligibility.canonical_lexeme_id,
            'canonicalContentHash',
              choice_eligibility.canonical_content_hash,
            'eligibilityInputHash',
              choice_eligibility.input_content_hash,
            'eligibilityRuleVersion',
              choice_eligibility.rule_version,
            'displayText', case plan.direction
              when 'english_to_korean'
                then choice_entry.primary_meaning
              else choice_entry.headword
            end
          )
          order by selected_choice.position
        )
        from unnest(plan.choice_vocab_entry_ids)
          with ordinality
          as selected_choice(vocab_entry_id, position)
        join public.vocab_entries as choice_entry
          on choice_entry.id = selected_choice.vocab_entry_id
         and choice_entry.dataset_id = p_dataset_id
        join word_index.vocab_entry_link as choice_link
          on choice_link.vocab_entry_id = choice_entry.id
         and choice_link.dataset_id = choice_entry.dataset_id
        join public.vocab_entry_quiz_eligibility
          as choice_eligibility
          on choice_eligibility.vocab_entry_id = choice_entry.id
         and choice_eligibility.dataset_id = choice_entry.dataset_id
         and choice_eligibility.quiz_mode = case plan.direction
           when 'english_to_korean'
             then 'book_meaning_en_to_ko'
           else 'book_meaning_ko_to_en'
         end
      ) as choice_provenance
    from jsonb_to_recordset(p_questions) as plan(
      vocab_entry_id bigint,
      base_order_index integer,
      direction text,
      choice_vocab_entry_ids bigint[]
    )
  )
  update public.assignment_questions as question
  set dataset_id = assignment.dataset_id,
      entry_row_sha256_snapshot = entry.row_sha256,
      eligibility_quiz_mode = eligibility.quiz_mode,
      eligibility_input_hash_snapshot =
        eligibility.input_content_hash,
      canonical_lexeme_id_snapshot =
        eligibility.canonical_lexeme_id,
      canonical_content_hash_snapshot =
        eligibility.canonical_content_hash,
      content_review_id_snapshot =
        eligibility.content_review_id,
      headword_snapshot = entry.headword,
      headword_normalized_snapshot =
        entry.headword_normalized,
      primary_meaning_snapshot = entry.primary_meaning,
      choice_vocab_entry_ids =
        question_plan.choice_vocab_entry_ids,
      correct_answer_snapshot =
        question.choices ->> question.correct_choice_index,
      content_origin = 'book_occurrence',
      eligibility_rule_version_snapshot =
        eligibility.rule_version,
      generator_version_snapshot = 'book-choice-cache-v2',
      question_content_sha256 = upper(encode(
        extensions.digest(
          convert_to(
            jsonb_build_array(
              assignment.dataset_id,
              entry.id,
              question.base_order_index,
              entry.row_sha256,
              eligibility.quiz_mode,
              question.direction,
              question.prompt,
              question.choices,
              question_plan.choice_vocab_entry_ids,
              question_plan.choice_provenance,
              question.correct_choice_index,
              question.choices ->> question.correct_choice_index,
              entry.headword,
              entry.headword_normalized,
              entry.primary_meaning,
              eligibility.canonical_lexeme_id,
              eligibility.canonical_content_hash,
              eligibility.rule_version,
              selected_source_sha256,
              selected_canonical_sha256,
              selected_package_sha256,
              import_run_row.source_payload_sha256,
              import_run_row.capabilities_payload_sha256,
              'book-choice-cache-v2'
            )::text,
            'UTF8'
          ),
          'sha256'
        ),
        'hex'
      )),
      provenance = jsonb_build_object(
        'datasetSourceSha256', selected_source_sha256,
        'canonicalSnapshotSha256', selected_canonical_sha256,
        'linkPackageSnapshotSha256', selected_package_sha256,
        'sourcePayloadSha256',
          import_run_row.source_payload_sha256,
        'capabilitiesPayloadSha256',
          import_run_row.capabilities_payload_sha256,
        'mappingStatus', link.mapping_status,
        'sourceRow', entry.source_row,
        'unitId', entry.unit_id,
        'eligibilityStatus', eligibility.status,
        'choiceVocabEntryIds',
          to_jsonb(question_plan.choice_vocab_entry_ids),
        'choices', question_plan.choice_provenance
      ),
      provenance_status = 'verified_v2'
  from question_plan
  join public.assignments as assignment
    on assignment.id = created_assignment_id
  join public.vocab_entries as entry
    on entry.id = question_plan.vocab_entry_id
   and entry.dataset_id = assignment.dataset_id
  join word_index.vocab_entry_link as link
    on link.vocab_entry_id = entry.id
   and link.dataset_id = entry.dataset_id
  join public.vocab_entry_quiz_eligibility as eligibility
    on eligibility.vocab_entry_id = entry.id
   and eligibility.dataset_id = entry.dataset_id
  where assignment.id = created_assignment_id
    and question.assignment_id = assignment.id
    and question.base_order_index =
      question_plan.base_order_index
    and entry.id = question.vocab_entry_id
    and eligibility.quiz_mode = case question.direction
      when 'english_to_korean'
        then 'book_meaning_en_to_ko'
      else 'book_meaning_ko_to_en'
    end
    and eligibility.status = 'eligible'
    and eligibility.rule_version = selected_rule_version;

  get diagnostics updated_question_count = row_count;
  if updated_question_count <> p_question_count then
    raise exception 'v2_question_provenance_count_mismatch'
      using errcode = '21000';
  end if;

  if exists (
    select 1
    from public.assignment_questions as question
    where question.assignment_id = created_assignment_id
      and (
        question.provenance_status <> 'verified_v2'
        or cardinality(question.choice_vocab_entry_ids) <> 4
        or (
          select count(distinct choice_entry_id)
          from unnest(question.choice_vocab_entry_ids)
            as choice(choice_entry_id)
        ) <> 4
        or (
          select count(*)
          from unnest(question.choice_vocab_entry_ids)
            as choice(choice_entry_id)
          where choice.choice_entry_id =
            question.vocab_entry_id
        ) <> 1
        or question.correct_answer_snapshot
          is distinct from
            question.choices ->> question.correct_choice_index
      )
  ) then
    raise exception 'v2_question_provenance_invalid'
      using errcode = '21000';
  end if;

  calculated_bank_sha256 := (
    select upper(encode(
      extensions.digest(
        convert_to(
          string_agg(
            question.question_content_sha256,
            '|' order by question.base_order_index
          ),
          'UTF8'
        ),
        'sha256'
      ),
      'hex'
    ))
    from public.assignment_questions as question
    where question.assignment_id = created_assignment_id
  );

  if calculated_bank_sha256 is null then
    raise exception 'v2_question_bank_hash_missing'
      using errcode = '21000';
  end if;

  update public.assignments
  set quiz_content_mode = 'book_meaning_choice',
      dataset_source_sha256_snapshot = selected_source_sha256,
      canonical_snapshot_sha256_snapshot =
        selected_canonical_sha256,
      link_package_snapshot_sha256 =
        selected_package_sha256,
      eligibility_rule_version_snapshot =
        selected_rule_version,
      generator_version = 'book-choice-cache-v2',
      question_bank_sha256 = calculated_bank_sha256,
      question_bank_version = 2,
      provenance_status = 'verified_v2'
  where id = created_assignment_id;

  if not exists (
    select 1
    from public.assignments
    where id = created_assignment_id
      and provenance_status = 'verified_v2'
      and question_bank_sha256 = calculated_bank_sha256
  ) then
    raise exception 'v2_assignment_provenance_update_failed'
      using errcode = '21000';
  end if;

  insert into public.audit_events (
    event_type,
    actor_admin_id,
    details
  )
  values (
    'assignment.question_bank_verified_v2',
    (select auth.uid()),
    jsonb_build_object(
      'assignment_id', created_assignment_id,
      'question_count', p_question_count,
      'dataset_source_sha256', selected_source_sha256,
      'canonical_snapshot_sha256', selected_canonical_sha256,
      'link_package_snapshot_sha256', selected_package_sha256,
      'question_bank_sha256', calculated_bank_sha256
    )
  );

  return created_assignment_id;
end;
$$;

create function public.create_assignment_with_question_bank_v2(
  p_title text,
  p_dataset_id uuid,
  p_unit_ids uuid[],
  p_question_count integer,
  p_english_to_korean_ratio smallint,
  p_time_limit_seconds integer,
  p_passing_score smallint,
  p_question_order_mode public.question_order_mode,
  p_student_ids uuid[],
  p_questions jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
begin
  return private.create_assignment_with_question_bank_v2(
    p_title,
    p_dataset_id,
    p_unit_ids,
    p_question_count,
    p_english_to_korean_ratio,
    p_time_limit_seconds,
    p_passing_score,
    p_question_order_mode,
    p_student_ids,
    p_questions
  );
end;
$$;

revoke all on function private.create_assignment_with_question_bank_v2(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) from public, anon, authenticated;

revoke all on function public.create_assignment_with_question_bank_v2(
  text,
  uuid,
  uuid[],
  integer,
  smallint,
  integer,
  smallint,
  public.question_order_mode,
  uuid[],
  jsonb
) from public, anon;

grant execute on function
  private.create_assignment_with_question_bank_v2(
    text,
    uuid,
    uuid[],
    integer,
    smallint,
    integer,
    smallint,
    public.question_order_mode,
    uuid[],
    jsonb
  ) to authenticated, service_role;

grant execute on function
  public.create_assignment_with_question_bank_v2(
    text,
    uuid,
    uuid[],
    integer,
    smallint,
    integer,
    smallint,
    public.question_order_mode,
    uuid[],
    jsonb
  ) to authenticated, service_role;

notify pgrst, 'reload schema';
