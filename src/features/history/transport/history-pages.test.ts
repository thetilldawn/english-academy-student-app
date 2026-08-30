import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistorySnapshot } from "@/features/history/contracts/admin-history-read-model";

import {
  loadAdminHistoryFreshSection,
  loadAdminHistoryNextPage,
  loadAdminHistorySnapshot,
} from "./history-pages";

afterEach(() => {
  vi.unstubAllGlobals();
});

const snapshot: AdminHistorySnapshot = {
  currentOnly: false,
  query: "학생",
  sections: [],
  snapshotAt: "2026-08-29T00:00:00.000Z",
  statusFilter: "all",
};

describe("admin history browser transport", () => {
  it("개인 검색 조건을 POST 본문으로 보내고 취소 신호를 전달한다", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ snapshot }));
    vi.stubGlobal("fetch", fetchMock);
    const signal = new AbortController().signal;
    const request = {
      currentOnly: false,
      mode: "initial",
      query: "학생",
      statusFilter: "all",
    } as const;

    await expect(loadAdminHistorySnapshot(request, signal)).resolves.toEqual(
      snapshot,
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/admin/history",
      expect.objectContaining({
        body: JSON.stringify(request),
        cache: "no-store",
        method: "POST",
        signal,
      }),
    );
  });

  it("API 오류 문구와 잘못된 성공 응답을 구분한다", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ error: "커서를 확인해 주세요." }, { status: 400 }),
      )
      .mockResolvedValueOnce(Response.json({ snapshot }));
    vi.stubGlobal("fetch", fetchMock);
    const pageRequest = {
      currentOnly: false,
      cursor: "cursor",
      groupKey: "open",
      mode: "page",
      query: "",
      statusFilter: "all",
    } as const;

    await expect(loadAdminHistoryNextPage(pageRequest)).rejects.toThrow(
      "커서를 확인해 주세요.",
    );
    await expect(loadAdminHistoryNextPage(pageRequest)).rejects.toThrow(
      "다음 시험 내역 응답을 확인하지 못했습니다.",
    );
  });

  it("변경된 구역의 서버 확정 개수까지 전달한다", async () => {
    const section = {
      groupKey: "completed",
      items: [],
      nextCursor: null,
      totalCount: 4,
      version: "2026-08-31T00:00:02.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ section }),
    ));
    await expect(loadAdminHistoryFreshSection({
      currentOnly: false,
      groupKey: "completed",
      mode: "section",
      query: "",
      snapshotAt: section.version,
      statusFilter: "all",
    })).resolves.toEqual(section);
  });
});
