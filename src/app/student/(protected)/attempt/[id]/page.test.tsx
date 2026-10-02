import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks=vi.hoisted(()=>({session:vi.fn(),protocol:vi.fn(),attempt:vi.fn(),prepare:vi.fn(),retry:vi.fn(),resume:vi.fn(),legacy:vi.fn()}));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/auth/student-session",()=>({requireStudentSession:mocks.session}));
vi.mock("@/lib/services/quiz/attempt-query",()=>({getStudentAttempt:mocks.attempt}));
vi.mock("@/features/quiz-player/public-server",()=>({usesLocalQuiz:mocks.protocol,getQuizPreparation:mocks.prepare,getRetryPreparation:mocks.retry,QuizPreparationChangedError:class extends Error{}}));
vi.mock("@/features/quiz-player/public-local-client",()=>({LocalQuizResume:mocks.resume}));
vi.mock("@/features/quiz-player/ui/quiz-player",()=>({QuizPlayer:mocks.legacy}));
vi.mock("@/features/quiz-player/ui/prepared-quiz-player",()=>({PreparedQuizPlayer:vi.fn()}));
import AttemptPage from "./page";

async function content(prepare?:string){
  const tree=AttemptPage({params:Promise.resolve({id:"fake-attempt"}),searchParams:Promise.resolve({prepare})});
  const child=tree.props.children;
  return (child.type as (props:typeof child.props)=>Promise<ReactElement>)(child.props);
}
beforeEach(()=>{vi.clearAllMocks();mocks.session.mockResolvedValue({studentId:"fake-student"});});
describe("신규 시험의 원기기 재개 연결",()=>{
  it.each([undefined,"retry"])("%s 규격은 구형 응시/문항 조회 전에 기기 복원으로 연결한다",async prepare=>{
    mocks.protocol.mockResolvedValue(true);
    const result=await content(prepare);
    expect(mocks.protocol).toHaveBeenCalledWith("fake-student","fake-attempt");
    expect(result.type).toBe(mocks.resume);
    expect(result.props).toEqual({studentId:"fake-student",attemptId:"fake-attempt",retry:prepare==="retry"});
    expect(mocks.attempt).not.toHaveBeenCalled();expect(mocks.prepare).not.toHaveBeenCalled();expect(mocks.retry).not.toHaveBeenCalled();
  });
  it("구형 응시는 기존 조회와 진행 화면을 유지한다",async()=>{
    mocks.protocol.mockResolvedValue(false);
    const attempt={id:"fake-attempt",status:"in_progress",phase:"initial",timerDeadlineAt:null};
    mocks.attempt.mockResolvedValue(attempt);
    const result=await content();
    expect(result.type).toBe(mocks.legacy);expect(result.props).toMatchObject({initialAttempt:attempt});
  });
  it("인증 실패에는 시험 규격과 자료를 읽지 않는다",async()=>{
    mocks.session.mockRejectedValueOnce(new Error("LOGIN_REDIRECT"));
    await expect(content()).rejects.toThrow("LOGIN_REDIRECT");
    expect(mocks.protocol).not.toHaveBeenCalled();expect(mocks.attempt).not.toHaveBeenCalled();
  });
});
