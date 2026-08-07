import { describe, expect, it } from "vitest";

import { resolveBookMeaningCapability } from "./vocab-link-import-policy";

describe("단어장 출제 capability 상태", () => {
  it("제외 단어가 없으면 ready로 만든다", () => {
    expect(resolveBookMeaningCapability(4, 0, "conflict_excluded")).toEqual({
      status: "ready",
      reasonCode: "all_entries_eligible",
    });
  });

  it("일부만 출제 가능하면 limited로 만든다", () => {
    expect(resolveBookMeaningCapability(3, 1, "conflict_excluded")).toEqual({
      status: "limited",
      reasonCode: "conflict_excluded",
    });
  });

  it("전부 제외되면 blocked로 만든다", () => {
    expect(resolveBookMeaningCapability(0, 4, "conflict_excluded")).toEqual({
      status: "blocked",
      reasonCode: "conflict_excluded",
    });
  });

  it("빈 데이터셋 수치는 거부한다", () => {
    expect(() => resolveBookMeaningCapability(0, 0, "empty")).toThrow(
      "invalid_vocab_capability_counts",
    );
  });
});
