import type { QuizDirection, QuizVocabularyEntry, RandomSource } from "./question-types";
import { normalizeQuizChoice, normalizeQuizHeadword, quizVocabularyIdentity } from "./word-identity";
import { shuffle } from "./random";

export const DISTRACTOR_POLICY_VERSION = "shape-v1";

export function canUseDirection(
  entry: QuizVocabularyEntry,
  direction: QuizDirection,
) {
  return (
    entry.eligibleDirections === undefined ||
    entry.eligibleDirections.includes(direction)
  );
}

function buildDirectionalChoiceSets(
  candidates: readonly QuizVocabularyEntry[],
) {
  const englishCandidates = candidates.filter((entry) =>
    canUseDirection(entry, "english_to_korean"),
  );
  const koreanCandidates = candidates.filter((entry) =>
    canUseDirection(entry, "korean_to_english"),
  );

  return { englishCandidates, koreanCandidates };
}

function buildDirectionalTargetSets(
  targets: readonly QuizVocabularyEntry[],
) {
  const meaningsByEnglishPrompt = new Map<string, Set<string>>();
  const headwordsByKoreanPrompt = new Map<string, Set<string>>();

  for (const entry of targets) {
    if (canUseDirection(entry, "english_to_korean")) {
      const promptKey = normalizeQuizHeadword(entry.headword);
      const answers = meaningsByEnglishPrompt.get(promptKey) ?? new Set();
      answers.add(normalizeQuizChoice(entry.primaryMeaning));
      meaningsByEnglishPrompt.set(promptKey, answers);
    }
    if (canUseDirection(entry, "korean_to_english")) {
      const promptKey = normalizeQuizChoice(entry.primaryMeaning);
      const answers = headwordsByKoreanPrompt.get(promptKey) ?? new Set();
      answers.add(normalizeQuizHeadword(entry.headword));
      headwordsByKoreanPrompt.set(promptKey, answers);
    }
  }

  const englishCandidates = targets.filter(
    (entry) =>
      canUseDirection(entry, "english_to_korean") &&
      meaningsByEnglishPrompt.get(
        normalizeQuizHeadword(entry.headword),
      )?.size === 1,
  );
  const koreanCandidates = targets.filter(
    (entry) =>
      canUseDirection(entry, "korean_to_english") &&
      headwordsByKoreanPrompt.get(
        normalizeQuizChoice(entry.primaryMeaning),
      )?.size === 1,
  );

  return {
    englishCandidates,
    koreanCandidates,
    englishCandidateIds: new Set(
      englishCandidates.map((entry) => entry.id),
    ),
    koreanCandidateIds: new Set(
      koreanCandidates.map((entry) => entry.id),
    ),
  };
}

export function buildDirectionalQuestionSets(
  targets: readonly QuizVocabularyEntry[],
  choiceCandidates: readonly QuizVocabularyEntry[],
) {
  const targetSets = buildDirectionalTargetSets(targets);
  const {
    englishCandidates: englishChoiceCandidates,
    koreanCandidates: koreanChoiceCandidates,
  } = buildDirectionalChoiceSets(choiceCandidates);
  const englishCandidates = targetSets.englishCandidates.filter(
    (entry) =>
      hasMinimumDistinctDistractors(
        entry,
        englishChoiceCandidates,
        "english_to_korean",
        (candidate) => candidate.primaryMeaning,
      ),
  );
  const koreanCandidates = targetSets.koreanCandidates.filter(
    (entry) =>
      hasMinimumDistinctDistractors(
        entry,
        koreanChoiceCandidates,
        "korean_to_english",
        (candidate) => candidate.headword,
      ),
  );

  return {
    englishCandidates,
    koreanCandidates,
    englishCandidateIds: new Set(
      englishCandidates.map((entry) => entry.id),
    ),
    koreanCandidateIds: new Set(
      koreanCandidates.map((entry) => entry.id),
    ),
    promptSafeCandidateIds: new Set([
      ...targetSets.englishCandidateIds,
      ...targetSets.koreanCandidateIds,
    ]),
  };
}

/** Returns the directions that are safe for each exact target occurrence. */
export function quizTargetDirectionEligibility(
  targets: readonly QuizVocabularyEntry[],
  choiceCandidates: readonly QuizVocabularyEntry[],
) {
  const { englishCandidateIds, koreanCandidateIds } =
    buildDirectionalQuestionSets(targets, choiceCandidates);
  return targets.map((target) => ({
    id: target.id,
    eligibleDirections: [
      ...(englishCandidateIds.has(target.id)
        ? ["english_to_korean" as const]
        : []),
      ...(koreanCandidateIds.has(target.id)
        ? ["korean_to_english" as const]
        : []),
    ],
  }));
}

