import "server-only";
import { z } from "zod";
import { getStudentSession, type StudentSession } from "@/lib/auth/student-session";
import { getServiceSupabaseClient } from "@/lib/supabase/service";
import { frozenPronunciationSchema } from "@/features/wordbook-compositions/public-contracts";
import { normalizeQuizHeadword } from "@/lib/quiz/word-identity";
import { parseTargetPronunciation, preferredPronunciationWithActiveVocaRelease, syntheticPronunciationBindingKey,
  withPronunciationDisplay, withCorrectedPronunciationAudio } from "@/lib/quiz/pronunciation-snapshot";
import { loadActiveVocabPronunciationReleaseRegistry, loadPronunciationLineage, loadEntryApprovedKoreanPronunciationRegistry,
  loadEntrySourcePronunciationRegistry, loadApprovedKoreanPronunciationRegistry, loadSyntheticPronunciationRegistry,
  loadVocabPronunciationRegistry, loadPronunciationAudioCorrections } from "@/lib/services/quiz/pronunciation-registry";
import { notebookFiltersSchema, notebookPronunciationSchema, notebookStudyPageSchema, type NotebookFilters, type NotebookPage, type NotebookWord } from "../../contracts/notebook-study";
import { wrongWordNotebookItemSchema, wrongWordNotebookSummarySchema } from "../../contracts/wrong-word-notebook";
import { decodeNotebookCursor, decodeNotebookWordToken, encodeNotebookCursor } from "../notebook-cursor";
import { OwnWrongWordReadError } from "./own-wrong-word-query";

export const notebookStudySourceSchema = z.object({ entryId: z.number().int().positive(), currentHeadword: z.string(), snapshotDisplayKo: z.string().nullable(), dictionaryId: z.string().nullable(), releaseId: z.string().nullable(),
  notebookPronunciation: frozenPronunciationSchema.nullable().optional(),
  displayKo: z.string().nullable(), pronunciationSnapshot: z.unknown(), compositionPronunciation: frozenPronunciationSchema.nullable(),
  definition: z.string().nullable(), example: z.string().nullable(), exampleKo: z.string().nullable(),
});
const rowSchema = wrongWordNotebookItemSchema.extend({ studySource: notebookStudySourceSchema });
const responseSchema = z.object({ items: z.array(rowSchema).max(501), eventUpperId: z.string().regex(/^\d{1,19}$/),
  totalCount: z.number().int().nonnegative().nullable(), notebookSummary: wrongWordNotebookSummarySchema.nullable(),
  datasetOptions: z.array(z.object({ id: z.uuid(), label: z.string() })).nullable(),
});

type StudyInput = { headword: string; studySource: z.infer<typeof notebookStudySourceSchema> };
/** The pronunciation pipeline needs frozen study values, not student counts. */
export async function hydrateStudyRows<T extends StudyInput>(rows: T[]) {
  const matches = (row: StudyInput) => normalizeQuizHeadword(row.headword) === normalizeQuizHeadword(row.studySource.currentHeadword);
  const legacy = rows.filter(row => !row.studySource.compositionPronunciation && !row.studySource.notebookPronunciation && matches(row)).map(row => row.studySource);
  const ids = [...new Set(legacy.map(row => row.entryId))];
  const lineage = await loadPronunciationLineage(ids);
  const [registry, active, synthetic, approved, entryApproved, entrySource, corrections] = await Promise.all([
    loadVocabPronunciationRegistry(ids, true, lineage), loadActiveVocabPronunciationReleaseRegistry(ids, true, lineage),
    loadSyntheticPronunciationRegistry(legacy.flatMap(row => row.releaseId ? [{ releaseId: row.releaseId, vocabEntryId: row.entryId }] : []), true, lineage),
    loadApprovedKoreanPronunciationRegistry(legacy.flatMap(row => row.dictionaryId ? [row.dictionaryId] : []), true),
    loadEntryApprovedKoreanPronunciationRegistry(ids, true, lineage), loadEntrySourcePronunciationRegistry(ids, true, lineage), loadPronunciationAudioCorrections(true),
  ]);
  return rows.map(({ studySource: source, ...word }) => ({ ...word,
    definition: source.definition, example: source.example && !/_{2,}/u.test(source.example) ? source.example : null,
    exampleKo: source.exampleKo,
    pronunciation: notebookPronunciationSchema.parse(withCorrectedPronunciationAudio(source.notebookPronunciation ?? source.compositionPronunciation ?? (matches({ ...word, studySource: source }) ? preferredPronunciationWithActiveVocaRelease(
      source.dictionaryId, withPronunciationDisplay(parseTargetPronunciation(source.pronunciationSnapshot, source.displayKo), source.displayKo),
      active.get(source.entryId), registry.get(source.entryId), source.releaseId ? synthetic.get(syntheticPronunciationBindingKey(source.releaseId, source.entryId)) : undefined,
      approved, entryApproved.get(source.entryId), { headword: word.headword, restorations: entrySource.get(source.entryId) },
    ) : withPronunciationDisplay(parseTargetPronunciation(source.pronunciationSnapshot, source.snapshotDisplayKo), source.snapshotDisplayKo)), word.headword, corrections)),
  }));
}

