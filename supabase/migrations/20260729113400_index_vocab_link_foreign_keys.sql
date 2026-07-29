create index vocab_entry_quiz_eligibility_entry_dataset_idx
  on public.vocab_entry_quiz_eligibility(
    vocab_entry_id,
    dataset_id
  );

create index word_index_vocab_entry_link_dataset_source_idx
  on word_index.vocab_entry_link(dataset_id, source_id);

create index word_index_vocab_entry_link_entry_dataset_idx
  on word_index.vocab_entry_link(vocab_entry_id, dataset_id);
