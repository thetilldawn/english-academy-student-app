import { afterEach, describe, expect, it, vi } from "vitest";
import { createHistoryListCache } from "./history-list-cache";
import { emptyHistoryCacheFilters as filters, type HistoryCacheRequest, type HistoryCacheResponse, type HistoryCacheSeed } from "../contracts/history-list-cache-contract";
import { AdminHistoryRequestError } from "../contracts/admin-history-request-error";

const userId = "00000000-0000-4000-8000-000000000999", identity = "a".repeat(64);
function response(version = "2026-09-06T00:00:01.000900Z"): HistoryCacheSeed {
  return { kind: "snapshot", identity, userId, snapshot: { ...filters, snapshotAt: version, sections: ["open", "needs_attention", "completed", "archived"].map(groupKey => ({ groupKey, items: [], nextCursor: null, totalCount: 0 })) } };
}
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes,no)=>{ resolve=yes; reject=no; }); return { promise, resolve, reject }; }
afterEach(()=>vi.useRealTimers());
describe("내역 개인 캐시", () => {
  it("현재 인증만 새로 확인하는 복원과 15초 경계를 구분한다", async () => {
    vi.useFakeTimers();
    const read = vi.fn().mockResolvedValueOnce(response()).mockResolvedValueOnce({ kind:"resume", userId, identity }).mockResolvedValue(response());
    const cache = createHistoryListCache(userId, read);
    await cache.read(filters); const first = cache.displayDeadlineAt;
    expect((await cache.read(filters)).snapshot.sections[0].totalCount).toBe(0);
    expect(read.mock.calls[1][0].identity).toBe(identity); expect(cache.displayDeadlineAt).toBe(first);
    await vi.advanceTimersByTimeAsync(15000); await cache.read(filters);
    expect(read.mock.calls[2][0].identity).toBeUndefined(); cache.dispose();
  });
  it("검색·상태를 기억하고 조건별로 분리한다", async () => {
    const read = vi.fn(async (input: HistoryCacheRequest) => ({...response(), snapshot:{...response().snapshot, ...input.filters} }));
    const cache = createHistoryListCache(userId, read);
    await cache.read(filters); await cache.read({...filters, query:"  학생   이름 "});
    expect(cache.lastFilters.query).toBe("학생 이름"); expect(read.mock.calls[1][0].identity).toBeUndefined(); expect(cache.inspect()).toHaveLength(2);
    cache.rememberFilters({...filters,statusFilter:"completed"}); expect(cache.lastFilters.statusFilter).toBe("completed");
    cache.lock(); expect(cache.lastFilters).toEqual(filters); cache.dispose();
  });
  it("변경 영수증은 먼저 기록하며 폐기/늦은 영수증으로 낮아지지 않는다", async () => {
    const read = vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(response("2026-09-06T00:00:02.000100Z"));
    const cache = createHistoryListCache(userId, read); await cache.read(filters);
    cache.noteMutation("2026-09-06T00:00:02.000900Z"); cache.invalidate(); cache.noteMutation("2026-09-06T00:00:01.000900Z");
    await expect(cache.read(filters)).rejects.toMatchObject({kind:"invalid-response"});
    expect(read.mock.calls.at(-1)?.[0].identity).toBeUndefined(); expect(cache.inspect()).toEqual([]);
    read.mockResolvedValue(response("2026-09-06T00:00:02.000900Z")); await cache.read(filters); expect(cache.inspect()).toHaveLength(1); cache.dispose();
  });
  it("독립 저장소는 같은 조건/사용자라도 요청과 만료를 공유하지 않는다", async () => {
    const read=vi.fn().mockResolvedValue(response()); const a=createHistoryListCache(userId,read), b=createHistoryListCache(userId,read);
    await Promise.all([a.read(filters), b.read(filters)]); expect(read).toHaveBeenCalledTimes(2);
    a.lock(); expect(b.blocked).toBe(false); expect(b.inspect()).toHaveLength(1); a.dispose(); b.dispose();
  });
  it.each(["user","session"] as const)("%s 교체는 이전 자료를 숨기고 저장소를 잠근다", async change => {
    const read=vi.fn().mockResolvedValueOnce(response()).mockResolvedValue({...response(),[change==="user"?"userId":"identity"]:"b".repeat(64)});
    const cache=createHistoryListCache(userId,read); await cache.read(filters); await expect(cache.read(filters)).rejects.toThrow();
    expect(cache.blocked).toBe(true); expect(cache.inspect()).toEqual([]); cache.dispose();
  });
  it.each(["unauthenticated","forbidden"] as const)("현재 %s는 잠그고 늦은 이전 실패는 새 자료에 적용하지 않는다", async kind => {
    const old=deferred<HistoryCacheResponse>(); const read=vi.fn().mockReturnValueOnce(old.promise).mockResolvedValue(response());
    const cache=createHistoryListCache(userId,read); const first=cache.read(filters).catch(e=>e);
    cache.invalidate(); await cache.read(filters); old.reject(new AdminHistoryRequestError(kind));
    expect((await first).name).toBe("AbortError"); expect(cache.blocked).toBe(false);
    read.mockRejectedValue(new AdminHistoryRequestError(kind)); await expect(cache.read(filters)).rejects.toThrow(); expect(cache.blocked).toBe(true); cache.dispose();
  });
  it("세대 없음은 보관하지 않고 60초 뒤 늦은 resume도 표시하지 않는다", async () => {
    vi.useFakeTimers(); const read=vi.fn().mockResolvedValue({...response(),identity:null}); const cache=createHistoryListCache(userId,read);
    await cache.read(filters); expect(cache.inspect()).toEqual([]);
    read.mockResolvedValue(response()); await cache.read(filters);
    const late=deferred<HistoryCacheResponse>(); read.mockReturnValue(late.promise); const pending=cache.read(filters).catch(e=>e);
    await vi.advanceTimersByTimeAsync(60000); late.resolve({kind:"resume",identity,userId}); expect(await pending).toMatchObject({kind:"unavailable"}); cache.dispose();
  });
  it("공동 요청 한 명 취소를 보존하고 변경 이전 응답을 버린다", async () => {
    const job=deferred<HistoryCacheResponse>(); const read=vi.fn().mockReturnValue(job.promise); const cache=createHistoryListCache(userId,read);
    const abort=new AbortController(); const a=cache.read(filters,abort.signal).catch(e=>e), b=cache.read(filters);
    abort.abort(); expect((await a).name).toBe("AbortError"); expect(read.mock.calls[0][1].aborted).toBe(false);
    job.resolve(response()); await b; expect(read).toHaveBeenCalledTimes(1); cache.dispose();
  });
  it("120초와 최대20개 정리는 자동 조회를 만들지 않는다", async () => {
    vi.useFakeTimers(); const read=vi.fn(async(input:HistoryCacheRequest)=>({...response(),snapshot:{...response().snapshot,...input.filters}})); const cache=createHistoryListCache(userId,read);
    for(let n=0;n<21;n++)await cache.read({...filters,query:String(n)}); expect(cache.inspect()).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(120000); expect(cache.inspect()).toEqual([]); expect(read).toHaveBeenCalledTimes(21); cache.dispose();
  });
});
