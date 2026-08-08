import { describe, expect, it } from "vitest";

import {
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
  createReviewAssignmentDraftSchema,
  createWrongWordWorksheetRequestSchema,
  createStudentSchema,
  exactReviewAssignmentSchema,
  mixedAssignmentSchema,
  updateStudentProfileSchema,
  updateStudentVocabSchema,
} from "@/lib/validation";

describe("오답 해석 시험지 요청 입력 계약", () => {
  const questionId = "11111111-1111-4111-8111-111111111111";

  it("중복 없는 UUID를 한 번에 1개부터 50개까지만 받는다", () => {
    expect(
      createWrongWordWorksheetRequestSchema.parse({
        questionIds: [questionId],
        curriculumStage: "undecided",
      }),
    ).toEqual({
      questionIds: [questionId],
      curriculumStage: "undecided",
    });
    const questionIds = Array.from(
      { length: 50 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    expect(
      createWrongWordWorksheetRequestSchema.parse({
        questionIds,
        curriculumStage: "undecided",
      })
        .questionIds,
    ).toHaveLength(50);
  });

  it("빈 배열·51개·중복·추가 필드를 거부한다", () => {
    const questionIds = Array.from(
      { length: 51 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    expect(() =>
      createWrongWordWorksheetRequestSchema.parse({
        questionIds: [],
        curriculumStage: "undecided",
      }),
    ).toThrow();
    expect(() =>
      createWrongWordWorksheetRequestSchema.parse({
        questionIds,
        curriculumStage: "undecided",
      }),
    ).toThrow();
    expect(() =>
      createWrongWordWorksheetRequestSchema.parse({
        questionIds: [questionId, questionId],
        curriculumStage: "undecided",
      }),
    ).toThrow("같은 오답 단어를 두 번 선택할 수 없습니다.");
    expect(() =>
      createWrongWordWorksheetRequestSchema.parse({
        questionIds: [questionId],
        curriculumStage: "undecided",
        studentName: "노출 금지",
      }),
    ).toThrow();
  });
});

describe("학생별 배정 수정 입력 계약", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  const replacement = {
    idempotencyKey: "22222222-2222-4222-8222-222222222222",
    title: "오답 1문항 수정",
    datasetId: id,
    primaryUnitIds: [id],
    includePendingReview: true,
    reviewLevels: [1] as const,
    questionCount: 1,
    englishToKoreanRatio: 100 as const,
    timeLimitSeconds: 300,
    timingMode: "total" as const,
    questionTimeLimitSeconds: null,
    passingScore: 80,
    questionOrderMode: "random" as const,
    availableUntil: null,
  };

  it("정확 오답 재시험 1문항을 허용하고 0문항은 거부한다", () => {
    expect(assignmentReplacementSchema.parse(replacement).questionCount).toBe(
      1,
    );
    expect(() =>
      assignmentReplacementSchema.parse({
        ...replacement,
        questionCount: 0,
      }),
    ).toThrow();
  });

  it("오답 추가를 끄면 빈 단계 배열을 허용하고 켜면 거부한다", () => {
    const preview = {
      studentId: id,
      datasetId: id,
      primaryUnitIds: [id],
      includePendingReview: false,
      reviewLevels: [],
      englishToKoreanRatio: 100 as const,
    };
    expect(
      assignmentReplacementPreviewSchema.parse(preview).reviewLevels,
    ).toEqual([]);
    expect(
      assignmentReplacementSchema.parse({
        ...replacement,
        includePendingReview: false,
        reviewLevels: [],
      }).reviewLevels,
    ).toEqual([]);
    expect(() =>
      assignmentReplacementPreviewSchema.parse({
        ...preview,
        includePendingReview: true,
      }),
    ).toThrow("포함할 오답 단계를 하나 이상 선택해 주세요.");
  });
});

describe("일괄 단어 시험 입력 계약", () => {
  const studentIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];

  it("서로 다른 학생 1~30명만 미리보기 대상으로 받는다", () => {
    expect(
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }).studentIds,
    ).toEqual(studentIds);
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds: [studentIds[0], studentIds[0]],
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow("같은 학생을 두 번 선택할 수 없습니다.");
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds: Array.from({ length: 31 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow();
  });

  it("전체 시간과 문제당 시간을 동시에 저장하지 않는다", () => {
    const base = {
      studentIds,
      includePendingReview: true,
      reviewLevels: [1, 2] as const,
      englishToKoreanRatio: 50 as const,
      timeLimitSeconds: 300,
      passingScore: 80,
      questionOrderMode: "random" as const,
      availableUntil: null,
    };
    expect(
      bulkAssignmentSchema.parse({
        ...base,
        timingMode: "total",
        questionTimeLimitSeconds: null,
      }).timingMode,
    ).toBe("total");
    expect(() =>
      bulkAssignmentSchema.parse({
        ...base,
        timingMode: "total",
        questionTimeLimitSeconds: 20,
      }),
    ).toThrow("시간 제한 방식과 문제당 시간을 확인해주세요.");
  });
});

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

  it("계정 설정은 이름·학교·학년만 허용하고 공백을 정리한다", () => {
    expect(
      updateStudentProfileSchema.parse({
        displayName: "  테스트 학생  ",
        schoolName: "  미리보고  ",
        gradeLabel: "  고3  ",
      }),
    ).toEqual({
      displayName: "테스트 학생",
      schoolName: "미리보고",
      gradeLabel: "고3",
    });
    expect(() =>
      updateStudentProfileSchema.parse({
        displayName: "",
        schoolName: "",
        gradeLabel: "",
      }),
    ).toThrow();
  });
});

