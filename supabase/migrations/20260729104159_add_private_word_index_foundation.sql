-- Canonical vocabulary index transplanted from the reproducible SQLite index.
-- This schema is intentionally not exposed through the Supabase Data API.

create schema if not exists word_index;

revoke all on schema word_index from public, anon, authenticated;
grant usage on schema word_index to postgres, service_role;

alter default privileges in schema word_index
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema word_index
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema word_index
  revoke all on functions from public, anon, authenticated;

create table word_index.schema_meta (
  meta_key text primary key,
  meta_value text not null
);

create table word_index.index_build (
  build_id uuid primary key,
  schema_version text not null,
  builder_version text not null,
  source_root_label text not null,
  input_file_count integer not null check (input_file_count >= 0),
  input_snapshot_sha256 text not null check (
    input_snapshot_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  started_at_utc timestamptz not null,
  completed_at_utc timestamptz,
  status text not null,
  summary_json jsonb,
  constraint index_build_time_order check (
    completed_at_utc is null or completed_at_utc >= started_at_utc
  )
);

create table word_index.input_file_manifest (
  build_id uuid not null
    references word_index.index_build(build_id) on delete cascade,
  source_group text not null,
  relative_path text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9A-Fa-f]{64}$'),
  primary key (build_id, relative_path)
);

