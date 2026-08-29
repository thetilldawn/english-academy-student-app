// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStudentDetailView } from "./use-student-detail-view";

describe("useStudentDetailView", () => {
  it("mounts history only after the first visit and remembers that visit", () => {
    const { result } = renderHook(() => useStudentDetailView());

    expect(result.current.tab).toBe("info");
    expect(result.current.historyVisited).toBe(false);

    act(() => result.current.actions.changeTab("history"));
    expect(result.current.tab).toBe("history");
    expect(result.current.historyVisited).toBe(true);

    act(() => result.current.actions.changeTab("account"));
    expect(result.current.tab).toBe("account");
    expect(result.current.historyVisited).toBe(true);
  });
});
