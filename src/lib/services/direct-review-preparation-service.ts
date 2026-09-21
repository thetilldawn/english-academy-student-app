import "server-only";
import { createHash } from "node:crypto";
import { hasRequiredStudentProfile, STUDENT_PROFILE_REQUIRED_MESSAGE } from "@/lib/admin/student-profile-requirements";

import type { AdminContext } from "@/lib/auth/admin";
import { requireAdmin } from "@/lib/auth/admin";
import {
  countReviewLevels,
  resolveReviewCandidate,
} from "@/lib/admin/review-candidate";
import type {
  DirectReviewAssignmentInput,
  DirectReviewPreviewInput,
} from "@/lib/admin/direct-review-assignment-request";
import type { DirectReviewUnavailableItem } from "@/features/assignments/public-contracts";
import type { DirectReviewCandidate } from "@/lib/admin/direct-review-candidate";
import { buildExactAssignmentQuestionPlan } from "@/lib/assignment/question-planner";
import type { EligibleVocabularyEntry } from "@/lib/quiz/eligible-vocabulary";
import { quizVocabularyIdentity } from "@/lib/quiz/word-identity";
import {
  DirectReviewCandidateError,
  listStudentDirectReviewCandidates,
} from "@/lib/services/direct-review-candidate-service";
import { loadDatasetDisplayLabel } from "@/lib/services/dataset-catalog-service";
import { loadEligibleVocabularyDataset } from "@/lib/services/eligible-vocabulary-service";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { buildReviewedDirectReviewSelection, diagnoseReviewedDirectReviewSelection } from "./reviewed-direct-review-selection";
import { quizIndependentTargetDirectionEligibility } from "@/lib/quiz/choice-policy";

const MAX_DIRECT_REVIEW_WORDS = 400;
const MAX_ASSIGNMENT_TITLE_LENGTH = 160;

type ServerSupabaseClient = Awaited<
  ReturnType<typeof createServerSupabaseClient>
>;

type DatasetRow = {
  id: string;
  title: string;
  edition: string | null;
  status: string;
  is_active: boolean;
  metadata?: { questionBankKind?: string };
};

export class DirectReviewPreparationError extends Error {
  constructor(
    public readonly reason:
      | "forbidden"
      | "unavailable"
      | "invalid_selection"
      | "conflict"
      | "database",
    message = "오답 시험 후보를 준비하지 못했습니다.",
    public readonly fieldPath?: string,
  ) {
    super(message);
    this.name = "DirectReviewPreparationError";
  }
}

type DirectReviewSelection = {
  sourceQuestionIds: string[];
  reviewLevels: (1 | 2)[];
  wrongLevel1Eligible: number;
  wrongLevel2Eligible: number;
  questions: {
    vocab_entry_id: number;
    base_order_index: number;
    direction: "english_to_korean" | "korean_to_english";
    choice_vocab_entry_ids: number[];
  }[];
};

export function diagnoseDirectReviewSelection(input: DirectReviewPreviewInput, candidates: readonly DirectReviewCandidate[], allCandidates: readonly EligibleVocabularyEntry[]) {
  if (candidates.some(candidate => candidate.datasetId !== input.datasetId || !input.reviewLevels.includes(candidate.reasonLevel)) ||
    new Set(candidates.map(candidate => candidate.sourceQuestionId)).size !== candidates.length) throw new DirectReviewPreparationError("conflict");
  const targets = new Map(candidates.map(candidate => [candidate.sourceQuestionId, resolveReviewCandidate(allCandidates, candidate, "dataset", new Set())]));
  const eligibility = new Map(quizIndependentTargetDirectionEligibility([...targets.values()].filter((entry): entry is EligibleVocabularyEntry => !!entry), allCandidates).map(entry => [entry.id, entry.eligibleDirections]));
  const directions = input.englishToKoreanRatio === 100 ? ["english_to_korean" as const] : input.englishToKoreanRatio === 0 ? ["korean_to_english" as const] : ["english_to_korean" as const, "korean_to_english" as const];
  const unavailableItems: DirectReviewUnavailableItem[] = [];
  const eligibleCandidates = candidates.filter(candidate => {
    const target = targets.get(candidate.sourceQuestionId);
    const reason = !target ? "target_unavailable" :
      (candidate.canonicalDictionaryId !== null && candidate.canonicalDictionaryId !== target.canonicalDictionaryId) ||
      (candidate.canonicalLexemeId !== null && candidate.canonicalLexemeId !== target.canonicalLexemeId) ? "identity_changed" :
      !directions.every(direction => !target.eligibleDirections || target.eligibleDirections.includes(direction)) ? "direction_unavailable" :
      !directions.every(direction => eligibility.get(target.id)?.includes(direction)) ? "insufficient_choices" : null;
    if (!reason) return true;
    unavailableItems.push({sourceQuestionId: candidate.sourceQuestionId, vocabEntryId: candidate.vocabEntryId,
      headword: target?.headword ?? candidate.headwordNormalized, primaryMeaning: target?.primaryMeaning ?? null, reason});
    return false;
  });
  return { eligibleCandidates, unavailableItems };
}

