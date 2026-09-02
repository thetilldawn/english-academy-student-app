import { describe, expect, expectTypeOf, it } from "vitest";

import { assignmentReplacementFingerprintPayload } from "@/lib/admin/assignment-replacement-fingerprint";
import {
  assignmentCapacitySchema,
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
import { mixedAssignmentSchema } from "@/lib/admin/mixed-assignment-request";
import {
  assignmentSchema,
  type AssignmentInput,
} from "@/lib/admin/regular-assignment-request";
import {
  assignmentContractIds,
  bulkImmediatePreviewContract,
  bulkImmediateSubmitContract,
  bulkPreviewContract,
  bulkSubmitContract,
  mixedPerQuestionContract,
  regularTotalContract,
  replacementPreviewContract,
  replacementSubmitContract,
  reverseUnitIds,
} from "@/test-support/assignment-contract-fixtures";

import {
  assignmentRequestFingerprint,
  reserveIdempotencyKey,
} from "../domain/fingerprint";
import type {
  BulkCommonAssignmentPlan,
  BulkSeriesAssignmentDraft,
  DirectReviewAssignmentDraft,
  SingleAssignmentDraft,
  SingleAssignmentOperation,
} from "../domain/model";
import { InvalidAssignmentDraftError } from "../domain/validation";
import {
  buildAssignmentCapacityRequest,
  buildAssignmentEditDraftRequest,
  buildBulkAssignmentPreviewRequest,
  buildBulkAssignmentRequest,
  buildDirectReviewAssignmentRequest,
  buildDirectReviewPreviewRequest,
  buildLegacyReviewCancelRequest,
  buildSingleAssignmentRequest,
  bulkPreviewFingerprint,
  bulkSubmissionFingerprint,
  replacementSubmissionFingerprint,
} from "./request-adapters";
import type {
  AssignmentHttpRequest,
  LegacyReviewCancelRequest,
} from "./request-adapters";

const NOW = Date.parse("2026-08-10T00:00:00.000Z");

function resolved(title: string, questionCount: number) {
  return { displayTitle: title, submissionTitle: title, questionCount };
}

const regularDraft: SingleAssignmentDraft = {
  kind: "single",
  operation: { mode: "create" },
  studentId: assignmentContractIds.studentA,
  title: { mode: "custom", value: regularTotalContract.input.title },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [...reverseUnitIds],
  },
  questionCount: { mode: "manual", value: 12 },
  exam: {
    directionRatio: 50,
    questionOrderMode: "descending",
    passingScore: 80,
    timing: { mode: "total", totalSeconds: 300 },
  },
  availability: { mode: "immediate" },
  deadline: { mode: "at", koreanLocalDateTime: "2026-08-18T21:00" },
  review: { mode: "none", scope: "dataset", levels: [1, 2] },
};

const mixedDraft: SingleAssignmentDraft = {
  kind: "single",
  operation: { mode: "create" },
  studentId: assignmentContractIds.studentA,
  title: { mode: "custom", value: mixedPerQuestionContract.input.title },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [...mixedPerQuestionContract.input.primaryUnitIds],
  },
  questionCount: { mode: "manual", value: 15 },
  exam: {
    directionRatio: 100,
    questionOrderMode: "random",
    passingScore: 90,
    timing: { mode: "per_question", perQuestionSeconds: 12 },
  },
  availability: { mode: "immediate" },
  deadline: { mode: "none" },
  review: { mode: "pending", scope: "selection", levels: [1, 2] },
};

const exactReviewOperation = {
  mode: "replace",
  assignmentId: "88888888-8888-4888-8888-888888888888",
  targetStudentId: assignmentContractIds.studentA,
  sourcePurpose: "review",
  lockedShape: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [...reverseUnitIds],
    questionCount: 1,
    reviewScope: "dataset",
    reviewLevels: [2],
  },
} satisfies SingleAssignmentOperation;

