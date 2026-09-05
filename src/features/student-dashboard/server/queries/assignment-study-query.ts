import "server-only";

import { z } from "zod";
import type { StudentSession } from "@/lib/auth/student-session";
import { normalizeQuizContentMode } from "@/lib/quiz/question-content-mode";
import {
  parseTargetPronunciation,
  preferredPronunciationWithActiveVocaRelease,
  syntheticPronunciationBindingKey,
  withPronunciationDisplay,
} from "@/lib/quiz/pronunciation-snapshot";
import {
  loadActiveVocabPronunciationReleaseRegistry,
  loadApprovedKoreanPronunciationRegistry,
  loadSyntheticPronunciationRegistry,
  loadVocabPronunciationRegistry,
} from "@/lib/services/quiz/pronunciation-registry";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import type { AssignmentStudy } from "../../contracts/assignment-study";

const wordSchema = z.object({
  entryId: z.number().int().positive(),
  headword: z.string().trim().min(1),
  meaning: z.string().trim().min(1),
  displayKo: z.string().nullable(),
  pronunciationSnapshot: z.unknown(),
  dictionaryId: z.string().nullable(),
  releaseId: z.string().nullable(),
  definition: z.string().nullable(),
  example: z.string().nullable(),
});
const studySchema = z.object({
  assignmentId: z.uuid(),
  title: z.string().min(1),
  mode: z.string(),
  words: z.array(wordSchema).min(1).max(1000),
});

export async function getAssignmentStudy(
  student: Pick<StudentSession, "studentId">,
  assignmentId: string,
): Promise<AssignmentStudy | null> {
  if (!z.uuid().safeParse(assignmentId).success) return null;
  const { data, error } = await getServiceSupabaseClient().rpc(
    "get_student_assignment_study_v1",
    { p_assignment_id: assignmentId, p_student_id: student.studentId },
  );
  if (error) throw new Error("assignment_study_read_failed", { cause: error.code });
  if (data === null) return null;
  const parsed = studySchema.safeParse(data);
  if (!parsed.success || parsed.data.assignmentId !== assignmentId) {
    throw new Error("assignment_study_data_invalid");
  }
  const raw = parsed.data;
  const mode = normalizeQuizContentMode(raw.mode);
  // Exact duplicates may arise from mixed/review targets, but never merge different senses.
  const seen = new Set<string>();
  const rows = raw.words.filter((word) => {
    const key = JSON.stringify([word.entryId, word.headword, word.meaning, word.definition, word.example]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (rows.some((word) => word.example && /_{2,}/u.test(word.example))) {
    throw new Error("assignment_study_example_incomplete");
  }
  const ids = [...new Set(rows.map((word) => word.entryId))];
  const bindings = rows.flatMap((word) => word.releaseId
    ? [{ releaseId: word.releaseId, vocabEntryId: word.entryId }]
    : []);
  const dictionaryIds = rows.flatMap((word) => word.dictionaryId ? [word.dictionaryId] : []);
  const [registry, active, synthetic, approved] = await Promise.all([
    loadVocabPronunciationRegistry(ids),
    loadActiveVocabPronunciationReleaseRegistry(ids),
    loadSyntheticPronunciationRegistry(bindings),
    loadApprovedKoreanPronunciationRegistry(dictionaryIds),
  ]);
  return {
    assignmentId,
    title: raw.title,
    mode,
    words: rows.map((word, index) => ({
      key: `word-${index}`,
      headword: word.headword,
      meaning: word.meaning,
      definition: mode === "canonical_definition_to_headword" ? word.definition : null,
      example: mode === "canonical_example_to_headword" ? word.example : null,
      pronunciation: preferredPronunciationWithActiveVocaRelease(
        word.dictionaryId,
        withPronunciationDisplay(parseTargetPronunciation(word.pronunciationSnapshot, word.displayKo), word.displayKo),
        active.get(word.entryId),
        registry.get(word.entryId),
        word.releaseId ? synthetic.get(syntheticPronunciationBindingKey(word.releaseId, word.entryId)) : undefined,
        approved,
      ),
    })),
  };
}
