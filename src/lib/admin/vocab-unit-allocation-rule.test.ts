import { describe, expect, it } from "vitest";

import { decodeStoredVocabUnitAllocationRule } from "./vocab-unit-allocation-rule";

function storedRule() {
  return {
    schema_version: 1,
    mode: "by_weekday",
    units_per_session: 2,
    weekday_units_per_session: Array.from({ length: 7 }, (_, index) => ({
      isodow: index + 1,
      unit_count: index === 2 ? 3 : 2,
    })),
    overflow_policy: "continue_weekly",
    base_session_unit_counts: [2, 3],
  };
}

describe("저장된 요일별 단위 규칙", () => {
  it("DB 표기를 화면·도메인 표기로 한 번만 변환한다", () => {
    expect(decodeStoredVocabUnitAllocationRule(storedRule())).toMatchObject({
      rule: {
        schemaVersion: 1,
        mode: "by_weekday",
        unitsPerSession: 2,
        weekdayUnitsPerSession: { 1: 2, 3: 3, 7: 2 },
      },
      overflowPolicy: "continue_weekly",
    });
  });

  it("요일이 중복되거나 필수 배열이 빠진 규칙은 거부한다", () => {
    const duplicate = storedRule();
    duplicate.weekday_units_per_session[6] = {
      isodow: 1,
      unit_count: 2,
    };
    expect(decodeStoredVocabUnitAllocationRule(duplicate)).toBeNull();
    const missing: Record<string, unknown> = storedRule();
    delete missing.weekday_units_per_session;
    expect(decodeStoredVocabUnitAllocationRule(missing)).toBeNull();
  });
});
