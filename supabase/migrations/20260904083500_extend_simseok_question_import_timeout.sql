begin;

-- The six-package import performs exact hash and occurrence binding checks in one
-- transaction. Keep the exemption on this Preview-only administrative function;
-- do not relax the authenticated or database-wide timeout.
alter function public.import_simseok_sem2_combined_question_preview_bundle_v2(jsonb)
  set statement_timeout = '60s';

notify pgrst, 'reload config';

commit;
