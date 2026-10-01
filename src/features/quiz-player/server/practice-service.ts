import "server-only";
import { z } from "zod";
import { practiceHistorySchema, type PracticeInput, type PracticeStartInput } from "../contracts/practice";
import type { QuizAttemptResponse } from "../model";
import { attemptResponseSchema } from "../api/quiz-attempt";
import { freezePracticeQuestions, practiceHash, preparePractice } from "./practice-source";
import { PracticeError, practiceRpc } from "./practice-rpc";
export { PracticeError, practiceRpc } from "./practice-rpc";

export async function previewPractice(studentId: string, input: PracticeInput) {
  return (await preparePractice(studentId, input)).preview;
}
export async function startPractice(studentId: string, input: PracticeStartInput): Promise<QuizAttemptResponse>;
export async function startPractice(studentId: string, input: PracticeStartInput, prepare: boolean): Promise<QuizAttemptResponse | {preparationId: string}>;
export async function startPractice(studentId: string, input: PracticeStartInput, prepare = false): Promise<QuizAttemptResponse | {preparationId: string}> {
  const requestHash = practiceHash(input);
  // Receipt lookup precedes any source re-read or voice lookup after response loss.
  const existing = await practiceRpc("get_student_word_practice_v1", { p_student_id: studentId, p_request_key: input.requestKey, p_request_hash: requestHash });
  if (existing) return attemptResponseSchema.parse(existing);
  if (prepare) {
    const saved = await practiceRpc("find_word_practice_preparation_v1",{p_student_id:studentId,p_request_key:input.requestKey,p_request_hash:requestHash});
    if (saved) return {preparationId:z.uuid().parse(saved)};
  }
  const { confirmation: _confirmation, ...previewInput } = input;
  void _confirmation;
  const prepared = await preparePractice(studentId, previewInput);
  if (!prepared.preview.confirmation || prepared.preview.confirmation !== input.confirmation) {
    throw new PracticeError(409, "단어가 달라졌습니다. 다시 확인해 주세요.", "source_changed");
  }
  const questions = await freezePracticeQuestions(prepared);
  const result = await practiceRpc(prepare ? "prepare_word_practice_start_v1" : "start_student_word_practice_v1", { p_student_id: studentId, p_request_key: input.requestKey,
    p_request_hash: requestHash, p_selection: input.selection, p_settings: input.settings, p_source_hash: prepared.source.sourceHash, p_questions: questions });
  return prepare ? {preparationId: z.uuid().parse(result)} : attemptResponseSchema.parse(result);
}
export async function getPractice(studentId: string, id: string): Promise<QuizAttemptResponse | null> {
  const value = await practiceRpc("get_student_word_practice_v1", { p_student_id: studentId, p_run_id: id });
  return value === null ? null : attemptResponseSchema.parse(value);
}
export async function getPracticeHistory(studentId: string, cursor?: string | null) {
  let after: { studentId: string; at: string; id: string } | null = null;
  if (cursor) {
    try { after = z.object({ studentId: z.uuid(), at: z.iso.datetime({ offset: true }), id: z.uuid() }).strict().parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); }
    catch { throw new PracticeError(400, "조회 조건을 확인해 주세요."); }
    if (after.studentId !== studentId) throw new PracticeError(409, "계정이 바뀌어 연습 내역을 다시 불러옵니다.", "student_changed");
  }
  const rows = practiceHistorySchema.max(11).parse(await practiceRpc("get_student_word_practice_v1", { p_student_id: studentId,
    p_before_started_at: after?.at ?? null, p_before_id: after?.id ?? null }));
  const items = rows.slice(0, 10), last = items.at(-1);
  return { items, nextCursor: rows.length > 10 && last ? Buffer.from(JSON.stringify({ studentId, at: last.startedAt, id: last.id })).toString("base64url") : null };
}
