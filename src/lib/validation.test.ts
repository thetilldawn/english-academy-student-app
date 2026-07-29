import { describe, expect, it } from "vitest";

import {
  createReviewAssignmentDraftSchema,
  createStudentSchema,
  exactReviewAssignmentSchema,
  updateStudentVocabSchema,
} from "@/lib/validation";

describe("학생 정보 입력 계약", () => {
  const datasetId = "11111111-1111-4111-8111-111111111111";

  it("학생 이름만 필수이고 단어장과 나머지는 선택 사항으로 둔다", () => {
    expect(
      createStudentSchema.parse({
        displayName: "  테스트 학생  ",
        currentVocabDatasetId: datasetId,
      }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "",
      gradeLabel: "",
      currentVocabDatasetId: datasetId,
      note: "",
    });
  });

  it("단어장 없이도 학생을 만들 수 있게 null로 정규화한다", () => {
    expect(
      createStudentSchema.parse({
        displayName: "테스트 학생",
      }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "",
      gradeLabel: "",
      currentVocabDatasetId: null,
      note: "",
    });
  });

  it("공백뿐인 학생 이름은 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({
        displayName: "   ",
        currentVocabDatasetId: datasetId,
      }),
    ).toThrow();
  });

  it("임의 단어장 문자열 입력은 거절한다", () => {
    expect(() =>
      createStudentSchema.parse({
        displayName: "테스트 학생",
        currentVocabDatasetId: "능률 VOCA 어원편",
      }),
    ).toThrow();
  });

  it("현재 단어장은 검수 데이터셋 ID 또는 미선택만 받는다", () => {
    expect(
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: datasetId,
      }),
    ).toEqual({ currentVocabDatasetId: datasetId });
    expect(
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: "",
      }),
    ).toEqual({ currentVocabDatasetId: null });
    expect(() =>
      updateStudentVocabSchema.parse({
        currentVocabDatasetId: "직접 입력 단어장",
      }),
    ).toThrow();
  });
});

describe("오답 재시험 초안 입력 계약", () => {
  const questionId =
    "11111111-1111-4111-8111-111111111111";

  it("중복 없는 UUID 1개부터 400개까지만 허용한다", () => {
    expect(
      createReviewAssignmentDraftSchema.parse({
        questionIds: [questionId],
      }),
    ).toEqual({ questionIds: [questionId] });

    const questionIds = Array.from(
      { length: 400 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    expect(
      createReviewAssignmentDraftSchema.parse({ questionIds })
        .questionIds,
    ).toHaveLength(400);
  });

  it("빈 배열·401개·중복·비 UUID·추가 필드를 거부한다", () => {
    const validIds = Array.from(
      { length: 401 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    expect(() =>
      createReviewAssignmentDraftSchema.parse({ questionIds: [] }),
    ).toThrow();
    expect(() =>
      createReviewAssignmentDraftSchema.parse({
        questionIds: validIds,
      }),
    ).toThrow();
    expect(() =>
      createReviewAssignmentDraftSchema.parse({
        questionIds: [questionId, questionId],
      }),
    ).toThrow();
    expect(() =>
      createReviewAssignmentDraftSchema.parse({
        questionIds: ["question-1"],
      }),
    ).toThrow();
    expect(() =>
      createReviewAssignmentDraftSchema.parse({
        questionIds: [questionId],
        datasetId: questionId,
      }),
    ).toThrow();
  });
});

describe("정확 오답 재시험 배정 입력 계약", () => {
  const reviewDraftId =
    "11111111-1111-4111-8111-111111111111";
  const validInput = {
    reviewDraftId,
    title: "",
    englishToKoreanRatio: 50 as const,
    timeLimitSeconds: 300,
    passingScore: 80,
    questionOrderMode: "random" as const,
    availableUntil: null,
  };

  it("초안 UUID와 시험 조건만 엄격하게 받는다", () => {
    expect(exactReviewAssignmentSchema.parse(validInput)).toEqual(
      validInput,
    );
    for (const ratio of [0, 50, 100] as const) {
      expect(
        exactReviewAssignmentSchema.parse({
          ...validInput,
          englishToKoreanRatio: ratio,
        }).englishToKoreanRatio,
      ).toBe(ratio);
    }
  });

  it("DAY·학생·문항 ID 주입과 범위 밖 조건을 거부한다", () => {
    expect(() =>
      exactReviewAssignmentSchema.parse({
        ...validInput,
        studentIds: [reviewDraftId],
      }),
    ).toThrow();
    expect(() =>
      exactReviewAssignmentSchema.parse({
        ...validInput,
        questionIds: [reviewDraftId],
      }),
    ).toThrow();
    expect(() =>
      exactReviewAssignmentSchema.parse({
        ...validInput,
        unitIds: [reviewDraftId],
      }),
    ).toThrow();
    expect(() =>
      exactReviewAssignmentSchema.parse({
        ...validInput,
        englishToKoreanRatio: 25,
      }),
    ).toThrow();
    expect(() =>
      exactReviewAssignmentSchema.parse({
        ...validInput,
        timeLimitSeconds: 29,
      }),
    ).toThrow();
  });
});
