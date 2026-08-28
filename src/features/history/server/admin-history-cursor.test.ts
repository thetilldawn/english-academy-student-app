import { describe, expect, it } from "vitest";

import {
  AdminHistoryCursorError,
  adminHistoryFilterFingerprint,
  assertAdminHistoryCursorScope,
  decodeAdminHistoryCursor,
  encodeAdminHistoryCursor,
} from "./admin-history-cursor";

const payload = {
  effectiveAt: "2026-08-29T00:00:00.000Z",
  entryKey: "assignment.11111111-1111-4111-8111-111111111111",
  filterFingerprint: adminHistoryFilterFingerprint({
    groupKey: "open",
    query: "테스트 학생",
    scope: "all",
    statusFilter: "all",
  }),
  groupKey: "open",
  scope: "all" as const,
  snapshotAt: "2026-08-29T00:00:01.000Z",
  version: 1 as const,
};

describe("admin history cursor", () => {
  it("스냅샷과 정렬 기준을 불투명 커서로 왕복한다", () => {
    const cursor = encodeAdminHistoryCursor(payload);

    expect(cursor).not.toContain(payload.entryKey);
    expect(decodeAdminHistoryCursor(cursor)).toEqual(payload);
    expect(() => assertAdminHistoryCursorScope(payload, {
      groupKey: "open",
      query: "테스트 학생",
      scope: "all",
      statusFilter: "all",
    })).not.toThrow();
  });

  it("검색·구역·범위가 달라진 커서를 재사용하지 못하게 한다", () => {
    expect(() => assertAdminHistoryCursorScope(payload, {
      groupKey: "open",
      query: "다른 학생",
      scope: "all",
      statusFilter: "all",
    })).toThrow(AdminHistoryCursorError);
    expect(() => decodeAdminHistoryCursor("not-a-valid-cursor"))
      .toThrow(AdminHistoryCursorError);
  });
});
