import { describe, expect, it, vi } from "vitest";

import { bulkAssignmentSchema } from "@/features/assignments/contracts/bulk-assignment-request";
import {
  assignmentContractIds,
  bulkImmediateSubmitContract,
  bulkSubmitContract,
} from "@/test-support/assignment-contract-fixtures";

import {
  bulkAssignmentRequestSha256,
  bulkAssignmentResultHasValidShape,
  bulkAssignmentResultMatchesBatches,
  lookupBulkAssignmentPersistence,
  persistBulkAssignment,
  usesCompletionQueue,
} from "@/features/assignments/server/persistence/bulk-assignment-persistence";

const assignmentA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const assignmentB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const queueSeries = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const queueItemA = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const queueItemB = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

describe("bulk assignment persistence contract", () => {
  it("uses the writer that accepts a fully immediate regular series", async () => {
    const assignment = bulkAssignmentSchema.parse(bulkImmediateSubmitContract);
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });

    await persistBulkAssignment({
      client: { rpc } as never,
      assignment,
      requestSha256: "a".repeat(64),
      batches: [],
      queueSeries: null,
    });

    expect(rpc).toHaveBeenCalledWith(
      "create_bulk_vocab_assignments_v11",
      expect.any(Object),
    );
  });

  it("binds the request hash to the Preview plan signature", () => {
    const input = bulkAssignmentSchema.parse(bulkSubmitContract);
    const changed = bulkAssignmentSchema.parse({
      ...bulkSubmitContract,
      previewPlanSignature: "b".repeat(64),
    });

    expect(bulkAssignmentRequestSha256(input)).not.toBe(
      bulkAssignmentRequestSha256(changed),
    );
  });

  it("binds the request hash and RPC branch to the canonical question mode", async () => {
    const definition = bulkAssignmentSchema.parse({
      ...bulkImmediateSubmitContract,
      questionMode: "canonical_definition_to_headword",
      englishToKoreanRatio: 0,
    });
    const example = bulkAssignmentSchema.parse({
      ...bulkImmediateSubmitContract,
      questionMode: "canonical_example_to_headword",
      englishToKoreanRatio: 0,
    });
    expect(bulkAssignmentRequestSha256(definition)).not.toBe(
      bulkAssignmentRequestSha256(example),
    );
    expect(usesCompletionQueue(definition)).toBe(false);

    const rpc = vi.fn().mockResolvedValue({ data: [], error: null });
    const client = { rpc } as never;
    await lookupBulkAssignmentPersistence({
      client,
      assignment: definition,
      requestSha256: "a".repeat(64),
    });
    await persistBulkAssignment({
      client,
      assignment: definition,
      requestSha256: "a".repeat(64),
      batches: [{ kind: "canonical_preview" }],
      queueSeries: null,
    });

    expect(rpc.mock.calls.map((call) => call[0])).toEqual([
      "get_canonical_assignment_preview_result_v1",
      "create_bulk_canonical_assignments_preview_v1",
    ]);
  });

  it("accepts only the exact student and session result pairs", () => {
    const batches = [
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
      },
      {
        student_id: assignmentContractIds.studentB,
        session_number: 2,
      },
    ];
    expect(bulkAssignmentResultMatchesBatches([
      {
        student_id: assignmentContractIds.studentB,
        session_number: 2,
        assignment_id: assignmentB,
      },
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
        assignment_id: assignmentA,
      },
    ], batches)).toBe(true);
    expect(bulkAssignmentResultMatchesBatches([
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
        assignment_id: assignmentA,
      },
      {
        student_id: assignmentContractIds.studentA,
        session_number: 2,
        assignment_id: assignmentB,
      },
    ], batches)).toBe(false);
  });

  it("rejects invalid normal and completion-queue result states", () => {
    expect(bulkAssignmentResultHasValidShape([
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
        assignment_id: assignmentA,
        status: "assigned",
      },
    ], false)).toBe(true);
    expect(bulkAssignmentResultHasValidShape([
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
        assignment_id: null,
        status: "assigned",
      },
    ], false)).toBe(false);

    const queueResult = [
      {
        student_id: assignmentContractIds.studentA,
        session_number: 1,
        assignment_id: assignmentA,
        queue_series_id: queueSeries,
        queue_item_id: queueItemA,
        status: "assigned" as const,
      },
      {
        student_id: assignmentContractIds.studentA,
        session_number: 2,
        assignment_id: null,
        queue_series_id: queueSeries,
        queue_item_id: queueItemB,
        status: "queued" as const,
      },
    ];
    expect(bulkAssignmentResultHasValidShape(queueResult, true)).toBe(true);
    expect(bulkAssignmentResultHasValidShape([
      queueResult[0]!,
      { ...queueResult[1]!, assignment_id: assignmentB },
    ], true)).toBe(false);
    expect(bulkAssignmentResultHasValidShape([
      { ...queueResult[0]!, queue_item_id: queueItemB },
      queueResult[1]!,
    ], true)).toBe(false);
  });
});
