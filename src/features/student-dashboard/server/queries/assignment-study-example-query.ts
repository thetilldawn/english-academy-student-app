import "server-only";

import { z } from "zod";
import { getServiceSupabaseClient } from "@/lib/supabase/service";

const rowSchema = z.object({ vocab_entry_id: z.number().int().positive(), prompt: z.string().min(1).max(10_000) });

/** Only call after get_student_assignment_study_v1 permitted this session's assignment. */
export async function getStudyExamplePrompts(assignmentId: string, permittedEntryIds: readonly number[]): Promise<Map<number, string[]>> {
  if (!permittedEntryIds.length) return new Map();
  const allowed = new Set(permittedEntryIds);
  const { data, error } = await getServiceSupabaseClient().from("assignment_questions")
    .select("vocab_entry_id, prompt")
    .eq("assignment_id", assignmentId)
    .eq("eligibility_quiz_mode", "canonical_example_to_headword")
    .in("vocab_entry_id", [...allowed])
    .limit(1001);
  if (error) throw new Error("assignment_study_example_read_failed", { cause: error.code });
  const parsed = z.array(rowSchema).max(1000).safeParse(data);
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
