const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;
const SUPABASE_URL = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const DICTIONARY_ID =
  /^(?:word|root_affix|expression):[a-z0-9][a-z0-9._'’-]*$/;
const SYNTHETIC_REQUEST_HASH = /^[0-9a-f]{64}$/;
const SYNTHETIC_PROFILE_ID = "profile:5b6efb0ecc8f4702";
const SYNTHETIC_BUCKET = "vocab-pronunciation-audio";

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
};

export type VocabSyntheticAudioAssetRow = {
  asset_id: unknown;
  dictionary_id: unknown;
  profile_id: unknown;
  provider: unknown;
  model: unknown;
  voice: unknown;
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

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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
    row.status !== "raw_first_variant_unreviewed" ||
    row.review_status !== "raw_unreviewed" ||
    row.listening_enabled !== true
  ) {
    return unavailablePronunciation();
  }
  const variantId = optionalText(row.selected_variant_id);
  const audioUrl = optionalText(row.selected_audio_url);
  if (
    !variantId ||
    !audioUrl ||
    !OFFICIAL_AUDIO_URL.test(audioUrl) ||
    !Array.isArray(row.variants)
  ) {
    return unavailablePronunciation();
  }
  const selectionExists = row.variants.some((rawVariant) => {
    const variant = objectValue(rawVariant);
    return (
      optionalText(variant?.variant_id) === variantId &&
      optionalText(variant?.audio_url) === audioUrl
    );
  });
  return selectionExists
    ? {
        displayKo: null,
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
  const objectKey = optionalText(row?.storage_object_key);
  const expectedObjectKey = requestHash
    ? `pronunciation/google_cloud_text_to_speech/${SYNTHETIC_PROFILE_ID.replace(":", "-")}/${requestHash}.mp3`
    : null;
  if (
    !row ||
    !SUPABASE_URL.test(normalizedUrl) ||
    !dictionaryId ||
    !DICTIONARY_ID.test(dictionaryId) ||
    row.provider !== "google_cloud_text_to_speech" ||
    row.model !== "chirp3-hd" ||
    row.voice !== "en-US-Chirp3-HD-Despina" ||
    row.profile_id !== SYNTHETIC_PROFILE_ID ||
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

export function approvedKoreanPronunciationKey(
  dictionaryId: string,
  variantId: string,
) {
  return `${dictionaryId}\u0000${variantId}`;
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
    : unavailablePronunciation(snapshot.displayKo, snapshot.segments);
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
