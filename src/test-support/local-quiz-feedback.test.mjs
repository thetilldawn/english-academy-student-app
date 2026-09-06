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
  it("기본 읽기 전용 모드에서는 시험 저장을 열지 않는다", () => {
    expect(rpc("answer_quiz_question_v4", answer, { quizFeedback: false }).status).toBe(403);
    expect(localQuizSummary()).toEqual([]);
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
      expect(rows).toHaveLength(3);
      const snapshot = rows[0].assignment_question.exam_use_snapshot;
      expect(parseTargetPronunciation(snapshot.pronunciation_snapshot).available).toBe(true);
      expect(parseChoicePronunciations(snapshot.choice_dictionary_snapshots, rows[0].choices).every(p => p.available)).toBe(true);
      expect(rows[0].initial_choice_index).toBe(c.phase === "retry" ? 1 : null);
    }
    expect(request("quiz_attempts?id=eq." + uid(201) + "&student_id=eq." + uid(2)).status).toBe(403);
    expect(request("quiz_questions?attempt_id=eq." + uid(201), { method: "DELETE" }).status).toBe(403);
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
