alter table word_index.raw_pointer
  alter column entry_uuid type text
  using entry_uuid::text;

comment on column word_index.raw_pointer.entry_uuid is
  '사전 원문이 UUID 형식이 아닌 식별자도 제공하므로 raw 문자열을 손실 없이 보존한다.';
