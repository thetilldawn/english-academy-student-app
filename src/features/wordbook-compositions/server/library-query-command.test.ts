import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), requireAdmin: vi.fn(), getAdminContext: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ requireAdmin: mocks.requireAdmin, getAdminContext: mocks.getAdminContext }));
vi.mock("@/lib/supabase/server", () => ({ createServerSupabaseClient: async () => ({ rpc: mocks.rpc }) }));
import { EMPTY_LIBRARY_FILTERS } from "../contracts/library";
import { queryLibrary } from "./queries/library-query";
import { saveLibraryTemplateV2 } from "./commands/library-command-v2";
import { POST as queryRoute } from "@/app/api/admin/wordbook-library/query/route";
import { POST as commandRoute } from "@/app/api/admin/wordbook-library/commands/route";
import { readLibraryPage, sendLibraryCommandV2 } from "../client/transport/library-transport";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const viewerId = id(99), hash = "a".repeat(64);
const metadata = { title:"가짜 템플릿",tags:[],school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null };
const recipe = { filters:EMPTY_LIBRARY_FILTERS,scopes:[],excludedOccurrenceKeys:[],scopeStatus:"unconfirmed" as const };
const criteria = { groups:[],excludedOccurrenceKeys:[],scopeStatus:"unconfirmed" as const };
const version = { id:id(3),number:1,contentHash:hash,scopeStatus:"unconfirmed",scopeCount:0,sourceCount:0,includedCount:0,sourceVersionId:null,datasetId:null,createdAt:"2026-09-21T00:00:00Z",hasCriteria:true };
const template = { id:id(2),revision:1,metadata,latestVersion:version };
const create = { action:"create" as const,requestId:id(1),metadata,recipe,criteria,previewHash:hash };
const csat = { kind:"csat",sourceGrade:"g12",exam:{executionYear:2025,examMonth:11,examKind:"csat",academicYear:2026,agency:"가짜",typeCode:"long_reading",typeLabel:"장문독해",questionNumbers:[41,42],sharedPassage:true},lesson:null,day:null,publisher:null,school:null,targetGrade:null,schoolYear:null,semester:null,assessment:null,purpose:null };
const request = (value: unknown, actor: string | null = viewerId) => new Request("http://localhost/api/admin/wordbook-library",{method:"POST",headers:actor?{"X-Wordbook-Viewer":actor}:{},body:JSON.stringify(value)});
beforeEach(()=>{vi.resetAllMocks();mocks.requireAdmin.mockResolvedValue({userId:viewerId});mocks.getAdminContext.mockResolvedValue({userId:viewerId});});
afterEach(()=>vi.unstubAllGlobals());
describe("paged library server contracts",()=>{
  it("checks authentication and continuation identity before either database boundary",async()=>{
    mocks.getAdminContext.mockResolvedValue(null);
    for(const route of [queryRoute,commandRoute]) expect((await route(request({}))).status).toBe(401);
    mocks.getAdminContext.mockResolvedValue({userId:viewerId});
    for(const route of [queryRoute,commandRoute]) expect((await route(request({},id(98)))).status).toBe(403);
    expect((await commandRoute(request(create,null))).status).toBe(403);expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("rejects extra fields and overlarge pages before querying",async()=>{
    for(const query of [{kind:"templates",search:"",limit:51},{kind:"templates",search:"",answers:true}]) await expect(queryLibrary(query)).rejects.toMatchObject({status:422});
    expect(mocks.rpc).not.toHaveBeenCalled();
    mocks.rpc.mockResolvedValue({data:{kind:"templates",viewerId,items:[],nextCursor:null},error:null});
    const response=await queryRoute(request({kind:"templates",search:""},null));expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.rpc).toHaveBeenLastCalledWith("query_vocabulary_library_v1",{p_query:{kind:"templates",search:"",cursor:null,limit:20}});
  });
  it("refuses another viewer, another result kind and embedded source data",async()=>{
    for(const data of [{kind:"templates",viewerId:id(98),items:[],nextCursor:null},{kind:"versions",viewerId,items:[],nextCursor:null},{kind:"templates",viewerId,items:[],nextCursor:null,occurrences:[]}]){
      mocks.rpc.mockResolvedValue({data,error:null});await expect(queryLibrary({kind:"templates",search:""})).rejects.toMatchObject({status:503});
    }
  });
  it("derives CSAT tags from the exact saved classifications and removes internal classifications",async()=>{
    mocks.rpc.mockResolvedValue({data:{kind:"detail",viewerId,template,version,criteria,recipe,classifications:[csat]},error:null});
    const detail=await queryLibrary({kind:"detail",templateId:template.id});expect(detail).toMatchObject({sourceTags:expect.arrayContaining(["수능","수능 2025년 시행","2026학년도 수능","장문독해"])});expect(detail).not.toHaveProperty("classifications");
    mocks.rpc.mockResolvedValue({data:{kind:"preview",viewerId,recipe,contentHash:hash,sourceCount:0,includedCount:0,heldCount:0,excludedCount:0,groups:[],orphanedExclusions:[],difference:null,classifications:[csat]},error:null});
    const preview=await queryLibrary({kind:"preview",selection:{mode:"criteria",criteria},metadata,compareVersionId:null});expect(preview).toMatchObject({suggestedTitle:expect.stringContaining("수능")});expect(JSON.stringify(preview)).not.toContain("11월");
  });
  it("checks saved metadata/hash and the exact deleted id/revision",async()=>{
    mocks.rpc.mockResolvedValue({data:{template},error:null});expect(await saveLibraryTemplateV2(create)).toEqual({template});
    for(const wrong of [{...template,metadata:{...metadata,title:"다른 템플릿"}},{...template,latestVersion:{...version,contentHash:"b".repeat(64)}}]){
      mocks.rpc.mockResolvedValue({data:{template:wrong},error:null});await expect(saveLibraryTemplateV2(create)).rejects.toMatchObject({status:503});
    }
    const deletion={action:"delete",requestId:id(5),templateId:template.id,expectedRevision:1};
    mocks.rpc.mockResolvedValue({data:{deleted:{templateId:template.id,revision:2}},error:null});expect(await saveLibraryTemplateV2(deletion)).toEqual({deleted:{templateId:template.id,revision:2}});
    for(const deleted of [{templateId:id(6),revision:2},{templateId:template.id,revision:3}]){mocks.rpc.mockResolvedValue({data:{deleted},error:null});await expect(saveLibraryTemplateV2(deletion)).rejects.toMatchObject({status:503});}
  });
  it.each([["42501",403],["P0002",404],["40001",409],["22023",422],["XX000",503]])("maps %s without leaking internal errors",async(code,status)=>{
    mocks.rpc.mockResolvedValue({data:null,error:{code,message:"private SQL source"}});
    for(const response of [await queryRoute(request({kind:"templates",search:""})),await commandRoute(request(create))]){
      expect(response.status).toBe(status);expect(response.headers.get("cache-control")).toBe("private, no-store");expect(await response.text()).not.toContain("private SQL source");
    }
  });
  it("sends bounded private queries and rejects mismatched browser results",async()=>{
    const f=vi.fn().mockResolvedValue(Response.json({kind:"templates",viewerId,items:[],nextCursor:null}));vi.stubGlobal("fetch",f);
    const query={kind:"templates" as const,search:"",cursor:null,limit:20};await readLibraryPage(query,new AbortController().signal,viewerId);
    expect(f.mock.calls[0]![1]).toMatchObject({method:"POST",cache:"no-store",headers:{"X-Wordbook-Viewer":viewerId}});
    f.mockResolvedValue(Response.json({kind:"templates",viewerId:id(98),items:[],nextCursor:null}));await expect(readLibraryPage(query,new AbortController().signal,viewerId)).rejects.toMatchObject({status:403});
    f.mockResolvedValue(Response.json({deleted:{templateId:id(7),revision:2}}));await expect(sendLibraryCommandV2({action:"delete",requestId:id(5),templateId:template.id,expectedRevision:1},viewerId)).rejects.toMatchObject({status:503});
  });
});
