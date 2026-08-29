begin;

create function private.student_dashboard_read_rows_v1(
  p_student_id uuid,
  p_snapshot_at timestamptz
)
returns table (
  assignment_id uuid,
  effective_at timestamptz,
  dashboard_section text,
  item jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  with recipient_base as materialized (
    select
      assignment.id as assignment_id,
      assignment.title,
      assignment.status::text as assignment_status,
      assignment.assignment_purpose,
      assignment.dataset_id,
      assignment.range_start,
      assignment.range_end,
      assignment.question_count,
      assignment.timing_mode,
      assignment.passing_score,
      assignment.retake_allowed,
      assignment.available_from,
      assignment.available_until,
      recipient.assigned_at,
      case
        when recipient.missed_at <= p_snapshot_at then recipient.missed_at
        else null
      end as missed_at,
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
      catalog.sort_index as catalog_sort_index
    from public.assignment_students as recipient
    join public.assignments as assignment
      on assignment.id = recipient.assignment_id
    join public.vocab_datasets as dataset
      on dataset.id = assignment.dataset_id
    left join public.vocab_dataset_catalog as catalog
      on catalog.dataset_id = dataset.id
    where recipient.student_id = p_student_id
      and recipient.assigned_at <= p_snapshot_at
      and (
        recipient.cancelled_at is null
        or recipient.cancelled_at > p_snapshot_at
      )
      and (
        assignment.deleted_at is null
        or assignment.deleted_at > p_snapshot_at
      )
  ),
  unit_rollup as (
    select
      link.assignment_id,
      coalesce(
        array_agg(unit.unit_label order by link.position),
        array[]::text[]
      ) as unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position),
        array[]::integer[]
      ) as unit_sort_indexes,
      coalesce(
        array_agg(unit.unit_label order by link.position)
          filter (where link.is_primary),
        array[]::text[]
      ) as primary_unit_labels,
      coalesce(
        array_agg(unit.sort_index order by link.position)
          filter (where link.is_primary),
        array[]::integer[]
      ) as primary_unit_sort_indexes
    from public.assignment_units as link
    join public.vocab_units as unit
      on unit.id = link.unit_id
    join recipient_base as target
      on target.assignment_id = link.assignment_id
    group by link.assignment_id
  ),
  base_rows as (
    select
      recipient.*,
      case
        when cardinality(coalesce(units.unit_labels, array[]::text[])) > 0
          then units.unit_labels
        else array[
          recipient.range_start::text || '~' ||
          recipient.range_end::text || '번'
        ]
      end as unit_labels,
      case
        when cardinality(
          coalesce(units.primary_unit_labels, array[]::text[])
        ) > 0 then units.primary_unit_labels
        else array[]::text[]
      end as primary_unit_labels,
      case
        when cardinality(
          coalesce(units.unit_sort_indexes, array[]::integer[])
        ) > 0 then units.unit_sort_indexes
        else array[]::integer[]
      end as unit_sort_indexes,
      case
        when cardinality(
          coalesce(units.primary_unit_sort_indexes, array[]::integer[])
        ) > 0 then units.primary_unit_sort_indexes
        else array[]::integer[]
      end as primary_unit_sort_indexes,
      attempt.id as attempt_id,
      attempt.status::text as raw_attempt_status,
      attempt.phase::text as raw_attempt_phase,
      attempt.started_at,
      attempt.initial_completed_at,
      attempt.retry_started_at,
      attempt.deadline_at,
      attempt.completed_at,
      attempt.question_count_snapshot,
      attempt.passing_score_snapshot,
      attempt.retry_passing_score_snapshot,
      attempt.unresolved_wrong_count,
      attempt.initial_score,
      attempt.final_score,
      attempt.passed
    from recipient_base as recipient
    left join unit_rollup as units
      on units.assignment_id = recipient.assignment_id
    left join lateral (
      select candidate.*
      from public.quiz_attempts as candidate
      where candidate.student_id = p_student_id
        and candidate.assignment_id = recipient.assignment_id
        and candidate.started_at <= p_snapshot_at
      order by
        candidate.attempt_number desc,
        candidate.started_at desc,
        candidate.id desc
      limit 1
    ) as attempt on true
  ),
  projected_rows as (
    select
      base.*,
      case
        when base.attempt_id is null then null
        when (
          base.completed_at is null
          or base.completed_at > p_snapshot_at
        )
          and (
            case
              when base.retry_started_at is not null
                and base.retry_started_at <= p_snapshot_at then 'retry'
              when base.initial_completed_at is not null
                and base.initial_completed_at <= p_snapshot_at then 'review'
              else 'initial'
            end
          ) <> 'review'
          and base.deadline_at <= p_snapshot_at
          then 'expired'
        when base.completed_at is null
          or base.completed_at > p_snapshot_at
          then 'in_progress'
        else base.raw_attempt_status
      end as last_status,
      case
        when base.attempt_id is null then null
        when base.completed_at is not null
          and base.completed_at <= p_snapshot_at
          then base.raw_attempt_phase
        when base.retry_started_at is not null
          and base.retry_started_at <= p_snapshot_at then 'retry'
        when base.initial_completed_at is not null
          and base.initial_completed_at <= p_snapshot_at then 'review'
        else 'initial'
      end as last_phase,
      case
        when coalesce(
          base.initial_completed_at,
          base.completed_at
        ) <= p_snapshot_at then base.initial_score
        else null
      end as visible_initial_score,
      case
        when base.completed_at <= p_snapshot_at then base.final_score
        else null
      end as visible_final_score,
      case
        when base.completed_at <= p_snapshot_at then base.passed
        else null
      end as visible_passed,
      case
        when base.completed_at <= p_snapshot_at
          then base.unresolved_wrong_count
        else null
      end as visible_unresolved_wrong_count,
      case
        when base.initial_completed_at <= p_snapshot_at
          then base.initial_completed_at
        else null
      end as visible_initial_completed_at,
      case
        when base.retry_started_at <= p_snapshot_at
          then base.retry_started_at
        else null
      end as visible_retry_started_at,
      case
        when base.completed_at <= p_snapshot_at then base.completed_at
        else null
      end as visible_completed_at,
      case
        when base.timing_mode = 'none'
          or not isfinite(base.deadline_at) then null
        else base.deadline_at
      end as visible_deadline_at,
      coalesce(
        base.question_count_snapshot,
        base.question_count
      ) as projected_question_count,
      case
        when base.attempt_id is null then base.passing_score
        when base.retry_started_at is not null
          and base.retry_started_at <= p_snapshot_at
          and base.retry_passing_score_snapshot is not null
          then base.retry_passing_score_snapshot
        else base.passing_score_snapshot
      end as projected_passing_score
    from base_rows as base
  ),
  kind_rows as (
    select
      projected.*,
      case
        when projected.attempt_id is null then 'not_started'
        when projected.last_status = 'expired' then 'expired'
        when projected.last_status = 'in_progress'
          and projected.last_phase = 'review' then 'review_pending'
        when projected.last_status = 'in_progress'
          and (
            projected.last_phase = 'retry'
            or projected.visible_retry_started_at is not null
          ) then 'retry_in_progress'
        when projected.last_status = 'in_progress'
          then 'initial_in_progress'
        when projected.last_status = 'completed'
          and not (
            case
              when coalesce(
                projected.visible_final_score,
                projected.visible_initial_score
              ) is not null then coalesce(
                projected.visible_final_score,
                projected.visible_initial_score
              ) >= projected.projected_passing_score
              else projected.visible_passed is true
            end
          ) then 'failed'
        when projected.visible_retry_started_at is not null
          then 'completed_after_retry'
        else 'completed_first_try'
      end as activity_kind
    from projected_rows as projected
  ),
  classified_rows as (
    select
      kind.*,
      case
        when kind.activity_kind in (
          'completed_first_try',
          'completed_after_retry'
        ) then 'completed'
        when kind.attempt_id is null
          and (
            kind.missed_at is not null
            or kind.assignment_status <> 'active'
            or (
              kind.available_from is not null
              and kind.available_until is not null
              and kind.available_until <= kind.available_from
            )
            or (
              kind.available_until is not null
              and kind.available_until <= p_snapshot_at
            )
          ) then 'deadline_closed'
        when kind.attempt_id is null
          and kind.available_from is not null
          and kind.available_from > p_snapshot_at then 'scheduled'
        when kind.activity_kind in (
          'review_pending',
          'expired',
          'failed'
        ) then 'needs_attention'
        else 'open'
      end as dashboard_section,
      case
        when kind.attempt_id is null
          and (
            kind.missed_at is not null
            or (
              kind.available_until is not null
              and kind.available_until <= p_snapshot_at
            )
          ) then coalesce(
            kind.missed_at,
            kind.available_until,
            kind.assigned_at
          )
        when kind.attempt_id is null then kind.assigned_at
        when kind.activity_kind = 'expired'
          then coalesce(kind.visible_deadline_at, kind.started_at)
        when kind.activity_kind = 'review_pending'
          then coalesce(kind.visible_initial_completed_at, kind.started_at)
        when kind.activity_kind = 'retry_in_progress'
          then coalesce(kind.visible_retry_started_at, kind.started_at)
        when kind.activity_kind = 'initial_in_progress'
          then kind.started_at
        else coalesce(kind.visible_completed_at, kind.started_at)
      end as effective_at
    from kind_rows as kind
  )
  select
    classified.assignment_id,
    classified.effective_at,
    classified.dashboard_section,
    jsonb_build_object(
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
      'id', classified.assignment_id,
      'assignmentStatus', classified.assignment_status,
      'title', classified.title,
      'assignmentPurpose', classified.assignment_purpose,
      'unitLabels', to_jsonb(classified.unit_labels),
      'unitSortIndexes', to_jsonb(classified.unit_sort_indexes),
      'primaryUnitLabels', to_jsonb(classified.primary_unit_labels),
      'primaryUnitSortIndexes',
        to_jsonb(classified.primary_unit_sort_indexes),
      'questionCount', classified.projected_question_count,
      'passingScore', classified.projected_passing_score,
      'retakeAllowed', classified.retake_allowed,
      'lastAttemptId', classified.attempt_id,
      'lastStatus', classified.last_status,
      'lastPhase', classified.last_phase,
      'lastInitialScore', classified.visible_initial_score,
      'lastFinalScore', classified.visible_final_score,
      'lastPassed', classified.visible_passed,
      'lastRetryStartedAt', classified.visible_retry_started_at,
      'lastStartedAt', classified.started_at,
      'lastInitialCompletedAt', classified.visible_initial_completed_at,
      'lastCompletedAt', classified.visible_completed_at,
      'lastDeadlineAt', classified.visible_deadline_at,
      'lastUnresolvedWrongCount',
        classified.visible_unresolved_wrong_count,
      'assignedAt', classified.assigned_at,
      'availableFrom', classified.available_from,
      'availableUntil', classified.available_until,
      'missedAt', classified.missed_at
    ) as item
  from classified_rows as classified;
