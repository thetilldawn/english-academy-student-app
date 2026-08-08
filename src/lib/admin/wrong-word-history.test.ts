import { describe, expect, it } from "vitest";

import {
  buildStudentWrongWordHistory,
  emptyStudentWrongWordHistory,
  wrongWordReviewIdentity,
  type WrongEntrySource,
  type WrongEventSource,
  type WrongQuestionSource,
} from "@/lib/admin/wrong-word-history";

const entries: WrongEntrySource[] = [
  {
    id: 11,
    datasetId: "dataset-a",
    datasetLabel: "능률 VOCA · 2025개정",
    headword: "alpha",
    primaryMeaning: "알파",
  },
  {
    id: 12,
    datasetId: "dataset-a",
    datasetLabel: "능률 VOCA · 2025개정",
    headword: "alpha",
    primaryMeaning: "알파",
  },
  {
    id: 13,
    datasetId: "dataset-a",
    datasetLabel: "능률 VOCA · 2025개정",
    headword: "beta",
    primaryMeaning: "베타",
  },
];

const questions: WrongQuestionSource[] = [
  {
    id: "question-1",
    vocabEntryId: 11,
    initialIsCorrect: false,
    retryIsCorrect: true,
    headword: "alpha",
    primaryMeaning: "첫 뜻",
    provenanceStatus: "verified_v2",
  },
  {
    id: "question-2",
    vocabEntryId: 12,
    initialIsCorrect: false,
    retryIsCorrect: false,
    headword: "alpha",
    primaryMeaning: "둘째 뜻",
    provenanceStatus: "verified_v2",
  },
  {
    id: "question-3",
    vocabEntryId: 13,
    initialIsCorrect: false,
    retryIsCorrect: null,
    headword: "beta",
    primaryMeaning: "베타",
    provenanceStatus: "legacy_backfill",
  },
];

const events: WrongEventSource[] = [
  {
    attemptId: "attempt-1",
    questionId: "question-1",
    datasetId: "dataset-a",
    vocabEntryId: 11,
    canonicalDictionaryId: null,
    canonicalLexemeId: "lexeme-alpha",
    stage: "initial",
    wrongAt: "2026-07-29T00:10:00Z",
  },
  {
    attemptId: "attempt-2",
    questionId: "question-2",
    datasetId: "dataset-a",
    vocabEntryId: 12,
    canonicalDictionaryId: null,
    canonicalLexemeId: "lexeme-alpha",
    stage: "initial",
    wrongAt: "2026-07-30T00:10:00Z",
  },
  {
    attemptId: "attempt-2",
    questionId: "question-2",
    datasetId: "dataset-a",
    vocabEntryId: 12,
    canonicalDictionaryId: null,
    canonicalLexemeId: "lexeme-alpha",
    stage: "retry",
    wrongAt: "2026-07-30T00:20:00Z",
  },
  {
    attemptId: "attempt-2",
    questionId: "question-3",
    datasetId: "dataset-a",
    vocabEntryId: 13,
    canonicalDictionaryId: null,
    canonicalLexemeId: null,
    stage: "initial",
    wrongAt: "2026-07-30T00:30:00Z",
  },
];

