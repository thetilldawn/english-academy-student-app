create function private.valid_korean_pronunciation_segments_v1(
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
        or segment.value ->> 'stress' not in (
          'none',
          'secondary',
          'primary'
        )
    )
    and (
      select count(*)
      from jsonb_array_elements(p_segments) as segment(value)
      where segment.value ->> 'stress' = 'primary'
    ) >= 1
    and (
      select string_agg(segment.value ->> 'text', '' order by segment.ordinality)
      from jsonb_array_elements(p_segments)
        with ordinality as segment(value, ordinality)
    ) = p_display;
$$;

create table public.vocab_approved_korean_pronunciations (
  dictionary_id text not null check (
    dictionary_id ~ '^(word|root_affix|expression):[a-z0-9][a-z0-9._''’-]*$'
  ),
  pronunciation_variant_id text not null check (
    char_length(trim(pronunciation_variant_id)) between 1 and 160
  ),
  display_pronunciation_ko text not null check (
    char_length(trim(display_pronunciation_ko)) between 1 and 160
  ),
  segments jsonb not null,
  review_status text not null check (review_status = 'approved'),
  source_content_sha256 text not null check (
    source_content_sha256 ~ '^[0-9a-f]{64}$'
  ),
  source_review_run_id text not null check (
    char_length(trim(source_review_run_id)) between 1 and 200
  ),
  imported_at timestamptz not null default now(),
  primary key (dictionary_id, pronunciation_variant_id),
  constraint vocab_approved_korean_pronunciations_segments_check check (
    private.valid_korean_pronunciation_segments_v1(
      display_pronunciation_ko,
      segments
    )
  )
);

alter table public.vocab_approved_korean_pronunciations
  enable row level security;

revoke all on function private.valid_korean_pronunciation_segments_v1(
  text,
  jsonb
) from public, anon, authenticated;
grant execute on function private.valid_korean_pronunciation_segments_v1(
  text,
  jsonb
) to service_role;

revoke all on table public.vocab_approved_korean_pronunciations
  from public, anon, authenticated;
grant select on table public.vocab_approved_korean_pronunciations
  to service_role;

insert into public.vocab_approved_korean_pronunciations (
  dictionary_id,
  pronunciation_variant_id,
  display_pronunciation_ko,
  segments,
  review_status,
  source_content_sha256,
  source_review_run_id
)
values
  (
    'word:inevitable',
    'mw:96341e1884b6474e4bee',
    '이네버터벌',
    '[{"text":"이","stress":"none"},{"text":"네","stress":"primary"},{"text":"버","stress":"none"},{"text":"터","stress":"none"},{"text":"벌","stress":"none"}]'::jsonb,
    'approved',
    '3303a46ebf7104965cbdc651394eb973538b7cee2f79a6b5d6843fc2ad0bbfd7',
    'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
  ),
  (
    'word:loss',
    'mw:165d945bf54ea03b7ba5',
    '로스',
    '[{"text":"로스","stress":"primary"}]'::jsonb,
    'approved',
    '87370a3ae789f8704c4ec2e7eafb7c46840fac786ad7aad38dab1c0faa7a1091',
    'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
  ),
  (
    'word:inspire',
    'mw:817aa8db8ea99d67d2dc',
    '인스파이어',
    '[{"text":"인","stress":"none"},{"text":"스파이","stress":"primary"},{"text":"어","stress":"none"}]'::jsonb,
    'approved',
    '6da6f25382229a29c557fd960184421838afebae68149abcf2bb4607e4760816',
    'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
  ),
  (
    'word:creative',
    'mw:29a247ba80d4f15f8e78',
    '크리에이티브',
    '[{"text":"크리","stress":"none"},{"text":"에이","stress":"primary"},{"text":"티브","stress":"none"}]'::jsonb,
    'approved',
    'dc0f26132afbb60adc39dc444d30a030a09e4cd0d8a7dfe69144b99694a2c429',
    'g12-2025-pilot4-v2-final-review-a-20260807+review-b'
  );
