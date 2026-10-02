import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ admin: vi.fn(), page: vi.fn(), mistakes: vi.fn(), queue: vi.fn() }));
vi.mock("@/lib/auth/admin", () => ({ getAdminContext: mocks.admin }));
vi.mock("@/lib/services/wrong-word-command", () => ({ queueStudentWrongWords: vi.fn(), WrongWordQueueError: class extends Error {} }));
vi.mock("@/features/students/server/queries/wrong-word-page-query", () => ({ getStudentWrongWordPage: mocks.page, WrongWordPageForbiddenError: class extends Error {} }));
vi.mock("@/features/students/server/queries/mistake-episode-query", async()=>({...await vi.importActual("@/features/students/server/queries/mistake-episode-query"),getAdminMistakePage:mocks.mistakes}));
vi.mock("@/features/students/server/commands/queue-mistakes", async()=>({...await vi.importActual("@/features/students/server/commands/queue-mistakes"),queueStudentMistakes:mocks.queue}));
import { GET, POST } from "./route";
import { MistakeReadError } from "@/features/students/server/queries/mistake-episode-query";
import { QueueMistakesError } from "@/features/students/server/commands/queue-mistakes";
const id = "00000000-0000-4000-8000-000000000001";
const context = { params: Promise.resolve({ id }) };
beforeEach(() => { vi.clearAllMocks(); mocks.admin.mockResolvedValue({ id: "admin" }); mocks.page.mockResolvedValue({ items: [], totalCount: 0 }); });
describe("관리자 오답 조회 확장", () => {
  it('뜻별 현재·과거 조회를 분리하고 바뀐 목록은409로 알린다',async()=>{
    mocks.mistakes.mockResolvedValueOnce({items:[],view:'current'}).mockRejectedValueOnce(new MistakeReadError('changed'));
    expect((await GET(new Request('https://example.test/?view=current&sort=count'),context)).status).toBe(200);
    expect(mocks.mistakes).toHaveBeenCalledWith(id,{filters:expect.objectContaining({view:'current',sort:'count'}),cursor:null},{id:'admin'});
    expect((await GET(new Request('https://example.test/?view=history'),context)).status).toBe(409);
    expect((await GET(new Request('https://example.test/?view=invalid'),context)).status).toBe(400);
    expect(mocks.page).not.toHaveBeenCalled();
  });
  it('뜻별 대기는 작은 참조를 전달하고 저장 충돌을503으로 바꾸지 않는다',async()=>{
    const targets=[{sourceQuestionId:id,sourcePhase:'retry',meaningKey:'a'.repeat(64),episodeId:id,stateVersion:'4'}];
    const request=()=>new Request('https://example.test/api/admin/students/'+id+'/wrong-words',{method:'POST',headers:{origin:'https://example.test','content-type':'application/json'},body:JSON.stringify({targets})});
    mocks.queue.mockResolvedValueOnce([id]).mockRejectedValueOnce(new QueueMistakesError(409));
    const saved=await POST(request(),context);expect(saved.status).toBe(200);expect(saved.headers.get('cache-control')).toBe('private, no-store');
    expect(mocks.queue).toHaveBeenCalledWith(id,targets,{id:'admin'});
    expect((await POST(request(),context)).status).toBe(409);
  });
  it("정확횟수범위를기존관리자인증경계로전달한다", async () => {
    const response = await GET(new Request("https://example.test/api/admin/students/" + id + "/wrong-words?minWrongCount=3&maxWrongCount=3"), context);
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.page).toHaveBeenCalledWith(id, { filters: { datasetId: "", level: "all", query: "", minWrongCount: 3, maxWrongCount: 3 }, cursor: null }, { id: "admin" });
  });
  it("기존학생권한개방없고 잘못된 숫자를거절한다", async () => {
    mocks.admin.mockResolvedValueOnce(null);
    expect((await GET(new Request("https://example.test/?minWrongCount=3"), context)).status).toBe(401);
    expect((await GET(new Request("https://example.test/?minWrongCount=0"), context)).status).toBe(400);
    expect(mocks.page).not.toHaveBeenCalled();
  });
});

