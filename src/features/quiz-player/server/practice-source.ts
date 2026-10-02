import "server-only";
import { createHash } from "node:crypto";
import { hydratePronunciationRows } from "@/features/students/public-server";
import { buildPracticePlan, practiceSourceSchema, type PracticeEntry, type PracticeSource } from "../domain/practice-plan";
import type { PracticeInput } from "../contracts/practice";
import type { QuizPronunciation } from "../model";
import { practiceRpc } from "./practice-rpc";

export const practiceHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const emptyPronunciation: QuizPronunciation = { displayKo: null, variantId: null, audioUrl: null, available: false };
export async function preparePractice(studentId: string, input: PracticeInput) {
  const data = await practiceRpc("prepare_student_word_practice_v1", { p_student_id: studentId, p_selection: input.selection });
  const source = practiceSourceSchema.parse(data);
  const plan = buildPracticePlan(source, input.settings, input.requestKey);
  const confirmation = plan.error ? null : practiceHash({ studentId, input, sourceHash: source.sourceHash, questions: plan.questions });
  return { source, plan, preview: { confirmation, availableCount: plan.availableCount, totalCount: plan.totalCount,
    words: plan.selected.slice(0, input.settings.questionCount).map(w => ({ key: w.key!, headword: w.headword, primaryMeaning: w.primaryMeaning })),
    excluded: plan.excluded, error: plan.error } };
}
function pronunciationRow(entry: PracticeEntry, source: Pick<PracticeSource, "candidates">) {
  if (entry.raw) return entry.raw;
  const row = source.candidates.find(candidate => candidate.entryId === entry.entryId)!;
  return { headword: entry.headword,
    studySource: { entryId: row.entryId, currentHeadword: row.headword, snapshotDisplayKo: null, dictionaryId: null, releaseId: null,
      displayKo: row.displayKo, pronunciationSnapshot: null, compositionPronunciation: null, definition: null, example: null, exampleKo: null } };
}
export async function freezePracticeQuestions(prepared: {source: Pick<PracticeSource, "candidates">; plan: Pick<ReturnType<typeof buildPracticePlan>, "candidates" | "questions">}, preserveStudyPronunciation = false) {
  const byId = new Map(prepared.plan.candidates.map(entry => [entry.id, entry]));
  const used = new Set(prepared.plan.questions.flatMap(q => [q.vocabEntryId, ...q.choiceVocabEntryIds]));
  const entries = [...used].map(id => byId.get(id)!);
  const pronunciation = new Map<number, QuizPronunciation>();
  for (let offset = 0; offset < entries.length; offset += 200) {
    const page = entries.slice(offset, offset + 200);
    const hydrated = await hydratePronunciationRows(page.map(entry => pronunciationRow(entry, prepared.source)));
    page.forEach((entry, index) => pronunciation.set(entry.id, hydrated[index].pronunciation));
  }
  return prepared.plan.questions.map(q => ({ wordKey: byId.get(q.vocabEntryId)!.key,
    direction: q.direction, prompt: q.prompt, choices: q.choices, correctChoiceIndex: q.correctChoiceIndex,
    pronunciation: preserveStudyPronunciation || q.direction === "english_to_korean" ? pronunciation.get(q.vocabEntryId)! : emptyPronunciation,
    choicePronunciations: q.choiceVocabEntryIds.map(id => q.direction === "korean_to_english" ? pronunciation.get(id)! : emptyPronunciation),
    choiceSources: q.choiceVocabEntryIds.map(id => { const value = byId.get(id)!; return { entryId: value.entryId, headword: value.headword, primaryMeaning: value.primaryMeaning }; }),
  }));
}