/**
 * Returns the directions that one source occurrence can use on its own.
 * Prompt collisions belong to a single quiz paper, so series planning must not
 * remove an occurrence just because a different sense exists in another quiz.
 */
export function quizIndependentTargetDirectionEligibility(
  targets: readonly QuizVocabularyEntry[],
  choiceCandidates: readonly QuizVocabularyEntry[],
) {
  const {
    englishCandidates: englishChoiceCandidates,
    koreanCandidates: koreanChoiceCandidates,
  } = buildDirectionalChoiceSets(choiceCandidates);
  return targets.map((target) => ({
    id: target.id,
    eligibleDirections: [
      ...(canUseDirection(target, "english_to_korean") &&
      hasMinimumDistinctDistractors(
        target,
        englishChoiceCandidates,
        "english_to_korean",
        (candidate) => candidate.primaryMeaning,
      )
        ? ["english_to_korean" as const]
        : []),
      ...(canUseDirection(target, "korean_to_english") &&
      hasMinimumDistinctDistractors(
        target,
        koreanChoiceCandidates,
        "korean_to_english",
        (candidate) => candidate.headword,
      )
        ? ["korean_to_english" as const]
        : []),
    ],
  }));
}

function hasMinimumDistinctDistractors(
  target: QuizVocabularyEntry,
  candidates: readonly QuizVocabularyEntry[],
  direction: QuizDirection,
  display: (entry: QuizVocabularyEntry) => string,
  minimum = 3,
) {
  const correctKey = normalizeQuizChoice(display(target));
  const correctIdentity = quizVocabularyIdentity(target);
  const promptKey = direction === "english_to_korean"
    ? normalizeQuizHeadword(target.headword)
    : normalizeQuizChoice(target.primaryMeaning);
  const displaysByIdentity = new Map<string, Set<string>>();
  const matchedIdentityByDisplay = new Map<string, string>();
  const matchedDisplayByIdentity = new Map<string, string>();

  const assignIdentity = (
    identity: string,
    visitedIdentities: Set<string>,
  ): boolean => {
    if (visitedIdentities.has(identity)) return false;
    visitedIdentities.add(identity);
    for (const displayKey of displaysByIdentity.get(identity) ?? []) {
      const previousIdentity = matchedIdentityByDisplay.get(displayKey);
      if (
        !previousIdentity ||
        assignIdentity(previousIdentity, visitedIdentities)
      ) {
        matchedIdentityByDisplay.set(displayKey, identity);
        matchedDisplayByIdentity.set(identity, displayKey);
        return true;
      }
    }
    return false;
  };

  for (const candidate of candidates) {
    const identity = quizVocabularyIdentity(candidate);
    const displayKey = normalizeQuizChoice(display(candidate));
    const candidatePromptKey = direction === "english_to_korean"
      ? normalizeQuizHeadword(candidate.headword)
      : normalizeQuizChoice(candidate.primaryMeaning);
    if (
      candidate.id === target.id ||
      identity === correctIdentity ||
      displayKey === correctKey ||
      candidatePromptKey === promptKey
    ) {
      continue;
    }
    const displayKeys = displaysByIdentity.get(identity) ?? new Set<string>();
    if (displayKeys.has(displayKey)) continue;
    displayKeys.add(displayKey);
    displaysByIdentity.set(identity, displayKeys);
    if (!matchedDisplayByIdentity.has(identity)) {
      assignIdentity(identity, new Set());
    }
    if (matchedIdentityByDisplay.size >= minimum) return true;
  }
  return matchedIdentityByDisplay.size >= minimum;
}

type QuizChoiceCandidateMetadata = {
  entry: QuizVocabularyEntry;
  identity: string;
  headwordKey: string;
  meaningKey: string;
  recordType: ReturnType<typeof inferredRecordType>;
  meaningShape: ReturnType<typeof meaningShape>;
  headwordShape: ReturnType<typeof headwordShape>;
  headwordLength: number;
  meaningLength: number;
};

type QuizChoiceIndex = {
  byId: ReadonlyMap<number, QuizChoiceCandidateMetadata>;
  englishCandidates: readonly QuizChoiceCandidateMetadata[];
  koreanCandidates: readonly QuizChoiceCandidateMetadata[];
};