describe("buildStudentWrongWordHistory", () => {
  it("groups canonical occurrences but preserves exact source occurrences", () => {
    const result = buildStudentWrongWordHistory({
      entries,
      events,
      questions,
    });

    expect(result.wrongEventCount).toBe(3);
    expect(result.uniqueWordCount).toBe(2);
    expect(result.onceWrongWordCount).toBe(1);
    expect(result.repeatedWrongWordCount).toBe(1);
    expect(result.words[0]).toMatchObject({
      key: "canonical:lexeme-alpha",
      wrongCount: 2,
      wrongLevel: 2,
      latestAttemptId: "attempt-2",
      latestQuestionId: "question-2",
      latestDatasetId: "dataset-a",
      latestVocabEntryId: 12,
      latestOutcome: "wrong_again",
    });
    expect(result.words[0].occurrences).toHaveLength(2);
    expect(
      result.words[0].occurrences.map((item) => item.vocabEntryId),
    ).toEqual([12, 11]);
    expect(
      result.words[0].occurrences.map(
        (item) => item.latestQuestionId,
      ),
    ).toEqual(["question-2", "question-1"]);
    expect(result.words[1]).toMatchObject({
      key: "headword:dataset-a:beta",
      wrongCount: 1,
      wrongLevel: 1,
      latestOutcome: "retry_unanswered",
    });
  });

  it("keeps the review queue identity scoped to its dataset", () => {
    expect(
      wrongWordReviewIdentity(
        "dataset-a",
        11,
        "lexeme-alpha",
      ),
    ).not.toBe(
      wrongWordReviewIdentity(
        "dataset-b",
        21,
        "lexeme-alpha",
      ),
    );
  });

  it("keeps a canonical word unresolved while any source occurrence is unresolved", () => {
    const result = buildStudentWrongWordHistory({
      entries,
      events,
      questions,
      pendingReviews: [
        {
          queueId: "queue-alpha",
          key: wrongWordReviewIdentity(
            "dataset-a",
            11,
            "lexeme-alpha",
          ),
          datasetId: "dataset-a",
          vocabEntryId: 11,
          canonicalDictionaryId: null,
          canonicalLexemeId: "lexeme-alpha",
          sourceQuestionId: "question-1",
          reasonLevel: 1,
          queuedAt: "2026-07-30T01:00:00Z",
          reviewDraftId: null,
        },
      ],
      states: [
        {
          vocabEntryId: 11,
          unresolvedWrongCount: 1,
          resolvedAt: null,
          lastEvaluatedAt: "2026-07-30T01:00:00Z",
        },
        {
          vocabEntryId: 12,
          unresolvedWrongCount: 0,
          resolvedAt: "2026-07-30T02:00:00Z",
          lastEvaluatedAt: "2026-07-30T02:00:00Z",
        },
        {
          vocabEntryId: 13,
          unresolvedWrongCount: 1,
          resolvedAt: null,
          lastEvaluatedAt: "2026-07-30T01:00:00Z",
        },
      ],
    });

    expect(result.words[0]).toMatchObject({
      key: "canonical:lexeme-alpha",
      resolution: "unresolved",
      scheduling: "queued",
    });
    expect(result.uniqueWordCount).toBe(2);
    expect(result.pendingReviewCount).toBe(1);
  });

  it("does not rebuild the removed per-attempt response payload", () => {
    const result = buildStudentWrongWordHistory({
      entries,
      events,
      questions,
    });

    expect(result).not.toHaveProperty("attempts");
  });

  it("ignores incomplete relation rows instead of inventing labels", () => {
    const result = buildStudentWrongWordHistory({
      entries,
      questions,
      events: [
        ...events,
        {
          attemptId: "attempt-1",
          questionId: "missing-question",
          datasetId: "dataset-a",
          vocabEntryId: 11,
          canonicalDictionaryId: null,
          canonicalLexemeId: null,
          stage: "initial",
          wrongAt: "2026-08-01T00:00:00Z",
        },
      ],
    });

    expect(result.wrongEventCount).toBe(3);
  });

  it("returns a stable empty response", () => {
    expect(emptyStudentWrongWordHistory()).toEqual({
      wrongEventCount: 0,
      uniqueWordCount: 0,
      onceWrongWordCount: 0,
      repeatedWrongWordCount: 0,
      pendingReviewCount: 0,
      pendingReviews: [],
      words: [],
    });
  });

  it("keeps the first newest event as the representative when timestamps tie", () => {
    const result = buildStudentWrongWordHistory({
      entries,
      questions,
      events: [
        {
          ...events[1],
          wrongAt: "2026-07-30T00:20:00Z",
        },
        {
          ...events[0],
          wrongAt: "2026-07-30T00:20:00Z",
        },
      ],
    });

    expect(result.words[0]).toMatchObject({
      latestQuestionId: "question-2",
      latestDatasetId: "dataset-a",
      latestVocabEntryId: 12,
      latestOutcome: "wrong_again",
    });
  });

  it("keeps the conservative 400-event response below four megabytes", () => {
    const eventCount = 400;
    const longHeadword = "가".repeat(160);
    const longMeaning = "뜻".repeat(500);
    const longDatasetLabel = "단어장".repeat(100);
    const largeEntries: WrongEntrySource[] = [];
    const largeQuestions: WrongQuestionSource[] = [];
    const largeEvents: WrongEventSource[] = [];

    for (let index = 0; index < eventCount; index += 1) {
      const attemptId = `attempt-${index}`;
      const questionId = `question-${index}`;
      const vocabEntryId = index + 1;
      largeEntries.push({
        id: vocabEntryId,
        datasetId: "dataset-large",
        datasetLabel: longDatasetLabel,
        headword: longHeadword,
        primaryMeaning: longMeaning,
      });
      largeQuestions.push({
        id: questionId,
        vocabEntryId,
        initialIsCorrect: false,
        retryIsCorrect: true,
        headword: longHeadword,
        primaryMeaning: longMeaning,
        provenanceStatus: "verified_v2",
      });
      largeEvents.push({
        attemptId,
        questionId,
        datasetId: "dataset-large",
        vocabEntryId,
        canonicalDictionaryId: null,
        canonicalLexemeId: `lexeme-${index}`,
        stage: "initial",
        wrongAt: "2026-07-30T00:00:00Z",
      });
    }

    const result = buildStudentWrongWordHistory({
      entries: largeEntries,
      events: largeEvents,
      questions: largeQuestions,
    });

    const history = {
      ...result,
      pendingReviewCount: eventCount,
      pendingReviews: Array.from(
        { length: eventCount },
        (_, index) => ({
          queueId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          key: `canonical:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          datasetId: "00000000-0000-4000-8000-000000000001",
          vocabEntryId: index + 1,
          canonicalDictionaryId: null,
          canonicalLexemeId: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          sourceQuestionId: `00000000-0000-4000-8001-${String(index).padStart(12, "0")}`,
          reasonLevel: (index % 2 === 0 ? 1 : 2) as 1 | 2,
          queuedAt: "2026-07-30T00:00:00Z",
          reviewDraftId: null,
        }),
      ),
    };

    expect(
      Buffer.byteLength(JSON.stringify({ history })),
    ).toBeLessThan(4_000_000);
  });
});
