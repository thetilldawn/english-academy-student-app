import fs from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { fixtureResponse, DATA_ORIGIN, uid } from "../../scripts/local-admin-baseline-data.mjs";
import { STUDY_SECRET } from "../../scripts/local-student-study-data.mjs";
import { isLocalQuizRequest, localQuizCases, localQuizSummary, localQuizWave, resetLocalQuizzes } from "../../scripts/local-quiz-feedback-data.mjs";
import { parseTargetPronunciation, parseChoicePronunciations } from "../lib/quiz/pronunciation-snapshot";

const request = (path, options = {}) => fixtureResponse({ url: DATA_ORIGIN + "/rest/v1/" + path,
  method: "GET", headers: new Headers({ apikey: STUDY_SECRET, authorization: "Bearer " + STUDY_SECRET }), quizFeedback: true, ...options });
const rpc = (name, input, options = {}) => request("rpc/" + name, { method: "POST", body: JSON.stringify(input), ...options });
const answer = { p_student_id: uid(1), p_attempt_id: uid(201), p_question_id: uid(2010),
  p_phase: "initial", p_choice_index: 0, p_force_timeout: false };
beforeEach(resetLocalQuizzes);
describe("격리된 실제 플레이어 검사 자료", () => {
  it("준비 자료 조회는 시각을 시작하지 않고 ready는 같은 시각을 반환한다",()=>{
    const input={p_student_id:uid(1),p_preparation_id:uid(207)};
    expect(rpc("get_quiz_preparation_v1",input).body.kind).toBe("initial");
    expect(localQuizSummary()[0].startedAt).toBeNull();
    expect(rpc("begin_prepared_quiz_v1",{...input,p_student_id:uid(2)}).status).toBe(403);
    expect(rpc("begin_prepared_quiz_v1",input).body).toBe(uid(207));
    const started=localQuizSummary()[0].startedAt;
    rpc("begin_prepared_quiz_v1",input);expect(localQuizSummary()[0].startedAt).toBe(started);
  });
  it("기본 읽기 전용 모드에서는 시험 저장을 열지 않는다", () => {
    expect(rpc("answer_quiz_question_v4", answer, { quizFeedback: false }).status).toBe(403);
    expect(localQuizSummary()).toEqual([]);
  });
  it("참조 본문은 준비와 응시 권한을 구분하고 다른 학생과 문항을 거절한다", () => {
    const input = { p_actor_id: uid(1), p_context: "student_preparation", p_context_id: uid(207), p_question_ids: [uid(2070)] };
    const prepared = rpc("read_question_contents_v1", input);
    expect(prepared.status).toBe(200);
    expect(prepared.body.items[0].assignment_question.headword_snapshot).toBe("collect");
    expect(prepared.body.items[0]).not.toHaveProperty("correct_choice_index");
    for (const change of [{ p_actor_id: uid(2) }, { p_question_ids: [uid(999)] }, { p_question_ids: [uid(2070), uid(2070)] }, { p_context: "student_attempt" }]) {
      expect(rpc("read_question_contents_v1", { ...input, ...change }).status).toBe(403);
    }
    rpc("begin_prepared_quiz_v1", { p_student_id: uid(1), p_preparation_id: uid(207) });
    expect(rpc("read_question_contents_v1", input).status).toBe(409);
    expect(rpc("read_question_contents_v1", { ...input, p_context: "student_attempt" }).body.items[0]).toMatchObject({ prompt: "collect", choices: ["모으다", "닫다", "빠른", "낮은"] });
    expect(request("quiz_questions?attempt_id=eq." + uid(207) + "&select=id,prompt,choices").body[0]).toMatchObject({ prompt: null, choices: null });
  });
  it("본문 조회 중 준비 만료를 재현해도 시험 시각과 답을 만들지 않는다", () => {
    const preparation = { p_student_id: uid(1), p_preparation_id: uid(212) };
    expect(rpc("get_quiz_preparation_v1", preparation).body.kind).toBe("initial");
    expect(rpc("read_question_contents_v1", { p_actor_id: uid(1), p_context: "student_preparation", p_context_id: uid(212), p_question_ids: [uid(2120)] })).toMatchObject({ status: 409, body: { code: "40001" } });
    expect(rpc("get_quiz_preparation_v1", preparation).body).toBeNull();
    expect(localQuizSummary()[0]).toMatchObject({ startedAt: null, answered: 0 });
  });
  it.each([
    { p_student_id: uid(2) }, { p_attempt_id: uid(999) }, { p_question_id: uid(2011) },
    { p_phase: "retry" }, { p_choice_index: -1 }, { p_force_timeout: true },
  ])("가짜 학생/현재 문항 범위 밖 쓰기를 거절한다: %j", override => {
    expect(rpc("answer_quiz_question_v4", { ...answer, ...override }).status).toBe(403);
    expect(localQuizSummary().every(s => s.answered === 0)).toBe(true);
  });
  it("다른 주소와 인증키는 거절한다", () => {
    expect(rpc("answer_quiz_question_v4", answer, { url: "https://example.com/rest/v1/rpc/answer_quiz_question_v4" }).status).toBe(403);
    expect(rpc("answer_quiz_question_v4", answer, { headers: new Headers({ apikey: STUDY_SECRET, authorization: "Bearer other" }) }).status).toBe(403);
  });
  it("답/시간 확인은 멱등이며 다음 답을 대신 저장하지 않는다", () => {
    const feedback = { p_student_id: uid(1), p_attempt_id: uid(201), p_next_question_id: uid(2011),
      p_next_phase: "initial", p_transition_remaining_milliseconds: 0 };
    expect(rpc("resume_quiz_after_feedback_v2", feedback).status).toBe(403);
    const result = rpc("answer_quiz_question_v4", answer);
    expect(result).toMatchObject({ status: 200, body: { correct: true, nextQuestionId: uid(2011) } });
    expect(rpc("answer_quiz_question_v4", answer).body).toEqual(result.body);
    expect(rpc("answer_quiz_question_v4", { ...answer, p_choice_index: 1 }).status).toBe(403);
    const resumed = rpc("resume_quiz_after_feedback_v2", feedback);
    expect(rpc("resume_quiz_after_feedback_v2", feedback).body).toEqual(resumed.body);
    expect(localQuizSummary()[0]).toMatchObject({ answered: 1, resumed: 1, currentQuestionId: uid(2011) });
  });
  it("공식 파서에 맞는 음원과 여섯 유형의 현재 문항을 제공한다", () => {
    for (const c of localQuizCases) {
      const rows = request("quiz_questions?attempt_id=eq." + c.id).body;
      expect(rows).toHaveLength(c.answerLoss ? 99 : 3);
      const snapshot = rows[0].assignment_question.exam_use_snapshot;
      expect(parseTargetPronunciation(snapshot.pronunciation_snapshot).available).toBe(true);
      expect(parseChoicePronunciations(snapshot.choice_dictionary_snapshots, rows[0].choices).every(p => p.available)).toBe(true);
      expect(rows[0].initial_choice_index).toBe(c.phase === "retry" ? 1 : null);
    }
    expect(request("quiz_attempts?id=eq." + uid(201) + "&student_id=eq." + uid(2)).status).toBe(403);
    expect(request("quiz_questions?attempt_id=eq." + uid(201), { method: "DELETE" }).status).toBe(403);
  });
  it("응답 지연 검사에서는 답이 저장되어도 다음 문항의 7초 예약이 남는다", () => {
    const input = { p_student_id: uid(1), p_preparation_id: uid(209) };
    rpc("begin_prepared_quiz_v1", input);
    const delayedAnswer = { ...answer, p_attempt_id: uid(209), p_question_id: uid(209000), p_choice_index: 2 };
    const before = Date.now();
    const result = rpc("answer_quiz_question_v4", delayedAnswer);
    expect(result).toMatchObject({ status: 200, delayMs: 2000,
      body: { correct: true, correctChoiceIndex: 2, nextQuestionId: uid(209001), completed: false } });
    const recovered = request("quiz_attempts?id=eq." + uid(209) + "&student_id=eq." + uid(1)).body;
    expect(Date.parse(recovered.current_question_started_at)).toBeGreaterThanOrEqual(before + 7000);
    const rows = request("quiz_questions?attempt_id=eq." + uid(209)).body;
    expect(rows[0]).toMatchObject({ prompt: "committee", initial_is_correct: true, initial_choice_index: 2 });
    expect(rows[0].choices).toEqual(["주머니", "졸업생", "위원회", "어려움"]);
    expect(rpc("answer_quiz_question_v4", delayedAnswer).body).toEqual(result.body);
    expect(localQuizSummary()[0]).toMatchObject({ answered: 1, resumed: 0, currentQuestionId: uid(209001) });
  });
  it("프록시는 정확한 가짜 ID의 조회/답/시간 확인만 허용한다", () => {
    const base = "/api/student/attempts/" + uid(201);
    expect(isLocalQuizRequest(base, "GET")).toBe(true);
    expect(isLocalQuizRequest(base + "/answers", "POST")).toBe(true);
    expect(isLocalQuizRequest(base + "/feedback", "POST")).toBe(true);
    for (const suffix of ["/expire", "/timeouts", "/answers/", "?other=1"]) expect(isLocalQuizRequest(base + suffix, "POST")).toBe(false);
    expect(isLocalQuizRequest(base + "/answers", "DELETE")).toBe(false);
    expect(isLocalQuizRequest(base.replace(uid(201), uid(999)), "GET")).toBe(false);
  });
  it("복구 경쟁과 종료 실패는 지정된 가짜 회차만 제공한다",()=>{
    rpc("begin_prepared_quiz_v1",{p_student_id:uid(1),p_preparation_id:uid(210)});
    expect(rpc("answer_quiz_question_v4",{...answer,p_attempt_id:uid(210),p_question_id:uid(210000),p_choice_index:2})).toMatchObject({status:200,delayMs:4000});
    rpc("begin_prepared_quiz_v1",{p_student_id:uid(1),p_preparation_id:uid(211)});
    const expiry={p_student_id:uid(1),p_attempt_id:uid(211)};
    expect(isLocalQuizRequest('/api/student/attempts/'+uid(211)+'/expire','POST')).toBe(true);
    for(let n=0;n<3;n++)expect(rpc('expire_quiz_attempt',expiry)).toMatchObject({status:500,body:{code:'57014'}});
    expect(localQuizSummary().find(item=>item.id===uid(211))).toMatchObject({expirations:3,answered:0});
    expect(rpc('expire_quiz_attempt',{...expiry,p_attempt_id:uid(210)}).status).toBe(403);
    expect(rpc('expire_quiz_attempt',{...expiry,p_student_id:uid(2)}).status).toBe(403);
  });
  it("실제 미디어 요소를 유지하고 검사음만 로컬로 연결한다", () => {
    const wave = localQuizWave();
    expect(wave.subarray(0, 4).toString()).toBe("RIFF");
    expect(wave.subarray(8, 16).toString()).toBe("WAVEfmt ");
    expect(wave.readUInt32LE(40)).toBe(16000 * 8 * 2);
    const observer = fs.readFileSync("scripts/local-quiz-feedback-observer.js", "utf8");
    expect(observer).toContain("new NativeAudio()");
    expect(observer).toContain('value === fixture ? "/__baseline/quiz-audio.wav" : value');
    expect(observer).not.toMatch(/dispatchEvent|Promise\.resolve|\.play\s*=/);
  });
});
