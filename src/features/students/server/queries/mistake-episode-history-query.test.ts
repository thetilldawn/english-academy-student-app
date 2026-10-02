import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),admin:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:mocks.session}));
vi.mock("@/lib/auth/admin",()=>({requireAdmin:mocks.admin}));
vi.mock("@/lib/supabase/service",()=>({getServiceSupabaseClient:()=>({rpc:mocks.rpc})}));
vi.mock("@/lib/supabase/server",()=>({createServerSupabaseClient:async()=>({rpc:mocks.rpc})}));
import { getAdminMistakeEpisodeHistory, getOwnMistakeEpisodeHistory } from "./mistake-episode-history-query";
const id=(n:number)=>`a3030000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const input={meaningKey:"a".repeat(64),upperVersion:"9007199254740993"};
const items=Array.from({length:20},(_,n)=>({episodeId:id(n+10),openedAt:"2026-10-02T00:00:00.123456Z",resolvedAt:null,wrongCount:1,missedCount:0,includesLegacy:false}));
const cursor={schemaVersion:"vocabulary-mistake-episode-cursor-v1",studentId:id(1),meaningKey:input.meaningKey,stateVersion:input.upperVersion,
  lastSequence:"9007199254740992",openedAt:items[19].openedAt,episodeId:items[19].episodeId};
const raw={meaningKey:input.meaningKey,stateVersion:input.upperVersion,episodeCount:21,items,nextCursor:cursor};
const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({studentId:id(1)});mocks.rpc.mockResolvedValue({data:raw,error:null});});
describe("뜻별 지난 이력 서버 경계",()=>{
  it("본인만 조회하고 큰 순번·마이크로초·20번째 커서를 정확히 보존한다",async()=>{
    const page=await getOwnMistakeEpisodeHistory(input);
    expect(page).toEqual({...raw,nextCursor:encode(cursor)});
    expect(page?.items[0]).not.toHaveProperty("studentId");
    await getOwnMistakeEpisodeHistory({...input,cursor:page!.nextCursor!});
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_student_vocabulary_mistake_episodes_v1",{p_student_id:id(1),p_meaning_key:input.meaningKey,p_upper:input.upperVersion,p_cursor:cursor});
    await getAdminMistakeEpisodeHistory(id(1),input);expect(mocks.admin).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenLastCalledWith("get_admin_vocabulary_mistake_episodes_v1",expect.objectContaining({p_student_id:id(1)}));
  });
  it("학생·뜻·상한 바꿔치기와 비정상 커서는 DB에 보내지 않는다",async()=>{
    for(const invalid of [{...cursor,studentId:id(2)},{...cursor,meaningKey:"b".repeat(64)},{...cursor,stateVersion:"9007199254740994"}])
      await expect(getOwnMistakeEpisodeHistory({...input,cursor:encode(invalid)})).rejects.toMatchObject({reason:"changed"});
    for(const invalid of [{...cursor,lastSequence:"9223372036854775808"},{...cursor,extra:true},{...cursor,openedAt:null}])
      await expect(getOwnMistakeEpisodeHistory({...input,cursor:encode(invalid)})).rejects.toMatchObject({reason:"invalid"});
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("DB가 다른 뜻·상한·커서·중복행을 반환하면 정상 목록으로 쓰지 않는다",async()=>{
    for(const data of [{...raw,meaningKey:"b".repeat(64)},{...raw,stateVersion:"0"},{...raw,nextCursor:{...cursor,studentId:id(2)}},
      {...raw,nextCursor:{...cursor,episodeId:id(100)}},{...raw,items:[items[0],items[0]]}]) {
      mocks.rpc.mockResolvedValueOnce({data,error:null});await expect(getOwnMistakeEpisodeHistory(input)).rejects.toMatchObject({reason:"unavailable"});
    }
  });
  it("조회 없음·권한 거절·장애를 구별한다",async()=>{
    mocks.session.mockResolvedValueOnce(null);await expect(getOwnMistakeEpisodeHistory(input)).rejects.toMatchObject({reason:"unauthenticated"});
    mocks.rpc.mockResolvedValueOnce({data:null,error:null});expect(await getOwnMistakeEpisodeHistory(input)).toBeNull();
    for(const [code,message,reason] of [["42501","forbidden","forbidden"],["40001","wrong_history_changed","changed"],["PT409","wrong_history_changed","changed"],["57014","timeout","unavailable"]]) {
      mocks.rpc.mockResolvedValueOnce({data:null,error:{code,message}});await expect(getOwnMistakeEpisodeHistory(input)).rejects.toMatchObject({reason});
    }
  });
});