export function validateDirectReviewSelectionCount(
  expectedQuestionCount: number,
  selection: Pick<DirectReviewSelection, "sourceQuestionIds" | "questions">,
) {
  if (
    expectedQuestionCount !== selection.sourceQuestionIds.length ||
    expectedQuestionCount !== selection.questions.length
  ) {
    throw new DirectReviewPreparationError(
      "conflict",
      "오답 목록이 바뀌었습니다. 단어 수를 다시 확인해 주세요.",
    );
  }
}

export function buildDirectReviewSelection(
  input: DirectReviewPreviewInput,
  candidates: readonly DirectReviewCandidate[],
  allCandidates: readonly EligibleVocabularyEntry[],
): DirectReviewSelection {
  const selectedByIdentity = new Map<
    string,
    { candidate: DirectReviewCandidate; target: EligibleVocabularyEntry }
  >();

  for (const candidate of candidates) {
    if (
      candidate.datasetId !== input.datasetId ||
      !input.reviewLevels.includes(candidate.reasonLevel)
    ) {
      throw new DirectReviewPreparationError("conflict");
    }
    const target = resolveReviewCandidate(
      allCandidates,
      {
        vocabEntryId: candidate.vocabEntryId,
        canonicalDictionaryId: candidate.canonicalDictionaryId,
        canonicalLexemeId: candidate.canonicalLexemeId,
      },
      "dataset",
      new Set<string>(),
    );
    if (!target) {
      throw new DirectReviewPreparationError(
        "invalid_selection",
        "현재 오답 중 출제할 수 없는 단어가 있습니다.",
      );
    }
    if (
      (candidate.canonicalLexemeId !== null &&
        candidate.canonicalLexemeId !== target.canonicalLexemeId) ||
      (candidate.canonicalDictionaryId !== null &&
        candidate.canonicalDictionaryId !== target.canonicalDictionaryId)
    ) {
      throw new DirectReviewPreparationError(
        "conflict",
        "현재 오답의 단어 연결이 바뀌었습니다. 다시 계산해 주세요.",
      );
    }
    const identity = quizVocabularyIdentity(target);
    if (!selectedByIdentity.has(identity)) {
      selectedByIdentity.set(identity, { candidate, target });
    }
  }

  const selected = [...selectedByIdentity.values()].slice(
    0,
    MAX_DIRECT_REVIEW_WORDS,
  );
  if (selected.length === 0) {
    throw new DirectReviewPreparationError(
      "unavailable",
      "선택한 단계에 배정할 현재 오답이 없습니다.",
    );
  }

  let questionDrafts;
  try {
    questionDrafts = buildExactAssignmentQuestionPlan({
      targets: selected.map(({ target }) => target),
      allCandidates,
      englishToKoreanRatio: input.englishToKoreanRatio,
      randomSeed: [
        "direct-review",
        input.studentId,
        input.datasetId,
        ...selected.map(({ candidate }) => candidate.sourceQuestionId),
      ].join(":"),
    });
  } catch (error) {
    throw new DirectReviewPreparationError(
      "invalid_selection",
      error instanceof Error
        ? error.message
        : "현재 조건으로 오답 문제를 만들 수 없습니다.",
    );
  }

  const levelCounts = countReviewLevels(
    selected.map(({ candidate }) => candidate.reasonLevel),
  );
  return {
    sourceQuestionIds: selected.map(
      ({ candidate }) => candidate.sourceQuestionId,
    ),
    reviewLevels: [...input.reviewLevels].sort((left, right) => left - right),
    wrongLevel1Eligible: levelCounts.level1,
    wrongLevel2Eligible: levelCounts.level2,
    questions: questionDrafts.map((question, index) => ({
      vocab_entry_id: question.vocabEntryId,
      base_order_index: index + 1,
      direction: question.direction,
      choice_vocab_entry_ids: question.choiceVocabEntryIds,
    })),
  };
}

