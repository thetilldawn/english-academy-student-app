-- 실제 학생·관리자·교재 원본은 seed에 넣지 않는다.
-- 아래 두 행은 데이터셋 준비상태만 표시하며 어휘 본문은 포함하지 않는다.

insert into public.vocab_datasets (
  dataset_key,
  title,
  edition,
  source_label,
  source_sha256,
  row_count,
  status,
  is_active,
  metadata
)
values
  (
    'ability-voca-etymology-2025',
    '능률 VOCA 어원편 고등',
    '2025개정',
    '내 노트북/[2025] 능률VOCA 어원편/능률VOCA 어원편 고등 (2025개정)_어휘리스트.xlsx',
    '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133',
    3001,
    'pending_review',
    false,
    jsonb_build_object(
      'candidate_rows', 3001,
      'candidate_empty_cells', 0,
      'unique_headwords', 2820,
      'duplicate_headword_groups', 163,
      'repeated_headword_rows', 181,
      'ambiguous_meaning_groups', 16,
      'source_sheet', '어휘리스트_의미축소',
      'laptop_latest_sha_verified', true,
      'review_required', true
    )
  ),
  (
    'required-adjectives-500',
    '필수형용사 500',
    '심석고1 2026 2학기',
    '구조화 검수본 미제공',
    '81C7FFE64A6B154767612E79DD3D85C93621197AB7DF1F76B553D9BAD74AF23B',
    0,
    'pending_review',
    false,
    jsonb_build_object(
      'expected_rows', 500,
      'structured_source_available', false,
      'review_required', true
    )
  )
on conflict (dataset_key) do nothing;
