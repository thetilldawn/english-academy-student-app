import { afterEach, describe, expect, it, vi } from "vitest";

import {
  QueueResolutionError,
  resolveAssignmentQueue,
} from "./queue-actions";

const seriesId = "00000000-0000-4000-8000-000000000033";
const itemId = "00000000-0000-4000-8000-000000000022";
const studentId = "00000000-0000-4000-8000-000000000020";
const version = "2026-08-31T00:00:00.000Z";

function payload(overrides: Record<string, unknown> = {}) {
  return {
    queue: { seriesId, studentId, updatedAt: version, items: [{ id: itemId }] },
    resolution: { item_id: itemId, action: "retry", series_id: seriesId, student_id: studentId },
    version,
    ...overrides,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("queue resolution browser receipt", () => {
  it.each([undefined, null, {}, [null], []])("불완전한 회차 목록 %j는 안전한 오류로 바꾼다", async (items) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json(payload({queue: {seriesId, studentId, updatedAt: version, items}})),
    ));
    await expect(resolveAssignmentQueue(seriesId,"retry",itemId)).rejects
      .toMatchObject({status:503,message:"변경된 배정 시험 상태를 확인하지 못했습니다."});
  });
  it("accepts only a fully matching receipt", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json(payload()),
    ));

    await expect(resolveAssignmentQueue(seriesId, "retry", itemId)).resolves
      .toMatchObject({ version, resolution: { action: "retry" } });
  });

  it("turns mismatched or malformed success bodies into a recoverable 503", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(payload({ version: `${version}-wrong` })))
      .mockResolvedValueOnce(new Response("not-json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    for (let index = 0; index < 2; index += 1) {
      await expect(resolveAssignmentQueue(seriesId, "retry", itemId)).rejects
        .toMatchObject({ status: 503 });
    }
  });

  it("preserves a known command conflict status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "이미 처리됨" }, { status: 409 }),
    ));

    await expect(resolveAssignmentQueue(seriesId, "retry", itemId)).rejects
      .toBeInstanceOf(QueueResolutionError);
    await expect(resolveAssignmentQueue(seriesId, "retry", itemId)).rejects
      .toMatchObject({ status: 409 });
  });
});
