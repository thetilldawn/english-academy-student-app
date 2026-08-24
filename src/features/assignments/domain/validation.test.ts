import { describe, expect, it } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import type {
  BulkSeriesAssignmentDraft,
  ResolvedSingleAssignment,
  SingleAssignmentDraft,
} from "./model";
import { normalizeLegacyQuestionOrderMode } from "./model";
import {
  validateBulkAssignmentSubmission,
  validateBulkPreviewProjection,
  validateLegacyReviewRecoveryDraft,
  validateSingleAssignmentSubmission,
  validateSingleCapacityProjection,
} from "./validation";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");

function resolved(title: string, questionCount: number, submissionTitle = title) {
  return {
    displayTitle: title,
    submissionTitle,
    questionCount,
  };
}

const baseSingle: SingleAssignmentDraft = {
  kind: "single",
  operation: { mode: "create" },
  studentId: assignmentContractIds.studentA,
  title: { mode: "custom", value: "검증 시험" },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [assignmentContractIds.day60],
  },
  questionCount: { mode: "manual", value: 4 },
  exam: {
    directionRatio: 50,
    questionOrderMode: "ascending",
    passingScore: 80,
    timing: { mode: "total", totalSeconds: 300 },
  },
  deadline: { mode: "none" },
  review: { mode: "none", scope: "dataset", levels: [1, 2] },
};

const baseResolved: ResolvedSingleAssignment = {
  displayTitle: "검증 시험",
  submissionTitle: "검증 시험",
  questionCount: 4,
};

const exactReview: SingleAssignmentDraft = {
  ...baseSingle,
  operation: {
    mode: "replace",
    assignmentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    targetStudentId: assignmentContractIds.studentA,
    sourcePurpose: "review",
    lockedShape: {
      datasetId: assignmentContractIds.dataset,
      orderedUnitIds: [assignmentContractIds.day60],
      questionCount: 1,
      reviewLevels: [2],
    },
  },
  title: { mode: "custom", value: "기존 오답 재시험" },
  questionCount: { mode: "manual", value: 1 },
  review: { mode: "pending", scope: "dataset", levels: [2] },
};

const baseBulk: BulkSeriesAssignmentDraft = {
  kind: "bulk_series",
  studentIds: [assignmentContractIds.studentA],
  range: { mode: "previous_span", unitsPerSession: 2, sessionCount: 2 },
  firstAvailableDateKorean: "2026-08-17",
  firstDeadline: { mode: "at", koreanLocalDateTime: "2026-08-17T21:00" },
  dayInterval: 2,
  exam: baseSingle.exam,
  review: { mode: "none", levels: [1, 2] },
};

function issuePaths(issues: ReturnType<typeof validateSingleAssignmentSubmission>) {
  return issues.map((issue) => issue.path);
}

