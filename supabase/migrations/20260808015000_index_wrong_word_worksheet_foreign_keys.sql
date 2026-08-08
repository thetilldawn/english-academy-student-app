begin;

create index worksheet_requests_requested_by_idx
  on public.worksheet_requests(requested_by);

create index worksheet_request_items_wrong_event_idx
  on public.worksheet_request_items(primary_wrong_event_id);

create index worksheet_request_items_dataset_entry_idx
  on public.worksheet_request_items(dataset_id, vocab_entry_id);

commit;
