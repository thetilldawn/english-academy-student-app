import { describe, expect, expectTypeOf, it } from "vitest";

import type { AssignmentInput } from "@/lib/validation";
import { assignmentReplacementFingerprintPayload } from "@/lib/admin/assignment-replacement-fingerprint";
import {
  assignmentCapacitySchema,
  assignmentReplacementPreviewSchema,
  assignmentReplacementSchema,
  assignmentSchema,
  bulkAssignmentPreviewSchema,
  bulkAssignmentSchema,
  directReviewAssignmentSchema,
  mixedAssignmentSchema,
} from "@/lib/validation";
import {
  assignmentContractIds,
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
  BulkSeriesAssignmentDraft,
  DirectReviewAssignmentDraft,
  SingleAssignmentOperation,
  SingleAssignmentDraft,
} from "../domain/model";
import { InvalidAssignmentDraftError } from "../domain/validation";
import { reduceSingleAssignmentDraft } from "../domain/single-draft";
import {
  buildAssignmentCapacityRequest,
  buildAssignmentEditDraftRequest,
  buildBulkAssignmentPreviewRequest,
  buildBulkAssignmentRequest,
  buildDirectReviewAssignmentRequest,
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
  return {
    displayTitle: title,
    submissionTitle: title,
    questionCount,
  };
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
  deadline: {
    mode: "at",
    koreanLocalDateTime: "2026-08-18T21:00",
  },
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
  deadline: { mode: "none" },
  review: { mode: "pending", scope: "dataset", levels: [2] },
};

const bulkDraft: BulkSeriesAssignmentDraft = {
  kind: "bulk_series",
  studentIds: [...bulkPreviewContract.studentIds],
  range: { mode: "previous_span", unitsPerSession: 2, sessionCount: 2 },
  firstAvailableDateKorean: "2026-08-17",
  firstDeadline: {
    mode: "at",
    koreanLocalDateTime: "2026-08-17T21:00",
  },
  dayInterval: 2,
  exam: {
    directionRatio: 50,
    questionOrderMode: "random",
    passingScore: 80,
    timing: { mode: "per_question", perQuestionSeconds: 15 },
  },
  review: { mode: "pending", levels: [1, 2] },
};

