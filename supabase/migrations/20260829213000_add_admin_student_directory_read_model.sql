begin;

create function private.admin_student_current_wrong_counts_v1(
  p_student_ids uuid[]
)
returns table (
  student_id uuid,
  wrong_word_count integer,
  repeated_wrong_word_count integer
)
language sql
stable
security invoker
set search_path = ''
as $$
  with admin_access as (
    select private.is_active_admin() as allowed
  ),
  selected_students as materialized (
    select
      student.id,
      student.current_vocab_dataset_id as dataset_id
    from public.students as student
    cross join admin_access as access
    where access.allowed
      and student.id = any(coalesce(p_student_ids, array[]::uuid[]))
      and student.deleted_at is null
      and student.current_vocab_dataset_id is not null
  ),
  unresolved_base as materialized (
    select
      student.id as student_id,
      student.dataset_id,
      state.vocab_entry_id,
      state.canonical_dictionary_id_snapshot as dictionary_id,
      entry_identity.canonical_lexeme_id,
      entry.headword_normalized
    from selected_students as student
    join public.student_vocab_state as state
      on state.student_id = student.id
     and state.unresolved_wrong_count > 0
     and state.resolved_at is null
    join public.vocab_entries as entry
      on entry.id = state.vocab_entry_id
     and entry.dataset_id = student.dataset_id
    left join lateral (
      select
        min(eligibility.canonical_lexeme_id::text)::uuid
          as canonical_lexeme_id
      from public.vocab_entry_quiz_eligibility as eligibility
      where eligibility.vocab_entry_id = entry.id
        and eligibility.dataset_id = entry.dataset_id
        and eligibility.status = 'eligible'
    ) as entry_identity on true
  ),
  canonical_dictionary_bridge as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.canonical_lexeme_id,
      min(unresolved.dictionary_id::text) as dictionary_id
    from unresolved_base as unresolved
    where unresolved.dictionary_id is not null
      and unresolved.canonical_lexeme_id is not null
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.canonical_lexeme_id
  ),
  unresolved_rows as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.vocab_entry_id,
      coalesce(
        unresolved.dictionary_id,
        bridge.dictionary_id
      ) as dictionary_id,
      unresolved.canonical_lexeme_id,
      unresolved.headword_normalized,
      case
        when coalesce(
          unresolved.dictionary_id,
          bridge.dictionary_id
        ) is not null
          then 'dictionary:' || coalesce(
            unresolved.dictionary_id,
            bridge.dictionary_id
          )
        when unresolved.canonical_lexeme_id is not null
          then 'canonical:' || unresolved.canonical_lexeme_id::text
        else 'headword:' || lower(trim(replace(
          unresolved.headword_normalized,
          '*',
          ''
        )))
      end as word_key
    from unresolved_base as unresolved
    left join canonical_dictionary_bridge as bridge
      on unresolved.dictionary_id is null
     and bridge.student_id = unresolved.student_id
     and bridge.dataset_id = unresolved.dataset_id
     and bridge.canonical_lexeme_id = unresolved.canonical_lexeme_id
  ),
  unresolved_words as materialized (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      min(unresolved.vocab_entry_id) as vocab_entry_id,
      min(unresolved.dictionary_id::text) as dictionary_id,
      min(unresolved.canonical_lexeme_id::text)::uuid
        as canonical_lexeme_id,
      min(unresolved.headword_normalized) as headword_normalized
    from unresolved_rows as unresolved
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key
  ),
  initial_wrong_events as materialized (
    select
      wrong_event.student_id,
      wrong_event.dataset_id,
      wrong_event.vocab_entry_id,
      wrong_event.quiz_attempt_id,
      wrong_event.canonical_dictionary_id_snapshot as dictionary_id,
      wrong_event.canonical_lexeme_id_snapshot as canonical_lexeme_id,
      wrong_entry.headword_normalized
    from public.student_vocab_wrong_events as wrong_event
    join selected_students as student
      on student.id = wrong_event.student_id
     and student.dataset_id = wrong_event.dataset_id
    join public.vocab_entries as wrong_entry
      on wrong_entry.id = wrong_event.vocab_entry_id
     and wrong_entry.dataset_id = wrong_event.dataset_id
    where wrong_event.wrong_stage = 'initial'
  ),
  word_counts as (
    select
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key,
      count(distinct wrong_event.quiz_attempt_id)::integer as wrong_count
    from unresolved_words as unresolved
    left join initial_wrong_events as wrong_event
      on wrong_event.student_id = unresolved.student_id
     and wrong_event.dataset_id = unresolved.dataset_id
     and private.vocab_identity_matches_v1(
       unresolved.dataset_id,
       unresolved.vocab_entry_id,
       unresolved.dictionary_id,
       unresolved.canonical_lexeme_id,
       unresolved.headword_normalized,
       wrong_event.dataset_id,
       wrong_event.vocab_entry_id,
       wrong_event.dictionary_id,
       wrong_event.canonical_lexeme_id,
       wrong_event.headword_normalized
     )
    group by
      unresolved.student_id,
      unresolved.dataset_id,
      unresolved.word_key
  )
  select
    student.id,
    count(word.word_key)::integer,
    count(word.word_key) filter (
      where word.wrong_count >= 2
    )::integer
  from selected_students as student
  left join word_counts as word
    on word.student_id = student.id
   and word.dataset_id = student.dataset_id
  group by student.id;