const replacementDraft: SingleAssignmentDraft = {
  kind: "single",
  operation: exactReviewOperation,
  studentId: assignmentContractIds.studentA,
  title: { mode: "custom", value: replacementSubmitContract.title },
  range: {
    datasetId: assignmentContractIds.dataset,
    orderedUnitIds: [...reverseUnitIds],
  },
  questionCount: { mode: "manual", value: 1 },
  exam: {
    directionRatio: 0,
    questionOrderMode: "ascending",
    passingScore: 80,
    timing: { mode: "per_question", perQuestionSeconds: 20 },
  },
  availability: { mode: "immediate" },
  deadline: { mode: "none" },
  review: { mode: "pending", scope: "dataset", levels: [2] },
};

const scheduledBulkPlan: BulkCommonAssignmentPlan = {
  datasetId: assignmentContractIds.dataset,
  distribution: "split",
  splitBasis: "question_count",
  orderedUnitIds: [...reverseUnitIds],
  rangeUnitCounts: [],
  unitAllocationRule: null,
  questionCount: { mode: "manual", value: 12 },
  overflowPolicy: "leave",
  extraDatePolicy: "unconfirmed",
  selectedDateCount: 2,
  selectionMode: "source_order",
  planNonce: assignmentContractIds.planNonce,
  recurrenceSessions: [
    {
      availableLocalDateTime: "2026-08-17T00:00",
      deadlineLocalDateTime: "2026-08-17T21:00",
    },
    {
      availableLocalDateTime: "2026-08-19T00:00",
      deadlineLocalDateTime: "2026-08-19T21:00",
    },
  ],
  sessions: [
    {
      unitIds: [...reverseUnitIds],
      availableLocalDateTime: "2026-08-17T00:00",
      deadlineLocalDateTime: "2026-08-17T21:00",
    },
    {
      unitIds: [...reverseUnitIds],
      availableLocalDateTime: "2026-08-19T00:00",
      deadlineLocalDateTime: "2026-08-19T21:00",
    },
  ],
};

const immediateBulkPlan: BulkCommonAssignmentPlan = {
  datasetId: assignmentContractIds.dataset,
  distribution: "repeat",
  splitBasis: "question_count",
  orderedUnitIds: [...reverseUnitIds],
  rangeUnitCounts: [],
  unitAllocationRule: null,
  questionCount: { mode: "all" },
  overflowPolicy: "leave",
  extraDatePolicy: "unconfirmed",
  selectedDateCount: 0,
  selectionMode: "source_order",
  planNonce: assignmentContractIds.planNonce,
  recurrenceSessions: [
    { availableLocalDateTime: null, deadlineLocalDateTime: null },
  ],
  sessions: [
    {
      unitIds: [...reverseUnitIds],
      availableLocalDateTime: null,
      deadlineLocalDateTime: null,
    },
  ],
};

const scheduledBulkDraft: BulkSeriesAssignmentDraft = {
  kind: "bulk_series",
  questionMode: "book_meaning_choice",
  studentIds: [...bulkPreviewContract.studentIds],
  commonPlan: scheduledBulkPlan,
  exam: {
    directionRatio: 50,
    questionOrderMode: "random",
    passingScore: 80,
    retryEnabled: true,
    retryPassingScore: 80,
    timeLimitEnabled: true,
    timing: { mode: "per_question", perQuestionSeconds: 15 },
  },
};

const immediateBulkDraft: BulkSeriesAssignmentDraft = {
  kind: "bulk_series",
  questionMode: "book_meaning_choice",
  studentIds: [assignmentContractIds.studentA],
  commonPlan: immediateBulkPlan,
  exam: {
    directionRatio: 50,
    questionOrderMode: "ascending",
    passingScore: 80,
    retryEnabled: false,
    timeLimitEnabled: true,
    timing: { mode: "total", totalSeconds: 300 },
  },
};

