// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { useStudentDetailView } from "./use-student-detail-view";

describe("useStudentDetailView", () => {
  it("배정 학생 링크는 같은 상세의 내역 탭에서 시작한다", () => {
    const { result } = renderHook(() => useStudentDetailView("history"));
    expect(result.current.tab).toBe("history");
    expect(result.current.historyVisited).toBe(true);
  });
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
