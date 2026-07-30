import { describe, expect, it } from "vitest";

import {
  currentVocabWrongSummaryKey,
  emptyCurrentVocabWrongCounts,
  indexStudentCurrentVocabWrongSummaries,
  parseStudentCurrentVocabWrongSummaries,
} from "@/lib/admin/wrong-history-summary";

describe("current vocabulary wrong-history summaries", () => {
  it("parses database numbers and indexes each student dataset", () => {
    const summaries = parseStudentCurrentVocabWrongSummaries([
      {
        student_id: "student-1",
        dataset_id: "dataset-1",
        wrong_word_count: "17",
        repeated_wrong_word_count: 8,
      },
    ]);
    const index =
      indexStudentCurrentVocabWrongSummaries(summaries);

    expect(summaries).toEqual([
      {
        studentId: "student-1",
        datasetId: "dataset-1",
        wrongWordCount: 17,
        repeatedWrongWordCount: 8,
      },
    ]);
    expect(
      index.byStudentDataset.get(
        currentVocabWrongSummaryKey("student-1", "dataset-1"),
      ),
    ).toEqual({
      wrongWordCount: 17,
      repeatedWrongWordCount: 8,
    });
  });

  it("provides explicit zero counts for students without history", () => {
    expect(emptyCurrentVocabWrongCounts()).toEqual({
      wrongWordCount: 0,
      repeatedWrongWordCount: 0,
    });
  });

  it("rejects malformed, negative, and impossible counts", () => {
    expect(() =>
      parseStudentCurrentVocabWrongSummaries([
        {
          student_id: "student-1",
          dataset_id: "dataset-1",
          wrong_word_count: -1,
          repeated_wrong_word_count: 0,
        },
      ]),
    ).toThrow("오답 단어 수치");
    expect(() =>
      parseStudentCurrentVocabWrongSummaries([
        {
          student_id: null,
          dataset_id: "dataset-1",
          wrong_word_count: 1,
          repeated_wrong_word_count: 0,
        },
      ]),
    ).toThrow("학생·단어장");
    expect(() =>
      parseStudentCurrentVocabWrongSummaries([
        {
          student_id: "student-1",
          dataset_id: "dataset-1",
          wrong_word_count: 1,
          repeated_wrong_word_count: 2,
        },
      ]),
    ).toThrow("반복 오답 단어 수");
  });

  it("rejects duplicate rows instead of hiding a broken cursor", () => {
    expect(() =>
      indexStudentCurrentVocabWrongSummaries([
        {
          studentId: "student-1",
          datasetId: "dataset-1",
          wrongWordCount: 1,
          repeatedWrongWordCount: 0,
        },
        {
          studentId: "student-1",
          datasetId: "dataset-1",
          wrongWordCount: 1,
          repeatedWrongWordCount: 0,
        },
      ]),
    ).toThrow("중복된 학생·단어장");
  });
});
