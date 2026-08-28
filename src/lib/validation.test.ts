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
} from "@/lib/admin/bulk-assignment-request";
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
  const studentIds = [
    "11111111-1111-4111-8111-111111111111",
    "22222222-2222-4222-8222-222222222222",
  ];
  const schedule = {
    unitsPerSession: 3,
    sessionCount: 5,
    firstAvailableFrom: "2026-08-12T00:00:00.000Z",
    dayInterval: 2,
    firstAvailableUntil: "2026-08-12T12:00:00.000Z",
  };

  it("서로 다른 학생 1~210명만 미리보기 대상으로 받는다", () => {
    expect(
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toMatchObject({ studentIds, rangeMode: "previous_span" });
    expect(
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        rangeMode: "fixed_span",
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }).rangeMode,
    ).toBe("fixed_span");
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        rangeMode: "seven_assignments",
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow();
    expect(
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }).studentIds,
    ).toEqual(studentIds);
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds: [studentIds[0], studentIds[0]],
        ...schedule,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow("같은 학생을 두 번 선택할 수 없습니다.");
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds: Array.from({ length: 211 }, (_, index) =>
          `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        ),
        ...schedule,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow();
  });

  it("회차당 DAY 수·시험 횟수·날짜 간격을 검증한다", () => {
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        sessionCount: 8,
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow();
    expect(() =>
      bulkAssignmentPreviewSchema.parse({
        studentIds,
        ...schedule,
        firstAvailableUntil: "2026-08-11T12:00:00.000Z",
        includePendingReview: false,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      }),
    ).toThrow("첫 시험 마감은 첫 배정 시간보다 뒤로 정해 주세요.");
  });

  it("날짜를 줄이지 않고 기본 회차만 쓰라는 우회 요청은 받지 않는다", () => {
    const availableFrom = "2026-08-24T00:00:00.000Z";
    const availableUntil = "2026-08-24T12:00:00.000Z";
    expect(() => bulkAssignmentPreviewSchema.parse({
      studentIds,
      ...schedule,
      includePendingReview: false,
      reviewLevels: [1, 2],
      englishToKoreanRatio: 50,
      commonPlan: {
        datasetId: studentIds[0],
        distribution: "split",
        questionCount: { mode: "manual", value: 45 },
        overflowPolicy: "leave",
        extraDatePolicy: "base_only",
        selectedDateCount: 1,
        selectionMode: "source_order",
        planNonce: "33333333-3333-4333-8333-333333333333",
        recurrenceSessions: [{ availableFrom, availableUntil }],
        sessions: [{
          unitIds: [studentIds[0]],
          availableFrom,
          availableUntil,
        }],
        collisionDecisions: [],
      },
    })).toThrow();
  });

  it("범위 단위 회차는 선택한 전체 순서와 요일별 단위 수를 정확히 지킨다", () => {
    const unitIds = Array.from({ length: 4 }, (_, index) =>
      `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`
    );
    const sessions = [0, 1].map((index) => ({
      unitIds: unitIds.slice(index * 2, index * 2 + 2),
      availableFrom: `2026-08-${24 + index * 2}T07:00:00.000Z`,
      availableUntil: `2026-08-${24 + index * 2}T13:00:00.000Z`,
    }));
    const input = {
      studentIds,
      ...schedule,
      sessionCount: 2,
      includePendingReview: false,
      reviewLevels: [1, 2],
      englishToKoreanRatio: 50,
      commonPlan: {
        datasetId: studentIds[0],
        distribution: "split",
        splitBasis: "range_unit",
        orderedUnitIds: unitIds,
        rangeUnitCounts: [2, 2],
        unitAllocationRule: {
          schemaVersion: 1,
          mode: "same",
          unitsPerSession: 2,
          weekdayUnitsPerSession: {
            1: 2, 2: 2, 3: 2, 4: 2, 5: 2, 6: 2, 7: 2,
          },
        },
        questionCount: { mode: "all" },
        overflowPolicy: "continue_weekly",
        extraDatePolicy: "unconfirmed",
        selectedDateCount: 2,
        selectionMode: "source_order",
        planNonce: "33333333-3333-4333-8333-333333333333",
        recurrenceSessions: sessions.map(({ availableFrom, availableUntil }) => ({
          availableFrom,
          availableUntil,
        })),
        sessions,
        collisionDecisions: [],
      },
    } as const;

    expect(bulkAssignmentPreviewSchema.parse(input).commonPlan?.sessions)
      .toHaveLength(2);
    expect(() => bulkAssignmentPreviewSchema.parse({
      ...input,
      commonPlan: {
        ...input.commonPlan,
        unitAllocationRule: {
          ...input.commonPlan.unitAllocationRule,
          unitsPerSession: 1,
        },
      },
    })).toThrow("요일별 단위 수가 원래 반복 일정의 규칙과 일치하지 않습니다.");
    for (const invalidCount of [0, 31]) {
      expect(() => bulkAssignmentPreviewSchema.parse({
        ...input,
        commonPlan: {
          ...input.commonPlan,
          unitAllocationRule: {
            ...input.commonPlan.unitAllocationRule,
            unitsPerSession: invalidCount,
          },
        },
      })).toThrow();
    }
    expect(() => bulkAssignmentPreviewSchema.parse({
      ...input,
      commonPlan: {
        ...input.commonPlan,
        sessions: [sessions[1], sessions[0]],
      },
    })).toThrow("회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.");
    expect(() => bulkAssignmentPreviewSchema.parse({
      ...input,
      commonPlan: {
        ...input.commonPlan,
        sessions: [sessions[0], sessions[0]],
      },
    })).toThrow("회차별 범위가 선택한 순서 또는 단위 수와 일치하지 않습니다.");
  });

  it("배정된 시험은 31명도 허용하되 학생과 회차를 합쳐 210시험을 지킨다", () => {
    const manyStudents = Array.from({ length: 31 }, (_, index) =>
      `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const availableFrom = "2026-08-24T07:00:00.000Z";
    const availableUntil = "2026-08-24T13:00:00.000Z";
    const unitId = "60000000-0000-4000-8000-000000000000";
    const oneSessionPlan = {
      datasetId: unitId,
      distribution: "split",
      splitBasis: "question_count",
      orderedUnitIds: [unitId],
      rangeUnitCounts: [],
      unitAllocationRule: null,
      questionCount: { mode: "manual", value: 20 },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 1,
      selectionMode: "source_order",
      planNonce: "70000000-0000-4000-8000-000000000000",
      recurrenceSessions: [{ availableFrom, availableUntil }],
      sessions: [{ unitIds: [unitId], availableFrom, availableUntil }],
      collisionDecisions: [],
    } as const;
    expect(bulkAssignmentPreviewSchema.parse({
      studentIds: manyStudents,
      ...schedule,
      sessionCount: 1,
      includePendingReview: false,
      reviewLevels: [1, 2],
      englishToKoreanRatio: 50,
      commonPlan: oneSessionPlan,
    }).studentIds).toHaveLength(31);

    const sevenUnits = Array.from({ length: 7 }, (_, index) =>
      `80000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    );
    const sevenSessions = sevenUnits.map((id, index) => ({
      unitIds: [id],
      availableFrom: `2026-0${9 + Math.floor(index / 28)}-${String(1 + index).padStart(2, "0")}T07:00:00.000Z`,
      availableUntil: `2026-0${9 + Math.floor(index / 28)}-${String(1 + index).padStart(2, "0")}T13:00:00.000Z`,
    }));
    expect(() => bulkAssignmentPreviewSchema.parse({
      studentIds: manyStudents,
      ...schedule,
      sessionCount: 7,
      includePendingReview: false,
      reviewLevels: [1, 2],
      englishToKoreanRatio: 50,
      commonPlan: {
        ...oneSessionPlan,
        datasetId: sevenUnits[0],
        splitBasis: "range_unit",
        orderedUnitIds: sevenUnits,
        rangeUnitCounts: [1],
        unitAllocationRule: {
          schemaVersion: 1,
          mode: "same",
          unitsPerSession: 1,
          weekdayUnitsPerSession: {
            1: 1, 2: 1, 3: 1, 4: 1, 5: 1, 6: 1, 7: 1,
          },
        },
        questionCount: { mode: "all" },
        overflowPolicy: "continue_weekly",
        recurrenceSessions: [{
          availableFrom: sevenSessions[0]!.availableFrom,
          availableUntil: sevenSessions[0]!.availableUntil,
        }],
        sessions: sevenSessions,
      },
    })).toThrow("한 번에 저장할 수 있는 시험은 전체 210개까지입니다.");
  });

  it("전체 시간과 문제당 시간을 동시에 저장하지 않는다", () => {
    const base = {
      studentIds,
      ...schedule,
      idempotencyKey: "33333333-3333-4333-8333-333333333333",
      previewPlanSignature: "a".repeat(64),
      includePendingReview: true,
      reviewLevels: [1, 2] as const,
      englishToKoreanRatio: 50 as const,
      timeLimitSeconds: 300,
      passingScore: 80,
      retryEnabled: true,
      retryPassingScore: 80,
      questionOrderMode: "random" as const,
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
