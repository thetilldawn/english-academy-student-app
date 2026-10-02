import "server-only";
import { freezeMistakePracticeQuestions, practiceHash, PracticeError } from "@/features/quiz-player/public-server";
import { notebookAssignmentResultSchema, type NotebookAssignmentInput, type NotebookAssignmentSave, type NotebookAssignmentPreview } from "../../contracts/notebook-assignment";
import { prepareNotebookMistakes } from "../planning/notebook-mistake-assignment";
import { NotebookAssignmentError, notebookAssignmentRpc } from "../persistence/notebook-assignment";

async function prepare(adminId: string, input: NotebookAssignmentInput) {
  const prepared: Awaited<ReturnType<typeof prepareNotebookMistakes>>[] = [], students: NotebookAssignmentPreview["students"] = [];
  for (let start = 0; start < input.studentIds.length; start += 4) {
    const rows = await Promise.all(input.studentIds.slice(start, start + 4).map(async studentId => {
      try { return await prepareNotebookMistakes(adminId, studentId, input); }
      catch (error) {
        if (error instanceof NotebookAssignmentError && error.status === 422) return { preview: {
          studentId, displayName: "", totalCount: 0, availableCount: 0, words: [], excludedCount: 0, excluded: [], sources: [], mismatchingSources: [], error: error.message,
        } };
        throw error;
      }
    }));
    for (const row of rows) { students.push(row.preview); if ("source" in row) prepared.push(row); }
  }
  const confirmation = students.some(value => value.error) ? null : practiceHash({ adminId, input,
    plans: prepared.map(value => ({ sourceHash: value.source.sourceHash, items: value.plan.items, banks: value.preview.banks })) });
  return { prepared, preview: { confirmation, students } };
}
export async function previewNotebookMistakeAssignment(adminId: string, input: NotebookAssignmentInput) { return (await prepare(adminId, input)).preview; }
function validateResult(value: unknown, input: NotebookAssignmentInput) {
  const result = notebookAssignmentResultSchema.parse(value);
  if (new Set(result.map(row => row.assignmentId)).size !== result.length || result.some(row => !input.studentIds.includes(row.studentId)) ||
    input.studentIds.some(id => result.filter(row => row.studentId === id).reduce((sum, row) => sum + row.questionCount, 0) !== input.settings.questionCount))
    throw new NotebookAssignmentError(503, "배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
  return result;
}
export async function saveNotebookMistakeAssignment(adminId: string, value: NotebookAssignmentSave) {
  const { confirmation, gradeConfirmedStudentIds, ...input } = value;
  if (new Set(gradeConfirmedStudentIds).size !== gradeConfirmedStudentIds.length || gradeConfirmedStudentIds.some(id => !input.studentIds.includes(id)))
    throw new NotebookAssignmentError(422, "학년 확인 대상을 다시 확인해 주세요.");
  const requestHash = practiceHash(value);
  const previous = await notebookAssignmentRpc("get_notebook_assignment_result_v1", { p_admin_id: adminId, p_request_key: input.requestKey, p_request_hash: requestHash });
  if (previous !== null) return validateResult(previous, input);
  try {
  const current = await prepare(adminId, input);
  if (!current.preview.confirmation || current.preview.confirmation !== confirmation) throw new NotebookAssignmentError(409, "오답 목록이나 시험 구성이 바뀌었습니다. 다시 확인해 주세요.", "source_changed");
  if (current.preview.students.some(student => student.mismatchingSources.length && !gradeConfirmedStudentIds.includes(student.studentId)))
    throw new NotebookAssignmentError(422, "학년이 다른 단어장을 포함할지 확인해 주세요.");
  const batches = [];
  for (const item of current.prepared) {
    let frozen: Awaited<ReturnType<typeof freezeMistakePracticeQuestions>>;
    try { frozen = await freezeMistakePracticeQuestions(item.preview.studentId, item, { kind: "admin", adminId }); }
    catch (error) {
      if (error instanceof PracticeError) throw new NotebookAssignmentError(error.status, error.message, error.code);
      throw error;
    }
    const bankIndex = new Map(item.banks.flatMap(bank => bank.items.map(value => [value.word.meaningKey, bank.index] as const)));
    batches.push({ studentId: item.preview.studentId, selection: { mode: "filtered", filters: input.filters }, settings: input.settings,
      sourceHash: item.source.sourceHash, questions: frozen.map(question => ({ ...question, bankIndex: bankIndex.get(question.meaningKey) })),
      banks: item.preview.banks, audienceMode: input.audienceMode, gradeConfirmed: gradeConfirmedStudentIds.includes(item.preview.studentId) });
  }
  return validateResult(await notebookAssignmentRpc("create_notebook_assignments_v2", {
    p_admin_id: adminId, p_request_key: input.requestKey, p_request_hash: requestHash, p_batches: batches,
  }), input);
  } catch(error) {
    const saved=await notebookAssignmentRpc("get_notebook_assignment_result_v1",{p_admin_id:adminId,p_request_key:input.requestKey,p_request_hash:requestHash});
    if(saved!==null)return validateResult(saved,input);
    throw error;
  }
}