describe("assignment request adapters", () => {
  it("builds immediate and scheduled direct-review requests", () => {
    const immediate: DirectReviewAssignmentDraft = {
      studentId: assignmentContractIds.studentA,
      datasetId: assignmentContractIds.dataset,
      reviewLevels: [1, 2],
      questionCount: 1,
      title: "오답 시험",
      exam: {
        directionRatio: 50,
        questionOrderMode: "random",
        passingScore: 80,
        timeLimitEnabled: false,
        timing: { mode: "total", totalSeconds: 300 },
      },
      availability: { mode: "immediate" },
      deadline: { mode: "none" },
    };
    const request = buildDirectReviewAssignmentRequest(
      immediate,
      assignmentContractIds.idempotencyKey,
    );

    expect(request.body).toMatchObject({
      availableFrom: null,
      availableUntil: null,
      datasetId: assignmentContractIds.dataset,
      idempotencyKey: assignmentContractIds.idempotencyKey,
      questionTimeLimitSeconds: null,
      reviewLevels: [1, 2],
      studentId: assignmentContractIds.studentA,
      timingMode: "none",
      totalQuestionCount: 1,
    });
    expect(directReviewAssignmentSchema.parse(request.body)).toStrictEqual(
      request.body,
    );
    expect(request.body).not.toHaveProperty("primaryUnitIds");
    expect(request.body).not.toHaveProperty("reviewScope");

    const scheduled = buildDirectReviewAssignmentRequest(
      {
        ...immediate,
        availability: {
          mode: "at",
          koreanLocalDateTime: "2026-08-17T09:00",
        },
        deadline: {
          mode: "at",
          koreanLocalDateTime: "2026-08-17T21:00",
        },
      },
      assignmentContractIds.idempotencyKey,
    );
    expect(scheduled.body.availableFrom).toBe("2026-08-17T00:00:00.000Z");
    expect(scheduled.body.availableUntil).toBe("2026-08-17T12:00:00.000Z");

    const preview = buildDirectReviewPreviewRequest({
      studentId: immediate.studentId,
      datasetId: immediate.datasetId,
      reviewLevels: immediate.reviewLevels,
      directionRatio: immediate.exam.directionRatio,
    });
    expect(directReviewPreviewSchema.parse(preview.body)).toStrictEqual({
      datasetId: assignmentContractIds.dataset,
      englishToKoreanRatio: 50,
      reviewLevels: [1, 2],
      studentId: assignmentContractIds.studentA,
    });
  });

  it("keeps regular and mixed preview fields aligned with their submissions", () => {
    const regularCapacity = buildAssignmentCapacityRequest(regularDraft);
    const regular = buildSingleAssignmentRequest(
      regularDraft,
      resolved(regularTotalContract.input.title, 12),
      { nowMilliseconds: NOW },
    );
    expect(assignmentCapacitySchema.parse(regularCapacity.body)).toStrictEqual(
      regularCapacity.body,
    );
    expect(regular).toStrictEqual({
      method: "POST",
      ...regularTotalContract.submission,
    });
    expect(assignmentSchema.parse(regular.body)).toStrictEqual(regular.body);

    const mixedCapacity = buildAssignmentCapacityRequest(mixedDraft);
    const mixed = buildSingleAssignmentRequest(
      mixedDraft,
      resolved(mixedPerQuestionContract.input.title, 15),
      { nowMilliseconds: NOW },
    );
    expect(mixedCapacity.body).toMatchObject({
      includePendingReview: true,
      reviewLevels: [1, 2],
      reviewScope: "selection",
    });
    expect(mixed).toStrictEqual({
      method: "POST",
      ...mixedPerQuestionContract.submission,
    });
    expect(mixedAssignmentSchema.parse(mixed.body)).toStrictEqual(mixed.body);
  });

  it("keeps automatic create titles server-owned", () => {
    const automaticRegular = buildSingleAssignmentRequest(
      {
        ...regularDraft,
        title: { mode: "automatic" },
        questionCount: { mode: "automatic", value: 12 },
      },
      {
        displayTitle: "일반 시험 미리보기",
        submissionTitle: "",
        questionCount: 12,
      },
      { nowMilliseconds: NOW },
    );
    const automaticMixed = buildSingleAssignmentRequest(
      { ...mixedDraft, title: { mode: "automatic" } },
      {
        displayTitle: "혼합 시험 미리보기",
        submissionTitle: "",
        questionCount: 15,
      },
      { nowMilliseconds: NOW },
    );

    expect(automaticRegular.body.title).toBe("");
    expect(automaticMixed.body.title).toBe("");
  });

  it("keeps exact-review replacement preview, PUT, and hash aligned", () => {
    const preview = buildAssignmentCapacityRequest(replacementDraft);
    const request = buildSingleAssignmentRequest(
      replacementDraft,
      resolved(replacementSubmitContract.title, 1),
      {
        nowMilliseconds: NOW,
        idempotencyKey: assignmentContractIds.idempotencyKey,
      },
    );

    expect(preview).toStrictEqual({
      endpoint: `/api/admin/assignments/${exactReviewOperation.assignmentId}/students/${assignmentContractIds.studentA}`,
      method: "POST",
      body: replacementPreviewContract,
    });
    expect(assignmentReplacementPreviewSchema.parse(preview.body)).toStrictEqual(
      replacementPreviewContract,
    );
    expect(request).toStrictEqual({
      endpoint: `/api/admin/assignments/${exactReviewOperation.assignmentId}/students/${assignmentContractIds.studentA}`,
      method: "PUT",
      body: replacementSubmitContract,
    });
    expect(assignmentReplacementSchema.parse(request.body)).toStrictEqual(
      replacementSubmitContract,
    );
    if (request.method !== "PUT") throw new Error("Expected replacement.");
    const payload = assignmentReplacementFingerprintPayload(
      exactReviewOperation.assignmentId,
      exactReviewOperation.targetStudentId,
      request.body,
    );
    expect(
      replacementSubmissionFingerprint(
        replacementDraft,
        resolved(replacementSubmitContract.title, 1),
        NOW,
      ),
    ).toBe(assignmentRequestFingerprint(payload));
  });

  it("reuses replacement idempotency only for the same semantic request", () => {
    const fingerprint = replacementSubmissionFingerprint(
      replacementDraft,
      resolved(replacementSubmitContract.title, 1),
      NOW,
    );
    let sequence = 0;
    const first = reserveIdempotencyKey(null, fingerprint, () =>
      `key-${++sequence}`,
    );
    const retry = reserveIdempotencyKey(first, fingerprint, () =>
      `key-${++sequence}`,
    );
    const changedFingerprint = replacementSubmissionFingerprint(
      { ...replacementDraft, title: { mode: "custom", value: "변경된 제목" } },
      resolved("변경된 제목", 1),
      NOW,
    );
    const changed = reserveIdempotencyKey(first, changedFingerprint, () =>
      `key-${++sequence}`,
    );

    expect(retry).toBe(first);
    expect(changed.key).toBe("key-2");
  });

  it("matches the scheduled bulk preview and submit contracts", () => {
    const preview = buildBulkAssignmentPreviewRequest(scheduledBulkDraft);
    const request = buildBulkAssignmentRequest(
      scheduledBulkDraft,
      assignmentContractIds.idempotencyKey,
      NOW,
      assignmentContractIds.previewPlanSignature,
    );

    expect(preview).toStrictEqual({
      endpoint: "/api/admin/bulk-assignments/preview",
      method: "POST",
      body: bulkPreviewContract,
    });
    expect(request).toStrictEqual({
      endpoint: "/api/admin/bulk-assignments",
      method: "POST",
      body: bulkSubmitContract,
    });
    expect(bulkAssignmentPreviewSchema.parse(preview.body)).toStrictEqual(
      bulkPreviewContract,
    );
    expect(bulkAssignmentSchema.parse(request.body)).toStrictEqual(
      bulkSubmitContract,
    );
  });

  it("matches the immediate bulk preview and submit contracts", () => {
    const preview = buildBulkAssignmentPreviewRequest(immediateBulkDraft);
    const request = buildBulkAssignmentRequest(
      immediateBulkDraft,
      assignmentContractIds.idempotencyKey,
      NOW,
      assignmentContractIds.previewPlanSignature,
    );

    expect(preview.body).toStrictEqual(bulkImmediatePreviewContract);
    expect(request.body).toStrictEqual(bulkImmediateSubmitContract);
    expect(bulkAssignmentPreviewSchema.parse(preview.body)).toStrictEqual(
      bulkImmediatePreviewContract,
    );
    expect(bulkAssignmentSchema.parse(request.body)).toStrictEqual(
      bulkImmediateSubmitContract,
    );
  });

  it("keeps the bulk wire contract strict and separates fingerprints", () => {
    const preview = buildBulkAssignmentPreviewRequest(scheduledBulkDraft);
    expect(preview.body).not.toHaveProperty("range");
    expect(preview.body).not.toHaveProperty("review");
    expect(
      bulkAssignmentPreviewSchema.safeParse({
        ...preview.body,
        rangeMode: "fixed_span",
      }).success,
    ).toBe(false);

    const missingPlan: BulkSeriesAssignmentDraft = {
      ...scheduledBulkDraft,
      commonPlan: undefined,
    };
    expect(() => buildBulkAssignmentPreviewRequest(missingPlan)).toThrow(
      InvalidAssignmentDraftError,
    );
    expect(() =>
      buildBulkAssignmentRequest(
        scheduledBulkDraft,
        assignmentContractIds.idempotencyKey,
        NOW,
        "stale-preview",
      ),
    ).toThrow();

    const previewFingerprint = bulkPreviewFingerprint(scheduledBulkDraft);
    const submissionFingerprint = bulkSubmissionFingerprint(
      scheduledBulkDraft,
      assignmentContractIds.previewPlanSignature,
    );
    const examOnlyChange = {
      ...scheduledBulkDraft,
      exam: { ...scheduledBulkDraft.exam, passingScore: 90 },
    };
    const planOnlyChange = {
      ...scheduledBulkDraft,
      commonPlan: {
        ...scheduledBulkPlan,
        extraDatePolicy: "repeat_from_start" as const,
      },
    };
    const reorderedStudents = {
      ...scheduledBulkDraft,
      studentIds: [...scheduledBulkDraft.studentIds].toReversed(),
    };

    expect(bulkPreviewFingerprint(examOnlyChange)).toBe(previewFingerprint);
    expect(
      bulkSubmissionFingerprint(
        examOnlyChange,
        assignmentContractIds.previewPlanSignature,
      ),
    ).not.toBe(submissionFingerprint);
    expect(bulkPreviewFingerprint(planOnlyChange)).not.toBe(previewFingerprint);
    expect(
      bulkSubmissionFingerprint(
        reorderedStudents,
        assignmentContractIds.previewPlanSignature,
      ),
    ).toBe(submissionFingerprint);

    const definitionDraft: BulkSeriesAssignmentDraft = {
      ...immediateBulkDraft,
      questionMode: "canonical_definition_to_headword",
      exam: { ...immediateBulkDraft.exam, directionRatio: 0 },
    };
    const exampleDraft: BulkSeriesAssignmentDraft = {
      ...definitionDraft,
      questionMode: "canonical_example_to_headword",
    };
    expect(bulkPreviewFingerprint(definitionDraft)).not.toBe(
      bulkPreviewFingerprint(exampleDraft),
    );
  });

  it("rejects malformed route IDs and exposes bodyless GET/DELETE contracts", () => {
    const invalidSingle = { ...regularDraft, studentId: "../unexpected" };
    expect(() => buildAssignmentCapacityRequest(invalidSingle)).toThrow(
      InvalidAssignmentDraftError,
    );

    const editDraft = buildAssignmentEditDraftRequest(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      assignmentContractIds.studentA,
    );
    expect(editDraft).toStrictEqual({
      endpoint: `/api/admin/assignments/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/students/${assignmentContractIds.studentA}`,
      method: "GET",
    });
    expectTypeOf(editDraft).toMatchTypeOf<AssignmentHttpRequest>();

    const regular = buildSingleAssignmentRequest(
      regularDraft,
      resolved(regularTotalContract.input.title, 12),
      { nowMilliseconds: NOW },
    );
    if (regular.endpoint !== "/api/admin/assignments") {
      throw new Error("Expected the regular assignment endpoint.");
    }
    expectTypeOf(regular.body).toEqualTypeOf<AssignmentInput>();

    const cancellation: LegacyReviewCancelRequest =
      buildLegacyReviewCancelRequest({
        kind: "legacy_review_recovery",
        studentId: assignmentContractIds.studentA,
        reviewDraftId: "99999999-9999-4999-8999-999999999999",
      });
    expect(cancellation).toStrictEqual({
      endpoint: `/api/admin/students/${assignmentContractIds.studentA}/review-assignment-drafts/99999999-9999-4999-8999-999999999999`,
      method: "DELETE",
    });
    expect(cancellation).not.toHaveProperty("body");
  });
});