$$;

create function private.admin_student_directory_rows_v1(
  p_snapshot_at timestamptz,
  p_include_wrong_counts boolean default false
)
returns table (
  student_id uuid,
  display_name text,
  school_name text,
  grade_label text,
  student_status text,
  code_status text,
  current_vocab_dataset_id uuid,
  current_vocab_book_label text,
  recent_exam_at timestamptz,
  completed_count bigint,
  missed_count bigint,
  not_started_count bigint,
  retry_needed boolean,
  wrong_word_count integer,
  repeated_wrong_word_count integer,
  raw_points bigint,
  sort_at timestamptz,
  learning_source_labels text[],
  class_group_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  with admin_access as (
    select private.is_active_admin() as allowed
  ),
  students_base as materialized (
    select
      student.id,
      student.display_name,
      student.school_name,
      student.grade_label,
      student.status::text as student_status,
      student.current_vocab_dataset_id,
      student.current_vocab_book,
      student.created_at
    from public.students as student
    cross join admin_access as access
    where access.allowed
      and student.deleted_at is null
      and student.created_at <= p_snapshot_at
  ),
  history_raw as materialized (
    select history.*
    from private.admin_history_read_rows_v1(
      p_snapshot_at,
      null,
      null,
      null,
      'list'
    ) as history
  ),
  current_history_ranked as (
    select
      history.*,
      row_number() over (
        partition by history.assignment_id, history.student_id
        order by
          coalesce(history.attempt_number, -1) desc,
          history.activity_at desc,
          history.row_id collate "C" desc
      ) as current_rank
    from history_raw as history
    where not history.is_hidden
  ),
  current_history as materialized (
    select history.*
    from current_history_ranked as history
    join students_base as student on student.id = history.student_id
    where history.current_rank = 1
      and not history.assignment_deleted
      and not history.student_deleted
      and history.activity_section <> 'archived'
  ),
  activity_rollup as (
    select
      history.student_id,
      max(greatest(
        (history.list_item ->> 'startedAt')::timestamptz,
        (history.list_item ->> 'initialCompletedAt')::timestamptz,
        (history.list_item ->> 'retryStartedAt')::timestamptz,
        (history.list_item ->> 'completedAt')::timestamptz
      )) filter (
        where history.attempt_id is not null
      ) as recent_exam_at,
      max(history.effective_at) as recent_activity_at,
      count(*) filter (
        where history.list_item ->> 'status' in ('completed', 'expired')
      ) as completed_count,
      count(*) filter (
        where history.list_item ->> 'status' = 'missed'
      ) as missed_count,
      count(*) filter (
        where history.list_item ->> 'status' = 'not_started'
      ) as not_started_count,
      coalesce(bool_or(
        (
          history.list_item ->> 'status' = 'expired'
          or (
            history.list_item ->> 'status' = 'completed'
            and (
              case
                when coalesce(
                  history.list_item ->> 'finalScore',
                  history.list_item ->> 'initialScore'
                ) is not null then coalesce(
                  (history.list_item ->> 'finalScore')::numeric,
                  (history.list_item ->> 'initialScore')::numeric
                ) < (history.list_item ->> 'passingScore')::numeric
                else (history.list_item ->> 'passed')::boolean is not true
              end
            )
          )
        )
        and (
          case
            when attempt.completed_at <= p_snapshot_at
              then attempt.unresolved_wrong_count
            else null
          end is null
          or case
            when attempt.completed_at <= p_snapshot_at
              then attempt.unresolved_wrong_count
            else null
          end > 0
        )
      ), false) as retry_needed
    from current_history as history
    left join public.quiz_attempts as attempt on attempt.id = history.attempt_id
    group by history.student_id
  ),
  source_rollup as (
    select
      source.student_id,
      array_agg(
        distinct source.display_label order by source.display_label
      ) as learning_source_labels
    from public.student_learning_sources as source
    join students_base as student on student.id = source.student_id
    where source.active
    group by source.student_id
  ),
  class_group_rollup as (
    select
      member.student_id,
      array_agg(member.class_group_id order by member.class_group_id)
        as class_group_ids
    from public.class_group_students as member
    join public.class_groups as class_group
      on class_group.id = member.class_group_id
     and class_group.active
    join students_base as student on student.id = member.student_id
    group by member.student_id
  ),
  wrong_counts as materialized (
    select wrong.*
    from private.admin_student_current_wrong_counts_v1(
      case
        when p_include_wrong_counts then coalesce(
          (select array_agg(student.id) from students_base as student),
          array[]::uuid[]
        )
        else array[]::uuid[]
      end
    ) as wrong
  )
  select
    student.id,
    student.display_name,
    student.school_name,
    student.grade_label,
    student.student_status,
    case
      when code.student_id is null then 'missing'
      when code.status = 'active'
        and code.expires_at is not null
        and code.expires_at <= p_snapshot_at then 'expired'
      else code.status::text
    end as code_status,
    student.current_vocab_dataset_id,
    coalesce(
      catalog.display_name,
      dataset.title,
      student.current_vocab_book
    ) as current_vocab_book_label,
    activity.recent_exam_at,
    coalesce(activity.completed_count, 0),
    coalesce(activity.missed_count, 0),
    coalesce(activity.not_started_count, 0),
    coalesce(activity.retry_needed, false),
    coalesce(wrong.wrong_word_count, 0),
    coalesce(wrong.repeated_wrong_word_count, 0),
    coalesce(point.total_points, 0),
    coalesce(activity.recent_activity_at, student.created_at) as sort_at,
    coalesce(source.learning_source_labels, array[]::text[]),
    coalesce(class_group.class_group_ids, array[]::uuid[])
  from students_base as student
  left join public.student_codes as code on code.student_id = student.id
  left join public.vocab_datasets as dataset
    on dataset.id = student.current_vocab_dataset_id
  left join public.vocab_dataset_catalog as catalog
    on catalog.dataset_id = student.current_vocab_dataset_id
  left join activity_rollup as activity on activity.student_id = student.id
  left join source_rollup as source on source.student_id = student.id
  left join class_group_rollup as class_group
    on class_group.student_id = student.id
  left join wrong_counts as wrong on wrong.student_id = student.id
  left join public.student_point_totals as point
    on point.student_id = student.id;
$$;

create function private.admin_student_directory_filtered_rows_v1(
  p_snapshot_at timestamptz,
  p_query text,
  p_school text,
  p_grade text,
  p_status text,
  p_class_group_id uuid,
  p_wordbook text,
  p_wrong text
)
returns table (
  student_id uuid,
  display_name text,
  school_name text,
  grade_label text,
  student_status text,
  code_status text,
  current_vocab_dataset_id uuid,
  current_vocab_book_label text,
  recent_exam_at timestamptz,
  completed_count bigint,
  missed_count bigint,
  not_started_count bigint,
  retry_needed boolean,
  wrong_word_count integer,
  repeated_wrong_word_count integer,
  raw_points bigint,
  sort_at timestamptz,
  learning_source_labels text[],
  class_group_ids uuid[]
)
language sql
stable
security invoker
set search_path = ''
as $$
  select student.*
  from private.admin_student_directory_rows_v1(
    p_snapshot_at,
    p_wrong in ('wrong', 'repeated')
  ) as student
  where (select private.is_active_admin())
    and (
      p_query = ''
      or strpos(
        lower(concat_ws(
          ' ',
          student.display_name,
          student.school_name,
          student.grade_label,
          student.current_vocab_book_label,
          array_to_string(student.learning_source_labels, ' ')
        )),
        p_query
      ) > 0
    )
    and (p_school = '' or student.school_name = p_school)
    and (p_grade = '' or student.grade_label = p_grade)
    and (p_status = 'all' or student.student_status = p_status)
    and (
      p_class_group_id is null
      or p_class_group_id = any(student.class_group_ids)
    )
    and (
      p_wordbook = ''
      or student.current_vocab_book_label = p_wordbook
      or p_wordbook = any(student.learning_source_labels)
    )
    and (
      p_wrong = 'all'
      or (p_wrong = 'wrong' and student.wrong_word_count > 0)
      or (
        p_wrong = 'repeated'
        and student.repeated_wrong_word_count > 0
      )
      or (p_wrong = 'retry' and student.retry_needed)
    );
$$;

create function public.get_admin_student_directory_initial_v1(
  p_query text default '',
  p_school text default '',
  p_grade text default '',
  p_status text default 'all',
  p_class_group_id uuid default null,
  p_wordbook text default '',
  p_wrong text default 'all',
  p_snapshot_at timestamptz default null,
  p_limit integer default 11
)
returns table (
  snapshot_at timestamptz,
  total_count bigint,
  filter_options jsonb,
  items jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  normalized_school text := btrim(coalesce(p_school, ''));
  normalized_grade text := btrim(coalesce(p_grade, ''));
  normalized_wordbook text := btrim(coalesce(p_wordbook, ''));
  snapshot_value timestamptz := coalesce(
    p_snapshot_at,
    statement_timestamp()
  );
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null
    or p_status not in ('all', 'active', 'blocked')
    or p_wrong is null
    or p_wrong not in ('all', 'wrong', 'repeated', 'retry')
    or char_length(normalized_query) > 80
    or char_length(normalized_school) > 120
    or char_length(normalized_grade) > 40
    or char_length(normalized_wordbook) > 160
    or p_limit is null
    or p_limit not between 1 and 11
    or not isfinite(snapshot_value)
    or snapshot_value > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid student directory request'
      using errcode = '22023';
  end if;

  return query
  with filtered_rows as materialized (
    select student.*
    from private.admin_student_directory_filtered_rows_v1(
      snapshot_value,
      normalized_query,
      normalized_school,
      normalized_grade,
      p_status,
      p_class_group_id,
      normalized_wordbook,
      p_wrong
    ) as student
  ),
  page_rows as (
    select student.*
    from filtered_rows as student
    order by student.sort_at desc, student.student_id asc
    limit p_limit
  ),
  school_options as (
    select distinct student.school_name as value
    from public.students as student
    where student.deleted_at is null
      and student.school_name is not null
      and btrim(student.school_name) <> ''
  ),
  grade_options as (
    select distinct student.grade_label as value
    from public.students as student
    where student.deleted_at is null
      and student.grade_label is not null
      and btrim(student.grade_label) <> ''
  ),
  wordbook_options as (
    select distinct option.value
    from (
      select coalesce(
        catalog.display_name,
        dataset.title,
        student.current_vocab_book
      ) as value
      from public.students as student
      left join public.vocab_datasets as dataset
        on dataset.id = student.current_vocab_dataset_id
      left join public.vocab_dataset_catalog as catalog
        on catalog.dataset_id = student.current_vocab_dataset_id
      where student.deleted_at is null
      union all
      select source.display_label as value
      from public.student_learning_sources as source
      join public.students as student on student.id = source.student_id
      where source.active and student.deleted_at is null
    ) as option
    where option.value is not null and btrim(option.value) <> ''
  )
  select
    snapshot_value,
    (select count(*) from filtered_rows),
    jsonb_build_object(
      'schools', coalesce((
        select jsonb_agg(option.value order by option.value)
        from school_options as option
      ), '[]'::jsonb),
      'grades', coalesce((
        select jsonb_agg(option.value order by option.value)
        from grade_options as option
      ), '[]'::jsonb),
      'wordbooks', coalesce((
        select jsonb_agg(option.value order by option.value)
        from wordbook_options as option
      ), '[]'::jsonb),
      'classGroups', coalesce((
        select jsonb_agg(
          jsonb_build_object('id', class_group.id, 'name', class_group.name)
          order by class_group.name, class_group.id
        )
        from public.class_groups as class_group
        where class_group.active
      ), '[]'::jsonb)
    ),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'sortAt', page.sort_at,
          'studentId', page.student_id,
          'item', jsonb_build_object(
            'id', page.student_id,
            'displayName', page.display_name,
            'schoolName', page.school_name,
            'gradeLabel', page.grade_label,
            'status', page.student_status,
            'codeStatus', page.code_status,
            'currentVocabBook', page.current_vocab_book_label,
            'recentExamAt', page.recent_exam_at,
            'completedCount', page.completed_count,
            'missedCount', page.missed_count,
            'notStartedCount', page.not_started_count,
            'rawPoints', page.raw_points
          )
        )
        order by page.sort_at desc, page.student_id asc
      )
      from page_rows as page
    ), '[]'::jsonb);
