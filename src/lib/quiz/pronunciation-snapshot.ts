const OFFICIAL_AUDIO_URL =
  /^https:\/\/media\.merriam-webster\.com\/audio\/prons\/en\/us\/mp3\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.mp3$/;

export type QuizPronunciation = {
  displayKo: string | null;
  variantId: string | null;
  audioUrl: string | null;
  available: boolean;
};

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function unavailablePronunciation(
  displayKo: string | null = null,
): QuizPronunciation {
  return {
    displayKo,
    variantId: null,
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
  const variantId = optionalText(snapshot.pronunciationVariantId);
  const audioUrl = optionalText(snapshot.audioUrl);
  const available =
    snapshot.audioStatus === "raw_attached" &&
    snapshot.listeningEnabled === true &&
    variantId !== null &&
    audioUrl !== null &&
    OFFICIAL_AUDIO_URL.test(audioUrl);

  return available
    ? { displayKo, variantId, audioUrl, available: true }
    : unavailablePronunciation(displayKo);
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

export function allChoiceAudioAvailable(
  pronunciations: readonly QuizPronunciation[],
) {
  return (
    pronunciations.length === 4 &&
    pronunciations.every((pronunciation) => pronunciation.available)
  );
}
