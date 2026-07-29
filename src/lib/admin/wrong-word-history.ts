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

export type WrongAttemptSource = {
  id: string;
  assignmentTitle: string;
  attemptNumber: number;
  status: "completed" | "expired";
  completedAt: string;
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
};

export type WrongAttemptWord = {
  questionId: string;
  datasetId: string;
  vocabEntryId: number;
  datasetLabel: string;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: "legacy_backfill" | "verified_v2";
  wrongCount: 1 | 2;
  outcome: WrongWordOutcome;
};

export type WrongAttemptSummary = {
  attemptId: string;
  assignmentTitle: string;
  attemptNumber: number;
  status: "completed" | "expired";
  completedAt: string;
  wrongEventCount: number;
  words: WrongAttemptWord[];
};

export type StudentWrongWordHistory = {
  wrongEventCount: number;
  uniqueWordCount: number;
  onceWrongWordCount: number;
  repeatedWrongWordCount: number;
  pendingReviewCount: number;
  pendingReviews: PendingWrongWordReview[];
  words: WrongWordAggregate[];
  attempts: WrongAttemptSummary[];
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
  attempts,
  entries,
  events,
  questions,
}: {
  attempts: readonly WrongAttemptSource[];
  entries: readonly WrongEntrySource[];
  events: readonly WrongEventSource[];
  questions: readonly WrongQuestionSource[];
}): StudentWrongWordHistory {
  const attemptById = new Map(
    attempts.map((attempt) => [attempt.id, attempt]),
  );
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const usableEvents = events.filter(
    (event) =>
      attemptById.has(event.attemptId) &&
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

  const eventsByAttempt = new Map<string, WrongEventSource[]>();
  for (const event of usableEvents) {
    const current = eventsByAttempt.get(event.attemptId) ?? [];
    current.push(event);
    eventsByAttempt.set(event.attemptId, current);
  }

  const attemptSummaries = [...eventsByAttempt.entries()]
    .flatMap(([attemptId, attemptEvents]): WrongAttemptSummary[] => {
      const attempt = attemptById.get(attemptId);
      if (!attempt) return [];
      const eventsByQuestion = new Map<string, WrongEventSource[]>();
      for (const event of attemptEvents) {
        const current = eventsByQuestion.get(event.questionId) ?? [];
        current.push(event);
        eventsByQuestion.set(event.questionId, current);
      }
      const wordsForAttempt = [...eventsByQuestion.entries()]
        .flatMap(([questionId, questionEvents]): WrongAttemptWord[] => {
          const question = questionById.get(questionId);
          const firstEvent = questionEvents[0];
          const entry = firstEvent
            ? entryById.get(firstEvent.vocabEntryId)
            : null;
          if (!question || !firstEvent || !entry) return [];
          return [
            {
              questionId,
              datasetId: firstEvent.datasetId,
              vocabEntryId: firstEvent.vocabEntryId,
              datasetLabel: entry.datasetLabel,
              headword: question.headword || entry.headword,
              primaryMeaning:
                question.primaryMeaning || entry.primaryMeaning,
              provenanceStatus: question.provenanceStatus,
              wrongCount: questionEvents.length >= 2 ? 2 : 1,
              outcome: latestOutcome(question),
            },
          ];
        })
        .toSorted(
          (left, right) =>
            right.wrongCount - left.wrongCount ||
            left.headword.localeCompare(right.headword, "en"),
        );
      return [
        {
          attemptId,
          assignmentTitle: attempt.assignmentTitle,
          attemptNumber: attempt.attemptNumber,
          status: attempt.status,
          completedAt: attempt.completedAt,
          wrongEventCount: attemptEvents.length,
          words: wordsForAttempt,
        },
      ];
    })
    .toSorted(
      (left, right) =>
        Date.parse(right.completedAt) - Date.parse(left.completedAt),
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
    attempts: attemptSummaries,
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
    attempts: [],
  };
}
