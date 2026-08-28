begin;

create function private.admin_history_read_rows_v1(
  p_snapshot_at timestamptz,
  p_attempt_id uuid default null,
  p_assignment_id uuid default null,
  p_student_id uuid default null,
  p_payload text default 'list'
)
returns table (
  entry_key text,
  row_id text,
  assignment_id uuid,
  student_id uuid,
  attempt_id uuid,
  attempt_number integer,
  activity_at timestamptz,
  recorded_at timestamptz,
  effective_at timestamptz,
  activity_section text,
  filter_bucket text,
  is_hidden boolean,
  assignment_deleted boolean,
  student_deleted boolean,
  list_item jsonb,
  detail_item jsonb,
  search_text text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with admin_access as (
    select private.is_active_admin() as allowed
  ),
  unit_rollup as (
    select
      link.assignment_id,
      coalesce(
        array_agg(unit.id order by link.position),
        array[]::uuid[]
      ) as unit_ids,
      coalesce(
        array_agg(unit.unit_label order by link.position),
        array[]::text[]
      ) as unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position),
        array[]::integer[]
      ) as unit_sort_indexes,
      coalesce(
        array_agg(unit.id order by link.position)
          filter (where link.is_primary),
        array[]::uuid[]
      ) as primary_unit_ids,
      coalesce(
        array_agg(unit.unit_label order by link.position)
          filter (where link.is_primary),
        array[]::text[]
      ) as primary_unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position)
          filter (where link.is_primary),
        array[]::integer[]
      ) as primary_unit_sort_indexes,
      coalesce(
        string_agg(unit.unit_label, ' ' order by link.position),
        ''
      ) as unit_search_text
    from public.assignment_units as link
    join public.vocab_units as unit
      on unit.id = link.unit_id
    group by link.assignment_id
  ),
  recipient_base as (
    select
      recipient.assignment_id,
      recipient.student_id,
      recipient.assigned_at,
      case
        when recipient.missed_at <= p_snapshot_at
          then recipient.missed_at
        else null
      end as missed_at,
      case
        when recipient.cancelled_at <= p_snapshot_at
          then recipient.cancelled_at
        else null
      end as cancelled_at,
      case
        when recipient.cancelled_at <= p_snapshot_at
          then recipient.cancellation_reason
        else null
      end as cancellation_reason,
      student.display_name as raw_student_name,
      student.status::text as student_status,
      student.school_name,
      student.grade_label,
      student.deleted_at is not null
        and student.deleted_at <= p_snapshot_at as student_deleted,
      assignment.title as raw_assignment_title,
      assignment.status::text as assignment_status,
      assignment.assignment_purpose,
      assignment.deleted_at is not null
        and assignment.deleted_at <= p_snapshot_at as assignment_deleted,
      assignment.dataset_id,
      dataset.title as raw_dataset_title,
      dataset.edition as raw_dataset_edition,
      catalog.display_name as catalog_display_name,
      catalog.catalog_group,
      catalog.material_kind,
      catalog.grade_code as catalog_grade_code,
      catalog.publisher as catalog_publisher,
      catalog.series_title as catalog_series_title,
      catalog.academic_year as catalog_academic_year,
      catalog.curriculum_revision as catalog_curriculum_revision,
      catalog.edition_label as catalog_edition_label,
      catalog.is_assignable as catalog_is_assignable,
      catalog.sort_index as catalog_sort_index,
      case
        when cardinality(coalesce(units.unit_ids, array[]::uuid[])) > 0
          then units.unit_ids
        else array[]::uuid[]
      end as unit_ids,
      case
        when cardinality(coalesce(units.unit_ids, array[]::uuid[])) > 0
          then units.unit_labels
        when assignment.range_basis = 'source_rows'
          then array[
            '원본 행 ' || assignment.range_start::text ||
            '~' || assignment.range_end::text
          ]
        else array[]::text[]
      end as unit_labels,
      case
        when cardinality(coalesce(units.unit_ids, array[]::uuid[])) > 0
          then units.unit_sort_indexes
        else array[]::integer[]
      end as unit_sort_indexes,
      case
        when cardinality(coalesce(units.primary_unit_ids, array[]::uuid[])) > 0
          then units.primary_unit_ids
        else array[]::uuid[]
      end as primary_unit_ids,
      case
        when cardinality(coalesce(units.primary_unit_ids, array[]::uuid[])) > 0
          then units.primary_unit_labels
        when assignment.assignment_purpose = 'regular'
          and assignment.range_basis = 'source_rows'
          then array[
            '원본 행 ' || assignment.range_start::text ||
            '~' || assignment.range_end::text
          ]
        else array[]::text[]
      end as primary_unit_labels,
      case
        when cardinality(coalesce(units.primary_unit_ids, array[]::uuid[])) > 0
          then units.primary_unit_sort_indexes
        else array[]::integer[]
      end as primary_unit_sort_indexes,
      coalesce(units.unit_search_text, '') as unit_search_text,
      assignment.question_count,
      assignment.english_to_korean_ratio,
      assignment.time_limit_seconds,
      assignment.timing_mode,
      assignment.question_time_limit_seconds,
      assignment.passing_score,
      assignment.question_order_mode,
      assignment.available_from,
      assignment.available_until
    from public.assignment_students as recipient
    join public.students as student
      on student.id = recipient.student_id
    join public.assignments as assignment
      on assignment.id = recipient.assignment_id
    join public.vocab_datasets as dataset
      on dataset.id = assignment.dataset_id
    left join public.vocab_dataset_catalog as catalog
      on catalog.dataset_id = dataset.id
    left join unit_rollup as units
      on units.assignment_id = assignment.id
    where (select admin_access.allowed from admin_access)
      and p_payload in ('list', 'detail')
      and recipient.assigned_at <= p_snapshot_at
      and (
        p_assignment_id is null
        or recipient.assignment_id = p_assignment_id
      )
      and (
        p_student_id is null
        or recipient.student_id = p_student_id
      )
      and (
        p_attempt_id is null
        or exists (
          select 1
          from public.quiz_attempts as target_attempt
          where target_attempt.id = p_attempt_id
            and target_attempt.assignment_id = recipient.assignment_id
            and target_attempt.student_id = recipient.student_id
            and target_attempt.started_at <= p_snapshot_at
        )
      )
  ),
  source_rows as (
    select
      base.*,
      null::uuid as attempt_id,
      null::integer as attempt_number,
      case
        when base.cancelled_at is not null then 'cancelled'
        when base.missed_at is not null
          or (
            base.available_until is not null
            and base.available_until <= p_snapshot_at
          ) then 'missed'
        else 'not_started'
      end as projected_status,
      null::text as projected_phase,
      base.question_count as projected_question_count,
      base.time_limit_seconds as projected_time_limit_seconds,
      base.passing_score as projected_passing_score,
      null::integer as initial_correct_count,
      null::integer as retry_correct_count,
      null::integer as unresolved_wrong_count,
      null::numeric as initial_score,
      null::numeric as final_score,
      null::boolean as passed,
      null::timestamptz as started_at,
      null::timestamptz as initial_completed_at,
      null::timestamptz as retry_started_at,
      null::timestamptz as deadline_at,
      null::timestamptz as completed_at,
      case
        when base.cancelled_at is not null then base.cancelled_at
        when base.missed_at is not null then base.missed_at
        when base.available_until is not null
          and base.available_until <= p_snapshot_at
          then base.available_until
        else base.assigned_at
      end as activity_at,
      base.assigned_at as recorded_at
    from recipient_base as base
    where p_attempt_id is null
      and not exists (
        select 1
        from public.quiz_attempts as existing_attempt
        where existing_attempt.assignment_id = base.assignment_id
          and existing_attempt.student_id = base.student_id
          and existing_attempt.started_at <= p_snapshot_at
      )

    union all

    select
      base.*,
      attempt.id as attempt_id,
      attempt.attempt_number,
      case
        when (
          attempt.completed_at is null
          or attempt.completed_at > p_snapshot_at
        )
          and (
            case
              when attempt.retry_started_at is not null
                and attempt.retry_started_at <= p_snapshot_at then 'retry'
              when attempt.initial_completed_at is not null
                and attempt.initial_completed_at <= p_snapshot_at then 'review'
              else 'initial'
            end
          ) <> 'review'
          and attempt.deadline_at <= p_snapshot_at
          then 'expired'
        when attempt.completed_at is null
          or attempt.completed_at > p_snapshot_at
          then 'in_progress'
        else attempt.status::text
      end as projected_status,
      case
        when attempt.completed_at is not null
          and attempt.completed_at <= p_snapshot_at
          then attempt.phase::text
        when attempt.retry_started_at is not null
          and attempt.retry_started_at <= p_snapshot_at then 'retry'
        when attempt.initial_completed_at is not null
          and attempt.initial_completed_at <= p_snapshot_at then 'review'
        else 'initial'
      end as projected_phase,
      attempt.question_count_snapshot as projected_question_count,
      attempt.time_limit_seconds_snapshot as projected_time_limit_seconds,
      attempt.passing_score_snapshot as projected_passing_score,
      case
        when coalesce(
          attempt.initial_completed_at,
          attempt.completed_at
        ) <= p_snapshot_at then attempt.initial_correct_count
        else null
      end as initial_correct_count,
      case
        when attempt.completed_at <= p_snapshot_at
          then attempt.retry_correct_count
        else null
      end as retry_correct_count,
      case
        when attempt.completed_at <= p_snapshot_at
          then attempt.unresolved_wrong_count
        else null
      end as unresolved_wrong_count,
      case
        when coalesce(
          attempt.initial_completed_at,
          attempt.completed_at
        ) <= p_snapshot_at then attempt.initial_score
        else null
      end as initial_score,
      case
        when attempt.completed_at <= p_snapshot_at
          then attempt.final_score
        else null
      end as final_score,
      case
        when attempt.completed_at <= p_snapshot_at
          then attempt.passed
        else null
      end as passed,
      attempt.started_at,
      case
        when attempt.initial_completed_at <= p_snapshot_at
          then attempt.initial_completed_at
        else null
      end as initial_completed_at,
      case
        when attempt.retry_started_at <= p_snapshot_at
          then attempt.retry_started_at
        else null
      end as retry_started_at,
      attempt.deadline_at,
      case
        when attempt.completed_at <= p_snapshot_at
          then attempt.completed_at
        else null
      end as completed_at,
      attempt.started_at as activity_at,
      attempt.started_at as recorded_at
    from recipient_base as base
    join public.quiz_attempts as attempt
      on attempt.assignment_id = base.assignment_id
      and attempt.student_id = base.student_id
      and attempt.started_at <= p_snapshot_at
    where p_attempt_id is null or attempt.id = p_attempt_id
  ),
  kind_rows as (
    select
      source.*,
      case
        when source.projected_status in ('not_started', 'cancelled', 'missed')
          then source.projected_status
        when source.projected_status = 'expired' then 'expired'
        when source.projected_status = 'in_progress'
          and source.projected_phase = 'review' then 'review_pending'
        when source.projected_status = 'in_progress'
          and (
            source.projected_phase = 'retry'
            or source.retry_started_at is not null
          ) then 'retry_in_progress'
        when source.projected_status = 'in_progress' then 'initial_in_progress'
        when source.projected_status = 'completed'
          and not (
            case
              when coalesce(source.final_score, source.initial_score) is not null
                then coalesce(source.final_score, source.initial_score)
                  >= source.projected_passing_score
              else source.passed is true
            end
          ) then 'failed'
        when source.retry_started_at is not null then 'completed_after_retry'
        else 'completed_first_try'
      end as activity_kind
    from source_rows as source
  ),
  classified_rows as (
    select
      kind.*,
      case
        when kind.assignment_deleted
          or kind.activity_kind = 'cancelled' then 'archived'
        when kind.activity_kind in (
          'missed',
          'expired',
          'review_pending',
          'failed'
        ) then 'needs_attention'
        when kind.activity_kind in (
          'completed_first_try',
          'completed_after_retry'
        ) then 'completed'
        else 'open'
      end as activity_section,
      case
        when kind.assignment_deleted
          or kind.activity_kind = 'cancelled' then 'archived'
        when kind.activity_kind = 'missed' then 'missed'
        when kind.activity_kind in (
          'retry_in_progress',
          'completed_after_retry'
        ) or kind.retry_started_at is not null then 'retried'
        when kind.activity_kind = 'completed_first_try' then 'completed'
        when kind.activity_kind in ('not_started', 'initial_in_progress')
          then 'open'
        else 'needs_attention'
      end as filter_bucket,
      case
        when kind.activity_kind = 'not_started' then kind.assigned_at
        when kind.activity_kind = 'cancelled'
          then coalesce(kind.cancelled_at, kind.activity_at)
        when kind.activity_kind = 'missed'
          then coalesce(kind.missed_at, kind.available_until, kind.activity_at)
        when kind.activity_kind = 'expired'
          then coalesce(kind.deadline_at, kind.activity_at)
        when kind.activity_kind = 'review_pending'
          then coalesce(
            kind.initial_completed_at,
            kind.started_at,
            kind.activity_at
          )
        when kind.activity_kind = 'retry_in_progress'
          then coalesce(kind.retry_started_at, kind.started_at, kind.activity_at)
        when kind.activity_kind = 'initial_in_progress'
          then coalesce(kind.started_at, kind.activity_at)
        else coalesce(kind.completed_at, kind.activity_at)
      end as effective_at
    from kind_rows as kind
  ),
  item_rows as (
    select
      classified.*,
      case
        when classified.attempt_id is not null
          then 'attempt.' || classified.attempt_id::text
        else 'assignment.' || classified.assignment_id::text ||
          '.' || classified.student_id::text
      end as entry_key,
      case
        when classified.attempt_id is not null
          then classified.attempt_id::text
        else 'assignment:' || classified.assignment_id::text ||
          ':' || classified.student_id::text
      end as row_id,
      case
        when classified.attempt_id is not null then exists (
          select 1
          from public.admin_history_hidden_entries as hidden
          where hidden.attempt_id = classified.attempt_id
            and hidden.hidden_at <= p_snapshot_at
        )
        else exists (
          select 1
          from public.admin_history_hidden_entries as hidden
          where hidden.attempt_id is null
            and hidden.assignment_id = classified.assignment_id
            and hidden.student_id = classified.student_id
            and hidden.hidden_at <= p_snapshot_at
        )
      end as is_hidden,
      case when p_payload = 'list' then jsonb_build_object(
        '_dataset', jsonb_build_object(
          'title', classified.raw_dataset_title,
          'edition', classified.raw_dataset_edition,
          'catalog', case
            when classified.catalog_display_name is null then null
            else jsonb_build_object(
              'displayName', classified.catalog_display_name,
              'catalogGroup', classified.catalog_group,
              'materialKind', classified.material_kind,
              'gradeCode', classified.catalog_grade_code,
              'publisher', classified.catalog_publisher,
              'seriesTitle', classified.catalog_series_title,
              'academicYear', classified.catalog_academic_year,
              'curriculumRevision', classified.catalog_curriculum_revision,
              'editionLabel', classified.catalog_edition_label,
              'isAssignable', classified.catalog_is_assignable,
              'sortIndex', classified.catalog_sort_index
            )
          end
        ),
        'id', case
          when classified.attempt_id is not null
            then classified.attempt_id::text
          else 'assignment:' || classified.assignment_id::text ||
            ':' || classified.student_id::text
        end,
        'assignmentId', classified.assignment_id,
        'assignmentTitle', case
          when classified.assignment_deleted then '삭제됨'
          else classified.raw_assignment_title
        end,
        'assignmentPurpose', classified.assignment_purpose,
        'studentId', classified.student_id,
        'studentName', case
          when classified.student_deleted then '삭제됨'
          else classified.raw_student_name
        end,
        'datasetTitle', coalesce(
          classified.catalog_display_name,
          classified.raw_dataset_title
        ),
        'unitLabels', to_jsonb(classified.unit_labels),
        'primaryUnitLabels', to_jsonb(classified.primary_unit_labels),
        'questionCount', classified.projected_question_count,
        'passingScore', classified.projected_passing_score,
        'attemptId', classified.attempt_id,
        'status', classified.projected_status,
        'phase', classified.projected_phase,
        'activityAt', classified.activity_at,
        'assignedAt', classified.assigned_at,
        'availableUntil', classified.available_until,
        'cancelledAt', classified.cancelled_at,
        'missedAt', classified.missed_at,
        'startedAt', classified.started_at,
        'initialCompletedAt', classified.initial_completed_at,
        'retryStartedAt', classified.retry_started_at,
        'deadlineAt', classified.deadline_at,
        'completedAt', classified.completed_at,
        'initialScore', classified.initial_score,
        'finalScore', classified.final_score,
        'passed', classified.passed
      ) else null end as list_item,
      case when p_payload = 'detail' then jsonb_build_object(
        '_dataset', jsonb_build_object(
          'title', classified.raw_dataset_title,
          'edition', classified.raw_dataset_edition,
          'catalog', case
            when classified.catalog_display_name is null then null
            else jsonb_build_object(
              'displayName', classified.catalog_display_name,
              'catalogGroup', classified.catalog_group,
              'materialKind', classified.material_kind,
              'gradeCode', classified.catalog_grade_code,
              'publisher', classified.catalog_publisher,
              'seriesTitle', classified.catalog_series_title,
              'academicYear', classified.catalog_academic_year,
              'curriculumRevision', classified.catalog_curriculum_revision,
              'editionLabel', classified.catalog_edition_label,
              'isAssignable', classified.catalog_is_assignable,
              'sortIndex', classified.catalog_sort_index
            )
          end
        ),
        'id', case
          when classified.attempt_id is not null
            then classified.attempt_id::text
          else 'assignment:' || classified.assignment_id::text ||
            ':' || classified.student_id::text
        end,
        'assignmentId', classified.assignment_id,
        'assignmentTitle', case
          when classified.assignment_deleted then '삭제됨'
          else classified.raw_assignment_title
        end,
        'assignmentDeleted', classified.assignment_deleted,
        'assignmentStatus', classified.assignment_status,
        'assignmentPurpose', classified.assignment_purpose,
        'studentId', classified.student_id,
        'studentName', case
          when classified.student_deleted then '삭제됨'
          else classified.raw_student_name
        end,
        'studentDeleted', classified.student_deleted,
        'studentStatus', classified.student_status,
        'schoolName', case
          when classified.student_deleted then null
          else classified.school_name
        end,
        'gradeLabel', case
          when classified.student_deleted then null
          else classified.grade_label
        end,
        'datasetId', classified.dataset_id,
        'datasetTitle', coalesce(
          classified.catalog_display_name,
          classified.raw_dataset_title
        ),
        'unitIds', to_jsonb(classified.unit_ids),
        'unitLabels', to_jsonb(classified.unit_labels),
        'unitSortIndexes', case
          when cardinality(classified.unit_sort_indexes) > 0
            then to_jsonb(classified.unit_sort_indexes)
          else null
        end,
        'primaryUnitIds', to_jsonb(classified.primary_unit_ids),
        'primaryUnitLabels', to_jsonb(classified.primary_unit_labels),
        'primaryUnitSortIndexes', case
          when cardinality(classified.primary_unit_sort_indexes) > 0
            then to_jsonb(classified.primary_unit_sort_indexes)
          else null
        end,
        'questionCount', classified.projected_question_count,
        'englishToKoreanRatio', classified.english_to_korean_ratio,
        'timeLimitSeconds', classified.projected_time_limit_seconds,
        'timingMode', classified.timing_mode,
        'questionTimeLimitSeconds', classified.question_time_limit_seconds,
        'passingScore', classified.projected_passing_score,
        'questionOrderMode', classified.question_order_mode,
        'availableFrom', classified.available_from,
        'availableUntil', classified.available_until,
        'assignedAt', classified.assigned_at,
        'missedAt', classified.missed_at,
        'cancelledAt', classified.cancelled_at,
        'cancellationReason', classified.cancellation_reason,
        'attemptId', classified.attempt_id,
        'attemptNumber', classified.attempt_number,
        'status', classified.projected_status,
        'phase', classified.projected_phase,
        'activityAt', classified.activity_at,
        'initialCorrectCount', classified.initial_correct_count,
        'retryCorrectCount', classified.retry_correct_count,
        'unresolvedWrongCount', classified.unresolved_wrong_count,
        'initialScore', classified.initial_score,
        'finalScore', classified.final_score,
        'passed', classified.passed,
        'startedAt', classified.started_at,
        'initialCompletedAt', classified.initial_completed_at,
        'retryStartedAt', classified.retry_started_at,
        'deadlineAt', classified.deadline_at,
        'completedAt', classified.completed_at
      ) else null end as detail_item,
      concat_ws(
        ' ',
        case
          when classified.student_deleted then '삭제됨'
          else classified.raw_student_name
        end,
        classified.school_name,
        classified.grade_label,
        case
          when classified.assignment_deleted then '삭제됨'
          else classified.raw_assignment_title
        end,
        classified.raw_dataset_title,
        classified.raw_dataset_edition,
        classified.catalog_display_name,
        classified.catalog_grade_code,
        classified.catalog_publisher,
        classified.catalog_series_title,
        classified.catalog_academic_year::text,
        classified.catalog_curriculum_revision,
        classified.catalog_edition_label,
        classified.unit_search_text,
        array_to_string(classified.unit_labels, ' ')
      ) as search_text
    from classified_rows as classified
  )
  select
    item.entry_key,
    item.row_id,
    item.assignment_id,
    item.student_id,
    item.attempt_id,
    item.attempt_number,
    item.activity_at,
    item.recorded_at,
    item.effective_at,
    item.activity_section,
    item.filter_bucket,
    item.is_hidden,
    item.assignment_deleted,
    item.student_deleted,
    item.list_item,
    item.detail_item,
    item.search_text
  from item_rows as item;