end;
$$;

create function public.list_admin_student_directory_page_v1(
  p_query text,
  p_school text,
  p_grade text,
  p_status text,
  p_class_group_id uuid,
  p_wordbook text,
  p_wrong text,
  p_snapshot_at timestamptz,
  p_cursor_sort_at timestamptz,
  p_cursor_student_id uuid,
  p_limit integer default 11
)
returns table (
  cursor_sort_at timestamptz,
  cursor_student_id uuid,
  item jsonb
)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  normalized_query text := lower(btrim(coalesce(p_query, '')));
  normalized_school text := btrim(coalesce(p_school, ''));
  normalized_grade text := btrim(coalesce(p_grade, ''));
  normalized_wordbook text := btrim(coalesce(p_wordbook, ''));
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_status is null
    or p_status not in ('all', 'active', 'blocked')
    or p_wrong is null
    or p_wrong not in ('all', 'wrong', 'repeated', 'retry')
    or char_length(normalized_query) > 80
    or char_length(normalized_school) > 120
    or char_length(normalized_grade) > 40
    or char_length(normalized_wordbook) > 160
    or p_snapshot_at is null
    or p_cursor_sort_at is null
    or p_cursor_student_id is null
    or p_limit is null
    or p_limit not between 1 and 11
    or not isfinite(p_snapshot_at)
    or not isfinite(p_cursor_sort_at)
    or p_cursor_sort_at > p_snapshot_at
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid student directory cursor'
      using errcode = '22023';
  end if;

  return query
  select
    student.sort_at,
    student.student_id,
    jsonb_build_object(
      'id', student.student_id,
      'displayName', student.display_name,
      'schoolName', student.school_name,
      'gradeLabel', student.grade_label,
      'status', student.student_status,
      'codeStatus', student.code_status,
      'currentVocabBook', student.current_vocab_book_label,
      'recentExamAt', student.recent_exam_at,
      'completedCount', student.completed_count,
      'missedCount', student.missed_count,
      'notStartedCount', student.not_started_count,
      'rawPoints', student.raw_points
    )
  from private.admin_student_directory_filtered_rows_v1(
    p_snapshot_at,
    normalized_query,
    normalized_school,
    normalized_grade,
    p_status,
    p_class_group_id,
    normalized_wordbook,
    p_wrong
  ) as student
  where student.sort_at < p_cursor_sort_at
    or (
      student.sort_at = p_cursor_sort_at
      and student.student_id > p_cursor_student_id
    )
  order by student.sort_at desc, student.student_id asc
  limit p_limit;
