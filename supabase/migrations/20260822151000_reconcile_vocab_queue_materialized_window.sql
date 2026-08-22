-- The planned-window trigger may normalize an expired ready item to a
-- different weekday. Re-read the trigger-adjusted values before collision
-- checks and assignment creation so the queue row and real quiz stay aligned.

drop trigger if exists vocab_assignment_queue_preserve_planned_window
on private.vocab_assignment_series_items;

create trigger vocab_assignment_queue_preserve_planned_window
before update of status, effective_available_from, effective_available_until
on private.vocab_assignment_series_items
for each row
when (new.status = 'ready')
execute function private.preserve_vocab_assignment_queue_planned_window_v1();

create or replace function private.materialize_ready_vocab_assignment_queue_v1(
  p_student_id uuid,
  p_limit integer default 10
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  series_row private.vocab_assignment_series%rowtype;
  item_row private.vocab_assignment_series_items%rowtype;
  created_assignment_id uuid;
  current_release_id uuid;
  failure_code text;
  failure_reason text;
  shifted_from timestamptz;
  shifted_until timestamptz;
  updated_assignment_count integer;
  results jsonb := '[]'::jsonb;
begin
  if p_student_id is null or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'invalid_vocab_queue_materialize_request'
      using errcode = '22023';
  end if;

  perform student.id
  from public.students as student
  where student.id = p_student_id
    and student.status = 'active'
    and student.deleted_at is null
  for update;
  if not found then
    return '[]'::jsonb;
  end if;

  for series_row in
    select series.*
    from private.vocab_assignment_series as series
    where series.student_id = p_student_id
      and series.status = 'active'
      and exists (
        select 1
        from private.vocab_assignment_series_items as item
        where item.series_id = series.id
          and item.status = 'ready'
      )
    order by series.created_at, series.id
    for update skip locked
    limit p_limit
  loop
    select item.*
    into item_row
    from private.vocab_assignment_series_items as item
    where item.series_id = series_row.id
      and item.status = 'ready'
    order by item.sequence_number
    limit 1
    for update;
    if not found then
      continue;
    end if;

    failure_code := null;
    if not exists (
      select 1
      from public.admin_profiles as admin
      where admin.user_id = series_row.actor_admin_id
        and admin.is_active
    ) then
      failure_reason := 'admin_inactive';
    else
      failure_reason := null;
    end if;

    select release.release_id
    into current_release_id
    from word_index.app_exam_use_release as release
    where release.dataset_id = series_row.dataset_id
      and release.status = 'active'
    order by release.created_at_utc desc, release.release_id
    limit 1
    for share;
    if failure_reason is null
      and current_release_id is distinct from series_row.exam_use_release_id
    then
      failure_reason := 'content_release_changed';
    end if;

    shifted_from := item_row.effective_available_from;
    shifted_until := item_row.effective_available_until;
    if failure_reason is null then
      begin
        -- Also normalizes ready rows created before the planned-window trigger.
        update private.vocab_assignment_series_items
        set effective_available_from = shifted_from,
            effective_available_until = shifted_until
        where id = item_row.id
        returning effective_available_from, effective_available_until
        into shifted_from, shifted_until;

        if shifted_until <= clock_timestamp() then
          select next_window.available_from, next_window.available_until
          into shifted_from, shifted_until
          from private.next_vocab_assignment_queue_window_v1(
            series_row.recurrence_slots,
            clock_timestamp()
          ) as next_window;
          update private.vocab_assignment_series_items
          set effective_available_from = shifted_from,
              effective_available_until = shifted_until,
              updated_at = clock_timestamp()
          where id = item_row.id
          returning effective_available_from, effective_available_until
          into shifted_from, shifted_until;
        end if;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := 'schedule_invalid';
      end;
    end if;

    if failure_reason is null and exists (
      select 1
      from public.assignment_students as link
      join public.assignments as assignment on assignment.id = link.assignment_id
      where link.student_id = p_student_id
        and link.cancelled_at is null
        and link.missed_at is null
        and assignment.deleted_at is null
        and (
          coalesce(assignment.available_from, link.assigned_at)
            at time zone 'Asia/Seoul'
        )::date = (shifted_from at time zone 'Asia/Seoul')::date
        and (
          not exists (
            select 1
            from public.quiz_attempts as attempt
            where attempt.assignment_id = link.assignment_id
              and attempt.student_id = link.student_id
          )
          or exists (
            select 1
            from public.quiz_attempts as attempt
            where attempt.assignment_id = link.assignment_id
              and attempt.student_id = link.student_id
              and attempt.status = 'in_progress'
          )
        )
        and not exists (
          select 1
          from jsonb_array_elements_text(
            coalesce(
              item_row.payload -> 'allowed_collision_assignment_ids',
              '[]'::jsonb
            )
          ) as allowed(assignment_id)
          where allowed.assignment_id = assignment.id::text
        )
    ) then
      failure_reason := 'schedule_conflict';
    end if;

    if failure_reason is null then
      begin
        created_assignment_id := private.create_assignment_with_delivery_system_v1(
          series_row.actor_admin_id,
          item_row.payload ->> 'title',
          series_row.dataset_id,
          item_row.unit_ids,
          item_row.question_count,
          (item_row.payload ->> 'english_to_korean_ratio')::smallint,
          (item_row.payload ->> 'time_limit_seconds')::integer,
          (item_row.payload ->> 'passing_score')::smallint,
          (item_row.payload ->> 'question_order_mode')::public.question_order_mode,
          shifted_until,
          array[p_student_id],
          item_row.payload ->> 'timing_mode',
          nullif(
            item_row.payload ->> 'question_time_limit_seconds',
            ''
          )::integer,
          item_row.payload -> 'questions'
        );
        perform private.align_assignment_unit_direction_v1(
          created_assignment_id,
          series_row.dataset_id,
          item_row.unit_ids
        );
        update public.assignments as assignment
        set available_from = shifted_from
        where assignment.id = created_assignment_id
          and assignment.available_until is not distinct from shifted_until;
        get diagnostics updated_assignment_count = row_count;
        if updated_assignment_count <> 1 then
          raise exception 'vocab_queue_schedule_write_failed'
            using errcode = '21000';
        end if;
      exception when others then
        get stacked diagnostics failure_code = returned_sqlstate;
        failure_reason := case
          when failure_code = '40001' then 'schedule_conflict'
          when failure_code in ('22023', '55000') then 'content_unavailable'
          else 'materialization_failed'
        end;
      end;
    end if;

    if failure_reason = 'materialization_failed' then
      -- Keep transient failures retryable. Student dashboard loads and a
      -- later completion callback can safely call the materializer again.
      update private.vocab_assignment_series_items
      set status = 'ready',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'active',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.materialization_failed',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'ready'
      ));
      continue;
    end if;

    if failure_reason is not null then
      update private.vocab_assignment_series_items
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = item_row.id;
      update private.vocab_assignment_series
      set status = 'attention',
          attention_reason = failure_reason,
          updated_at = clock_timestamp()
      where id = series_row.id;
      insert into private.vocab_assignment_series_events (
        series_id,
        item_id,
        event_kind,
        details
      ) values (
        series_row.id,
        item_row.id,
        'session.attention',
        jsonb_build_object(
          'reason', failure_reason,
          'sqlstate', failure_code
        )
      );
      results := results || jsonb_build_array(jsonb_build_object(
        'series_id', series_row.id,
        'item_id', item_row.id,
        'assignment_id', null,
        'status', 'attention'
      ));
      continue;
    end if;

    update private.vocab_assignment_series_items
    set status = 'assigned',
        assignment_id = created_assignment_id,
        materialized_at = clock_timestamp(),
        attention_reason = null,
        updated_at = clock_timestamp()
    where id = item_row.id;
    update private.vocab_assignment_series
    set status = 'active',
        attention_reason = null,
        updated_at = clock_timestamp()
    where id = series_row.id;
    insert into private.vocab_assignment_series_events (
      series_id,
      item_id,
      assignment_id,
      event_kind,
      details
    ) values (
      series_row.id,
      item_row.id,
      created_assignment_id,
      'session.assigned',
      jsonb_build_object('sequenceNumber', item_row.sequence_number)
    );
    insert into public.audit_events (event_type, actor_admin_id, details)
    values (
      'assignment.vocab_completion_queue_materialized',
      series_row.actor_admin_id,
      jsonb_build_object(
        'seriesId', series_row.id,
        'itemId', item_row.id,
        'assignmentId', created_assignment_id,
        'studentId', p_student_id,
        'automated', true
      )
    );
    results := results || jsonb_build_array(jsonb_build_object(
      'series_id', series_row.id,
      'item_id', item_row.id,
      'assignment_id', created_assignment_id,
      'status', 'assigned'
    ));
  end loop;

  return results;
end;
$$;
