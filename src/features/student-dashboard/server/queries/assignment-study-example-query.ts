import "server-only";
import { getAssignmentStudyQuestionContents } from "@/features/quiz-player/public-server-queries";

import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

const rowSchema = z.object({ vocab_entry_id: z.number().int().positive(), prompt: z.string().min(1).max(10_000) });

/** Only call after get_student_assignment_study_v1 permitted this session's assignment. */
export async function getStudyExamplePrompts(studentId: string, assignmentId: string, permittedEntryIds: readonly number[]): Promise<Map<number, string[]>> {
  if (!permittedEntryIds.length) return new Map();
  const allowed = new Set(permittedEntryIds);
  const { data, error } = await getServiceSupabaseClient().from("assignment_questions")
    .select("id, vocab_entry_id")
    .eq("assignment_id", assignmentId)
    .eq("eligibility_quiz_mode", "canonical_example_to_headword")
    .in("vocab_entry_id", [...allowed])
    .limit(1001);
  if (error) throw new Error("assignment_study_example_read_failed", { cause: error.code });
  const stored = z.array(z.object({ id: z.uuid(), vocab_entry_id: z.number().int().positive() })).max(1000).safeParse(data);
  if (!stored.success || stored.data.some(row => !allowed.has(row.vocab_entry_id))) throw new Error("assignment_study_example_data_invalid");
  const contents = await getAssignmentStudyQuestionContents(studentId, assignmentId, stored.data.map(row => row.id));
  if (stored.data.some(row => contents.get(row.id)?.vocab_entry_id !== row.vocab_entry_id)) throw new Error("assignment_study_example_data_invalid");
  const parsed = z.array(rowSchema).max(1000).safeParse(stored.data.map(row => ({ ...row, prompt: contents.get(row.id)!.prompt })));
  if (!parsed.success || parsed.data.some((row) => !allowed.has(row.vocab_entry_id))) {
    throw new Error("assignment_study_example_data_invalid");
  }
  const prompts = new Map<number, string[]>();
  for (const row of parsed.data) {
    const group = prompts.get(row.vocab_entry_id) ?? [];
    group.push(row.prompt);
    prompts.set(row.vocab_entry_id, group);
  }
  return prompts;
}
