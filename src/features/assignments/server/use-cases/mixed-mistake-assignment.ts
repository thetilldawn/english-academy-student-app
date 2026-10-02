import "server-only";
import { freezeMistakePracticeQuestions, practiceHash, PracticeError } from "@/features/quiz-player/public-server";
import { mixedMistakeResultSchema, type MixedMistakePreviewInput, type MixedMistakeSave } from "../../contracts/mixed-mistake-assignment";
import { prepareMixedMistakeAssignment, mixedMistakeSelection } from "../planning/mixed-mistake-assignment";
import { NotebookAssignmentError, notebookAssignmentRpc } from "../persistence/notebook-assignment";

export async function previewMixedMistakeAssignment(adminId: string, input: MixedMistakePreviewInput) {
  return (await prepareMixedMistakeAssignment(adminId, input)).preview;
}
function result(value: unknown, input: MixedMistakeSave) {
  const parsed = mixedMistakeResultSchema.safeParse({ planVersion: "meaning-episode-v1", kind: "mistake_batch", assignments: value });
  if (!parsed.success || parsed.data.assignments.some(row => row.studentId !== input.studentId) ||
    parsed.data.assignments.reduce((sum, row) => sum + row.questionCount, 0) !== input.totalQuestionCount) {
    throw new NotebookAssignmentError(503, "배정 결과를 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.");
  }
  return parsed.data;
}
export async function saveMixedMistakeAssignment(adminId: string, input: MixedMistakeSave) {
  const hash = practiceHash({ operation: "mixed-mistake-assignment-v1", input });
  const receipt = () => notebookAssignmentRpc("get_notebook_assignment_result_v1", { p_admin_id: adminId, p_request_key: input.idempotencyKey, p_request_hash: hash });
  const previous = await receipt();
  if (previous !== null) return result(previous, input);
  try {
    const prepared = await prepareMixedMistakeAssignment(adminId, input);
    if (prepared.preview.error || prepared.preview.selectionFingerprint !== input.selectionFingerprint) {
      throw new NotebookAssignmentError(409, "현재 범위나 오답 목록이 달라졌습니다. 미리보기를 다시 확인해 주세요.", "source_changed");
    }
    if (prepared.preview.unavailableCount && !input.excludeUnavailableConfirmed) throw new NotebookAssignmentError(422, "제외할 오답을 확인해 주세요.");
    if (prepared.banks.length > 1 && !input.banksConfirmed) throw new NotebookAssignmentError(422, "나누어 배정할 시험을 확인해 주세요.");
    if (input.availableUntil && Date.parse(input.availableUntil) <= Date.now()) throw new NotebookAssignmentError(422, "응시 마감은 현재보다 뒤로 정해 주세요.");
    let frozen: Awaited<ReturnType<typeof freezeMistakePracticeQuestions>>;
    try { frozen = await freezeMistakePracticeQuestions(input.studentId, prepared, { kind: "admin", adminId }); }
    catch (error) { if (error instanceof PracticeError) throw new NotebookAssignmentError(error.status, error.message, error.code); throw error; }
    const frozenByMeaning = new Map(frozen.map(question => [question.meaningKey, question]));
    const queueByMeaning = new Map(prepared.source.words.map(word => [word.meaningKey, word.queueId]));
    const banks = prepared.banks.map(bank => ({ index: bank.index, questionCount: bank.questionCount, primaryQuestionCount: bank.primaryQuestionCount,
      reviewMeaningCount: bank.reviewMeaningCount, quizContentMode: bank.quizContentMode, englishToKoreanRatio: bank.englishToKoreanRatio,
      timeLimitSeconds: bank.timeLimitSeconds,
      primaryQuestions: bank.items.filter(item => item.kind === "primary").map((item, index) => ({
        vocab_entry_id: item.generated.vocabEntryId, base_order_index: index + 1, direction: item.generated.direction,
        choice_vocab_entry_ids: item.generated.choiceVocabEntryIds, meaningKey: item.proof.meaningKey,
        wordKey: item.proof.wordKey, meaningProofHash: item.proof.meaningProofHash,
      })),
      reviewQuestions: bank.items.filter(item => item.kind === "review").map(item => {
        const question = frozenByMeaning.get(item.word.meaningKey), queueId = queueByMeaning.get(item.word.meaningKey);
        if (!question || !queueId) throw new NotebookAssignmentError(409, "오답 문항 연결이 달라졌습니다. 다시 확인해 주세요.", "source_changed");
        return { ...question, queueId };
      }),
    }));
    const settings = { questionCount: input.totalQuestionCount, englishToKoreanRatio: input.englishToKoreanRatio,
      timingMode: input.timingMode, timeLimitSeconds: input.timingMode === "total" ? input.timeLimitSeconds : null,
      questionTimeLimitSeconds: input.timingMode === "per_question" ? input.questionTimeLimitSeconds : null,
      passingScore: input.passingScore, retryEnabled: input.retryEnabled, retryPassingScore: input.retryPassingScore,
      title: input.title, questionOrderMode: input.questionOrderMode, availableFrom: null, availableUntil: input.availableUntil };
    return result(await notebookAssignmentRpc("create_mixed_mistake_assignments_v1", {
      p_admin_id: adminId, p_request_key: input.idempotencyKey, p_request_hash: hash,
      p_batches: [{ studentId: input.studentId, audienceMode: "single", gradeConfirmed: false, selection: mixedMistakeSelection(input),
        sourceHash: prepared.source.sourceHash, primaryRequests: prepared.primaryRequests, primarySourceHash: prepared.primarySourceHash, settings, banks }],
    }), input);
  } catch (error) {
    const saved = await receipt();
    if (saved !== null) return result(saved, input);
    throw error;
  }
}
