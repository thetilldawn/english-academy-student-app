begin;

update public.vocab_dataset_catalog as catalog
set
  is_assignable = case dataset.dataset_key
    when 'g12-long-reading-2025-exam-ready-v1' then true
    else false
  end,
  metadata = catalog.metadata || jsonb_build_object(
    'reviewRequired',
    dataset.dataset_key <> 'g12-long-reading-2025-exam-ready-v1'
  )
from public.vocab_datasets as dataset
where dataset.id = catalog.dataset_id
  and dataset.dataset_key in (
    'g12-long-reading-2025-exam-ready-v1',
    'g12-long-reading-2025-exam-scope-v1'
  );

commit;
