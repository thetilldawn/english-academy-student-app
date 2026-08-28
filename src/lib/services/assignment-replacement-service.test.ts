import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createServerSupabaseClient: vi.fn(),
  prepare: vi.fn(),
  requireAdmin: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.createServerSupabaseClient,
}));
vi.mock("@/lib/services/assignment-replacement-preparation-service", () => ({
  prepareStudentAssignmentReplacement: mocks.prepare,
}));

import type { AssignmentReplacementInput } from "@/lib/admin/assignment-replacement-request";

import { replaceStudentAssignment } from "./assignment-replacement-service";

const ids = {
  assignment: "00000000-0000-4000-8000-000000000101",
  dataset: "00000000-0000-4000-8000-000000000102",
  idempotency: "00000000-0000-4000-8000-000000000103",
  replacement: "00000000-0000-4000-8000-000000000104",
  student: "00000000-0000-4000-8000-000000000105",
  unit: "00000000-0000-4000-8000-000000000106",
} as const;

const input: AssignmentReplacementInput = {
  availableFrom: "2026-08-30T00:00:00.000Z",
  availableUntil: "2026-08-31T00:00:00.000Z",
  datasetId: ids.dataset,
  englishToKoreanRatio: 100,
  idempotencyKey: ids.idempotency,
  includePendingReview: false,
  passingScore: 80,
  primaryUnitIds: [ids.unit],
  questionCount: 4,
  questionOrderMode: "fixed",
  questionTimeLimitSeconds: null,
  retryEnabled: false,
  retryPassingScore: null,
  reviewLevels: [],
  reviewScope: "selection",
  timeLimitSeconds: 300,
  timingMode: "total",
  title: "수정 시험",
};

const replacementResult = {
  idempotent: true,
  replacementAssignmentId: ids.replacement,
  replacementPurpose: "regular",
  sourceAssignmentId: ids.assignment,
  status: "replaced",
  studentId: ids.student,
} as const;

describe("replaceStudentAssignment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prepare.mockResolvedValue({
      prepared: {
        ...input,
        primaryUnitIds: [...input.primaryUnitIds],
        questions: [
          {
            base_order_index: 1,
            choice_vocab_entry_ids: [1, 2, 3, 4],
            direction: "english_to_korean",
            vocab_entry_id: 1,
          },
        ],
        reviewLevels: [],
        reviewScope: "dataset",
        selectedQueueIds: [],
      },
      replacementKind: "regular",
      reviewSnapshotMode: "none",
    });
  });

  it("uses the same normalized metadata for initial and recovery lookups", async () => {
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({
        data: null,
        error: { code: "XX000", message: "write failed" },
      })
      .mockResolvedValueOnce({ data: replacementResult, error: null });
    mocks.createServerSupabaseClient.mockResolvedValue({ rpc });

    await expect(
      replaceStudentAssignment(ids.assignment, ids.student, input, {
        displayName: "관리자",
        userId: "admin-id",
      }),
    ).resolves.toEqual(replacementResult);

    const expectedLookupMetadata = expect.objectContaining({
      p_available_from: input.availableFrom,
      p_retry_enabled: false,
      p_retry_passing_score: null,
      p_review_scope: "dataset",
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "get_student_assignment_replacement_result_v2",
      expectedLookupMetadata,
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "get_student_assignment_replacement_result_v2",
      expectedLookupMetadata,
    );
  });
});
