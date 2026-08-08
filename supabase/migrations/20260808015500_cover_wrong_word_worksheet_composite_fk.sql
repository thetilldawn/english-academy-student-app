begin;

create index worksheet_request_items_entry_dataset_idx
  on public.worksheet_request_items(vocab_entry_id, dataset_id);

commit;
