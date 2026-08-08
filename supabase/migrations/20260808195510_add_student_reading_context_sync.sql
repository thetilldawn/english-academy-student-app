begin;

alter table public.students
  add column reading_curriculum_stage text not null default 'undecided'
    check (reading_curriculum_stage in (
      'undecided',
      'yeongminjeongeum_foundation',
      'yeongminjeongeum_foundation_advanced',
      'yeongminjeongeum_foundation_complete',
      'yeongminjeongeum_basic'
    )),
  add column reading_context_drive_file_id text check (
    reading_context_drive_file_id is null
    or char_length(reading_context_drive_file_id) between 10 and 200
  ),
  add column reading_context_content_sha256 text check (
    reading_context_content_sha256 is null
    or reading_context_content_sha256 ~ '^[A-F0-9]{64}$'
  ),
  add column reading_context_sync_status text not null default 'not_synced'
    check (reading_context_sync_status in (
      'not_synced',
      'not_configured',
      'synced',
      'failed'
    )),
  add column reading_context_sync_revision integer not null default 0
    check (reading_context_sync_revision >= 0),
  add column reading_context_latest_request_id uuid
    references public.worksheet_requests(id) on delete set null,
  add column reading_context_pending_sha256 text check (
    reading_context_pending_sha256 is null
    or reading_context_pending_sha256 ~ '^[A-F0-9]{64}$'
  ),
  add column reading_context_sync_started_at timestamptz,
  add column reading_context_synced_at timestamptz,
  add column reading_context_sync_error_code text check (
    reading_context_sync_error_code is null
    or char_length(reading_context_sync_error_code) between 1 and 80
  );

comment on column public.students.reading_curriculum_stage is
  'Teacher-maintained reading curriculum scope used only for manual worksheet context sync.';
comment on column public.students.reading_context_drive_file_id is
  'Opaque Google Drive file ID for the latest student-reading-context JSON.';

create unique index students_reading_context_drive_file_id_idx
  on public.students(reading_context_drive_file_id)
  where reading_context_drive_file_id is not null;

create index students_reading_context_latest_request_idx
  on public.students(reading_context_latest_request_id)
  where reading_context_latest_request_id is not null;

commit;
