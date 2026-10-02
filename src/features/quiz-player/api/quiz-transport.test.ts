/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({answer:vi.fn(),read:vi.fn(),expire:vi.fn(),feedback:vi.fn(),changed:vi.fn()}));
vi.mock("./quiz-attempt",()=>({submitQuizAnswer:mocks.answer,recoverQuizAttempt:mocks.read,expireQuizAttempt:mocks.expire,resumeQuizAfterFeedback:mocks.feedback}));
vi.mock("@/features/session/public-client",()=>({announceStudentPrivateCacheChange:mocks.changed}));
import { practiceQuizTransport, regularQuizTransport } from "./quiz-transport";
beforeEach(()=>vi.resetAllMocks());
describe("정규 시험과 개인 단어장 변경 신호",()=>{
  it("성공한 정규 답·종료·확정 복구만 목록을 갱신한다",async()=>{
    const answer={attemptId:"fake",questionId:"fake-question",phase:"initial" as const,choiceIndex:1};
    mocks.answer.mockResolvedValueOnce({ok:false}).mockResolvedValueOnce({ok:true});
    await regularQuizTransport.answer(answer);expect(mocks.changed).not.toHaveBeenCalled();
    await regularQuizTransport.answer(answer);expect(mocks.changed).toHaveBeenCalledOnce();
    mocks.expire.mockResolvedValue({ok:true});await regularQuizTransport.expire("fake");
    regularQuizTransport.studentStateConfirmed?.();expect(mocks.changed).toHaveBeenCalledTimes(3);
    expect(mocks.changed).toHaveBeenLastCalledWith("mistakes");
  });
  it("GET·타이머 예약과 자율연습은 정규 오답 변경 신호를 보내지 않는다",async()=>{
    mocks.answer.mockResolvedValue({ok:true});mocks.expire.mockResolvedValue({ok:true});
    await regularQuizTransport.read("fake");
    await practiceQuizTransport.answer({attemptId:"practice",questionId:"q",phase:"initial",choiceIndex:1});
    await practiceQuizTransport.expire("practice");practiceQuizTransport.studentStateConfirmed?.();
    expect(mocks.changed).not.toHaveBeenCalled();
  });
});
