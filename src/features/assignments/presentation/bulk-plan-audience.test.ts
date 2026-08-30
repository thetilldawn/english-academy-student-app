import { describe, expect, it } from "vitest";

import {
  buildBulkPlanAudience,
  bulkPlanItemStatus,
} from "./bulk-plan-audience";

const counts = {
  availableQuestionCount: 46,
  defaultSessionCount: 2,
  remainingQuestionCount: 0,
  selectedQuestionCount: 46,
};

describe("buildBulkPlanAudience", () => {
  it("uses the explicit common and exception groups", () => {
    expect(
      buildBulkPlanAudience({
        items: [
          { ...counts, available: true, error: null },
          { ...counts, available: true, error: null },
          { ...counts, available: false, error: "범위 부족" },
        ],
        commonPlanSummary: {
          ...counts,
          normalStudentIds: ["a", "b"],
          exceptionStudentIds: ["c"],
        },
      }),
    ).toMatchObject({
      mode: "common",
      sameCount: 2,
      separateCount: 1,
      reference: counts,
    });
  });

  it("does not expose the first student's counts when multiple plans have no common summary", () => {
    const audience = buildBulkPlanAudience({
      items: [
        { ...counts, available: true, error: null },
        {
          ...counts,
          available: true,
          availableQuestionCount: 640,
          error: null,
        },
      ],
      commonPlanSummary: null,
    });
    expect(audience).toMatchObject({
      mode: "unresolved",
      sameCount: 0,
      separateCount: 2,
    });
    expect(audience.reference).toBeNull();
  });

  it("treats one student's complete summary as a single plan", () => {
    expect(
      buildBulkPlanAudience({
        items: [{ ...counts, available: true, error: null }],
        commonPlanSummary: {
          ...counts,
          normalStudentIds: ["a"],
          exceptionStudentIds: [],
        },
      }),
    ).toMatchObject({
      mode: "single",
      sameCount: 1,
      separateCount: 0,
      totalCount: 1,
    });
  });

  it("keeps one invalid student in single-plan mode", () => {
    expect(
      buildBulkPlanAudience({
        items: [{ ...counts, available: false, error: "범위 부족" }],
        commonPlanSummary: null,
      }),
    ).toMatchObject({
      mode: "single",
      reference: null,
      sameCount: 0,
      separateCount: 1,
      totalCount: 1,
    });
  });

  it("does not call a one-person group common when several plans differ", () => {
    const audience = buildBulkPlanAudience({
      items: [
        { ...counts, available: true, error: null },
        { ...counts, available: true, error: null },
        { ...counts, available: true, error: null },
      ],
      commonPlanSummary: {
        ...counts,
        normalStudentIds: ["a"],
        exceptionStudentIds: ["b", "c"],
      },
    });

    expect(audience).toMatchObject({
      mode: "unresolved",
      sameCount: 0,
      separateCount: 3,
      totalCount: 3,
    });
    expect(audience.reference).toBeNull();
  });

  it("distinguishes different and blocked student plans", () => {
    const normalStudentIds = new Set(["a"]);
    const item = {
      available: true,
      error: null,
      sessions: [
        { available: true, error: null },
      ],
      studentId: "b",
    };

    expect(bulkPlanItemStatus(item, normalStudentIds)).toBe("different");
    expect(
      bulkPlanItemStatus({ ...item, available: false }, normalStudentIds),
    ).toBe("blocked");
  });
});
