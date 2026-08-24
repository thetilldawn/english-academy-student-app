import { describe, expect, it } from "vitest";

import {
  indexDirectReviewDatasetSummaries,
  parseDirectReviewCandidates,
  parseDirectReviewDatasetSummaries,
} from "./direct-review-candidate";

describe("direct review candidate responses", () => {
  it("parses dataset summaries and indexes each dataset once", () => {
    const summaries = parseDirectReviewDatasetSummaries([{
      dataset_id: "dataset-a",
      level_1_count: "2",
      level_2_count: 1,
      total_count: 3,
      latest_wrong_at: "2026-08-24T12:00:00.000Z",
    }]);

    expect(indexDirectReviewDatasetSummaries(summaries).get("dataset-a"))
      .toMatchObject({ level1Count: 2, level2Count: 1, totalCount: 3 });
  });

  it("rejects a summary whose level counts do not match the total", () => {
    expect(() => parseDirectReviewDatasetSummaries([{
      dataset_id: "dataset-a",
      level_1_count: 2,
      level_2_count: 1,
      total_count: 4,
      latest_wrong_at: null,
    }])).toThrow("합계");
  });

  it("parses current wrong candidates without requiring a pending queue", () => {
    expect(parseDirectReviewCandidates([{
      source_question_id: "question-a",
      dataset_id: "dataset-a",
      vocab_entry_id: "17",
      canonical_dictionary_id: "dictionary-a",
      canonical_lexeme_id: null,
      headword_normalized: "observe",
      reason_level: 2,
      wrong_count: 3,
      last_wrong_at: "2026-08-24T12:00:00.000Z",
    }])).toEqual([expect.objectContaining({
      reasonLevel: 2,
      sourceQuestionId: "question-a",
      wrongCount: 3,
    })]);
  });

  it("rejects duplicate source questions", () => {
    const row = {
      source_question_id: "question-a",
      dataset_id: "dataset-a",
      vocab_entry_id: 17,
      canonical_dictionary_id: null,
      canonical_lexeme_id: null,
      headword_normalized: "observe",
      reason_level: 1,
      wrong_count: 1,
      last_wrong_at: null,
    };
    expect(() => parseDirectReviewCandidates([row, row])).toThrow("중복");
  });
});
