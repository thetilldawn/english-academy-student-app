import "server-only";
import { z } from "zod";
import { buildMistakePracticePlan, mistakePracticeSourceSchema } from "@/features/quiz-player/public-server";
import { compareAssignmentGrades } from "../../domain/assignment-grade-review";
import { splitMistakeAssignmentBanks } from "../../domain/mistake-assignment-banks";
import type { NotebookAssignmentInput } from "../../contracts/notebook-assignment";
import { notebookAssignmentRpc } from "../persistence/notebook-assignment";

const sourceSchema = mistakePracticeSourceSchema.extend({
  stateVersion: z.string().regex(/^\d+$/),
  words: z.array(mistakePracticeSourceSchema.shape.words.element.extend({ latestDatasetId: z.uuid(), stateVersion: z.string().regex(/^\d+$/), assignmentAvailable: z.boolean() })),
  student: z.object({ id: z.uuid(), displayName: z.string(), gradeLabel: z.string(), schoolName: z.string() }),
  datasets: z.array(z.object({ id: z.uuid(), label: z.string(), gradeCode: z.string().nullable(), available: z.boolean() })),
});
export async function prepareNotebookMistakes(adminId: string, studentId: string, input: NotebookAssignmentInput) {
  const source = sourceSchema.parse(await notebookAssignmentRpc("prepare_notebook_assignment_source_v2", {
    p_admin_id: adminId, p_student_id: studentId, p_selection: { mode: "filtered", filters: input.filters },
  }));
  const available = new Set(source.datasets.filter(value => value.available).map(value => value.id));
  const omitted = source.words.filter(word => !available.has(word.latestDatasetId) || !word.assignmentAvailable).map(word => ({ key: word.key, headword: word.headword,
    reason: word.assignmentAvailable ? "현재 배정할 수 없는 단어장입니다." : "이미 배정했거나 다른 재시험을 준비 중인 뜻입니다." }));
  const allowed = { ...source, words: source.words.filter(word => available.has(word.latestDatasetId) && word.assignmentAvailable), candidates: source.candidates.filter(word => available.has(word.datasetId)) };
  const { questionCount, englishToKoreanRatio, timingMode, timeLimitSeconds, questionTimeLimitSeconds } = input.settings;
  const plan = buildMistakePracticePlan(allowed, { questionCount, englishToKoreanRatio, timingMode, timeLimitSeconds, questionTimeLimitSeconds }, `${input.requestKey}:${studentId}`, { separateBanks: true });
  const partition = splitMistakeAssignmentBanks(plan.items, input.settings.timeLimitSeconds);
  const used = new Set(plan.selected.map(word => word.latestDatasetId));
  const sources = source.datasets.filter(value => used.has(value.id)).map(({ id, label, gradeCode }) => ({ id, label, gradeCode }));
  const mismatchingSources = input.audienceMode === "single" ? [] : sources.filter(value => compareAssignmentGrades(value.gradeCode, [source.student]).mismatchedStudentIds.length);
  const excluded = [...omitted, ...plan.excluded];
  return { source, plan, banks: partition.banks, preview: {
    studentId, displayName: source.student.displayName, totalCount: source.words.length, availableCount: plan.availableCount,
    words: plan.selected.map(word => ({ key: word.key, headword: word.headword, primaryMeaning: word.selectedText })),
    excludedCount: excluded.length, excluded: excluded.slice(0, 20), sources, mismatchingSources, error: plan.error ?? partition.error,
    banks: partition.banks.map(({ index, questionCount, quizContentMode, englishToKoreanRatio, timeLimitSeconds }) => ({ index, questionCount, quizContentMode, englishToKoreanRatio, timeLimitSeconds })),
  } };
}
