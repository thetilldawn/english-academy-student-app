import { describe, expect, it } from "vitest";

import {
  resolveBulkAssignmentSeries,
  unitRangeLabel,
  unitSelectionLabel,
} from "@/lib/admin/bulk-assignment-range";

const units = Array.from({ length: 60 }, (_, index) => ({
  id: `day-${index + 1}`,
  label: `DAY ${String(index + 1).padStart(2, "0")}`,
  sortIndex: index + 1,
}));

describe("일괄 배정 회차 범위", () => {
  it("비연속 선택은 연속 범위처럼 오해되지 않게 요약한다", () => {
    expect(unitSelectionLabel([units[0]!, units[2]!, units[4]!])).toBe(
      "DAY 01 외 2개",
    );
    expect(unitSelectionLabel([units[0]!, units[1]!, units[2]!])).toBe(
      "DAY 01~DAY 03",
    );
  });

  it("3 DAY씩 5개의 독립된 정방향 시험을 만든다", () => {
    const series = resolveBulkAssignmentSeries(
      units,
      { recommendedUnitIds: ["day-43"], recommendedDirection: 1 },
      "fixed_span",
      3,
      5,
    );

    expect(series.sessions.map((session) => unitRangeLabel(session.units))).toEqual([
      "DAY 43~DAY 45",
      "DAY 46~DAY 48",
      "DAY 49~DAY 51",
      "DAY 52~DAY 54",
      "DAY 55~DAY 57",
    ]);
    expect(series.hasEmptySession).toBe(false);
  });

  it("역방향으로도 회차가 겹치지 않게 이어진다", () => {
    const series = resolveBulkAssignmentSeries(
      units,
      { recommendedUnitIds: ["day-60"], recommendedDirection: -1 },
      "fixed_span",
      3,
      3,
    );

    expect(series.sessions.map((session) => unitRangeLabel(session.units))).toEqual([
      "DAY 60~DAY 58",
      "DAY 57~DAY 55",
      "DAY 54~DAY 52",
    ]);
  });

  it("이전 배정의 DAY 수와 역방향을 학생별로 유지한다", () => {
    const series = resolveBulkAssignmentSeries(
      units,
      {
        recommendedUnitIds: ["day-53", "day-52", "day-51"],
        recommendedDirection: -1,
      },
      "previous_span",
      1,
      2,
    );

    expect(series.requestedCountPerSession).toBe(3);
    expect(series.sessions.map((session) => unitRangeLabel(session.units))).toEqual([
      "DAY 53~DAY 51",
      "DAY 50~DAY 48",
    ]);
  });

  it("단어장 끝에서 마지막 시험만 짧아질 수 있다", () => {
    const series = resolveBulkAssignmentSeries(
      units,
      { recommendedUnitIds: ["day-58"], recommendedDirection: 1 },
      "fixed_span",
      2,
      2,
    );

    expect(series.sessions.map((session) => unitRangeLabel(session.units))).toEqual([
      "DAY 58~DAY 59",
      "DAY 60",
    ]);
    expect(series.sessions[1].truncated).toBe(true);
    expect(series.hasEmptySession).toBe(false);
  });

  it("요청한 회차 중 빈 시험이 생기면 전체 저장을 막을 수 있게 표시한다", () => {
    const series = resolveBulkAssignmentSeries(
      units,
      { recommendedUnitIds: ["day-60"], recommendedDirection: 1 },
      "fixed_span",
      1,
      2,
    );

    expect(series.sessions[0].units.map((unit) => unit.id)).toEqual(["day-60"]);
    expect(series.sessions[1].units).toEqual([]);
    expect(series.hasEmptySession).toBe(true);
  });
});
