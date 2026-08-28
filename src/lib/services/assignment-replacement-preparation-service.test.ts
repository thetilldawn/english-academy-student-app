import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/assignment-edit-source-service", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/services/assignment-edit-source-service")
  >();
  return {
    ...actual,
    requireEditableSourceContext: vi.fn(),
  };
});

import type { AssignmentReplacementInput } from "@/lib/admin/assignment-edit";
import type { AdminContext } from "@/lib/auth/admin";
import {
  type EditableSourceContext,
  requireEditableSourceContext,
} from "@/lib/services/assignment-edit-source-service";
import {
  calculateStudentAssignmentReplacementCapacity,
  prepareStudentAssignmentReplacement,
} from "@/lib/services/assignment-replacement-preparation-service";

const assignmentId = "11111111-1111-4111-8111-111111111111";
const studentId = "22222222-2222-4222-8222-222222222222";
const datasetId = "33333333-3333-4333-8333-333333333333";
const unitId = "44444444-4444-4444-8444-444444444444";
const admin: AdminContext = {
  userId: "55555555-5555-4555-8555-555555555555",
  displayName: "관리자",
};

const source: EditableSourceContext = {
  draft: {
    assignmentId,
    studentId,
    studentName: "미리보기 학생",
    purpose: "mixed",
    seriesItem: false,
    title: "기존 오답 포함 시험",
    datasetId,
    primaryUnitIds: [unitId],
    questionCount: 2,
    englishToKoreanRatio: 50,
    timeLimitSeconds: 300,
    timingMode: "total",
    questionTimeLimitSeconds: null,
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    questionOrderMode: "random",
    availableFrom: "2026-08-29T00:00:00.000Z",
    availableUntil: null,
    includePendingReview: true,
    reviewScope: "selection",
    reviewLevels: [1, 2],
  },
  questions: [
    {
      vocab_entry_id: 10,
      base_order_index: 1,
      direction: "english_to_korean",
      choice_vocab_entry_ids: [10, 11, 12, 13],
    },
    {
      vocab_entry_id: 20,
      base_order_index: 2,
      direction: "korean_to_english",
      choice_vocab_entry_ids: [20, 21, 22, 23],
    },
  ],
  selectedQueueIds: ["queue-1", "queue-2"],
  selectedReviewLevels: [1, 2],
  selectedReviewVocabEntryIds: [10, 20],
};

function replacementInput(
  overrides: Partial<AssignmentReplacementInput> = {},
): AssignmentReplacementInput {
  return {
    idempotencyKey: "66666666-6666-4666-8666-666666666666",
    title: source.draft.title,
    datasetId: source.draft.datasetId,
    primaryUnitIds: source.draft.primaryUnitIds,
    questionCount: source.draft.questionCount,
    englishToKoreanRatio: source.draft.englishToKoreanRatio,
    timeLimitSeconds: source.draft.timeLimitSeconds,
    timingMode: source.draft.timingMode,
    questionTimeLimitSeconds: source.draft.questionTimeLimitSeconds,
    passingScore: source.draft.passingScore,
    retryEnabled: source.draft.retryEnabled,
    retryPassingScore: source.draft.retryPassingScore,
    questionOrderMode: source.draft.questionOrderMode,
    availableFrom: source.draft.availableFrom,
    availableUntil: source.draft.availableUntil,
    includePendingReview: source.draft.includePendingReview,
    reviewScope: source.draft.reviewScope,
    reviewLevels: source.draft.reviewLevels,
    ...overrides,
  };
}

const requireEditableSourceContextMock = vi.mocked(
  requireEditableSourceContext,
);

describe("prepareStudentAssignmentReplacement legacy mixed assignment", () => {
  beforeEach(() => {
    requireEditableSourceContextMock.mockReset();
    requireEditableSourceContextMock.mockResolvedValue(source);
  });

  it("설정만 바꾸면 기존 문제와 오답 대기열을 그대로 보존한다", async () => {
    const result = await prepareStudentAssignmentReplacement(
      assignmentId,
      studentId,
      replacementInput({
        title: "설정만 수정한 시험",
        passingScore: 90,
        questionOrderMode: "fixed",
        timeLimitSeconds: 600,
      }),
      admin,
    );

    expect(result.replacementKind).toBe("mixed");
    expect(result.reviewSnapshotMode).toBe("preserve");
    expect(result.prepared.questions).toBe(source.questions);
    expect(result.prepared.selectedQueueIds).toBe(source.selectedQueueIds);
    expect(result.prepared).toMatchObject({
      title: "설정만 수정한 시험",
      passingScore: 90,
      questionOrderMode: "fixed",
      timeLimitSeconds: 600,
    });
    expect(requireEditableSourceContextMock).toHaveBeenCalledOnce();
    expect(requireEditableSourceContextMock).toHaveBeenCalledWith(
      assignmentId,
      studentId,
      admin,
      undefined,
    );
  });

  it("오답을 쓰지 않는 시험은 무의미한 요청 범위 대신 기존 저장 범위를 보존한다", async () => {
    const regularSource: EditableSourceContext = {
      ...source,
      draft: {
        ...source.draft,
        purpose: "regular",
        includePendingReview: false,
        reviewScope: "dataset",
        reviewLevels: [],
      },
      selectedQueueIds: [],
      selectedReviewLevels: [],
      selectedReviewVocabEntryIds: [],
    };
    requireEditableSourceContextMock.mockResolvedValue(regularSource);

    const result = await prepareStudentAssignmentReplacement(
      assignmentId,
      studentId,
      replacementInput({
        includePendingReview: false,
        reviewScope: "selection",
        reviewLevels: [],
      }),
      admin,
    );

    expect(result.prepared.reviewScope).toBe("dataset");
    expect(result.prepared.questions).toBe(regularSource.questions);
  });

  it("오답 단계별 수를 실제 보존된 대기열 기준으로 계산한다", async () => {
    const capacity = await calculateStudentAssignmentReplacementCapacity(
      assignmentId,
      studentId,
      {
        studentId,
        datasetId,
        primaryUnitIds: [unitId],
        includePendingReview: true,
        reviewLevels: [1, 2],
        englishToKoreanRatio: 50,
      },
      admin,
    );

    expect(capacity).toMatchObject({
      wrongEligible: 2,
      wrongLevel1Eligible: 1,
      wrongLevel2Eligible: 1,
    });
  });

  it.each([
    ["단어장", { datasetId: "77777777-7777-4777-8777-777777777777" }],
    ["범위", { primaryUnitIds: ["88888888-8888-4888-8888-888888888888"] }],
    ["단어 수", { questionCount: 1 }],
    ["시험 방향", { englishToKoreanRatio: 100 as const }],
    ["오답 포함", { includePendingReview: false, reviewLevels: [] }],
    ["틀린 횟수", { reviewLevels: [1] as (1 | 2)[] }],
  ])("%s 변경을 실제 저장 준비 단계에서 거부한다", async (_label, overrides) => {
    await expect(
      prepareStudentAssignmentReplacement(
        assignmentId,
        studentId,
        replacementInput(overrides),
        admin,
      ),
    ).rejects.toMatchObject({
      reason: "invalid_selection",
    });
  });
});
