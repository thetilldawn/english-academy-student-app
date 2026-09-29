-- Additional read-only paging; the v2 functions remain available to older deployments.
create function private.student_dashboard_ordered_rows_v3(p_student_id uuid, p_snapshot_at timestamptz)
returns table (assignment_id uuid, effective_at timestamptz, dashboard_section text, item jsonb,
  sort_bucket integer, sort_at timestamptz, secondary_sort_at timestamptz)
language sql stable security invoker set search_path = '' as $$
  select r.*,
    case when r.dashboard_section = 'open' then
      case when r.item->>'lastStatus' = 'in_progress' then 0
        when r.item->>'availableUntil' is null then 1 else 2 end else 0 end,
    case r.dashboard_section
      when 'scheduled' then case when r.item->'release'->>'state' = 'waiting_initial' then 'infinity'::timestamptz
        else coalesce((r.item->'release'->>'opensAt')::timestamptz, (r.item->>'availableFrom')::timestamptz, 'infinity'::timestamptz) end
      when 'open' then coalesce(
        case when r.item->>'lastStatus' = 'in_progress' then nullif(r.item->>'lastDeadlineAt','infinity')::timestamptz end,
        (r.item->>'availableUntil')::timestamptz, 'infinity'::timestamptz)
      else 'infinity'::timestamptz end,
    case when r.dashboard_section = 'scheduled' then coalesce((r.item->>'availableUntil')::timestamptz, '-infinity'::timestamptz)
      else '-infinity'::timestamptz end
  from private.student_dashboard_read_rows_v2(p_student_id,p_snapshot_at) r;
$$;

create function public.get_student_dashboard_initial_v3(p_student_id uuid, p_snapshot_at timestamptz default null)
returns table (snapshot_at timestamptz, current_items jsonb, completed_items jsonb,
  open_count bigint, scheduled_count bigint, needs_attention_count bigint, completed_count bigint, deadline_closed_count bigint)
language plpgsql stable security invoker set search_path = '' as $$
declare snapshot_value timestamptz := coalesce(p_snapshot_at,statement_timestamp());
begin
  if p_student_id is null or not isfinite(snapshot_value) or snapshot_value > statement_timestamp()+interval '5 minutes' then
    raise exception using errcode='22023',message='invalid student dashboard snapshot';
  end if;
  return query
  with rows as materialized (select * from private.student_dashboard_ordered_rows_v3(p_student_id,snapshot_value)),
  ranked as (
    select r.*, row_number() over(partition by r.dashboard_section
      order by r.sort_bucket,r.sort_at,r.secondary_sort_at,r.effective_at desc,r.assignment_id) as page_rank from rows r
  )
  select snapshot_value,
    coalesce((select jsonb_agg(jsonb_build_object('dashboardSection',r.dashboard_section,'assignmentId',r.assignment_id,
      'effectiveAt',r.effective_at,'sortBucket',r.sort_bucket,'sortAt',r.sort_at,'secondarySortAt',r.secondary_sort_at,'item',r.item)
      order by r.dashboard_section,r.page_rank) from ranked r where r.dashboard_section <> 'completed' and r.page_rank <= 11),'[]'::jsonb),
    coalesce((select jsonb_agg(jsonb_build_object('assignmentId',r.assignment_id,'effectiveAt',r.effective_at,'item',r.item)
      order by r.page_rank) from ranked r where r.dashboard_section='completed' and r.page_rank <= 11),'[]'::jsonb),
    (select count(*) from rows r where r.dashboard_section='open'),
    (select count(*) from rows r where r.dashboard_section='scheduled'),
    (select count(*) from rows r where r.dashboard_section='needs_attention'),
    (select count(*) from rows r where r.dashboard_section='completed'),
    (select count(*) from rows r where r.dashboard_section='deadline_closed');
end;
$$;

create function public.list_student_dashboard_section_page_v3(p_student_id uuid, p_snapshot_at timestamptz, p_section text,
  p_cursor_bucket integer, p_cursor_sort_at timestamptz, p_cursor_secondary_sort_at timestamptz,
  p_cursor_effective_at timestamptz, p_cursor_assignment_id uuid)
returns table (assignment_id uuid, effective_at timestamptz, dashboard_section text, item jsonb,
  sort_bucket integer, sort_at timestamptz, secondary_sort_at timestamptz)
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_student_id is null or p_snapshot_at is null or not isfinite(p_snapshot_at)
    or p_snapshot_at > statement_timestamp()+interval '5 minutes'
    or p_section is null or p_section not in ('open','scheduled','needs_attention','deadline_closed')
    or p_cursor_bucket is null or p_cursor_bucket not between 0 and 2
    or p_cursor_sort_at is null or p_cursor_secondary_sort_at is null
    or p_cursor_effective_at is null or not isfinite(p_cursor_effective_at) or p_cursor_effective_at > p_snapshot_at
    or p_cursor_assignment_id is null then
    raise exception using errcode='22023',message='invalid student dashboard section cursor';
  end if;
  return query select r.*
  from private.student_dashboard_ordered_rows_v3(p_student_id,p_snapshot_at) r
  where r.dashboard_section=p_section and
    (r.sort_bucket,r.sort_at,r.secondary_sort_at,-extract(epoch from r.effective_at),r.assignment_id) >
    (p_cursor_bucket,p_cursor_sort_at,p_cursor_secondary_sort_at,-extract(epoch from p_cursor_effective_at),p_cursor_assignment_id)
  order by r.sort_bucket,r.sort_at,r.secondary_sort_at,r.effective_at desc,r.assignment_id
  limit 11;
end;
$$;

revoke all on function private.student_dashboard_ordered_rows_v3(uuid,timestamptz) from public,anon,authenticated;
grant execute on function private.student_dashboard_ordered_rows_v3(uuid,timestamptz) to service_role;
revoke all on function public.get_student_dashboard_initial_v3(uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.get_student_dashboard_initial_v3(uuid,timestamptz) to service_role;
revoke all on function public.list_student_dashboard_section_page_v3(uuid,timestamptz,text,integer,timestamptz,timestamptz,timestamptz,uuid) from public,anon,authenticated;
grant execute on function public.list_student_dashboard_section_page_v3(uuid,timestamptz,text,integer,timestamptz,timestamptz,timestamptz,uuid) to service_role;
