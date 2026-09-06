import { describe, expect, it, vi } from "vitest";
import { createHistoryRefreshCoordinator } from "./history-refresh-coordinator";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";
import type { AdminHistoryInitialRequest, AdminHistorySnapshot } from "../contracts/admin-history-read-model";
const stamp = "2026-09-06T00:00:02.000Z";
const input = { currentOnly: true, query: "", statusFilter: "all", mode: "section", snapshotAt: stamp, groupKey: "open" } as const;
const snapshot = (snapshotAt = stamp): AdminHistorySnapshot => ({ currentOnly: true, query: "", statusFilter: "all", snapshotAt,
  sections: ["open", "needs_attention", "completed"].map(groupKey => ({ groupKey, items: [], nextCursor: null, totalCount: 0 })) });
describe("내역 공동 갱신", () => {
  it.each([
    ["2026-09-06T00:00:02.000100Z", false],
    ["2026-09-06T00:00:02.000900Z", true],
    ["2026-09-06T00:00:02.000901Z", true],
    ["2026-09-06T09:00:02.000900+09:00", true],
  ])("DB 소수초 정밀도와 시간대를 보존한다: %s", async (candidate, allowed) => {
    const scope = createHistoryRefreshCoordinator(vi.fn(async () => snapshot(candidate)));
    const reading = scope.readFreshSection({ ...input, snapshotAt: "2026-09-06T00:00:02.000900Z" });
    if (allowed) expect((await reading).groupKey).toBe("open");
    else await expect(reading).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("세 구역은 한 번 읽고 한 소비자의 취소는 나머지를 취소하지 않는다", async () => {
    let finish!: (value: AdminHistorySnapshot) => void;
    const reader = vi.fn(() => new Promise<AdminHistorySnapshot>(resolve => { finish = resolve; }));
    const scope = createHistoryRefreshCoordinator(reader), abort = new AbortController();
    const first = scope.readFreshSection(input, abort.signal).catch(error => error);
    const second = scope.readFreshSection({ ...input, groupKey: "completed" });
    const third = scope.readFreshSection({ ...input, groupKey: "needs_attention" });
    expect(reader).toHaveBeenCalledTimes(1); abort.abort();
    expect((await first).name).toBe("AbortError");
    finish(snapshot()); expect((await second).groupKey).toBe("completed"); expect((await third).groupKey).toBe("needs_attention");
  });
  it("완료/실패 뒤 재시도는 새 읽기이고 성공 자료를 보관하지 않는다", async () => {
    const reader = vi.fn().mockRejectedValueOnce(new AdminHistoryRequestError("unavailable")).mockResolvedValue(snapshot());
    const scope = createHistoryRefreshCoordinator(reader);
    await expect(scope.readFreshSection(input)).rejects.toMatchObject({ kind: "unavailable" });
    await scope.readFreshSection(input); await scope.readFreshSection(input);
    expect(reader).toHaveBeenCalledTimes(3);
  });
  it("정규 검색은 합치고 다른 영수증·조건은 분리한다", async () => {
    const reader = vi.fn(async () => snapshot("2026-09-06T00:00:04.000Z"));
    const scope = createHistoryRefreshCoordinator(reader);
    await Promise.all([scope.readFreshSection({ ...input, query: " " }), scope.readFreshSection(input),
      scope.readFreshSection({ ...input, query: "다른 학생" }),
      scope.readFreshSection({ ...input, snapshotAt: "2026-09-06T00:00:03.000Z" })]);
    expect(reader).toHaveBeenCalledTimes(3);
  });
  it("영수증보다 이른 DB 스냅샷과 없는 구역은 거절한다", async () => {
    const scope = createHistoryRefreshCoordinator(vi.fn(async () => snapshot("2026-09-06T00:00:01.000Z")));
    await expect(scope.readFreshSection(input)).rejects.toMatchObject({ kind: "invalid-response" });
    const next = createHistoryRefreshCoordinator(vi.fn(async () => snapshot()));
    await expect(next.readFreshSection({ ...input, groupKey: "missing" })).rejects.toMatchObject({ kind: "invalid-response" });
  });
  it("전체 취소/해제 뒤 늦은 응답은 새 요청을 덮지 않는다", async () => {
    const finishes: ((value: AdminHistorySnapshot) => void)[] = [];
    const reader = vi.fn((_request: AdminHistoryInitialRequest, signal?: AbortSignal) => new Promise<AdminHistorySnapshot>(resolve => { finishes.push(resolve); void signal; }));
    const scope = createHistoryRefreshCoordinator(reader), abort = new AbortController();
    const old = scope.readFreshSection(input, abort.signal).catch(error => error);
    abort.abort(); expect(reader.mock.calls[0]![1]!.aborted).toBe(true);
    const current = scope.readFreshSection(input); finishes[0]!(snapshot()); finishes[1]!(snapshot());
    expect((await old).name).toBe("AbortError"); expect((await current).groupKey).toBe("open");
    const closing = scope.readFreshSection(input).catch(error => error);
    scope.cancelAll(); finishes[2]!(snapshot()); expect((await closing).name).toBe("AbortError");
  });
});
