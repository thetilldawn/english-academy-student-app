import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks=vi.hoisted(()=>({session:vi.fn(),expire:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:mocks.session}));
vi.mock("@/lib/services/quiz/attempt-command",()=>({expireStudentAttempt:mocks.expire}));
import { POST } from "./route";
import { quizExpirationError } from "@/features/quiz-player/server/quiz-command-error";
const id="91000000-0000-4000-8000-000000000001";
const request=(origin="https://example.test")=>new Request(`https://example.test/api/student/attempts/${id}/expire`,{method:"POST",headers:{origin}});
const context={params:Promise.resolve({id})};
beforeEach(()=>{vi.resetAllMocks();mocks.session.mockResolvedValue({studentId:"self"});mocks.expire.mockResolvedValue(undefined);});
describe("시험 종료 HTTP",()=>{
  it("인증된 학생의 종료 성공만 확정하며 개인 캐시를 막는다",async()=>{
    const response=await POST(request(),context);
    expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ok:true});expect(mocks.expire).toHaveBeenCalledExactlyOnceWith("self",id);
  });
  it.each([["57014",503,true,"not_applied"],["42501",403,false,"not_applied"],["XXXXX",503,false,"unknown"]])("DB %s의 확인 결과와 재시도 권한을 보존한다",async(code,status,retryable,outcome)=>{
    mocks.expire.mockRejectedValue(quizExpirationError({code:String(code),message:"private detail"}));
    const response=await POST(request(),context),body=await response.json();
    expect(response.status).toBe(status);expect(body).toMatchObject({retryable,outcome});
    expect(JSON.stringify(body)).not.toContain("private detail");
  });
  it("시간 제한이 없는 검토 단계는 재시도 가능한 DB 장애로 바꾸지 않는다",async()=>{
    mocks.expire.mockRejectedValue(quizExpirationError({code:"22023",message:"attempt_review_not_timed"}));
    const response=await POST(request(),context);expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({retryable:false,outcome:"not_applied"});
  });
  it("다른 출처·미인증·잘못된 응시 ID는 종료 명령 전에 거절한다",async()=>{
    expect((await POST(request("https://other.invalid"),context)).status).toBe(403);
    mocks.session.mockResolvedValueOnce(null);expect((await POST(request(),context)).status).toBe(401);
    expect((await POST(request(),{params:Promise.resolve({id:"invalid"})})).status).toBe(400);
    expect(mocks.expire).not.toHaveBeenCalled();
  });
});
