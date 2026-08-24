// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { assignmentContractIds } from "@/test-support/assignment-contract-fixtures";

import type { AssignmentTransport } from "../transport/assignment-transport";
import { useLegacyReviewRecovery } from "./use-legacy-review-recovery";

const reviewDraftId = "88888888-8888-4888-8888-888888888888";

describe("legacy review recovery controller", () => {
  it("accepts only the typed cancelled-to-pending response", async () => {
    const transport: AssignmentTransport = vi.fn(async () => ({
      data: { queueDisposition: "pending", status: "cancelled" },
      ok: true,
      status: 200,
    }));
    const { result } = renderHook(() =>
      useLegacyReviewRecovery({
        draft: {
          kind: "legacy_review_recovery",
          reviewDraftId,
          studentId: assignmentContractIds.studentA,
        },
        errorMessage: "복구하지 못했습니다.",
        transport,
      }),
    );

    await act(async () => {
      expect(await result.current.recover()).toStrictEqual({ ok: true });
    });
    expect(transport).toHaveBeenCalledWith({
      method: "DELETE",
      url: `/api/admin/students/${assignmentContractIds.studentA}/review-assignment-drafts/${reviewDraftId}`,
    });
    expect(result.current.status).toBe("succeeded");
  });

  it("blocks a duplicate recovery while the first request is in flight", async () => {
    let resolveRequest: (value: Awaited<ReturnType<AssignmentTransport>>) => void = () => {};
    const pending = new Promise<Awaited<ReturnType<AssignmentTransport>>>((resolve) => {
      resolveRequest = resolve;
    });
    const transport: AssignmentTransport = vi.fn(() => pending);
    const { result } = renderHook(() =>
      useLegacyReviewRecovery({
        draft: {
          kind: "legacy_review_recovery",
          reviewDraftId,
          studentId: assignmentContractIds.studentA,
        },
        errorMessage: "복구하지 못했습니다.",
        transport,
      }),
    );

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.recover();
      second = result.current.recover();
    });
    await expect(second).resolves.toMatchObject({ ok: false });
    expect(transport).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveRequest({
        data: { queueDisposition: "pending", status: "cancelled" },
        ok: true,
        status: 200,
      });
      await first;
    });
  });
});
