// @vitest-environment jsdom
import { webcrypto } from "node:crypto";
import { StrictMode, type PropsWithChildren } from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useLocalQuizPlayerController } from "./use-local-quiz-player-controller";
import type { LocalQuizRun } from "../../contracts/local-quiz";
import { localFixture, localId, receiptFor } from "../../test-support/local-quiz-fixtures";
import { recordLocalAnswer } from "../../domain/local-quiz";
import { LocalQuizClientError } from "../../api/local-quiz";
import { studentAppText } from "@/content/ko/student-app";

const m = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn(), lock: vi.fn(), contents: vi.fn(), screen: vi.fn(), request: vi.fn(), announce: vi.fn(),
  identity: "original", changed: null as ((kind: "identity") => void) | null }));
vi.mock("@/features/session/public-client", () => ({ studentIdentityGeneration: () => m.identity, announceStudentPrivateCacheChange: m.announce,
  subscribeStudentPrivateCacheChanges: (f: typeof m.changed) => { m.changed = f; return () => { m.changed = null; }; } }));
vi.mock("../flows/local-quiz-store", () => ({ getLocalQuizRun: m.read, saveLocalQuizRun: m.save, holdLocalQuizTab: m.lock, readLocalQuizContents: m.contents }));
vi.mock("../flows/local-quiz-screen", () => ({ prepareLocalQuizScreen: m.screen, holdLocalQuizScreen: async () => () => {} }));
vi.mock("../../api/local-quiz", async original => ({ ...await original<typeof import("../../api/local-quiz")>(), requestLocalQuiz: m.request }));

