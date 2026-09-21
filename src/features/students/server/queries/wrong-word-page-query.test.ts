import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const {rpc,requireAdmin}=vi.hoisted(()=>({rpc:vi.fn(),requireAdmin:vi.fn()}));
vi.mock("@/lib/auth/admin",()=>({requireAdmin}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:async()=>({rpc})}));
import { getStudentWrongWordPage, WrongWordPageForbiddenError } from "./wrong-word-page-query";
const student="00000000-0000-4000-8000-000000000001";
const filters={datasetId:"",level:"all" as const,query:""};
const summary={wrongEventCount:0,uniqueWordCount:0,onceWrongWordCount:0,repeatedWrongWordCount:0,pendingReviewCount:0};
beforeEach(()=>vi.clearAllMocks());
describe("bounded admin wrong word query",()=>{
  it("uses one authenticated RPC with no raw event fetch and preserves valid empty results",async()=>{
    rpc.mockResolvedValue({data:{items:[],eventUpperId:"0",summary,totalCount:0,datasetOptions:[],reviewDrafts:[]},error:null});
    expect(await getStudentWrongWordPage(student,{filters})).toEqual({items:[],nextCursor:null,summary,totalCount:0,datasetOptions:[],reviewDrafts:[]});
    expect(requireAdmin).toHaveBeenCalledOnce(); expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("get_admin_student_wrong_word_page_v1",expect.objectContaining({p_student_id:student,p_event_upper_id:null,p_after_key:null}));
  });
  it("preserves forbidden vs missing vs database and malformed response errors",async()=>{
    rpc.mockResolvedValueOnce({data:null,error:{code:"42501"}}).mockResolvedValueOnce({data:null,error:null})
      .mockResolvedValueOnce({data:null,error:{code:"XX000"}}).mockResolvedValueOnce({data:{items:[]},error:null});
    await expect(getStudentWrongWordPage(student,{filters})).rejects.toBeInstanceOf(WrongWordPageForbiddenError);
    expect(await getStudentWrongWordPage(student,{filters})).toBeNull();
    await expect(getStudentWrongWordPage(student,{filters})).rejects.toThrow("불러오지 못했습니다");
    await expect(getStudentWrongWordPage(student,{filters})).rejects.toThrow();
  });
});
