begin;

create index vocab_pronunciation_identity_request_fk_v2
  on public.vocab_pronunciation_identities_v2(request_sha256);

create index vocab_pronunciation_binding_release_dataset_fk_v2
  on public.vocab_entry_pronunciation_bindings_v2(release_id, dataset_id);

commit;
