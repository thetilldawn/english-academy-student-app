begin;

-- APP-20261001-06. New writes share immutable selected values. Existing source,
-- composition, assessment, approval, and student rows are never rewritten.
create function private.assert_vocabulary_shape_v1(p_value jsonb,p_types jsonb,p_optional text[] default '{}')
returns void language plpgsql immutable security invoker set search_path='' as $$
declare k text; t text; v jsonb; ok boolean;
begin
  if jsonb_typeof(p_value) is distinct from 'object' or jsonb_typeof(p_types) is distinct from 'object' then
    raise exception 'vocabulary_contract_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p_value) x where not(p_types ? x))
    or exists(select 1 from jsonb_object_keys(p_types) x where not(x=any(p_optional)) and not(p_value ? x)) then
    raise exception 'vocabulary_contract_keys_invalid' using errcode='22023'; end if;
  for k,t in select key,value from jsonb_each_text(p_types) loop
    if not(p_value ? k) then continue; end if;
    v:=p_value->k;
    if v='null'::jsonb and right(t,1)='?' then continue; end if;
    if right(t,1)='?' then t:=left(t,length(t)-1); end if;
    ok:=false;
    case t
      when 'string' then ok:=jsonb_typeof(v)='string';
      when 'boolean' then ok:=jsonb_typeof(v)='boolean';
      when 'object' then ok:=jsonb_typeof(v)='object';
      when 'array' then ok:=jsonb_typeof(v)='array';
      when 'uuid' then ok:=jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
      when 'sha256' then ok:=jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[a-f0-9]{64}$';
      when 'rowHash' then ok:=jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[a-fA-F0-9]{64}$';
      when 'positiveInteger' then
        if jsonb_typeof(v)='number' and v::text ~ '^[1-9][0-9]*$' then ok:=v::text::numeric<=2147483647; end if;
      when 'positiveId' then
        if jsonb_typeof(v)='string' and (v#>>'{}') ~ '^[1-9][0-9]*$' then ok:=(v#>>'{}')::numeric<=9223372036854775807; end if;
      else raise exception 'vocabulary_validator_spec_invalid' using errcode='22023';
    end case;
    if ok is distinct from true then raise exception 'vocabulary_contract_type_invalid' using errcode='22023'; end if;
  end loop;
end;
$$;

create function private.validate_vocabulary_pronunciation_v1(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare segment jsonb; combined text:=''; url text;
begin
  perform private.assert_vocabulary_shape_v1(p,'{"displayKo":"string?","variantId":"string?","audioUrl":"string?","available":"boolean","segments":"array"}',array['segments']);
  if (p->>'displayKo' is not null and length(p->>'displayKo') not between 1 and 500)
    or (p->>'variantId' is not null and length(p->>'variantId') not between 1 and 500)
    or (p->>'available')::boolean is distinct from (p->>'audioUrl' is not null) then
    raise exception 'vocabulary_pronunciation_invalid' using errcode='22023'; end if;
  url:=p->>'audioUrl';
  -- v2 accepts literal approved URLs only, without normalization. Reject path
  -- dot segments (including percent-encoded dots) and backslash path escapes.
  if url is not null and (not(
    url ~ '^https://media[.]merriam-webster[.]com/audio/prons/en/us/mp3/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+[.]mp3$'
    or url ~ '^https://[a-z0-9]{20}[.]supabase[.]co/storage/v1/object/public/vocab-pronunciation-audio/[^?#[:space:]]*$'
  ) or position(chr(92) in url)>0 or url ~* '/([.]|%2e){1,2}(/|$)') then
    raise exception 'vocabulary_pronunciation_audio_invalid' using errcode='22023'; end if;
  if p ? 'segments' then
    if jsonb_array_length(p->'segments')>100 then raise exception 'vocabulary_pronunciation_segments_invalid' using errcode='22023'; end if;
    for segment in select value from jsonb_array_elements(p->'segments') loop
      perform private.assert_vocabulary_shape_v1(segment,'{"text":"string","stress":"string"}');
      if length(segment->>'text') not between 1 and 100 or segment->>'stress' not in('none','secondary','primary') then
        raise exception 'vocabulary_pronunciation_segments_invalid' using errcode='22023'; end if;
      combined:=combined||(segment->>'text');
    end loop;
    if jsonb_array_length(p->'segments')>0 and combined is distinct from p->>'displayKo' then
      raise exception 'vocabulary_pronunciation_segments_invalid' using errcode='22023'; end if;
  end if;
  return true;
end;
$$;

create function private.validate_vocabulary_learning_value_v1(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb; s jsonb; meaning jsonb;
begin
  perform private.assert_vocabulary_shape_v1(p,'{"schemaVersion":"string","entryValues":"object?","selectedFields":"object"}');
  if p->>'schemaVersion' is distinct from 'vocabulary-learning-value-v1' then raise exception 'vocabulary_value_version_invalid' using errcode='22023'; end if;
  e:=p->'entryValues';
  if e<>'null'::jsonb then
    perform private.assert_vocabulary_shape_v1(e,'{"headword":"string","headword_normalized":"string","pronunciation_ko":"string?","meanings":"array","primary_meaning":"string","english_definition":"string?","example_en":"string?","example_ko":"string?","entry_type":"string"}');
    if length(btrim(e->>'headword')) not between 1 and 160 or length(btrim(e->>'headword_normalized')) not between 1 and 160
      or length(btrim(e->>'primary_meaning')) not between 1 and 500 or jsonb_array_length(e->'meanings')<1
      or (e->>'pronunciation_ko' is not null and length(btrim(e->>'pronunciation_ko')) not between 1 and 160) then
      raise exception 'vocabulary_entry_values_invalid' using errcode='22023'; end if;
    for meaning in select value from jsonb_array_elements(e->'meanings') loop
      if jsonb_typeof(meaning) not in('string','null') then raise exception 'vocabulary_entry_meanings_invalid' using errcode='22023'; end if;
    end loop;
  end if;
  s:=p->'selectedFields';
  perform private.assert_vocabulary_shape_v1(s,'{"pronunciation":"object","lexicalPos":"string?","definitionEn":"string?","exampleEn":"string?","exampleKo":"string?"}');
  perform private.validate_vocabulary_pronunciation_v1(s->'pronunciation');
  return true;
end;
$$;

create function private.project_vocabulary_learning_value_v1(p_entry jsonb,p_selected jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare e jsonb:='null'; result jsonb;
  entry_keys constant text[]:=array['headword','headword_normalized','pronunciation_ko','meanings','primary_meaning','english_definition','example_en','example_ko','entry_type'];
begin
  perform private.assert_vocabulary_shape_v1(p_selected,'{"schemaVersion":"string","sourceFields":"object","proofs":"object","pronunciation":"object","lexicalPos":"string?","dictionary":"object?","senseId":"string?","definitionEn":"string?","exampleEn":"string?","exampleKo":"string?"}');
  if p_selected->>'schemaVersion' is distinct from 'vocabulary-resource-snapshot-v1' then raise exception 'vocabulary_inline_resource_version_invalid' using errcode='22023'; end if;
  if p_entry is not null and p_entry<>'null'::jsonb then
    if jsonb_typeof(p_entry) is distinct from 'object' or not(p_entry ?& entry_keys) then raise exception 'vocabulary_entry_fields_missing' using errcode='22023'; end if;
    select jsonb_object_agg(key,value) into e from jsonb_each(p_entry) where key=any(entry_keys);
  end if;
  result:=jsonb_build_object('schemaVersion','vocabulary-learning-value-v1','entryValues',e,
    'selectedFields',jsonb_build_object('pronunciation',p_selected->'pronunciation','lexicalPos',p_selected->'lexicalPos',
    'definitionEn',p_selected->'definitionEn','exampleEn',p_selected->'exampleEn','exampleKo',p_selected->'exampleKo'));
  perform private.validate_vocabulary_learning_value_v1(result);
  return result;
end;
$$;

create function private.validate_vocabulary_proofs_v1(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare k text; proof jsonb; r jsonb;
  allowed constant text[]:=array['audio','definition','dictionary_entry','dictionary_sense','example_en','example_ko','lexical_pos','pronunciation_ko','pronunciation_pos','pronunciation_variant','stress','source.headword','source.meaning','source.pos','source.display_headword','source.display_meaning'];
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'vocabulary_proofs_invalid' using errcode='22023'; end if;
  if exists(select 1 from jsonb_object_keys(p) x where not(x=any(allowed))) then raise exception 'vocabulary_proof_field_invalid' using errcode='22023'; end if;
  for k,proof in select key,value from jsonb_each(p) loop
    perform private.assert_vocabulary_shape_v1(proof,'{"state":"string","ref":"object?"}');
    if proof->>'state' not in('linked','absent','review_required','excluded') then raise exception 'vocabulary_proof_state_invalid' using errcode='22023'; end if;
    r:=proof->'ref';
    if proof->>'state'='linked' and r='null'::jsonb then raise exception 'vocabulary_proof_reference_missing' using errcode='22023'; end if;
    if r<>'null'::jsonb then perform private.assert_vocabulary_shape_v1(r,'{"fileHash":"sha256","valueHash":"sha256","pointer":"string","line":"positiveInteger?"}'); end if;
  end loop;
  return true;
end;
$$;

create function private.project_vocabulary_proofs_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare k text; proof jsonb; result jsonb:='{}';
begin
  if jsonb_typeof(p) is distinct from 'object' then raise exception 'vocabulary_proofs_invalid' using errcode='22023'; end if;
  for k,proof in select key,value from jsonb_each(p) loop
    if jsonb_typeof(proof) is distinct from 'object' or not(proof ?& array['state','value','ref'])
      or proof-array['state','value','ref']<>'{}'::jsonb then raise exception 'vocabulary_inline_proof_invalid' using errcode='22023'; end if;
    if proof->>'state'='linked' and proof->'value'='null'::jsonb then raise exception 'vocabulary_linked_value_missing' using errcode='22023'; end if;
    result:=result||jsonb_build_object(k,jsonb_build_object('state',proof->'state','ref',proof->'ref'));
  end loop;
  perform private.validate_vocabulary_proofs_v1(result);
  return result;
end;
$$;

create function private.validate_vocabulary_dictionary_link_v1(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if p='null'::jsonb then return true; end if;
  perform private.assert_vocabulary_shape_v1(p,'{"dictionary_id":"string","legacy_id":"uuid?","sense_id":"string?","canonical_approved":"boolean","occurrence_id":"string"}',array['legacy_id','sense_id','canonical_approved','occurrence_id']);
  if length(p->>'dictionary_id')<1 then raise exception 'vocabulary_dictionary_id_missing' using errcode='22023'; end if;
  return true;
end;
$$;

create function private.project_vocabulary_dictionary_link_v1(p jsonb)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare result jsonb;
begin
  if p='null'::jsonb then return p; end if;
  if jsonb_typeof(p) is distinct from 'object' or not(p ? 'dictionary_id') then raise exception 'vocabulary_dictionary_link_invalid' using errcode='22023'; end if;
  select jsonb_object_agg(key,value) into result from jsonb_each(p) where key=any(array['dictionary_id','legacy_id','sense_id','canonical_approved','occurrence_id']);
  perform private.validate_vocabulary_dictionary_link_v1(result);
  return result;
end;
$$;

create function private.validate_vocabulary_learning_binding_v1(p jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
declare s jsonb; e jsonb; h jsonb; ids jsonb; legacy_id jsonb; learning jsonb;
begin
  perform private.assert_vocabulary_shape_v1(p,'{"schemaVersion":"string","selectionHash":"sha256","source":"object","entryLink":"object?","originalHashes":"object","selectedDictionary":"object?","selectedSenseId":"string?","sourceIdentifiers":"object","proofs":"object","learningIdentity":"object"}');
  if p->>'schemaVersion' is distinct from 'vocabulary-source-binding-v1' then raise exception 'vocabulary_binding_version_invalid' using errcode='22023'; end if;
  s:=p->'source';
  perform private.assert_vocabulary_shape_v1(s,'{"kind":"string","datasetId":"uuid","unitId":"uuid","releaseId":"uuid?","version":"sha256","fileHash":"sha256","locator":"string","sourceRow":"positiveInteger","occurrenceKey":"sha256","state":"string"}');
  if s->>'kind' not in('legacy_vocab','exam_use','reviewed_exam') or s->>'state' not in('included','held','excluded')
    or length(btrim(s->>'locator')) not between 1 and 240
    or ((s->>'kind'='legacy_vocab') is distinct from (s->'releaseId'='null'::jsonb)) then raise exception 'vocabulary_binding_source_invalid' using errcode='22023'; end if;
  e:=p->'entryLink';
  if e<>'null'::jsonb then
    perform private.assert_vocabulary_shape_v1(e,'{"id":"positiveId","datasetId":"uuid","unitId":"uuid","sourceRow":"positiveInteger","rowHash":"rowHash","sourceRef":"string?"}');
    if e->>'sourceRef' is not null and length(e->>'sourceRef')>500 then raise exception 'vocabulary_entry_link_invalid' using errcode='22023'; end if;
    if e->'datasetId' is distinct from s->'datasetId' or e->'unitId' is distinct from s->'unitId' or e->'sourceRow' is distinct from s->'sourceRow' then
      raise exception 'vocabulary_entry_source_mismatch' using errcode='22023'; end if;
  elsif s->>'state'='included' then raise exception 'vocabulary_included_entry_missing' using errcode='22023'; end if;
  h:=p->'originalHashes';
  perform private.assert_vocabulary_shape_v1(h,'{"entrySnapshotHash":"sha256?","occurrenceSnapshotHash":"sha256?","selectedSnapshotHash":"sha256","dictionarySnapshotHash":"sha256?"}');
  if (e='null'::jsonb) is distinct from (h->'entrySnapshotHash'='null'::jsonb)
    or (p->'selectedDictionary'='null'::jsonb) is distinct from (h->'dictionarySnapshotHash'='null'::jsonb) then
    raise exception 'vocabulary_original_hash_missing' using errcode='22023'; end if;
  perform private.validate_vocabulary_dictionary_link_v1(p->'selectedDictionary');
  perform private.validate_vocabulary_proofs_v1(p->'proofs');
  ids:=p->'sourceIdentifiers';
  perform private.assert_vocabulary_shape_v1(ids,'{"dictionaryId":"string?","legacyIds":"array","occurrenceId":"string?","senseId":"string?","sourceEntryId":"string?","sourceEntryHash":"rowHash?","legacyLexemeId":"uuid?","legacyOccurrenceId":"uuid?","legacyMappingStatus":"string?"}');
  for legacy_id in select value from jsonb_array_elements(ids->'legacyIds') loop
    perform private.assert_vocabulary_shape_v1(legacy_id,'{"system":"string","id":"uuid"}');
    if legacy_id->>'system' is distinct from 'legacy-word-index' then raise exception 'vocabulary_legacy_id_system_invalid' using errcode='22023'; end if;
  end loop;
  if ids->>'legacyMappingStatus' is not null and ids->>'legacyMappingStatus' not in('exact_headword_unreviewed','approved','ambiguous','unresolved','rejected') then
    raise exception 'vocabulary_legacy_mapping_invalid' using errcode='22023'; end if;
  learning:=p->'learningIdentity';
  perform private.assert_vocabulary_shape_v1(learning,'{"kind":"string","key":"sha256","senseId":"string?","lexicalPos":"string?","reviewEvidenceHash":"sha256?"}');
  if learning->>'kind'='reviewed-meaning-v1' then
    if learning->>'senseId' is null or learning->>'lexicalPos' is null or learning->>'reviewEvidenceHash' is null then raise exception 'vocabulary_identity_review_missing' using errcode='22023'; end if;
  elsif learning->>'kind'='source-occurrence-v1' then
    if learning->>'senseId' is not null or learning->>'reviewEvidenceHash' is not null then raise exception 'vocabulary_unreviewed_identity_invalid' using errcode='22023'; end if;
  else raise exception 'vocabulary_identity_kind_invalid' using errcode='22023'; end if;
  return true;
end;
$$;

create function private.vocabulary_learning_identity_v1(p_entry jsonb,p_source jsonb,p_selected jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r word_index.mock_wordbook_identity_review; approved_key text;
begin
  if p_source->>'kind'='exam_use' and p_entry is not null and p_entry<>'null'::jsonb then
    select * into r from word_index.mock_wordbook_identity_review where source_release_id=(p_source->>'releaseId')::uuid and source_entry_id=(p_entry->>'id')::bigint;
    if found then
      if r.source_row_sha256 is distinct from p_entry->>'row_sha256' or r.reviewed_headword is distinct from p_entry->>'headword'
        or r.reviewed_gloss is distinct from p_entry->>'primary_meaning'
        or (p_selected->>'senseId' is not null and p_selected->>'senseId' is distinct from r.sense_id)
        or (p_selected->>'lexicalPos' is not null and p_selected->>'lexicalPos' is distinct from r.lexical_pos) then
        raise exception 'composition_identity_mismatch' using errcode='40001'; end if;
      -- Keep the original 20260914140753 hash recipe byte for byte. The
      -- canonical JSON helper has different whitespace and is not equivalent.
      approved_key:=encode(extensions.digest(jsonb_build_array(lower(normalize(p_entry->>'headword',NFKC)),r.lexical_pos,r.sense_id,p_entry->>'primary_meaning')::text,'sha256'),'hex');
      return jsonb_build_object('kind','reviewed-meaning-v1','key',approved_key,'senseId',r.sense_id,'lexicalPos',r.lexical_pos,'reviewEvidenceHash',r.review_evidence_sha256);
    end if;
  end if;
  return jsonb_build_object('kind','source-occurrence-v1','key',private.reviewed_exam_sha256_v1(jsonb_build_array('source-occurrence-v1',p_source->'occurrenceKey',p_source->'version','primary_meaning',private.reviewed_exam_sha256_v1(jsonb_build_array(p_entry->'primary_meaning',p_selected->'lexicalPos')))),
    'senseId',null,'lexicalPos',p_selected->'lexicalPos','reviewEvidenceHash',null);
end;
$$;

create function private.project_vocabulary_learning_binding_v1(p_entry jsonb,p_occurrence jsonb,p_resources jsonb,p_source jsonb,p_selection_sha256 text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare selected jsonb:=p_resources->'selected'; bridge word_index.vocab_entry_link; entry_link jsonb:='null'; result jsonb; identifier_source jsonb;
  has_entry boolean:=p_entry is not null and p_entry<>'null'::jsonb;
  has_occurrence boolean:=p_occurrence is not null and p_occurrence<>'null'::jsonb;
begin
  perform private.project_vocabulary_learning_value_v1(p_entry,selected);
  if has_entry then
    if not(p_entry ?& array['id','dataset_id','unit_id','source_row','row_sha256','source_ref']) then raise exception 'vocabulary_entry_link_missing' using errcode='22023'; end if;
    entry_link:=jsonb_build_object('id',p_entry->>'id','datasetId',p_entry->'dataset_id','unitId',p_entry->'unit_id','sourceRow',p_entry->'source_row','rowHash',p_entry->'row_sha256','sourceRef',p_entry->'source_ref');
    select * into bridge from word_index.vocab_entry_link where vocab_entry_id=(p_entry->>'id')::bigint;
    if found and (bridge.dataset_id::text is distinct from p_entry->>'dataset_id' or bridge.entry_row_sha256 is distinct from p_entry->>'row_sha256') then
      raise exception 'vocabulary_legacy_link_mismatch' using errcode='40001'; end if;
  end if;
  identifier_source:=case when p_source->>'kind'='reviewed_exam' then p_occurrence->'payload' when p_source->>'kind'='exam_use' then p_occurrence else null end;
  result:=jsonb_build_object('schemaVersion','vocabulary-source-binding-v1','selectionHash',p_selection_sha256,'source',p_source,'entryLink',entry_link,
    'originalHashes',jsonb_build_object('entrySnapshotHash',case when has_entry then private.reviewed_exam_sha256_v1(p_entry) end,
      'occurrenceSnapshotHash',case when has_occurrence then private.reviewed_exam_sha256_v1(p_occurrence) end,
      'selectedSnapshotHash',private.reviewed_exam_sha256_v1(selected),'dictionarySnapshotHash',case when selected->'dictionary'<>'null'::jsonb then private.reviewed_exam_sha256_v1(selected->'dictionary') end),
    'selectedDictionary',private.project_vocabulary_dictionary_link_v1(selected->'dictionary'),'selectedSenseId',selected->'senseId',
    'sourceIdentifiers',jsonb_build_object('dictionaryId',identifier_source->'dictionary_id','legacyIds',coalesce(nullif(identifier_source->'legacy_ids','null'::jsonb),'[]'::jsonb),'occurrenceId',identifier_source->'occurrence_id','senseId',identifier_source->'sense_id','sourceEntryId',identifier_source->'source_entry_id','sourceEntryHash',identifier_source->'source_entry_sha256','legacyLexemeId',bridge.lexeme_id,'legacyOccurrenceId',bridge.occurrence_id,'legacyMappingStatus',bridge.mapping_status),
    'proofs',private.project_vocabulary_proofs_v1(selected->'proofs'),'learningIdentity',private.vocabulary_learning_identity_v1(p_entry,p_source,selected));
  perform private.validate_vocabulary_learning_binding_v1(result);
  return result;
end;
$$;

create table private.vocabulary_learning_value_versions (
  selection_id uuid primary key default gen_random_uuid(),
  selection_sha256 text not null unique check(selection_sha256 ~ '^[a-f0-9]{64}$'),
  payload jsonb not null check(private.validate_vocabulary_learning_value_v1(payload)),
  created_at timestamptz not null default now(),
  unique(selection_id,selection_sha256),
  check(selection_sha256=private.reviewed_exam_sha256_v1(payload))
);
create table private.vocabulary_learning_value_bindings (
  binding_id uuid primary key default gen_random_uuid(),
  binding_sha256 text not null unique check(binding_sha256 ~ '^[a-f0-9]{64}$'),
  selection_id uuid not null,
  selection_sha256 text not null,
  payload jsonb not null check(private.validate_vocabulary_learning_binding_v1(payload)),
  created_at timestamptz not null default now(),
  foreign key(selection_id,selection_sha256) references private.vocabulary_learning_value_versions(selection_id,selection_sha256),
  check(binding_sha256=private.reviewed_exam_sha256_v1(payload)),
  check(selection_sha256=payload->>'selectionHash')
);
alter table private.vocabulary_learning_value_versions enable row level security;
alter table private.vocabulary_learning_value_bindings enable row level security;
revoke all on private.vocabulary_learning_value_versions,private.vocabulary_learning_value_bindings from public,anon,authenticated,service_role;
create trigger vocabulary_learning_value_versions_immutable before update or delete on private.vocabulary_learning_value_versions for each row execute function private.reject_mock_wordbook_history_change();
create trigger vocabulary_learning_value_bindings_immutable before update or delete on private.vocabulary_learning_value_bindings for each row execute function private.reject_mock_wordbook_history_change();

create function private.resolve_vocabulary_learning_value_v1(p_ref jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v private.vocabulary_learning_value_versions;
begin
  perform private.assert_vocabulary_shape_v1(p_ref,'{"schemaVersion":"string","selectionId":"uuid","selectionHash":"sha256"}');
  if p_ref->>'schemaVersion' is distinct from 'vocabulary-resource-ref-v2' then raise exception 'vocabulary_selection_unavailable' using errcode='40001'; end if;
  select * into v from private.vocabulary_learning_value_versions where selection_id=(p_ref->>'selectionId')::uuid and selection_sha256=p_ref->>'selectionHash';
  if not found or v.selection_sha256 is distinct from private.reviewed_exam_sha256_v1(v.payload) then raise exception 'vocabulary_selection_unavailable' using errcode='40001'; end if;
  return v.payload;
end;
$$;

create function private.resolve_vocabulary_learning_binding_v1(p_resources jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r jsonb:=p_resources->'selectionBinding'; b private.vocabulary_learning_value_bindings;
begin
  perform private.resolve_vocabulary_learning_value_v1(p_resources->'selected');
  perform private.assert_vocabulary_shape_v1(r,'{"schemaVersion":"string","bindingId":"uuid","bindingHash":"sha256"}');
  if r->>'schemaVersion' is distinct from 'vocabulary-source-binding-ref-v1' then raise exception 'vocabulary_binding_unavailable' using errcode='40001'; end if;
  select * into b from private.vocabulary_learning_value_bindings where binding_id=(r->>'bindingId')::uuid and binding_sha256=r->>'bindingHash';
  if not found or b.binding_sha256 is distinct from private.reviewed_exam_sha256_v1(b.payload)
    or b.selection_id is distinct from (p_resources#>>'{selected,selectionId}')::uuid
    or b.selection_sha256 is distinct from p_resources#>>'{selected,selectionHash}' then raise exception 'vocabulary_binding_unavailable' using errcode='40001'; end if;
  return b.payload;
end;
$$;

create function private.register_vocabulary_learning_resources_v1(p_entry jsonb,p_occurrence jsonb,p_resources jsonb,p_source jsonb)
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare value_doc jsonb; binding_doc jsonb; vh text; bh text;
  v private.vocabulary_learning_value_versions; b private.vocabulary_learning_value_bindings;
begin
  if p_resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    binding_doc:=private.resolve_vocabulary_learning_binding_v1(p_resources);
    if binding_doc->'source' is distinct from p_source
      or p_entry->>'recordHash' is distinct from binding_doc#>>'{originalHashes,entrySnapshotHash}'
      or p_occurrence->>'recordHash' is distinct from binding_doc#>>'{originalHashes,occurrenceSnapshotHash}' then
      raise exception 'vocabulary_source_content_mismatch' using errcode='40001'; end if;
    return p_resources;
  end if;
  value_doc:=private.project_vocabulary_learning_value_v1(p_entry,p_resources->'selected');
  vh:=private.reviewed_exam_sha256_v1(value_doc);
  binding_doc:=private.project_vocabulary_learning_binding_v1(p_entry,p_occurrence,p_resources,p_source,vh);
  bh:=private.reviewed_exam_sha256_v1(binding_doc);
  -- Separate statements intentionally obtain a fresh snapshot after a unique
  -- conflict wait. Never overwrite an existing immutable value.
  insert into private.vocabulary_learning_value_versions(selection_sha256,payload) values(vh,value_doc) on conflict(selection_sha256) do nothing;
  select * into v from private.vocabulary_learning_value_versions where selection_sha256=vh;
  if not found or v.payload is distinct from value_doc then raise exception 'vocabulary_value_conflict' using errcode='40001'; end if;
  insert into private.vocabulary_learning_value_bindings(binding_sha256,selection_id,selection_sha256,payload) values(bh,v.selection_id,vh,binding_doc) on conflict(binding_sha256) do nothing;
  select * into b from private.vocabulary_learning_value_bindings where binding_sha256=bh;
  if not found or b.payload is distinct from binding_doc or b.selection_id is distinct from v.selection_id then raise exception 'vocabulary_binding_conflict' using errcode='40001'; end if;
  return (p_resources-'selected')||jsonb_build_object('selected',jsonb_build_object('schemaVersion','vocabulary-resource-ref-v2','selectionId',v.selection_id,'selectionHash',vh),
    'selectionBinding',jsonb_build_object('schemaVersion','vocabulary-source-binding-ref-v1','bindingId',b.binding_id,'bindingHash',bh));
end;
$$;

-- Preserve the original v1 validator unchanged for historical snapshots.
-- Keep the existing reader OID so stored dependencies continue to use the
-- upgraded reader; copy its definition for the historical branch.
do $copy$
declare d text;
begin
  d:=pg_get_functiondef('private.vocabulary_composition_resource_v1(jsonb)'::regprocedure);
  execute replace(d,'private.vocabulary_composition_resource_v1(','private.vocabulary_composition_inline_resource_v1(');
end;
$copy$;
create or replace function private.vocabulary_composition_resource_v1(p_resources jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb; b jsonb;
begin
  if p_resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    v:=private.resolve_vocabulary_learning_value_v1(p_resources->'selected');
    b:=private.resolve_vocabulary_learning_binding_v1(p_resources);
    return (v->'selectedFields')||jsonb_build_object('schemaVersion','vocabulary-resource-selected-v2','dictionary',b->'selectedDictionary','senseId',b->'selectedSenseId','proofs',b->'proofs');
  end if;
  return private.vocabulary_composition_inline_resource_v1(p_resources);
end;
$$;

revoke all on function
  private.assert_vocabulary_shape_v1(jsonb,jsonb,text[]),private.validate_vocabulary_pronunciation_v1(jsonb),
  private.validate_vocabulary_learning_value_v1(jsonb),private.project_vocabulary_learning_value_v1(jsonb,jsonb),
  private.validate_vocabulary_proofs_v1(jsonb),private.project_vocabulary_proofs_v1(jsonb),
  private.validate_vocabulary_dictionary_link_v1(jsonb),private.project_vocabulary_dictionary_link_v1(jsonb),
  private.validate_vocabulary_learning_binding_v1(jsonb),private.vocabulary_learning_identity_v1(jsonb,jsonb,jsonb),
  private.project_vocabulary_learning_binding_v1(jsonb,jsonb,jsonb,jsonb,text),
  private.resolve_vocabulary_learning_value_v1(jsonb),private.resolve_vocabulary_learning_binding_v1(jsonb),
  private.register_vocabulary_learning_resources_v1(jsonb,jsonb,jsonb,jsonb),
  private.vocabulary_composition_inline_resource_v1(jsonb),private.vocabulary_composition_resource_v1(jsonb)
from public,anon,authenticated,service_role;

-- A missing format row means historical v1, including an interrupted build.
-- Whole preparation inserts compositions last, so the FK is to library_versions.
create table private.vocabulary_composition_storage_formats (
  version_id uuid primary key references private.vocabulary_library_versions(id),
  format text not null check(format='learning-values-v2')
);
alter table private.vocabulary_composition_storage_formats enable row level security;
revoke all on private.vocabulary_composition_storage_formats from public,anon,authenticated,service_role;
create trigger vocabulary_composition_storage_formats_immutable before update or delete on private.vocabulary_composition_storage_formats for each row execute function private.reject_mock_wordbook_history_change();
create function private.vocabulary_composition_uses_learning_values_v1(p_version_id uuid)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(select 1 from private.vocabulary_composition_storage_formats where version_id=p_version_id and format='learning-values-v2');
$$;

create function private.compact_vocabulary_source_snapshot_v1(p_value jsonb,p_kind text)
returns jsonb language plpgsql immutable security invoker set search_path='' as $$
declare tag text;
begin
  tag:=case p_kind when 'entry' then 'vocabulary-entry-index-v2' when 'occurrence' then 'vocabulary-occurrence-index-v2' end;
  if tag is null then raise exception 'invalid_vocabulary_snapshot_kind' using errcode='22023'; end if;
  if p_value is null or p_value='null'::jsonb then return null; end if;
  if jsonb_typeof(p_value)<>'object' then raise exception 'invalid_vocabulary_source_snapshot' using errcode='22023'; end if;
  if p_value->>'schemaVersion'=tag then return p_value; end if;
  if p_kind='entry' then
    return jsonb_build_object('schemaVersion',tag,'recordHash',private.reviewed_exam_sha256_v1(p_value),
      'id',p_value->'id','dataset_id',p_value->'dataset_id','unit_id',p_value->'unit_id','source_row',p_value->'source_row',
      'row_sha256',p_value->'row_sha256','headword',p_value->'headword','primary_meaning',p_value->'primary_meaning');
  end if;
  return jsonb_build_object('schemaVersion',tag,'recordHash',private.reviewed_exam_sha256_v1(p_value),
    'context_evidence',case when p_value#>'{context_evidence,choice_safety}' is null then '{}'::jsonb else jsonb_build_object('choice_safety',p_value#>'{context_evidence,choice_safety}') end);
end;
$$;

create function private.vocabulary_source_snapshot_matches_v2(p_stored jsonb,p_live jsonb)
returns boolean language plpgsql immutable security invoker set search_path='' as $$
begin
  if p_stored->>'schemaVersion'='vocabulary-entry-index-v2' then return p_stored is not distinct from private.compact_vocabulary_source_snapshot_v1(p_live,'entry');
  elsif p_stored->>'schemaVersion'='vocabulary-occurrence-index-v2' then return p_stored is not distinct from private.compact_vocabulary_source_snapshot_v1(p_live,'occurrence'); end if;
  return p_stored is not distinct from p_live;
end;
$$;

create function private.vocabulary_scope_entry_value_v2(p_entry jsonb,p_resources jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare v jsonb; b jsonb;
begin
  if p_resources#>>'{selected,schemaVersion}' is distinct from 'vocabulary-resource-ref-v2' then return p_entry; end if;
  v:=private.resolve_vocabulary_learning_value_v1(p_resources->'selected');
  b:=private.resolve_vocabulary_learning_binding_v1(p_resources);
  if p_entry is null or p_entry='null'::jsonb then
    if b->'entryLink' is distinct from 'null'::jsonb then raise exception 'vocabulary_source_content_mismatch' using errcode='40001'; end if;
    return null;
  end if;
  if p_entry->>'schemaVersion' is distinct from 'vocabulary-entry-index-v2'
    or p_entry->>'recordHash' is distinct from b#>>'{originalHashes,entrySnapshotHash}'
    or p_entry->'headword' is distinct from v#>'{entryValues,headword}'
    or p_entry->'primary_meaning' is distinct from v#>'{entryValues,primary_meaning}' then
    raise exception 'vocabulary_source_content_mismatch' using errcode='40001'; end if;
  return (v->'entryValues')||jsonb_build_object('source_ref',b#>'{entryLink,sourceRef}');
end;
$$;

create function private.vocabulary_selection_comparison_v2(p_entry jsonb,p_resources jsonb)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare b jsonb; original_hash text;
begin
  if p_resources#>>'{selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    b:=private.resolve_vocabulary_learning_binding_v1(p_resources);
    original_hash:=b#>>'{originalHashes,selectedSnapshotHash}';
  else
    -- Keep raw v1 equality, without retroactively requiring new input fields.
    -- Entry/occurrence hashes are compared separately by the row comparison.
    original_hash:=private.reviewed_exam_sha256_v1(p_resources->'selected');
  end if;
  return jsonb_build_object('originalSelectedHash',original_hash);
end;
$$;

create function private.vocabulary_library_row_comparison_v2(p_scope_id uuid,p_key text)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare d jsonb; b jsonb; entry_hash text; occurrence_hash text;
begin
  d:=private.vocabulary_library_row_document_v1(p_scope_id,p_key);
  if d is null then raise exception 'library_source_row_missing' using errcode='40001'; end if;
  if d#>>'{resources,selected,schemaVersion}'='vocabulary-resource-ref-v2' then
    b:=private.resolve_vocabulary_learning_binding_v1(d->'resources');
    entry_hash:=b#>>'{originalHashes,entrySnapshotHash}'; occurrence_hash:=b#>>'{originalHashes,occurrenceSnapshotHash}';
  else
    entry_hash:=case when d->'entry' is null or d->'entry'='null'::jsonb then null else private.reviewed_exam_sha256_v1(d->'entry') end;
    occurrence_hash:=case when d->'occurrence' is null or d->'occurrence'='null'::jsonb then null else private.reviewed_exam_sha256_v1(d->'occurrence') end;
  end if;
  return (d-array['entry','occurrence','resources'])||jsonb_build_object('entrySnapshotHash',entry_hash,'occurrenceSnapshotHash',occurrence_hash,
    'entryHash',d#>'{resources,entryHash}','selection',private.vocabulary_selection_comparison_v2(d->'entry',d->'resources'));
end;
$$;

-- Write-only projection. New registration is not followed by a STABLE resolver
-- in the same SQL statement, whose snapshot could not see the newly added row.
create function private.vocabulary_composition_row_document_v2(p_scope_id uuid,p_key text,p_scope_ids uuid[])
returns jsonb language plpgsql volatile security invoker set search_path='' as $$
declare s private.vocabulary_library_scopes; r private.vocabulary_library_scope_rows; source_doc jsonb; saved_resources jsonb; link_hashes jsonb;
begin
  select * into s from private.vocabulary_library_scopes where id=p_scope_id;
  if not found then raise exception 'library_scope_missing' using errcode='40001'; end if;
  select * into r from private.vocabulary_library_scope_rows where scope_id=p_scope_id and occurrence_key=p_key;
  if not found then raise exception 'library_source_row_missing' using errcode='40001'; end if;
  source_doc:=jsonb_build_object('kind',s.source_kind,'datasetId',s.dataset_id,'unitId',s.unit_id,'releaseId',s.source_release_id,'version',s.source_version,
    'fileHash',s.source_file_sha256,'locator',s.payload#>'{source,locator}','sourceRow',r.source_row,'occurrenceKey',r.occurrence_key,'state',r.state);
  saved_resources:=private.register_vocabulary_learning_resources_v1(r.entry_snapshot,r.occurrence_snapshot,r.resources,source_doc);
  select jsonb_agg(distinct x.resources->'linkRecordHash' order by x.resources->'linkRecordHash') into link_hashes
    from private.vocabulary_library_scope_rows x where x.scope_id=any(p_scope_ids) and x.occurrence_key=p_key;
  return jsonb_build_object('key',r.occurrence_key,'sourceRow',r.source_row,'sourceEntryId',r.source_entry_id,'rowHash',r.row_sha256,
    'sourceClassification',(s.payload->'classification')-array['school','targetGrade','schoolYear','semester','assessment','purpose'],'state',r.state,
    'entry',private.compact_vocabulary_source_snapshot_v1(r.entry_snapshot,'entry'),'occurrence',private.compact_vocabulary_source_snapshot_v1(r.occurrence_snapshot,'occurrence'),
    'resources',(saved_resources-'linkRecordHash')||jsonb_build_object('linkRecordHashes',link_hashes));
end;
$$;
revoke all on function private.vocabulary_composition_uses_learning_values_v1(uuid),private.compact_vocabulary_source_snapshot_v1(jsonb,text),
  private.vocabulary_source_snapshot_matches_v2(jsonb,jsonb),private.vocabulary_scope_entry_value_v2(jsonb,jsonb),
  private.vocabulary_selection_comparison_v2(jsonb,jsonb),private.vocabulary_library_row_comparison_v2(uuid,text),
  private.vocabulary_composition_row_document_v2(uuid,text,uuid[]) from public,anon,authenticated,service_role;

-- Fail closed if an installed function differs from the inspected context.
create function pg_temp.m01_replace(p_signature text,p_old text,p_new text,p_expected integer default 1)
returns void language plpgsql as $$
declare d text; hits integer;
begin
  if p_old='' then raise exception 'm01_empty_patch'; end if;
  d:=replace(pg_get_functiondef(p_signature::regprocedure),chr(13),'');
  hits:=(length(d)-length(replace(d,p_old,'')))/length(p_old);
  if hits<>p_expected then raise exception 'm01_patch_context_changed: %, expected %, found %',p_signature,p_expected,hits; end if;
  execute replace(d,p_old,p_new);
end;
$$;

-- Keep original rows_doc/version and only compact a newly inserted scope.
select pg_temp.m01_replace('private.import_vocabulary_library_core_v1(text,text)',
$old$          select sid,x->>'key',(x->>'sourceRow')::integer,(x->>'sourceEntryId')::bigint,x->>'rowHash',x->>'state',nullif(x->'entry','null'),nullif(x->'occurrence','null'),x->'resources'
          from jsonb_array_elements(rows_doc) x;$old$,
$new$          select sid,x->>'key',(x->>'sourceRow')::integer,(x->>'sourceEntryId')::bigint,x->>'rowHash',x->>'state',
            private.compact_vocabulary_source_snapshot_v1(nullif(x->'entry','null'),'entry'),
            private.compact_vocabulary_source_snapshot_v1(nullif(x->'occurrence','null'),'occurrence'),saved.value
          from jsonb_array_elements(rows_doc) x cross join lateral (
            select private.register_vocabulary_learning_resources_v1(nullif(x->'entry','null'),nullif(x->'occurrence','null'),x->'resources',
              jsonb_build_object('kind',kind,'datasetId',d.id,'unitId',uid,'releaseId',rid,'version',actual_version,'fileHash',src->'fileHash','locator',src->'locator',
                'sourceRow',x->'sourceRow','occurrenceKey',x->'key','state',x->'state')) value offset 0
          ) saved;$new$,1);

-- Existing preparing/ready branches return before this insertion. Preserve the
-- later deletion guards around these renamed original implementations.
do $patch$
declare anchor text;
begin
  anchor:=$text$  if fixed->>'scopeStatus'<>'confirmed' or jsonb_array_length(fixed->'includedKeys')<1 then raise exception 'composition_scope_unconfirmed' using errcode='22023'; end if;$text$;
  perform pg_temp.m01_replace('private.initialize_vocabulary_composition_before_delete_v1(uuid,text,uuid,uuid)',anchor,
    anchor||E'\n  insert into private.vocabulary_composition_storage_formats(version_id,format) values(p_version_id,''learning-values-v2'');');
  perform pg_temp.m01_replace('private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)',E'declare\n  v private.vocabulary_library_versions;',E'declare\n  storage_v2 boolean:=false;\n  v private.vocabulary_library_versions;');
  perform pg_temp.m01_replace('private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)',anchor,
    anchor||E'\n  insert into private.vocabulary_composition_storage_formats(version_id,format) values(p_version_id,''learning-values-v2'');\n  storage_v2:=true;');
  perform pg_temp.m01_replace('private.insert_vocabulary_composition_entry_batch_v1(uuid,text,uuid,integer,integer)','declare written integer;',
    'declare written integer; storage_v2 boolean:=private.vocabulary_composition_uses_learning_values_v1(p_version_id);');
  perform pg_temp.m01_replace('private.copy_vocabulary_reviewed_batch_v1(uuid,uuid,integer)','last_row integer:=p_after_row;',
    'last_row integer:=p_after_row; storage_v2 boolean:=private.vocabulary_composition_uses_learning_values_v1(p_version_id);');
end;
$patch$;

do $patch$
declare signature text; old_doc text; old_resource text;
begin
  old_doc:=$text$jsonb_set(jsonb_build_object('key',sr.occurrence_key,'sourceRow',sr.source_row,'sourceEntryId',sr.source_entry_id,'rowHash',sr.row_sha256,'sourceClassification',scope_record.class,'state',sr.state,'entry',sr.entry_snapshot,'occurrence',sr.occurrence_snapshot,'resources',sr.resources-'linkRecordHash'),'{resources,linkRecordHashes}',
        (select jsonb_agg(distinct r.resources->'linkRecordHash' order by r.resources->'linkRecordHash') from private.vocabulary_library_scope_rows r
          where r.scope_id=any(p.scope_ids) and r.occurrence_key=p.occurrence_key))$text$;
  old_resource:=$text$jsonb_set(doc.value->'resources','{selected}',private.vocabulary_composition_resource_v1(doc.value->'resources'))$text$;
  foreach signature in array array['private.insert_vocabulary_composition_entry_batch_v1(uuid,text,uuid,integer,integer)','private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)'] loop
    perform pg_temp.m01_replace(signature,'jsonb_populate_record(null::public.vocab_entries,sr.entry_snapshot)',
      'jsonb_populate_record(null::public.vocab_entries,private.vocabulary_scope_entry_value_v2(sr.entry_snapshot,sr.resources))');
    perform pg_temp.m01_replace(signature,old_resource,'(case when storage_v2 then doc.value->''resources'' else '||old_resource||' end)');
    perform pg_temp.m01_replace(signature,old_doc,'(case when storage_v2 then private.vocabulary_composition_row_document_v2(p.scope_id,p.occurrence_key,p.scope_ids) else '||old_doc||' end)');
  end loop;
end;
$patch$;

do $patch$
declare signature text;
begin
  foreach signature in array array['private.copy_vocabulary_reviewed_batch_v1(uuid,uuid,integer)','private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)'] loop
    perform pg_temp.m01_replace(signature,
      $old$'originalChoiceEntryIds',old_item.choice_vocab_entry_ids,'resources',target_entry.resources,'originalItem',old_item.payload);$old$,
      $new$'originalChoiceEntryIds',old_item.choice_vocab_entry_ids,'resources',target_entry.resources);
      if not storage_v2 then proof:=proof||jsonb_build_object('originalItem',old_item.payload); end if;$new$);
  end loop;
  foreach signature in array array['private.copy_vocabulary_reviewed_batch_v1(uuid,uuid,integer)','private.prepare_vocabulary_composition_data_before_delete_v1(uuid,text,uuid,uuid)',
    'private.insert_vocabulary_composition_question_batch_v1(uuid,jsonb)','private.finalize_vocabulary_composition_core_v1(uuid,text,jsonb,boolean)'] loop
    perform pg_temp.m01_replace(signature,$old$target_entry.resources#>'{selected,pronunciation}'$old$,
      $new$(private.vocabulary_composition_resource_v1(target_entry.resources))->'pronunciation'$new$);
  end loop;
  foreach signature in array array['private.insert_vocabulary_composition_question_batch_v1(uuid,jsonb)','private.finalize_vocabulary_composition_core_v1(uuid,text,jsonb,boolean)'] loop
    perform pg_temp.m01_replace(signature,$old$choice_lineage.resources#>'{selected,pronunciation}'$old$,
      $new$(private.vocabulary_composition_resource_v1(choice_lineage.resources))->'pronunciation'$new$);
  end loop;
end;
$patch$;

-- Full original-row hash verification remains, even if a row_sha256 column was
-- not updated when a source metadata field changed.
do $patch$
declare signature text;
begin
  foreach signature in array array['private.vocabulary_library_source_state_values_v1(uuid,uuid,uuid,text,uuid,text)','private.vocabulary_library_source_states_v1(uuid[])'] loop
    perform pg_temp.m01_replace(signature,'to_jsonb(e) is distinct from r.entry_snapshot','not private.vocabulary_source_snapshot_matches_v2(r.entry_snapshot,to_jsonb(e))');
    perform pg_temp.m01_replace(signature,'to_jsonb(o) is distinct from r.occurrence_snapshot','not private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,to_jsonb(o))');
    perform pg_temp.m01_replace(signature,'to_jsonb(re) is distinct from r.occurrence_snapshot','not private.vocabulary_source_snapshot_matches_v2(r.occurrence_snapshot,to_jsonb(re))');
  end loop;
end;
$patch$;

select pg_temp.m01_replace('private.resolve_vocabulary_library_recipe_compact_v1(jsonb)',
  'private.vocabulary_library_row_document_v1(m.scope_id,m.key) is distinct from private.vocabulary_library_row_document_v1(representative,merged.key)',
  'private.vocabulary_library_row_comparison_v2(m.scope_id,m.key) is distinct from private.vocabulary_library_row_comparison_v2(representative,merged.key)');
select pg_temp.m01_replace('private.resolve_vocabulary_library_recipe_v1(jsonb)',
  'count(distinct doc)>1 conflict',
  'count(distinct private.vocabulary_library_row_comparison_v2(scope_id,key))>1 conflict');
select pg_temp.m01_replace('private.vocabulary_composition_choice_resource_v1(uuid,bigint)',
  $old$select count(distinct r.resources->'selected'),(jsonb_agg(r.resources->'selected')->0) into variants,answer$old$,
  $new$select count(distinct private.vocabulary_selection_comparison_v2(r.entry_snapshot,r.resources)),
    (jsonb_agg(r.resources order by r.scope_id,r.occurrence_key)->0) into variants,answer$new$);
select pg_temp.m01_replace('private.vocabulary_composition_choice_resource_v1(uuid,bigint)',
  $old$return private.vocabulary_composition_resource_v1(jsonb_build_object('selected',answer));$old$,
  $new$return private.vocabulary_composition_resource_v1(answer);$new$);
select pg_temp.m01_replace('private.vocabulary_composition_preparation_v1(uuid)',
  $old$l.resources->'selected'$old$,$new$private.vocabulary_composition_resource_v1(l.resources)$new$);

-- Read the final function definitions, preserving the later notebook branches.
do $patch$
declare signature text; field text;
begin
  foreach signature in array array['private.student_assignment_study_content_v1(uuid,uuid)',
    'private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])'] loop
    foreach field in array array['definitionEn','exampleEn'] loop
      perform pg_temp.m01_replace(signature,'composition.resources#>>''{selected,'||field||'}''',
        '(private.vocabulary_composition_resource_v1(composition.resources))->>'''||field||'''');
    end loop;
  end loop;
  perform pg_temp.m01_replace('private.wrong_word_notebook_page_v3(uuid,uuid,text,text,bigint,timestamp with time zone,text,integer,integer,text,integer,text,integer,text[])',
    $old$composition.resources#>>'{selected,exampleKo}'$old$,$new$(private.vocabulary_composition_resource_v1(composition.resources))->>'exampleKo'$new$);
end;
$patch$;

do $checks$
declare d text;
begin
  d:=pg_get_functiondef('private.initialize_vocabulary_composition_build_v1(uuid,text,uuid,uuid)'::regprocedure);
  if position('private.guard_new_vocabulary_composition_v1' in d)=0 or position('private.initialize_vocabulary_composition_before_delete_v1' in d)=0 then raise exception 'm01_initialize_delete_guard_lost'; end if;
  d:=pg_get_functiondef('private.prepare_vocabulary_composition_data_v1(uuid,text,uuid,uuid)'::regprocedure);
  if position('private.guard_new_vocabulary_composition_v1' in d)=0 or position('private.prepare_vocabulary_composition_data_before_delete_v1' in d)=0 then raise exception 'm01_prepare_delete_guard_lost'; end if;
  d:=pg_get_functiondef('private.vocabulary_entry_choice_safety_v1(bigint,bigint[])'::regprocedure);
  if position($needle$l.source_snapshot#>'{occurrence,context_evidence,choice_safety}'$needle$ in d)=0 then raise exception 'm01_choice_safety_context_changed'; end if;
end;
$checks$;
drop function pg_temp.m01_replace(text,text,text,integer);
commit;
