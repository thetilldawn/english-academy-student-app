import { describe, expect, it } from "vitest";

import {
  BulkAssignmentError,
  mapBulkAssignmentPreparationFailure,
} from "./bulk-assignment-service";
import { MixedAssignmentError } from "@/lib/services/mixed-assignment-service";
import { AssignmentCreationError } from "@/lib/services/regular-assignment-service";

describe("bulk assignment preparation errors", () => {
  it.each(["conflict", "invalid_selection", "database"] as const)(
    "일반 배정의 %s 분류를 일괄 경로에서도 보존한다",
    (reason) => {
      expect(
        mapBulkAssignmentPreparationFailure(
          new AssignmentCreationError(reason),
        ),
      ).toEqual(expect.objectContaining({ reason }));
    },
  );

  it.each([
    ["conflict", "conflict"],
    ["database", "database"],
    ["invalid_selection", "invalid_selection"],
    ["unavailable", "invalid_selection"],
  ] as const)("혼합 배정의 %s 분류를 %s로 보존한다", (source, expected) => {
    expect(
      mapBulkAssignmentPreparationFailure(
        new MixedAssignmentError(source),
      ),
    ).toEqual(expect.objectContaining({ reason: expected }));
  });

  it("이미 분류된 일괄 오류는 그대로 사용한다", () => {
    const error = new BulkAssignmentError("database");
    expect(mapBulkAssignmentPreparationFailure(error)).toBe(error);
  });

  it("분류되지 않은 내부 오류는 입력 오류로 노출하지 않는다", () => {
    expect(
      mapBulkAssignmentPreparationFailure(
        new Error("database connection details"),
      ),
    ).toEqual(expect.objectContaining({
      message: "일괄 단어 시험을 배정하지 못했습니다.",
      reason: "database",
    }));
  });
});
