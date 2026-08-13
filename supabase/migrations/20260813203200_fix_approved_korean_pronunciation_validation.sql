create or replace function private.valid_korean_pronunciation_segments_v1(
  p_display text,
  p_segments jsonb
)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    jsonb_typeof(p_segments) = 'array'
    and jsonb_array_length(p_segments) > 0
    and not exists (
      select 1
      from jsonb_array_elements(p_segments) as segment(value)
      where jsonb_typeof(segment.value) <> 'object'
        or coalesce(segment.value ->> 'text', '') = ''
        or coalesce(segment.value ->> 'stress', '') not in (
          'none',
          'secondary',
          'primary'
        )
    )
    and (
      select count(*)
      from jsonb_array_elements(p_segments) as segment(value)
      where segment.value ->> 'stress' = 'primary'
    ) = 1
    and (
      select string_agg(segment.value ->> 'text', '' order by segment.ordinality)
      from jsonb_array_elements(p_segments)
        with ordinality as segment(value, ordinality)
    ) = p_display;
$$;
