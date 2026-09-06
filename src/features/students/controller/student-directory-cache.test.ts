import { afterEach, describe, expect, it, vi } from "vitest";
import { emptyStudentDirectoryFilters as filters } from "../contracts/student-directory-read-model";
import type { DirectoryCacheResponse } from "../contracts/student-directory-cache-contract";
import { StudentDirectoryRequestError } from "../contracts/student-directory-cache-contract";
import { createStudentDirectoryCache } from "./student-directory-cache";

const userId = "00000000-0000-4000-8000-000000000999";
const id = "00000000-0000-4000-8000-000000000001";
const identity = "a".repeat(64);
function response(points = 30): DirectoryCacheResponse {
  return { kind: "snapshot", identity, userId, snapshot: { filters, filterOptions: { classGroups: [], grades: [], schools: [], wordbooks: [] }, snapshotAt: "2026-09-06T00:00:00Z", totalCount: 1, page: { nextCursor: "cursor", items: [{ id, displayName: "가짜 학생", schoolName: null, gradeLabel: null, status: "active", codeStatus: "active", currentVocabBook: null, recentExamAt: null, rawPoints: points, completedCount: 0, missedCount: 0, notStartedCount: 0 }] } } };
}
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(done=>{resolve=done;}); return { promise, resolve }; }
afterEach(()=>vi.useRealTimers());
describe("개인 학생 목록 캐시",()=>{
  it("학생과 배정은 마지막 필터를 따로 기억하고 같은 결과만 공유한다",async()=>{
    const read = vi.fn().mockImplementation(async input => {
      const result = response(); if (result.kind !== "snapshot") throw new Error();
      result.snapshot.filters = input.filters; return result;
    });
    const cache = createStudentDirectoryCache(userId, read);
    expect(cache.filtersFor("assignments").status).toBe("active"); expect(cache.lastFilters.status).toBe("all");
    await cache.read({ ...filters, query: "학생 검색" });
    await cache.read({ ...filters, status: "active", query: "배정 검색" }, undefined, false, "assignments");
    expect(cache.lastFilters.query).toBe("학생 검색"); expect(cache.filtersFor("assignments").query).toBe("배정 검색");
    cache.rememberFilters({ ...filters, query: "입력 중" }, "assignments");
    expect(cache.filtersFor("assignments").query).toBe("입력 중"); expect(read).toHaveBeenCalledTimes(2);
    cache.lock(); expect(cache.lastFilters.query).toBe(""); expect(cache.filtersFor("assignments").query).toBe("");
    cache.dispose();
  });
  it("최초만 목록을 읽고 따뜻한 복원은 매번 인증/현재포인트를 받아 합친다",async()=>{
    const read=vi.fn().mockResolvedValueOnce(response()).mockResolvedValue({kind:"resume",identity,userId,points:[{id,rawPoints:45}]});
    const cache=createStudentDirectoryCache(userId,read);
    expect((await cache.read(filters)).snapshot.page.items[0].rawPoints).toBe(30);
    const warm=await cache.read(filters);
    expect(warm.snapshot.page.items[0].rawPoints).toBe(45);
    expect(read.mock.calls[1][0]).toMatchObject({identity,studentIds:[id]});
    expect(JSON.stringify(cache.inspect())).not.toMatch(/rawPoints|total_points/u);
    cache.dispose();
  });
  it("정규 조건별 분리와 15초 경계, 명시갱신은 캐시를 건너뛴다",async()=>{
    vi.useFakeTimers(); const read=vi.fn().mockImplementation(async(input)=>({ ...response(), snapshot:{...(response() as Extract<DirectoryCacheResponse,{kind:"snapshot"}>).snapshot,filters:input.filters} }));
    const cache=createStudentDirectoryCache(userId,read); await cache.read(filters);
    await vi.advanceTimersByTimeAsync(15000); await cache.read(filters);
    expect(read.mock.calls[1][0].identity).toBeUndefined();
    await cache.read({...filters,query:"가짜"}); expect(read.mock.calls[2][0].identity).toBeUndefined();
    await cache.read(filters,undefined,true); expect(read.mock.calls[3][0].identity).toBeUndefined(); cache.dispose();
  });
  it("정상빈목록도 저장하고 준비되지 않은 목록과 구분한다",async()=>{
    const first=response(); if(first.kind!=="snapshot")throw new Error(); first.snapshot.page.items=[]; first.snapshot.totalCount=0;
    const read=vi.fn().mockResolvedValueOnce(first).mockResolvedValue({kind:"resume",identity,userId,points:[]});
    const cache=createStudentDirectoryCache(userId,read); await cache.read(filters); expect((await cache.read(filters)).snapshot.totalCount).toBe(0);
    expect(read.mock.calls[1][0].studentIds).toEqual([]); cache.dispose();
  });
  it("동시 요청은 합치고 한 소비자의 취소가 다른 소비자를 취소하지 않는다",async()=>{
    const job=deferred<DirectoryCacheResponse>(); const read=vi.fn().mockReturnValue(job.promise); const cache=createStudentDirectoryCache(userId,read);
    const a=new AbortController(),b=new AbortController(); const first=cache.read(filters,a.signal).catch(e=>e); const second=cache.read(filters,b.signal);
    a.abort(); expect((await first).name).toBe("AbortError"); expect(read).toHaveBeenCalledTimes(1); expect(read.mock.calls[0][1].aborted).toBe(false);
    job.resolve(response()); expect((await second).snapshot.totalCount).toBe(1); cache.dispose();
  });
  it("마지막 소비자 취소와 늦은 응답을 저장하지 않는다",async()=>{
    const job=deferred<DirectoryCacheResponse>(); const read=vi.fn().mockReturnValue(job.promise); const cache=createStudentDirectoryCache(userId,read); const abort=new AbortController();
    const pending=cache.read(filters,abort.signal).catch(e=>e); abort.abort(); await pending; expect(read.mock.calls[0][1].aborted).toBe(true);
    job.resolve(response()); await Promise.resolve(); await Promise.resolve(); expect(cache.inspect().length).toBe(0); cache.dispose();
  });
  it("성공변경 무효화는 늦은 옛 응답과 더보기 커서를 복원하지 않는다",async()=>{
    const job=deferred<DirectoryCacheResponse>(); const read=vi.fn().mockReturnValueOnce(job.promise).mockResolvedValue(response(40)); const cache=createStudentDirectoryCache(userId,read);
    const old=cache.read(filters).catch(e=>e); cache.invalidate(); await cache.read(filters); job.resolve(response(1)); expect((await old).name).toBe("AbortError");
    expect(cache.inspect()).toHaveLength(1); cache.dispose();
  });
  it.each([401,403])("권한 오류 %i는 전체 저장소를 폐기하고 자동재시도하지 않는다",async(status)=>{
    const read=vi.fn().mockResolvedValueOnce(response()).mockRejectedValue(new StudentDirectoryRequestError(status)); const cache=createStudentDirectoryCache(userId,read);
    await cache.read(filters); await expect(cache.read(filters)).rejects.toBeInstanceOf(StudentDirectoryRequestError);
    expect(cache.blocked).toBe(true); expect(cache.inspect()).toEqual([]); await expect(cache.read(filters)).rejects.toBeInstanceOf(StudentDirectoryRequestError); expect(read).toHaveBeenCalledTimes(2); cache.dispose();
  });
  it.each([401,403])("취소된 옛 요청의 늦은 %i는 새 성공을 잠그지 않는다",async(status)=>{
    let rejectOld!: (error: Error)=>void;
    const oldJob=new Promise<DirectoryCacheResponse>((_resolve,reject)=>{rejectOld=reject;});
    const read=vi.fn().mockReturnValueOnce(oldJob).mockResolvedValue(response());
    const cache=createStudentDirectoryCache(userId,read); const old=cache.read(filters).catch(e=>e);
    cache.invalidate(); await cache.read(filters); rejectOld(new StudentDirectoryRequestError(status));
    expect((await old).name).toBe("AbortError"); expect(cache.blocked).toBe(false); expect(cache.inspect()).toHaveLength(1); cache.dispose();
  });
  it("일시실패는 정상빈목록/통과가 아니며 자동재시도가 없다",async()=>{
    const read=vi.fn().mockRejectedValue(new StudentDirectoryRequestError(503)); const cache=createStudentDirectoryCache(userId,read);
    await expect(cache.read(filters)).rejects.toThrow(); expect(cache.blocked).toBe(false); expect(cache.inspect()).toEqual([]); expect(read).toHaveBeenCalledTimes(1); cache.dispose();
  });
  it.each(["user","session"])("%s 변경 응답은 이전 화면에 보이지 않는다",async(change)=>{
    const changed=response(); if(change==="user")changed.userId=id; else changed.identity="b".repeat(64);
    const read=vi.fn().mockResolvedValueOnce(response()).mockResolvedValue(changed); const cache=createStudentDirectoryCache(userId,read); await cache.read(filters);
    await expect(cache.read(filters,undefined,true)).rejects.toThrow(); expect(cache.blocked).toBe(true); expect(cache.inspect()).toEqual([]); cache.dispose();
  });
  it("세대가 없는 최초응답은 표시만 가능하고 재방문 저장하지 않는다",async()=>{
    const missing=response(); missing.identity=null; const read=vi.fn().mockResolvedValue(missing); const cache=createStudentDirectoryCache(userId,read);
    await cache.read(filters); await cache.read(filters); expect(cache.inspect()).toEqual([]); expect(read.mock.calls[1][0].identity).toBeUndefined(); cache.dispose();
  });
  it("120초 미사용 항목은 조회 없이 제거하며 최대20조건만 보관한다",async()=>{
    vi.useFakeTimers();const read=vi.fn().mockImplementation(async(input)=>({...response(),snapshot:{...(response() as Extract<DirectoryCacheResponse,{kind:"snapshot"}>).snapshot,filters:input.filters}})); const cache=createStudentDirectoryCache(userId,read);
    for(let n=0;n<21;n++)await cache.read({...filters,query:String(n)});expect(cache.inspect()).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(120000);expect(cache.inspect()).toEqual([]);expect(read).toHaveBeenCalledTimes(21);cache.dispose();
  });
});
