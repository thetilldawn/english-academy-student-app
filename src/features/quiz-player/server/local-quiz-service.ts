import "server-only";
import { studentAppText } from "@/content/ko/student-app";
import { createHash } from "node:crypto";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { startStudentAttempt } from "@/lib/services/quiz/attempt-start";
import { materializeReadyVocabAssignmentQueue } from "@/lib/services/vocab-assignment-queue-command";
import { getQuizPreparation } from "./attempt-preparation";
import { commonQuizBodySchema, localPhasePlanSchema, localQuizPreparationSchema, localReceiptSchema, type CommonQuizContent, type LocalQuizRequest } from "../contracts/local-quiz";
import { commonContentKey } from "../domain/local-quiz";
import { packLocalQuizContents } from "../domain/local-quiz-content";
import { getAssignmentStudy, getAssignmentStudyAccess, packAssignmentStudy } from "@/features/student-dashboard/public-server";
import { hydrateQuizQuestions, type QuestionRow } from "@/lib/services/quiz/attempt-query";
import { normalizeQuizContentMode } from "@/lib/quiz/question-content-mode";

export class LocalQuizError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) { super(message); }
}
async function rpc(name: string, parameters: Record<string, unknown>) {
  const { data, error } = await getServiceSupabaseClient().rpc(name, parameters);
  if (!error) return data;
  const code = error.message?.split(/[\s:]/)[0] ?? "local_quiz_unavailable";
  if (code === "quiz_new_attempts_paused") throw new LocalQuizError(code, 503, studentAppText.dashboard.release.newAttemptsPaused);
  if (code === "local_quiz_device_required") throw new LocalQuizError(code, 409, "이 시험은 시작한 기기에서 이어서 진행해 주세요.");
  if (error.code === "42501") throw new LocalQuizError("local_quiz_unauthorized", 403, "이 시험을 진행할 권한이 없습니다. 저장한 답은 기기에 보관됩니다.");
  if (error.code === "PT409" || error.code === "P0002") throw new LocalQuizError(code, 409, "시험 정보가 맞지 않습니다. 저장한 답을 보관한 채 다시 확인해 주세요.");
  if (error.code === "22023") throw new LocalQuizError("local_quiz_invalid", 400, "답안 정보를 확인하지 못했습니다. 저장한 답은 기기에 보관됩니다.");
  throw new LocalQuizError("local_quiz_unavailable", 503, "시험 정보를 확인하지 못했습니다. 연결 후 다시 시도해 주세요.");
}
const deviceHash = (device: string) => createHash("sha256").update(device).digest("hex");
export async function handleLocalQuizCommand(studentId: string, command: LocalQuizRequest) {
  if (command.action === "identity") return { studentId };
  if (command.action === "study") {
    const before = await getAssignmentStudyAccess({ studentId }, command.assignmentId);
    if (!before) throw new LocalQuizError("study_unavailable", 404, "배정된 단어장을 찾지 못했습니다.");
    if ("release" in before) return { locked: before };
    const study = await getAssignmentStudy({ studentId }, command.assignmentId, true);
    if (!study) throw new LocalQuizError("study_unavailable", 404, "배정된 단어장을 찾지 못했습니다.");
    if ("release" in study) return { locked: { ...study, studentId } };
    const packet = await packAssignmentStudy(study, command.knownKeys);
    const after = await getAssignmentStudyAccess({ studentId }, command.assignmentId);
    if (after && "release" in after) return { locked: after };
    if (!after || before.revision !== after.revision) throw new LocalQuizError("study_changed", 409, "배정이 변경됐습니다. 다시 확인해 주세요.");
    return { ...packet, access: after };
  }
  if (command.action === "prefetch") {
    const raw = await rpc("read_local_quiz_materials_v1", { p_student_id: studentId, p_assignment_id: command.assignmentId });
    if (!raw || (raw as { items?: unknown[] }).items?.length === 0) {
      const study = await getAssignmentStudy({ studentId }, command.assignmentId, true);
      if (!study || "release" in study) return { contents: [], atoms: [], ...(command.includeRefs ? { requiredKeys: [] } : {}) };
      const packet = await packAssignmentStudy(study);
      const known = new Set(command.knownKeys);
      return { contents: [], atoms: packet.atoms.filter(atom => !known.has(atom.key)), ...(command.includeRefs ? { requiredKeys: packet.atoms.map(atom => atom.key) } : {}) };
    }
    const material = raw as { mode: string; items: Array<QuestionRow & { content_version_id: string }> };
    if (!Array.isArray(material.items) || material.items.length > 500) throw new Error("local_materials_invalid");
    const mode = normalizeQuizContentMode(material.mode);
    const questions = await hydrateQuizQuestions(material.items.map(q => ({ ...q, initial_choice_index: null, initial_is_correct: null,
      retry_choice_index: null, retry_is_correct: null, prior_wrong_count: 0 })), mode, { strictPronunciation: true });
    const contents = await Promise.all(questions.map(async (q, i) => {
      const body = commonQuizBodySchema.parse({ contentId: material.items[i].content_version_id, quizContentMode: mode,
        direction: q.direction, prompt: q.prompt, choices: q.choices, pronunciation: q.pronunciation, choicePronunciations: q.choicePronunciations });
      return { key: await commonContentKey(body), body };
    }));
    return { ...await packLocalQuizContents(contents, command.knownKeys), ...(command.includeRefs ? { requiredKeys: contents.map(content => content.key) } : {}) };
  }
  const base = { p_student_id: studentId, p_device_hash: deviceHash(command.device) };
  if (command.action === "prepare") {
    // Reuse the existing bank/legacy selection and release checks. This creates
    // only a private preparation; clocks, attempts and answers remain untouched.
    await startStudentAttempt(studentId, command.assignmentId, true);
    const raw = await rpc("prepare_local_quiz_v1", { ...base, p_assignment_id: command.assignmentId });
    const resume = z.object({ protocol: z.enum(["legacy", "local_batch_v1"]), resumeId: z.uuid() }).safeParse(raw);
    if (resume.success) return { ...resume.data, studentId };
    const prepared = z.object({ preparationId: z.uuid(), planHash: z.string(), assignmentId: z.uuid(),
      plan: z.array(z.object({ content_version_id: z.uuid(), order_index: z.number().int().positive() })).min(1).max(500) }).parse(raw);
    const display = await getQuizPreparation(studentId, prepared.preparationId, { strictPronunciation: true });
    if (!display || "resumeId" in display || display.questions.length !== prepared.plan.length) {
      throw new LocalQuizError("local_quiz_preparation_changed", 409, "시험 준비가 바뀌었습니다. 다시 확인해 주세요.");
    }
    const ordered = [...prepared.plan].sort((a, b) => a.order_index - b.order_index);
    const contents: CommonQuizContent[] = await Promise.all(display.questions.map(async (q, i) => {
      const body = { contentId: ordered[i].content_version_id, quizContentMode: q.quizContentMode ?? display.quizContentMode,
        direction: q.direction, prompt: q.prompt, choices: q.choices, pronunciation: q.pronunciation,
        choicePronunciations: q.choicePronunciations };
      return { key: await commonContentKey(body), body };
    }));
    return localQuizPreparationSchema.parse({ protocol: "local_batch_v1", studentId, assignmentId: prepared.assignmentId,
      preparationId: prepared.preparationId, planHash: prepared.planHash, title: display.assignmentTitle,
      quizContentMode: display.quizContentMode, timingMode: display.timingMode, questionTimeLimitSeconds: display.questionTimeLimitSeconds,
      items: contents.map(c => ({ contentId: c.body.contentId, key: c.key })), packet: await packLocalQuizContents(contents, command.knownKeys) });
  }
  if (command.action === "begin") return localPhasePlanSchema.parse(await rpc("begin_local_quiz_v1", { ...base, p_preparation_id: command.preparationId, p_plan_hash: command.planHash }));
  if (command.action === "retry") return localPhasePlanSchema.parse(await rpc("begin_local_quiz_retry_v1", { ...base, p_attempt_id: command.attemptId }));
  if (command.action === "read") return localPhasePlanSchema.parse(await rpc("read_local_quiz_plan_v1", { ...base, p_attempt_id: command.attemptId, p_phase: command.phase }));
  const batch = command.batch;
  const receipt = localReceiptSchema.parse(await rpc("submit_local_quiz_phase_v1", { ...base, p_attempt_id: batch.attemptId, p_phase: batch.phase,
    p_plan_hash: batch.planHash, p_submission_id: batch.submissionId, p_answers: batch.answers, p_completion: batch.completion }));
  await materializeReadyVocabAssignmentQueue(studentId);
  return receipt;
}