describe("assignment draft validation", () => {
  it("capacity preview validates only fields projected into the capacity request", () => {
    const temporarilyInvalidSubmission: SingleAssignmentDraft = {
      ...baseSingle,
      title: { mode: "custom", value: "x".repeat(161) },
      questionCount: { mode: "manual", value: 0 },
      exam: {
        ...baseSingle.exam,
        passingScore: 101,
        timing: { mode: "total", totalSeconds: 1 },
      },
      deadline: { mode: "at", koreanLocalDateTime: "not-a-date" },
    };

    expect(
      validateSingleCapacityProjection(temporarilyInvalidSubmission),
    ).toStrictEqual([]);
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          temporarilyInvalidSubmission,
          resolved("x".repeat(161), 0),
          NOW,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        "exam.passingScore",
        "exam.timing.totalSeconds",
        "deadline",
        "questionCount",
        "title",
      ]),
    );
  });

  it("accepts the server title sentinel only for automatic creation", () => {
    const automaticCreate: SingleAssignmentDraft = {
      ...baseSingle,
      title: { mode: "automatic" },
      questionCount: { mode: "automatic", value: 4 },
    };
    expect(
      validateSingleAssignmentSubmission(
        automaticCreate,
        resolved("화면 자동 제목", 4, ""),
        NOW,
      ),
    ).toStrictEqual([]);
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          automaticCreate,
          resolved("화면 자동 제목", 4),
          NOW,
        ),
      ),
    ).toContain("title");

    const invalidSourceCreate = {
      ...baseSingle,
      title: { mode: "source", value: "서버 원제목" } as const,
    };
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          invalidSourceCreate,
          resolved("서버 원제목", 4),
          NOW,
        ),
      ),
    ).toContain("title");
  });

  it("regular assignments accept 4..500 questions and exact review keeps its locked count", () => {
    for (const questionCount of [4, 500]) {
      const draft = {
        ...baseSingle,
        questionCount: { mode: "manual", value: questionCount } as const,
      };
      expect(
        validateSingleAssignmentSubmission(
          draft,
          { ...baseResolved, questionCount },
          NOW,
        ),
      ).toStrictEqual([]);
    }

    for (const questionCount of [3, 501]) {
      const draft = {
        ...baseSingle,
        questionCount: { mode: "manual", value: questionCount } as const,
      };
      expect(
        issuePaths(
          validateSingleAssignmentSubmission(
            draft,
            { ...baseResolved, questionCount },
            NOW,
          ),
        ),
      ).toContain("questionCount");
    }

    expect(
      validateSingleAssignmentSubmission(
        exactReview,
        resolved("기존 오답 재시험", 1),
        NOW,
      ),
    ).toStrictEqual([]);
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          exactReview,
          resolved("기존 오답 재시험", 2),
          NOW,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        "questionCount",
        "operation.lockedShape.questionCount",
      ]),
    );
  });

  it("exact review rejects changes to review policy, range, levels, and count mode", () => {
    const projectedVariants: SingleAssignmentDraft[] = [
      {
        ...exactReview,
        review: { mode: "none", scope: "dataset", levels: [2] },
      },
      {
        ...exactReview,
        range: {
          ...exactReview.range,
          orderedUnitIds: [assignmentContractIds.day59],
        },
      },
      {
        ...exactReview,
        review: { mode: "pending", scope: "dataset", levels: [1] },
      },
    ];

    for (const draft of projectedVariants) {
      expect(issuePaths(validateSingleCapacityProjection(draft))).toContain(
        "operation.lockedShape",
      );
    }

    const automaticCount = {
      ...exactReview,
      questionCount: { mode: "automatic", value: 1 } as const,
    };
    expect(validateSingleCapacityProjection(automaticCount)).toStrictEqual(
      [],
    );
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          automaticCount,
          resolved("기존 오답 재시험", 1),
          NOW,
        ),
      ),
    ).toContain("operation.lockedShape.questionCount");
  });

  it("reverse unit order is valid while duplicate units and empty review levels are not", () => {
    expect(
      validateSingleCapacityProjection({
        ...baseSingle,
        range: {
          ...baseSingle.range,
          orderedUnitIds: [
            assignmentContractIds.day60,
            assignmentContractIds.day59,
          ],
        },
      }),
    ).toStrictEqual([]);

    expect(
      issuePaths(
        validateSingleCapacityProjection({
          ...baseSingle,
          range: {
            ...baseSingle.range,
            orderedUnitIds: [
              assignmentContractIds.day60,
              assignmentContractIds.day60,
            ],
          },
          review: { mode: "pending", scope: "dataset", levels: [] },
        }),
      ),
    ).toEqual(
      expect.arrayContaining(["range.orderedUnitIds", "review.levels"]),
    );
  });

  it("rejects malformed IDs before an adapter can construct a URL", () => {
    for (const invalidId of ["not-a-uuid", "../unexpected"]) {
      expect(
        issuePaths(
          validateSingleCapacityProjection({
            ...baseSingle,
            studentId: invalidId,
          }),
        ),
      ).toContain("studentId");
      expect(
        validateLegacyReviewRecoveryDraft({
          kind: "legacy_review_recovery",
          studentId: assignmentContractIds.studentA,
          reviewDraftId: invalidId,
        }).map((issue) => issue.path),
      ).toContain("reviewDraftId");
    }
  });

  it("rejects a replacement whose current student differs from its locked target", () => {
    const mismatched = {
      ...exactReview,
      studentId: assignmentContractIds.studentB,
    };
    expect(issuePaths(validateSingleCapacityProjection(mismatched))).toContain(
      "studentId",
    );
  });

  it("validates exam and title boundaries at submission time", () => {
    const validCases: SingleAssignmentDraft[] = [
      {
        ...baseSingle,
        exam: {
          ...baseSingle.exam,
          passingScore: 0,
          timing: { mode: "total", totalSeconds: 30 },
        },
      },
      {
        ...baseSingle,
        exam: {
          ...baseSingle.exam,
          passingScore: 100,
          timing: { mode: "total", totalSeconds: 10800 },
        },
      },
      {
        ...baseSingle,
        exam: {
          ...baseSingle.exam,
          timing: { mode: "per_question", perQuestionSeconds: 5 },
        },
      },
      {
        ...baseSingle,
        exam: {
          ...baseSingle.exam,
          timing: { mode: "per_question", perQuestionSeconds: 600 },
        },
      },
    ];
    for (const draft of validCases) {
      expect(
        validateSingleAssignmentSubmission(draft, baseResolved, NOW),
      ).toStrictEqual([]);
    }

    const invalidCases = [
      {
        draft: {
          ...baseSingle,
          exam: {
            ...baseSingle.exam,
            timing: { mode: "total", totalSeconds: 29 } as const,
          },
        },
        path: "exam.timing.totalSeconds",
      },
      {
        draft: {
          ...baseSingle,
          exam: {
            ...baseSingle.exam,
            timing: { mode: "per_question", perQuestionSeconds: 601 } as const,
          },
        },
        path: "exam.timing.perQuestionSeconds",
      },
      {
        draft: {
          ...baseSingle,
          exam: { ...baseSingle.exam, passingScore: -1 },
        },
        path: "exam.passingScore",
      },
    ];
    for (const { draft, path } of invalidCases) {
      expect(
        issuePaths(
          validateSingleAssignmentSubmission(draft, baseResolved, NOW),
        ),
      ).toContain(path);
    }

    const runtimeInvalid = {
      ...baseSingle,
      title: { mode: "custom", value: "x".repeat(161) },
      exam: {
        ...baseSingle.exam,
        directionRatio: 25,
        questionOrderMode: "fixed",
      },
    } as unknown as SingleAssignmentDraft;
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(
          runtimeInvalid,
          resolved("x".repeat(161), 4),
          NOW,
        ),
      ),
    ).toEqual(
      expect.arrayContaining([
        "exam.directionRatio",
        "exam.questionOrderMode",
        "title",
      ]),
    );
  });

  it("single and bulk submission reject elapsed deadlines with an injected clock", () => {
    const pastSingle = {
      ...baseSingle,
      deadline: { mode: "at", koreanLocalDateTime: "2026-08-09T21:00" } as const,
    };
    expect(
      issuePaths(
        validateSingleAssignmentSubmission(pastSingle, baseResolved, NOW),
      ),
    ).toContain("deadline");

    const pastBulk = {
      ...baseBulk,
      firstAvailableDateKorean: "2026-08-09",
      firstDeadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-09T21:00",
      } as const,
    };
    expect(
      validateBulkAssignmentSubmission(pastBulk, NOW).map(
        (issue) => issue.path,
      ),
    ).toContain("firstDeadline");
  });

  it("공통 배정은 처음 발견한 과거 마감을 정확한 회차 필드에 연결한다", () => {
    const sessions = [
      {
        unitIds: [assignmentContractIds.day60],
        availableLocalDateTime: "2026-08-11T09:00",
        deadlineLocalDateTime: "2026-08-30T22:00",
      },
      {
        unitIds: [assignmentContractIds.day60],
        availableLocalDateTime: "2026-08-12T09:00",
        deadlineLocalDateTime: "2026-08-13T22:00",
      },
    ];
    const commonDraft: BulkSeriesAssignmentDraft = {
      ...baseBulk,
      range: { mode: "fixed_span", unitsPerSession: 1, sessionCount: 2 },
      commonPlan: {
        datasetId: assignmentContractIds.dataset,
        distribution: "split",
        splitBasis: "question_count",
        orderedUnitIds: [assignmentContractIds.day60],
        rangeUnitCounts: [],
        questionCount: { mode: "manual", value: 20 },
      overflowPolicy: "leave",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 2,
        selectionMode: "source_order",
        planNonce: assignmentContractIds.idempotencyKey,
        sessions,
        recurrenceSessions: sessions.map((session) => ({
          availableLocalDateTime: session.availableLocalDateTime,
          deadlineLocalDateTime: session.deadlineLocalDateTime,
        })),
        collisionDecisions: [],
      },
    };

    expect(
      validateBulkAssignmentSubmission(
        commonDraft,
        Date.parse("2026-08-20T00:00:00.000Z"),
      ).map((issue) => issue.path),
    ).toContain("commonPlan.sessions.1.deadlineLocalDateTime");
  });

  it("배정된 시험은 31명도 허용하고 학생과 회차를 합쳐 210시험을 지킨다", () => {
    const students = Array.from(
      { length: 106 },
      (_, index) => `student-${index}`,
    );
    const sessions = [
      {
        unitIds: [assignmentContractIds.day60],
        availableLocalDateTime: "2026-08-17T09:00",
        deadlineLocalDateTime: "2026-08-17T22:00",
      },
      {
        unitIds: [assignmentContractIds.day60],
        availableLocalDateTime: "2026-08-19T09:00",
        deadlineLocalDateTime: "2026-08-19T22:00",
      },
    ];
    const commonPlan = {
      datasetId: assignmentContractIds.dataset,
      distribution: "split" as const,
      splitBasis: "question_count" as const,
      orderedUnitIds: [assignmentContractIds.day60],
      rangeUnitCounts: [],
      questionCount: { mode: "manual" as const, value: 20 },
      overflowPolicy: "leave" as const,
      extraDatePolicy: "unconfirmed" as const,
      selectedDateCount: 2,
      selectionMode: "source_order" as const,
      planNonce: assignmentContractIds.idempotencyKey,
      sessions,
      recurrenceSessions: sessions,
      collisionDecisions: [],
    };

    expect(validateBulkPreviewProjection({
      ...baseBulk,
      studentIds: students.slice(0, 31),
      range: { ...baseBulk.range, sessionCount: 1 },
      commonPlan: {
        ...commonPlan,
        selectedDateCount: 1,
        sessions: sessions.slice(0, 1),
        recurrenceSessions: sessions.slice(0, 1),
      },
    }).map((issue) => issue.path)).not.toContain("studentIds");

    expect(validateBulkPreviewProjection({
      ...baseBulk,
      studentIds: students,
      commonPlan,
    }).map((issue) => issue.path)).toContain("range.sessionCount");
  });

  it("bulk preview validates selection while submit additionally validates exam and future deadline", () => {
    expect(validateBulkPreviewProjection(baseBulk)).toStrictEqual([]);
    expect(validateBulkAssignmentSubmission(baseBulk, NOW)).toStrictEqual([]);

    const invalidSelection = {
      ...baseBulk,
      studentIds: [
        assignmentContractIds.studentA,
        assignmentContractIds.studentA,
      ],
      range: { ...baseBulk.range, unitsPerSession: 0, sessionCount: 8 },
      dayInterval: 31,
      firstDeadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-16T23:59",
      } as const,
    };
    expect(
      validateBulkPreviewProjection(invalidSelection).map(
        (issue) => issue.path,
      ),
    ).toEqual(
      expect.arrayContaining([
        "studentIds",
        "range.unitsPerSession",
        "range.sessionCount",
        "dayInterval",
        "firstDeadline",
      ]),
    );

    const invalidExam = {
      ...baseBulk,
      exam: {
        ...baseBulk.exam,
        passingScore: 101,
        timing: { mode: "total", totalSeconds: 1 } as const,
      },
    };
    expect(validateBulkPreviewProjection(invalidExam)).toStrictEqual([]);
    expect(
      validateBulkAssignmentSubmission(invalidExam, NOW).map(
        (issue) => issue.path,
      ),
    ).toEqual(
      expect.arrayContaining([
        "exam.passingScore",
        "exam.timing.totalSeconds",
      ]),
    );
  });

  it("allows a same-day bulk start that is already past when its deadline is still future", () => {
    const sameDay = {
      ...baseBulk,
      firstAvailableDateKorean: "2026-08-17",
      firstDeadline: {
        mode: "at",
        koreanLocalDateTime: "2026-08-17T22:00",
      } as const,
    };
    const nowAtNinePmKorean = Date.parse("2026-08-17T12:00:00.000Z");

    expect(
      validateBulkAssignmentSubmission(sameDay, nowAtNinePmKorean),
    ).toStrictEqual([]);
  });

  it("normalizes the legacy fixed order to ascending at the domain boundary", () => {
    expect(normalizeLegacyQuestionOrderMode("fixed")).toBe("ascending");
    expect(normalizeLegacyQuestionOrderMode("descending")).toBe(
      "descending",
    );
  });
});