describe("assignment request adapters", () => {
  it("builds an independent untimed review assignment for one student", () => {
    const draft: DirectReviewAssignmentDraft = {
      studentId: assignmentContractIds.studentA,
      datasetId: assignmentContractIds.dataset,
      primaryUnitIds: [...reverseUnitIds],
      reviewLevels: [1, 2],
      questionCount: 4,
      title: "오답 시험",
      exam: {
        directionRatio: 50,
        questionOrderMode: "random",
        passingScore: 80,
        timeLimitEnabled: false,
        timing: { mode: "total", totalSeconds: 300 },
      },
      deadline: { mode: "none" },
    };

    const request = buildDirectReviewAssignmentRequest(draft);

    expect(request.endpoint).toBe("/api/admin/exact-review-assignments");
    expect(request.method).toBe("POST");
    expect(request.body).toMatchObject({
      studentId: assignmentContractIds.studentA,
      datasetId: assignmentContractIds.dataset,
      primaryUnitIds: [...reverseUnitIds],
      reviewLevels: [1, 2],
      reviewScope: "dataset",
      totalQuestionCount: 4,
      timingMode: "none",
      questionTimeLimitSeconds: null,
      availableUntil: null,
    });
    expect(directReviewAssignmentSchema.safeParse(request.body).success).toBe(
      true,
    );
  });

  it("keeps regular capacity and submission on the same range and direction", () => {
    const capacity = buildAssignmentCapacityRequest(regularDraft);
    const request = buildSingleAssignmentRequest(
      regularDraft,
      resolved(regularTotalContract.input.title, 12),
      { nowMilliseconds: NOW },
    );

    expect(capacity).toStrictEqual({
      endpoint: "/api/admin/assignment-capacity",
      method: "POST",
      body: {
        studentId: assignmentContractIds.studentA,
        datasetId: assignmentContractIds.dataset,
        primaryUnitIds: [...reverseUnitIds],
        includePendingReview: false,
        reviewLevels: [1, 2],
        reviewScope: "dataset",
        englishToKoreanRatio: 50,
      },
    });
    expect(assignmentCapacitySchema.parse(capacity.body)).toStrictEqual(
      capacity.body,
    );
    expect(request).toStrictEqual({
      method: "POST",
      ...regularTotalContract.submission,
    });
    expect(assignmentSchema.parse(request.body)).toStrictEqual(
      regularTotalContract.submission.body,
    );
    expect(capacity.body.primaryUnitIds).toStrictEqual(
      request.endpoint === "/api/admin/assignments"
        ? request.body.unitIds
        : [],
    );
  });

  it("keeps automatic create title generation on the server", () => {
    const automatic: SingleAssignmentDraft = {
      ...regularDraft,
      title: { mode: "automatic" },
      questionCount: { mode: "automatic", value: 12 },
    };
    const request = buildSingleAssignmentRequest(
      automatic,
      {
        displayTitle: "화면 미리보기 제목",
        submissionTitle: "",
        questionCount: 12,
      },
      { nowMilliseconds: NOW },
    );

    expect(request.body.title).toBe("");
    expect(assignmentSchema.parse(request.body).title).toBe("");
  });

  it("keeps mixed automatic title generation on the server", () => {
    const automatic: SingleAssignmentDraft = {
      ...mixedDraft,
      title: { mode: "automatic" },
    };
    const request = buildSingleAssignmentRequest(
      automatic,
      {
        displayTitle: "혼합 시험 미리보기 제목",
        submissionTitle: "",
        questionCount: 15,
      },
      { nowMilliseconds: NOW },
    );

    expect(request.endpoint).toBe("/api/admin/mixed-assignments");
    expect(request.body.title).toBe("");
    expect(mixedAssignmentSchema.parse(request.body).title).toBe("");
  });

  it("keeps mixed capacity and submission on the same review selection", () => {
    const capacity = buildAssignmentCapacityRequest(mixedDraft);
    const request = buildSingleAssignmentRequest(
      mixedDraft,
      resolved(mixedPerQuestionContract.input.title, 15),
      { nowMilliseconds: NOW },
    );

    expect(capacity.body).toStrictEqual({
      studentId: assignmentContractIds.studentA,
      datasetId: assignmentContractIds.dataset,
      primaryUnitIds: [...mixedPerQuestionContract.input.primaryUnitIds],
      includePendingReview: true,
      reviewLevels: [1, 2],
      reviewScope: "selection",
      englishToKoreanRatio: 100,
    });
    expect(assignmentCapacitySchema.parse(capacity.body)).toStrictEqual(
      capacity.body,
    );
    expect(request).toStrictEqual({
      method: "POST",
      ...mixedPerQuestionContract.submission,
    });
    expect(mixedAssignmentSchema.parse(request.body)).toStrictEqual(
      mixedPerQuestionContract.submission.body,
    );
  });

  it("keeps replacement preview scope but removes it from the PUT body", () => {
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
      endpoint: `/api/admin/assignments/88888888-8888-4888-8888-888888888888/students/${assignmentContractIds.studentA}`,
      method: "POST",
      body: replacementPreviewContract,
    });
    expect(
      assignmentReplacementPreviewSchema.parse(preview.body),
    ).toStrictEqual(replacementPreviewContract);
    expect(request).toStrictEqual({
      endpoint: `/api/admin/assignments/88888888-8888-4888-8888-888888888888/students/${assignmentContractIds.studentA}`,
      method: "PUT",
      body: replacementSubmitContract,
    });
    expect(assignmentReplacementSchema.parse(request.body)).toStrictEqual(
      replacementSubmitContract,
    );
    expect(request.body).not.toHaveProperty("studentId");
    expect(request.body).not.toHaveProperty("reviewScope");
  });

  it("shares every replacement fingerprint field with the server hash payload", () => {
    const resolvedDraft = resolved(replacementSubmitContract.title, 1);
    const request = buildSingleAssignmentRequest(
      replacementDraft,
      resolvedDraft,
      {
        nowMilliseconds: NOW,
        idempotencyKey: assignmentContractIds.idempotencyKey,
      },
    );
    if (request.method !== "PUT") {
      throw new Error("Expected a replacement request.");
    }
    const payload = assignmentReplacementFingerprintPayload(
      exactReviewOperation.assignmentId,
      exactReviewOperation.targetStudentId,
      request.body,
    );

    expect(payload).toStrictEqual({
      assignmentId: exactReviewOperation.assignmentId,
      studentId: exactReviewOperation.targetStudentId,
      title: replacementSubmitContract.title,
      datasetId: replacementSubmitContract.datasetId,
      primaryUnitIds: replacementSubmitContract.primaryUnitIds,
      includePendingReview: true,
      reviewLevels: [2],
      questionCount: 1,
      englishToKoreanRatio: 0,
      timeLimitSeconds: 10800,
      timingMode: "per_question",
      questionTimeLimitSeconds: 20,
      passingScore: 80,
      questionOrderMode: "ascending",
      availableUntil: null,
    });
    expect(
      replacementSubmissionFingerprint(
        replacementDraft,
        resolvedDraft,
        NOW,
      ),
    ).toBe(assignmentRequestFingerprint(payload));
  });

  it("preserves the current review-off compatibility levels for replacement", () => {
    const regularReplacement: SingleAssignmentDraft = {
      ...regularDraft,
      operation: {
        mode: "replace",
        assignmentId: "88888888-8888-4888-8888-888888888888",
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "regular",
      },
      title: { mode: "custom", value: "일반 시험 수정" },
    };
    const request = buildSingleAssignmentRequest(
      regularReplacement,
      resolved("일반 시험 수정", 12),
      {
        nowMilliseconds: NOW,
        idempotencyKey: assignmentContractIds.idempotencyKey,
      },
    );

    expect(request.body).toMatchObject({
      includePendingReview: false,
      reviewLevels: [1, 2],
    });
    expect(assignmentReplacementSchema.parse(request.body)).toStrictEqual(
      request.body,
    );
  });

  it("retains a selected review level and scope while review is switched off", () => {
    const replacement: SingleAssignmentDraft = {
      ...regularDraft,
      operation: {
        mode: "replace",
        assignmentId: "88888888-8888-4888-8888-888888888888",
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "mixed",
      },
      title: { mode: "custom", value: "오답 선택 보존" },
      review: { mode: "pending", scope: "selection", levels: [2] },
    };
    const disabled = reduceSingleAssignmentDraft(replacement, {
      type: "review/changed",
      review: { mode: "none", scope: "selection", levels: [2] },
    });
    const preview = buildAssignmentCapacityRequest(disabled);
    const request = buildSingleAssignmentRequest(
      disabled,
      resolved("오답 선택 보존", 12),
      {
        nowMilliseconds: NOW,
        idempotencyKey: assignmentContractIds.idempotencyKey,
      },
    );

    expect(disabled.review).toStrictEqual({
      mode: "none",
      scope: "selection",
      levels: [2],
    });
    expect(preview.body).toMatchObject({
      includePendingReview: false,
      reviewLevels: [2],
      reviewScope: "selection",
    });
    expect(request.body).toMatchObject({
      includePendingReview: false,
      reviewLevels: [2],
    });
    expect(
      replacementSubmissionFingerprint(
        disabled,
        resolved("오답 선택 보존", 12),
        NOW,
      ),
    ).toBe(
      replacementSubmissionFingerprint(
        {
          ...disabled,
          review: { mode: "none", scope: "dataset", levels: [1] },
        },
        resolved("오답 선택 보존", 12),
        NOW,
      ),
    );
  });

  it("converts the date-only bulk start and matches preview and submit contracts", () => {
    const preview = buildBulkAssignmentPreviewRequest(bulkDraft);
    const request = buildBulkAssignmentRequest(
      bulkDraft,
      assignmentContractIds.idempotencyKey,
      NOW,
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

  it("공통 DAY와 요일별 공개·마감 시각을 미리보기와 저장에 똑같이 보낸다", () => {
    const commonDraft: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      range: { mode: "fixed_span", unitsPerSession: 1, sessionCount: 2 },
      review: { mode: "none", levels: [1, 2] },
      commonPlan: {
        datasetId: assignmentContractIds.dataset,
        distribution: "split",
        splitBasis: "question_count",
        orderedUnitIds: [assignmentContractIds.day57],
        rangeUnitCounts: [],
        questionCount: { mode: "manual", value: 40 },
        overflowPolicy: "continue_weekly",
        extraDatePolicy: "unconfirmed",
        selectedDateCount: 2,
        selectionMode: "random",
        planNonce: assignmentContractIds.idempotencyKey,
        recurrenceSessions: [
          {
            availableLocalDateTime: "2026-08-17T16:00",
            deadlineLocalDateTime: "2026-08-18T22:00",
          },
          {
            availableLocalDateTime: "2026-08-19T16:00",
            deadlineLocalDateTime: "2026-08-20T22:00",
          },
        ],
        sessions: [
          {
            unitIds: [assignmentContractIds.day57],
            availableLocalDateTime: "2026-08-17T16:00",
            deadlineLocalDateTime: "2026-08-18T22:00",
          },
          {
            unitIds: [assignmentContractIds.day57],
            availableLocalDateTime: "2026-08-19T16:00",
            deadlineLocalDateTime: "2026-08-20T22:00",
          },
        ],
        collisionDecisions: [
          {
            collisionId: `${assignmentContractIds.studentA}:1:${assignmentContractIds.day60}`,
            mode: "move",
            movedAvailableLocalDateTime: "2026-08-18T16:00",
            movedDeadlineLocalDateTime: "2026-08-19T22:00",
          },
        ],
      },
    };
    const preview = buildBulkAssignmentPreviewRequest(commonDraft);
    const submit = buildBulkAssignmentRequest(
      commonDraft,
      assignmentContractIds.idempotencyKey,
      NOW,
    );

    expect(preview.body.commonPlan).toMatchObject({
      datasetId: assignmentContractIds.dataset,
      distribution: "split",
      splitBasis: "question_count",
      orderedUnitIds: [assignmentContractIds.day57],
      rangeUnitCounts: [],
      questionCount: { mode: "manual", value: 40 },
      overflowPolicy: "continue_weekly",
      extraDatePolicy: "unconfirmed",
      selectedDateCount: 2,
      selectionMode: "random",
      planNonce: assignmentContractIds.idempotencyKey,
      recurrenceSessions: [
        {
          availableFrom: "2026-08-17T07:00:00.000Z",
          availableUntil: "2026-08-18T13:00:00.000Z",
        },
        {
          availableFrom: "2026-08-19T07:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
        },
      ],
      sessions: [
        {
          unitIds: [assignmentContractIds.day57],
          availableFrom: "2026-08-17T07:00:00.000Z",
          availableUntil: "2026-08-18T13:00:00.000Z",
        },
        {
          unitIds: [assignmentContractIds.day57],
          availableFrom: "2026-08-19T07:00:00.000Z",
          availableUntil: "2026-08-20T13:00:00.000Z",
        },
      ],
      collisionDecisions: [
        {
          mode: "move",
          movedAvailableFrom: "2026-08-18T07:00:00.000Z",
          movedAvailableUntil: "2026-08-19T13:00:00.000Z",
        },
      ],
    });
    expect(submit.body.commonPlan).toStrictEqual(preview.body.commonPlan);
    expect(bulkAssignmentPreviewSchema.parse(preview.body)).toStrictEqual(
      preview.body,
    );
    expect(bulkAssignmentSchema.parse(submit.body)).toStrictEqual(
      submit.body,
    );
    const repeatedDraft: BulkSeriesAssignmentDraft = {
      ...commonDraft,
      commonPlan: {
        ...commonDraft.commonPlan!,
        extraDatePolicy: "repeat_from_start",
      },
    };
    expect(bulkPreviewFingerprint(repeatedDraft)).not.toBe(
      bulkPreviewFingerprint(commonDraft),
    );
    expect(bulkSubmissionFingerprint(repeatedDraft)).not.toBe(
      bulkSubmissionFingerprint(commonDraft),
    );
  });

  it("범위 단위 수와 회차별 정확한 범위를 미리보기·저장에 함께 보낸다", () => {
    const sessions = [
      {
        unitIds: [assignmentContractIds.day57],
        availableLocalDateTime: "2026-08-17T16:00",
        deadlineLocalDateTime: "2026-08-18T22:00",
      },
      {
        unitIds: [assignmentContractIds.day60],
        availableLocalDateTime: "2026-08-19T16:00",
        deadlineLocalDateTime: "2026-08-20T22:00",
      },
    ];
    const draft: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      range: { mode: "fixed_span", unitsPerSession: 1, sessionCount: 2 },
      review: { mode: "none", levels: [1, 2] },
      commonPlan: {
        datasetId: assignmentContractIds.dataset,
        distribution: "split",
        splitBasis: "range_unit",
        orderedUnitIds: [
          assignmentContractIds.day57,
          assignmentContractIds.day60,
        ],
        rangeUnitCounts: [1, 1],
        questionCount: { mode: "all" },
        overflowPolicy: "continue_weekly",
        extraDatePolicy: "unconfirmed",
        selectedDateCount: 2,
        selectionMode: "source_order",
        planNonce: assignmentContractIds.idempotencyKey,
        recurrenceSessions: sessions.map((session) => ({
          availableLocalDateTime: session.availableLocalDateTime,
          deadlineLocalDateTime: session.deadlineLocalDateTime,
        })),
        sessions,
        collisionDecisions: [],
      },
    };

    const preview = buildBulkAssignmentPreviewRequest(draft);
    const submit = buildBulkAssignmentRequest(
      draft,
      assignmentContractIds.idempotencyKey,
      NOW,
    );
    expect(preview.body.commonPlan).toMatchObject({
      splitBasis: "range_unit",
      rangeUnitCounts: [1, 1],
      sessions: [
        { unitIds: [assignmentContractIds.day57] },
        { unitIds: [assignmentContractIds.day60] },
      ],
    });
    expect(submit.body.commonPlan).toStrictEqual(preview.body.commonPlan);
    expect(bulkAssignmentPreviewSchema.parse(preview.body)).toStrictEqual(
      preview.body,
    );
  });

  it("keeps disabled bulk review levels as an adapter-only compatibility value", () => {
    const noReviewDraft: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      review: { mode: "none", levels: [2] },
    };
    const preview = buildBulkAssignmentPreviewRequest(noReviewDraft);

    expect(preview.body).toMatchObject({
      includePendingReview: false,
      reviewLevels: [2],
    });
    expect(noReviewDraft.review).toStrictEqual({
      mode: "none",
      levels: [2],
    });
  });

  it("uses semantic bulk fingerprints without erasing meaningful settings", () => {
    const previewFingerprint = bulkPreviewFingerprint(bulkDraft);
    const submitFingerprint = bulkSubmissionFingerprint(bulkDraft);
    const reorderedSets: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      studentIds: [...bulkDraft.studentIds].toReversed(),
      review: { mode: "pending", levels: [2, 1] },
    };
    const changedExam: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      exam: { ...bulkDraft.exam, passingScore: 90 },
    };
    const changedRange: BulkSeriesAssignmentDraft = {
      ...bulkDraft,
      range: { ...bulkDraft.range, unitsPerSession: 3 },
    };

    expect(bulkSubmissionFingerprint(reorderedSets)).toBe(
      submitFingerprint,
    );
    expect(bulkPreviewFingerprint(changedExam)).toBe(previewFingerprint);
    expect(bulkSubmissionFingerprint(changedExam)).not.toBe(
      submitFingerprint,
    );
    expect(bulkPreviewFingerprint(changedRange)).not.toBe(
      previewFingerprint,
    );
    expect(bulkSubmissionFingerprint(changedRange)).not.toBe(
      submitFingerprint,
    );
  });

  it("excludes the replacement idempotency key from its semantic fingerprint", () => {
    const resolvedDraft = resolved(replacementSubmitContract.title, 1);
    const fingerprint = replacementSubmissionFingerprint(
      replacementDraft,
      resolvedDraft,
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
      { ...replacementDraft, title: { mode: "custom", value: "바뀐 제목" } },
      resolved("바뀐 제목", 1),
      NOW,
    );
    const changed = reserveIdempotencyKey(first, changedFingerprint, () =>
      `key-${++sequence}`,
    );

    expect(retry).toBe(first);
    expect(changed.key).toBe("key-2");
    expect(changed.fingerprint).not.toBe(fingerprint);

    const whitespaceFingerprint = replacementSubmissionFingerprint(
      {
        ...replacementDraft,
        title: {
          mode: "custom",
          value: `  ${replacementSubmitContract.title}  `,
        },
      },
      resolved(`  ${replacementSubmitContract.title}  `, 1),
      NOW,
    );
    expect(whitespaceFingerprint).toBe(fingerprint);

    const otherAssignmentFingerprint = replacementSubmissionFingerprint(
      {
        ...replacementDraft,
        operation: {
          ...exactReviewOperation,
          assignmentId: "99999999-9999-4999-8999-999999999999",
        },
      },
      resolvedDraft,
      NOW,
    );
    const otherStudentFingerprint = replacementSubmissionFingerprint(
      {
        ...replacementDraft,
        studentId: assignmentContractIds.studentB,
        operation: {
          ...exactReviewOperation,
          targetStudentId: assignmentContractIds.studentB,
        },
      },
      resolvedDraft,
      NOW,
    );
    expect(otherAssignmentFingerprint).not.toBe(fingerprint);
    expect(otherStudentFingerprint).not.toBe(fingerprint);
  });

  it("normalizes replacement review levels exactly like the server hash", () => {
    const mixedReplacement: SingleAssignmentDraft = {
      ...regularDraft,
      operation: {
        mode: "replace",
        assignmentId: "88888888-8888-4888-8888-888888888888",
        targetStudentId: assignmentContractIds.studentA,
        sourcePurpose: "mixed",
      },
      title: { mode: "custom", value: "혼합 수정" },
      review: { mode: "pending", scope: "dataset", levels: [1, 2] },
    };
    const reordered: SingleAssignmentDraft = {
      ...mixedReplacement,
      review: { mode: "pending", scope: "dataset", levels: [2, 1] },
    };
    expect(
      replacementSubmissionFingerprint(
        reordered,
        resolved("혼합 수정", 12),
        NOW,
      ),
    ).toBe(
      replacementSubmissionFingerprint(
        mixedReplacement,
        resolved("혼합 수정", 12),
        NOW,
      ),
    );

    const disabledOne: SingleAssignmentDraft = {
      ...mixedReplacement,
      review: { mode: "none", scope: "dataset", levels: [1] },
    };
    const disabledTwo: SingleAssignmentDraft = {
      ...mixedReplacement,
      review: { mode: "none", scope: "dataset", levels: [2] },
    };
    expect(
      replacementSubmissionFingerprint(
        disabledOne,
        resolved("혼합 수정", 12),
        NOW,
      ),
    ).toBe(
      replacementSubmissionFingerprint(
        disabledTwo,
        resolved("혼합 수정", 12),
        NOW,
      ),
    );
  });

  it("rejects malformed route IDs before constructing any endpoint", () => {
    const invalidSingle = {
      ...regularDraft,
      studentId: "../unexpected",
    };
    expect(() => buildAssignmentCapacityRequest(invalidSingle)).toThrow(
      InvalidAssignmentDraftError,
    );
    expect(() =>
      buildSingleAssignmentRequest(
        invalidSingle,
        resolved(regularTotalContract.input.title, 12),
        { nowMilliseconds: NOW },
      ),
    ).toThrow(InvalidAssignmentDraftError);
    expect(() =>
      buildLegacyReviewCancelRequest({
        kind: "legacy_review_recovery",
        studentId: assignmentContractIds.studentA,
        reviewDraftId: "not-a-uuid",
      }),
    ).toThrow(InvalidAssignmentDraftError);
  });

  it("exposes a typed endpoint/body union and a bodyless legacy DELETE", () => {
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
    expectTypeOf(regular).toMatchTypeOf<AssignmentHttpRequest>();

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
