import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class MockAssignmentCreationError extends Error {
    constructor(
      public readonly reason:
        | "conflict"
        | "invalid_selection"
        | "database",
    ) {
      super("regular preparation error");
    }
  }

  class MockMixedAssignmentError extends Error {
    constructor(
      public readonly reason:
        | "forbidden"
        | "conflict"
        | "unavailable"
        | "invalid_selection"
        | "database",
    ) {
      super("mixed preparation error");
    }
  }

  return {
    AssignmentCreationError: MockAssignmentCreationError,
    MixedAssignmentError: MockMixedAssignmentError,
    assertAssignmentEditFieldPolicy: vi.fn(),
    assertExactReviewShape: vi.fn(),
    assertLegacyMixedContentShape: vi.fn(),
    canReuseSourceQuestions: vi.fn(),
    prepareMixedAssignmentBatch: vi.fn(),
    prepareRegularAssignment: vi.fn(),
    requireAdmin: vi.fn(),
    requireEditableSourceContext: vi.fn(),
  };
});

vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/services/assignment-edit-source-service", () => ({
  requireEditableSourceContext: mocks.requireEditableSourceContext,
}));
vi.mock("@/lib/services/assignment-replacement-policy", () => ({
  assertAssignmentEditFieldPolicy: mocks.assertAssignmentEditFieldPolicy,
  assertExactReviewShape: mocks.assertExactReviewShape,
  assertLegacyMixedContentShape: mocks.assertLegacyMixedContentShape,
  canReuseSourceQuestions: mocks.canReuseSourceQuestions,
}));
vi.mock("@/lib/services/mixed-assignment-service", () => ({
  calculateAssignmentCapacity: vi.fn(),
  MixedAssignmentError: mocks.MixedAssignmentError,
  prepareMixedAssignmentBatch: mocks.prepareMixedAssignmentBatch,
}));
vi.mock("@/lib/services/regular-assignment-service", () => ({
  AssignmentCreationError: mocks.AssignmentCreationError,
  prepareRegularAssignment: mocks.prepareRegularAssignment,
}));

import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import { prepareStudentAssignmentReplacement } from "@/lib/services/assignment-replacement-preparation-service";

const ids = {
  assignment: "11111111-1111-4111-8111-111111111111",
  dataset: "22222222-2222-4222-8222-222222222222",
  student: "33333333-3333-4333-8333-333333333333",
  unit: "44444444-4444-4444-8444-444444444444",
};
const admin = { displayName: "테스트 관리자", userId: "admin-id" };
const input: AssignmentReplacementInput = {
  availableFrom: null,
  availableUntil: null,
  datasetId: ids.dataset,
  englishToKoreanRatio: 50,
  idempotencyKey: "55555555-5555-4555-8555-555555555555",
  includePendingReview: false,
  passingScore: 80,
  primaryUnitIds: [ids.unit],
  questionCount: 20,
  questionOrderMode: "random",
  questionTimeLimitSeconds: null,
  retryEnabled: true,
  retryPassingScore: 80,
  reviewLevels: [],
  reviewScope: "dataset",
  timeLimitSeconds: 300,
  timingMode: "total",
  title: "단어 시험",
};

describe("assignment replacement preparation errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.canReuseSourceQuestions.mockReturnValue(false);
    mocks.requireEditableSourceContext.mockResolvedValue({
      draft: {
        assignmentId: ids.assignment,
        availableFrom: null,
        availableUntil: null,
        datasetId: ids.dataset,
        englishToKoreanRatio: 50,
        includePendingReview: false,
        passingScore: 80,
        primaryUnitIds: [ids.unit],
        purpose: "regular",
        questionCount: 20,
        questionOrderMode: "random",
        questionTimeLimitSeconds: null,
        retryEnabled: true,
        retryPassingScore: 80,
        reviewLevels: [],
        reviewScope: "dataset",
        studentId: ids.student,
        studentName: "가짜 학생",
        timeLimitSeconds: 300,
        timingMode: "total",
        title: "단어 시험",
      },
      questions: [],
      selectedQueueIds: [],
      selectedReviewLevels: [],
      selectedReviewVocabEntryIds: [],
    });
  });

  it.each(["conflict", "invalid_selection", "database"] as const)(
    "일반 배정의 %s 분류를 수정 경로에서도 보존한다",
    async (reason) => {
      mocks.prepareRegularAssignment.mockRejectedValueOnce(
        new mocks.AssignmentCreationError(reason),
      );

      await expect(
        prepareStudentAssignmentReplacement(
          ids.assignment,
          ids.student,
          input,
          admin,
        ),
      ).rejects.toEqual(expect.objectContaining({ reason }));
    },
  );
});
