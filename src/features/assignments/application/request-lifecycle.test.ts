import { describe, expect, it } from "vitest";

import {
  createExclusiveSubmissionGate,
  createLatestRequestPolicy,
} from "./request-lifecycle";

describe("assignment request lifecycle", () => {
  it("오래된 미리보기 식별자를 현재 요청으로 인정하지 않는다", () => {
    const policy = createLatestRequestPolicy();
    const first = { fingerprint: "a", requestId: "first", revision: 1 };
    const second = { fingerprint: "b", requestId: "second", revision: 2 };

    policy.start(first);
    policy.start(second);

    expect(policy.isCurrent(first)).toBe(false);
    expect(policy.isCurrent(second)).toBe(true);
    policy.cancel(second);
    expect(policy.isCurrent(second)).toBe(false);
  });

  it("활성 저장이 끝나기 전에는 두 번째 저장을 받지 않는다", () => {
    const gate = createExclusiveSubmissionGate();
    expect(gate.begin("first")).toBe(true);
    expect(gate.begin("second")).toBe(false);
    gate.finish("second");
    expect(gate.begin("third")).toBe(false);
    gate.finish("first");
    expect(gate.begin("third")).toBe(true);
  });
});