$$;

create function public.get_admin_history_initial_v1(
  p_query text default '',
  p_status_filter text default 'all',
  p_current_only boolean default false,
  p_snapshot_at timestamptz default null,
  p_limit integer default 11
)
returns table (
  group_key text,
  snapshot_at timestamptz,
  total_count bigint,
  items jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  snapshot_at_value timestamptz := coalesce(
    p_snapshot_at,
    statement_timestamp()
  );
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status_filter not in (
    'all',
    'open',
    'needs_attention',
    'missed',
    'completed',
    'retried',
    'archived'
  ) then
    raise exception 'invalid history status filter' using errcode = '22023';
  end if;
  if char_length(normalized_query) > 80 then
    raise exception 'history query is too long' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 11 then
    raise exception 'history page limit must be between 1 and 11'
      using errcode = '22023';
  end if;
  if snapshot_at_value > statement_timestamp() + interval '5 minutes' then
    raise exception 'history snapshot is in the future' using errcode = '22023';
  end if;

  return query
  with raw_rows as (
    select *
    from private.admin_history_read_rows_v1(
      snapshot_at_value,
      null,
      null,
      null,
      'list'
    )
  ),
  unhidden_rows as (
    select raw.*
    from raw_rows as raw
    where not raw.is_hidden
  ),
  current_ranked as (
    select
      raw.*,
      row_number() over (
        partition by raw.assignment_id, raw.student_id
        order by
          coalesce(raw.attempt_number, -1) desc,
          raw.activity_at desc,
          raw.row_id collate "C" desc
      ) as current_rank
    from unhidden_rows as raw
  ),
  visible_rows as (
    select ranked.*
    from current_ranked as ranked
    where (
        not p_current_only
        or (
          ranked.current_rank = 1
          and not ranked.assignment_deleted
          and not ranked.student_deleted
          and ranked.activity_section <> 'archived'
        )
      )
  ),
  filtered_rows as (
    select
      case
        when p_status_filter = 'all' then visible.activity_section
        else 'filter-' || p_status_filter
      end as group_key,
      visible.*
    from visible_rows as visible
    where (
        normalized_query = ''
        or strpos(lower(visible.search_text), normalized_query) > 0
      )
      and (
        p_status_filter = 'all'
        or visible.filter_bucket = p_status_filter
      )
  ),
  ranked_pages as (
    select
      filtered.*,
      count(*) over (partition by filtered.group_key) as total_count,
      row_number() over (
        partition by filtered.group_key
        order by
          filtered.effective_at desc,
          filtered.entry_key collate "C" asc
      ) as page_rank
    from filtered_rows as filtered
  ),
  requested_groups as (
    select requested.group_key, requested.sort_order
    from (
      values
        ('open'::text, 1),
        ('needs_attention'::text, 2),
        ('completed'::text, 3),
        ('archived'::text, 4)
    ) as requested(group_key, sort_order)
    where p_status_filter = 'all'
      and (not p_current_only or requested.group_key <> 'archived')

    union all

    select 'filter-' || p_status_filter, 1
    where p_status_filter <> 'all'
  )
  select
    requested.group_key,
    snapshot_at_value,
    coalesce(max(page.total_count), 0)::bigint,
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'effectiveAt', page.effective_at,
          'entryKey', page.entry_key,
          'item', page.list_item
        )
        order by page.effective_at desc, page.entry_key collate "C" asc
      ) filter (
        where page.page_rank <= p_limit
          and page.list_item is not null
      ),
      '[]'::jsonb
    )
  from requested_groups as requested
  left join ranked_pages as page
    on page.group_key = requested.group_key
  group by requested.group_key, requested.sort_order
  order by requested.sort_order;