function buildDistractorCandidates(
  target: QuizVocabularyEntry,
  choiceIndex: QuizChoiceIndex,
  direction: QuizDirection,
  random?: RandomSource,
  preferSimilar = true,
) {
  const targetMetadata = choiceIndex.byId.get(target.id) ??
    quizChoiceCandidateMetadata(target);
  const correctKey = direction === "english_to_korean"
    ? targetMetadata.meaningKey
    : targetMetadata.headwordKey;
  const correctIdentity = targetMetadata.identity;
  const promptKey = direction === "english_to_korean"
    ? targetMetadata.headwordKey
    : targetMetadata.meaningKey;

  type DistractorEdge = {
    candidate: QuizVocabularyEntry;
    identity: string;
    displayKey: string;
    score: number;
    tieBreaker: number;
  };
  const edgeByKey = new Map<string, DistractorEdge>();
  const indexedCandidates = direction === "english_to_korean"
    ? choiceIndex.englishCandidates
    : choiceIndex.koreanCandidates;
  for (const metadata of indexedCandidates) {
    const candidate = metadata.entry;
    const identity = metadata.identity;
    const displayKey = direction === "english_to_korean"
      ? metadata.meaningKey
      : metadata.headwordKey;
    const candidatePromptKey = direction === "english_to_korean"
      ? metadata.headwordKey
      : metadata.meaningKey;
    if (
      candidate.id === target.id ||
      identity === correctIdentity ||
      displayKey === correctKey ||
      candidatePromptKey === promptKey
    ) {
      continue;
    }
    const edge: DistractorEdge = {
      candidate,
      identity,
      displayKey,
      score: preferSimilar
        ? indexedDistractorSimilarityScore(
            targetMetadata,
            metadata,
            direction,
          )
        : 0,
      tieBreaker: random?.() ?? candidate.id,
    };
    const key = `${edge.identity}\u0000${edge.displayKey}`;
    const previous = edgeByKey.get(key);
    if (
      !previous ||
      edge.score > previous.score ||
      (edge.score === previous.score && edge.tieBreaker < previous.tieBreaker)
    ) {
      edgeByKey.set(key, edge);
    }
  }

  const edgesByIdentity = new Map<
    string,
    DistractorEdge[]
  >();
  const edgesByScore = new Map<number, DistractorEdge[]>();
  for (const edge of edgeByKey.values()) {
    const bucket = edgesByScore.get(edge.score) ?? [];
    bucket.push(edge);
    edgesByScore.set(edge.score, bucket);
  }
  let matchedByDisplay = new Map<string, DistractorEdge>();
  const rebuildMatching = () => {
    const nextMatchedByDisplay = new Map<string, DistractorEdge>();
    const assignIdentity = (
      identity: string,
      visitedIdentities: Set<string>,
    ): boolean => {
      if (visitedIdentities.has(identity)) return false;
      visitedIdentities.add(identity);
      for (const edge of edgesByIdentity.get(identity) ?? []) {
        const previous = nextMatchedByDisplay.get(edge.displayKey);
        if (
          !previous ||
          assignIdentity(previous.identity, visitedIdentities)
        ) {
          nextMatchedByDisplay.set(edge.displayKey, edge);
          return true;
        }
      }
      return false;
    };
    for (const identity of edgesByIdentity.keys()) {
      assignIdentity(identity, new Set());
      if (nextMatchedByDisplay.size >= 3) break;
    }
    return nextMatchedByDisplay;
  };

  const scores = [...edgesByScore.keys()].sort((left, right) => right - left);
  for (const score of scores) {
    const bucket = edgesByScore.get(score)!;
    bucket.sort(
      (left, right) =>
        left.tieBreaker - right.tieBreaker ||
        left.candidate.id - right.candidate.id,
    );
    for (const edge of bucket) {
      const edges = edgesByIdentity.get(edge.identity) ?? [];
      edges.push(edge);
      edgesByIdentity.set(edge.identity, edges);
    }
    matchedByDisplay = rebuildMatching();
    if (matchedByDisplay.size >= 3) break;
  }

  return [...matchedByDisplay.values()]
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.id - right.candidate.id,
    )
    .map((edge) => edge.candidate);
}