create table word_index.lexeme (
  lexeme_id uuid primary key,
  identity_key text not null unique,
  entity_key text not null,
  origin_bucket text not null,
  headword text not null,
  normalized_headword text not null,
  language_code text not null default 'en',
  lexeme_type text not null,
  type_status text not null,
  intended_use text not null,
  lifecycle_status text not null,
  canonical_lexeme_id uuid
    references word_index.lexeme(lexeme_id)
    deferrable initially deferred,
  pos_summary text,
  pronunciation_ipa text,
  pronunciation_ko text,
  stress_note text,
  core_meaning_ko text,
  learner_summary_ko text,
  source_note_path text not null unique,
  source_note_sha256 text not null check (
    source_note_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  legacy_status text,
  content_hash text not null check (content_hash ~ '^[0-9A-Fa-f]{64}$'),
  created_at_utc timestamptz not null,
  updated_at_utc timestamptz not null,
  constraint lexeme_update_time_order check (
    updated_at_utc >= created_at_utc
  ),
  constraint lexeme_not_own_canonical check (
    canonical_lexeme_id is null or canonical_lexeme_id <> lexeme_id
  )
);

create table word_index.sense (
  sense_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  sense_key text not null,
  pos_code text,
  transitivity_code text,
  core_meaning_ko text,
  learner_explanation_ko text,
  nuance_ko text,
  general_rank integer,
  status text not null,
  provenance text not null,
  content_hash text not null check (content_hash ~ '^[0-9A-Fa-f]{64}$'),
  unique (lexeme_id, sense_key)
);

create table word_index.etymology (
  etymology_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  family_label text,
  root_text text,
  meaning_path_ko text,
  learner_explanation_ko text,
  provenance text not null,
  content_hash text not null check (content_hash ~ '^[0-9A-Fa-f]{64}$')
);

create table word_index.source (
  source_id uuid primary key,
  source_key text not null unique,
  source_type text not null,
  title text not null,
  publisher text,
  edition text,
  curriculum_revision text,
  volume text,
  school_name text,
  grade_code text,
  academic_year integer,
  semester integer,
  source_relative_path text,
  source_sha256 text check (
    source_sha256 is null or source_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  status text not null
);

create table word_index.occurrence (
  occurrence_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  source_id uuid not null
    references word_index.source(source_id) on delete cascade,
  sense_id uuid references word_index.sense(sense_id),
  surface_form text,
  source_meaning_ko text,
  day_no integer,
  unit_label text,
  passage_label text,
  page_label text,
  item_label text,
  sequence_no integer,
  occurrence_count integer,
  locator_status text not null,
  priority_tier text not null,
  priority_reason text not null,
  mapping_status text not null,
  source_label_raw text not null,
  context_hash text check (
    context_hash is null or context_hash ~ '^[0-9A-Fa-f]{64}$'
  )
);

create table word_index.relation (
  relation_id uuid primary key,
  from_lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  to_lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  relation_type text not null,
  directionality text not null,
  status text not null,
  confidence_code text not null,
  evidence_ref text,
  check (from_lexeme_id <> to_lexeme_id),
  unique (from_lexeme_id, relation_type, to_lexeme_id)
);

create table word_index.relation_evidence (
  relation_evidence_id uuid primary key,
  relation_id uuid not null
    references word_index.relation(relation_id) on delete cascade,
  source_note_path text not null,
  source_field text not null,
  raw_link_text text not null,
  evidence_hash text not null check (
    evidence_hash ~ '^[0-9A-Fa-f]{64}$'
  ),
  unique (relation_id, source_note_path, source_field, raw_link_text)
);

create table word_index.example (
  example_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  sense_id uuid references word_index.sense(sense_id),
  source_id uuid references word_index.source(source_id),
  example_en text not null,
  translation_ko text,
  example_type text not null,
  locator_label text,
  approval_status text not null,
  display_rank integer,
  provenance text not null
);

create table word_index.review (
  review_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  stage text not null,
  result text not null,
  rule_version text not null,
  input_content_hash text not null check (
    input_content_hash ~ '^[0-9A-Fa-f]{64}$'
  ),
  reviewer_kind text not null,
  reviewer_ref text,
  findings_json jsonb,
  reviewed_at_utc timestamptz not null
);

create table word_index.raw_pointer (
  raw_pointer_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  provider text not null,
  request_term text not null,
  relative_path text,
  file_sha256 text check (
    file_sha256 is null or file_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  entry_index integer,
  entry_id text,
  entry_uuid uuid,
  match_role text not null,
  collection_status text not null,
  error_code text,
  collected_at_utc timestamptz
);

create table word_index.level_mapping (
  level_mapping_id uuid primary key,
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  scale_code text not null,
  level_code text,
  mapping_status text not null,
  source_name text,
  source_version text,
  source_url text,
  source_record_key text,
  mapping_method text not null,
  evidence_sha256 text check (
    evidence_sha256 is null or evidence_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  unmapped_reason text,
  mapped_at_utc timestamptz,
  check (
    (
      mapping_status = 'mapped'
      and level_code is not null
      and source_name is not null
    )
    or (
      mapping_status = 'unmapped'
      and level_code is null
      and unmapped_reason is not null
    )
    or mapping_status = 'legacy_unverified'
  )
);

create table word_index.type_decision (
  type_decision_id uuid primary key,
  lexeme_id uuid
    references word_index.lexeme(lexeme_id) on delete cascade,
  source_note_path text not null,
  current_type text not null,
  proposed_type text not null,
  decision_status text not null,
  confidence_code text not null,
  canonical_headword text,
  canonical_lexeme_id uuid
    references word_index.lexeme(lexeme_id)
    deferrable initially deferred,
  reason_code text not null,
  evidence_summary text not null,
  requires_human_review boolean not null
);

create table word_index.data_issue (
  data_issue_id uuid primary key,
  subject_type text not null,
  subject_id text,
  source_path text,
  issue_code text not null,
  severity text not null,
  status text not null,
  evidence text not null,
  blocks_readiness boolean not null
);

create table word_index.pipeline_rule (
  stage text not null,
  rule_version text not null,
  is_current boolean not null,
  description text not null,
  primary key (stage, rule_version)
);

create table word_index.legacy_freeze (
  relative_path text primary key,
  asset_type text not null,
  freeze_reason text not null,
  successor text not null,
  source_sha256 text not null check (
    source_sha256 ~ '^[0-9A-Fa-f]{64}$'
  ),
  execution_allowed boolean not null
);

create table word_index.work_queue (
  queue_rank integer primary key,
  lexeme_id uuid not null unique
    references word_index.lexeme(lexeme_id) on delete cascade,
  priority_tier text not null,
  priority_score integer not null,
  priority_reason text not null,
  type_gate_status text not null,
  requires_recertification boolean not null,
  legacy_ready_claim boolean not null
);

create table word_index.lexeme_tag (
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  tag_key text not null,
  tag_value text not null,
  provenance text not null,
  primary key (lexeme_id, tag_key, tag_value)
);

create table word_index.lexeme_metric (
  lexeme_id uuid not null
    references word_index.lexeme(lexeme_id) on delete cascade,
  metric_key text not null,
  metric_value double precision not null,
  provenance text not null,
  primary key (lexeme_id, metric_key)
);

create index word_index_lexeme_headword_idx
  on word_index.lexeme(normalized_headword, language_code);
create index word_index_lexeme_work_state_idx
  on word_index.lexeme(type_status, intended_use, lifecycle_status);
create index word_index_lexeme_origin_bucket_idx
  on word_index.lexeme(origin_bucket);
create index word_index_sense_lexeme_rank_idx
  on word_index.sense(lexeme_id, general_rank);
create index word_index_source_scope_idx
  on word_index.source(
    source_type,
    school_name,
    grade_code,
    academic_year,
    semester
  );
create index word_index_occurrence_source_order_idx
  on word_index.occurrence(source_id, day_no, sequence_no);
create index word_index_occurrence_priority_idx
  on word_index.occurrence(lexeme_id, priority_tier, occurrence_count);
create index word_index_occurrence_sense_idx
  on word_index.occurrence(sense_id);
create index word_index_relation_from_idx
  on word_index.relation(from_lexeme_id, relation_type);
create index word_index_relation_to_idx
  on word_index.relation(to_lexeme_id, relation_type);
create index word_index_review_validity_idx
  on word_index.review(
    lexeme_id,
    stage,
    input_content_hash,
    rule_version,
    reviewed_at_utc
  );
create index word_index_raw_lexeme_provider_idx
  on word_index.raw_pointer(lexeme_id, provider);
create index word_index_raw_provider_entry_idx
  on word_index.raw_pointer(provider, entry_id);
create index word_index_level_mapping_status_idx
  on word_index.level_mapping(lexeme_id, scale_code, mapping_status);
create index word_index_data_issue_subject_idx
  on word_index.data_issue(subject_id, severity, status);
create index word_index_type_decision_review_idx
  on word_index.type_decision(decision_status, requires_human_review);
create index word_index_work_queue_priority_idx
  on word_index.work_queue(
    priority_tier,
    priority_score desc,
    queue_rank
  );

create view word_index.v_relation_neighbor
with (security_invoker = true)
as
select
  relation_id,
  from_lexeme_id as lexeme_id,
  to_lexeme_id as neighbor_lexeme_id,
  relation_type,
  'forward'::text as query_direction,
  status,
  confidence_code
from word_index.relation
union all
select
  relation_id,
  to_lexeme_id as lexeme_id,
  from_lexeme_id as neighbor_lexeme_id,
  relation_type,
  'reverse'::text as query_direction,
  status,
  confidence_code
from word_index.relation;

create view word_index.v_readiness
with (security_invoker = true)
as
select
  lexeme.lexeme_id,
  lexeme.headword,
  lexeme.content_hash as current_hash,
  exists (
    select 1
    from word_index.review as review
    join word_index.pipeline_rule as rule
      on rule.stage = review.stage
     and rule.rule_version = review.rule_version
     and rule.is_current
    where review.lexeme_id = lexeme.lexeme_id
      and review.stage = 'format'
      and review.result = 'pass'
      and review.input_content_hash = lexeme.content_hash
  ) as auto_pass,
  exists (
    select 1
    from word_index.review as review
    join word_index.pipeline_rule as rule
      on rule.stage = review.stage
     and rule.rule_version = review.rule_version
     and rule.is_current
    where review.lexeme_id = lexeme.lexeme_id
      and review.stage = 'fact'
      and review.result = 'pass'
      and review.input_content_hash = lexeme.content_hash
  ) as fact_pass,
  exists (
    select 1
    from word_index.review as review
    join word_index.pipeline_rule as rule
      on rule.stage = review.stage
     and rule.rule_version = review.rule_version
     and rule.is_current
    where review.lexeme_id = lexeme.lexeme_id
      and review.stage = 'student'
      and review.result = 'pass'
      and review.input_content_hash = lexeme.content_hash
  ) as learner_pass,
  (
    lexeme.lifecycle_status = 'active'
    and lexeme.type_status = 'approved'
    and lexeme.intended_use = 'quiz'
    and exists (
      select 1
      from word_index.sense as sense
      where sense.lexeme_id = lexeme.lexeme_id
        and sense.status = 'active'
    )
    and exists (
      select 1
      from word_index.raw_pointer as pointer
      where pointer.lexeme_id = lexeme.lexeme_id
        and pointer.provider = 'collegiate'
        and pointer.collection_status = 'success'
    )
    and exists (
      select 1
      from word_index.review as review
      join word_index.pipeline_rule as rule
        on rule.stage = review.stage
       and rule.rule_version = review.rule_version
       and rule.is_current
      where review.lexeme_id = lexeme.lexeme_id
        and review.stage = 'format'
        and review.result = 'pass'
        and review.input_content_hash = lexeme.content_hash
    )
    and exists (
      select 1
      from word_index.review as review
      join word_index.pipeline_rule as rule
        on rule.stage = review.stage
       and rule.rule_version = review.rule_version
       and rule.is_current
      where review.lexeme_id = lexeme.lexeme_id
        and review.stage = 'fact'
        and review.result = 'pass'
        and review.input_content_hash = lexeme.content_hash
        and review.reviewed_at_utc >= (
          select max(format_review.reviewed_at_utc)
          from word_index.review as format_review
          join word_index.pipeline_rule as format_rule
            on format_rule.stage = format_review.stage
           and format_rule.rule_version = format_review.rule_version
           and format_rule.is_current
          where format_review.lexeme_id = lexeme.lexeme_id
            and format_review.stage = 'format'
            and format_review.result = 'pass'
            and format_review.input_content_hash = lexeme.content_hash
        )
    )
    and exists (
      select 1
      from word_index.review as review
      join word_index.pipeline_rule as rule
        on rule.stage = review.stage
       and rule.rule_version = review.rule_version
       and rule.is_current
      where review.lexeme_id = lexeme.lexeme_id
        and review.stage = 'student'
        and review.result = 'pass'
        and review.input_content_hash = lexeme.content_hash
        and review.reviewed_at_utc >= (
          select max(fact_review.reviewed_at_utc)
          from word_index.review as fact_review
          join word_index.pipeline_rule as fact_rule
            on fact_rule.stage = fact_review.stage
           and fact_rule.rule_version = fact_review.rule_version
           and fact_rule.is_current
          where fact_review.lexeme_id = lexeme.lexeme_id
            and fact_review.stage = 'fact'
            and fact_review.result = 'pass'
            and fact_review.input_content_hash = lexeme.content_hash
        )
    )
    and not exists (
      select 1
      from word_index.data_issue as issue
      where issue.subject_id = lexeme.lexeme_id::text
        and issue.status = 'open'
        and issue.blocks_readiness
    )
  ) as is_ready
from word_index.lexeme as lexeme;

create view word_index.v_refinement_queue
with (security_invoker = true)
as
select
  queue.queue_rank,
  queue.lexeme_id,
  lexeme.headword,
  queue.priority_tier,
  queue.priority_score,
  queue.priority_reason,
  queue.type_gate_status,
  queue.requires_recertification,
  coalesce(
    max(pointer.collection_status)
      filter (where pointer.provider = 'collegiate'),
    'missing'
  ) as collegiate_status,
  coalesce(
    max(pointer.collection_status)
      filter (where pointer.provider = 'thesaurus'),
    'missing'
  ) as thesaurus_status
from word_index.work_queue as queue
join word_index.lexeme as lexeme
  on lexeme.lexeme_id = queue.lexeme_id
left join word_index.raw_pointer as pointer
  on pointer.lexeme_id = lexeme.lexeme_id
group by
  queue.queue_rank,
  queue.lexeme_id,
  lexeme.headword,
  queue.priority_tier,
  queue.priority_score,
  queue.priority_reason,
  queue.type_gate_status,
  queue.requires_recertification;

do $$
declare
  table_name text;
begin
  for table_name in
    select tablename
    from pg_catalog.pg_tables
    where schemaname = 'word_index'
  loop
    execute format(
      'alter table word_index.%I enable row level security',
      table_name
    );
    execute format(
      'revoke all on table word_index.%I from public, anon, authenticated',
      table_name
    );
  end loop;
end;
$$;

revoke all on all tables in schema word_index
  from public, anon, authenticated;
revoke all on all sequences in schema word_index
  from public, anon, authenticated;
