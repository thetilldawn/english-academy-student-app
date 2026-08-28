// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AssignmentPreviewPreparation } from "../application/preview-flow";
import type { AssignmentTransport } from "../transport/assignment-transport";
import { useDebouncedAssignmentPreview } from "./use-debounced-assignment-preview";

function preparation(
  fingerprint: string,
): AssignmentPreviewPreparation<{ value: string }> {
  return {
    fallback: "미리보기 실패",
    fingerprint,
    parse: (data) => data as { value: string },
    request: { method: "POST", url: `/preview/${fingerprint}` },
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("debounced assignment preview", () => {
  it("aborts the old request and only applies the latest response", async () => {
    vi.useFakeTimers();
    let resolveFirst: (
      response: Awaited<ReturnType<AssignmentTransport>>,
    ) => void = () => {};
    const firstResponse = new Promise<
      Awaited<ReturnType<AssignmentTransport>>
    >((resolve) => {
      resolveFirst = resolve;
    });
    let firstSignal: AbortSignal | undefined;
    const transport: AssignmentTransport = vi.fn(async (request) => {
      if (request.url.endsWith("/first")) {
        firstSignal = request.signal;
        return firstResponse;
      }
      return { data: { value: "second" }, ok: true, status: 200 };
    });
    const onFailed = vi.fn();
    const onRequested = vi.fn();
    const onSucceeded = vi.fn();
    const { rerender } = renderHook(
      ({ currentPreparation, revision }) =>
        useDebouncedAssignmentPreview({
          delayMs: 10,
          enabled: true,
          onFailed,
          onRequested,
          onSucceeded,
          preparation: currentPreparation,
          refreshVersion: 0,
          revision,
          transport,
        }),
      {
        initialProps: {
          currentPreparation: preparation("first"),
          revision: 1,
        },
      },
    );

    await act(async () => vi.advanceTimersByTimeAsync(10));
    expect(transport).toHaveBeenCalledTimes(1);

    rerender({ currentPreparation: preparation("second"), revision: 2 });
    expect(firstSignal?.aborted).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
    });
    expect(onSucceeded).toHaveBeenCalledOnce();

    await act(async () => {
      resolveFirst({ data: { value: "first" }, ok: true, status: 200 });
      await firstResponse;
    });

    expect(onSucceeded).toHaveBeenCalledWith(
      { value: "second" },
      expect.objectContaining({ fingerprint: "second", revision: 2 }),
    );
    expect(onFailed).not.toHaveBeenCalled();
  });
});
