import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ request: vi.fn(), known: vi.fn(), cache: vi.fn(), remember: vi.fn(), identity: "first" }));
vi.mock("@/features/session/public-client", () => ({ studentIdentityGeneration: () => m.identity }));
vi.mock("../../api/local-quiz", () => ({ requestLocalQuiz: m.request }));
vi.mock("./local-quiz-store", () => ({ knownLocalQuizAssignmentKeys: m.known, knownLocalQuizKeysFor: m.known, cacheLocalQuizContents: m.cache, rememberLocalQuizMaterials: m.remember }));
let prefetch: typeof import("./local-quiz-prefetch").prefetchLocalQuiz;
const packet = { contents: [], atoms: [] };
const tick = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
beforeEach(async () => {
  vi.resetAllMocks(); vi.resetModules(); m.identity = "first"; m.known.mockResolvedValue([]); m.cache.mockResolvedValue(undefined);
  prefetch = (await import("./local-quiz-prefetch")).prefetchLocalQuiz;
});
describe("목록의 공용 자료 미리 받기", () => {
  it("성공한 hover는 재요청하지 않고 캐시 누락·만료 시에만 다시 받는다",async()=>{
    m.request.mockResolvedValue({...packet,requiredKeys:["cached-key"]});
    await prefetch("warm");await tick();m.known.mockResolvedValue(["cached-key"]);
    await prefetch("warm");await tick();expect(m.request).toHaveBeenCalledTimes(1);
    m.known.mockResolvedValue([]);await prefetch("warm");await tick();expect(m.request).toHaveBeenCalledTimes(2);
    m.known.mockResolvedValue(["cached-key"]);const now=Date.now();const clock=vi.spyOn(Date,"now").mockReturnValue(now+48*60*60*1000);
    try{await prefetch("warm");await tick();expect(m.request).toHaveBeenCalledTimes(3);}finally{clock.mockRestore();}
  });
  it("여러 배정에서도 동시 두 요청을 넘지 않고 대기 포함 여덟 개만 받는다", async () => {
    const release: Array<() => void> = []; let active = 0; let max = 0;
    m.request.mockImplementation(() => new Promise(resolve => {
      active++; max = Math.max(max, active); release.push(() => { active--; resolve(packet); });
    }));
    const work = Array.from({ length: 12 }, (_, i) => prefetch(String(i)).then(() => true, () => false));
    await tick(); expect(m.request).toHaveBeenCalledTimes(2);
    for (let i = 0; i < 8; i++) { release[i](); await tick(); }
    expect((await Promise.all(work)).filter(Boolean)).toHaveLength(8);
    expect(max).toBe(2); expect(m.cache).toHaveBeenCalledTimes(8);
  });
  it("같은 배정의 한 구독을 취소해도 남아 있는 구독의 요청을 끊지 않는다", async () => {
    let release!: () => void; m.request.mockImplementation(() => new Promise(resolve => { release = () => resolve(packet); }));
    const a = new AbortController(), b = new AbortController();
    const first = prefetch("shared", a.signal).catch(e => e.name);
    const second = prefetch("shared", b.signal); await tick();
    a.abort(); expect(await first).toBe("AbortError");
    expect(m.request.mock.calls[0][1].aborted).toBe(false);
    release(); await second; expect(m.request).toHaveBeenCalledTimes(1); expect(m.cache).toHaveBeenCalledTimes(1);
  });
  it("마지막 구독 취소는 전송을 끊고 늦은 응답을 캐시에 넣지 않는다", async () => {
    let release!: () => void; m.request.mockImplementation(() => new Promise(resolve => { release = () => resolve(packet); }));
    const abort = new AbortController(), result = prefetch("cancelled", abort.signal).catch(e => e.name);
    await tick(); abort.abort(); expect(await result).toBe("AbortError");
    expect(m.request.mock.calls[0][1].aborted).toBe(true); release(); await tick(); expect(m.cache).not.toHaveBeenCalled();
  });
  it("대기 중 취소한 배정이나 바뀐 계정의 배정은 새 요청을 시작하지 않는다", async () => {
    const releases: Array<() => void> = [];
    m.request.mockImplementation(() => new Promise(resolve => releases.push(() => resolve(packet))));
    const first = prefetch("1").catch(e => e.name), second = prefetch("2").catch(e => e.name);
    const abort = new AbortController(); const third = prefetch("3", abort.signal).catch(e => e.name);
    const fourth = prefetch("4").catch(e => e.name);
    await tick(); abort.abort(); m.identity = "other"; releases.forEach(fn => fn());
    expect(await Promise.all([first, second, third, fourth])).toEqual(Array(4).fill("AbortError"));
    expect(m.request).toHaveBeenCalledTimes(2); expect(m.cache).not.toHaveBeenCalled();
  });
  it("같은 대기를 반복 취소해도 대기열이 쌓이거나 여섯 대기 자리를 소비하지 않는다", async () => {
    const releases: Array<() => void> = [];
    m.request.mockImplementation(() => new Promise(resolve => releases.push(() => resolve(packet))));
    const running=[prefetch("active-1"),prefetch("active-2")];await tick();
    for(let i=0;i<30;i++){const c=new AbortController();const p=prefetch("hover",c.signal).catch(e=>e.name);c.abort();expect(await p).toBe("AbortError");}
    const queued=Array.from({length:6},(_,i)=>prefetch("waiting-"+i).then(()=>true,()=>false));await tick();
    expect(m.request).toHaveBeenCalledTimes(2);
    for(let i=0;i<8;i++){releases[i]();await tick();}
    await Promise.all(running);expect(await Promise.all(queued)).toEqual(Array(6).fill(true));expect(m.request).toHaveBeenCalledTimes(8);
  });
});