let durable: LocalQuizRun;
async function settle() { await act(async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); }); }
async function advance(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
function deferred() { let resolve!: () => void; let reject!: (e: Error) => void; const promise = new Promise<void>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function mount(strict = false) {
  const hook = renderHook(() => useLocalQuizPlayerController(durable.key, false), strict ? { reactStrictMode: true, wrapper: ({ children }: PropsWithChildren) => <StrictMode>{children}</StrictMode> } : {});
  await settle(); return hook;
}
beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.setSystemTime(new Date("2026-10-02T00:00:00Z")); vi.stubGlobal("crypto", webcrypto);
  vi.clearAllMocks(); m.identity = "original";
  const fixture = await localFixture(); durable = fixture.run;
  m.read.mockImplementation(async () => structuredClone(durable)); m.contents.mockResolvedValue(fixture.contents);
  m.screen.mockResolvedValue(undefined); m.lock.mockResolvedValue(vi.fn());
  m.save.mockImplementation(async (next: LocalQuizRun, revision: number) => {
    if (durable.revision !== revision) throw new Error("local_run_conflict"); durable = structuredClone(next);
  });
  m.request.mockImplementation(async () => { throw new Error("unexpected HTTP"); });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("기기에서 진행하는 시험", () => {
  it("새 시작 중지는 원래 준비를 보관하고 점검 후 같은 시작을 재시도한다",async()=>{
    durable.plan=null;const before=structuredClone(durable);
    m.request.mockRejectedValueOnce(new LocalQuizClientError(studentAppText.dashboard.release.newAttemptsPaused,503,'quiz_new_attempts_paused'));
    const h=await mount();expect(h.result.current.view).toBe('failed');expect(h.result.current.error).toContain('점검 중');
    expect(durable.preparation).toEqual(before.preparation);expect(durable.answers).toEqual(before.answers);expect(durable.plan).toBeNull();
    m.request.mockResolvedValue((await localFixture()).plan);
    await act(async()=>{await h.result.current.recover();});await settle();
    expect(h.result.current.view).toBe('playing');expect(m.request).toHaveBeenCalledTimes(2);
    expect(m.request.mock.calls[1][0]).toEqual(m.request.mock.calls[0][0]);
  });
  it("답 저장 거래가 끝나기 전에는 채점·다음 문제·HTTP가 없다", async () => {
    const pending = deferred(); m.save.mockImplementationOnce(async (next: LocalQuizRun) => { await pending.promise; durable = structuredClone(next); });
    const h = await mount(); expect(h.result.current.view).toBe("playing");
    act(() => h.result.current.choose(0)); await advance(20);
    expect(h.result.current.pendingChoice).toBe(0); expect(h.result.current.run?.answers).toHaveLength(0); expect(h.result.current.feedback).toBeNull();
    expect(m.request).not.toHaveBeenCalled();
    await act(async () => pending.resolve()); await settle();
    expect(h.result.current.run?.answers).toHaveLength(1); expect(h.result.current.feedback).toMatchObject({ index: 0, correct: true });
    await advance(249); expect(h.result.current.feedback).not.toBeNull(); await advance(1); expect(h.result.current.feedback).toBeNull(); expect(m.request).not.toHaveBeenCalled();
    window.dispatchEvent(new Event("online")); await settle(); expect(m.request).not.toHaveBeenCalled();
  });
  it("용량 부족 뒤 선택을 보존하고 재저장이 확정된 다음에만 채점한다", async () => {
    m.save.mockRejectedValueOnce(new DOMException("full", "QuotaExceededError"));
    const h = await mount(); act(() => h.result.current.choose(0)); await advance(20);
    expect(h.result.current.view).toBe("failed"); expect(h.result.current.pendingChoice).toBe(0); expect(h.result.current.run?.answers).toHaveLength(0);
    await act(async () => h.result.current.recover());
    expect(h.result.current.feedback).toMatchObject({ index: 0, correct: true }); expect(durable.answers).toHaveLength(1);
    await advance(250); expect(h.result.current.view).toBe("playing"); expect(h.result.current.feedback).toBeNull(); expect(m.request).not.toHaveBeenCalled();
  });
  it("정상 진행은 통신하지 않고 마지막 답의 고정 묶음만 한 번 제출한다", async () => {
    m.request.mockImplementation(async input => receiptFor(input.batch)); const h = await mount();
    for (let i = 0; i < 3; i++) {
      act(() => h.result.current.choose(i)); await advance(20);
      if (i < 2) expect(m.request).not.toHaveBeenCalled(); await advance(250);
    }
    // WebCrypto resolves on the real task queue, independent from fake timers.
    for (let i = 0; i < 20 && h.result.current.view !== "confirmed"; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(m.request).toHaveBeenCalledTimes(1); expect(m.request.mock.calls[0][0].action).toBe("submit");
    expect(h.result.current.view).toBe("confirmed"); expect(durable.receipt?.accepted).toHaveLength(3);
    expect(m.announce).toHaveBeenCalledExactlyOnceWith("mistakes");
  });
  it("최종 제출 응답이 유실돼도 같은 ID와 같은 답만 재제출한다", async () => {
    const h = await mount(); m.request.mockRejectedValueOnce(new Error("lost"));
    for (let i = 0; i < 3; i++) { act(() => h.result.current.choose(i)); await advance(270); }
    expect(h.result.current.view).toBe("failed"); expect(durable.batch).not.toBeNull(); expect(durable.receipt).toBeNull();
    const first = structuredClone(m.request.mock.calls[0][0]); m.request.mockImplementation(async input => receiptFor(input.batch));
    await act(async () => h.result.current.recover()); expect(m.request.mock.calls[1][0]).toEqual(first);
    for (let i = 0; i < 20 && h.result.current.view === "sending"; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(durable.receipt?.submissionId).toBe(first.batch.submissionId); expect(h.result.current.view).toBe("confirmed");
  });
  it("접수 목록이 일부뿐이면 공식 완료로 표시하지 않는다", async () => {
    m.request.mockImplementation(async input => { const r = await receiptFor(input.batch); r.accepted = r.accepted.slice(1); return r; });
    const h = await mount(); for (let i = 0; i < 3; i++) { act(() => h.result.current.choose(i)); await advance(270); }
    for (let i = 0; i < 20 && h.result.current.view === "sending"; i++) await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
    expect(h.result.current.view).toBe("failed"); expect(durable.receipt).toBeNull(); expect(durable.batch?.answers).toHaveLength(3);
    expect(m.announce).not.toHaveBeenCalled();
  });
  it("저장 중 계정이 바뀌면 새 답이 보관되더라도 화면을 가리고 전송하지 않는다", async () => {
    const pending = deferred(); m.save.mockImplementationOnce(async next => { await pending.promise; durable = structuredClone(next); });
    const h = await mount(); act(() => h.result.current.choose(0)); await advance(20);
    act(() => { m.identity = "other"; m.changed?.("identity"); }); await act(async () => pending.resolve());
    expect(h.result.current.view).toBe("blocked"); expect(h.result.current.feedback).toBeNull(); expect(durable.answers).toHaveLength(1); expect(m.request).not.toHaveBeenCalled();
  });
  it("새로 열어도 기기의 마지막 답 다음에서 통신 없이 이어간다", async () => {
    const first = await mount(); act(() => first.result.current.choose(0)); await advance(270); first.unmount();
    await advance(200); const second = await mount();
    expect(second.result.current.view).toBe("playing"); expect(second.result.current.run?.answers).toHaveLength(1);
    expect(second.result.current.remaining).toBeLessThan(5000); expect(m.request).not.toHaveBeenCalled();
  });
  it("두 번째 탭은 문제 시작이나 답 변경 없이 중지한다", async () => {
    m.lock.mockRejectedValueOnce(new Error("local_quiz_another_tab")); const h = await mount();
    expect(h.result.current.view).toBe("failed"); expect(h.result.current.error).toContain("다른 탭"); expect(m.save).not.toHaveBeenCalled(); expect(m.request).not.toHaveBeenCalled();
  });
  it("정적 화면 준비 실패는 서버 시험 시작보다 먼저 차단한다", async () => {
    durable.plan = null; m.screen.mockRejectedValueOnce(new Error("missing chunk")); const h = await mount();
    expect(h.result.current.view).toBe("failed"); expect(m.request).not.toHaveBeenCalled(); expect(durable.startRequested).toBe(false);
  });
  it("StrictMode 재설치에서도 중단된 초기화가 시작 요청을 보내지 않는다", async () => {
    durable.plan = null; const plan = (await localFixture()).plan; m.request.mockResolvedValue(plan);
    const h = await mount(true); await settle(); expect(h.result.current.view).toBe("playing");
    expect(m.request).toHaveBeenCalledTimes(1); expect(m.request.mock.calls[0][0].action).toBe("begin");
  });
  it("재시험 시작 응답이 유실된 상태를 같은 재시험 시작 ID로 복구한다", async () => {
    for (let i = 0; i < 3; i++) durable = recordLocalAnswer(durable, 3, i * 300 + 50, Date.now(), localId(90));
    durable.receipt = await receiptFor(durable.batch!, false); durable.startRequested = true;
    const retryPlan = { ...durable.plan!, phase: "retry", officialPhase: "retry", planHash: "f".repeat(64) };
    m.request.mockResolvedValue(retryPlan); const h = await mount();
    expect(h.result.current.view).toBe("playing"); expect(h.result.current.run?.plan?.phase).toBe("retry"); expect(durable.answers).toHaveLength(0);
    expect(m.request).toHaveBeenCalledTimes(1); expect(m.request.mock.calls[0][0]).toMatchObject({ action: "retry", attemptId: localId(2) });
  });
  it("StrictMode의 늦은 첫 잠금은 완전히 해제한 뒤 두 번째 잠금을 얻는다", async () => {
    const acquisition = deferred(); const released = deferred(); let held = false;
    m.lock.mockImplementation(async () => {
      if (held) throw new Error("local_quiz_another_tab"); held = true;
      await acquisition.promise;
      return async () => { await released.promise; held = false; };
    });
    const h = await mount(true); expect(m.lock).toHaveBeenCalledTimes(1);
    await act(async () => acquisition.resolve()); await settle(); expect(m.lock).toHaveBeenCalledTimes(1);
    await act(async () => released.resolve()); await settle(); expect(m.lock).toHaveBeenCalledTimes(2); expect(h.result.current.view).toBe("playing");
  });
  it("재인증도 저장되지 못한 답을 먼저 보존한다", async () => {
    m.save.mockRejectedValueOnce(new DOMException("aborted", "AbortError")); const h = await mount();
    act(() => h.result.current.choose(0)); await advance(20); expect(durable.answers).toHaveLength(0);
    act(() => { m.identity = "reauthenticated"; m.changed?.("identity"); });
    m.request.mockResolvedValue({ studentId: durable.studentId });
    await act(async () => h.result.current.recover());
    expect(durable.answers).toHaveLength(1); expect(durable.identity).toBe("reauthenticated"); expect(m.request.mock.calls[0][0]).toEqual({ action: "identity" });
  });
  it("시간 확인 저장이 실패해도 재저장 뒤 실행 시계가 복원된다", async () => {
    durable.clock = { wallAt: Date.now() + 10000, elapsedAt: 6000 }; durable.plan!.questionLimitMs = null;
    const h = await mount(); expect(h.result.current.view).toBe("failed");
    m.request.mockResolvedValue({ ...durable.plan!, startedAt: new Date(Date.now() - 10000).toISOString() });
    m.save.mockRejectedValueOnce(new DOMException("aborted", "AbortError"));
    await act(async () => h.result.current.recover()); expect(h.result.current.error).not.toBe("");
    await act(async () => h.result.current.recover()); expect(h.result.current.view).toBe("playing");
    act(() => h.result.current.choose(0)); await advance(20);
    expect(durable.answers).toHaveLength(1); expect(durable.answers[0].elapsedMs).toBeGreaterThanOrEqual(10000); expect(m.request).toHaveBeenCalledTimes(1);
  });
  it("새로고침 뒤 남은 문항 전환 시간은 통신 없이 기다린다", async () => {
    durable = recordLocalAnswer(durable, 0, 50, Date.now(), localId(90));
    const h = await mount(); act(() => h.result.current.choose(1)); await advance(20);
    expect(durable.answers).toHaveLength(1); expect(h.result.current.view).toBe("playing"); expect(m.request).not.toHaveBeenCalled();
    await advance(250); act(() => h.result.current.choose(1)); await advance(20); expect(durable.answers).toHaveLength(2);
  });
});
