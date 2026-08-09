import { describe, expect, it } from "vitest";

import { resolveBulkAssignmentSchedule } from "@/lib/admin/bulk-assignment-schedule";
import { isoToKoreanDateTimeLocal } from "@/lib/deadline";

describe("일괄 배정 날짜", () => {
  it("8월 12일부터 2일 간격으로 다섯 시험을 배정한다", () => {
    const schedule = resolveBulkAssignmentSchedule({
      sessionCount: 5,
      firstAvailableFrom: "2026-08-11T15:00:00.000Z",
      firstAvailableUntil: "2026-08-12T12:00:00.000Z",
      dayInterval: 2,
    });

    expect(
      schedule.map((item) =>
        isoToKoreanDateTimeLocal(item.availableFrom).slice(0, 10),
      ),
    ).toEqual([
      "2026-08-12",
      "2026-08-14",
      "2026-08-16",
      "2026-08-18",
      "2026-08-20",
    ]);
    expect(schedule.at(-1)?.availableUntil).toBe("2026-08-20T12:00:00.000Z");
  });
});
