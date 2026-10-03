import "server-only";
import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

export class TransitionPreparationChangedError extends Error {}
const provenance = z.enum(["legacy_backfill", "verified_v2", "reviewed_for_preview_v1", "preview_verified_v1", "exam_reviewed_v1", "composition_verified_v1", "notebook_snapshot_v1"]);
const exam = z.object({ release_id: z.uuid(), occurrence_id: z.string().min(1), dictionary_id: z.string().min(1),
  pronunciation_variant_id: z.string().nullable(), headword_snapshot: z.string(), primary_meaning_snapshot: z.string(),
  provenance_status: z.literal("reviewed_for_preview_v1"), display_pronunciation_ko_snapshot: z.string().nullable(),
  pronunciation_snapshot: z.json(), choice_dictionary_snapshots: z.json() }).strict();
const snapshot = z.object({ vocab_entry_id: z.number().int().positive(), choice_vocab_entry_ids: z.array(z.number().int().positive()).nullable(),
  headword_snapshot: z.string().nullable(), primary_meaning_snapshot: z.string().nullable(), provenance_status: provenance,
  composition_pronunciation_snapshot: z.json(), notebook_pronunciation_snapshot: z.json(), exam_use_snapshot: exam.nullable() }).strict();
const preparationItem = z.object({ id: z.uuid(), assignment_question: snapshot }).strict();
const studyItem = z.object({ id: z.uuid(), vocab_entry_id: z.number().int().positive(), prompt: z.string().min(1).max(10_000) }).strict();
const envelope = z.object({ schemaVersion: z.literal("question-content-read-v1"), context: z.string(), items: z.array(z.unknown()).max(200) }).strict();
type Context = "student_preparation" | "student_assignment";

/** Used only for explicit NULL bodies during the production schema transition. */
async function read<T extends { id: string }>(context: Context, studentId: string, contextId: string, ids: readonly string[], schema: z.ZodType<T>): Promise<Map<string, T>> {
  const unique = [...new Set(ids)], result = new Map<string, T>();
  for (let offset = 0; offset < unique.length; offset += 200) {
    const requested = unique.slice(offset, offset + 200);
    const { data, error } = await getServiceSupabaseClient().rpc("read_m10_transition_question_contents_v1", {
      p_context: context, p_actor_id: studentId, p_context_id: contextId, p_question_ids: requested,
    });
    if (error) {
      if (context === "student_preparation" && ["40001", "PT409"].includes(error.code ?? "") &&
          ["preparation_unavailable", "preparation_changed"].includes(error.message?.split(/[\s:]/)[0])) {
        throw new TransitionPreparationChangedError("preparation_changed");
      }
      throw new Error("문항 내용을 불러오지 못했습니다. 다시 시도해 주세요.", { cause: error });
    }
    const parsed = envelope.safeParse(data);
    if (!parsed.success || parsed.data.context !== context || parsed.data.items.length !== requested.length) throw new Error("transition_content_response_invalid");
    for (let index = 0; index < requested.length; index++) {
      const item = schema.safeParse(parsed.data.items[index]);
      if (!item.success || item.data.id !== requested[index] || result.has(item.data.id)) throw new Error("transition_content_response_invalid");
      result.set(item.data.id, item.data);
    }
  }
  return result;
}

export function getTransitionPreparationContents(studentId: string, preparationId: string, ids: readonly string[]) {
  return read("student_preparation", studentId, preparationId, ids, preparationItem);
}
export function getTransitionStudyContents(studentId: string, assignmentId: string, ids: readonly string[]) {
  return read("student_assignment", studentId, assignmentId, ids, studyItem);
}