end;
$$;

create function public.get_admin_student_detail_initial_v1(
  p_student_id uuid,
  p_snapshot_at timestamptz default null
)
returns jsonb
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
  result jsonb;
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or not isfinite(snapshot_value)
    or snapshot_value > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid student detail request'
      using errcode = '22023';
  end if;

  with selected_student as materialized (
    select
      student.id,
      student.display_name,
      student.school_name,
      student.grade_label,
      student.status::text as student_status,
      student.current_vocab_dataset_id,
      student.current_vocab_book,
      student.reading_curriculum_stage,
      student.reading_context_sync_status,
      student.created_at,
      case
        when code.student_id is null then 'missing'
        when code.status = 'active'
          and code.expires_at is not null
          and code.expires_at <= snapshot_value then 'expired'
        else code.status::text
      end as code_status,
      coalesce(
        catalog.display_name,
        dataset.title,
        student.current_vocab_book
      ) as current_vocab_book_label,
      coalesce(point.total_points, 0) as raw_points
    from public.students as student
    left join public.student_codes as code on code.student_id = student.id
    left join public.vocab_datasets as dataset
      on dataset.id = student.current_vocab_dataset_id
    left join public.vocab_dataset_catalog as catalog
      on catalog.dataset_id = student.current_vocab_dataset_id
    left join public.student_point_totals as point
      on point.student_id = student.id
    where student.id = p_student_id
      and student.deleted_at is null
      and student.created_at <= snapshot_value
  ),
  history_rows as materialized (
    select history.*
    from private.admin_history_read_rows_v1(
      snapshot_value,
      null,
      null,
      p_student_id,
      'detail'
    ) as history
    where not history.is_hidden
      and history.detail_item is not null
  ),
  history_page_rows as (
    select history.*
    from history_rows as history
    order by history.effective_at desc, history.entry_key collate "C" asc
    limit 11
  ),
  vocab_history_ranked as (
    select
      history.detail_item ->> 'datasetId' as dataset_id,
      history.attempt_id,
      history.effective_at,
      history.detail_item,
      row_number() over (
        partition by history.detail_item ->> 'datasetId'
        order by
          history.effective_at desc,
          history.entry_key collate "C" asc
      ) as recent_rank
    from history_rows as history
    where history.attempt_id is not null
      and history.detail_item ->> 'assignmentPurpose' <> 'review'
      and history.detail_item ->> 'status' in (
        'in_progress',
        'completed',
        'expired'
      )
  ),
  vocab_history_counts as (
    select
      history.dataset_id,
      max(history.effective_at) as latest_at,
      count(distinct history.attempt_id)::integer as attempt_count
    from vocab_history_ranked as history
    group by history.dataset_id
  ),
  vocab_history as (
    select
      history.dataset_id,
      counts.latest_at,
      counts.attempt_count,
      history.detail_item as latest_item
    from vocab_history_ranked as history
    join vocab_history_counts as counts
      on counts.dataset_id = history.dataset_id
    where history.recent_rank = 1
  ),
  wrong_summary as (
    select wrong.*
    from private.admin_student_current_wrong_counts_v1(
      array[p_student_id]
    ) as wrong
  )
  select jsonb_build_object(
    'snapshotAt', snapshot_value,
    'student', jsonb_build_object(
      'id', student.id,
      'displayName', student.display_name,
      'schoolName', student.school_name,
      'gradeLabel', student.grade_label,
      'status', student.student_status,
      'codeStatus', student.code_status,
      'currentVocabDatasetId', student.current_vocab_dataset_id,
      'currentVocabBook', student.current_vocab_book_label,
      'readingCurriculumStage', student.reading_curriculum_stage,
      'readingContextSyncStatus', student.reading_context_sync_status,
      'rawPoints', student.raw_points,
      'createdAt', student.created_at
    ),
    'learningSources', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', source.id,
          'studentId', source.student_id,
          'sourceType', source.source_type,
          'vocabDatasetId', source.vocab_dataset_id,
          'displayLabel', coalesce(
            source_catalog.display_name,
            source_dataset.title,
            source.display_label
          ),
          'rangeMetadata', source.range_metadata,
          'sortOrder', source.sort_order
        )
        order by source.sort_order, source.created_at, source.id
      )
      from public.student_learning_sources as source
      left join public.vocab_datasets as source_dataset
        on source_dataset.id = source.vocab_dataset_id
      left join public.vocab_dataset_catalog as source_catalog
        on source_catalog.dataset_id = source.vocab_dataset_id
      where source.student_id = student.id
        and source.active
    ), '[]'::jsonb),
    'wrongSummary', jsonb_build_object(
      'wrongWordCount', coalesce((
        select wrong.wrong_word_count from wrong_summary as wrong
      ), 0),
      'repeatedWrongWordCount', coalesce((
        select wrong.repeated_wrong_word_count from wrong_summary as wrong
      ), 0)
    ),
    'history', jsonb_build_object(
      'totalCount', (select count(*) from history_rows),
      'items', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'effectiveAt', page.effective_at,
            'entryKey', page.entry_key,
            'item', page.detail_item
          )
          order by page.effective_at desc, page.entry_key collate "C" asc
        )
        from history_page_rows as page
      ), '[]'::jsonb)
    ),
    'vocabBookHistory', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'studentId', student.id,
          'datasetId', history.dataset_id,
          'datasetTitle', history.latest_item ->> 'datasetTitle',
          'assignmentPurpose',
            history.latest_item ->> 'assignmentPurpose',
          'unitLabels', coalesce(
            history.latest_item -> 'unitLabels',
            '[]'::jsonb
          ),
          'unitSortIndexes', history.latest_item -> 'unitSortIndexes',
          'primaryUnitLabels', coalesce(
            history.latest_item -> 'primaryUnitLabels',
            '[]'::jsonb
          ),
          'primaryUnitSortIndexes',
            history.latest_item -> 'primaryUnitSortIndexes',
          'lastActivityAt', history.latest_at,
          'lastStatus', history.latest_item ->> 'status',
          'lastPassed', case
            when history.latest_item ->> 'status' <> 'completed' then false
            when coalesce(
              history.latest_item ->> 'finalScore',
              history.latest_item ->> 'initialScore'
            ) is not null then coalesce(
              (history.latest_item ->> 'finalScore')::numeric,
              (history.latest_item ->> 'initialScore')::numeric
            ) >= (history.latest_item ->> 'passingScore')::numeric
            else (history.latest_item ->> 'passed')::boolean is true
          end,
          'attemptCount', history.attempt_count
        )
        order by history.latest_at desc, history.dataset_id
      )
      from vocab_history as history
    ), '[]'::jsonb)
  )
  into result
  from selected_student as student;

  return result;
