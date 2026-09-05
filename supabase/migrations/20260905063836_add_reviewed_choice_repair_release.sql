begin;

-- Display and audio availability are independent: a missing exact recording
-- must not hide a valid, source-bound Hangul/stress display.
alter table public.vocab_entry_pronunciations add column display_snapshot jsonb
  check (display_snapshot is null or jsonb_typeof(display_snapshot)='object');

-- Corrections are new, separately authorized releases. Never mutate the
-- original approval hashes or the snapshots of students already taking a test.
create table private.reviewed_choice_repair_releases_v1 (
  release_id uuid primary key references word_index.app_canonical_question_preview_release(release_id),
  base_release_id uuid not null references word_index.app_canonical_question_preview_release(release_id),
  dataset_key text not null check (dataset_key = 'simseok-g10-sem2-mid-adjective-500-v1'),
  package_file_sha256 text not null check (package_file_sha256 ~ '^[0-9a-f]{64}$'),
  review_ledger_sha256 text not null check (review_ledger_sha256 ~ '^[0-9a-f]{64}$'),
  source_pdf_sha256 text not null check (source_pdf_sha256 = 'a8898b3cd9993aae03c2321d23a7281ae041c1ee680a6b768730c28cd94e588c'),
  approval_id text not null check (approval_id = 'DEPLOY-20260905-01-choice-repair'),
  status text not null check (status in ('active','retired')),
  created_at timestamptz not null default clock_timestamp(),
  check (release_id <> base_release_id)
);
alter table private.reviewed_choice_repair_releases_v1 enable row level security;
revoke all on private.reviewed_choice_repair_releases_v1 from public,anon,authenticated,service_role;

create or replace function private.canonical_question_release_runtime_allowed_v1(p_release_id uuid)
returns boolean language sql stable security definer set search_path='' as $$
  select coalesce(
    private.request_supabase_project_ref_v1()='wojxpruvbjzbhrpmsbuy'
    or (private.request_supabase_project_ref_v1()='xdxhswjgksukjmpbzqgz' and (
      exists(
        select 1 from private.simseok_production_receipts_v1 r
        join private.simseok_production_approvals_v1 a using(dataset_key)
        join word_index.app_canonical_question_preview_release q on q.release_id=r.question_release_id
        join word_index.app_exam_use_release e on e.release_id=r.exam_release_id
        where r.status='active' and r.question_release_id=p_release_id
          and q.dataset_id=r.dataset_id and e.dataset_id=r.dataset_id
          and q.exam_use_release_id=e.release_id
          and q.package_file_sha256=a.question_file_sha256
          and e.package_version=a.exam_package_version
      ) or exists(
        select 1 from private.reviewed_choice_repair_releases_v1 repair
        join private.simseok_production_receipts_v1 r on r.dataset_key=repair.dataset_key
          and r.question_release_id=repair.base_release_id
        join private.simseok_production_approvals_v1 a on a.dataset_key=r.dataset_key
        join word_index.app_canonical_question_preview_release original on original.release_id=repair.base_release_id
        join word_index.app_canonical_question_preview_release revised on revised.release_id=repair.release_id
        join word_index.app_exam_use_release e on e.release_id=r.exam_release_id
        where repair.release_id=p_release_id and repair.status='active' and r.status='active'
          and original.package_file_sha256=a.question_file_sha256
          and original.dataset_id=r.dataset_id and original.exam_use_release_id=e.release_id
          and revised.dataset_id=r.dataset_id and revised.exam_use_release_id=e.release_id
          and revised.package_file_sha256=repair.package_file_sha256
          and revised.independent_review_ledger_sha256=repair.review_ledger_sha256
          and e.dataset_id=r.dataset_id and e.package_version=a.exam_package_version
      )
    )),false);
$$;
revoke all on function private.canonical_question_release_runtime_allowed_v1(uuid)
  from public,anon,authenticated,service_role;

-- Replaying the original six-set activation must not reactivate the superseded
-- bank (or collide with the one-active-release index). Keep the reviewed bank.
do $patch$
declare
  definition text := pg_get_functiondef('public.activate_approved_simseok_production_v1()'::regprocedure);
  old_clause text := 'and status<>''active'';' || chr(10) || '  update private.simseok_production_receipts_v1';
  new_clause text := $clause$and status<>'active'
      and not exists (
        select 1 from private.reviewed_choice_repair_releases_v1 repair
        join word_index.app_canonical_question_preview_release revised on revised.release_id=repair.release_id
        where repair.base_release_id=word_index.app_canonical_question_preview_release.release_id
          and repair.status='active' and revised.status='active'
          and private.canonical_question_release_runtime_allowed_v1(revised.release_id)
      );
  update private.simseok_production_receipts_v1$clause$;
begin
  if strpos(definition, old_clause)=0 then raise exception 'production_activation_patch_target_missing'; end if;
  execute replace(definition,old_clause,new_clause);
end;
$patch$;

commit;
