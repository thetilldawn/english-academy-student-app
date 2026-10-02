import { afterEach, expect, it, vi } from "vitest";
import { loadStudentWrongWords, loadStudentMistakes, queueStudentMistakes } from "./wrong-word-transport";
import { fakeId, fakeMeaning, fakeMistakePage, mistakeTestFilters } from "../controller/mistake-test-fixtures";
import { mistakeTarget } from "../contracts/mistake-episode";
afterEach(() => vi.unstubAllGlobals());
it("새 조회는 보기·정렬·커서를 보내고 관리자 출처 구간을 보존한다",async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({page:fakeMistakePage()}));vi.stubGlobal("fetch",fetcher);
  const page=await loadStudentMistakes(fakeId(1),new AbortController().signal,{...mistakeTestFilters,view:"history",sort:"recent"},"cursor");
  const url=new URL(fetcher.mock.calls[0][0],"https://test.invalid");
  expect(url.searchParams.get("view")).toBe("history");expect(url.searchParams.get("sort")).toBe("recent");expect(url.searchParams.get("cursor")).toBe("cursor");
  expect(page.items[0].meanings[0].sources[0].episodeId).toBe(fakeMeaning().episodeId);
});
it("큐 저장은 선택한 다섯 참조만 보내며 불완전한 성공 응답도 거절한다",async()=>{
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({queueIds:[fakeId(50)]})).mockResolvedValueOnce(Response.json({queueIds:[]}));vi.stubGlobal("fetch",fetcher);
  const target=mistakeTarget(fakeMeaning())!;
  await expect(queueStudentMistakes(fakeId(1),[target])).resolves.toEqual({queueIds:[fakeId(50)]});
  expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({targets:[target]});
  await expect(queueStudentMistakes(fakeId(1),[target])).rejects.toMatchObject({status:502});
});
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
