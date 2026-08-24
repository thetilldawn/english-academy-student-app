import { describe, expect, it } from "vitest";

import {
  adminPageTitleForPathname,
  adminRouteForSegment,
} from "./admin-routes";

describe("admin route presentation", () => {
  it.each([
    ["/admin", "개요"],
    ["/admin/students", "학생"],
    ["/admin/assignments", "배정"],
    ["/admin/results", "내역"],
    ["/admin/results/attempt-id", "응시 상세"],
  ])("maps %s to %s", (pathname, title) => {
    expect(adminPageTitleForPathname(pathname)).toBe(title);
  });

  it("keeps the segment lookup used by navigation", () => {
    expect(adminRouteForSegment("students").navLabel).toBe("학생");
    expect(adminRouteForSegment("missing").navLabel).toBe("개요");
  });
});
