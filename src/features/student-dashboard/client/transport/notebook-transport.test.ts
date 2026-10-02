/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadNotebook } from "./notebook-transport";
const filters={datasetId:"",level:"all" as const,query:"",view:"current" as const,sort:"count" as const};
const page={view:"current",stateVersion:"1",sourceVersion:"a".repeat(64),items:[],totalCount:0,nextCursor:null,
  summary:{wordCount:0,currentWrongCount:0,lifetimeWrongCount:0,currentMissedCount:0,legacyWrongCount:0},datasetOptions:[]};
afterEach(()=>vi.unstubAllGlobals());
describe("단어장 HTTP 세션 경계",()=>{
  it("서버와 같은 경계값의 성공 자료만 반환한다",async()=>{
    const fetch=vi.fn().mockResolvedValue(Response.json({page,identity:"fake-scope"}));vi.stubGlobal("fetch",fetch);
    expect(await loadNotebook(filters,null,new AbortController().signal,"fake-scope")).toEqual(page);
    expect(fetch.mock.calls[0][1]).toMatchObject({cache:"no-store",headers:{"x-student-notebook-identity":"fake-scope"}});
  });
  it.each(["different",undefined])("응답의 세션 경계 %s가 일치하지 않으면 자료를 폐기한다",async identity=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({page,identity})));
    await expect(loadNotebook(filters,null,new AbortController().signal,"fake-scope")).rejects.toMatchObject({status:401});
  });
});
