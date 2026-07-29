create index word_index_lexeme_canonical_idx
  on word_index.lexeme(canonical_lexeme_id)
  where canonical_lexeme_id is not null;

create index word_index_etymology_lexeme_idx
  on word_index.etymology(lexeme_id);

create index word_index_example_lexeme_idx
  on word_index.example(lexeme_id);
create index word_index_example_sense_idx
  on word_index.example(sense_id)
  where sense_id is not null;
create index word_index_example_source_idx
  on word_index.example(source_id)
  where source_id is not null;

create index word_index_type_decision_lexeme_idx
  on word_index.type_decision(lexeme_id)
  where lexeme_id is not null;
create index word_index_type_decision_canonical_idx
  on word_index.type_decision(canonical_lexeme_id)
  where canonical_lexeme_id is not null;
