import { describe, expect, it } from "vitest";

import {
  assignmentRequestFingerprint,
  reserveIdempotencyKey,
} from "./fingerprint";

describe("assignment request fingerprint and idempotency", () => {
  it("객체 key 순서와 무관하지만 DAY 배열 순서는 보존한다", () => {
    expect(
      assignmentRequestFingerprint({ b: 2, a: { d: 4, c: 3 } }),
    ).toBe(
      assignmentRequestFingerprint({ a: { c: 3, d: 4 }, b: 2 }),
    );
    expect(assignmentRequestFingerprint({ unitIds: ["60", "59"] })).not.toBe(
      assignmentRequestFingerprint({ unitIds: ["59", "60"] }),
    );
  });

  it("같은 payload 재시도는 같은 키, 입력 변경은 새 키를 사용한다", () => {
    let sequence = 0;
    const createKey = () => `key-${++sequence}`;
    const first = reserveIdempotencyKey(null, "payload-a", createKey);
    const retry = reserveIdempotencyKey(first, "payload-a", createKey);
    const changed = reserveIdempotencyKey(retry, "payload-b", createKey);

    expect(retry).toBe(first);
    expect(retry.key).toBe("key-1");
    expect(changed).toStrictEqual({
      fingerprint: "payload-b",
      key: "key-2",
    });
  });
});
