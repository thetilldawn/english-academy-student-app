// @vitest-environment jsdom
import { afterEach,beforeEach,describe,expect,it,vi } from "vitest";
import { resolveQuizFeedbackTransition } from "./resolve-quiz-feedback-transition";
const payload={correct:true,correctChoiceIndex:0,nextQuestionId:"q2",nextPhase:"initial" as const,questionDeadlineAt:"2099-01-01T00:00:05Z",timerRemainingMilliseconds:12000,feedbackProtocol:"variable" as const};
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
describe("250ms feedback readiness",()=>{
  it.each([0,249,250])("has no waiting state if the confirmed server reservation ends by %sms",async remaining=>{
    const resume=vi.fn().mockImplementation(async()=>({ok:true as const,payload:{questionStartsAt:"2099-01-01",questionDeadlineAt:payload.questionDeadlineAt,
      timerRemainingMilliseconds:5000+remaining,transitionRemainingMilliseconds:remaining},receivedAt:performance.now(),roundTripMilliseconds:0}));
    const result=resolveQuizFeedbackTransition({attemptId:"a",disposition:"next-question",isActive:()=>true,payload,receivedAt:performance.now(),resume});
    await vi.advanceTimersByTimeAsync(250);
    const value=await result;expect(value.ready).not.toBeNull();expect(value.ready?.payload.nextQuestionId).toBe("q2");
  });
  it("does not mistake a successful response for an elapsed reservation",async()=>{
    const resume=vi.fn().mockImplementation(async()=>{await new Promise(r=>setTimeout(r,20));return {ok:true as const,
      payload:{questionStartsAt:"2099",questionDeadlineAt:"2099",timerRemainingMilliseconds:5100,transitionRemainingMilliseconds:250},receivedAt:performance.now(),roundTripMilliseconds:20};});
    const pending=resolveQuizFeedbackTransition({attemptId:"a",disposition:"next-question",isActive:()=>true,payload,receivedAt:performance.now(),resume});
    await vi.advanceTimersByTimeAsync(250);const value=await pending;expect(value.ready).toBeNull();expect(value.quietReservation).toBe(true);
    let ready=false;void value.synchronization!.then(()=>{ready=true;});
    await vi.advanceTimersByTimeAsync(19);expect(ready).toBe(false);
    await vi.advanceTimersByTimeAsync(1);expect(ready).toBe(true);
  });
});

