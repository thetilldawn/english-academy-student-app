import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMistakeEpisodeHistory } from "./mistake-episode-history";
const input={meaningKey:"a".repeat(64),upperVersion:"7",cursor:"opaque"};
const page={meaningKey:input.meaningKey,stateVersion:"7",episodeCount:20,items:[],nextCursor:null};
afterEach(()=>vi.unstubAllGlobals());
describe("뜻별 이력 전송",()=>{
  it("학생 세션을 확인하고 조회 상한을 바꾸지 않는다",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({page,identity:"session"}));vi.stubGlobal("fetch",fetcher);
    expect(await loadMistakeEpisodeHistory({kind:"student",identity:"session"},input,new AbortController().signal)).toEqual(page);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("upperVersion=7&cursor=opaque"),expect.objectContaining({cache:"no-store",headers:{"x-student-notebook-identity":"session"}}));
  });
  it("옛 세션과 다른 뜻·상한·잘못된 응답을 버린다",async()=>{
    const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
    fetcher.mockResolvedValueOnce(Response.json({page,identity:"old"}));
    await expect(loadMistakeEpisodeHistory({kind:"student",identity:"session"},input,new AbortController().signal)).rejects.toMatchObject({status:401});
    for(const changed of [{...page,stateVersion:"8"},{...page,meaningKey:"b".repeat(64)},{}]) {
      fetcher.mockResolvedValueOnce(Response.json({page:changed}));
      await expect(loadMistakeEpisodeHistory({kind:"admin",studentId:"fake"},input,new AbortController().signal)).rejects.toMatchObject({status:502});
    }
  });
});