end;
$$;

create function public.list_admin_history_page_v1(
  p_query text,
  p_status_filter text,
  p_current_only boolean,
  p_group_key text,
  p_snapshot_at timestamptz,
  p_cursor_effective_at timestamptz,
  p_cursor_entry_key text,
  p_limit integer default 11
)
returns table (
  cursor_effective_at timestamptz,
  cursor_entry_key text,
  item jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  expected_group_key text := case
    when p_status_filter = 'all' then p_group_key
    else 'filter-' || p_status_filter
  end;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status_filter not in (
    'all',
    'open',
    'needs_attention',
    'missed',
    'completed',
    'retried',
    'archived'
  ) then
    raise exception 'invalid history status filter' using errcode = '22023';
  end if;
  if p_status_filter = 'all'
    and p_group_key not in (
      'open',
      'needs_attention',
      'completed',
      'archived'
    ) then
    raise exception 'invalid history section' using errcode = '22023';
  end if;
  if p_group_key <> expected_group_key then
    raise exception 'history group does not match filter'
      using errcode = '22023';
  end if;
  if p_current_only and p_group_key = 'archived' then
    raise exception 'current history has no archived section'
      using errcode = '22023';
  end if;
  if char_length(normalized_query) > 80 then
    raise exception 'history query is too long' using errcode = '22023';
  end if;
  if p_limit < 1 or p_limit > 11 then
    raise exception 'history page limit must be between 1 and 11'
      using errcode = '22023';
  end if;
  if p_snapshot_at is null
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
    or p_cursor_effective_at is null
    or nullif(p_cursor_entry_key, '') is null then
    raise exception 'invalid history cursor' using errcode = '22023';
  end if;

  return query
  with raw_rows as (
    select *
    from private.admin_history_read_rows_v1(
      p_snapshot_at,
      null,
      null,
      null,
      'list'
    )
  ),
  unhidden_rows as (
    select raw.*
    from raw_rows as raw
    where not raw.is_hidden
  ),
  current_ranked as (
    select
      raw.*,
      row_number() over (
        partition by raw.assignment_id, raw.student_id
        order by
          coalesce(raw.attempt_number, -1) desc,
          raw.activity_at desc,
          raw.row_id collate "C" desc
      ) as current_rank
    from unhidden_rows as raw
  ),
  filtered_rows as (
    select ranked.*
    from current_ranked as ranked
    where (
        not p_current_only
        or (
          ranked.current_rank = 1
          and not ranked.assignment_deleted
          and not ranked.student_deleted
          and ranked.activity_section <> 'archived'
        )
      )
      and (
        normalized_query = ''
        or strpos(lower(ranked.search_text), normalized_query) > 0
      )
      and (
        (
          p_status_filter = 'all'
          and ranked.activity_section = p_group_key
        )
        or (
          p_status_filter <> 'all'
          and ranked.filter_bucket = p_status_filter
        )
      )
      and (
        ranked.effective_at < p_cursor_effective_at
        or (
          ranked.effective_at = p_cursor_effective_at
          and ranked.entry_key collate "C" > p_cursor_entry_key collate "C"
        )
      )
  )
  select
    filtered.effective_at,
    filtered.entry_key,
    filtered.list_item
  from filtered_rows as filtered
  order by
    filtered.effective_at desc,
    filtered.entry_key collate "C" asc
  limit p_limit;
end;
$$;

create function public.get_admin_history_detail_v1(
  p_attempt_id uuid default null,
  p_assignment_id uuid default null,
  p_student_id uuid default null
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  snapshot_at_value timestamptz := statement_timestamp();
  result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (
    (
      p_attempt_id is not null
      and p_assignment_id is null
      and p_student_id is null
    )
    or (
      p_attempt_id is null
      and p_assignment_id is not null
      and p_student_id is not null
    )
  ) then
    raise exception 'invalid history detail key' using errcode = '22023';
  end if;

  select row.detail_item
  into result
  from private.admin_history_read_rows_v1(
    snapshot_at_value,
    p_attempt_id,
    p_assignment_id,
    p_student_id,
    'detail'
  ) as row
  where not row.is_hidden
  order by row.activity_at desc, row.entry_key collate "C" asc
  limit 1;

  return result;
end;
$$;

revoke all on function private.admin_history_read_rows_v1(
  timestamptz,
  uuid,
  uuid,
  uuid,
  text
) from public, anon, authenticated, service_role;
grant execute on function private.admin_history_read_rows_v1(
  timestamptz,
  uuid,
  uuid,
  uuid,
  text
) to authenticated;

revoke all on function public.get_admin_history_initial_v1(
  text,
  text,
  boolean,
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
revoke all on function public.list_admin_history_page_v1(
  text,
  text,
  boolean,
  text,
  timestamptz,
  timestamptz,
  text,
  integer
) from public, anon, authenticated, service_role;
revoke all on function public.get_admin_history_detail_v1(
  uuid,
  uuid,
  uuid
) from public, anon, authenticated, service_role;

grant execute on function public.get_admin_history_initial_v1(
  text,
  text,
  boolean,
  timestamptz,
  integer
) to authenticated;
grant execute on function public.list_admin_history_page_v1(
  text,
  text,
  boolean,
  text,
  timestamptz,
  timestamptz,
  text,
  integer
) to authenticated;
grant execute on function public.get_admin_history_detail_v1(
  uuid,
  uuid,
  uuid
) to authenticated;

notify pgrst, 'reload schema';

commit;
