import { normalizeQuizHeadword } from "@/lib/quiz/word-identity";

export type WrongStage = "initial" | "retry";

export type WrongEventSource = {
  attemptId: string;
  questionId: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalDictionaryId: string | null;
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
  provenanceStatus: QuestionProvenanceStatus;
};

export type WrongEntrySource = {
  id: number;
  datasetId: string;
  datasetLabel: string;
  headword: string;
  headwordNormalized?: string;
  primaryMeaning: string;
};

export type WrongWordOutcome =
  | "recovered_on_retry"
  | "wrong_again"
  | "retry_unanswered";

export type WrongWordResolution = "unresolved" | "resolved";

export type WrongWordScheduling =
  | "available"
  | "queued"
  | "assigned"
  | "none";

export type WrongWordActiveAssignment = {
  assignmentId: string;
  title: string;
  assignedAt: string;
};

export type WrongWordStateSource = {
  vocabEntryId: number;
  unresolvedWrongCount: number;
  resolvedAt: string | null;
  lastEvaluatedAt: string;
};

export type ActiveWrongWordAssignmentSource =
  WrongWordActiveAssignment & {
    key: string;
  };

export type WrongWordOccurrence = {
  datasetId: string;
  vocabEntryId: number;
  latestQuestionId: string;
  datasetLabel: string;
  headword: string;
  primaryMeaning: string;
  provenanceStatus: QuestionProvenanceStatus;
  wrongCount: number;
  lastWrongAt: string;
  resolution: WrongWordResolution;
  scheduling: WrongWordScheduling;
  activeAssignment: WrongWordActiveAssignment | null;
};

export type WrongWordAggregate = {
  key: string;
  canonicalDictionaryId: string | null;
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
  resolution: WrongWordResolution;
  scheduling: WrongWordScheduling;
  activeAssignment: WrongWordActiveAssignment | null;
  occurrences: WrongWordOccurrence[];
};