describe("오답 재시험 초안 입력 계약", () => {
  const questionId =
    "11111111-1111-4111-8111-111111111111";

  it("중복 없는 UUID 1개부터 500개까지만 허용한다", () => {
    expect(
      createReviewAssignmentDraftSchema.parse({
        questionIds: [questionId],
      }),
    ).toEqual({ questionIds: [questionId] });

    const questionIds = Array.from(
      { length: 500 },
      (_, index) =>
        `11111111-1111-4111-8111-${String(index).padStart(12, "0")}`,
    );
    expect(
      createReviewAssignmentDraftSchema.parse({ questionIds })
        .questionIds,
    ).toHaveLength(500);
  });

  it("빈 배열·501개·중복·비 UUID·추가 필드를 거부한다", () => {
    const validIds = Array.from(
      { length: 501 },
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

describe("DAY+오답 혼합 시험 입력 계약", () => {
  const studentId =
    "11111111-1111-4111-8111-111111111111";
  const datasetId =
    "22222222-2222-4222-8222-222222222222";
  const unitId =
    "33333333-3333-4333-8333-333333333333";
  const validInput = {
    studentId,
    datasetId,
    primaryUnitIds: [unitId],
    reviewLevels: [1, 2] as const,
    totalQuestionCount: 10,
    title: "",
    englishToKoreanRatio: 50 as const,
    timeLimitSeconds: 300,
    passingScore: 80,
    questionOrderMode: "random" as const,
    availableUntil: null,
  };

  it("단일학생·주 DAY·오답 단계와 시험 조건만 받는다", () => {
    expect(mixedAssignmentSchema.parse(validInput)).toEqual(
      validInput,
    );
    expect(
      mixedAssignmentSchema.parse({
        ...validInput,
        availableUntil: "2026-08-01T10:00:00+09:00",
      }).availableUntil,
    ).toBe("2026-08-01T10:00:00+09:00");
  });

  it.each([
    ["queueIds", [studentId]],
    ["selectedQueueIds", [studentId]],
    ["reviewQueueIds", [studentId]],
    ["questions", []],
    ["questionDrafts", []],
    ["supportUnitIds", [unitId]],
    ["unitIds", [unitId]],
    ["studentIds", [studentId]],
    ["assignmentPurpose", "mixed"],
    ["reviewDraftId", studentId],
  ])("서버 전용 필드 %s 주입을 거절한다", (key, value) => {
    expect(() =>
      mixedAssignmentSchema.parse({
        ...validInput,
        [key]: value,
      }),
    ).toThrow();
  });

  it("중복과 범위 밖 조건을 거절한다", () => {
    expect(() =>
      mixedAssignmentSchema.parse({
        ...validInput,
        primaryUnitIds: [unitId, unitId],
      }),
    ).toThrow();
    expect(() =>
      mixedAssignmentSchema.parse({
        ...validInput,
        reviewLevels: [1, 1],
      }),
    ).toThrow();
    expect(() =>
      mixedAssignmentSchema.parse({
        ...validInput,
        reviewLevels: [3],
      }),
    ).toThrow();
  });

  it("숫자 문자열과 offset 없는 마감시각을 강제 변환하지 않는다", () => {
    for (const field of [
      "totalQuestionCount",
      "timeLimitSeconds",
      "passingScore",
    ] as const) {
      expect(() =>
        mixedAssignmentSchema.parse({
          ...validInput,
          [field]: String(validInput[field]),
        }),
      ).toThrow();
    }
    expect(() =>
      mixedAssignmentSchema.parse({
        ...validInput,
        availableUntil: "2026-08-01T10:00:00",
      }),
    ).toThrow();
  });
});
