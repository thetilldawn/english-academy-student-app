import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminHistorySnapshot } from "@/features/history/contracts/admin-history-read-model";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";
import { historyReadFailureMessage } from "../presentation/history-read-failure";

import {
  loadAdminHistoryFreshSection,
  loadAdminHistoryNextPage,
  loadAdminHistorySnapshot,
  readHistoryListCache,
} from "./history-pages";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const snapshot: AdminHistorySnapshot = {
  currentOnly: false,
  query: "학생",
  sections: ["open", "needs_attention", "completed", "archived"].map((groupKey) => ({
    groupKey, items: [], nextCursor: null, totalCount: 0,
  })),
  snapshotAt: "2026-08-29T00:00:00.000Z",
  statusFilter: "all",
};

describe("admin history browser transport", () => {
  it("cache 복원은 유효한 세대/필수 구역만 받아들이고 원문 부가는 제거한다", async () => {
    const identity = "a".repeat(64), userId = "00000000-0000-4000-8000-000000000999";
    const request = { mode: "cache", filters: { currentOnly: false, query: "학생", statusFilter: "all" }, identity } as const;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ kind: "resume", identity, userId, secret: "private" }))
      .mockResolvedValueOnce(Response.json({ kind: "resume", identity: "b".repeat(64), userId }))
      .mockResolvedValueOnce(Response.json({ kind: "snapshot", identity, userId, snapshot: { ...snapshot, sections: [] } }))
      .mockResolvedValueOnce(new Response("broken", { status: 403 })));
    expect(await readHistoryListCache(request)).toEqual({ kind: "resume", identity, userId });
    await expect(readHistoryListCache(request)).rejects.toMatchObject({ kind: "invalid-response" });
    await expect(readHistoryListCache(request)).rejects.toMatchObject({ kind: "invalid-response" });
    await expect(readHistoryListCache(request)).rejects.toMatchObject({ kind: "forbidden" });
  });

  it.each([
    { currentOnly: true, statusFilter: "all", keys: ["open", "needs_attention", "completed"] },
    { currentOnly: false, statusFilter: "retried", keys: ["filter-retried"] },
  ] as const)("요청별 필수 구역이 모두 있는 정상 0건은 유지한다: %j", async ({ currentOnly, statusFilter, keys }) => {
    const response = { ...snapshot, currentOnly, statusFilter,
      sections: keys.map((groupKey) => ({ groupKey, items: [], nextCursor: null, totalCount: 0 })) };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ snapshot: response })));
    await expect(loadAdminHistorySnapshot({ ...initialRequest, currentOnly, statusFilter })).resolves.toEqual(response);
  });

  const initialRequest = { currentOnly: false, mode: "initial", query: "학생", statusFilter: "all" } as const;

  it.each([
    [400, "invalid-request"], [401, "unauthenticated"], [403, "forbidden"],
    [404, "unavailable"], [503, "unavailable"],
  ] as const)("HTTP %s는 원문 없이 %s로 구분한다", async (status, kind) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      error: "private SQL token answer", code: "unknown",
    }, { status })));
    const result = await loadAdminHistorySnapshot(initialRequest).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(AdminHistoryRequestError);
    expect(result).toMatchObject({ kind });
    expect((result as Error).message).not.toContain("private");
    expect(historyReadFailureMessage(kind)).not.toMatch(/SQL|token|answer|Error|커서/);
  });

  it.each([401, 403])("인증 HTTP %s는 깨진 본문이어도 자료를 숨길 종류를 유지한다", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>private</html>", { status })));
    await expect(loadAdminHistorySnapshot(initialRequest)).rejects.toMatchObject({
      kind: status === 401 ? "unauthenticated" : "forbidden",
    });
  });

  it("서버 시간 초과와 일반 fetch 실패를 구분한다", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ code: "upstream_timeout", error: "raw" }, { status: 503 }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch private detail")));
    await expect(loadAdminHistorySnapshot(initialRequest)).rejects.toMatchObject({ kind: "timeout" });
    await expect(loadAdminHistorySnapshot(initialRequest)).rejects.toMatchObject({ kind: "unavailable" });
  });

  it.each([
    null, {}, { snapshot: {} }, { snapshot: { ...snapshot, sections: null } },
    { snapshot: { ...snapshot, sections: [] } },
    { snapshot: { ...snapshot, sections: snapshot.sections.slice(1) } },
    { snapshot: { ...snapshot, sections: [...snapshot.sections, snapshot.sections[0]] } },
    { snapshot: { ...snapshot, sections: [{ groupKey: "open", items: [{}], nextCursor: null, totalCount: 1 }] } },
    { snapshot: { ...snapshot, query: "다른 조건" } },
    { snapshot: { ...snapshot, statusFilter: "completed" } },
    { snapshot: { ...snapshot, currentOnly: true } },
    { snapshot: { ...snapshot, sections: [{ groupKey: "raw private group", items: [], nextCursor: null, totalCount: 0 }] } },
  ])("잘못된 성공 본문은 빈 결과로 반환하지 않는다: %j", async (payload) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    await expect(loadAdminHistorySnapshot(initialRequest)).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it("성공 HTML을 빈 결과로 삼지 않는다", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>broken</html>")));
    await expect(loadAdminHistorySnapshot(initialRequest)).rejects.toMatchObject({ kind: "invalid-response" });
  });

  it.each(["initial", "cache"])("필수 값은 검증하고 정상 null은 유지하며 정답·원본 필드는 버린다: %s", async mode => {
    const item = {
      activityAt: snapshot.snapshotAt, assignedAt: snapshot.snapshotAt,
      assignmentId: "00000000-0000-4000-8000-000000000001", assignmentPurpose: "regular",
      assignmentTitle: "가짜 시험", attemptId: null, availableUntil: null, cancelledAt: null,
      completedAt: null, datasetTitle: "가짜 자료", deadlineAt: null, finalScore: null,
      id: "assignment:fake", initialCompletedAt: null, initialScore: null, missedAt: null,
      passed: null, passingScore: 80, phase: null, primaryUnitLabels: [], questionCount: 20,
      retryStartedAt: null, startedAt: null, status: "not_started",
      studentId: "00000000-0000-4000-8000-000000000002", studentName: "가짜 학생",
      unitLabels: [], questions: [{ answer: "secret" }], _dataset: { raw: "private" },
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      kind: "snapshot", identity: "a".repeat(64), userId: "00000000-0000-4000-8000-000000000999",
      snapshot: { ...snapshot, sections: [
        { groupKey: "open", items: [item], nextCursor: null, totalCount: 1 }, ...snapshot.sections.slice(1),
      ] },
    })));
    const cached = mode === "cache" ? await readHistoryListCache({ mode: "cache", filters: { currentOnly: false, query: "학생", statusFilter: "all" } }) : null;
    const result = cached?.kind === "snapshot" ? cached.snapshot : await loadAdminHistorySnapshot(initialRequest);
    expect(result.sections[0].items[0].initialScore).toBeNull();
    expect(result.sections[0].items[0]).not.toHaveProperty("questions");
    expect(result.sections[0].items[0]).not.toHaveProperty("_dataset");
  });
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
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("화면 전환 취소는 시간 초과 문구로 바꾸지 않는다", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("aborted", "AbortError"),
        ), { once: true });
      },
    )));
    const result = loadAdminHistorySnapshot({
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "all",
    }, controller.signal);

    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("7초를 넘긴 요청은 다시 시도할 수 있는 문구로 끝낸다", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input, init) => new Promise(
      (_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(
          new DOMException("aborted", "AbortError"),
        ), { once: true });
      },
    )));
    const result = loadAdminHistorySnapshot({
      currentOnly: false,
      mode: "initial",
      query: "",
      statusFilter: "all",
    });
    const expectation = expect(result).rejects.toMatchObject({ kind: "timeout" });
    expect(historyReadFailureMessage("timeout")).toBe("시험 내역 응답이 늦어지고 있습니다. 다시 시도해 주세요.");

    await vi.advanceTimersByTimeAsync(7_000);

    await expectation;
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

    await expect(loadAdminHistoryNextPage(pageRequest)).rejects.toMatchObject({ kind: "invalid-request" });
    await expect(loadAdminHistoryNextPage(pageRequest)).rejects.toMatchObject({ kind: "invalid-response" });
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
