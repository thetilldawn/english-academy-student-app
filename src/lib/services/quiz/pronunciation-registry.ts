import "server-only";

import {
  approvedKoreanPronunciationKey,
  mergeKoreanPronunciationRegistries,
  parseApprovedKoreanPronunciation,
  parseRegistryPronunciation,
  parseRuleDerivedKoreanPronunciation,
  parseSyntheticRegistryPronunciation,
  parseVocabPronunciationIdentityV2,
  sortSyntheticAudioBindingsByProfilePriority,
  syntheticAudioProfilePriority,
  syntheticPronunciationBindingKey,
  type QuizPronunciation,
  type VocabApprovedKoreanPronunciationRow,
  type VocabPronunciationIdentityV2Row,
  type VocabPronunciationRegistryRow,
  type VocabRuleDerivedKoreanPronunciationRow,
  type VocabSyntheticAudioAssetRow,
} from "@/lib/quiz/pronunciation-snapshot";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export async function loadVocabPronunciationRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, QuizPronunciation>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(vocabEntryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_entry_pronunciations")
      .select(
        "vocab_entry_id, provider, status, review_status, listening_enabled, selected_variant_id, selected_audio_url, variants",
      )
      .in("vocab_entry_id", chunk)
      .eq("listening_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] registry lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabPronunciationRegistryRow[]) {
      const pronunciation = parseRegistryPronunciation(row);
      if (pronunciation.available) {
        result.set(row.vocab_entry_id, pronunciation);
      }
    }
  }
  return result;
}

export async function loadActiveVocabPronunciationReleaseRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, QuizPronunciation>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const uniqueIds = [...new Set(vocabEntryIds)];
  const { data: releaseData, error: releaseError } = await supabase
    .from("vocab_pronunciation_releases_v2")
    .select("release_id")
    .eq("status", "active");
  if (releaseError) {
    console.warn("[quiz-pronunciation] active VOCA release lookup failed", {
      code: releaseError.code,
    });
    return result;
  }
  const activeReleaseIds = [
    ...new Set(
      (releaseData ?? []).flatMap((row) =>
        typeof row.release_id === "string" ? [row.release_id] : [],
      ),
    ),
  ];
  if (activeReleaseIds.length === 0) return result;
  const bindings: Array<{
    release_id: string;
    vocab_entry_id: number;
    identity_id: string;
  }> = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 400) {
    const chunk = uniqueIds.slice(offset, offset + 400);
    const { data, error } = await supabase
      .from("vocab_entry_pronunciation_bindings_v2")
      .select("release_id, vocab_entry_id, identity_id")
      .in("vocab_entry_id", chunk)
      .in("release_id", activeReleaseIds)
      .eq("is_entry_default", true);
    if (error) {
      console.warn("[quiz-pronunciation] active VOCA binding lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of data ?? []) {
      if (
        typeof row.release_id === "string" &&
        typeof row.vocab_entry_id === "number" &&
        uniqueIds.includes(row.vocab_entry_id) &&
        typeof row.identity_id === "string"
      ) {
        bindings.push({
          release_id: row.release_id,
          vocab_entry_id: row.vocab_entry_id,
          identity_id: row.identity_id,
        });
      }
    }
  }
  const identityIds = [
    ...new Set(bindings.map(({ identity_id }) => identity_id)),
  ];
  const pronunciationsByIdentity = new Map<string, QuizPronunciation>();
  for (let offset = 0; offset < identityIds.length; offset += 80) {
    const chunk = identityIds.slice(offset, offset + 80);
    const { data, error } = await supabase
      .from("vocab_pronunciation_identities_v2")
      .select(
        "identity_id, pronunciation_variant_id, audio_provider, official_audio_url, sound_audio, storage_bucket, storage_object_key, audio_sha256, byte_count, profile_id, request_sha256, model, voice, display_pronunciation_ko, segments, engine_version, playback_enabled, display_enabled, identity_content_sha256",
      )
      .in("identity_id", chunk)
      .eq("playback_enabled", true)
      .eq("display_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] active VOCA identity lookup failed", {
        code: error.code,
      });
      return new Map<number, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabPronunciationIdentityV2Row[]) {
      const pronunciation = parseVocabPronunciationIdentityV2(row, supabaseUrl);
      if (pronunciation && typeof row.identity_id === "string") {
        pronunciationsByIdentity.set(row.identity_id, pronunciation);
      }
    }
  }
  for (const binding of bindings) {
    const pronunciation = pronunciationsByIdentity.get(binding.identity_id);
    if (pronunciation) result.set(binding.vocab_entry_id, pronunciation);
  }
  return result;
}

