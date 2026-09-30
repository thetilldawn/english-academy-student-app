import { afterEach, describe, expect, it, vi } from "vitest";
import { practiceQuizTransport, regularQuizTransport } from "./quiz-transport";
import { PracticeRequestError, requestPracticePreview, requestPracticeStart } from "./practice-transport";
import type { PracticeInput } from "../contracts/practice";
const input:PracticeInput={requestKey:"00000000-0000-4000-8000-000000000001",selection:{mode:"selected",keys:["dictionary:collect"]},settings:{questionCount:1,englishToKoreanRatio:100,timingMode:"none",timeLimitSeconds:null,questionTimeLimitSeconds:null}};
afterEach(()=>{vi.unstubAllGlobals();});
describe("연습 전송 경계",()=>{
  it("답·시간초과·읽기·전환·만료·결과 전부 별도 경로이며 기본 시험은 보존한다",async()=>{
    const fetcher=vi.fn().mockImplementation(()=>Promise.resolve(Response.json({error:"test"},{status:409})));vi.stubGlobal("fetch",fetcher);
    await practiceQuizTransport.answer({attemptId:"a",questionId:"q",phase:"initial",choiceIndex:1});
    await practiceQuizTransport.answer({attemptId:"a",questionId:"q",phase:"initial",choiceIndex:null});
    await practiceQuizTransport.read("a");await practiceQuizTransport.feedback({attemptId:"a",nextPhase:"initial",nextQuestionId:"q",transitionRemainingMilliseconds:0});await practiceQuizTransport.expire("a");
    expect(fetcher.mock.calls.map(call=>call[0])).toEqual(["/api/student/practice/a/answers","/api/student/practice/a/timeouts","/api/student/practice/a","/api/student/practice/a/feedback","/api/student/practice/a/expire"]);
    expect(practiceQuizTransport.resultHref("a")).toBe("/student/practice/a/result");
    await regularQuizTransport.read("a");expect(fetcher.mock.lastCall?.[0]).toBe("/api/student/attempts/a");expect(regularQuizTransport.resultHref("a")).toBe("/student/result/a");
  });
  it("미리보기 성공은 문항 정답을 받지 않고 시작 재전송의 요청키를 유지한다",async()=>{
    const fetcher=vi.fn().mockResolvedValue(Response.json({confirmation:"a".repeat(64),availableCount:1,totalCount:1,words:[],excluded:[],error:null}));vi.stubGlobal("fetch",fetcher);
    expect((await requestPracticePreview(input)).confirmation).toBe("a".repeat(64));
    fetcher.mockImplementation(()=>Promise.resolve(Response.json({error:"연결 오류"},{status:503})));
    const start={...input,confirmation:"a".repeat(64)};
    await expect(requestPracticeStart(start)).rejects.toBeInstanceOf(PracticeRequestError);
    await expect(requestPracticeStart(start)).rejects.toMatchObject({status:503});
    expect(fetcher.mock.calls[1][1].body).toBe(fetcher.mock.calls[2][1].body);
  });
  it("원천 변경만 식별 가능한 코드로 전달하고 중단 요청을 연결한다",async()=>{
    vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"다시 확인",code:"source_changed"},{status:409})));
    await expect(requestPracticeStart({...input,confirmation:"a".repeat(64)})).rejects.toMatchObject({status:409,code:"source_changed"});
    const controller=new AbortController();controller.abort();
    await expect(requestPracticePreview(input,controller.signal)).rejects.toThrow();
  });
});
