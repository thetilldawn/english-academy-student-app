import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";
const m=vi.hoisted(()=>({session:vi.fn(),command:vi.fn(),protocol:vi.fn()}));
vi.mock("@/lib/auth/student-session",()=>({getStudentSession:m.session}));
vi.mock("./local-quiz-service",()=>({handleLocalQuizCommand:m.command,LocalQuizError:class extends Error{constructor(readonly code:string,readonly status:number,message:string){super(message);}}}));
vi.mock("./local-quiz-protocol-query",()=>({usesLocalQuiz:m.protocol}));
import {handleLocalQuizRequest,handleLocalQuizProtocolRequest} from "./local-quiz-http";
import {LocalQuizError} from "./local-quiz-service";
const student="a5050000-0000-4000-8000-000000000001";
const req=(body:unknown,origin="https://app.test")=>new Request("https://app.test/api/student/local-quiz",{method:"POST",headers:{Origin:origin,"Content-Type":"application/json"},body:JSON.stringify(body)});
beforeEach(()=>{vi.resetAllMocks();vi.stubEnv("APP_ORIGIN","https://app.test");m.session.mockResolvedValue({studentId:student});m.command.mockResolvedValue({studentId:student});});
afterEach(()=>vi.unstubAllEnvs());
describe("기기 시험 HTTP 경계",()=>{
  it("다른 출처는 인증 조회 전 거절하고 클라이언트 학생ID를 받지 않는다",async()=>{
    expect((await handleLocalQuizRequest(req({action:"identity"},"https://other.test"))).status).toBe(403);expect(m.session).not.toHaveBeenCalled();
    expect((await handleLocalQuizRequest(req({action:"identity",studentId:student}))).status).toBe(400);expect(m.command).not.toHaveBeenCalled();
  });
  it("현재 세션의 학생만 전달하고 모든 개인 응답은 공유 저장을 금지한다",async()=>{
    const result=await handleLocalQuizRequest(req({action:"identity"}));expect(result.status).toBe(200);expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(m.command).toHaveBeenCalledExactlyOnceWith(student,{action:"identity"});
  });
  it("인증 만료와 인증 확인 장애를 구분한다",async()=>{
    m.session.mockResolvedValueOnce(null).mockRejectedValueOnce(new AuthenticationUnavailableError());
    expect((await handleLocalQuizRequest(req({action:"identity"}))).status).toBe(401);
    const unavailable=await handleLocalQuizRequest(req({action:"identity"}));expect(unavailable.status).toBe(503);expect(unavailable.headers.get("Cache-Control")).toContain("no-store");expect(m.command).not.toHaveBeenCalled();
  });
  it("접수 충돌은 복구 안내를 주고 내부 오류를 노출하지 않는다",async()=>{
    m.command.mockRejectedValueOnce(new LocalQuizError("local_quiz_submission_conflict",409,"저장한 답을 확인해 주세요.")).mockRejectedValueOnce(new Error("private DB secret"));
    const conflict=await handleLocalQuizRequest(req({action:"identity"}));expect(conflict.status).toBe(409);expect(await conflict.json()).toMatchObject({code:"local_quiz_submission_conflict"});
    const unavailable=await handleLocalQuizRequest(req({action:"identity"}));expect(unavailable.status).toBe(503);expect(await unavailable.text()).not.toContain("secret");
  });
  it("시험 규격 조회도 본인 인증과 ID 검증을 거친다",async()=>{
    const request=new Request("https://app.test/api/student/local-quiz-protocol/"+student);m.protocol.mockResolvedValue(true);
    const ok=await handleLocalQuizProtocolRequest(request,{params:Promise.resolve({id:student})});expect(await ok.json()).toEqual({local:true});expect(ok.headers.get("Cache-Control")).toContain("no-store");expect(m.protocol).toHaveBeenCalledWith(student,student);
    expect((await handleLocalQuizProtocolRequest(request,{params:Promise.resolve({id:"invalid"})})).status).toBe(404);
  });
});
