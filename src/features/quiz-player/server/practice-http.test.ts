import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), get: vi.fn(), history: vi.fn(), preview: vi.fn(), start: vi.fn(), rpc: vi.fn(), ready: vi.fn() }));
vi.mock("@/lib/auth/student-session", () => ({ getStudentSession: mocks.session }));
vi.mock("./practice-service", async () => ({ ...await vi.importActual("./practice-rpc"), getPractice: mocks.get,
  getPracticeHistory: mocks.history, previewPractice: mocks.preview, startPractice: mocks.start, practiceRpc: mocks.rpc }));
import { handlePracticeRequest } from "./practice-http";
import { PracticeError } from "./practice-rpc";
vi.mock("./attempt-preparation",()=>({beginQuizPreparation:mocks.ready,QuizPreparationChangedError:class extends Error{}}));
import { QuizPreparationChangedError } from "./attempt-preparation";
import { AuthenticationUnavailableError } from "@/lib/auth/authentication-error";
const id = "00000000-0000-4000-8000-000000000001";
const input = { requestKey: id, selection: { mode: "selected", keys: ["word:a"] }, settings: { questionCount: 1, englishToKoreanRatio: 100,
  timingMode: "none", timeLimitSeconds: null, questionTimeLimitSeconds: null } };
const request = (method: string, body?: unknown, path = "/api/student/practice", origin = "https://app.test") => new Request(`https://app.test${path}`, {
  method, headers: { origin, "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const context = (command?: string) => ({ params: Promise.resolve(command ? { id, command } : {}) });
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("APP_ORIGIN", "https://app.test"); mocks.session.mockResolvedValue({ studentId: id }); });
afterEach(() => vi.unstubAllEnvs());

describe("학생 자율연습 HTTP 경계", () => {
  it("준비 완료는 세션 학생만 사용하고 확정 변경409와 장애503을 구분한다",async()=>{
    mocks.ready.mockResolvedValueOnce({id}).mockRejectedValueOnce(new QuizPreparationChangedError("목록에서 다시 시작"))
      .mockRejectedValueOnce(new Error("private internal failure"));
    const ready=()=>handlePracticeRequest(request("POST",{kind:"practice"}),context("ready"));
    expect((await ready()).status).toBe(200);
    expect(mocks.ready).toHaveBeenCalledWith(id,id,"practice");
    const changed=await ready();expect(changed.status).toBe(409);expect(await changed.json()).toMatchObject({code:"preparation_changed"});
    const failed=await ready();expect(failed.status).toBe(503);expect(await failed.text()).not.toContain("internal");
    expect(failed.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await handlePracticeRequest(request("POST",{kind:"practice",studentId:id}),context("ready"))).status).toBe(400);
  });
  it("쓰기 다른 출처는 인증/DB 읽기도 하지 않는다", async () => {
    expect((await handlePracticeRequest(request("POST", input, undefined, "https://other.test"), context(), "preview")).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });
  it("인증 거절401과 인증 확인 장애503은 구분한다", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await handlePracticeRequest(request("GET"), context())).status).toBe(401);
    mocks.session.mockRejectedValueOnce(new AuthenticationUnavailableError());
    const result = await handlePracticeRequest(request("GET"), context());
    expect(result.status).toBe(503); expect(result.headers.get("Cache-Control")).toContain("no-store");
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it("미리보기는 세션의 학생만 쓰고 학생ID·정답·초과문항은 거절한다", async () => {
    mocks.preview.mockResolvedValue({ confirmation: "a".repeat(64) });
    const result = await handlePracticeRequest(request("POST", input), context(), "preview");
    expect(result.status).toBe(200); expect(result.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.preview).toHaveBeenCalledWith(id, input);
    for (const bad of [{ ...input, studentId: id }, { ...input, questions: [] }, { ...input, settings: { ...input.settings, questionCount: 501 } }])
      expect((await handlePracticeRequest(request("POST", bad), context(), "preview")).status).toBe(400);
    expect(mocks.preview).toHaveBeenCalledTimes(1);
  });
  it.each(["answers", "timeouts", "feedback", "expire"])("%s는 연습 전용 RPC와 세션 ID만 전달한다", async command => {
    mocks.rpc.mockResolvedValue({ ok: true });
    const body = command === "answers" ? { questionId: id, phase: "initial", choiceIndex: 2 } : command === "timeouts" ? { questionId: id, phase: "initial" } : command === "feedback" ? { nextQuestionId: id, nextPhase: "initial", transitionRemainingMilliseconds: 750 } : {};
    expect((await handlePracticeRequest(request("POST", body), context(command))).status).toBe(200);
    expect(mocks.rpc.mock.calls[0][0]).toMatch(/^(answer|resume|expire)_student_word_practice_v1$/);
    expect(mocks.rpc.mock.calls[0][1]).toMatchObject({ p_student_id: id, p_run_id: id });
  });
  it("재풀이 단계·타학생 값·751ms·모호한 조회 조건을 거절한다", async () => {
    for (const [command, body] of [["answers", { questionId: id, phase: "retry", choiceIndex: 0 }], ["timeouts", { questionId: id, phase: "initial", studentId: id }], ["feedback", { nextQuestionId: id, nextPhase: "initial", transitionRemainingMilliseconds: 751 }]] as const)
      expect((await handlePracticeRequest(request("POST", body), context(command))).status).toBe(400);
    expect((await handlePracticeRequest(request("GET", undefined, "/api/student/practice?cursor=a&cursor=b"), context())).status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("없음404/원천변경409/장애503 모두 개인정보 캐시를 금지한다", async () => {
    mocks.get.mockResolvedValueOnce(null);
    const result = await handlePracticeRequest(request("GET"), { params: Promise.resolve({ id }) });
    expect(result.status).toBe(404);
    mocks.start.mockRejectedValueOnce(new PracticeError(409, "다시 확인", "source_changed")).mockRejectedValueOnce(new Error("network"));
    const conflict = await handlePracticeRequest(request("POST", { ...input, confirmation: "a".repeat(64) }), context());
    expect(conflict.status).toBe(409); expect(await conflict.json()).toMatchObject({ code: "source_changed" });
    const unknown = await handlePracticeRequest(request("POST", { ...input, confirmation: "a".repeat(64) }), context());
    expect(unknown.status).toBe(503);
    for (const response of [result, conflict, unknown]) expect(response.headers.get("Cache-Control")).toContain("no-store");
  });
});
