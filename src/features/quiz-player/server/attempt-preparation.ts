import "server-only";
import { getPreparationQuestionContents, QuestionContentPreparationChangedError } from "./queries/question-content-query";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { getStudentAttempt, hydrateQuizQuestions, type QuestionRow } from "@/lib/services/quiz/attempt-query";
import { startQuizRetryWithCompatibleRpc } from "@/lib/services/quiz-rpc-compatibility";
import { normalizeQuizContentMode, quizContentModes } from "@/lib/quiz/question-content-mode";
import { millisecondsUntil, currentTimeMilliseconds } from "@/lib/deadline";
import { preparedQuizSchema, readyQuizSchema, type PreparedQuiz, type ReadyQuiz } from "../contracts/preparation";
import { attemptResponseSchema } from "../api/quiz-attempt";
import type { QuizAttempt } from "../model";

const rawQuestion = z.object({
  id: z.uuid(), assignment_question_id: z.uuid().optional(), vocab_entry_id: z.number().nullable(),
  order_index: z.number().int().positive(), direction: z.enum(["english_to_korean", "korean_to_english"]),
  prompt: z.string(), choices: z.array(z.string()).length(4), correct_choice_index: z.number().int().min(0).max(3),
});
export class QuizPreparationChangedError extends Error {}
async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await getServiceSupabaseClient().rpc(name, parameters);
  if (error) {
    const code = error.message?.split(/[\s:]/)[0];
    if (["practice_source_changed", "wrong_history_changed", "preparation_expired", "preparation_changed", "preparation_not_found",
      "assignment_unavailable", "assignment_not_owned", "retake_not_allowed"].includes(code) || code?.startsWith("assignment_release_")) {
      throw new QuizPreparationChangedError("시험 준비가 만료되었거나 자료가 바뀌었습니다. 목록에서 다시 시작해 주세요.");
    }
    throw new Error(error.message);
  }
  return data;
}
function withoutClock(attempt: QuizAttempt, kind: PreparedQuiz["kind"]): PreparedQuiz {
  return preparedQuizSchema.parse({ ...attempt, kind });
}
export async function getRetryPreparation(studentId: string, id: string, existing?: QuizAttempt) {
  const attempt = existing ?? await getStudentAttempt(studentId, id);
  if (!attempt || attempt.status !== "in_progress" || attempt.phase !== "review") return null;
  const current = attempt.questions.find(q => q.initialIsCorrect === false && q.retryChoiceIndex === null);
  if (!current) return null;
  return withoutClock({ ...attempt, phase: "retry", currentQuestionId: current.id }, "retry");
}
export async function prepareStudentRetry(studentId: string, id: string) {
  const { data, error } = await getServiceSupabaseClient().from("quiz_attempts").select("id,phase,status")
    .eq("id",id).eq("student_id",studentId).single();
  if (error || !data || data.status !== "in_progress" || !["review","retry"].includes(data.phase)) throw new Error("retry_unavailable");
  return { phase: "retry" as const, prepared: true };
}
export async function getQuizPreparation(studentId: string, id: string, options: { strictPronunciation?: boolean } = {}): Promise<PreparedQuiz | {resumeId:string;kind:"initial"|"practice"} | null> {
  const raw = await rpc("get_quiz_preparation_v1", { p_student_id: studentId, p_preparation_id: id });
  if (!raw) return null;
  const base = z.object({ id: z.uuid(), kind: z.enum(["initial","practice"]), begunId:z.uuid().nullable().optional(), plan: z.unknown().optional(), assignment: z.unknown().optional() }).parse(raw);
  if (base.begunId) return {resumeId:base.begunId,kind:base.kind};
  if (base.kind === "practice") {
    const plan = z.object({ settings: z.object({ timingMode: z.enum(["none","total","per_question"]), questionTimeLimitSeconds: z.number().nullable() }),
      questions: z.array(z.object({ quizContentMode: z.enum(quizContentModes).optional(), direction: z.enum(["english_to_korean","korean_to_english"]), prompt: z.string(), choices: z.array(z.string()).length(4),
        pronunciation: z.unknown(), choicePronunciations: z.unknown() })) }).parse(base.plan);
    return preparedQuizSchema.parse({
      id, kind: "practice", assignmentTitle: "자율연습", quizContentMode: "book_meaning_choice", phase: "initial",
      timingMode: plan.settings.timingMode, questionTimeLimitSeconds: plan.settings.questionTimeLimitSeconds,
      currentQuestionId: id + ":1", questions: plan.questions.map((q,index) => ({
        ...q, id: id + ":" + (index+1), orderIndex: index+1, initialChoiceIndex: null, initialIsCorrect: null,
        retryChoiceIndex: null, retryIsCorrect: null, priorWrongLevel: 0, initialTimedOut: false, retryTimedOut: false, revealedCorrectChoiceIndex: null,
      })),
    });
  }
  const a = z.object({ id: z.uuid(), title: z.string(), quiz_content_mode: z.string(),
    timing_mode: z.enum(["none","total","per_question"]), question_time_limit_seconds: z.number().nullable() }).parse(base.assignment);
  const plan = z.array(rawQuestion).parse(base.plan);
  const bankIds = plan.flatMap(q => q.assignment_question_id ? [q.assignment_question_id] : []);
  let banks: Awaited<ReturnType<typeof getPreparationQuestionContents>>;
  try { banks = await getPreparationQuestionContents(studentId, id, bankIds); }
  catch (error) {
    if (!(error instanceof QuestionContentPreparationChangedError)) throw error;
    // Another tab may have begun between the prepared header and its content
    // read. Follow the existing receipt without issuing another start command.
    const refreshedRaw = await rpc("get_quiz_preparation_v1", { p_student_id: studentId, p_preparation_id: id });
    if (!refreshedRaw) throw new QuizPreparationChangedError("시험 준비가 만료되었거나 자료가 바뀌었습니다. 목록에서 다시 시작해 주세요.");
    const refreshed = z.object({ kind: z.enum(["initial", "practice"]), begunId: z.uuid().nullable().optional() }).parse(refreshedRaw);
    if (refreshed.begunId) return { resumeId: refreshed.begunId, kind: refreshed.kind };
    throw new QuizPreparationChangedError("시험 준비가 만료되었거나 자료가 바뀌었습니다. 목록에서 다시 시작해 주세요.");
  }
  const rows: QuestionRow[] = plan.map(q => ({ ...q, initial_choice_index: null, initial_is_correct: null,
    retry_choice_index: null, retry_is_correct: null, prior_wrong_count: 0, assignment_question: q.assignment_question_id ? banks.get(q.assignment_question_id)!.assignment_question : null }));
  const quizContentMode = normalizeQuizContentMode(a.quiz_content_mode);
  return preparedQuizSchema.parse({ id, kind: "initial", assignmentTitle: a.title, quizContentMode, phase: "initial",
    timingMode: a.timing_mode, questionTimeLimitSeconds: a.question_time_limit_seconds, currentQuestionId: plan[0]?.id ?? null,
    questions: await hydrateQuizQuestions(rows, quizContentMode, options) });
}
export async function beginQuizPreparation(studentId: string, id: string, kind: PreparedQuiz["kind"]): Promise<ReadyQuiz> {
  if (kind === "practice") {
    const result = attemptResponseSchema.parse(await rpc("begin_prepared_practice_v1", { p_student_id: studentId, p_preparation_id: id }));
    return readyQuizSchema.parse({ ...result.attempt, completionConfirmed: result.completionConfirmed,
      questionIds: result.attempt.questions.map(q => q.id), timerRemainingMilliseconds: result.timerRemainingMilliseconds });
  }
  const actualId = kind === "retry" ? id : z.uuid().parse(await rpc("begin_prepared_quiz_v1", { p_student_id: studentId, p_preparation_id: id }));
  if (kind === "retry") {
    const client = getServiceSupabaseClient();
    const retry = await startQuizRetryWithCompatibleRpc((name,args)=>client.rpc(name,args), {p_student_id:studentId,p_attempt_id:actualId});
    if (retry.error || !retry.data) throw new Error("retry_unavailable");
  }
  // The heavy question/pronunciation read already happened before the clock started.
  const { data, error } = await getServiceSupabaseClient().from("quiz_attempts")
    .select("id, phase, status, started_at, deadline_at, current_question_started_at, assignment:assignments(timing_mode,question_time_limit_seconds)")
    .eq("id",actualId).eq("student_id",studentId).single();
  if (error || !data) throw new Error("attempt_clock_unavailable");
  const a = z.object({ timing_mode: z.string(), question_time_limit_seconds: z.number().nullable() }).parse(Array.isArray(data.assignment) ? data.assignment[0] : data.assignment);
  const { data: questions, error: questionError } = await getServiceSupabaseClient().from("quiz_questions")
    .select("id,prior_wrong_count,initial_choice_index,initial_is_correct,retry_choice_index").eq("attempt_id",actualId).order("order_index");
  if (questionError) throw questionError;
  const question = questions?.find(q => data.phase === "retry" ? q.initial_is_correct === false && q.retry_choice_index === null : q.initial_choice_index === null);
  const timerDeadlineAt = a.timing_mode === "per_question" && a.question_time_limit_seconds
    ? new Date(Date.parse(data.current_question_started_at)+a.question_time_limit_seconds*1000).toISOString() : data.deadline_at;
  return readyQuizSchema.parse({ id: actualId, phase: data.phase, status: data.status,
    completionConfirmed: data.status !== "in_progress", startedAt: data.started_at,
    deadlineAt: data.deadline_at, timerDeadlineAt, currentQuestionId: question?.id ?? null,
    questionIds: questions?.map(q => q.id),
    priorWrongLevels: questions?.map(q => q.prior_wrong_count >= 2 ? 2 : q.prior_wrong_count === 1 ? 1 : 0),
    timerRemainingMilliseconds: millisecondsUntil(timerDeadlineAt,currentTimeMilliseconds()) ?? 0 });
}