async function loadDirectReviewSelection(
  input: DirectReviewPreviewInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
) {
  const admin = authenticatedAdmin ?? await requireAdmin();
  const supabase = client ?? await createServerSupabaseClient();
  try {
    const [studentResult, datasetResult, candidates] =
      await Promise.all([
        supabase
          .from("students")
          .select("id, status, display_name, school_name, grade_label")
          .eq("id", input.studentId)
          .maybeSingle(),
        supabase
          .from("vocab_datasets")
          .select("id, title, edition, status, is_active, metadata")
          .eq("id", input.datasetId)
          .maybeSingle(),
        listStudentDirectReviewCandidates(
          {
            datasetId: input.datasetId,
            limit: MAX_DIRECT_REVIEW_WORDS,
            reviewLevels: input.reviewLevels,
            studentId: input.studentId,
          },
          admin,
          supabase,
        ),
      ]);
    if (studentResult.error || datasetResult.error) {
      throw new DirectReviewPreparationError(studentResult.error?.code === "42501" || datasetResult.error?.code === "42501" ? "forbidden" : "database");
    }
    const dataset = datasetResult.data as DatasetRow | null;
    if (
      !studentResult.data ||
      studentResult.data.status !== "active" ||
      !dataset ||
      dataset.status !== "ready" ||
      !dataset.is_active
    ) {
      throw new DirectReviewPreparationError("unavailable");
    }
    if (!hasRequiredStudentProfile({ displayName: studentResult.data.display_name,
      schoolName: studentResult.data.school_name, gradeLabel: studentResult.data.grade_label })) {
      throw new DirectReviewPreparationError("invalid_selection", STUDENT_PROFILE_REQUIRED_MESSAGE, "studentId");
    }
    let selection: DirectReviewSelection;
    let unavailableItems: DirectReviewUnavailableItem[];
    const emptySelection: DirectReviewSelection = { sourceQuestionIds: [], reviewLevels: [...input.reviewLevels].sort(), wrongLevel1Eligible: 0, wrongLevel2Eligible: 0, questions: [] };
    if (dataset.metadata?.questionBankKind === "reviewed_exam_v1" || dataset.metadata?.questionBankKind === "vocabulary_composition_v1") {
      const { data, error } = await supabase.rpc(dataset.metadata.questionBankKind === "vocabulary_composition_v1" ? "list_vocabulary_composition_review_choices_v1" : "list_reviewed_exam_review_choices_v1", {
        p_dataset_id: input.datasetId, p_vocab_entry_ids: candidates.map(c=>c.vocabEntryId),
      });
      if(error) throw new DirectReviewPreparationError(error.code === "42501" ? "forbidden" : "database");
      const diagnosis = diagnoseReviewedDirectReviewSelection(input,candidates,data);
      unavailableItems = diagnosis.unavailableItems;
      selection = diagnosis.eligibleCandidates.length ? buildReviewedDirectReviewSelection(input,diagnosis.eligibleCandidates,diagnosis.rows) : emptySelection;
    } else {
      const allCandidates=await loadEligibleVocabularyDataset(supabase,input.datasetId,{includeExamUseProjection:true});
      const diagnosis = diagnoseDirectReviewSelection(input,candidates,allCandidates);
      unavailableItems = diagnosis.unavailableItems;
      selection = diagnosis.eligibleCandidates.length ? buildDirectReviewSelection(input,diagnosis.eligibleCandidates,allCandidates) : emptySelection;
    }
    if (selection.sourceQuestionIds.length + unavailableItems.length !== candidates.length) throw new DirectReviewPreparationError("conflict", "오답 자료 연결이 겹칩니다. 다시 확인해 주세요.");
    const material = await supabase.rpc("get_current_wrong_review_material_fingerprint_v1", { p_dataset_id: input.datasetId, p_questions: selection.questions, p_source_question_ids: candidates.map(candidate => candidate.sourceQuestionId) });
    if (material.error || typeof material.data !== "string" || !/^[a-f0-9]{64}$/.test(material.data)) throw new DirectReviewPreparationError(material.error?.code === "42501" ? "forbidden" : "database");
    const selectionFingerprint = createHash("sha256").update(JSON.stringify({
      studentId: input.studentId, datasetId: input.datasetId, reviewLevels: selection.reviewLevels,
      direction: input.englishToKoreanRatio, candidates, unavailableItems, questions: selection.questions, material: material.data,
    })).digest("hex");
    return {
      dataset,
      selection,
      supabase,
      candidates, unavailableItems, selectionFingerprint, materialFingerprint: material.data,
    };
  } catch (error) {
    if (error instanceof DirectReviewPreparationError) throw error;
    if (error instanceof DirectReviewCandidateError) {
      throw new DirectReviewPreparationError(error.reason, error.message);
    }
    throw new DirectReviewPreparationError("database");
  }
}

