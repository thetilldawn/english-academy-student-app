import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const request=vi.hoisted(()=>vi.fn());
vi.mock("../../api/local-quiz",()=>({requestLocalQuiz:request}));
import {anchorLocalQuizClock} from "./local-quiz-clock-anchor";
import {localFixture} from "../../test-support/local-quiz-fixtures";
beforeEach(()=>{vi.useFakeTimers({toFake:["performance"]});vi.clearAllMocks();});
afterEach(()=>vi.useRealTimers());
describe("시작 전에 시험 시각 확인",()=>{
  it("빠른 응답은 추가 조회 없이 왕복 시간을 보수적으로 포함한다",async()=>{
    const {plan}=await localFixture();plan.serverNow=plan.startedAt;
    expect((await anchorLocalQuizClock(plan,performance.now()-120,"c".repeat(64),new AbortController().signal)).elapsed).toBe(120);expect(request).not.toHaveBeenCalled();
  });
  it("느린 시작은 새로 시작하지 않고 같은 계획의 시각만 다시 읽는다",async()=>{
    const {plan}=await localFixture();request.mockResolvedValue({...plan,serverNow:new Date(Date.parse(plan.startedAt)+2000).toISOString()});
    const result=await anchorLocalQuizClock(plan,performance.now()-1200,"c".repeat(64),new AbortController().signal);
    expect(result.elapsed).toBe(2000);expect(request).toHaveBeenCalledTimes(1);expect(request.mock.calls[0][0]).toMatchObject({action:"read",attemptId:plan.attemptId,phase:"initial"});
  });
  it("재확인에서 시작 시각이나 계획이 바뀌면 풀이를 열지 않는다",async()=>{
    const {plan}=await localFixture();request.mockResolvedValue({...plan,planHash:"f".repeat(64)});
    await expect(anchorLocalQuizClock(plan,performance.now()-1200,"c".repeat(64),new AbortController().signal)).rejects.toThrow("local_plan_conflict");
  });
});
