import "server-only";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export type AttemptContentActor = { kind: "student"; studentId: string } | { kind: "admin"; adminId: string };
export class QuestionContentPreparationChangedError extends Error {}
const provenance = z.enum(["legacy_backfill", "verified_v2", "reviewed_for_preview_v1", "preview_verified_v1", "exam_reviewed_v1", "composition_verified_v1", "notebook_snapshot_v1"]);
const historyExam = z.object({ headword_snapshot: z.string(), primary_meaning_snapshot: z.string(), provenance_status: z.literal("reviewed_for_preview_v1") }).strict();
const exam = historyExam.extend({ release_id: z.uuid(), occurrence_id: z.string().min(1), dictionary_id: z.string().min(1), pronunciation_variant_id: z.string().nullable(),
  display_pronunciation_ko_snapshot: z.string().nullable(), pronunciation_snapshot: z.json(), choice_dictionary_snapshots: z.json() }).strict();
const historySnapshot = z.object({ headword_snapshot: z.string().nullable(), primary_meaning_snapshot: z.string().nullable(),
  provenance_status: provenance, exam_use_snapshot: historyExam.nullable() }).strict();
const snapshot = historySnapshot.extend({ vocab_entry_id: z.number().int().positive(), choice_vocab_entry_ids: z.array(z.number().int().positive()).nullable(),
  composition_pronunciation_snapshot: z.json(), notebook_pronunciation_snapshot: z.json(), exam_use_snapshot: exam.nullable() }).strict();
const attemptItem = z.object({ id: z.uuid(), prompt: z.string().min(1), choices: z.array(z.string()).length(4), assignment_question: snapshot.nullable() }).strict();
const preparationItem = z.object({ id: z.uuid(), assignment_question: snapshot }).strict();
const studyItem = z.object({ id: z.uuid(), vocab_entry_id: z.number().int().positive(), prompt: z.string().min(1).max(10_000) }).strict();
const historyItem = z.object({ id: z.uuid(), assignment_question: historySnapshot.nullable() }).strict();
type Context = "student_attempt" | "admin_attempt" | "student_preparation" | "student_assignment" | "admin_wrong_history";
const envelope = z.object({ schemaVersion: z.literal("question-content-read-v1"), context: z.string(), items: z.array(z.unknown()).max(200) }).strict();

/** A missing or malformed reference is an error, never a latest-dictionary fallback. */
async function read<T extends { id: string }>(context: Context, actorId: string, contextId: string, ids: readonly string[], itemSchema: z.ZodType<T>): Promise<Map<string, T>> {
  const unique = [...new Set(ids)];
  const result = new Map<string, T>();
  for (let offset = 0; offset < unique.length; offset += 200) {
    const requested = unique.slice(offset, offset + 200);
    const { data, error } = await getServiceSupabaseClient().rpc("read_question_contents_v1", {
      p_context: context, p_actor_id: actorId, p_context_id: contextId, p_question_ids: requested,
    });
    if (error) {
      if (context === "student_preparation" && error.code === "40001" &&
        ["preparation_unavailable", "preparation_changed"].includes(error.message?.split(/[\s:]/)[0])) {
        throw new QuestionContentPreparationChangedError("preparation_changed");
      }
      throw new Error("문항 내용을 불러오지 못했습니다. 다시 시도해 주세요.", { cause: error });
    }
    const parsed = envelope.safeParse(data);
    if (!parsed.success || parsed.data.context !== context || parsed.data.items.length !== requested.length) throw new Error("question_content_response_invalid");
    for (let index = 0; index < requested.length; index++) {
      const item = itemSchema.safeParse(parsed.data.items[index]);
      if (!item.success || item.data.id !== requested[index] || result.has(item.data.id)) throw new Error("question_content_response_invalid");
      result.set(item.data.id, item.data);
    }
  }
  return result;
}
export function getAttemptQuestionContents(actor: AttemptContentActor, attemptId: string, ids: readonly string[]) {
  return read(actor.kind === "student" ? "student_attempt" : "admin_attempt", actor.kind === "student" ? actor.studentId : actor.adminId, attemptId, ids, attemptItem);
}
export function getPreparationQuestionContents(studentId: string, preparationId: string, ids: readonly string[]) {
  return read("student_preparation", studentId, preparationId, ids, preparationItem);
}
export function getAssignmentStudyQuestionContents(studentId: string, assignmentId: string, ids: readonly string[]) {
  return read("student_assignment", studentId, assignmentId, ids, studyItem);
}
export function getAdminWrongHistoryQuestionContents(adminId: string, studentId: string, ids: readonly string[]) {
  return read("admin_wrong_history", adminId, studentId, ids, historyItem);
}
