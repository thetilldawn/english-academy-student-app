import { describe, expect, it } from "vitest";

import {
  isVocabularyLearningSource,
  learningSourceLabelsForStudent,
  learningSourceTypeLabel,
  type StudentLearningSourceItem,
} from "@/lib/admin/learning-sources";

const sources: StudentLearningSourceItem[] = [
  {
    id: "source-b",
    studentId: "student-a",
    sourceType: "textbook",
    vocabDatasetId: null,
    displayLabel: "천재(이) [2015] 3,4,Sp",
    rangeMetadata: {},
    sortOrder: 20,
  },
  {
    id: "source-a",
    studentId: "student-a",
    sourceType: "exam_vocab",
    vocabDatasetId: "dataset-a",
    displayLabel: "마석중 3-1 중간 대비 단어",
    rangeMetadata: {},
    sortOrder: 10,
  },
  {
    id: "source-c",
    studentId: "student-b",
    sourceType: "primary_vocab",
    vocabDatasetId: "dataset-b",
    displayLabel: "다른 학생 단어장",
    rangeMetadata: {},
    sortOrder: 0,
  },
];

describe("learning sources", () => {
  it("학생별 자료를 정렬된 검색 문자열 순서로 돌려준다", () => {
    expect(learningSourceLabelsForStudent(sources, "student-a")).toEqual([
      "마석중 3-1 중간 대비 단어",
      "천재(이) [2015] 3,4,Sp",
    ]);
  });

  it("자료 유형을 학생용 짧은 이름으로 바꾼다", () => {
    expect(learningSourceTypeLabel("primary_vocab")).toBe("최근 단어장");
    expect(learningSourceTypeLabel("exam_vocab")).toBe("시험 대비");
    expect(learningSourceTypeLabel("mock_exam")).toBe("모의고사");
  });

  it("단어 자료와 지문 자료의 작업 화면을 구분한다", () => {
    expect(isVocabularyLearningSource("primary_vocab")).toBe(true);
    expect(isVocabularyLearningSource("exam_vocab")).toBe(true);
    expect(isVocabularyLearningSource("passage")).toBe(false);
  });
});
