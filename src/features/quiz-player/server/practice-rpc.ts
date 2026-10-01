import "server-only";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { quizExpirationError, quizAnswerError } from "./quiz-command-error";

export class PracticeError extends Error {
  constructor(public readonly status: number, message: string, public readonly code?: string) { super(message); }
}

// Source reads and writes share classification. Unknown failures retain the
// start receipt key: a failed HTTP response does not prove a rolled-back write.
export async function practiceRpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await getServiceSupabaseClient().rpc(name, parameters);
  if (error) {
    if (name === "expire_student_word_practice_v1") throw quizExpirationError(error);
    if (name === "answer_student_word_practice_v1") throw quizAnswerError(error);
    const code = error.message?.split(/[\s:]/)[0];
    if (error.code === "42501") throw new PracticeError(403, "다시 로그인해 주세요.");
    if (code === "practice_not_found") throw new PracticeError(404, "연습을 찾을 수 없습니다.");
    if (code === "practice_source_changed") throw new PracticeError(409, "단어가 달라졌습니다. 다시 확인해 주세요.", "source_changed");
    if (code === "practice_range_too_large") throw new PracticeError(422, "단어장이나 횟수로 범위를 좁혀 주세요.");
    if (["practice_request_conflict", "practice_answer_conflict", "practice_answer_outdated", "practice_question_not_ready", "practice_already_finished", "practice_timeout_too_early", "practice_expire_too_early"].includes(code))
      throw new PracticeError(409, "연습 상태를 다시 확인해 주세요.");
    throw new PracticeError(503, "응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
  }
  return data;
}