/** Ownership is established by the authenticated caller. This narrow port is
 * also used for practice distractors, which are not wrong-word records. */
export async function hydratePronunciationRows(rows: unknown[]) {
  const parsed = z.array(z.object({ headword: z.string(), studySource: notebookStudySourceSchema })).max(500).parse(rows);
  const result: Awaited<ReturnType<typeof hydrateStudyRows<StudyInput>>> = [];
  for (let index = 0; index < parsed.length; index += 200) result.push(...await hydrateStudyRows(parsed.slice(index, index + 200)));
  return result;
}

/** Authenticated server callers must establish ownership before supplying rows. */
export async function hydrateNotebookRows(rows: unknown[]): Promise<NotebookWord[]> {
  const parsed = z.array(rowSchema).max(500).parse(rows);
  const result: NotebookWord[] = [];
  for (let index = 0; index < parsed.length; index += 200) result.push(...await hydrateStudyRows(parsed.slice(index, index + 200)));
  return result;
}

export async function getNotebookPage(input: { filters: NotebookFilters; cursor?: string | null; wordKey?: string }, authenticatedStudent?: StudentSession): Promise<NotebookPage | null> {
  const student = authenticatedStudent ?? await getStudentSession();
  if (!student) throw new OwnWrongWordReadError("unauthenticated");
  const filters = notebookFiltersSchema.parse(input.filters);
  const cursor = input.cursor ? decodeNotebookCursor(input.cursor, student.studentId, filters) : null;
  const { data, error } = await getServiceSupabaseClient().rpc("get_student_wrong_word_notebook_page_v2", {
    p_student_id: student.studentId, p_dataset_id: filters.datasetId || null, p_level: filters.level, p_query: filters.query,
    p_min_wrong_count: filters.minWrongCount ?? null, p_max_wrong_count: filters.maxWrongCount ?? null, p_order: filters.sort,
    p_event_upper_id: cursor?.eventUpperId ?? null, p_after_wrong_at: cursor?.lastWrongAt ?? null,
    p_after_key: cursor?.key ?? null, p_after_wrong_count: cursor?.wrongCount ?? null, p_word_key: input.wordKey ?? null,
  });
  if (error) throw new OwnWrongWordReadError();
  if (data === null) return null;
  const parsed = responseSchema.safeParse(data);
  if (!parsed.success) throw new OwnWrongWordReadError();
  const raw = parsed.data;
  if (!cursor && (raw.totalCount === null || raw.notebookSummary === null || raw.datasetOptions === null)) throw new OwnWrongWordReadError();
  const rows = raw.items.slice(0, 10);
  const last = rows.at(-1);
  return notebookStudyPageSchema.parse({ items: await hydrateStudyRows(rows), summary: raw.notebookSummary, totalCount: raw.totalCount, datasetOptions: raw.datasetOptions,
    nextCursor: raw.items.length > 10 && last ? encodeNotebookCursor({ studentId: student.studentId, filters, eventUpperId: raw.eventUpperId,
      key: last.key, wrongCount: last.wrongCount, lastWrongAt: last.lastWrongAt }) : null,
  });
}

export async function getNotebookWord(token: string, student?: StudentSession): Promise<NotebookWord | null> {
  const key = decodeNotebookWordToken(token);
  if (!key) return null;
  const page = await getNotebookPage({ filters: notebookFiltersSchema.parse({}), wordKey: key }, student);
  return page?.items.find(word => word.key === key) ?? null;
}
