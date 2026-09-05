const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;
const SUPABASE_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const DICTIONARY_ID =
  /^(?:word|root_affix|expression):[a-z0-9][a-z0-9._'’-]*$/;
const SYNTHETIC_REQUEST_HASH = /^[0-9a-f]{64}$/;
const RULE_DERIVED_FINAL_VARIANT =
  /^(?:mw:[0-9a-f]{20}|synthetic:[0-9a-f]{64})$/;
const RULE_DERIVED_ENGINE_VERSIONS = new Set([
  "cmudict-hangul-align-v2",
  "cmudict-hangul-nucleus-align-v3",
]);
const EXPRESSION_SYNTHETIC_PROFILE_IDS = new Set([
  "profile:5b6efb0ecc8f4702",
  "profile:286866721f7f4ee8",
]);
const WORD_SYNTHETIC_PROFILE_IDS = new Set([
  "profile:75ca7f418d66e6ab",
  "profile:1a77d56d47e26013",
]);
const NORMAL_RATE_SYNTHETIC_PROFILE_IDS = new Set([
  "profile:286866721f7f4ee8",
  "profile:1a77d56d47e26013",
]);
const SYNTHETIC_BUCKET = "vocab-pronunciation-audio";
const SYNTHETIC_VARIANT_ID = /^tts(?:word|occ):[a-z0-9][a-z0-9:._-]*$/;
const VOCAB_PRONUNCIATION_IDENTITY_V2 = /^pron:v[23]:[0-9a-f]{64}$/;
const VOCAB_PRONUNCIATION_CONTENT_HASH_V2 = /^[0-9A-F]{64}$/;
const VOCAB_PRONUNCIATION_ENGINE_V2 = new Set([
  "cmudict-arpabet-hangul-render-v1",
  "cmudict-arpabet-hangul-nucleus-render-v2",
]);
function vocabPronunciationTtsPrefix(profileId: string) {
  return `pronunciation/google_cloud_text_to_speech/${profileId.replace(":", "-")}/ability-voca-etymology-2025-v1/`;
}

export type QuizPronunciation = {
  displayKo: string | null;
  segments?: readonly KoreanPronunciationSegment[];
  variantId: string | null;
  audioUrl: string | null;
  available: boolean;
};

export type KoreanPronunciationStress = "none" | "secondary" | "primary";

export type KoreanPronunciationSegment = {
  text: string;
  stress: KoreanPronunciationStress;
};

export type VocabPronunciationRegistryRow = {
  vocab_entry_id: number;
  provider: unknown;
  status: unknown;
  review_status: unknown;
  listening_enabled: unknown;
  selected_variant_id: unknown;
  selected_audio_url: unknown;
  variants: unknown;
  display_snapshot?: unknown;
};

export type VocabSyntheticAudioAssetRow = {
  asset_id: unknown;
  dictionary_id: unknown;
  speech_text: unknown;
  profile_id: unknown;
  provider: unknown;
  model: unknown;
  voice: unknown;
  pronunciation_variant_id: unknown;
  pronunciation_identity_type: unknown;
  pronunciation_mode: unknown;
  canonical_ipa: unknown;
  google_tts_ipa: unknown;
  request_sha256: unknown;
  storage_bucket: unknown;
  storage_object_key: unknown;
  review_status: unknown;
  storage_verified: unknown;
  playback_enabled: unknown;
  canonical_pronunciation_approval_implied: unknown;
};

export type VocabApprovedKoreanPronunciationRow = {
  dictionary_id: unknown;
  pronunciation_variant_id: unknown;
  display_pronunciation_ko: unknown;
  segments: unknown;
  review_status: unknown;
};

export type VocabRuleDerivedKoreanPronunciationRow = {
  dictionary_id: unknown;
  pronunciation_variant_id: unknown;
  display_pronunciation_ko: unknown;
  segments: unknown;
  derivation_status: unknown;
  engine_version: unknown;
  confidence: unknown;
  confidence_scope: unknown;
  stress_evidence: unknown;
  display_enabled: unknown;
};

export type VocabPronunciationIdentityV2Row = {
  identity_id: unknown;
  pronunciation_variant_id: unknown;
  audio_provider: unknown;
  official_audio_url: unknown;
  sound_audio: unknown;
  storage_bucket: unknown;
  storage_object_key: unknown;
  audio_sha256: unknown;
  byte_count: unknown;
  profile_id: unknown;
  request_sha256: unknown;
  model: unknown;
  voice: unknown;
  display_pronunciation_ko: unknown;
  segments: unknown;
  engine_version: unknown;
  playback_enabled: unknown;
  display_enabled: unknown;
  identity_content_sha256: unknown;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function syntheticAudioProfilePriority(value: unknown) {
  const profileId = optionalText(value);
  if (!profileId) return 0;
  if (NORMAL_RATE_SYNTHETIC_PROFILE_IDS.has(profileId)) return 2;
  return EXPRESSION_SYNTHETIC_PROFILE_IDS.has(profileId) ||
    WORD_SYNTHETIC_PROFILE_IDS.has(profileId)
    ? 1
    : 0;
}

export function sortSyntheticAudioBindingsByProfilePriority<
  T extends { asset_id: string },
>(bindings: readonly T[], priorityByAsset: ReadonlyMap<string, number>) {
  return [...bindings].sort(
    (left, right) =>
      (priorityByAsset.get(left.asset_id) ?? 0) -
        (priorityByAsset.get(right.asset_id) ?? 0) ||
      left.asset_id.localeCompare(right.asset_id),
  );
}

function segmentStress(value: unknown): KoreanPronunciationStress | null {
  if (value === true) return "primary";
  if (value === false) return "none";
  return value === "none" || value === "secondary" || value === "primary"
    ? value
    : null;
}

export function parseKoreanPronunciationSegments(
  value: unknown,
  displayKo: string | null,
): KoreanPronunciationSegment[] | undefined {
  if (!displayKo || !Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  const segments: KoreanPronunciationSegment[] = [];
  let primaryStressCount = 0;
  for (const rawSegment of value) {
    const segment = objectValue(rawSegment);
    const text = segment?.text;
    const stress = segmentStress(segment?.stress);
    if (typeof text !== "string" || text.length === 0 || stress === null) {
      return undefined;
    }
    if (stress === "primary") primaryStressCount += 1;
    segments.push({ text, stress });
  }
  return primaryStressCount >= 1 &&
    segments.map(({ text }) => text).join("") === displayKo
    ? segments
    : undefined;
}

export function unavailablePronunciation(
  displayKo: string | null = null,
  segments?: readonly KoreanPronunciationSegment[],
  variantId: string | null = null,
): QuizPronunciation {
  return {
    displayKo,
    ...(segments ? { segments } : {}),
    variantId,
    audioUrl: null,
    available: false,
  };
}

export function parseTargetPronunciation(
  value: unknown,
  displayFallback: string | null = null,
): QuizPronunciation {
  const snapshot = objectValue(value);
  if (!snapshot) return unavailablePronunciation(displayFallback);
  const displayKo =
    optionalText(snapshot.displayPronunciationKo) ?? displayFallback;
  const segments = parseKoreanPronunciationSegments(
    snapshot.koSegments ?? snapshot.ko_segments ?? snapshot.segments,
    displayKo,
  );
  const variantId = optionalText(snapshot.pronunciationVariantId);
  const audioUrl = optionalText(snapshot.audioUrl);
  const available =
    snapshot.audioStatus === "raw_attached" &&
    snapshot.listeningEnabled === true &&
    variantId !== null &&
    audioUrl !== null &&
    OFFICIAL_AUDIO_URL.test(audioUrl);

  return available
    ? {
        displayKo,
        ...(segments ? { segments } : {}),
        variantId,
        audioUrl,
        available: true,
      }
    : unavailablePronunciation(displayKo, segments, variantId);
}

export function parseChoicePronunciations(
  value: unknown,
  choices: readonly string[],
): QuizPronunciation[] {
  if (!Array.isArray(value) || value.length !== choices.length) {
    return choices.map(() => unavailablePronunciation());
  }
  const result = choices.map(() => unavailablePronunciation());
  const seenIndexes = new Set<number>();
  for (const rawItem of value) {
    const item = objectValue(rawItem);
    const choiceIndex = item?.choiceIndex;
    if (
      !item ||
      typeof choiceIndex !== "number" ||
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= choices.length ||
      seenIndexes.has(choiceIndex) ||
      optionalText(item.displayHeadword) !== choices[choiceIndex]
    ) {
      return choices.map(() => unavailablePronunciation());
    }
    seenIndexes.add(choiceIndex);
    result[choiceIndex] = parseTargetPronunciation({
      displayPronunciationKo: item.displayPronunciationKo,
      koSegments: item.koSegments ?? item.ko_segments ?? item.segments,
      pronunciationVariantId: item.pronunciationVariantId,
      audioStatus: item.audioStatus,
      audioUrl: item.audioUrl,
      listeningEnabled: item.listeningEnabled,
    });
  }
  return seenIndexes.size === choices.length
    ? result
    : choices.map(() => unavailablePronunciation());
}

export function parseChoiceDictionaryIds(
  value: unknown,
  choices: readonly string[],
): Array<string | null> {
  if (!Array.isArray(value) || value.length !== choices.length) {
    return choices.map(() => null);
  }
  const result = choices.map((): string | null => null);
  const seenIndexes = new Set<number>();
  for (const rawItem of value) {
    const item = objectValue(rawItem);
    const choiceIndex = item?.choiceIndex;
    const dictionaryId = optionalText(item?.dictionaryId);
    if (
      !item ||
      typeof choiceIndex !== "number" ||
      !Number.isInteger(choiceIndex) ||
      choiceIndex < 0 ||
      choiceIndex >= choices.length ||
      seenIndexes.has(choiceIndex) ||
      optionalText(item.displayHeadword) !== choices[choiceIndex] ||
      dictionaryId === null ||
      !DICTIONARY_ID.test(dictionaryId)
    ) {
      return choices.map(() => null);
    }
    seenIndexes.add(choiceIndex);
    result[choiceIndex] = dictionaryId;
  }
  return seenIndexes.size === choices.length ? result : choices.map(() => null);
}

export function parseRegistryPronunciation(
  row: VocabPronunciationRegistryRow | null | undefined,
): QuizPronunciation {
  if (
    !row ||
    row.provider !== "merriam_webster" ||
    !["raw_first_variant_unreviewed", "api_lookup_required"].includes(String(row.status)) ||
    row.review_status !== "raw_unreviewed"
  ) {
    return unavailablePronunciation();
  }
  const variantId = optionalText(row.selected_variant_id);
  const audioUrl = optionalText(row.selected_audio_url);
  const display = objectValue(row.display_snapshot);
  const derivedDisplay = display?.display_derivation_status === "rule_derived" &&
    display.display_engine_version === "cmudict-arpabet-hangul-nucleus-render-v2" &&
    optionalText(display.pronunciation_variant_id) === variantId
      ? optionalText(display.display_pronunciation_ko) : null;
  const segments = parseKoreanPronunciationSegments(display?.ko_segments, derivedDisplay);
  const displayValid = segments?.filter((segment) => segment.stress === "primary").length === 1;
  const unavailable = () => unavailablePronunciation(displayValid ? derivedDisplay : null, displayValid ? segments : undefined, variantId);
  if (
    row.listening_enabled !== true ||
    row.status !== "raw_first_variant_unreviewed" ||
    !variantId ||
    !audioUrl ||
    !OFFICIAL_AUDIO_URL.test(audioUrl) ||
    !Array.isArray(row.variants)
  ) {
    return unavailable();
  }
  const selected = row.variants.map(objectValue).find((variant) => {
    return (
      optionalText(variant?.variant_id) === variantId &&
      optionalText(variant?.audio_url) === audioUrl
    );
  });
  return selected
    ? {
        displayKo: displayValid ? derivedDisplay : null,
        ...(displayValid ? { segments } : {}),
        variantId,
        audioUrl,
        available: true,
      }
    : unavailablePronunciation();
}

export function parseSyntheticRegistryPronunciation(
  row: VocabSyntheticAudioAssetRow | null | undefined,
  supabaseUrl: string,
): QuizPronunciation {
  const normalizedUrl = supabaseUrl.replace(/\/$/, "");
  const requestHash = optionalText(row?.request_sha256);
  const assetId = optionalText(row?.asset_id);
  const dictionaryId = optionalText(row?.dictionary_id);
  const speechText = optionalText(row?.speech_text);
  const profileId = optionalText(row?.profile_id);
  const pronunciationVariantId = optionalText(row?.pronunciation_variant_id);
  const canonicalIpa = optionalText(row?.canonical_ipa);
  const googleTtsIpa = optionalText(row?.google_tts_ipa);
  const objectKey = optionalText(row?.storage_object_key);
  const expectedObjectKey = requestHash && profileId
    ? `pronunciation/google_cloud_text_to_speech/${profileId.replace(":", "-")}/${requestHash}.mp3`
    : null;
  const expressionIdentity =
    dictionaryId?.startsWith("expression:") === true &&
    profileId !== null &&
    EXPRESSION_SYNTHETIC_PROFILE_IDS.has(profileId) &&
    row?.pronunciation_identity_type === "dictionary_expression" &&
    row?.pronunciation_mode === "provider_default_expression" &&
    pronunciationVariantId === null &&
    canonicalIpa === null &&
    googleTtsIpa === null;
  const wordDefaultIdentity =
    dictionaryId?.startsWith("word:") === true &&
    profileId !== null &&
    WORD_SYNTHETIC_PROFILE_IDS.has(profileId) &&
    (row?.pronunciation_identity_type === "dictionary_word_surface" ||
      row?.pronunciation_identity_type === "occurrence_word_phrase") &&
    row?.pronunciation_mode === "provider_default_word_surface" &&
    pronunciationVariantId !== null &&
    SYNTHETIC_VARIANT_ID.test(pronunciationVariantId) &&
    canonicalIpa === null &&
    googleTtsIpa === null;
  const wordCustomIpaIdentity =
    dictionaryId?.startsWith("word:") === true &&
    profileId !== null &&
    WORD_SYNTHETIC_PROFILE_IDS.has(profileId) &&
    row?.pronunciation_identity_type === "dictionary_word_surface" &&
    row?.pronunciation_mode === "custom_ipa_word_surface" &&
    pronunciationVariantId !== null &&
    SYNTHETIC_VARIANT_ID.test(pronunciationVariantId) &&
    canonicalIpa !== null &&
    googleTtsIpa !== null;
  if (
    !row ||
    !SUPABASE_URL.test(normalizedUrl) ||
    !dictionaryId ||
    !DICTIONARY_ID.test(dictionaryId) ||
    !speechText ||
    row.provider !== "google_cloud_text_to_speech" ||
    row.model !== "chirp3-hd" ||
    row.voice !== "en-US-Chirp3-HD-Despina" ||
    (!expressionIdentity && !wordDefaultIdentity && !wordCustomIpaIdentity) ||
    row.review_status !== "profile_approved_generated" ||
    row.storage_verified !== true ||
    row.playback_enabled !== true ||
    row.canonical_pronunciation_approval_implied !== false ||
    row.storage_bucket !== SYNTHETIC_BUCKET ||
    !requestHash ||
    !SYNTHETIC_REQUEST_HASH.test(requestHash) ||
    assetId !== `synthetic:${requestHash}` ||
    objectKey !== expectedObjectKey
  ) {
    return unavailablePronunciation();
  }
  return {
    displayKo: null,
    variantId: assetId,
    audioUrl: `${normalizedUrl}/storage/v1/object/public/${SYNTHETIC_BUCKET}/${objectKey}`,
    available: true,
  };
}

export function syntheticPronunciationBindingKey(
  releaseId: string,
  vocabEntryId: number,
) {
  return `${releaseId}\u0000${vocabEntryId}`;
}

export function approvedKoreanPronunciationKey(
  dictionaryId: string,
  variantId: string,
) {
  return `${dictionaryId}\u0000${variantId}`;
}

export function mergeKoreanPronunciationRegistries(
  approved: ReadonlyMap<string, QuizPronunciation>,
  ruleDerived: ReadonlyMap<string, QuizPronunciation>,
) {
  const effective = new Map(ruleDerived);
  for (const [key, pronunciation] of approved) {
    effective.set(key, pronunciation);
  }
  return effective;
}

export function parseApprovedKoreanPronunciation(
  row: VocabApprovedKoreanPronunciationRow | null | undefined,
): QuizPronunciation | undefined {
  const dictionaryId = optionalText(row?.dictionary_id);
  const variantId = optionalText(row?.pronunciation_variant_id);
  const displayKo = optionalText(row?.display_pronunciation_ko);
  if (
    !row ||
    row.review_status !== "approved" ||
    !dictionaryId ||
    !DICTIONARY_ID.test(dictionaryId) ||
    !variantId ||
    !displayKo
  ) {
    return undefined;
  }
  const segments = parseKoreanPronunciationSegments(row.segments, displayKo);
  return segments
    ? {
        displayKo,
        segments,
        variantId,
        audioUrl: null,
        available: false,
      }
    : undefined;
}

export function parseRuleDerivedKoreanPronunciation(
  row: VocabRuleDerivedKoreanPronunciationRow | null | undefined,
): QuizPronunciation | undefined {
  const dictionaryId = optionalText(row?.dictionary_id);
  const variantId = optionalText(row?.pronunciation_variant_id);
  const displayKo = optionalText(row?.display_pronunciation_ko);
  if (
    !row ||
    row.derivation_status !== "rule_derived" ||
    !RULE_DERIVED_ENGINE_VERSIONS.has(String(row.engine_version)) ||
    !["high", "medium", "low"].includes(String(row.confidence)) ||
    row.confidence_scope !== "hangul_alignment_only" ||
    ![
      "selected_webster_lexical_stress",
      "cmudict_lexical_stress_phrase_rule",
      "cmudict_lexical_stress",
    ].includes(String(row.stress_evidence)) ||
    row.display_enabled !== true ||
    !dictionaryId ||
    !DICTIONARY_ID.test(dictionaryId) ||
    !variantId ||
    !RULE_DERIVED_FINAL_VARIANT.test(variantId) ||
    !displayKo
  ) {
    return undefined;
  }
  const segments = parseKoreanPronunciationSegments(row.segments, displayKo);
  if (
    !segments ||
    segments.filter(({ stress }) => stress === "primary").length !== 1
  ) {
    return undefined;
  }
  return {
    displayKo,
    segments,
    variantId,
    audioUrl: null,
    available: false,
  };
}

export function parseVocabPronunciationIdentityV2(
  row: VocabPronunciationIdentityV2Row | null | undefined,
  supabaseUrl: string,
): QuizPronunciation | undefined {
  const normalizedUrl = supabaseUrl.replace(/\/$/, "");
  const identityId = optionalText(row?.identity_id);
  const variantId = optionalText(row?.pronunciation_variant_id);
  const displayKo = optionalText(row?.display_pronunciation_ko);
  const contentHash = optionalText(row?.identity_content_sha256);
  const engineVersion = optionalText(row?.engine_version);
  const generationMatches =
    (identityId?.startsWith("pron:v2:") === true &&
      engineVersion === "cmudict-arpabet-hangul-render-v1") ||
    (identityId?.startsWith("pron:v3:") === true &&
      engineVersion === "cmudict-arpabet-hangul-nucleus-render-v2");
  if (
    !row ||
    !SUPABASE_URL.test(normalizedUrl) ||
    !identityId ||
    !VOCAB_PRONUNCIATION_IDENTITY_V2.test(identityId) ||
    !variantId ||
    !RULE_DERIVED_FINAL_VARIANT.test(variantId) ||
    !displayKo ||
    !engineVersion ||
    !VOCAB_PRONUNCIATION_ENGINE_V2.has(engineVersion) ||
    !generationMatches ||
    row.playback_enabled !== true ||
    row.display_enabled !== true ||
    !contentHash ||
    !VOCAB_PRONUNCIATION_CONTENT_HASH_V2.test(contentHash)
  ) {
    return undefined;
  }
  const segments = parseKoreanPronunciationSegments(row.segments, displayKo);
  if (
    !segments ||
    segments.filter(({ stress }) => stress === "primary").length !== 1
  ) {
    return undefined;
  }
  if (row.audio_provider === "merriam_webster") {
    const audioUrl = optionalText(row.official_audio_url);
    if (
      !variantId.startsWith("mw:") ||
      !audioUrl ||
      !OFFICIAL_AUDIO_URL.test(audioUrl) ||
      !optionalText(row.sound_audio) ||
      row.storage_bucket !== null ||
      row.storage_object_key !== null ||
      row.audio_sha256 !== null ||
      row.byte_count !== null ||
      row.profile_id !== null ||
      row.request_sha256 !== null ||
      row.model !== null ||
      row.voice !== null
    ) {
      return undefined;
    }
    return {
      displayKo,
      segments,
      variantId,
      audioUrl,
      available: true,
    };
  }
  const requestHash = optionalText(row.request_sha256);
  const audioHash = optionalText(row.audio_sha256);
  const objectKey = optionalText(row.storage_object_key);
  const profileId = optionalText(row.profile_id);
  if (
    row.audio_provider !== "google_cloud_text_to_speech" ||
    !requestHash ||
    !SYNTHETIC_REQUEST_HASH.test(requestHash) ||
    variantId !== `synthetic:${requestHash}` ||
    row.official_audio_url !== null ||
    row.sound_audio !== null ||
    row.storage_bucket !== SYNTHETIC_BUCKET ||
    !profileId ||
    !WORD_SYNTHETIC_PROFILE_IDS.has(profileId) ||
    objectKey !== `${vocabPronunciationTtsPrefix(profileId)}${requestHash}.mp3` ||
    !audioHash ||
    !SYNTHETIC_REQUEST_HASH.test(audioHash) ||
    typeof row.byte_count !== "number" ||
    !Number.isInteger(row.byte_count) ||
    row.byte_count < 128 ||
    row.model !== "chirp3-hd" ||
    row.voice !== "en-US-Chirp3-HD-Despina"
  ) {
    return undefined;
  }
  return {
    displayKo,
    segments,
    variantId,
    audioUrl: `${normalizedUrl}/storage/v1/object/public/${SYNTHETIC_BUCKET}/${objectKey}`,
    available: true,
  };
}

export function withApprovedKoreanPronunciation(
  pronunciation: QuizPronunciation,
  approved: QuizPronunciation | undefined,
) {
  if (
    !approved?.segments ||
    !approved.displayKo ||
    approved.variantId !== pronunciation.variantId
  ) {
    return pronunciation;
  }
  return {
    ...pronunciation,
    displayKo: approved.displayKo,
    segments: approved.segments,
  };
}

export function preferredPronunciation(
  snapshot: QuizPronunciation,
  officialRegistry: QuizPronunciation | undefined,
  syntheticRegistry: QuizPronunciation | undefined,
) {
  if (snapshot.available) return snapshot;
  const fallback = officialRegistry?.available
    ? officialRegistry
    : syntheticRegistry?.available
      ? syntheticRegistry
      : undefined;
  return fallback
    ? {
        ...fallback,
        displayKo: fallback.displayKo ?? snapshot.displayKo,
        ...(fallback.segments
          ? { segments: fallback.segments }
          : fallback.variantId === snapshot.variantId && snapshot.segments
            ? { segments: snapshot.segments }
            : {}),
      }
    : snapshot.displayKo
      ? unavailablePronunciation(snapshot.displayKo, snapshot.segments)
      : unavailablePronunciation(officialRegistry?.displayKo ?? null, officialRegistry?.segments);
}

export function preferredPronunciationWithApprovedKorean(
  dictionaryId: string | null | undefined,
  snapshot: QuizPronunciation,
  officialRegistry: QuizPronunciation | undefined,
  syntheticRegistry: QuizPronunciation | undefined,
  approvedRegistry: ReadonlyMap<string, QuizPronunciation>,
) {
  const preferred = preferredPronunciation(
    snapshot,
    officialRegistry,
    syntheticRegistry,
  );
  const approved =
    typeof dictionaryId === "string" &&
    typeof preferred.variantId === "string"
      ? approvedRegistry.get(
          approvedKoreanPronunciationKey(dictionaryId, preferred.variantId),
        )
      : undefined;
  return withApprovedKoreanPronunciation(preferred, approved);
}

export function preferredPronunciationWithActiveVocaRelease(
  dictionaryId: string | null | undefined,
  snapshot: QuizPronunciation,
  activeVocaRelease: QuizPronunciation | undefined,
  officialRegistry: QuizPronunciation | undefined,
  syntheticRegistry: QuizPronunciation | undefined,
  approvedRegistry: ReadonlyMap<string, QuizPronunciation>,
) {
  if (!snapshot.available && activeVocaRelease?.available) {
    return activeVocaRelease;
  }
  return preferredPronunciationWithApprovedKorean(
    dictionaryId,
    snapshot,
    officialRegistry,
    syntheticRegistry,
    approvedRegistry,
  );
}

export function withPronunciationDisplay(
  pronunciation: QuizPronunciation,
  displayKo: string | null | undefined,
) {
  return pronunciation.displayKo || !displayKo
    ? pronunciation
    : { ...pronunciation, displayKo };
}

export function allChoiceAudioAvailable(
  pronunciations: readonly QuizPronunciation[],
) {
  return (
    pronunciations.length === 4 &&
    pronunciations.every((pronunciation) => pronunciation.available)
  );
}