export async function loadVocabPronunciationDisplayRegistry(
  vocabEntryIds: readonly number[],
) {
  const result = new Map<number, string>();
  if (vocabEntryIds.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(vocabEntryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_entries")
      .select("id, pronunciation_ko")
      .in("id", chunk);
    if (error) {
      console.warn("[quiz-pronunciation] display lookup failed", {
        code: error.code,
      });
      return new Map<number, string>();
    }
    for (const row of data ?? []) {
      if (
        typeof row.id === "number" &&
        typeof row.pronunciation_ko === "string" &&
        row.pronunciation_ko.trim()
      ) {
        result.set(row.id, row.pronunciation_ko.trim());
      }
    }
  }
  return result;
}

export async function loadSyntheticPronunciationRegistry(
  bindings: readonly { releaseId: string; vocabEntryId: number }[],
) {
  const result = new Map<string, QuizPronunciation>();
  if (bindings.length === 0) return result;
  const supabase = getServiceSupabaseClient();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const vocabIdsByRelease = new Map<string, Set<number>>();
  for (const { releaseId, vocabEntryId } of bindings) {
    const ids = vocabIdsByRelease.get(releaseId) ?? new Set<number>();
    ids.add(vocabEntryId);
    vocabIdsByRelease.set(releaseId, ids);
  }
  const acceptedBindings: Array<{
    release_id: string;
    vocab_entry_id: number;
    asset_id: string;
  }> = [];
  const bindingChunkSize = 400;
  for (const [releaseId, ids] of vocabIdsByRelease) {
    const vocabEntryIds = [...ids];
    for (
      let offset = 0;
      offset < vocabEntryIds.length;
      offset += bindingChunkSize
    ) {
      const chunk = vocabEntryIds.slice(offset, offset + bindingChunkSize);
      const { data: bindingData, error: bindingError } = await supabase
        .from("vocab_synthetic_audio_bindings")
        .select("release_id, vocab_entry_id, asset_id")
        .eq("release_id", releaseId)
        .in("vocab_entry_id", chunk);
      if (bindingError) {
        console.warn("[quiz-pronunciation] synthetic binding lookup failed", {
          code: bindingError.code,
        });
        return new Map<string, QuizPronunciation>();
      }
      for (const row of bindingData ?? []) {
        if (
          row.release_id === releaseId &&
          typeof row.vocab_entry_id === "number" &&
          ids.has(row.vocab_entry_id) &&
          typeof row.asset_id === "string"
        ) {
          acceptedBindings.push({
            release_id: row.release_id,
            vocab_entry_id: row.vocab_entry_id,
            asset_id: row.asset_id,
          });
        }
      }
    }
  }
  const assetIds = [
    ...new Set(acceptedBindings.map((binding) => binding.asset_id)),
  ];
  if (assetIds.length === 0) return result;
  const assetData: VocabSyntheticAudioAssetRow[] = [];
  const assetChunkSize = 80;
  for (let offset = 0; offset < assetIds.length; offset += assetChunkSize) {
    const chunk = assetIds.slice(offset, offset + assetChunkSize);
    const { data, error: assetError } = await supabase
      .from("vocab_synthetic_audio_assets")
      .select(
        "asset_id, dictionary_id, speech_text, profile_id, provider, model, voice, pronunciation_variant_id, pronunciation_identity_type, pronunciation_mode, canonical_ipa, google_tts_ipa, request_sha256, storage_bucket, storage_object_key, review_status, storage_verified, playback_enabled, canonical_pronunciation_approval_implied",
      )
      .in("asset_id", chunk)
      .eq("playback_enabled", true);
    if (assetError) {
      console.warn("[quiz-pronunciation] synthetic asset lookup failed", {
        code: assetError.code,
      });
      return new Map<string, QuizPronunciation>();
    }
    assetData.push(...((data ?? []) as VocabSyntheticAudioAssetRow[]));
  }
  const pronunciationByAsset = new Map<string, QuizPronunciation>();
  const priorityByAsset = new Map<string, number>();
  for (const row of assetData) {
    const pronunciation = parseSyntheticRegistryPronunciation(row, supabaseUrl);
    if (pronunciation.available && typeof row.asset_id === "string") {
      pronunciationByAsset.set(row.asset_id, pronunciation);
      priorityByAsset.set(
        row.asset_id,
        syntheticAudioProfilePriority(row.profile_id),
      );
    }
  }
  const preferredBindings = sortSyntheticAudioBindingsByProfilePriority(
    acceptedBindings,
    priorityByAsset,
  );
  for (const binding of preferredBindings) {
    const pronunciation = pronunciationByAsset.get(binding.asset_id);
    if (pronunciation) {
      result.set(
        syntheticPronunciationBindingKey(
          binding.release_id,
          binding.vocab_entry_id,
        ),
        pronunciation,
      );
    }
  }
  return result;
}

export async function loadApprovedKoreanPronunciationRegistry(
  dictionaryIds: readonly string[],
) {
  const approvedResult = new Map<string, QuizPronunciation>();
  if (dictionaryIds.length === 0) return approvedResult;
  const supabase = getServiceSupabaseClient();
  const uniqueIds = [...new Set(dictionaryIds)];
  const chunkSize = 500;
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_approved_korean_pronunciations")
      .select(
        "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, review_status",
      )
      .in("dictionary_id", chunk)
      .eq("review_status", "approved");
    if (error) {
      console.warn("[quiz-pronunciation] approved display lookup failed", {
        code: error.code,
      });
      return new Map<string, QuizPronunciation>();
    }
    for (const row of (data ?? []) as VocabApprovedKoreanPronunciationRow[]) {
      const pronunciation = parseApprovedKoreanPronunciation(row);
      if (
        pronunciation?.variantId &&
        typeof row.dictionary_id === "string"
      ) {
        approvedResult.set(
          approvedKoreanPronunciationKey(
            row.dictionary_id,
            pronunciation.variantId,
          ),
          pronunciation,
        );
      }
    }
  }
  const ruleDerivedResult = new Map<string, QuizPronunciation>();
  for (let offset = 0; offset < uniqueIds.length; offset += chunkSize) {
    const chunk = uniqueIds.slice(offset, offset + chunkSize);
    const { data, error } = await supabase
      .from("vocab_rule_derived_korean_pronunciations")
      .select(
        "dictionary_id, pronunciation_variant_id, display_pronunciation_ko, segments, derivation_status, engine_version, confidence, confidence_scope, stress_evidence, display_enabled",
      )
      .in("dictionary_id", chunk)
      .eq("display_enabled", true);
    if (error) {
      console.warn("[quiz-pronunciation] rule-derived display lookup failed", {
        code: error.code,
      });
      return approvedResult;
    }
    for (const row of (data ?? []) as VocabRuleDerivedKoreanPronunciationRow[]) {
      const pronunciation = parseRuleDerivedKoreanPronunciation(row);
      if (pronunciation?.variantId && typeof row.dictionary_id === "string") {
        const key = approvedKoreanPronunciationKey(
          row.dictionary_id,
          pronunciation.variantId,
        );
        ruleDerivedResult.set(key, pronunciation);
      }
    }
  }
  return mergeKoreanPronunciationRegistries(
    approvedResult,
    ruleDerivedResult,
  );
}