$$;

create function public.get_student_dashboard_initial_v1(
  p_student_id uuid,
  p_snapshot_at timestamptz default null
)
returns table (
  snapshot_at timestamptz,
  current_items jsonb,
  completed_items jsonb,
  open_count bigint,
  scheduled_count bigint,
  needs_attention_count bigint,
  completed_count bigint,
  deadline_closed_count bigint
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  snapshot_value timestamptz := coalesce(
    p_snapshot_at,
    statement_timestamp()
  );
begin
  if p_student_id is null
    or not isfinite(snapshot_value)
    or snapshot_value > statement_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid student dashboard snapshot';
  end if;

  return query
  with parameters as (
    select snapshot_value as snapshot_at
  ),
  dashboard_rows as materialized (
    select row.*
    from parameters as parameter
    cross join lateral private.student_dashboard_read_rows_v1(
      p_student_id,
      parameter.snapshot_at
    ) as row
  ),
  completed_page as (
    select row.*
    from dashboard_rows as row
    where row.dashboard_section = 'completed'
    order by row.effective_at desc, row.assignment_id asc
    limit 11
  )
  select
    parameter.snapshot_at,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'dashboardSection', row.dashboard_section,
            'effectiveAt', row.effective_at,
            'assignmentId', row.assignment_id,
            'item', row.item
          )
          order by
            case row.dashboard_section
              when 'open' then 1
              when 'scheduled' then 2
              when 'needs_attention' then 3
              when 'deadline_closed' then 4
              else 5
            end,
            row.effective_at desc,
            row.assignment_id asc
        )
        from dashboard_rows as row
        where row.dashboard_section <> 'completed'
      ),
      '[]'::jsonb
    ) as current_items,
    coalesce(
      (
        select jsonb_agg(
          jsonb_build_object(
            'effectiveAt', page.effective_at,
            'assignmentId', page.assignment_id,
            'item', page.item
          )
          order by page.effective_at desc, page.assignment_id asc
        )
        from completed_page as page
      ),
      '[]'::jsonb
    ) as completed_items,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'open'
    ) as open_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'scheduled'
    ) as scheduled_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'needs_attention'
    ) as needs_attention_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'completed'
    ) as completed_count,
    (
      select count(*)
      from dashboard_rows as row
      where row.dashboard_section = 'deadline_closed'
    ) as deadline_closed_count
  from parameters as parameter;
