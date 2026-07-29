import { describe, expect, it } from "vitest";

import { getPriorWrongIndicator } from "@/lib/quiz/prior-wrong";

describe("getPriorWrongIndicator", () => {
  it("이전 오답이 없으면 표시하지 않는다", () => {
    expect(getPriorWrongIndicator(0)).toBeNull();
  });

  it("한 번 틀린 단어는 표시 한 개를 만든다", () => {
    expect(getPriorWrongIndicator(1)).toEqual({
      label: "이전에 한 번 틀린 단어",
      markerCount: 1,
    });
  });

  it("두 번 이상 틀린 단어는 표시 두 개를 만든다", () => {
    expect(getPriorWrongIndicator(2)).toEqual({
      label: "이전에 두 번 이상 틀린 단어",
      markerCount: 2,
    });
  });
});
