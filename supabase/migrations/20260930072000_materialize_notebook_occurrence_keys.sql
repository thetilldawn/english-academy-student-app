begin;

-- Preserve the existing snapshot, grouping, ordering and permissions. Compute
-- each occurrence's review identity once, not once for every active candidate.
do $migration$
declare
  signature constant text := 'private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])';
  expression constant text := 'private.wrong_history_identity_v1(f.dataset_id,f.vocab_entry_id,g.dictionary_id,g.canonical_id,f.headword,true)';
  marker constant text := '), occurrences as materialized (';
  body text;
  updated text;
begin
  body := replace(pg_get_functiondef(signature::regprocedure),chr(13),'');
  if md5(body) <> '54facd35733c89b9cead6201c514de49'
    or (length(body)-length(replace(body,expression,''))) <> 2*length(expression)
    or (length(body)-length(replace(body,marker,''))) <> length(marker)
    or position('from first_occurrence f join latest_occurrence' in body)=0 then
    raise exception 'notebook_occurrence_key_base_drift';
  end if;
  updated := replace(body,expression,'f.review_key');
  updated := replace(updated,marker,
    E'), occurrence_keys as materialized (\n    select f.*, ' || expression ||
    E' as review_key\n    from first_occurrence f join first_group g using(word_key)\n  ' || marker);
  updated := replace(updated,'from first_occurrence f join latest_occurrence',
    'from occurrence_keys f join latest_occurrence');
  execute updated;
end;
$migration$;

commit;