export type PendingWrongWordReview = {
  queueId: string;
  key: string;
  datasetId: string;
  vocabEntryId: number;
  canonicalDictionaryId: string | null;
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

function wordIdentity(
  event: WrongEventSource,
  entry: WrongEntrySource,
) {
  const headwordKey = normalizeQuizHeadword(
    entry.headwordNormalized ?? entry.headword,
  );
  return event.canonicalDictionaryId
    ? `dictionary:${event.canonicalDictionaryId}`
    : event.canonicalLexemeId
      ? `canonical:${event.canonicalLexemeId}`
    : headwordKey
      ? `headword:${event.datasetId}:${headwordKey}`
      : `entry:${event.datasetId}:${event.vocabEntryId}`;
}

export function wrongWordReviewIdentity(
  datasetId: string,
  vocabEntryId: number,
  canonicalLexemeId: string | null,
  headword?: string | null,
  canonicalDictionaryId?: string | null,
) {
  const headwordKey = headword
    ? normalizeQuizHeadword(headword)
    : "";
  return canonicalDictionaryId
    ? `dictionary:${datasetId}:${canonicalDictionaryId}`
    : canonicalLexemeId
      ? `canonical:${datasetId}:${canonicalLexemeId}`
    : headwordKey
      ? `headword:${datasetId}:${headwordKey}`
      : `entry:${datasetId}:${vocabEntryId}`;
}

export function buildStudentWrongWordHistory({
  activeAssignments = [],
  entries,
  events,
  pendingReviews = [],
  questions,
  states = [],
}: {
  activeAssignments?: readonly ActiveWrongWordAssignmentSource[];
  entries: readonly WrongEntrySource[];
  events: readonly WrongEventSource[];
  pendingReviews?: readonly PendingWrongWordReview[];
  questions: readonly WrongQuestionSource[];
  states?: readonly WrongWordStateSource[];
}): StudentWrongWordHistory {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const usableEvents = events.filter(
    (event) =>
      event.stage === "initial" &&
      questionById.has(event.questionId) &&
      entryById.has(event.vocabEntryId),
  );
  const latestStateByEntryId = new Map<number, WrongWordStateSource>();
  for (const state of states) {
    const current = latestStateByEntryId.get(state.vocabEntryId);
    if (
      !current ||
      Date.parse(state.lastEvaluatedAt) >
        Date.parse(current.lastEvaluatedAt)
    ) {
      latestStateByEntryId.set(state.vocabEntryId, state);
    }
  }
  const pendingReviewByKey = new Map(
    pendingReviews.map((review) => [review.key, review]),
  );
  const activeAssignmentByKey = new Map<
    string,
    ActiveWrongWordAssignmentSource
  >();
  for (const assignment of activeAssignments) {
    const current = activeAssignmentByKey.get(assignment.key);
    if (
      !current ||
      Date.parse(assignment.assignedAt) >
        Date.parse(current.assignedAt)
    ) {
      activeAssignmentByKey.set(assignment.key, assignment);
    }
  }

  const aggregateByKey = new Map<
    string,
    {
      canonicalDictionaryId: string | null;
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
    const key = wordIdentity(event, entry);
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
        resolution: "unresolved" as const,
        scheduling: "available" as const,
        activeAssignment: null,
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
        canonicalDictionaryId: event.canonicalDictionaryId,
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
        .map((occurrence): WrongWordOccurrence => {
          const state = latestStateByEntryId.get(
            occurrence.vocabEntryId,
          );
          const occurrenceQuestion = questionById.get(
            occurrence.latestQuestionId,
          );
          const resolution: WrongWordResolution = state
            ? state.unresolvedWrongCount > 0 && !state.resolvedAt
              ? "unresolved"
              : "resolved"
            : occurrenceQuestion &&
                latestOutcome(occurrenceQuestion) ===
                  "recovered_on_retry"
              ? "resolved"
              : "unresolved";
          const reviewKey = wrongWordReviewIdentity(
            occurrence.datasetId,
            occurrence.vocabEntryId,
            aggregate.canonicalLexemeId,
            occurrence.headword,
            aggregate.canonicalDictionaryId,
          );
          const activeAssignment =
            activeAssignmentByKey.get(reviewKey) ?? null;
          const scheduling: WrongWordScheduling =
            resolution === "resolved"
              ? "none"
              : activeAssignment
                ? "assigned"
                : pendingReviewByKey.has(reviewKey)
                  ? "queued"
                  : "available";
          return {
            ...occurrence,
            resolution,
            scheduling,
            activeAssignment: activeAssignment
              ? {
                  assignmentId: activeAssignment.assignmentId,
                  title: activeAssignment.title,
                  assignedAt: activeAssignment.assignedAt,
                }
              : null,
          };
        })
        .toSorted(
          (left, right) =>
            Date.parse(right.lastWrongAt) -
            Date.parse(left.lastWrongAt),
        );
      const representative = occurrences[0];
      const unresolvedOccurrence = occurrences.find(
        (occurrence) => occurrence.resolution === "unresolved",
      );
      const assignedOccurrence = occurrences.find(
        (occurrence) => occurrence.scheduling === "assigned",
      );
      const queuedOccurrence = occurrences.find(
        (occurrence) => occurrence.scheduling === "queued",
      );
      const resolution: WrongWordResolution = unresolvedOccurrence
        ? "unresolved"
        : "resolved";
      const scheduling: WrongWordScheduling =
        resolution === "resolved"
          ? "none"
          : assignedOccurrence
            ? "assigned"
            : queuedOccurrence
              ? "queued"
              : "available";
      return {
        key,
        canonicalDictionaryId: aggregate.canonicalDictionaryId,
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
        resolution,
        scheduling,
        activeAssignment:
          assignedOccurrence?.activeAssignment ?? null,
        occurrences,
      };
    })
    .toSorted(
      (left, right) =>
        Number(left.resolution === "resolved") -
          Number(right.resolution === "resolved") ||
        right.wrongLevel - left.wrongLevel ||
        Date.parse(right.lastWrongAt) - Date.parse(left.lastWrongAt) ||
        left.headword.localeCompare(right.headword, "en"),
    );

  const unresolvedWords = words.filter(
    (word) => word.resolution === "unresolved",
  );
  return {
    wrongEventCount: usableEvents.length,
    uniqueWordCount: unresolvedWords.length,
    onceWrongWordCount: unresolvedWords.filter(
      (word) => word.wrongLevel === 1,
    ).length,
    repeatedWrongWordCount: unresolvedWords.filter(
      (word) => word.wrongLevel === 2,
    ).length,
    pendingReviewCount: words.filter(
      (word) => word.scheduling === "queued",
    ).length,
    pendingReviews: [...pendingReviews],
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
import type { QuestionProvenanceStatus } from "@/lib/quiz/question-provenance";
