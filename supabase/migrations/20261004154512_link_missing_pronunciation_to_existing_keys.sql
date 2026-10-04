-- WORD-20261003-01: reference existing audio only at new assignment insertion.
begin;
set local lock_timeout='1s';
set local statement_timeout='30s';
do $$ begin
  if (select md5(prosrc) from pg_proc where oid='private.approved_pronunciation_scope_v1(text,text,integer)'::regprocedure) not in('a40503d2760140c507e2fcd65bda227f','00ce918ad9bc4bafb43af7b624ce1925') then raise exception 'word03_unexpected_definition: approved_pronunciation_scope_v1'; end if;
  if (select md5(prosrc) from pg_proc where oid='private.register_assignment_question_content_v1(public.assignment_questions)'::regprocedure) not in('e91db0b5d50580080a968f6542f2a68c','d6b906a6df173ec716730ed4a8c862b4') then raise exception 'word03_unexpected_definition: register_assignment_question_content_v1'; end if;
  if (select md5(prosrc) from pg_proc where oid='private.register_new_composition_question_ref_v1()'::regprocedure) not in('785359e91ba4be401318606eb9ad6600','324cae1dc937f6759b534701a09f96fd') then raise exception 'word03_unexpected_definition: register_new_composition_question_ref_v1'; end if;
  if (select md5(prosrc) from pg_proc where oid='private.vocabulary_question_content_payload_v1(private.vocabulary_question_content_versions)'::regprocedure) not in('ca196d8a30528b24cadb3011da36ed15','4edc083d7819c9c5885522a94304a258') then raise exception 'word03_unexpected_definition: vocabulary_question_content_payload_v1'; end if;
end; $$;

-- Use the original entry behind a selection. Never repair an assigned row.
create or replace function private.fill_missing_composition_audio_v1(p_version uuid,p_entry bigint,p jsonb)
returns jsonb language plpgsql stable set search_path='' as $$
declare ce private.vocabulary_composition_entries; e public.vocab_entries;
  candidates jsonb; chosen jsonb; project_ref text;
