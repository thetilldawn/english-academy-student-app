begin;

create function public.list_admin_assignment_directory_selection_v1(
  p_query text default '',
  p_school text default '',
  p_grade text default '',
  p_status text default 'active',
  p_class_group_id uuid default null,
  p_wordbook text default '',
  p_wrong text default 'all',
  p_snapshot_at timestamptz default null
)
returns table (
  student_id uuid,
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
    or not isfinite(p_snapshot_at)
    or p_snapshot_at > statement_timestamp() + interval '5 minutes'
  then
    raise exception 'invalid assignment directory selection request'
      using errcode = '22023';
  end if;

  return query
  select
    student.student_id,
    jsonb_build_object(
      'id', student.student_id,
      'displayName', student.display_name,
      'schoolName', student.school_name,
      'gradeLabel', student.grade_label,
      'currentVocabBook', student.current_vocab_book_label
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
  where student.student_status = 'active'
  order by student.sort_at desc, student.student_id asc
  limit 211;
end;
$$;

revoke all on function public.list_admin_assignment_directory_selection_v1(
  text, text, text, text, uuid, text, text, timestamptz
) from public, anon, authenticated, service_role;

grant execute on function public.list_admin_assignment_directory_selection_v1(
  text, text, text, text, uuid, text, text, timestamptz
) to authenticated;

notify pgrst, 'reload schema';

commit;
