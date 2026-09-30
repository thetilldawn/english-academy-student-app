import { afterEach, expect, it, vi } from "vitest";
import { loadStudentWrongWords } from "./wrong-word-transport";
afterEach(() => vi.unstubAllGlobals());
it("검색어201자는입력을유지할수있는안내로거절하고200자는다시조회한다",async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({page:{items:[],nextCursor:null,totalCount:0,summary:{wrongEventCount:0,uniqueWordCount:0,onceWrongWordCount:0,repeatedWrongWordCount:0,pendingReviewCount:0},datasetOptions:[],reviewDrafts:[]}}));
  vi.stubGlobal("fetch",fetcher);
  const input={datasetId:"",level:"all" as const,query:"x".repeat(201)};
  await expect(loadStudentWrongWords("fake",new AbortController().signal,input)).rejects.toMatchObject({status:400,message:"오답 조회 조건을 확인해 주세요. 검색어는 200자까지 입력할 수 있습니다."});
  expect(input.query).toHaveLength(201);expect(fetcher).not.toHaveBeenCalled();
  await expect(loadStudentWrongWords("fake",new AbortController().signal,{...input,query:"x".repeat(200)})).resolves.toMatchObject({totalCount:0});
  expect(fetcher).toHaveBeenCalledOnce();
});
it.each([401,403])("preserves HTTP %s even without a JSON body", async status => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("",{status})));
  await expect(loadStudentWrongWords("fake",new AbortController().signal,{datasetId:"",level:"all",query:""})).rejects.toMatchObject({status,message:"관리자 로그인을 다시 확인해 주세요."});
});
it("does not expose schema internals on malformed data",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({page:{items:"invalid"}})));
  await expect(loadStudentWrongWords("fake",new AbortController().signal,{datasetId:"",level:"all",query:""})).rejects.toMatchObject({status:502,message:"오답 목록을 불러오지 못했습니다. 다시 시도해 주세요."});
});
