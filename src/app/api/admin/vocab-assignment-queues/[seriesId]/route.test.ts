import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  resolveAttention: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/services/vocab-assignment-queue-command", () => ({
  resolveVocabAssignmentQueueAttention: mocks.resolveAttention,
}));

import { PATCH } from "./route";

const seriesId = "00000000-0000-4000-8000-000000000033";

function request(body: unknown, origin?: string) {
  return new Request(
    `http://localhost/api/admin/vocab-assignment-queues/${seriesId}`,
    {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        ...(origin ? { origin } : {}),
      },
      method: "PATCH",
    },
  );
}

describe("PATCH /api/admin/vocab-assignment-queues/[seriesId]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.resolveAttention.mockResolvedValue({
      action: "retry",
      series_id: seriesId,
      student_id: "00000000-0000-4000-8000-000000000020",
    });
  });

  it("관리자가 확인 필요 큐의 같은 회차 재배정을 요청한다", async () => {
    const response = await PATCH(
      request({ action: "retry" }),
      { params: Promise.resolve({ seriesId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolveAttention).toHaveBeenCalledWith(seriesId, "retry");
  });

  it("다른 출처·비로그인·알 수 없는 처리를 차단한다", async () => {
    expect(
      (
        await PATCH(
          request({ action: "retry" }, "https://attacker.example"),
          { params: Promise.resolve({ seriesId }) },
        )
      ).status,
    ).toBe(403);

    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect(
      (
        await PATCH(request({ action: "retry" }), {
          params: Promise.resolve({ seriesId }),
        })
      ).status,
    ).toBe(401);

    expect(
      (
        await PATCH(request({ action: "unknown" }), {
          params: Promise.resolve({ seriesId }),
        })
      ).status,
    ).toBe(400);
  });
});
