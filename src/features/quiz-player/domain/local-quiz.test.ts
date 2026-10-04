import { describe, expect, it } from "vitest";
import { makeDisplayAtom } from "@/lib/quiz/shared-display";
import { commonContentKey, localAnswerHash, phaseRemainingMs, receiptConfirmsBatch, recordLocalAnswer, restoredLocalElapsed } from "./local-quiz";
import { packLocalQuizContents, unpackLocalQuizContent } from "./local-quiz-content";
import type { CommonQuizBody, LocalPhasePlan, LocalQuizRun, LocalReceipt } from "../contracts/local-quiz";
const id = (n: number) => `a5050000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const pronunciation = { available: false, displayKo: null, variantId: null, audioUrl: null, segments: undefined };
function run(limitMs: number | null = 240000, questionLimitMs: number | null = 5000): LocalQuizRun {
  const plan: LocalPhasePlan = { protocol: "local_batch_v1", attemptId: id(1), planHash: "a".repeat(64), phase: "initial", startedAt: "2026-10-02T00:00:00Z",
    serverNow: "2026-10-02T00:00:00Z", status: "in_progress", officialPhase: "initial", limitMs, questionLimitMs, timePolicy: "local-elapsed-v1",
    items: [1, 2, 3].map(n => ({ id: id(n + 10), order: n, contentId: id(n + 20), correctChoiceIndex: n % 4, priorWrongCount: 0 })) };
  return { key: id(1), revision: 0, identity: "same", studentId: id(2), device: "c".repeat(64), startRequested: false,
    preparation: { protocol: "local_batch_v1", preparationId: id(1), assignmentId: id(3), studentId: id(2), planHash: "a".repeat(64), title: "가짜 시험",
      quizContentMode: "book_meaning_choice", timingMode: "per_question", questionTimeLimitSeconds: 5, items: [] },
    plan, answers: [], openedMs: 0, clock: { wallAt: 1000, elapsedAt: 0 }, batch: null, receipt: null };
}
describe("기기 답 기록과 공용 표시 자료", () => {
  it("JSON 왕복으로 optional 발음 필드가 빠져도 동일한 확인값을 유지한다", async () => {
    const value = { kind: "pronunciation" as const, pronunciation };
    expect(await makeDisplayAtom(value)).toMatchObject({ key: (await makeDisplayAtom(JSON.parse(JSON.stringify(value)))).key });
    const body: CommonQuizBody = { contentId: id(20), quizContentMode: "book_meaning_choice", direction: "english_to_korean", prompt: "collect",
      choices: ["모으다", "남기다", "놀다", "쓰다"], pronunciation, choicePronunciations: Array(4).fill(pronunciation) };
    const key = await commonContentKey(body);
    expect(await commonContentKey(JSON.parse(JSON.stringify(body)))).toBe(key);
    const packet = JSON.parse(JSON.stringify(await packLocalQuizContents([{ key, body }])));
    expect(await unpackLocalQuizContent(packet.contents[0], new Map(packet.atoms.map((a: { key: string }) => [a.key, a])))).toMatchObject({ key });
  });
  it("같은 표시만 공유하고 문항판과 선택된 뜻은 섞지 않는다", async () => {
    const body: CommonQuizBody = { contentId: id(20), quizContentMode: "book_meaning_choice", direction: "english_to_korean", prompt: "bank",
      choices: ["은행", "강둑", "학교", "가게"], pronunciation, choicePronunciations: Array(4).fill(pronunciation) };
    const one = { body, key: await commonContentKey(body) }; const otherBody = { ...body, contentId: id(21) };
    const packet = await packLocalQuizContents([one, { body: otherBody, key: await commonContentKey(otherBody) }]);
    expect(packet.contents).toHaveLength(2); expect(packet.atoms).toHaveLength(6);
    expect(packet.contents[0].key).not.toBe(packet.contents[1].key); expect(packet.contents[0].prompt).toBe(packet.contents[1].prompt);
    const again = await packLocalQuizContents([one], [...packet.contents.map(c => c.key), ...packet.atoms.map(a => a.key)]);
    expect(again).toEqual({ contents: [], atoms: [] });
  });
  it("답과 다음 위치를 같은 값에 담고 마지막 답만 고정된 제출을 만든다", () => {
    let value = run();
    value = recordLocalAnswer(value, 1, 50, 1050, id(90)); expect(value.openedMs).toBe(300); expect(value.batch).toBeNull();
    value = recordLocalAnswer(value, 2, 350, 1350, id(91));
    value = recordLocalAnswer(value, 3, 650, 1650, id(92));
    expect(value.batch).toMatchObject({ submissionId: id(92), completion: { elapsedMs: 650, reason: "answered" } });
    expect(value.answers.map(a => a.openedMs)).toEqual([0, 300, 600]); expect(value.revision).toBe(3);
    expect(() => recordLocalAnswer(value, 0, 400, 1400, id(93))).toThrow("local_phase_not_active");
  });
  it("전환 250ms 사이 전체 마감이 와도 나머지를 미응답으로 끝낸다", () => {
    const first = recordLocalAnswer(run(240000, null), 1, 239950, 240950, id(90));
    const done = recordLocalAnswer(first, null, 240000, 241000, id(91));
    expect(done.batch?.completion).toEqual({ elapsedMs: 240000, reason: "deadline" });
    expect(done.answers.slice(1).map(a => [a.kind, a.elapsedMs, a.openedMs])).toEqual([["unanswered", 240000, 240000], ["unanswered", 240000, 240000]]);
  });
  it.each([5, 8, 10, 17, 20, 600])("문항 %i초 초과는 실제 마감에 기록한다", seconds => {
    const value = run(null, seconds * 1000);
    const result = recordLocalAnswer(value, null, seconds * 1000 + 10, 999999, id(90));
    expect(result.answers[0]).toMatchObject({ kind: "timeout", elapsedMs: seconds * 1000, choice: null });
    expect(() => recordLocalAnswer(value, 0, seconds * 1000 + 1, 999999, id(91))).toThrow("local_answer_too_late");
    expect(phaseRemainingMs(value.plan!, 0, seconds * 1000)).toBe(0);
  });
  it("새로고침은 지난 시간을 더하고 시계 역행은 확인을 요구한다", () => {
    expect(restoredLocalElapsed({ wallAt: 1000, elapsedAt: 900 }, 4000)).toBe(3900);
    expect(() => restoredLocalElapsed({ wallAt: 10000, elapsedAt: 900 }, 1000)).toThrow("local_clock_recheck_required");
  });
  it("접수된 마지막 답뿐 아니라 모든 문항과 확인값을 대조한다", async () => {
    let value = run();
    for (let i = 0; i < 3; i++) value = recordLocalAnswer(value, i, i * 250, 1000 + i * 250, id(90));
    const batch = value.batch!;
    const receipt: LocalReceipt = { protocol: "local_batch_v1", submissionId: batch.submissionId, phase: batch.phase, planHash: batch.planHash,
      payloadHash: "f".repeat(64), accepted: await Promise.all(batch.answers.map(async (a, i) => ({ id: a.id, answerHash: await localAnswerHash(a), sequence: i + 1 }))),
      result: { state: "completed", finalized: true }, retryTargets: [] };
    expect(await receiptConfirmsBatch(batch, receipt)).toBe(true);
    expect(await receiptConfirmsBatch(batch, { ...receipt, accepted: receipt.accepted.slice(1) })).toBe(false);
    expect(await receiptConfirmsBatch(batch, { ...receipt, accepted: [{ ...receipt.accepted[0], answerHash: "b".repeat(64) }, ...receipt.accepted.slice(1)] })).toBe(false);
  });
});
