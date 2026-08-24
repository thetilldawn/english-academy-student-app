import { describe, expect, it } from "vitest";

import type {
  StudentWrongWordHistory,
  WrongWordAggregate,
} from "@/lib/admin/wrong-word-history";

import {
  activeWrongWordReviewDrafts,
  filterWrongWords,
  keepSelectableQuestionIds,
  selectNextExamWrongWordTarget,
  selectableWrongWordQuestionIds,
  wrongWordDatasetOptions,
} from "./wrong-word-selection";

function word(input: Partial<WrongWordAggregate> = {}): WrongWordAggregate {
  return {
    key: "dictionary:word",
    canonicalDictionaryId: "word",
    canonicalLexemeId: null,
    headword: "observe",
    primaryMeaning: "엄수하다",
    wrongCount: 2,
    wrongLevel: 2,
    lastWrongAt: "2026-08-24T00:00:00.000Z",
    latestAttemptId: "attempt-1",
    latestQuestionId: "question-available",
    latestDatasetId: "dataset-a",
    latestVocabEntryId: 1,
    latestOutcome: "wrong_again",
    resolution: "unresolved",
    scheduling: "available",
    activeAssignment: null,
    occurrences: [
      {
        datasetId: "dataset-a",
        vocabEntryId: 1,
        latestQuestionId: "question-available",
        datasetLabel: "3월 모의고사",
        headword: "observe",
        primaryMeaning: "엄수하다",
        provenanceStatus: "verified_v2",
        wrongCount: 2,
        lastWrongAt: "2026-08-24T00:00:00.000Z",
        resolution: "unresolved",
        scheduling: "available",
        activeAssignment: null,
      },
    ],
    ...input,
  };
}

function history(words: WrongWordAggregate[]): StudentWrongWordHistory {
  return {
    wrongEventCount: words.length,
    uniqueWordCount: words.length,
    onceWrongWordCount: 0,
    repeatedWrongWordCount: words.length,
    pendingReviewCount: 2,
    pendingReviews: [
      {
        queueId: "queue-1",
        key: "one",
        datasetId: "dataset-a",
        vocabEntryId: 1,
        canonicalDictionaryId: null,
        canonicalLexemeId: null,
        sourceQuestionId: "question-1",
        reasonLevel: 1,
        queuedAt: "2026-08-24T00:00:00.000Z",
        reviewDraftId: "draft-1",
      },
      {
        queueId: "queue-2",
        key: "two",
        datasetId: "dataset-a",
        vocabEntryId: 2,
        canonicalDictionaryId: null,
        canonicalLexemeId: null,
        sourceQuestionId: "question-2",
        reasonLevel: 2,
        queuedAt: "2026-08-24T00:00:00.000Z",
        reviewDraftId: "draft-1",
      },
    ],
    words,
  };
}

describe("wrong word selection", () => {
  it("prefers an already assigned unresolved occurrence over an available one", () => {
    const target = selectNextExamWrongWordTarget(word({
      occurrences: [
        word().occurrences[0]!,
        {
          ...word().occurrences[0]!,
          datasetId: "dataset-b",
          latestQuestionId: "question-assigned",
          scheduling: "assigned",
        },
      ],
    }), "");
    expect(target?.questionId).toBe("question-assigned");
    expect(target?.scheduling).toBe("assigned");
  });

  it("filters by source, wrong level, and Korean meaning without changing source order", () => {
    const repeated = word();
    const once = word({
      key: "dictionary:another",
      headword: "follow",
      primaryMeaning: "따르다",
      wrongCount: 1,
      wrongLevel: 1,
    });
    expect(filterWrongWords({
      history: history([repeated, once]),
      datasetId: "dataset-a",
      level: "repeated",
      query: "엄수",
    })).toEqual([repeated]);
  });

  it("keeps next-exam and worksheet eligibility separate", () => {
    const assigned = word({
      occurrences: [{ ...word().occurrences[0]!, scheduling: "assigned" }],
    });
    expect(selectableWrongWordQuestionIds({
      words: [assigned],
      datasetId: "",
      purpose: "next_exam",
    })).toEqual([]);
    expect(selectableWrongWordQuestionIds({
      words: [assigned],
      datasetId: "",
      purpose: "worksheet",
    })).toEqual(["question-available"]);
  });

  it("derives sorted datasets, grouped drafts, and valid selected IDs", () => {
    const current = history([word()]);
    expect(wrongWordDatasetOptions(current)).toEqual([
      { id: "dataset-a", label: "3월 모의고사" },
    ]);
    expect(activeWrongWordReviewDrafts(current)).toEqual([
      {
        datasetId: "dataset-a",
        draftId: "draft-1",
        questionIds: ["question-1", "question-2"],
      },
    ]);
    expect(keepSelectableQuestionIds(
      ["missing", "question-available"],
      ["question-available"],
    )).toEqual(["question-available"]);
  });
});
