import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getAdminContext: vi.fn(),
  listPage: vi.fn(),
}));

vi.mock("@/lib/auth/admin", () => ({
  getAdminContext: mocks.getAdminContext,
}));
vi.mock("@/lib/services/vocab-assignment-queue-query", () => ({
  listStudentVocabAssignmentQueuePage: mocks.listPage,
}));

import { GET } from "./route";

const studentId = "00000000-0000-4000-8000-000000000020";
const seriesId = "00000000-0000-4000-8000-000000000033";
const updatedAt = "2026-08-22T01:00:00.000Z";

describe("GET /api/admin/students/[id]/vocab-assignment-queues", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAdminContext.mockResolvedValue({ userId: "admin-id" });
    mocks.listPage.mockResolvedValue({ nextCursor: null, queues: [] });
  });

  it("학생 한 명의 다음 이력 묶음을 커서로 불러온다", async () => {
    const query = new URLSearchParams({
      beforeSeriesId: seriesId,
      beforeUpdatedAt: updatedAt,
    });
    const response = await GET(
      new Request(`http://localhost/api/test?${query.toString()}`),
      { params: Promise.resolve({ id: studentId }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.listPage).toHaveBeenCalledWith(
      {
        before: { seriesId, updatedAt },
        studentId,
      },
      { userId: "admin-id" },
    );
  });

  it("로그인과 완전한 커서를 요구한다", async () => {
    mocks.getAdminContext.mockResolvedValueOnce(null);
    expect(
      (
        await GET(new Request("http://localhost/api/test"), {
          params: Promise.resolve({ id: studentId }),
        })
      ).status,
    ).toBe(401);

    expect(
      (
        await GET(
          new Request(
            `http://localhost/api/test?beforeSeriesId=${seriesId}`,
          ),
          { params: Promise.resolve({ id: studentId }) },
        )
      ).status,
    ).toBe(400);
  });
});
