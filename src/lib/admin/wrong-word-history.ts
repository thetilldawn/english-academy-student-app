export type WrongStage = "initial" | "retry";

export type WrongEventSource = {
  attemptId: string;
  questionId: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalLexemeId: string | null;
  stage: WrongStage;
  wrongAt: string;
};

export type WrongQuestionSource = {
  id: string;
  vocabEntryId: number;
  initialIsCorrect: boolean | null;
  retryIsCorrect: boolean | null;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: "legacy_backfill" | "verified_v2";
};

export type WrongEntrySource = {
  id: number;
  datasetId: string;
  datasetLabel: string;
  headword: string;
  primaryMeaning: string;
};

export type WrongWordOutcome =
  | "recovered_on_retry"
  | "wrong_again"
  | "retry_unanswered";

export type WrongWordOccurrence = {
  datasetId: string;
  vocabEntryId: number;
  latestQuestionId: string;
  datasetLabel: string;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: "legacy_backfill" | "verified_v2";
  wrongCount: number;
  lastWrongAt: string;
};

export type WrongWordAggregate = {
  key: string;
  canonicalLexemeId: string | null;
  headword: string;
  primaryMeaning: string;
  wrongCount: number;
  wrongLevel: 1 | 2;
  lastWrongAt: string;
  latestAttemptId: string;
  latestQuestionId: string;
  latestDatasetId: string;
  latestVocabEntryId: number;
  latestOutcome: WrongWordOutcome;
  occurrences: WrongWordOccurrence[];
};

export type PendingWrongWordReview = {
  queueId: string;
  key: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalLexemeId: string | null;
  sourceQuestionId: string;
  reasonLevel: 1 | 2;
  queuedAt: string;
  reviewDraftId: string | null;
};

export type StudentWrongWordHistory = {
  wrongEventCount: number;
  uniqueWordCount: number;
  onceWrongWordCount: number;
  repeatedWrongWordCount: number;
  pendingReviewCount: number;
  pendingReviews: PendingWrongWordReview[];
  words: WrongWordAggregate[];
};

function latestOutcome(
  question: WrongQuestionSource,
): WrongWordOutcome {
  if (question.retryIsCorrect === true) return "recovered_on_retry";
  if (question.retryIsCorrect === false) return "wrong_again";
  return "retry_unanswered";
}

function wordIdentity(event: WrongEventSource) {
  return event.canonicalLexemeId
    ? `canonical:${event.canonicalLexemeId}`
    : `entry:${event.datasetId}:${event.vocabEntryId}`;
}

export function wrongWordReviewIdentity(
  datasetId: string,
  vocabEntryId: number,
  canonicalLexemeId: string | null,
) {
  return canonicalLexemeId
    ? `canonical:${datasetId}:${canonicalLexemeId}`
    : `entry:${datasetId}:${vocabEntryId}`;
}