end;
$$;

create function public.list_student_dashboard_completed_page_v1(
  p_student_id uuid,
  p_snapshot_at timestamptz,
  p_cursor_effective_at timestamptz,
  p_cursor_assignment_id uuid
)
returns table (
  cursor_effective_at timestamptz,
  cursor_assignment_id uuid,
  item jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
begin
  if p_student_id is null
    or p_snapshot_at is null
    or p_cursor_effective_at is null
    or p_cursor_assignment_id is null
    or not isfinite(p_snapshot_at)
    or not isfinite(p_cursor_effective_at)
    or p_cursor_effective_at > p_snapshot_at
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception using
      errcode = '22023',
      message = 'invalid student dashboard cursor';
  end if;

  return query
  select
    row.effective_at as cursor_effective_at,
    row.assignment_id as cursor_assignment_id,
    row.item
  from private.student_dashboard_read_rows_v1(
    p_student_id,
    p_snapshot_at
  ) as row
  where row.dashboard_section = 'completed'
    and (
      row.effective_at < p_cursor_effective_at
      or (
        row.effective_at = p_cursor_effective_at
        and row.assignment_id > p_cursor_assignment_id
      )
    )
  order by row.effective_at desc, row.assignment_id asc
  limit 11;
end;
$$;

revoke all on function private.student_dashboard_read_rows_v1(
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.student_dashboard_read_rows_v1(
  uuid,
  timestamptz
) to service_role;

revoke all on function public.get_student_dashboard_initial_v1(
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.get_student_dashboard_initial_v1(
  uuid,
  timestamptz
) to service_role;

revoke all on function public.list_student_dashboard_completed_page_v1(
  uuid,
  timestamptz,
  timestamptz,
  uuid
) from public, anon, authenticated, service_role;
grant execute on function public.list_student_dashboard_completed_page_v1(
  uuid,
  timestamptz,
  timestamptz,
  uuid
) to service_role;

notify pgrst, 'reload schema';

commit;
