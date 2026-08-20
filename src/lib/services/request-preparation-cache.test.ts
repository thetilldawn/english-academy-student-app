import { describe, expect, it, vi } from "vitest";

import { memoizeRequestPreparation } from "./request-preparation-cache";

describe("request preparation cache", () => {
  it("merges 210 concurrent reads for the same key into one load", async () => {
    const cache = new Map<string, Promise<{ count: number }>>();
    const load = vi.fn(async () => ({ count: 40 }));

    const results = await Promise.all(
      Array.from({ length: 210 }, () =>
        memoizeRequestPreparation(cache, "dataset-1", load),
      ),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(210);
    expect(results.every((result) => result.count === 40)).toBe(true);
  });

  it("keeps different student, dataset, and exclusion keys separate", async () => {
    const cache = new Map<string, Promise<string>>();
    const load = vi.fn(async (value: string) => value);
    const keys = [
      '["student-a","dataset-1",null]',
      '["student-b","dataset-1",null]',
      '["student-a","dataset-2",null]',
      '["student-a","dataset-1","assignment-1"]',
    ];

    const values = await Promise.all(
      keys.map((key) =>
        memoizeRequestPreparation(cache, key, () => load(key)),
      ),
    );

    expect(load).toHaveBeenCalledTimes(keys.length);
    expect(values).toEqual(keys);
  });

  it("does not share values between separate request maps", async () => {
    const load = vi.fn(async () => "fresh");

    await memoizeRequestPreparation(new Map(), "same-key", load);
    await memoizeRequestPreparation(new Map(), "same-key", load);

    expect(load).toHaveBeenCalledTimes(2);
  });
});