export async function calculateDirectReviewPreview(
  input: DirectReviewPreviewInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
) {
  const { selection, candidates, unavailableItems, selectionFingerprint } = await loadDirectReviewSelection(
    input,
    authenticatedAdmin,
    client,
  );
  return {
    wrongEligible: selection.questions.length,
    wrongLevel1Eligible: selection.wrongLevel1Eligible,
    wrongLevel2Eligible: selection.wrongLevel2Eligible,
    candidateCount: candidates.length, unavailableCount: unavailableItems.length, unavailableItems, selectionFingerprint,
  };
}

export async function prepareDirectReviewAssignmentBatch(
  input: DirectReviewAssignmentInput,
  authenticatedAdmin?: AdminContext,
  client?: ServerSupabaseClient,
  options?: { nowMilliseconds?: number },
) {
  const nowMilliseconds = options?.nowMilliseconds ?? Date.now();
  if (
    input.availableFrom &&
    input.availableUntil &&
    Date.parse(input.availableUntil) <= Date.parse(input.availableFrom)
  ) {
    throw new DirectReviewPreparationError(
      "invalid_selection",
      "응시 마감은 공개 시각보다 뒤로 정해 주세요.",
      "deadline",
    );
  }
  if (
    input.availableUntil &&
    Date.parse(input.availableUntil) <= nowMilliseconds
  ) {
    throw new DirectReviewPreparationError(
      "invalid_selection",
      "응시 마감 시간은 현재보다 뒤로 정해 주세요.",
      "deadline",
    );
  }
  const { dataset, selection, supabase, candidates, unavailableItems, selectionFingerprint, materialFingerprint } = await loadDirectReviewSelection(
    input,
    authenticatedAdmin,
    client,
  );
  if (input.selectionFingerprint && input.selectionFingerprint !== selectionFingerprint) {
    throw new DirectReviewPreparationError("conflict", "오답 목록이나 문제가 바뀌었습니다. 다시 계산해 주세요.", "preview");
  }
  if (unavailableItems.length && (!input.selectionFingerprint || !input.excludeUnavailableConfirmed)) {
    throw new DirectReviewPreparationError("invalid_selection", "출제에서 제외할 단어를 먼저 확인해 주세요.", "preview");
  }
  validateDirectReviewSelectionCount(input.totalQuestionCount, selection);
  let datasetLabel;
  try {
    datasetLabel = await loadDatasetDisplayLabel(supabase, dataset);
  } catch {
    throw new DirectReviewPreparationError("database");
  }
  return {
    studentId: input.studentId,
    datasetId: input.datasetId,
    reviewLevels: selection.reviewLevels,
    sourceQuestionIds: selection.sourceQuestionIds,
    ...(input.selectionFingerprint ? { expectedSourceQuestionIds: candidates.map(candidate => candidate.sourceQuestionId),
      excludedSourceQuestionIds: unavailableItems.map(item => item.sourceQuestionId), selectionFingerprint, materialFingerprint } : {}),
    title: (
      input.title ||
      `${datasetLabel} · 오답 시험 · ${selection.questions.length}문항`
    ).slice(0, MAX_ASSIGNMENT_TITLE_LENGTH).trimEnd(),
    englishToKoreanRatio: input.englishToKoreanRatio,
    timeLimitSeconds: input.timeLimitSeconds,
    passingScore: input.passingScore,
    retryEnabled: input.retryEnabled,
    retryPassingScore: input.retryPassingScore,
    questionOrderMode: input.questionOrderMode,
    availableFrom: input.availableFrom,
    availableUntil: input.availableUntil,
    timingMode: input.timingMode ?? "total",
    questionTimeLimitSeconds:
      input.timingMode === "per_question"
        ? (input.questionTimeLimitSeconds ?? null)
        : null,
    questions: selection.questions,
  };
}
