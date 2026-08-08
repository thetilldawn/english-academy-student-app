begin;

-- The exam-use release and 601 eligible vocabulary rows belong to
-- g12-long-reading-2025-exam-scope-v1.  The preceding catalog backfill
-- accidentally exposed exam-ready-v1, which has no active exam-use rows.
update public.vocab_dataset_catalog as catalog
set
  is_assignable = case dataset.dataset_key
    when 'g12-long-reading-2025-exam-scope-v1' then true
    else false
  end,
  metadata = catalog.metadata || jsonb_build_object(
    'reviewRequired',
    dataset.dataset_key <> 'g12-long-reading-2025-exam-scope-v1'
  )
from public.vocab_datasets as dataset
where dataset.id = catalog.dataset_id
  and dataset.dataset_key in (
    'g12-long-reading-2025-exam-ready-v1',
    'g12-long-reading-2025-exam-scope-v1'
  );

commit;