end;
$$;

create function private.admin_student_history_filtered_rows_v1(
  p_student_id uuid,
  p_purpose text,
  p_section text,
  p_since timestamptz,
  p_snapshot_at timestamptz
)
returns table (
  effective_at timestamptz,
  entry_key text,
  item jsonb
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    history.effective_at,
    history.entry_key,
    history.list_item
  from private.admin_history_read_rows_v1(
    p_snapshot_at,
    null,
    null,
    p_student_id,
    'list'
  ) as history
  where (select private.is_active_admin())
    and not history.is_hidden
    and history.list_item is not null
    and exists (
      select 1
      from public.students as student
      where student.id = p_student_id
        and student.deleted_at is null
        and student.created_at <= p_snapshot_at
    )
    and (
      p_purpose = 'all'
      or history.list_item ->> 'assignmentPurpose' = p_purpose
    )
    and (p_section = 'all' or history.activity_section = p_section)
    and (p_since is null or history.effective_at >= p_since);
$$;

create function public.get_admin_student_history_initial_v1(
  p_student_id uuid,
  p_purpose text default 'all',
  p_section text default 'all',
  p_since timestamptz default null,
  p_snapshot_at timestamptz default null,
  p_limit integer default 11
)
returns table (
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
  snapshot_value timestamptz := coalesce(
    p_snapshot_at,
    statement_timestamp()
  );
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_purpose is null
    or p_purpose not in ('all', 'regular', 'mixed', 'review')
    or p_section is null
    or p_section not in (
      'all',
      'open',
      'needs_attention',
      'completed',
      'archived'
    )
    or p_limit is null
    or p_limit not between 1 and 11
    or not isfinite(snapshot_value)
    or snapshot_value > statement_timestamp() + interval '5 minutes'
    or (
      p_since is not null
      and (not isfinite(p_since) or p_since > snapshot_value)
    )
  then
    raise exception 'invalid student history request'
      using errcode = '22023';
  end if;

  return query
  with filtered_rows as materialized (
    select history.*
    from private.admin_student_history_filtered_rows_v1(
      p_student_id,
      p_purpose,
      p_section,
      p_since,
      snapshot_value
    ) as history
  ),
  page_rows as (
    select history.*
    from filtered_rows as history
    order by history.effective_at desc, history.entry_key collate "C" asc
    limit p_limit
  )
  select
    snapshot_value,
    (select count(*) from filtered_rows),
    coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'effectiveAt', page.effective_at,
          'entryKey', page.entry_key,
          'item', page.item
        )
        order by page.effective_at desc, page.entry_key collate "C" asc
      )
      from page_rows as page
    ), '[]'::jsonb);