export function buildStudentWrongWordHistory({
  entries,
  events,
  questions,
}: {
  entries: readonly WrongEntrySource[];
  events: readonly WrongEventSource[];
  questions: readonly WrongQuestionSource[];
}): StudentWrongWordHistory {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const usableEvents = events.filter(
    (event) =>
      questionById.has(event.questionId) &&
      entryById.has(event.vocabEntryId),
  );

  const aggregateByKey = new Map<
    string,
    {
      canonicalLexemeId: string | null;
      wrongCount: number;
      lastWrongAt: string;
      latestAttemptId: string;
      latestQuestionId: string;
      latestDatasetId: string;
      latestVocabEntryId: number;
      latestOutcome: WrongWordOutcome;
      occurrenceByEntryId: Map<number, WrongWordOccurrence>;
    }
  >();

  for (const event of usableEvents) {
    const question = questionById.get(event.questionId)!;
    const entry = entryById.get(event.vocabEntryId)!;
    const key = wordIdentity(event);
    const current = aggregateByKey.get(key);
    const occurrence =
      current?.occurrenceByEntryId.get(event.vocabEntryId) ?? {
        datasetId: event.datasetId,
        vocabEntryId: event.vocabEntryId,
        latestQuestionId: event.questionId,
        datasetLabel: entry.datasetLabel,
        headword: question.headword || entry.headword,
        primaryMeaning:
          question.primaryMeaning || entry.primaryMeaning,
        provenanceStatus: question.provenanceStatus,
        wrongCount: 0,
        lastWrongAt: event.wrongAt,
      };
    occurrence.wrongCount += 1;
    if (
      Date.parse(event.wrongAt) >
      Date.parse(occurrence.lastWrongAt)
    ) {
      occurrence.lastWrongAt = event.wrongAt;
      occurrence.latestQuestionId = event.questionId;
    }

    if (!current) {
      aggregateByKey.set(key, {
        canonicalLexemeId: event.canonicalLexemeId,
        wrongCount: 1,
        lastWrongAt: event.wrongAt,
        latestAttemptId: event.attemptId,
        latestQuestionId: event.questionId,
        latestDatasetId: event.datasetId,
        latestVocabEntryId: event.vocabEntryId,
        latestOutcome: latestOutcome(question),
        occurrenceByEntryId: new Map([
          [event.vocabEntryId, occurrence],
        ]),
      });
      continue;
    }

    current.wrongCount += 1;
    current.occurrenceByEntryId.set(event.vocabEntryId, occurrence);
    if (Date.parse(event.wrongAt) > Date.parse(current.lastWrongAt)) {
      current.lastWrongAt = event.wrongAt;
      current.latestAttemptId = event.attemptId;
      current.latestQuestionId = event.questionId;
      current.latestDatasetId = event.datasetId;
      current.latestVocabEntryId = event.vocabEntryId;
      current.latestOutcome = latestOutcome(question);
    }
  }

  const words = [...aggregateByKey.entries()]
    .map(([key, aggregate]): WrongWordAggregate => {
      const occurrences = [...aggregate.occurrenceByEntryId.values()]
        .toSorted(
          (left, right) =>
            Date.parse(right.lastWrongAt) -
            Date.parse(left.lastWrongAt),
        );
      const representative = occurrences[0];
      return {
        key,
        canonicalLexemeId: aggregate.canonicalLexemeId,
        headword: representative.headword,
        primaryMeaning: representative.primaryMeaning,
        wrongCount: aggregate.wrongCount,
        wrongLevel: aggregate.wrongCount >= 2 ? 2 : 1,
        lastWrongAt: aggregate.lastWrongAt,
        latestAttemptId: aggregate.latestAttemptId,
        latestQuestionId: aggregate.latestQuestionId,
        latestDatasetId: aggregate.latestDatasetId,
        latestVocabEntryId: aggregate.latestVocabEntryId,
        latestOutcome: aggregate.latestOutcome,
        occurrences,
      };
    })
    .toSorted(
      (left, right) =>
        right.wrongLevel - left.wrongLevel ||
        Date.parse(right.lastWrongAt) - Date.parse(left.lastWrongAt) ||
        left.headword.localeCompare(right.headword, "en"),
    );

  return {
    wrongEventCount: usableEvents.length,
    uniqueWordCount: words.length,
    onceWrongWordCount: words.filter(
      (word) => word.wrongLevel === 1,
    ).length,
    repeatedWrongWordCount: words.filter(
      (word) => word.wrongLevel === 2,
    ).length,
    pendingReviewCount: 0,
    pendingReviews: [],
    words,
  };
}

export function emptyStudentWrongWordHistory(): StudentWrongWordHistory {
  return {
    wrongEventCount: 0,
    uniqueWordCount: 0,
    onceWrongWordCount: 0,
    repeatedWrongWordCount: 0,
    pendingReviewCount: 0,
    pendingReviews: [],
    words: [],
  };
}