function inferredRecordType(entry: QuizVocabularyEntry) {
  if (entry.recordType) return entry.recordType;
  const dictionaryPrefix = entry.canonicalKey?.split(":", 1)[0];
  if (
    dictionaryPrefix === "word" ||
    dictionaryPrefix === "root_affix" ||
    dictionaryPrefix === "expression"
  ) {
    return dictionaryPrefix;
  }
  return /\s|[/]/.test(entry.headword.trim())
    ? "expression"
    : "word";
}

function meaningShape(value: string) {
  const normalized = normalizeQuizChoice(value).replace(/[.,;:!?]/g, "");
  if (/^[~～]|\b것\b|\b수\b/.test(normalized)) return "phrase";
  if (/(하다|되다|이다|있다|없다|나다|주다|오다|가다|보다)$/.test(normalized)) {
    return "predicate";
  }
  if (/(한|적인|스러운|없는|있는)$/.test(normalized)) return "modifier";
  return "nominal";
}

function headwordShape(value: string) {
  const normalized = normalizeQuizHeadword(value);
  const tokenCount = normalized.split(/[\s/-]+/).filter(Boolean).length;
  if (tokenCount >= 2) return "multiword";
  if (normalized.endsWith("ly")) return "adverb_like";
  if (/(tion|sion|ment|ness|ity|ance|ence|ism|ship)$/.test(normalized)) {
    return "noun_like";
  }
  if (/(ive|ous|ful|less|able|ible|al|ic|ary)$/.test(normalized)) {
    return "adjective_like";
  }
  return "single";
}

function quizChoiceCandidateMetadata(
  entry: QuizVocabularyEntry,
): QuizChoiceCandidateMetadata {
  return {
    entry,
    identity: quizVocabularyIdentity(entry),
    headwordKey: normalizeQuizHeadword(entry.headword),
    meaningKey: normalizeQuizChoice(entry.primaryMeaning),
    recordType: inferredRecordType(entry),
    meaningShape: meaningShape(entry.primaryMeaning),
    headwordShape: headwordShape(entry.headword),
    headwordLength: Array.from(entry.headword).length,
    meaningLength: Array.from(entry.primaryMeaning).length,
  };
}

export function buildQuizChoiceIndex(
  candidates: readonly QuizVocabularyEntry[],
): QuizChoiceIndex {
  const metadata = candidates.map(quizChoiceCandidateMetadata);
  return {
    byId: new Map(metadata.map((candidate) => [candidate.entry.id, candidate])),
    englishCandidates: metadata.filter((candidate) =>
      canUseDirection(candidate.entry, "english_to_korean")
    ),
    koreanCandidates: metadata.filter((candidate) =>
      canUseDirection(candidate.entry, "korean_to_english")
    ),
  };
}

function indexedDistractorSimilarityScore(
  target: QuizChoiceCandidateMetadata,
  candidate: QuizChoiceCandidateMetadata,
  direction: QuizDirection,
) {
  let score = 0;
  if (target.recordType === candidate.recordType) score += 80;
  if (target.meaningShape === candidate.meaningShape) score += 36;
  if (target.headwordShape === candidate.headwordShape) score += 22;
  const targetDisplayLength = direction === "english_to_korean"
    ? target.meaningLength
    : target.headwordLength;
  const candidateDisplayLength = direction === "english_to_korean"
    ? candidate.meaningLength
    : candidate.headwordLength;
  score += Math.max(0, 18 - Math.abs(
    targetDisplayLength - candidateDisplayLength,
  ));
  score += Math.max(0, 10 - Math.abs(
    target.meaningLength - candidate.meaningLength,
  ));
  return score;
}

export function createChoices(
  target: QuizVocabularyEntry,
  direction: QuizDirection,
  display: (entry: QuizVocabularyEntry) => string,
  random: RandomSource,
  choiceIndex: QuizChoiceIndex,
): {
  choices: string[];
  choiceVocabEntryIds: number[];
  correctChoiceIndex: number;
} {
  const distractors = shuffle(
    buildDistractorCandidates(
      target,
      choiceIndex,
      direction,
      random,
    ),
    random,
  )
    .slice(0, 3);

  if (distractors.length !== 3) {
    throw new Error("서로 다른 4지선다 보기를 만들 어휘가 부족합니다.");
  }

  const choiceEntries = shuffle([target, ...distractors], random);
  return {
    choices: choiceEntries.map(display),
    choiceVocabEntryIds: choiceEntries.map((entry) => entry.id),
    correctChoiceIndex: choiceEntries.findIndex(
      (entry) => entry.id === target.id,
    ),
  };
}

