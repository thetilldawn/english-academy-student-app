import { describe, expect, it } from "vitest";

import {
  createVocabTimeTemplateSchema,
  createReviewAssignmentDraftSchema,
  createWrongWordWorksheetRequestSchema,
  createStudentSchema,
  updateStudentProfileSchema,
  updateStudentVocabSchema,
} from "@/lib/validation";
import {
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
} from "@/lib/admin/assignment-replacement-request";
import {
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
} from "@/features/assignments/contracts/bulk-assignment-request";
import {
  directReviewAssignmentSchema,
  directReviewPreviewSchema,
} from "@/lib/admin/direct-review-assignment-request";
import {
  mixedAssignmentSchema,
} from "@/lib/admin/mixed-assignment-request";

describe("시간 템플릿 입력 계약", () => {
  it("제한시간 방식과 값이 일치할 때만 받는다", () => {
    const valid = {
      name: "저녁 수업",
      availableTime: "18:00",
      deadlineDayOffset: 1,
      deadlineTime: "22:00",
      timingMode: "total" as const,
      totalSeconds: 300,
      perQuestionSeconds: null,
    };
    expect(createVocabTimeTemplateSchema.parse(valid)).toEqual(valid);
    expect(() => createVocabTimeTemplateSchema.parse({
      ...valid,
      totalSeconds: null,
      perQuestionSeconds: 20,
    })).toThrow();
    expect(createVocabTimeTemplateSchema.parse({
      ...valid,
      name: "저녁",
    }).name).toBe("저녁");
  });
});

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
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random" as const,
    availableFrom: null,
    availableUntil: null,
    reviewScope: "dataset" as const,
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
  const studentId = "11111111-1111-4111-8111-111111111111";
  const datasetId = "22222222-2222-4222-8222-222222222222";
  const unitA = "33333333-3333-4333-8333-333333333333";
  const unitB = "44444444-4444-4444-8444-444444444444";
  const planNonce = "55555555-5555-4555-8555-555555555555";
  const idempotencyKey = "66666666-6666-4666-8666-666666666666";
  const previewPlanSignature = "a".repeat(64);
  const first = {
    availableFrom: "2026-08-24T00:00:00.000Z",
    availableUntil: "2026-08-24T12:00:00.000Z",
  };
  const second = {
    availableFrom: "2026-08-26T00:00:00.000Z",
    availableUntil: "2026-08-26T12:00:00.000Z",
  };
  const scheduledPlan = {
    datasetId,
    distribution: "split" as const,
    splitBasis: "question_count" as const,
    orderedUnitIds: [unitA, unitB],
    rangeUnitCounts: [],
    unitAllocationRule: null,
    questionCount: { mode: "manual" as const, value: 20 },
    overflowPolicy: "leave" as const,
    extraDatePolicy: "unconfirmed" as const,
    selectedDateCount: 2,
    selectionMode: "source_order" as const,
    planNonce,
    recurrenceSessions: [first, second],
    sessions: [
      { ...first, unitIds: [unitA, unitB] },
      { ...second, unitIds: [unitA, unitB] },
    ],
  };
  const preview = {
    studentIds: [studentId],
    englishToKoreanRatio: 50 as const,
    commonPlan: scheduledPlan,
  };
  const submission = {
    ...preview,
    idempotencyKey,
    previewPlanSignature,
    timeLimitSeconds: 300,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "ascending" as const,
    timingMode: "total" as const,
    questionTimeLimitSeconds: null,
  };

  it("일정 배정과 시험일 없는 즉시 배정을 정확한 형태로 받는다", () => {
    expect(bulkAssignmentPreviewSchema.parse(preview)).toStrictEqual(preview);
    expect(bulkAssignmentSchema.parse(submission)).toStrictEqual(submission);

    const immediatePlan = {
      ...scheduledPlan,
      distribution: "repeat" as const,
      orderedUnitIds: [unitA],
      questionCount: { mode: "all" as const },
      selectedDateCount: 0,
      recurrenceSessions: [
        { availableFrom: null, availableUntil: null },
      ],
      sessions: [
        { unitIds: [unitA], availableFrom: null, availableUntil: null },
      ],
    };
    const immediate = {
      studentIds: [studentId],
      englishToKoreanRatio: 50 as const,
      commonPlan: immediatePlan,
    };
    expect(bulkAssignmentPreviewSchema.parse(immediate)).toStrictEqual(
      immediate,
    );
  });

  it("예전 분산 필드를 받지 않는다", () => {
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      sessionCount: 2,
    }).success).toBe(false);
  });

  it("학생은 210명까지, 학생과 회차를 곱한 시험도 210개까지만 받는다", () => {
    const students = Array.from(
      { length: 210 },
      (_, index) =>
        "70000000-0000-4000-8000-" + String(index).padStart(12, "0"),
    );
    const oneSessionPlan = {
      ...scheduledPlan,
      selectedDateCount: 1,
      recurrenceSessions: [first],
      sessions: [{ ...first, unitIds: [unitA, unitB] }],
    };
    expect(bulkAssignmentPreviewSchema.parse({
      ...preview,
      studentIds: students,
      commonPlan: oneSessionPlan,
    }).studentIds).toHaveLength(210);
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      studentIds: students.slice(0, 106),
    }).success).toBe(false);
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      studentIds: [...students, studentId],
      commonPlan: oneSessionPlan,
    }).success).toBe(false);
  });

  it("일정 배정은 공개와 마감을 모두 요구하고 순서를 검증한다", () => {
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      commonPlan: {
        ...scheduledPlan,
        recurrenceSessions: [{ availableFrom: null, availableUntil: null }, second],
      },
    }).success).toBe(false);
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      commonPlan: {
        ...scheduledPlan,
        sessions: [
          { ...first, availableUntil: first.availableFrom, unitIds: [unitA, unitB] },
          { ...second, unitIds: [unitA, unitB] },
        ],
      },
    }).success).toBe(false);
  });

  it("범위 단위 배정은 요일별 단위 수와 실제 회차 범위를 일치시킨다", () => {
    const rangePlan = {
      ...scheduledPlan,
      splitBasis: "range_unit" as const,
      rangeUnitCounts: [1, 1],
      unitAllocationRule: {
        schemaVersion: 1 as const,
        mode: "same" as const,
        unitsPerSession: 1,
        weekdayUnitsPerSession: {
          1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1,
        },
      },
      questionCount: { mode: "all" as const },
      sessions: [
        { ...first, unitIds: [unitA] },
        { ...second, unitIds: [unitB] },
      ],
    };
    expect(bulkAssignmentPreviewSchema.parse({
      ...preview,
      commonPlan: rangePlan,
    }).commonPlan.sessions).toHaveLength(2);
    expect(bulkAssignmentPreviewSchema.safeParse({
      ...preview,
      commonPlan: {
        ...rangePlan,
        sessions: [rangePlan.sessions[1], rangePlan.sessions[0]],
      },
    }).success).toBe(false);
  });

  it("시험 시간과 재시험 설정을 서로 맞춰서 저장한다", () => {
    expect(bulkAssignmentSchema.safeParse({
      ...submission,
      timingMode: "total",
      questionTimeLimitSeconds: 15,
    }).success).toBe(false);
    expect(bulkAssignmentSchema.safeParse({
      ...submission,
      retryEnabled: false,
      retryPassingScore: 80,
    }).success).toBe(false);
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
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random" as const,
    availableUntil: null,
  };
  const directValidInput = {
    studentId,
    datasetId,
    reviewLevels: [1, 2] as const,
    totalQuestionCount: 10,
    title: "",
    englishToKoreanRatio: 50 as const,
    timeLimitSeconds: 300,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random" as const,
    availableFrom: null,
    availableUntil: null,
    idempotencyKey: studentId,
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

  it("독립 오답 시험만 1~3문항을 허용하고 일반 혼합 시험은 최소 4문항을 유지한다", () => {
    for (const totalQuestionCount of [1, 2, 3]) {
      const input = {
        ...directValidInput,
        totalQuestionCount,
      };
      expect(directReviewAssignmentSchema.parse(input).totalQuestionCount).toBe(
        totalQuestionCount,
      );
      expect(mixedAssignmentSchema.safeParse(input).success).toBe(false);
    }
    expect(directReviewAssignmentSchema.safeParse({
      ...directValidInput,
      totalQuestionCount: 0,
    }).success).toBe(false);
    expect(directReviewAssignmentSchema.safeParse({
      ...directValidInput,
      totalQuestionCount: 401,
    }).success).toBe(false);
  });

  it("독립 오답 미리보기는 학생·단어장·오답 단계·방향만 받는다", () => {
    const preview = {
      studentId,
      datasetId,
      reviewLevels: [1, 2] as const,
      englishToKoreanRatio: 50 as const,
    };
    expect(directReviewPreviewSchema.parse(preview)).toEqual(preview);
    expect(directReviewPreviewSchema.safeParse({
      ...preview,
      primaryUnitIds: [unitId],
    }).success).toBe(false);
    expect(directReviewPreviewSchema.safeParse({
      ...preview,
      reviewScope: "dataset",
    }).success).toBe(false);
  });

  it("독립 오답 저장은 범위와 수동 오답 큐 조건을 받지 않는다", () => {
    for (const [key, value] of [
      ["primaryUnitIds", [unitId]],
      ["reviewScope", "dataset"],
      ["selectedQueueIds", [studentId]],
    ] as const) {
      expect(directReviewAssignmentSchema.safeParse({
        ...directValidInput,
        [key]: value,
      }).success).toBe(false);
    }
  });

  it.each([undefined, "not-a-uuid"])(
    "독립 오답 시험의 멱등키 %s를 거절한다",
    (idempotencyKey) => {
      expect(directReviewAssignmentSchema.safeParse({
        ...directValidInput,
        idempotencyKey,
        totalQuestionCount: 1,
      }).success).toBe(false);
    },
  );

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