begin
  perform private.validate_vocabulary_pronunciation_v1(p);
  if p->>'available' is distinct from 'false' or p->>'audioUrl' is not null then return p; end if;
  select * into ce from private.vocabulary_composition_entries where version_id=p_version and vocab_entry_id=p_entry;
  select * into e from public.vocab_entries where id=ce.source_entry_id
    and lower(row_sha256)=lower(coalesce(ce.source_snapshot->>'rowHash',ce.source_snapshot#>>'{entry,row_sha256}'));
  if e.id is null then return p; end if;
  project_ref:=private.request_supabase_project_ref_v1();
  with options as (
    select 1 priority,i.pronunciation_variant_id variant_id,
      case when i.audio_provider='merriam_webster' then i.official_audio_url
        when project_ref ~ '^[a-z0-9]{20}$' then 'https://'||project_ref||'.supabase.co/storage/v1/object/public/'||i.storage_bucket||'/'||i.storage_object_key end audio_url
    from public.list_active_vocab_pronunciation_bindings_v3(array[e.id]) b
    join public.vocab_pronunciation_identities_v2 i on i.identity_id=b.identity_id
    where i.headword=e.headword and i.headword_normalized=e.headword_normalized
      and i.playback_enabled and i.display_enabled
      and (exists(select 1 from public.vocab_entry_pronunciation_bindings_v2 x
          join public.vocab_pronunciation_releases_v2 r on r.release_id=x.release_id and r.status='active'
          where x.release_id=b.release_id and x.vocab_entry_id=e.id and x.identity_id=i.identity_id
            and x.entry_row_sha256=upper(e.row_sha256))
        or exists(select 1 from private.reviewed_exam_entries x
          join private.reviewed_exam_releases r on r.release_id=x.release_id and r.status='active'
          where 'reviewed-exam:'||x.release_id::text=b.release_id and x.vocab_entry_id=e.id
            and x.pronunciation_identity_id=i.identity_id and x.entry_sha256=lower(e.row_sha256))
        or exists(select 1 from private.active_reviewed_entry_resources_v1(array[e.id]) x
          where 'reviewed-resources:'||x.release_id::text=b.release_id and x.vocab_entry_id=e.id
            and x.pronunciation_identity_id=i.identity_id and x.entry_sha256=lower(e.row_sha256)))
    union all
    select 2,r.selected_variant_id,r.selected_audio_url from public.vocab_entry_pronunciations r
    where r.vocab_entry_id=e.id and r.dataset_id=e.dataset_id and r.source_row=e.source_row
      and r.entry_row_sha256=upper(e.row_sha256) and r.headword_normalized=e.headword_normalized
      and r.provider='merriam_webster' and r.review_status='raw_unreviewed'
      and r.status='raw_first_variant_unreviewed' and r.listening_enabled
      and private.vocab_pronunciation_selection_matches_v1(r.variants,r.selected_variant_id,r.selected_audio_url)
      and exists(select 1 from jsonb_array_elements(r.raw_provenance) proof where
        proof->>'review_scope'='WORD-20261003-01' and proof->>'selection_status'='source_matched_audio'
        and proof->>'entry_row_sha256'=lower(e.row_sha256)
        and proof->>'variant_id'=r.selected_variant_id and proof->>'audio_url'=r.selected_audio_url
        and proof->>'selected_pos' is not distinct from r.selected_pos
        and proof->>'manifest_sha256' ~ '^[0-9a-f]{64}$')
    union all
    select 3,a.asset_id,'https://'||project_ref||'.supabase.co/storage/v1/object/public/'||a.storage_bucket||'/'||a.storage_object_key
    from public.vocab_synthetic_audio_bindings b
    join word_index.app_exam_use_occurrence o on o.release_id=b.release_id and o.vocab_entry_id=b.vocab_entry_id
      and o.occurrence_id=b.occurrence_id and o.dictionary_id=b.dictionary_id and o.include_in_exam
    join word_index.app_exam_use_release r on r.release_id=o.release_id and r.status='active'
      and r.dataset_key=b.dataset_key and r.package_version=b.source_exam_package_version
    join public.vocab_synthetic_audio_assets a on a.asset_id=b.asset_id and a.dictionary_id=b.dictionary_id and a.profile_id=b.profile_id
    where b.release_id=ce.source_release_id and b.vocab_entry_id=e.id
      and lower(o.source_projection_row_sha256)=lower(e.row_sha256)
      and a.speech_text=o.display_headword and a.speech_text=e.headword
      and a.provider='google_cloud_text_to_speech' and a.model='chirp3-hd' and a.voice='en-US-Chirp3-HD-Despina'
      and a.review_status='profile_approved_generated' and a.storage_verified and a.playback_enabled
      and not a.canonical_pronunciation_approval_implied and a.storage_bucket='vocab-pronunciation-audio'
      and a.request_sha256 ~ '^[0-9a-f]{64}$' and a.asset_id='synthetic:'||a.request_sha256
      and a.storage_object_key='pronunciation/google_cloud_text_to_speech/'||replace(a.profile_id,':','-')||'/'||a.request_sha256||'.mp3'
      and project_ref ~ '^[a-z0-9]{20}$'
      and ((a.dictionary_id like 'expression:%' and a.profile_id='profile:286866721f7f4ee8'
        and a.pronunciation_identity_type='dictionary_expression' and a.pronunciation_mode='provider_default_expression'
        and a.pronunciation_variant_id is null and a.canonical_ipa is null and a.google_tts_ipa is null)
      or (a.dictionary_id like 'word:%' and a.profile_id='profile:1a77d56d47e26013'
        and a.pronunciation_identity_type in('dictionary_word_surface','occurrence_word_phrase')
        and a.pronunciation_variant_id ~ '^tts(word|occ):[a-z0-9][a-z0-9:._-]*$'
        and ((a.pronunciation_mode='provider_default_word_surface' and a.canonical_ipa is null and a.google_tts_ipa is null)
          or (a.pronunciation_mode='custom_ipa_word_surface' and a.pronunciation_identity_type='dictionary_word_surface'
            and a.canonical_ipa is not null and a.google_tts_ipa is not null))))
  ), usable as (
    select distinct priority,variant_id,audio_url from options where audio_url is not null and variant_id is not null
      and (p->>'variantId' is null or p->>'variantId'=variant_id)
  ) select jsonb_agg(jsonb_build_object('variantId',variant_id,'audioUrl',audio_url)) into candidates
    from usable where priority=(select min(priority) from usable);
  -- Conflicting identities remain unresolved; normal values are never replaced.
  if jsonb_array_length(candidates) is distinct from 1 then return p; end if;
  chosen:=p||(candidates->0)||jsonb_build_object('available',true);
  perform private.validate_vocabulary_pronunciation_v1(chosen);
  return chosen;
end; $$;

create or replace function private.fill_new_composition_audio_v1(q public.assignment_questions)
returns jsonb language plpgsql stable set search_path='' as $$
declare result jsonb:=q.composition_pronunciation_snapshot; i integer;
begin
  result:=jsonb_set(result,'{target}',private.fill_missing_composition_audio_v1(q.composition_version_id_snapshot,q.vocab_entry_id,result->'target'));
  for i in 1..cardinality(q.choice_vocab_entry_ids) loop
    result:=jsonb_set(result,array['choices',(i-1)::text],private.fill_missing_composition_audio_v1(
      q.composition_version_id_snapshot,q.choice_vocab_entry_ids[i],result#>array['choices',(i-1)::text]));
  end loop;
  return result;
end; $$;

create or replace function private.assert_missing_composition_audio_fill_v1(before_value jsonb,after_value jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare old_slots jsonb; new_slots jsonb; old_slot jsonb; new_slot jsonb; i integer;
begin
  if before_value is null or after_value is null or jsonb_typeof(after_value) is distinct from 'object'
    or after_value-array['target','choices']<>'{}'::jsonb
    or jsonb_typeof(after_value->'choices') is distinct from 'array'
    or jsonb_array_length(after_value->'choices') is distinct from jsonb_array_length(before_value->'choices')
    then raise exception 'question_pronunciation_fill_invalid' using errcode='23514'; end if;
  old_slots:=jsonb_build_array(before_value->'target')||(before_value->'choices');
  new_slots:=jsonb_build_array(after_value->'target')||(after_value->'choices');
  for i in 0..jsonb_array_length(old_slots)-1 loop
    old_slot:=old_slots->i; new_slot:=new_slots->i;
    perform private.validate_vocabulary_pronunciation_v1(new_slot);
    if old_slot=new_slot then continue; end if;
    if old_slot->>'available' is distinct from 'false' or old_slot->>'audioUrl' is not null
      or new_slot->>'available' is distinct from 'true' or new_slot->>'audioUrl' is null
      or (old_slot->>'variantId' is not null and old_slot->>'variantId' is distinct from new_slot->>'variantId')
      or (old_slot-array['available','audioUrl','variantId']) is distinct from (new_slot-array['available','audioUrl','variantId'])
      then raise exception 'question_pronunciation_fill_invalid' using errcode='23514'; end if;
  end loop;
  return true;
end; $$;

revoke all on function private.fill_missing_composition_audio_v1(uuid,bigint,jsonb),
  private.fill_new_composition_audio_v1(public.assignment_questions),
  private.assert_missing_composition_audio_fill_v1(jsonb,jsonb) from public,anon,authenticated,service_role;


CREATE OR REPLACE FUNCTION private.approved_pronunciation_scope_v1(p_key text, p_sha text, p_count integer)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
  select exists(select 1 from (values
    ('simseok-g11-english2-ohseonyeong-l2-2026-sem2-school-v2', 'F0663E74565F387B816C3399EB76FCB42FFC452BB9BBAE1705778EFD3DAB37E9', 73),
    ('ability-voca-etymology-2025', '9FB5B8307C5E695853E2E0E49DE07DD9CD20D29BC59C749DED4D2D07B4C92133', 3001),
    ('simseok-g10-common-english2-ohseonyeong-l1-2026-sem2-v1', '039D9B3B5F2082F707830258A5A47280C36666A59DB53005012D27287FD050F1', 111),
    ('simseok-g10-common-english2-ohseonyeong-l2-2026-sem2-v1', '5E6AEE5AFDE8A44C6685E6FF92109FB3D300BCB856F0B7C942D9AB0E3686C8CB', 111),
    ('simseok-g10-sem2-mid-adjective-500-v1', 'A7891662F732A57C4F9ADE87E73D82875DB61C44760BCC0C57A863353DB428C5', 500),
    ('simseok-g11-english2-ohseonyeong-l1-2026-sem2-v1', '6876434435288010C844406C78C1C43B8AC3AB550A3FAC4C06A043F84536EBB4', 320),
    ('simseok-g11-english2-ohseonyeong-l2-2026-sem2-v1', '9384C2D8AA8D25C88F87444FC3D78570660B39CD8F2D9C844A7BB4D977EAAF08', 189),
    ('simseok-g11-sem2-mid-mock-v1', '22DB0FFA49960DCF28C6B612203364A664B4C83378366F26E538A6D42457F17F', 278)
  ) as scope(dataset_key, source_sha256, row_count)
    where scope.dataset_key = p_key and scope.source_sha256 = p_sha and scope.row_count = p_count);
$function$;

CREATE OR REPLACE FUNCTION private.register_assignment_question_content_v1(q public.assignment_questions)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare binding jsonb; payload jsonb; bank jsonb; source_sha text; keys text[]; study jsonb; filled jsonb;
begin
  binding:=private.vocabulary_question_binding_v1(q);
  payload:=private.vocabulary_question_json_fields_v1(to_jsonb(q),array['prompt','choices','headword_snapshot','primary_meaning_snapshot',
    'correct_answer_snapshot','composition_pronunciation_snapshot','notebook_pronunciation_snapshot']);
  if q.provenance_status='notebook_snapshot_v1' then
    study:=q.notebook_source_snapshot->'study';
    if study is not null and (jsonb_typeof(study) is distinct from 'object' or study-array[
      'entryId','currentHeadword','snapshotDisplayKo','dictionaryId','releaseId','displayKo','pronunciationSnapshot',
      'compositionPronunciation','notebookPronunciation','definition','example','exampleKo']<>'{}'::jsonb)
      then raise exception 'question_content_study_invalid' using errcode='22023'; end if;
    payload:=payload||jsonb_build_object('notebook_study',study);
  else payload:=payload||jsonb_build_object('provenance',q.provenance); end if;
  bank:=private.vocabulary_question_bank_body_v1(binding);
  if bank is not null then
    if exists(select 1 from jsonb_each(bank) e where payload->e.key is distinct from e.value)
      then raise exception 'question_content_source_mismatch' using errcode='23514'; end if;
    if q.provenance_status='composition_verified_v1' and q.id is not null and q.content_version_id is null
      and not exists(select 1 from public.assignment_questions where id=q.id) then
      filled:=private.fill_new_composition_audio_v1(q);
      perform private.assert_missing_composition_audio_fill_v1(bank->'composition_pronunciation_snapshot',filled);
    end if;
    select array_agg(k) into keys from jsonb_object_keys(bank) k;
    payload:=payload-keys;
    source_sha:=encode(extensions.digest(bank::text,'sha256'),'hex');
    if filled is not null and filled is distinct from bank->'composition_pronunciation_snapshot' then
      payload:=payload||jsonb_build_object('composition_pronunciation_snapshot',filled);
    end if;
  end if;
  return private.register_vocabulary_question_content_v1('assignment',
    private.vocabulary_question_scope_v1(array[q.vocab_entry_id]||coalesce(q.choice_vocab_entry_ids,'{}'::bigint[])),binding,payload,source_sha);
end;
$function$;

CREATE OR REPLACE FUNCTION private.register_new_composition_question_ref_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if new.provenance_status = 'composition_verified_v1' and new.content_version_id is null then
    perform private.assert_assignment_question_body_v1(new);
    new.content_version_id := private.register_assignment_question_content_v1(new);
    select private.vocabulary_question_content_payload_v1(v)->'composition_pronunciation_snapshot'
      into new.composition_pronunciation_snapshot from private.vocabulary_question_content_versions v where v.id=new.content_version_id;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION private.vocabulary_question_content_payload_v1(v private.vocabulary_question_content_versions)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare bank jsonb;
begin
  if v.id is null or v.content_sha256 is distinct from encode(extensions.digest(
    jsonb_build_array(1,v.kind,v.dataset_ids,v.binding,v.payload,v.source_body_sha256)::text,'sha256'),'hex')
    then raise exception 'question_content_unavailable' using errcode='55000'; end if;
  if v.payload->>'schemaVersion'='notebook-shared-body-ref-v1' then return private.notebook_shared_question_payload_v2(v); end if;
  if v.source_body_sha256 is null then return v.payload; end if;
  bank:=private.vocabulary_question_bank_body_v1(v.binding);
  if bank is null or encode(extensions.digest(bank::text,'sha256'),'hex') is distinct from v.source_body_sha256
    or exists(select 1 from jsonb_object_keys(bank) k where v.payload ? k and not(
      v.kind='assignment' and v.binding->>'composition_version_id_snapshot' is not null
      and k='composition_pronunciation_snapshot'))
    then raise exception 'question_content_source_changed' using errcode='55000'; end if;
  if v.kind='assignment' and v.binding->>'composition_version_id_snapshot' is not null
    and bank ? 'composition_pronunciation_snapshot' and v.payload ? 'composition_pronunciation_snapshot' then
    perform private.assert_missing_composition_audio_fill_v1(bank->'composition_pronunciation_snapshot',v.payload->'composition_pronunciation_snapshot');
    bank:=bank-'composition_pronunciation_snapshot';
  end if;
  return v.payload||bank;
end;
$function$;

notify pgrst,'reload schema';
commit;