end;
$$;

create function public.list_admin_student_history_page_v1(
  p_student_id uuid,
  p_purpose text,
  p_section text,
  p_since timestamptz,
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
begin
  if not (select private.is_active_admin()) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_student_id is null
    or p_purpose is null
    or p_purpose not in ('all', 'regular', 'mixed', 'review')
    or p_section is null
    or p_section not in (
      'all',
      'open',
      'needs_attention',
      'completed',
      'archived'
    )
    or p_snapshot_at is null
    or not isfinite(p_snapshot_at)
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
    or (
      p_since is not null
      and (not isfinite(p_since) or p_since > p_snapshot_at)
    )
    or p_cursor_effective_at is null
    or not isfinite(p_cursor_effective_at)
    or p_cursor_effective_at > p_snapshot_at
    or nullif(btrim(p_cursor_entry_key), '') is null
    or char_length(p_cursor_entry_key) > 180
    or p_limit is null
    or p_limit not between 1 and 11
  then
    raise exception 'invalid student history cursor'
      using errcode = '22023';
  end if;

  return query
  select
    history.effective_at,
    history.entry_key,
    history.item
  from private.admin_student_history_filtered_rows_v1(
    p_student_id,
    p_purpose,
    p_section,
    p_since,
    p_snapshot_at
  ) as history
  where history.effective_at < p_cursor_effective_at
    or (
      history.effective_at = p_cursor_effective_at
      and history.entry_key collate "C" > p_cursor_entry_key collate "C"
    )
  order by history.effective_at desc, history.entry_key collate "C" asc
  limit p_limit;
end;
$$;

revoke all on function private.admin_student_current_wrong_counts_v1(
  uuid[]
) from public, anon, authenticated, service_role;
grant execute on function private.admin_student_current_wrong_counts_v1(
  uuid[]
) to authenticated;

revoke all on function private.admin_student_directory_rows_v1(
  timestamptz,
  boolean
) from public, anon, authenticated, service_role;
grant execute on function private.admin_student_directory_rows_v1(
  timestamptz,
  boolean
) to authenticated;

revoke all on function private.admin_student_directory_filtered_rows_v1(
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text
) from public, anon, authenticated, service_role;
grant execute on function private.admin_student_directory_filtered_rows_v1(
  timestamptz,
  text,
  text,
  text,
  text,
  uuid,
  text,
  text
) to authenticated;

revoke all on function public.get_admin_student_directory_initial_v1(
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_student_directory_initial_v1(
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  integer
) to authenticated;

revoke all on function public.list_admin_student_directory_page_v1(
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_admin_student_directory_page_v1(
  text,
  text,
  text,
  text,
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  uuid,
  integer
) to authenticated;

revoke all on function public.get_admin_student_detail_initial_v1(
  uuid,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_student_detail_initial_v1(
  uuid,
  timestamptz
) to authenticated;

revoke all on function private.admin_student_history_filtered_rows_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) from public, anon, authenticated, service_role;
grant execute on function private.admin_student_history_filtered_rows_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz
) to authenticated;

revoke all on function public.get_admin_student_history_initial_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.get_admin_student_history_initial_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  integer
) to authenticated;

revoke all on function public.list_admin_student_history_page_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  integer
) from public, anon, authenticated, service_role;
grant execute on function public.list_admin_student_history_page_v1(
  uuid,
  text,
  text,
  timestamptz,
  timestamptz,
  timestamptz,
  text,
  integer
) to authenticated;

notify pgrst, 'reload schema';

commit;
