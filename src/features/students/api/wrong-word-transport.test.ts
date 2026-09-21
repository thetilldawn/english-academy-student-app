import { afterEach, expect, it, vi } from "vitest";
import { loadStudentWrongWords } from "./wrong-word-transport";
afterEach(() => vi.unstubAllGlobals());
it.each([401,403])("preserves HTTP %s even without a JSON body", async status => {
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("",{status})));
  await expect(loadStudentWrongWords("fake",new AbortController().signal,{datasetId:"",level:"all",query:""})).rejects.toMatchObject({status,message:"관리자 로그인을 다시 확인해 주세요."});
});
it("does not expose schema internals on malformed data",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({page:{items:"invalid"}})));
  await expect(loadStudentWrongWords("fake",new AbortController().signal,{datasetId:"",level:"all",query:""})).rejects.toMatchObject({status:502,message:"오답 목록을 불러오지 못했습니다. 다시 시도해 주세요."});
});
